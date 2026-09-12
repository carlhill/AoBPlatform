/**
 * HOW A SESSION AUTHENTICATED, and whether that was recently enough.
 *
 * Tier 2 is the weaker tier, and AUTH-TIERS.md §5 lists what it must carry to
 * earn its place. The first item is this one: "Record how each session
 * authenticated. Password-and-code, tenant SSO with the methods it asserted,
 * or passkey. **An audit must be able to tell them apart.**"
 *
 * It lives in the domain rather than in the token library because two
 * different things read it — core, which enforces, and the console, which
 * shows it — and because a rule with one implementation cannot drift between
 * them. `@aobplatform/auth-client` deliberately depends on nothing of ours, so
 * it carries the raw claim and this interprets it.
 *
 * THE VALUES ON THE WIRE ARE RFC 8176's, NOT OURS. Keycloak emits `pwd`,
 * `otp`, `hwk` and the rest because that is what the standard says an `amr`
 * claim contains, and inventing our own would have made the realm's
 * configuration non-standard for no gain. The product vocabulary — the words
 * that belong in an audit line a human reads — is derived here.
 */

/** What a session was authenticated with, in the product's own words. */
export type SessionAuthMethod =
  /** Tier 2: a username, a password and a one-time code (AUTH-TIERS.md §2). */
  | 'password+otp'
  /** Tier 3: a WebAuthn passkey. The strongest, and never required. */
  | 'passkey'
  /** Tier 1: the practice's own tenant asserted it. Not built yet; the value exists so a later token is not "unknown". */
  | 'federated'
  /**
   * A PASSWORD AND NOTHING ELSE. No flow in this product produces it, which
   * is exactly why it is named: a session that reports this is a
   * misconfiguration, and an audit that cannot say the word cannot report it.
   */
  | 'password-only'
  /** No `amr` claim, or nothing in it we recognise. Never treated as sufficient for anything. */
  | 'unknown';

/** RFC 8176 values this product knows how to read. */
const PASSWORD = 'pwd';
const ONE_TIME_CODE = 'otp';
/** `hwk` is a hardware key and `swk` a software one; a passkey may be either, and the distinction is the authenticator's, not ours. */
const PASSKEY = ['hwk', 'swk'];
/** What a federated tenant asserts when it has done the whole job itself. */
const FEDERATED = ['fed', 'mfa'];

/**
 * Read the token's `amr` claim as a product answer.
 *
 * ORDER MATTERS, and it is strongest-first. A session that presented a passkey
 * AND a password is a passkey session: the weaker factor adds nothing and
 * calling it "password+otp" would understate what was proved.
 */
export function authMethodFromAmr(amr: readonly string[] | null | undefined): SessionAuthMethod {
  const methods = (amr ?? []).map((m) => String(m).toLowerCase());
  if (methods.some((m) => PASSKEY.includes(m))) return 'passkey';
  if (methods.includes(PASSWORD) && methods.includes(ONE_TIME_CODE)) return 'password+otp';
  if (methods.some((m) => FEDERATED.includes(m))) return 'federated';
  if (methods.includes(PASSWORD)) return 'password-only';
  return 'unknown';
}

/** Whether the session presented something beyond a password. */
export function carriesSecondFactor(method: SessionAuthMethod): boolean {
  return method === 'password+otp' || method === 'passkey' || method === 'federated';
}

/**
 * HOW FRESH A SECOND FACTOR HAS TO BE FOR A HIGH-STAKES ACT (AUTH-TIERS.md
 * §5.2), in seconds.
 *
 * Five minutes, and the number is a judgement rather than a standard: long
 * enough that somebody who has just signed in to do the thing is not asked
 * twice in a row, short enough that a terminal left unlocked and walked away
 * from is not still able to revoke a device an hour later. The shared clinical
 * terminal is the whole reason tier 2 exists (AUTH-TIERS.md §1), so the
 * unattended-machine case is the one this number is set for.
 */
export const SECOND_FACTOR_MAX_AGE_SECONDS = 300;

/** Why a high-stakes act was refused — the code, not the sentence. */
export type StepUpRefusal = 'reauthentication_required' | 'second_factor_required';

/** The answer to "may this session do the irreversible thing", and why not. */
export interface StepUpDecision {
  readonly allowed: boolean;
  /** Absent when allowed. A code, so the surface can map it to copy and a destination (CLAUDE.md §7). */
  readonly reason?: StepUpRefusal;
  /** How old the authentication was, in seconds, when it was judged. Undefined when the session never said. */
  readonly ageSeconds?: number;
}

/**
 * May this session perform a high-stakes act?
 *
 * TWO QUESTIONS, NOT ONE, and they fail differently on purpose.
 *
 * `second_factor_required` means the session never presented a second factor
 * at all — a password-only session, which no flow in this product produces,
 * or an unreadable one. Re-authenticating will not help until the account has
 * a second factor to present, so the answer is a different sentence and a
 * different destination.
 *
 * `reauthentication_required` means the session is fine but old. That one IS
 * fixed by signing in again, which is what the surface offers.
 *
 * `authTimeSeconds` is the OIDC `auth_time` claim: when the person last
 * actually authenticated, which is NOT when the token was issued. A token
 * refreshed silently every five minutes keeps its original `auth_time`, so
 * this cannot be defeated by a refresh — which is the whole reason the check
 * is on `auth_time` and not on `iat`.
 */
export function mayPerformHighStakesAct(input: {
  method: SessionAuthMethod;
  authTimeSeconds?: number | null;
  nowSeconds: number;
  maxAgeSeconds?: number;
}): StepUpDecision {
  if (!carriesSecondFactor(input.method)) return { allowed: false, reason: 'second_factor_required' };
  const maxAge = input.maxAgeSeconds ?? SECOND_FACTOR_MAX_AGE_SECONDS;
  if (typeof input.authTimeSeconds !== 'number' || !Number.isFinite(input.authTimeSeconds)) {
    /*
     * NO auth_time IS A REFUSAL, not a pass. A session that cannot say when it
     * authenticated cannot be shown to have authenticated recently, and the
     * safe reading of "we do not know" is "not recently enough". The fix is
     * the same as for a stale one, so it gets the same code.
     */
    return { allowed: false, reason: 'reauthentication_required' };
  }
  const ageSeconds = input.nowSeconds - input.authTimeSeconds;
  /*
   * A NEGATIVE AGE IS CLOCK SKEW, not a session from the future. Refusing it
   * would lock somebody out for a machine's clock being a second fast, so it
   * is treated as fresh - the token's signature and expiry are what actually
   * defend the boundary, and this is a recency judgement on top of them.
   */
  if (ageSeconds > maxAge) return { allowed: false, reason: 'reauthentication_required', ageSeconds };
  return { allowed: true, ageSeconds };
}
