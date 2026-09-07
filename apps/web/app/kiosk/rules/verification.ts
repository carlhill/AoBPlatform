/**
 * The verification attempt ladder at the tablet, and the one message a failure
 * is ever allowed to carry.
 *
 * GENERIC, ALWAYS. A failed attempt says "some details don't match" and stops.
 * It never names the identifier that failed, never highlights the field, never
 * says "two of three matched" — naming any of that tells whoever is standing
 * there which details they already have right, which is the whole value of a
 * three-identifier challenge (REQ-SEC-07). `mismatchMessage()` is the only
 * failure text on this device and it takes no arguments, so there is nothing
 * for a caller to interpolate a field name into.
 *
 * THREE ATTEMPTS, THEN THE DESK. The design handoff and the build brief both
 * say three, then a staff-assisted unlock. The SERVER's own lockout
 * (`LOCKOUT_AFTER_ATTEMPTS` in apps/core) is five, which is the durable
 * record's threshold; the kiosk hands the patient to a person two attempts
 * earlier because a person is standing right there and a fourth guess at a
 * tablet in a waiting room is worth less than a staff member's thirty seconds.
 * The kiosk is therefore stricter than the server, never looser — the only
 * safe direction for a client-side limit.
 *
 * A LOCKOUT NEVER BLOCKS CARE (REQ-REC-04). It routes to reception and says so.
 */
import { strings } from '../strings';

/** Attempts allowed at the tablet before it hands over to the desk. */
export const KIOSK_MAX_ATTEMPTS = 3;

export type AttemptOutcome = 'passed' | 'failed' | 'locked_out';

export type VerificationState =
  | { readonly kind: 'asking'; readonly attempt: number }
  | { readonly kind: 'mismatch'; readonly attempt: number }
  | { readonly kind: 'locked' }
  | { readonly kind: 'passed'; readonly verificationEventId: string };

export function firstAttempt(): VerificationState {
  return { kind: 'asking', attempt: 1 };
}

/**
 * Advances the ladder. `attemptsUsed` is what the tablet has spent, not what
 * the server has recorded — the server keeps its own count and its own
 * (higher) threshold.
 */
export function afterAttempt(
  previous: VerificationState,
  result: { outcome: AttemptOutcome; verificationEventId?: string },
): VerificationState {
  if (result.outcome === 'passed') {
    return { kind: 'passed', verificationEventId: result.verificationEventId ?? '' };
  }
  if (result.outcome === 'locked_out') return { kind: 'locked' };

  const attemptsUsed = previous.kind === 'asking' || previous.kind === 'mismatch' ? previous.attempt : KIOSK_MAX_ATTEMPTS;
  if (attemptsUsed >= KIOSK_MAX_ATTEMPTS) return { kind: 'locked' };
  return { kind: 'mismatch', attempt: attemptsUsed };
}

/** After a mismatch the patient may try again — this is the next asking state. */
export function retryAfterMismatch(state: VerificationState): VerificationState {
  if (state.kind !== 'mismatch') return state;
  return { kind: 'asking', attempt: state.attempt + 1 };
}

/**
 * The ONLY failure message. No parameters, deliberately: there is nothing a
 * caller could pass that would name a field.
 */
export function mismatchMessage(): string {
  return strings.verify.mismatchBody;
}

export function mismatchHeading(): string {
  return strings.verify.mismatchHeading;
}
