import {
  SECOND_FACTOR_MAX_AGE_SECONDS,
  authMethodFromAmr,
  carriesSecondFactor,
  mayPerformHighStakesAct,
} from './auth-method';

const NOW = 1_789_200_000;

describe('a_session_records_how_it_authenticated', () => {
  /*
   * THE VALUES ARE THE ONES THE SANDBOX REALM ACTUALLY EMITS, read off a real
   * token by infra/keycloak/tier2-verify.mjs and tier2-verify-passkey.mjs on
   * 12 Sep 2026 rather than taken from the specification. A test written
   * against what the standard says would still pass if the realm's
   * authenticator configs were deleted.
   */
  it('a_session_records_how_it_authenticated', () => {
    expect(authMethodFromAmr(['pwd', 'otp'])).toBe('password+otp');
    expect(authMethodFromAmr(['hwk'])).toBe('passkey');
  });

  it('tells a passkey session apart from a password-and-code one', () => {
    expect(authMethodFromAmr(['hwk'])).not.toBe(authMethodFromAmr(['pwd', 'otp']));
  });

  it('reads a software passkey the same as a hardware one', () => {
    expect(authMethodFromAmr(['swk'])).toBe('passkey');
  });

  it('calls the strongest thing presented, not the weakest', () => {
    expect(authMethodFromAmr(['pwd', 'hwk'])).toBe('passkey');
  });

  it('names a password-only session rather than hiding it as unknown', () => {
    // No flow in this product produces one. An audit that cannot say the word
    // cannot report the misconfiguration.
    expect(authMethodFromAmr(['pwd'])).toBe('password-only');
  });

  it('is unknown when the token said nothing, and unknown is never sufficient', () => {
    expect(authMethodFromAmr(undefined)).toBe('unknown');
    expect(authMethodFromAmr([])).toBe('unknown');
    expect(carriesSecondFactor('unknown')).toBe(false);
    expect(carriesSecondFactor('password-only')).toBe(false);
  });

  it('is case-insensitive, because the claim is a string from somebody else', () => {
    expect(authMethodFromAmr(['PWD', 'OTP'])).toBe('password+otp');
  });
});

describe('a_high_stakes_act_asks_for_the_second_factor_again', () => {
  const fresh = { method: 'password+otp' as const, authTimeSeconds: NOW - 10, nowSeconds: NOW };

  it('a_high_stakes_act_asks_for_the_second_factor_again', () => {
    const stale = mayPerformHighStakesAct({ ...fresh, authTimeSeconds: NOW - SECOND_FACTOR_MAX_AGE_SECONDS - 1 });
    expect(stale.allowed).toBe(false);
    expect(stale.reason).toBe('reauthentication_required');

    expect(mayPerformHighStakesAct(fresh).allowed).toBe(true);
  });

  it('a passkey session is judged on the same clock as a password-and-code one', () => {
    expect(mayPerformHighStakesAct({ method: 'passkey', authTimeSeconds: NOW - 10, nowSeconds: NOW }).allowed).toBe(true);
    expect(
      mayPerformHighStakesAct({ method: 'passkey', authTimeSeconds: NOW - 3600, nowSeconds: NOW }).reason,
    ).toBe('reauthentication_required');
  });

  it('refuses a session that never presented a second factor, and says which problem it is', () => {
    const decision = mayPerformHighStakesAct({ method: 'password-only', authTimeSeconds: NOW, nowSeconds: NOW });
    expect(decision.allowed).toBe(false);
    // Not `reauthentication_required`: signing in again would produce the same
    // session, so offering that as the fix would be a loop.
    expect(decision.reason).toBe('second_factor_required');
  });

  it('an_unrecorded_sign_in_method_is_refused_and_not_called_a_password', () => {
    /*
     * The main realm issued no amr claim, so a passkey session reached core as
     * "unknown" and was told it had signed in with a password. Still refused -
     * "we cannot tell" is never "yes" - but under its own code, because the
     * password sentence describes a sign-in nobody did.
     */
    const decision = mayPerformHighStakesAct({ method: 'unknown', authTimeSeconds: NOW, nowSeconds: NOW });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('sign_in_method_unrecorded');
    expect(mayPerformHighStakesAct({ method: authMethodFromAmr(undefined), authTimeSeconds: NOW, nowSeconds: NOW }).reason).toBe(
      'sign_in_method_unrecorded',
    );
  });

  it('refuses a session that cannot say when it authenticated', () => {
    expect(mayPerformHighStakesAct({ method: 'password+otp', nowSeconds: NOW }).reason).toBe('reauthentication_required');
    expect(mayPerformHighStakesAct({ method: 'password+otp', authTimeSeconds: null, nowSeconds: NOW }).reason).toBe(
      'reauthentication_required',
    );
  });

  it('is not defeated by a silent token refresh', () => {
    /*
     * The scenario this exists for: a console tab open all afternoon renews
     * its access token every five minutes, so `iat` is always seconds old.
     * `auth_time` does not move, and that is what is judged.
     */
    const signedInThisMorning = NOW - 4 * 60 * 60;
    expect(mayPerformHighStakesAct({ method: 'password+otp', authTimeSeconds: signedInThisMorning, nowSeconds: NOW }).allowed).toBe(
      false,
    );
  });

  it('tolerates a clock a little fast rather than locking somebody out', () => {
    expect(mayPerformHighStakesAct({ method: 'password+otp', authTimeSeconds: NOW + 2, nowSeconds: NOW }).allowed).toBe(true);
  });

  it('accepts a caller-supplied window, so an act may be stricter than the default', () => {
    expect(
      mayPerformHighStakesAct({ method: 'password+otp', authTimeSeconds: NOW - 60, nowSeconds: NOW, maxAgeSeconds: 30 }).reason,
    ).toBe('reauthentication_required');
  });
});
