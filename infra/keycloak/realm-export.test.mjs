/**
 * Realm-export guard (rule 15 / REQ-VAULT-04). Runs in CI with no Keycloak.
 *
 * Exists because the claim "passkey required, no password fallback" was
 * INHERITED FROM A README AND WAS FALSE: the flow shipped with WebAuthn and
 * Password Form both ALTERNATIVE, so a password would have authenticated a
 * practitioner. Read the config, don't trust the prose — this file is that
 * rule, mechanised.
 *
 *   node infra/keycloak/realm-export.test.mjs
 */
import { readFileSync } from 'node:fs';

const realm = JSON.parse(readFileSync(new URL('./realm-export.json', import.meta.url), 'utf8'));
const failures = [];
const check = (label, condition) => {
  if (!condition) failures.push(label);
};

check('realm is aobplatform', realm.realm === 'aobplatform');

// Rule 15: the clinician flow must REQUIRE a passkey and must not accept a password.
const credential = (realm.authenticationFlows ?? []).find((f) => f.alias === 'clinician-browser Credential');
check('clinician-browser Credential subflow exists', Boolean(credential));
const executions = credential?.authenticationExecutions ?? [];
const passkey = executions.find((e) => e.authenticator === 'webauthn-authenticator-passwordless');
const password = executions.find(
  (e) => e.authenticator === 'auth-username-password-form' || e.authenticator === 'auth-password-form',
);
check('rule 15: passkey execution is REQUIRED', passkey?.requirement === 'REQUIRED');
check('rule 15: no enabled password form in the clinician flow', !password || password.requirement === 'DISABLED');

// The staff-facing client must be bound to that flow, or the policy is decorative.
const web = (realm.clients ?? []).find((c) => c.clientId === 'web');
check('web client exists', Boolean(web));
check('web client is public (PKCE, no shipped secret)', web?.publicClient === true);
check('web client binds the clinician browser flow', Boolean(web?.authenticationFlowBindingOverrides?.browser));

// WebAuthn policy present at realm level.
check('WebAuthn passwordless policy configured', Boolean(realm.webAuthnPolicyPasswordlessRpEntityName));

// No social/broker identity providers — a deliberate absence given AoB phishing exposure.
check('no identity-provider brokers', (realm.identityProviders ?? []).length === 0);

if (failures.length > 0) {
  console.error('Realm export FAILED:\n' + failures.map((f) => `  ✗ ${f}`).join('\n'));
  process.exit(1);
}
console.log(`Realm export OK — ${realm.realm}: passkey REQUIRED, password form disabled, ${realm.clients.length} clients.`);
