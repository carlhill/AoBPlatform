/**
 * The one place this program talks to AoB.
 *
 * `POST /inbound/print-jobs`, practice-scoped, answering 202 — the endpoint
 * already exists and already dedups on (practice, documentType,
 * sourceSha256), which is the other half of the outbox's at-least-once. A
 * `duplicate: true` in the response is SUCCESS: it means a previous attempt got
 * through and the desktop can stop trying.
 *
 * EVERY FAILURE IS A RETRY, WITH ONE EXCEPTION. A 4xx that is not 408 or 429 is
 * the server saying this request will never work — a practice id it does not
 * know, a payload it will not take. Retrying that forever is a program shouting
 * at a wall, so it backs off on the same schedule but says plainly in the log
 * that the failure is ours to fix rather than the network's. It is still never
 * discarded: a form is not thrown away because the server disliked it.
 *
 * TRANSPORT IS THE OPEN GAP (see config.ts). `aob-tech-stack.md` gives the site
 * connector outbound-only mutual TLS with a per-practice credential revocable
 * from the console. This sends `x-practice-id` over the configured URL and
 * nothing more. That is a bench channel, not a practice one, and the program
 * warns at startup when the endpoint is not local.
 */
import type { AobPrinterConfig } from './config';
import type { Db4PrintRecord } from './db4-record';
import { redactError, type Logger } from './log';
import type { PostResult, Poster } from './outbox';
import { readPackageVersion } from './version';

/** Long enough for a slow link, short enough that a retry is not an hour away. */
const TIMEOUT_MS = 20_000;

export function makeHttpPoster(config: AobPrinterConfig, logger: Logger): Poster {
  /*
   * READ ONCE, SENT ON EVERY POST. `x-aobprinter-version` is how the server
   * learns which desktops are on which build without anyone visiting one —
   * which matters the day a parser template turns out to read a field wrongly
   * and the question is "how many practices posted through it". It carries no
   * practice or patient information; it is the build number of this program.
   */
  const printerVersion = readPackageVersion();

  return async function post(record: Db4PrintRecord): Promise<PostResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-practice-id': config.practiceId,
          'x-aobprinter-version': printerVersion,
        },
        body: JSON.stringify(record),
        signal: controller.signal,
      });

      if (response.ok) {
        // 202 with the accepted job. `duplicate` is the server telling us it
        // already had this exact document — which is the answer we want.
        const body = (await response.json().catch(() => ({}))) as { duplicate?: boolean; lane?: string; id?: string };
        return { ok: true, status: response.status, duplicate: body.duplicate === true, jobId: body.id };
      }

      const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
      if (!retryable) {
        logger.error('post.rejected', {
          status: response.status,
          note: 'the server will not take this job as it stands; it stays queued and needs a human',
        });
      }
      return { ok: false, status: response.status, error: `HTTP ${response.status}`, retryable };
    } catch (err) {
      // Unreachable, DNS, TLS, timeout. Ordinary, always retryable, and the
      // queue is what it is for.
      return { ok: false, status: 0, error: redactError(err), retryable: true };
    } finally {
      clearTimeout(timer);
    }
  };
}
