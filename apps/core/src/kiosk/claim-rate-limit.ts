/**
 * THREE ATTEMPTS, THEN THE DESK — for `POST /kiosk/claim`, and keyed per
 * DEVICE because there is no patient to key it to.
 *
 * WHY NOT THE CHALLENGE ROW'S OWN COUNTER. The existing ladder lives on
 * `verification_challenges.attempts` and locks a challenge out after five
 * (`LOCKOUT_AFTER_ATTEMPTS`). That works because the remote link and the old
 * list-then-verify flow both CHOSE a patient first, so every attempt landed on
 * the same row. A claim has chosen nobody — finding the patient IS the
 * attempt — and a failed claim matches no row at all, so there is no challenge
 * to count against. Counting per device is the only key that exists at the
 * moment of the failure, and it is also the right one: the thing being
 * rate-limited is a tablet in a waiting room, not a person.
 *
 * THREE, NOT FIVE, and the same reasoning the tablet already uses
 * (`apps/web/app/kiosk/rules/verification.ts`): a staff member is standing
 * right there, and a fourth guess at a tablet is worth less than thirty
 * seconds of theirs. The kiosk is stricter than the server's own challenge
 * threshold, never looser — the only safe direction.
 *
 * IT IS ALSO THE RATE LIMIT `/devices/pair` HAS. Three failures per device per
 * ten minutes is a tighter budget than pairing's ten per address, against a
 * search space (every waiting patient's name, date of birth and address) that
 * nobody can brute-force three guesses at a time. One mechanism, because two
 * would be two things to get wrong.
 *
 * ONLY FAILURES COUNT, and a success clears the window. A tablet serving six
 * patients in a row is a busy morning, not an attack; punishing the happy path
 * would make the product's own main flow the thing that breaks first.
 *
 * IN MEMORY, PER PROCESS, AND SAID SO OUT LOUD — the same honest caveat
 * `pairing-rate-limit.ts` carries. Redis is in the stack and a shared counter
 * is the right home for this the moment core runs more than one task in
 * Fargate; until then a per-process window is a real limit rather than a
 * decorative one. N processes means N times the budget, which is still small.
 *
 * IT NEVER BLOCKS CARE (hard rule 8). A locked-out tablet says "please see our
 * reception staff" and the patient is seen and billed exactly as before; what
 * is delayed is evidence, never service.
 */

export const CLAIM_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

/** Three, then the desk — the same ladder the tablet shows in its footer. */
export const CLAIM_ATTEMPT_LIMIT = 3;

interface Window {
  failures: number[];
}

export class ClaimAttemptLimit {
  private readonly windows = new Map<string, Window>();

  /** True when this device has spent its three and should be sent to the desk. */
  isLockedOut(deviceId: string, now: number = Date.now()): boolean {
    const window = this.windows.get(deviceId);
    if (!window) return false;
    this.prune(deviceId, window, now);
    return window.failures.length >= CLAIM_ATTEMPT_LIMIT;
  }

  /** How many of the three this device has spent, for the tablet's footer. */
  attemptsUsed(deviceId: string, now: number = Date.now()): number {
    const window = this.windows.get(deviceId);
    if (!window) return 0;
    this.prune(deviceId, window, now);
    return window.failures.length;
  }

  /** Records one claim that matched nothing — or matched more than one thing. */
  recordFailure(deviceId: string, now: number = Date.now()): void {
    const window = this.windows.get(deviceId) ?? { failures: [] };
    window.failures.push(now);
    this.windows.set(deviceId, window);
    this.prune(deviceId, window, now);
    /*
     * A CAP ON THE MAP ITSELF, as on the pairing limiter. A device id is not
     * guessable and a caller must already hold a valid credential to reach
     * this at all, so the flood this defends against is narrow — but a
     * limiter that can be turned into the memory leak is a worse bug than the
     * one it prevents.
     */
    if (this.windows.size > 10_000) {
      const oldest = this.windows.keys().next();
      if (!oldest.done) this.windows.delete(oldest.value);
    }
  }

  /**
   * A CLAIM THAT FOUND ITS PATIENT CLEARS THE LADDER. The next patient at this
   * tablet starts at attempt one — they are not carrying the previous
   * person's typos, and a shared device that accumulated strangers' failures
   * would lock out whoever happened to be sixth in the queue.
   */
  clear(deviceId: string): void {
    this.windows.delete(deviceId);
  }

  /** Seconds until this device may try again. */
  retryAfterSeconds(deviceId: string, now: number = Date.now()): number {
    const window = this.windows.get(deviceId);
    if (!window || window.failures.length === 0) return 0;
    return Math.max(1, Math.ceil((window.failures[0] + CLAIM_ATTEMPT_WINDOW_MS - now) / 1000));
  }

  /** Test seam. Nothing in the application calls this. */
  reset(): void {
    this.windows.clear();
  }

  private prune(deviceId: string, window: Window, now: number): void {
    const cutoff = now - CLAIM_ATTEMPT_WINDOW_MS;
    window.failures = window.failures.filter((at) => at > cutoff);
    if (window.failures.length === 0) this.windows.delete(deviceId);
  }
}
