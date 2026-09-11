/**
 * THE RATE LIMIT ON `GET /organisations/abn-lookup`, and an honest account of
 * what it is.
 *
 * The endpoint is reachable by an applicant who has no account — it has to be,
 * because the whole point is to show them which entity their ABN resolves to
 * BEFORE they commit to an application. That makes it the one route here that
 * spends somebody else's resources on an anonymous caller's behalf: every hit
 * is an outbound request to a Commonwealth service we are a registered
 * consumer of, under a GUID that can be revoked if we abuse it.
 *
 * So the limit is not about protecting our database. It is about not being the
 * reason the ABR takes our GUID away, and about a scraper not turning our
 * onboarding form into a free ABN Lookup proxy.
 *
 * EVERY REQUEST COUNTS, unlike the pairing limiter next door, which counts
 * only failures. There the successful case was the practice's own happy path;
 * here a successful lookup is exactly as expensive as a failed one, and a
 * script enumerating valid ABNs would otherwise be entirely unmetered.
 *
 * IN MEMORY, PER PROCESS, AND SAID SO OUT LOUD. Redis is in the stack
 * (aob-tech-stack.md) and a shared counter is the right home for this the
 * moment core runs more than one task in Fargate — until then a per-process
 * window is a real limit rather than a decorative one, and pretending
 * otherwise in a comment is how a decorative limit survives review. Getting it
 * wrong is bounded: N processes means N times the budget.
 *
 * IT NEVER BLOCKS AN APPLICATION. A limited caller can still submit the form:
 * the lookup is a preview, the register is consulted again server-side at
 * submission, and if that cannot be reached the manual-attestation path takes
 * over. Nothing about this counter can stop a practice applying, and nothing
 * about it is anywhere near the path to care.
 */

export const ABN_LOOKUP_WINDOW_MS = 10 * 60 * 1000;

/**
 * Twenty previews in ten minutes from one address.
 *
 * A person filling in one form makes one or two; a person correcting a
 * mistyped digit a few more; a practice group applying for several entities
 * from one office network is still nowhere near twenty. A script is.
 */
export const ABN_LOOKUP_LIMIT = 20;

interface Window {
  hits: number[];
}

export class AbnLookupRateLimit {
  private readonly windows = new Map<string, Window>();

  /** True when this caller has spent its budget and should be refused. */
  isLimited(key: string, now: number = Date.now()): boolean {
    const window = this.windows.get(key);
    if (!window) return false;
    this.prune(key, window, now);
    return window.hits.length >= ABN_LOOKUP_LIMIT;
  }

  /** Records one lookup, successful or not. */
  record(key: string, now: number = Date.now()): void {
    const window = this.windows.get(key) ?? { hits: [] };
    window.hits.push(now);
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
    if (!window || window.hits.length === 0) return 0;
    return Math.max(1, Math.ceil((window.hits[0] + ABN_LOOKUP_WINDOW_MS - now) / 1000));
  }

  /** Test seam. Nothing in the application calls this. */
  reset(): void {
    this.windows.clear();
  }

  private prune(key: string, window: Window, now: number): void {
    const cutoff = now - ABN_LOOKUP_WINDOW_MS;
    window.hits = window.hits.filter((at) => at > cutoff);
    if (window.hits.length === 0) this.windows.delete(key);
  }
}
