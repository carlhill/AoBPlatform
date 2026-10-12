#!/usr/bin/env node
/**
 * Close the password grant on an EXISTING realm (rule 15, D-2026-10-11-01).
 *
 * WHY. The browser flows require a passkey (and, in the tier 2 sandbox, a
 * password AND a code). The token endpoint had a second door: `web` allowed
 * OAuth direct grants, and a password grant runs the realm's DIRECT GRANT flow
 * instead - Keycloak's stock one, a username and a password and nothing else.
 * A staff token was one POST away for anybody holding a password. The exports
 * now carry the fix, but `--import-realm` only runs against an empty database,
 * so a realm that already exists needs this.
 *
 * WHAT IT DOES, AND ONLY THAT:
 *   - adds the `no-direct-grant` flow (one step: Deny access, REQUIRED) if the
 *     realm has no flow of that name;
 *   - binds it as the realm's direct grant flow, which every client falls back
 *     to - Keycloak's own `admin-cli`, created in every realm, included;
 *   - switches direct grants off on each client the export lists that has
 *     them on.
 *
 * WHAT IT NEVER DOES. It removes nothing and touches no browser flow. A
 * `no-direct-grant` flow that already exists with different steps is REPORTED
 * and left alone, and the realm is not bound to it, like apply-amr.mjs reports
 * a drifted step: rewriting a flow it did not expect is how a script meant to
 * close a door ends up opening another. A client that overrides the realm's
 * direct grant flow is REPORTED and its override left in place, but its direct
 * grants are still switched off, because that closes the door whatever the
 * override names.
 *
 * Then it CHECKS: it asks the token endpoint for a token with an invented
 * username, through `web` and through `admin-cli`, and fails if Keycloak still
 * answers by checking the password ("Invalid user credentials") - that answer
 * means the grant reached a credential step.
 *
 * Idempotent. Back up first (backup-keycloak.mjs); then:
 *   node infra/keycloak/apply-no-direct-grant.mjs
 *   KEYCLOAK_REALM=aobplatform-tier2 node infra/keycloak/apply-no-direct-grant.mjs
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
// Each realm is patched from its own file, never from the other's.
const EXPORTS = { aobplatform: 'realm-export.json', 'aobplatform-tier2': 'tier2-realm.json' };
const FLOW = 'no-direct-grant';
const DENY = 'deny-access-authenticator';
// Not an account anywhere. A password grant naming it can only be told apart by
// WHERE it is refused: at the client, at Deny access, or at the password check.
const PROBE_USER = 'direct-grant-probe.invalid';

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

async function ok(res, what) {
  if (!res.ok) die(`${what}: ${res.status} ${await res.text()}`);
}

/** Exactly one step, Deny access, REQUIRED - the shape the export guards assert. */
function denies(executions) {
  return executions.length === 1 && executions[0].providerId === DENY && executions[0].requirement === 'REQUIRED';
}

async function probe(clientId) {
  const res = await fetch(`${BASE}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: clientId, username: PROBE_USER, password: 'not-a-password' }),
  });
  const body = await res.text();
  let said;
  try {
    const parsed = JSON.parse(body);
    said = `${parsed.error}${parsed.error_description ? `: ${parsed.error_description}` : ''}`;
  } catch {
    // Deny access answers a grant with its login-page error, not with JSON.
    said = /<html/i.test(body) ? 'an HTML error page (Deny access)' : body.slice(0, 80).replace(/\s+/g, ' ');
  }
  const reachedPassword = /invalid user credentials/i.test(body);
  return { clientId, status: res.status, said, refused: !res.ok && !reachedPassword };
}

async function main() {
  const file = EXPORTS[REALM];
  if (!file) die(`No export is kept for realm "${REALM}". This script patches ${Object.keys(EXPORTS).join(' or ')} only.`);
  const exported = JSON.parse(readFileSync(join(HERE, file), 'utf8'));
  if (exported.realm !== REALM) die(`${file} names the realm "${exported.realm}", not "${REALM}". Nothing was sent.`);
  const wanted = exported.authenticationFlows.find((f) => f.alias === FLOW);
  if (!wanted || exported.directGrantFlow !== FLOW) die(`${file} does not bind ${FLOW} as its direct grant flow.`);

  const token = await adminToken();
  console.log(`\n  Realm ${REALM} at ${BASE} (from ${file})\n`);

  let changed = 0;
  let present = 0;
  let drifted = 0;

  // ---- the flow ------------------------------------------------------------
  const flows = await json(await api(token, '/authentication/flows'), 'Could not read the flows');
  const path = `/authentication/flows/${encodeURIComponent(FLOW)}/executions`;
  let flowSound = false;
  if (flows.some((f) => f.alias === FLOW)) {
    const executions = await json(await api(token, path), `Could not read ${FLOW}`);
    if (denies(executions)) {
      present += 1;
      flowSound = true;
    } else {
      drifted += 1;
      console.log(`    ! flow     ${FLOW} exists with other steps (${executions.map((e) => `${e.providerId} ${e.requirement}`).join(', ')}); left alone`);
    }
  } else {
    await ok(
      await api(token, '/authentication/flows', {
        method: 'POST',
        body: JSON.stringify({ alias: FLOW, description: wanted.description, providerId: 'basic-flow', topLevel: true, builtIn: false }),
      }),
      `Could not create ${FLOW}`,
    );
    await ok(await api(token, `${path}/execution`, { method: 'POST', body: JSON.stringify({ provider: DENY }) }), `Could not add ${DENY}`);
    const [step] = await json(await api(token, path), `Could not read ${FLOW} back`);
    await ok(await api(token, path, { method: 'PUT', body: JSON.stringify({ ...step, requirement: 'REQUIRED' }) }), `Could not make ${DENY} REQUIRED`);
    if (!denies(await json(await api(token, path), `Could not read ${FLOW} back`))) die(`${FLOW} was created but does not read back as one REQUIRED ${DENY}.`);
    console.log(`    + flow     ${FLOW}: Deny access, REQUIRED`);
    changed += 1;
    flowSound = true;
  }

  // ---- the realm binding, only to a flow that was just shown to deny -----------
  const realm = await json(await api(token, ''), 'Could not read the realm');
  if (realm.directGrantFlow === FLOW && flowSound) {
    present += 1;
  } else if (flowSound) {
    await ok(await api(token, '', { method: 'PUT', body: JSON.stringify({ directGrantFlow: FLOW }) }), 'Could not bind the direct grant flow');
    console.log(`    + realm    direct grant flow ${realm.directGrantFlow} -> ${FLOW}`);
    changed += 1;
  } else {
    console.log(`    ! realm    direct grant flow left as ${realm.directGrantFlow}: ${FLOW} is not the flow this script expects`);
  }

  // ---- the clients the export lists ----------------------------------------
  for (const { clientId } of exported.clients ?? []) {
    const [client] = await json(await api(token, `/clients?clientId=${encodeURIComponent(clientId)}`), `Could not find client ${clientId}`);
    if (!client) {
      console.log(`    ! client   ${clientId} is in ${file} and not in the live realm; run apply-realm-additions.mjs`);
      drifted += 1;
      continue;
    }
    if (client.authenticationFlowBindingOverrides?.direct_grant) {
      console.log(`    ! client   ${clientId} overrides the realm's direct grant flow; the override is left in place`);
      drifted += 1;
    }
    if (client.directAccessGrantsEnabled !== true) {
      present += 1;
      continue;
    }
    await ok(
      await api(token, `/clients/${client.id}`, { method: 'PUT', body: JSON.stringify({ ...client, directAccessGrantsEnabled: false }) }),
      `Could not switch direct grants off on ${clientId}`,
    );
    console.log(`    + client   ${clientId}: direct grants off`);
    changed += 1;
  }

  // ---- what the token endpoint now says --------------------------------------
  console.log('');
  const results = await Promise.all(['web', 'admin-cli'].map(probe));
  for (const r of results) {
    console.log(`    ${r.refused ? '=' : '!'} grant    ${r.clientId}: ${r.status} ${r.said}${r.refused ? '' : '  <- reached the password check'}`);
  }

  console.log(`\n  ${changed} changed, ${present} already in place, ${drifted} reported.\n`);
  if (results.some((r) => !r.refused)) process.exitCode = 1;
  else if (drifted > 0) process.exitCode = 2;
}

main().catch((err) => die(err.message));
