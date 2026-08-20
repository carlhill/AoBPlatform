/**
 * One-off generator: adapts ReferralPlatform's proven realm export (WebAuthn
 * policies, passkey-mandatory clinician flow, PKCE public client shape) into
 * the aobplatform realm. Re-run only to regenerate realm-export.json:
 *   node infra/keycloak/transform-realm.mjs
 * Flow aliases are kept verbatim ('clinician-browser' = the passkey-REQUIRED
 * flow) so internal subflow references stay intact; in this realm it is bound
 * to the practice console — rule 15: practitioner and admin auth is WebAuthn
 * passkeys, no password-only paths.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'C:/Users/carl/OneDrive/Documents/2026/ReferralPlatform/infra/keycloak/realm-export.json';
const TARGET = new URL('./realm-export.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const realm = JSON.parse(readFileSync(SOURCE, 'utf8'));

realm.realm = 'aobplatform';
realm.displayName = 'AoBPlatform';
realm.webAuthnPolicyRpEntityName = 'AoBPlatform';
realm.webAuthnPolicyPasswordlessRpEntityName = 'AoBPlatform';

// Roles — the AoB cast (CLAUDE.md §3 terminology: provider, not GP).
const roleNames = ['provider', 'practice_principal', 'practice_manager', 'front_desk', 'patient', 'assignor', 'system'];
realm.roles = {
  realm: roleNames.map((name) => ({ name, composite: false, clientRole: false, containerId: 'aobplatform' })),
  client: {},
};
delete realm.defaultRole;

// No social/broker providers in this realm (stronger reasons here — AoB
// phishing exposure; revisit deliberately, never by default).
realm.identityProviders = [];
realm.identityProviderMappers = [];
realm.authenticationFlows = (realm.authenticationFlows ?? []).filter((f) => f.alias !== 'social-linking-only');

// Clients: clone the proven shapes.
const publicTemplate = realm.clients.find((c) => c.clientId === 'gp-portal');
const serviceTemplate = realm.clients.find((c) => c.clientId === 'identity-access-service');
if (!publicTemplate || !serviceTemplate) throw new Error('Template clients not found in source realm.');

const web = structuredClone(publicTemplate);
web.clientId = 'web';
web.name = 'Practice console / portal / tester (Next.js)';
web.redirectUris = ['http://localhost:3100/*', 'http://localhost:21100/*'];
web.webOrigins = ['http://localhost:3100', 'http://localhost:21100'];
// Binding override stays on the passkey-REQUIRED flow — staff surface, rule 15.

const serviceClient = (clientId, name) => {
  const client = structuredClone(serviceTemplate);
  client.clientId = clientId;
  client.name = name;
  client.secret = 'change-me-in-local-env';
  return client;
};

realm.clients = [
  web,
  serviceClient('core-service', 'Core application (service account)'),
  serviceClient('rules-service', 'Rules & Conformance service (service account)'),
  serviceClient('vault-service', 'Evidence Vault service (service account)'),
];

/**
 * RULE 15 ENFORCEMENT — verified, not inherited.
 *
 * ReferralPlatform's README described its clinician flow as "passkey REQUIRED
 * with no password/OTP fallback". Reading the actual executions via the
 * Keycloak admin API (21 Aug 2026) showed otherwise: inside the credential
 * subflow, `WebAuthn Passwordless Authenticator` and `Password Form` were
 * BOTH `ALTERNATIVE` — i.e. a password was an accepted way in. The login page
 * merely *looked* passkey-only because the test user had no password set.
 *
 * CLAUDE.md rule 15 (REQ-VAULT-04) says practitioner and admin auth is
 * WebAuthn passkeys with NO password-only paths. So: passkey becomes
 * REQUIRED and the password form is DISABLED in the clinician flow. With
 * both changes, a password cannot authenticate a practitioner even if one
 * exists on the account.
 */
const clinicianCredential = (realm.authenticationFlows ?? []).find((f) => f.alias === 'clinician-browser Credential');
if (!clinicianCredential) throw new Error('clinician-browser Credential subflow not found — cannot enforce rule 15.');
for (const execution of clinicianCredential.authenticationExecutions ?? []) {
  if (execution.authenticator === 'webauthn-authenticator-passwordless') {
    execution.requirement = 'REQUIRED';
  } else if (execution.authenticator === 'auth-username-password-form' || execution.authenticator === 'auth-password-form') {
    execution.requirement = 'DISABLED';
  }
}
const passkeyExecution = (clinicianCredential.authenticationExecutions ?? []).find(
  (e) => e.authenticator === 'webauthn-authenticator-passwordless',
);
if (passkeyExecution?.requirement !== 'REQUIRED') {
  throw new Error('Rule 15 not enforced: the passkey execution is not REQUIRED in the clinician flow.');
}

// Service-account users and scope mappings reference clients that no longer
// exist — Keycloak refuses to boot on the dangling link. It recreates
// service-account users automatically for serviceAccountsEnabled clients.
delete realm.users;
delete realm.scopeMappings;
delete realm.clientScopeMappings;
delete realm.groups;

writeFileSync(TARGET, JSON.stringify(realm, null, 2));
console.log(`Wrote ${TARGET}: realm=${realm.realm}, clients=${realm.clients.map((c) => c.clientId).join(', ')}`);
console.log(`WebAuthn policies present: ${Boolean(realm.webAuthnPolicyRpEntityName)} / passwordless: ${Boolean(realm.webAuthnPolicyPasswordlessRpEntityName)}`);
console.log(`Flows: ${realm.authenticationFlows.map((f) => f.alias).join(', ')}`);
