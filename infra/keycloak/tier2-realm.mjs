#!/usr/bin/env node
/**
 * Build the TIER 2 SANDBOX REALM, `aobplatform-tier2`, from tier2-realm.json.
 *
 * WHY A SECOND REALM RATHER THAN A SIDE APP (Carl asked; 12 September 2026).
 * Tier 2 is almost entirely Keycloak configuration, so a standalone prototype
 * would skip the only parts with any risk in them: the browser flow itself,
 * how core reads the resulting session, and whether the passkey users already
 * in the realm carry on working. A second realm exercises all three against
 * the real application, because the app already picks its realm from four
 * environment variables (infra/keycloak/README.md, "The tier 2 sandbox realm").
 *
 * IT CANNOT TOUCH THE REALM PEOPLE SIGN IN TO. The realm name is read from the
 * file and checked against a constant below; anything but `aobplatform-tier2`
 * aborts before a single request is made. There is no flag that relaxes this.
 *
 * RE-RUNNABLE BY REBUILDING, not by patching. The sandbox holds nothing
 * precious - its accounts are made by tier2-verify.mjs, which recreates them -
 * so the honest way to make this idempotent is to drop the realm and build it
 * again from the file. Patching flows in place is where a script quietly
 * diverges from the thing it claims to describe, which is the drift that made
 * transform-realm.mjs unsafe to re-run (README).
 *
 *   node infra/keycloak/tier2-realm.mjs            # build it (recreates if present)
 *   node infra/keycloak/tier2-realm.mjs --keep     # only build it if absent
 *   node infra/keycloak/tier2-realm.mjs --delete   # remove it
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * THE ONLY REALM THIS SCRIPT MAY WRITE TO. Not a default, not an override -
 * a constant, compared against the file and against the name it is about to
 * send. Carl signs in to `aobplatform` and is testing all day.
 */
const SANDBOX_REALM = 'aobplatform-tier2';

// 127.0.0.1 for the SERVER call; `localhost` is what the BROWSER follows and
// what the redirect URIs are registered as. Not interchangeable - the note in
// apply-realm-additions.mjs explains why in full.
const BASE = process.env.KEYCLOAK_BASE_URL ?? 'http://127.0.0.1:21024';
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

/**
 * Every request this script makes carries the realm in its path, and every
 * one of them goes through here. `assertSandbox` is called on the path rather
 * than on a variable so that a hand-written path in a later edit cannot slip
 * past the guard at the top of main().
 */
function assertSandbox(path) {
  if (!path.startsWith(`/${SANDBOX_REALM}`) && path !== '') {
    die(`Refusing a request outside the sandbox realm: ${path}`);
  }
}

async function api(token, path, init = {}) {
  assertSandbox(path);
  return fetch(`${BASE}/admin/realms${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

/**
 * Strip the commentary before the representation goes to Keycloak.
 *
 * The file carries `//`-prefixed keys because a realm this consequential
 * should say why it is shaped the way it is where somebody reading it will
 * look - and JSON has no comments. Keycloak's deserialiser is not obliged to
 * ignore keys it does not know, so they come out here rather than being left
 * to chance.
 */
function stripComments(value) {
  if (Array.isArray(value)) return value.map(stripComments);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith('//'))
        .map(([key, v]) => [key, stripComments(v)]),
    );
  }
  return value;
}

async function realmExists(token) {
  const res = await api(token, `/${SANDBOX_REALM}`);
  return res.ok;
}

async function deleteRealm(token) {
  const res = await api(token, `/${SANDBOX_REALM}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) die(`Could not delete ${SANDBOX_REALM}: ${res.status} ${await res.text()}`);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const file = JSON.parse(readFileSync(join(HERE, 'tier2-realm.json'), 'utf8'));

  if (file.realm !== SANDBOX_REALM) {
    die(
      `tier2-realm.json names the realm "${file.realm}". This script only ever builds "${SANDBOX_REALM}". ` +
        'Nothing was sent.',
    );
  }

  const spec = stripComments(file);
  // The extension keys: ours, not Keycloak's. Taken out of the representation
  // and applied by name below, in the order the server needs them.
  const { flowBindings, audienceScope, requireActionsEnabled, ...realm } = spec;

  const token = await adminToken();
  console.log(`\n  Keycloak ${BASE}\n  Sandbox realm ${SANDBOX_REALM}\n`);

  if (args.has('--delete')) {
    await deleteRealm(token);
    console.log(`    - realm ${SANDBOX_REALM} deleted\n`);
    return;
  }

  const existed = await realmExists(token);
  if (existed && args.has('--keep')) {
    console.log('    = realm already exists; --keep, so nothing was changed\n');
    return;
  }
  if (existed) {
    await deleteRealm(token);
    console.log('    - existing sandbox realm dropped (it is rebuilt from the file, never patched)');
  }

  const created = await fetch(`${BASE}/admin/realms`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(realm),
  });
  if (!created.ok) die(`Could not create ${SANDBOX_REALM}: ${created.status} ${await created.text()}`);
  console.log(`    + realm    ${SANDBOX_REALM}`);
  console.log(`    + flows    ${(realm.authenticationFlows ?? []).map((f) => f.alias).filter((a) => !a.includes(' ')).join(', ')}`);
  console.log(`    + clients  ${(realm.clients ?? []).map((c) => c.clientId).join(', ')}`);

  /*
   * THE AUDIENCE SCOPE, after the realm exists.
   *
   * It maps `aud` onto the three backend services, and core refuses a token
   * that does not name it (apps/core/src/auth/auth.guard.ts). It is created
   * here rather than in the realm representation because listing client
   * scopes there REPLACES the built-ins instead of adding to them, and the
   * tokens would silently lose preferred_username and realm_access.
   */
  const scopeRes = await api(token, `/${SANDBOX_REALM}/client-scopes`, {
    method: 'POST',
    body: JSON.stringify(audienceScope),
  });
  if (!scopeRes.ok && scopeRes.status !== 409) {
    die(`Could not create the ${audienceScope.name} scope: ${scopeRes.status} ${await scopeRes.text()}`);
  }
  const scopes = await (await api(token, `/${SANDBOX_REALM}/client-scopes`)).json();
  const audience = scopes.find((s) => s.name === audienceScope.name);
  if (!audience) die(`The ${audienceScope.name} scope was created but could not be read back.`);
  console.log(`    + scope    ${audienceScope.name}`);

  const clients = await (await api(token, `/${SANDBOX_REALM}/clients`)).json();
  const byClientId = new Map(clients.map((c) => [c.clientId, c]));

  for (const clientId of (realm.clients ?? []).map((c) => c.clientId)) {
    const client = byClientId.get(clientId);
    if (!client) die(`Client ${clientId} was created but could not be read back.`);
    const attach = await api(token, `/${SANDBOX_REALM}/clients/${client.id}/default-client-scopes/${audience.id}`, {
      method: 'PUT',
    });
    if (!attach.ok) die(`Could not attach ${audienceScope.name} to ${clientId}: ${attach.status}`);
  }
  console.log(`    = scope attached to ${(realm.clients ?? []).length} clients`);

  /*
   * PER-CLIENT BROWSER FLOW BINDINGS, resolved by alias to id.
   *
   * The realm-level binding already covers every client including Keycloak's
   * own - that is the lesson from the account console asking a passkey-only
   * user for a password. These overrides are the second half of the operator
   * distinction: `console` is bound to a flow with no password execution at
   * all, so an operator arriving there meets the same bar even if the role
   * gate in practice-browser were ever loosened.
   */
  const flows = await (await api(token, `/${SANDBOX_REALM}/authentication/flows`)).json();
  const flowIdByAlias = new Map(flows.map((f) => [f.alias, f.id]));
  for (const [clientId, alias] of Object.entries(flowBindings ?? {})) {
    const client = byClientId.get(clientId);
    const flowId = flowIdByAlias.get(alias);
    if (!client) die(`flowBindings names client ${clientId}, which the realm does not have.`);
    if (!flowId) die(`flowBindings names flow "${alias}", which the realm does not have.`);
    const current = await (await api(token, `/${SANDBOX_REALM}/clients/${client.id}`)).json();
    const res = await api(token, `/${SANDBOX_REALM}/clients/${client.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...current, authenticationFlowBindingOverrides: { browser: flowId } }),
    });
    if (!res.ok) die(`Could not bind ${clientId} to ${alias}: ${res.status} ${await res.text()}`);
    console.log(`    = ${clientId} -> ${alias}`);
  }

  /*
   * REQUIRED ACTIONS. Registered by Keycloak (the representation deliberately
   * omits the field so every built-in is registered), enabled here.
   *
   * CONFIGURE_TOTP and UPDATE_PASSWORD are the pair that make enrolment one
   * pass: an invited account is created holding both, sets a password and
   * registers the authenticator app before it reaches anything (AUTH-TIERS.md
   * §4). The two webauthn actions are what keeps tier 3 available in this
   * realm - a passkey is never removed (AUTH-TIERS.md §2).
   */
  const actions = await (await api(token, `/${SANDBOX_REALM}/authentication/required-actions`)).json();
  const byAlias = new Map(actions.map((a) => [a.alias, a]));
  for (const alias of requireActionsEnabled ?? []) {
    const action = byAlias.get(alias);
    if (!action) die(`Required action ${alias} is not registered in ${SANDBOX_REALM}.`);
    if (action.enabled) {
      console.log(`    = action   ${alias}`);
      continue;
    }
    const res = await api(token, `/${SANDBOX_REALM}/authentication/required-actions/${encodeURIComponent(alias)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...action, enabled: true }),
    });
    if (!res.ok) die(`Could not enable required action ${alias}: ${res.status}`);
    console.log(`    + action   ${alias}`);
  }

  console.log(`\n  Built. Point the stack at it with the four variables in infra/keycloak/README.md.\n`);
}

main().catch((err) => die(err.stack ?? String(err)));
