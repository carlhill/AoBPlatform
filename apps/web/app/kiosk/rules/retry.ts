/**
 * RIDE OUT A BLIP; NEVER RIDE OUT A REFUSAL (Carl, 7 Sep 2026).
 *
 * WHAT HAPPENED. Core restarted under the dev watcher while a patient's five
 * answers were being posted. The POST failed, K-P1 showed its red line, the
 * screen went to see-reception, and when the tablet came back the same step was
 * on it with every button live and the answers gone. Nothing was wrong with the
 * platform by then — it had been back for a second and a half — and nothing was
 * wrong with the answers either. The patient re-did work the device had
 * already collected, which is exactly the impression this product cannot
 * afford at a reception desk.
 *
 * THE DISTINCTION THIS FILE ENFORCES is between "I could not reach the server"
 * and "the server said no", and `KioskApiError` already draws it: fetch throws
 * a `TypeError` when nothing was reached, and the class is only ever
 * constructed from a real response (`api.ts`). So a 401 unpaired, a 409
 * session_disputed and a 422 refusal are ANSWERS — they will be identical next
 * second, retrying them is noise, and two of them are states the ceremony must
 * move to at once. A network throw or a 5xx is not an answer.
 *
 * IT IS BOUNDED, AND THE BOUND IS THE POINT. Four retries at 1s, 2s, 4s, 8s —
 * five attempts, about fifteen seconds — and then the existing see-reception
 * path takes over unchanged. A patient is not left watching a spinner, a
 * restarting server is not hammered, and hard rule 8 is untouched: the platform
 * still hands the patient to a person rather than blocking them, it just stops
 * doing it for a blip.
 *
 * NOTHING IS STORED. The attempt count and the timer live in the closure and
 * die with the component (CLAUDE.md §7 — no storage surface under `app/kiosk`,
 * and `kiosk_persists_nothing_but_pairing` proves it).
 */
import { KioskApiError } from '../api';

/**
 * Four waits, so five attempts in total, ~15s end to end. Exported so a test
 * advances the clock by exactly what the code waits rather than by a number
 * somebody typed twice.
 */
export const TRANSIENT_RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000];

/**
 * Is this worth trying again?
 *
 * A `KioskApiError` means the server answered: only a 5xx is worth repeating,
 * because every 4xx will say the same thing next second. Anything that is NOT
 * a `KioskApiError` never reached a server at all — a dropped wifi association,
 * a restarting core, a DNS hiccup — and those are the ones that come back.
 */
export function isTransientFailure(err: unknown): boolean {
  if (err instanceof KioskApiError) return err.status >= 500;
  return true;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Run `attempt`, and on a transient failure run it again after each delay.
 *
 * THE OPERATION PASSED IN MUST BE IDEMPOTENT, and the one caller's is: the
 * details POST is guarded by `postedAnswersRef`, so a retry that follows a POST
 * which actually succeeded (and a `fetchAgreement` that did not) re-posts
 * nothing and writes no second vault event.
 *
 * `onRetry` IS FOR THE SCREEN, not for logging. It fires before each wait, so
 * the tablet can say "One moment…" instead of nothing — and it fires with the
 * attempt number so a caller could say more later without changing this.
 *
 * THE LAST FAILURE IS RE-THROWN AS IT CAME. Wrapping it would hide the
 * `KioskApiError` an unpaired check downstream still needs to see.
 */
export async function withTransientRetry<T>(
  attempt: () => Promise<T>,
  options?: {
    readonly delaysMs?: readonly number[];
    readonly onRetry?: (attemptNumber: number) => void;
  },
): Promise<T> {
  const delays = options?.delaysMs ?? TRANSIENT_RETRY_DELAYS_MS;
  for (let index = 0; ; index += 1) {
    try {
      return await attempt();
    } catch (err) {
      if (index >= delays.length || !isTransientFailure(err)) throw err;
      options?.onRetry?.(index + 1);
      await wait(delays[index]);
    }
  }
}
