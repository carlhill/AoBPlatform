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

// Inherited SMTP pointed at ReferralPlatform's sender identity. Local dev
// delivers to the Mailhog container either way; the FROM address should still
// say who it is.
if (realm.smtpServer) {
  realm.smtpServer.from = 'noreply@aobplatform.local';
  realm.smtpServer.fromDisplayName = 'AoBPlatform (local dev)';
}

/**
 * Keycloak 24+ ships the declarative user profile with unmanaged attributes
 * DISABLED, which silently drops any attribute the admin API sets — observed
 * 21 Aug 2026: practitioner accounts were created successfully but their
 * `practice_id` vanished. That claim is what replaces the dev x-practice-id
 * header once AUTH_ENFORCE is on, so silently losing it would have surfaced
 * much later as "the guard scopes everyone to nothing".
 *
 * ADMIN_EDIT: attributes are settable through the admin API (our onboarding
 * path) but NOT self-editable by the account holder — a practitioner must not
 * be able to move themselves to another practice.
 */
realm.components = realm.components ?? {};
realm.components['org.keycloak.userprofile.UserProfileProvider'] = [
  {
    providerId: 'declarative-user-profile',
    subComponents: {},
    config: { 'kc.user.profile.config': [JSON.stringify({
      attributes: [
        { name: 'username', displayName: '${username}', permissions: { view: ['admin', 'user'], edit: ['admin'] } },
        { name: 'email', displayName: '${email}', permissions: { view: ['admin', 'user'], edit: ['admin'] } },
        { name: 'firstName', displayName: '${firstName}', permissions: { view: ['admin', 'user'], edit: ['admin'] } },
        { name: 'lastName', displayName: '${lastName}', permissions: { view: ['admin', 'user'], edit: ['admin'] } },
      ],
      unmanagedAttributePolicy: 'ADMIN_EDIT',
    })] },
  },
];

// Roles — the AoB cast (CLAUDE.md §3 terminology: provider, not GP).
//
// `platform_operator` is the odd one out and deliberately so: it is US, not a
// practice. It holds exactly one power — approving or rejecting an
// organisation's application to join the platform. That decision cannot belong
// to a practice role, because the whole point of the human validation queue is
// that somebody outside the applicant vouches for them. It is granted to
// Hills Empire staff and to nobody else, and it carries no practice scope, so
// it can read no patient data, no agreements and no evidence.
const roleNames = [
  'provider',
  'practice_principal',
  'practice_manager',
  'front_desk',
  'patient',
  'assignor',
  'system',
  'platform_operator',
];
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
/*
 * BOTH LOCAL SPELLINGS, because they are the same machine and different
 * origins. A browser on 127.0.0.1 asks for a redirect_uri on 127.0.0.1, and an
 * unregistered one is refused by Keycloak with "Invalid parameter:
 * redirect_uri" -- while DEV-LOOP.md sends people to 127.0.0.1 for every
 * service. Registering only one spelling made the documented address a dead
 * end. The ISSUER is deliberately NOT duplicated: the browser reaches Keycloak
 * on localhost either way, and `iss` is compared as a string
 * (CRITICAL-ISSUES.md section 4).
 *
 * Dev addresses only. A deployed environment registers its own hostname and
 * neither of these is present in it.
 */
web.redirectUris = [
  'http://localhost:3100/*',
  'http://localhost:21100/*',
  'http://127.0.0.1:3100/*',
  'http://127.0.0.1:21100/*',
];
web.webOrigins = [
  'http://localhost:3100',
  'http://localhost:21100',
  'http://127.0.0.1:3100',
  'http://127.0.0.1:21100',
];
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
