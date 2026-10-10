#!/usr/bin/env node
/**
 * Make an EXISTING `aobplatform` realm say how each session signed in
 * (D-2026-10-10-06).
 *
 * WHY. Revoking a tablet, and re-baselining an AOBPRINTER chain, ask for a
 * fresh second factor, and core judges that on the token's `amr` claim
 * (packages/domain/src/auth-method.ts). This realm was built with no amr
 * mapper, so every token said nothing and a passkey session was refused. The
 * export now carries the fix, but `--import-realm` only runs against an empty
 * database, so a realm that already exists needs this.
 *
 * WHAT IT ADDS, AND ONLY THAT:
 *   - the authenticator config on each credential step of `clinician-browser
 *     Credential` that names its RFC 8176 value (passkey `hwk`, password
 *     `pwd`), taken from realm-export.json by alias;
 *   - Keycloak's `oidc-amr-mapper` on the `web` and `console` clients.
 *
 * WHAT IT NEVER DOES. It changes no requirement, binds no flow and removes
 * nothing - the steps that make the passkey mandatory are read, not written.
 * A step that already has a config naming a DIFFERENT value is REPORTED and
 * left alone, like apply-realm-additions.mjs reports a drifted client: changing
 * it silently is how a script meant to add a claim ends up rewriting a flow.
 *
 * Idempotent. Back up first (backup-keycloak.mjs); then:
 *   node infra/keycloak/apply-amr.mjs
 * Then sign out of the console and sign in again, so the next token carries it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// 127.0.0.1, not localhost: see apply-realm-additions.mjs.
const BASE = process.env.KEYCLOAK_BASE_URL ?? 'http://127.0.0.1:21024';
const REALM = process.env.KEYCLOAK_REALM ?? 'aobplatform';
const ADMIN_USER = process.env.KEYCLOAK_ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin';
const FLOW = 'clinician-browser';
const SUBFLOW = 'clinician-browser Credential';
const CLIENTS = ['web', 'console'];

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function adminToken() {
  const res = await fetch(`${BASE}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: ADMIN_USER, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) die(`Could not authenticate to Keycloak at ${BASE} (${res.status}).`);
  return (await res.json()).access_token;
}

async function api(token, path, init = {}) {
  return fetch(`${BASE}/admin/realms/${REALM}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function json(res, what) {
  if (!res.ok) die(`${what}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const exported = JSON.parse(readFileSync(join(HERE, 'realm-export.json'), 'utf8'));
  const configs = new Map((exported.authenticatorConfig ?? []).map((c) => [c.alias, c]));
  const wanted = exported.authenticationFlows.find((f) => f.alias === SUBFLOW)?.authenticationExecutions ?? [];
  const token = await adminToken();
  console.log(`\n  Realm ${REALM} at ${BASE}\n`);

  let added = 0;
  let present = 0;
  let drifted = 0;

  // The flattened list includes the subflows' executions, each with its providerId.
  const executions = await json(await api(token, `/authentication/flows/${encodeURIComponent(FLOW)}/executions`), 'Could not read the flow');
  for (const step of wanted) {
    if (!step.authenticatorConfig) continue;
    const config = configs.get(step.authenticatorConfig);
    if (!config) die(`realm-export.json names config ${step.authenticatorConfig} and does not define it.`);
    const live = executions.find((e) => e.providerId === step.authenticator);
    if (!live) die(`The live ${FLOW} flow has no ${step.authenticator} step; this script adds claims, it does not build flows.`);
    if (live.authenticationConfig) {
      const existing = await json(await api(token, `/authentication/config/${live.authenticationConfig}`), 'Could not read a step config');
      const value = existing.config?.['default.reference.value'];
      if (value === config.config['default.reference.value']) {
        present += 1;
      } else {
        drifted += 1;
        console.log(`    ! step     ${step.authenticator} already has a config (${existing.alias}) naming ${value ?? 'no amr value'}; left alone`);
      }
      continue;
    }
    const res = await api(token, `/authentication/executions/${live.id}/config`, {
      method: 'POST',
      body: JSON.stringify({ alias: config.alias, config: config.config }),
    });
    if (!res.ok) die(`Could not add ${config.alias} to ${step.authenticator}: ${res.status} ${await res.text()}`);
    console.log(`    + step     ${step.authenticator} names ${config.config['default.reference.value']}`);
    added += 1;
  }

  for (const clientId of CLIENTS) {
    const mapper = exported.clients.find((c) => c.clientId === clientId)?.protocolMappers?.find((m) => m.protocolMapper === 'oidc-amr-mapper');
    if (!mapper) die(`realm-export.json gives the ${clientId} client no amr mapper.`);
    const [client] = await json(await api(token, `/clients?clientId=${encodeURIComponent(clientId)}`), `Could not find client ${clientId}`);
    if (!client) die(`The live realm has no ${clientId} client; run apply-realm-additions.mjs first.`);
    const mappers = await json(await api(token, `/clients/${client.id}/protocol-mappers/models`), `Could not read ${clientId}'s mappers`);
    if (mappers.some((m) => m.protocolMapper === 'oidc-amr-mapper')) {
      present += 1;
      continue;
    }
    const res = await api(token, `/clients/${client.id}/protocol-mappers/models`, { method: 'POST', body: JSON.stringify(mapper) });
    if (!res.ok) die(`Could not add the amr mapper to ${clientId}: ${res.status} ${await res.text()}`);
    console.log(`    + client   ${clientId} carries the amr claim`);
    added += 1;
  }

  console.log(`\n  ${added} added, ${present} already present, ${drifted} left alone.\n`);
  if (added > 0) console.log('  Sign out of the console and sign in again: the next token carries amr.\n');
  if (drifted > 0) process.exitCode = 2;
}

main().catch((err) => die(err.message));
