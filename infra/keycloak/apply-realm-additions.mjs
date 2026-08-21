#!/usr/bin/env node
/**
 * Apply realm additions to a realm that ALREADY EXISTS.
 *
 * WHY THIS IS NEEDED. `realm-export.json` is imported by `start-dev
 * --import-realm`, which only runs against an empty database. Once the realm
 * exists, editing the export changes nothing — and it changes nothing SILENTLY,
 * which is the dangerous part: the file says the role exists, the realm
 * disagrees, and the first sign of trouble is an account created with no
 * permissions that fails at the moment somebody tries to use it.
 *
 * The alternatives were both worse. Wiping the realm to re-import destroys
 * every enrolled passkey, which for a passkey-only system means locking
 * everybody out to add a role. Hand-clicking the admin console leaves no record
 * and drifts between environments.
 *
 * So: a small idempotent script that reads the export and ensures the roles and
 * clients in it exist. Run it as often as you like.
 *
 * WHAT IT DOES NOT DO. It does not modify or delete anything that already
 * exists. A client whose redirect URIs have drifted is REPORTED, not corrected
 * — silently rewriting an existing client's configuration is how a script
 * intended to add a role ends up changing an authentication flow.
 *
 * Usage:
 *   node infra/keycloak/apply-realm-additions.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
/*
 * 127.0.0.1 for the SERVER call, `localhost` for anything the BROWSER follows.
 *
 * They are not interchangeable and the distinction bites in both directions.
 * Node on Windows resolves `localhost` to ::1 first, where Docker's IPv6
 * forwarding accepts the connection and then fails the handshake — so a
 * server-side fetch to `localhost` dies with a bare "fetch failed".
 *
 * But the redirect URL is validated against the client's REGISTERED redirect
 * URIs, which say `localhost` because that is what a person types. Sending
 * 127.0.0.1 there gets a 400 with no explanation.
 */
const BASE = process.env.KEYCLOAK_BASE_URL ?? 'http://127.0.0.1:21024';
const REALM = process.env.KEYCLOAK_REALM ?? 'aobplatform';
const ADMIN_USER = process.env.KEYCLOAK_ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin';

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function adminToken() {
  const res = await fetch(`${BASE}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: ADMIN_USER,
      password: ADMIN_PASSWORD,
    }),
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

async function main() {
  const exported = JSON.parse(readFileSync(join(HERE, 'realm-export.json'), 'utf8'));
  const token = await adminToken();

  console.log(`\n  Realm ${REALM} at ${BASE}\n`);

  let added = 0;
  let present = 0;

  for (const role of exported.roles?.realm ?? []) {
    const existing = await api(token, `/roles/${encodeURIComponent(role.name)}`);
    if (existing.ok) {
      present += 1;
      continue;
    }
    const created = await api(token, '/roles', {
      method: 'POST',
      body: JSON.stringify({ name: role.name, description: role.description }),
    });
    if (!created.ok && created.status !== 409) {
      die(`Could not create role ${role.name}: ${created.status} ${await created.text()}`);
    }
    console.log(`    + role     ${role.name}`);
    added += 1;
  }

  const clients = await (await api(token, '/clients')).json();
  const byId = new Map((clients ?? []).map((c) => [c.clientId, c]));

  for (const client of exported.clients ?? []) {
    const existing = byId.get(client.clientId);
    if (existing) {
      present += 1;
      /*
       * Reported, never corrected. A script written to add a role must not
       * quietly rewrite an existing client's redirect URIs or — far worse —
       * its authentication flow binding, which is what makes the passkey
       * mandatory.
       */
      const drifted = [];
      for (const uri of client.redirectUris ?? []) {
        if (!(existing.redirectUris ?? []).includes(uri)) drifted.push(uri);
      }
      if (drifted.length > 0) {
        console.log(`    ! client   ${client.clientId} exists, and the export has redirect URIs it lacks:`);
        for (const uri of drifted) console.log(`                 ${uri}`);
      }
      continue;
    }

    const created = await api(token, '/clients', { method: 'POST', body: JSON.stringify(client) });
    if (!created.ok && created.status !== 409) {
      die(`Could not create client ${client.clientId}: ${created.status} ${await created.text()}`);
    }
    console.log(`    + client   ${client.clientId}`);
    added += 1;
  }

  console.log(`\n  ${added} added, ${present} already present.\n`);

  if (added === 0) {
    console.log('  Nothing to do — the realm already matches the export.\n');
  } else {
    console.log('  Note what this did NOT do: it created what was missing and changed nothing that');
    console.log('  existed. If a client needs different settings, change it deliberately.\n');
  }
}

main().catch((err) => die(err.message));
