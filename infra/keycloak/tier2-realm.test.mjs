/**
 * Sandbox-realm guard — the tier 2 twin of `realm-export.test.mjs`.
 *
 * A SEPARATE FILE, deliberately, and it never reads `realm-export.json`. The
 * main guard exists to stop rule 15 quietly becoming false in the realm people
 * sign in to; this one exists to stop the SANDBOX quietly becoming a second
 * copy of it — or, far worse, to stop `tier2-realm.json` ever naming the main
 * realm and being applied to it. One file, one realm, one guard each.
 *
 * Runs with no Keycloak, so it works in CI.
 *
 *   node infra/keycloak/tier2-realm.test.mjs
 */
import { readFileSync } from 'node:fs';

const realm = JSON.parse(readFileSync(new URL('./tier2-realm.json', import.meta.url), 'utf8'));
const main = JSON.parse(readFileSync(new URL('./realm-export.json', import.meta.url), 'utf8'));

const failures = [];
const check = (label, condition) => {
  if (!condition) failures.push(label);
};

/*
 * THE ONE THAT MATTERS MOST. Carl signs in with `aobplatform` and is testing
 * all day. tier2-realm.mjs also refuses at run time, but a file that named the
 * wrong realm would be a live hazard sitting in the repo waiting for somebody
 * to point a different script at it.
 */
check('the sandbox is aobplatform-tier2', realm.realm === 'aobplatform-tier2');
check('the sandbox is not the realm anybody signs in to', realm.realm !== main.realm);

const flows = new Map((realm.authenticationFlows ?? []).map((f) => [f.alias, f]));
const executionsOf = (alias) => flows.get(alias)?.authenticationExecutions ?? [];
const configs = new Map((realm.authenticatorConfig ?? []).map((c) => [c.alias, c.config ?? {}]));

// ---- tier 2: a password AND a code, every sign-in (AUTH-TIERS.md §4) -------

const passwordOtp = executionsOf('practice-browser Password+OTP');
const password = passwordOtp.find((e) => e.authenticator === 'auth-password-form');
const otp = passwordOtp.find((e) => e.authenticator === 'auth-otp-form');
check('tier 2: the password form is REQUIRED', password?.requirement === 'REQUIRED');
check('tier 2: the one-time code form is REQUIRED', otp?.requirement === 'REQUIRED');
/*
 * NOT CONDITIONAL, and this is the whole difference between tier 2 and a
 * realm that merely permits a second factor. `conditional-user-configured`
 * wrapped around the OTP form means "a code if you happen to have set one
 * up", which is what Keycloak's stock browser flow does and what AUTH-TIERS
 * §4 explicitly is not.
 */
check(
  'tier 2: the code is not made optional by a conditional-user-configured',
  !passwordOtp.some((e) => e.authenticator === 'conditional-user-configured'),
);

// ---- tier 3 coexists: never removed, never required (AUTH-TIERS.md §2) -----

const practiceCredential = executionsOf('practice-browser Practice Credential');
const practicePasskey = practiceCredential.find((e) => e.authenticator === 'webauthn-authenticator-passwordless');
check('tier 3: a passkey is offered to practice people', practicePasskey?.requirement === 'ALTERNATIVE');
check(
  'tier 3: the password-and-code path is the alternative to it, not a replacement for it',
  practiceCredential.some((e) => e.flowAlias === 'practice-browser Password+OTP' && e.requirement === 'ALTERNATIVE'),
);

// ---- platform operators keep passkeys (D-2026-09-12-11) --------------------

const operator = executionsOf('practice-browser Operator');
const operatorGate = operator.find((e) => e.authenticator === 'conditional-user-role');
const operatorPasskey = operator.find((e) => e.authenticator === 'webauthn-authenticator-passwordless');
check('operators: the practice flow gates on the platform_admin role', Boolean(operatorGate));
check(
  'operators: the gate names platform_admin and is not negated',
  configs.get(operatorGate?.authenticatorConfig)?.condUserRole === 'platform_admin' &&
    configs.get(operatorGate?.authenticatorConfig)?.negate === 'false',
);
check('operators: a passkey is REQUIRED of them', operatorPasskey?.requirement === 'REQUIRED');
check(
  'operators: no password form anywhere in their subflow',
  !operator.some((e) => e.authenticator === 'auth-password-form'),
);
/*
 * The mirror condition. Two conditionals on opposite sides of one role check
 * is what makes exactly one of them run; without the negation an operator
 * would meet the passkey AND then the password form.
 */
const practiceGate = executionsOf('practice-browser Practice').find((e) => e.authenticator === 'conditional-user-role');
check(
  'the practice subflow is gated on NOT being a platform operator',
  configs.get(practiceGate?.authenticatorConfig)?.condUserRole === 'platform_admin' &&
    configs.get(practiceGate?.authenticatorConfig)?.negate === 'true',
);

const operatorCredential = executionsOf('operator-browser Credential');
const consolePasskey = operatorCredential.find((e) => e.authenticator === 'webauthn-authenticator-passwordless');
const consolePassword = operatorCredential.find((e) => e.authenticator === 'auth-password-form');
check('the operator console flow REQUIRES a passkey', consolePasskey?.requirement === 'REQUIRED');
check('the operator console flow DISABLES the password form', consolePassword?.requirement === 'DISABLED');
check('the operator console client is bound to that flow', realm.flowBindings?.console === 'operator-browser');
check('the practice client is bound to the tier 2 flow', realm.flowBindings?.web === 'practice-browser');
check('the realm default browser flow is the tier 2 flow', realm.browserFlow === 'practice-browser');

// ---- the session must be able to say how it authenticated (§5.1) -----------

for (const [alias, expected] of [
  ['tier2-amr-password', 'pwd'],
  ['tier2-amr-otp', 'otp'],
  ['tier2-amr-passkey-practice', 'hwk'],
  ['tier2-amr-passkey-operator', 'hwk'],
  ['tier2-amr-passkey-console', 'hwk'],
]) {
  check(`amr: ${alias} declares ${expected}`, configs.get(alias)?.['default.reference.value'] === expected);
}
check('the password execution carries its amr config', password?.authenticatorConfig === 'tier2-amr-password');
check('the code execution carries its amr config', otp?.authenticatorConfig === 'tier2-amr-otp');
check('the practice passkey execution carries its amr config', practicePasskey?.authenticatorConfig === 'tier2-amr-passkey-practice');

/*
 * A CONFIG WITH NO EXECUTION IS DEAD, AND SO IS AN EXECUTION WITH A MISSING
 * CONFIG. The second is the dangerous one: the flow still works, the sign-in
 * still succeeds, and the token silently stops saying how — which is the one
 * thing tier 2 has to carry (AUTH-TIERS.md §5.1).
 */
const referenced = new Set(
  [...flows.values()].flatMap((f) => (f.authenticationExecutions ?? []).map((e) => e.authenticatorConfig).filter(Boolean)),
);
for (const alias of configs.keys()) check(`authenticatorConfig ${alias} is used by an execution`, referenced.has(alias));
for (const alias of referenced) check(`execution config ${alias} is defined`, configs.has(alias));

const amrMappers = (realm.clients ?? [])
  .filter((c) => c.publicClient)
  .map((c) => ({ clientId: c.clientId, has: (c.protocolMappers ?? []).some((m) => m.protocolMapper === 'oidc-amr-mapper') }));
for (const { clientId, has } of amrMappers) check(`client ${clientId} maps amr into its tokens`, has);

// ---- a password policy, and length over complexity theatre (§5.5) ----------

check('a password policy is set', typeof realm.passwordPolicy === 'string' && realm.passwordPolicy.length > 0);
check('the policy asks for length', /length\(1[2-9]|length\([2-9]\d/.test(realm.passwordPolicy ?? ''));
check('the policy refuses the username and the email as a password', /notUsername/.test(realm.passwordPolicy ?? '') && /notEmail/.test(realm.passwordPolicy ?? ''));
/*
 * NO CHARACTER-CLASS RULES. They push people towards Passw0rd! and buy
 * nothing an offline attacker cares about that length does not buy more of.
 * Asserted so that "add a special character" cannot be slipped in as a
 * tightening — it is a loosening dressed as one.
 */
check(
  'the policy does not impose complexity theatre',
  !/(specialChars|upperCase|lowerCase|digits)\(/.test(realm.passwordPolicy ?? ''),
);

// ---- plain TOTP, no vendor, no fee (AUTH-TIERS.md §4) ----------------------

check('one-time codes are plain TOTP', realm.otpPolicyType === 'totp');
check('a code cannot be used twice', realm.otpPolicyCodeReusable === false);
check('six digits over thirty seconds', realm.otpPolicyDigits === 6 && realm.otpPolicyPeriod === 30);

// ---- the sandbox differs from the main realm ONLY where it means to --------

check('session idle timeout matches the main realm', realm.ssoSessionIdleTimeout === main.ssoSessionIdleTimeout);
check('session maximum lifespan matches the main realm', realm.ssoSessionMaxLifespan === main.ssoSessionMaxLifespan);
check('access token lifespan matches the main realm', realm.accessTokenLifespan === main.accessTokenLifespan);
check('user verification is still required for passkeys', realm.webAuthnPolicyUserVerificationRequirement === 'required');
check(
  'passwordless user verification is still required',
  realm.webAuthnPolicyPasswordlessUserVerificationRequirement === 'required',
);
check('duplicate emails are allowed, as in the main realm', realm.duplicateEmailsAllowed === true);
check('email is not a way to sign in, as in the main realm', realm.loginWithEmailAllowed === false);

/*
 * SAME CLIENTS, SAME REDIRECT URIS. This is what lets the application run
 * against the sandbox by changing four environment variables and no code
 * (infra/keycloak/README.md). A drifted redirect URI turns that into a
 * `400 Invalid redirect uri` that names nothing.
 */
for (const clientId of ['web', 'console', 'core-service', 'rules-service', 'vault-service']) {
  const here = (realm.clients ?? []).find((c) => c.clientId === clientId);
  const there = (main.clients ?? []).find((c) => c.clientId === clientId);
  check(`client ${clientId} exists in the sandbox`, Boolean(here));
  if (here && there?.redirectUris) {
    check(
      `client ${clientId} keeps the main realm's redirect URIs`,
      JSON.stringify([...(here.redirectUris ?? [])].sort()) === JSON.stringify([...there.redirectUris].sort()),
    );
  }
}

const mainRoles = new Set((main.roles?.realm ?? []).map((r) => r.name));
for (const role of mainRoles) {
  check(`realm role ${role} exists in the sandbox`, (realm.roles?.realm ?? []).some((r) => r.name === role));
}

// ---- rule 12: never "certified", "approved", "accredited" ------------------

/*
 * ALL FOUR WORDS. Bare "approved" was missing from the first version of this
 * pattern, and it is the half of rule 12 most likely to be written by
 * accident — "your device has been approved" reads as ordinary product copy.
 * "approve" and "approves" are untouched: the platform_admin role description
 * says operators "approve practices", which is what they do.
 */
const forbidden = /\b(certified|approved|accredited|government-approved)\b/i;
const text = JSON.stringify(realm);
check('no rule-12 word anywhere in the realm file', !forbidden.test(text));

if (failures.length) {
  console.error(`\n  tier2-realm.json FAILED ${failures.length} check(s):\n`);
  for (const failure of failures) console.error(`    - ${failure}`);
  console.error('');
  process.exit(1);
}
console.log('  tier2-realm.json: all checks passed');
