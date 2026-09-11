import {
  PORTAL_PASSKEY_ATTEMPT_LIMIT,
  PORTAL_PASSKEY_ATTEMPT_WINDOW_MINUTES,
} from '@aobplatform/contracts';

/**
 * TEN SIGN-IN ATTEMPTS PER ADDRESS PER TEN MINUTES — the same construction as
 * `claim-rate-limit.ts` and `pairing-rate-limit.ts`, because a third mechanism
 * would be a third thing to get wrong.
 *
 * KEYED BY IP, WHICH IS THE ONLY KEY THAT EXISTS. A discoverable sign-in has
 * chosen nobody: the whole point is that the browser sends no identifier until
 * the assertion comes back, so there is no account, no patient and no device to
 * count against. The address is what the request has.
 *
 * IT IS NOT THE DEFENCE, AND SAYING SO MATTERS. The defence against somebody
 * signing in as a patient is a signature over a server-issued, single-use,
 * five-minute challenge, verified against a public key we hold. Nothing about
 * this limiter is load-bearing for that. What it stops is a script hammering
 * the endpoint — cheap denial of service, and a stream of `portal.passkey_*`
 * events that would bury the one that matters.
 *
 * LOOSER THAN THE KIOSK'S THREE (`CLAIM_ATTEMPT_LIMIT`), deliberately. A failed
 * kiosk claim is a typed identifier and there is a staff member two metres
 * away; a failed passkey sign-in is usually a cancelled prompt or the wrong
 * passkey picked from a list, and there is nobody standing there. Three would
 * lock out a confused patient on their own phone, which is the person this page
 * exists for.
 *
 * ONLY FAILURES COUNT, AND A SUCCESS CLEARS THE WINDOW — a patient who fumbles
 * twice and then gets in is not carrying a penalty into next week.
 *
 * IN MEMORY, PER PROCESS, AND SAID OUT LOUD. TODO: move to Redis, which is
 * already in the stack, the moment core runs more than one task in Fargate. N
 * processes means N times the budget; against a signature nobody can forge that
 * is still a real limit rather than a decorative one, but it is not the limit
 * this file's name claims and the note should not be quietly dropped.
 *
 * IT NEVER BLOCKS CARE (hard rule 8) AND NEVER BLOCKS SIGNING (REQ-PORT-08).
 * The worst it does is make somebody wait to look at their own record; the
 * three-identifier bootstrap is a separate door and is not rate-limited by this.
 */

export const PORTAL_PASSKEY_ATTEMPT_WINDOW_MS = PORTAL_PASSKEY_ATTEMPT_WINDOW_MINUTES * 60 * 1000;

export class PortalPasskeyAttemptLimit {
  private readonly windows = new Map<string, number[]>();

  isLockedOut(key: string, now: number = Date.now()): boolean {
    const failures = this.prune(key, now);
    return failures.length >= PORTAL_PASSKEY_ATTEMPT_LIMIT;
  }

  recordFailure(key: string, now: number = Date.now()): void {
    const failures = this.windows.get(key) ?? [];
    failures.push(now);
    this.windows.set(key, failures);
    this.prune(key, now);

    /*
     * A CAP ON THE MAP ITSELF. This endpoint is reachable without a session, so
     * unlike the kiosk limiter its key space is whatever an attacker can spoof
     * — and a limiter that can be turned into the memory leak is a worse bug
     * than the one it prevents.
     */
    if (this.windows.size > 10_000) {
      const oldest = this.windows.keys().next();
      if (!oldest.done) this.windows.delete(oldest.value);
    }
  }

  /** A sign-in that worked. The next attempt from this address starts clean. */
  clear(key: string): void {
    this.windows.delete(key);
  }

  retryAfterSeconds(key: string, now: number = Date.now()): number {
    const failures = this.windows.get(key);
    if (!failures || failures.length === 0) return 0;
    return Math.max(1, Math.ceil((failures[0] + PORTAL_PASSKEY_ATTEMPT_WINDOW_MS - now) / 1000));
  }

  /** Test seam. Nothing in the application calls this. */
  reset(): void {
    this.windows.clear();
  }

  private prune(key: string, now: number): number[] {
    const failures = (this.windows.get(key) ?? []).filter((at) => at > now - PORTAL_PASSKEY_ATTEMPT_WINDOW_MS);
    if (failures.length === 0) this.windows.delete(key);
    else this.windows.set(key, failures);
    return failures;
  }
}
