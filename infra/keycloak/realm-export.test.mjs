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

/*
 * Themes must be IN THE EXPORT, not only in the running realm.
 *
 * Both were once set through the admin console and lived only in the database,
 * so a container rebuild re-imported this file, the realm came back looking
 * healthy, and the themes were silently the built-in ones again. The login
 * theme is what tells somebody enrolling on Windows not to accept Microsoft
 * Password Manager — the default that enrols successfully and then cannot sign
 * in (CRITICAL-ISSUES.md item 2). Losing it silently is how that incident
 * repeats.
 */
check('login theme is the aobplatform theme', realm.loginTheme === 'aobplatform');
check('email theme is the aobplatform theme', realm.emailTheme === 'aobplatform');

/*
 * ONE PERSON, ONE ADDRESS, SEVERAL ACCOUNTS — and therefore no email login
 * (Carl, 12 Sep 2026; PRACTICE-SCOPED-LOGIN.md §4, D-2026-09-12-10).
 *
 * A practitioner working at three practices holds three accounts, named
 * `<their email>.<practice code>`, and all three carry the SAME email: their
 * own. The realm shipped with `duplicateEmailsAllowed: false`, so Keycloak
 * refused the second one.
 *
 * The two settings are mutually exclusive by construction — duplicates cannot
 * be allowed while email is also a way to sign in, because "which account is
 * jsmith@outlook.com" would then have three answers — so both are asserted
 * here, together, as one rule.
 *
 * THIS IS RULE 15 BEING KEPT, NOT WEAKENED. A passkey is bound to an account
 * and nobody types an identifier at all: the browser offers the credentials it
 * holds and the person picks one. Email-as-login exists to serve a
 * username-and-password flow this product does not have, and switching it off
 * removes a route that should never have been reachable.
 *
 * IN THE EXPORT, not only on the running realm — the same lesson as the themes
 * above. Both were once set through the admin console, lived only in the
 * database, and came back as the defaults on the next container rebuild.
 */
check('duplicate emails are allowed (one person, one address, an account per practice)', realm.duplicateEmailsAllowed === true);
check('the_realm_never_offers_email_as_a_way_to_sign_in', realm.loginWithEmailAllowed === false);

// No social/broker identity providers — a deliberate absence given AoB phishing exposure.
check('no identity-provider brokers', (realm.identityProviders ?? []).length === 0);

if (failures.length > 0) {
  console.error('Realm export FAILED:\n' + failures.map((f) => `  ✗ ${f}`).join('\n'));
  process.exit(1);
}
console.log(`Realm export OK — ${realm.realm}: passkey REQUIRED, password form disabled, ${realm.clients.length} clients.`);
