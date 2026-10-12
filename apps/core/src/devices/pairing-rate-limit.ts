/**
 * THE RATE LIMIT ON `POST /devices/pair`, and an honest account of what it is.
 *
 * The endpoint is public — it has to be, because a tablet with no credential
 * is exactly the caller it exists for — and it takes a guessable-in-principle
 * eight-character code. The maths says guessing is hopeless (30^8 codes, ten
 * minutes each, single use), but "hopeless" assumes somebody cannot try a
 * million times a minute, and that assumption is this file.
 *
 * ONLY FAILURES COUNT. A practice pairing six tablets in a row is not an
 * attack, and a limit that punished success would make the console's own
 * happy path the thing that breaks first.
 *
 * IN MEMORY, PER PROCESS, AND SAID SO OUT LOUD. Redis is in the stack
 * (aob-tech-stack.md) and a shared counter is the right home for this the
 * moment core runs more than one task in Fargate — until then a per-process
 * window is a real limit rather than a decorative one, and pretending
 * otherwise in a comment is how a decorative limit survives review. The
 * failure mode of getting it wrong is bounded: N processes means N times the
 * budget, against a code that dies in ten minutes anyway.
 *
 * IT NEVER BLOCKS THE PRACTICE (hard rule 8). A limited caller is told to wait
 * and the console can always issue a fresh code; nothing about a rate limit
 * can stop a patient being seen, because pairing a tablet is not on the path
 * to care in the first place.
 */

export const PAIRING_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Ten wrong codes in ten minutes from one address. A person mistyping an
 * eight-character code gets several goes; a script gets nowhere.
 */
export const PAIRING_ATTEMPT_LIMIT = 10;

interface Window {
  failures: number[];
}

export class PairingRateLimit {
  private readonly windows = new Map<string, Window>();

  /** True when this caller has spent its budget and should be refused. */
  isLimited(key: string, now: number = Date.now()): boolean {
    const window = this.windows.get(key);
    if (!window) return false;
    this.prune(key, window, now);
    return window.failures.length >= PAIRING_ATTEMPT_LIMIT;
  }

  /** Records one WRONG code. A successful pairing is never recorded. */
  recordFailure(key: string, now: number = Date.now()): void {
    const window = this.windows.get(key) ?? { failures: [] };
    window.failures.push(now);
    this.windows.set(key, window);
    this.prune(key, window, now);
    /*
     * A CAP ON THE MAP ITSELF. Without it a caller rotating source addresses
     * turns the rate limiter into the memory leak, which is a better attack
     * than the one it was defending against. The oldest entry goes; the cost
     * is that a flood can push a genuine caller's window out, and the genuine
     * caller's punishment for that is being allowed to try again.
     */
    if (this.windows.size > 10_000) {
      const oldest = this.windows.keys().next();
      if (!oldest.done) this.windows.delete(oldest.value);
    }
  }

  /** Seconds until the caller may try again. For the `Retry-After` header. */
  retryAfterSeconds(key: string, now: number = Date.now()): number {
    const window = this.windows.get(key);
    if (!window || window.failures.length === 0) return 0;
    const oldest = window.failures[0];
    return Math.max(1, Math.ceil((oldest + PAIRING_ATTEMPT_WINDOW_MS - now) / 1000));
  }

  /** Test seam. Nothing in the application calls this. */
  reset(): void {
    this.windows.clear();
  }

  private prune(key: string, window: Window, now: number): void {
    const cutoff = now - PAIRING_ATTEMPT_WINDOW_MS;
    window.failures = window.failures.filter((at) => at > cutoff);
    if (window.failures.length === 0) this.windows.delete(key);
  }
}
