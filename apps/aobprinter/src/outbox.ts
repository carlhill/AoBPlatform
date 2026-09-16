/**
 * The outbox: a folder that must never lose a form and never send one twice.
 *
 * WHY A FOLDER AND NOT A QUEUE IN MEMORY. The practice prints, the receptionist
 * hands the patient a tablet, and somewhere in between this program can be
 * killed by a reboot, an antivirus update, or somebody closing a window. A form
 * that existed only in a process is gone, and what is lost is not a message —
 * it is the practice's record that a service was rendered and consent is due.
 * The record is written to disk BEFORE the first attempt, and only moved once
 * the server has said 202.
 *
 * WHY THE FILENAME IS THE HASH. `sourceSha256` — the hash of the spool bytes
 * the driver saw — is the idempotency key end to end: it names the file here,
 * it is what the server dedups on, and it is what a dispute uses to tie this
 * record to that printing. Two claims of the same bytes collapse to one file
 * without a lock, and a re-post of a form already sent cannot happen because
 * its name is already in `sent/`. It is also the one key that is safe in a
 * filename: a hash of a page is not the page (hard rule 9).
 *
 * EXACTLY-ONCE IS NOT AVAILABLE, AND THE HONEST VERSION IS SAID HERE. If the
 * process dies after the server has accepted a job and before this renames the
 * file, the next run posts it again. That is why the server dedups on
 * (practice, documentType, sourceSha256) and answers `duplicate: true` rather
 * than erroring — the desktop's at-least-once and the server's idempotency are
 * one design, not two. What this file guarantees is that it never posts twice
 * on its own account: not from two overlapping timers, not from a second claim
 * of the same print, not from a retry of a job that was already accepted.
 *
 * IT NEVER GIVES UP. `afterFailure` in the domain retires an item after eight
 * attempts, which is right for a notice — a dead notice is visible on a screen
 * somebody watches. Nothing watches a receptionist's desktop. So the SCHEDULE
 * is the domain's `backoffFor`, reused, and the retirement is not: an
 * unreachable server means the queue grows until it is reachable. The practice
 * still prints and still bills (hard rule 8); the evidence is late, never lost.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { backoffFor } from '@aobplatform/domain';
import type { Db4PrintRecord } from './db4-record';
import { redactError, type Logger } from './log';

/** What a queued job looks like on disk. The record, and how the sending is going. */
interface QueuedJob {
  readonly record: Db4PrintRecord;
  readonly enqueuedAt: string;
  readonly attempts: number;
  /** ISO instant; the job is not tried before this. */
  readonly nextAttemptAt: string;
  readonly lastError?: string;
}

export interface PostResult {
  readonly ok: boolean;
  readonly status: number;
  /** The server already had this exact document. Success, not an error. */
  readonly duplicate?: boolean;
  readonly error?: string;
}

/** What actually talks to AoB. Injected so the outbox can be tested without a server. */
export type Poster = (record: Db4PrintRecord) => Promise<PostResult>;

export interface OutboxPaths {
  readonly pending: string;
  readonly sent: string;
  readonly tmp: string;
}

export function outboxPaths(dataDir: string): OutboxPaths {
  return {
    pending: join(dataDir, 'outbox', 'pending'),
    sent: join(dataDir, 'outbox', 'sent'),
    tmp: join(dataDir, 'outbox', 'tmp'),
  };
}

/** A hex sha256 and nothing else may name a file here. */
const SHA256 = /^[0-9a-f]{64}$/;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class Outbox {
  private readonly paths: OutboxPaths;
  /** Jobs being posted right now, so two timers cannot both take one. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly dataDir: string,
    private readonly post: Poster,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.paths = outboxPaths(dataDir);
    for (const dir of [this.paths.pending, this.paths.sent, this.paths.tmp]) mkdirSync(dir, { recursive: true });
    this.recoverTmp();
  }

  /**
   * A half-written job file from a process that died mid-write.
   *
   * It is DELETED, not recovered. A `tmp` file is by definition one whose
   * rename never happened, so nothing has been promised about it and the spool
   * PDF it came from is still in `jobs/` waiting to be parsed again. Keeping a
   * truncated JSON would be keeping a record that might be half a form.
   */
  private recoverTmp(): void {
    for (const name of readdirSync(this.paths.tmp)) {
      try {
        unlinkSync(join(this.paths.tmp, name));
      } catch {
        // Locked by something else; the next start will get it.
      }
    }
  }

  /** Write a file by writing it somewhere else first. A reader never sees a partial job. */
  private writeAtomic(target: string, job: QueuedJob): void {
    const staging = join(this.paths.tmp, `${createHash('sha256').update(target).digest('hex').slice(0, 16)}.json`);
    writeFileSync(staging, JSON.stringify(job, null, 2), 'utf8');
    renameSync(staging, target);
  }

  private pendingPath(sha: string): string {
    return join(this.paths.pending, `${sha}.json`);
  }

  /**
   * The sent marker, and why it still holds the WHOLE record.
   *
   * A marker only needs the hash to do its job — "this one has gone" — and a
   * file holding the whole DB4 Print Record is a full form, Medicare card
   * number and all, sitting on a receptionist's desktop for as long as nobody
   * deletes it. That is a real cost and it is taken deliberately, for one
   * reason with an expiry date: UNTIL PIECE 1 IS BUILT, THIS IS THE ONLY COPY
   * OF THE RECORD THAT EXISTS. Measured on 17 September 2026, the server's
   * envelope DTO whitelists five fields and strips the rest at the door, so a
   * DB4 posted today is accepted, stored as its envelope, and its content is
   * discarded — and the claimed spool PDF is already gone by then.
   *
   * WHEN PIECE 1 LANDS, this should shrink to the hash, the timestamps and the
   * attempt count, and `sent/` should get a retention sweep. Both are Carl's
   * calls and both are in TODO.md; neither is safe to do while the server
   * cannot keep what it is sent.
   */
  private sentPath(sha: string): string {
    return join(this.paths.sent, `${sha}.json`);
  }

  /**
   * Put a record in the queue.
   *
   * Idempotent on `sourceSha256`, twice over: a record already sent is not
   * queued again, and a record already queued is not restarted (which would
   * reset its backoff and hammer a server that is already struggling).
   */
  enqueue(record: Db4PrintRecord): 'queued' | 'already_queued' | 'already_sent' {
    const sha = record.sourceSha256;
    if (!SHA256.test(sha)) throw new Error('A job must be keyed by a 64-character hex sha256 of its source bytes.');

    if (existsSync(this.sentPath(sha))) {
      this.logger.info('outbox.already_sent', { sha });
      return 'already_sent';
    }
    if (existsSync(this.pendingPath(sha))) {
      this.logger.info('outbox.already_queued', { sha });
      return 'already_queued';
    }

    const at = this.now().toISOString();
    this.writeAtomic(this.pendingPath(sha), { record, enqueuedAt: at, attempts: 0, nextAttemptAt: at });
    this.logger.info('outbox.queued', { sha, template: record.parserTemplateVersion, depth: this.depth() });
    return 'queued';
  }

  /** How many forms are waiting. The number that matters when AoB is unreachable. */
  depth(): number {
    return readdirSync(this.paths.pending).filter((n) => n.endsWith('.json')).length;
  }

  private read(sha: string): QueuedJob | null {
    try {
      return JSON.parse(readFileSync(this.pendingPath(sha), 'utf8')) as QueuedJob;
    } catch (err) {
      // Unreadable rather than absent. Left where it is: a job we cannot parse
      // is a job for a human, and deleting it would be the one unrecoverable act.
      this.logger.error('outbox.unreadable', { sha, error: redactError(err) });
      return null;
    }
  }

  /**
   * Try everything that is due. Returns how many were accepted.
   *
   * ONE PASS, NO PARALLELISM. A practice prints one form at a time and the
   * server answers in milliseconds; posting in sequence keeps the ordering the
   * practice printed in, which is the order a receptionist expects to see them.
   */
  async flush(): Promise<{ sent: number; failed: number; waiting: number }> {
    const now = this.now();
    let sent = 0;
    let failed = 0;

    const names = readdirSync(this.paths.pending)
      .filter((n) => n.endsWith('.json'))
      .sort();

    for (const name of names) {
      const sha = name.replace(/\.json$/, '');
      if (!SHA256.test(sha) || this.inFlight.has(sha)) continue;

      /*
       * THE SECOND HALF OF "NEVER TWICE", and it is checked BEFORE the backoff
       * rather than after. A job that has already been delivered is finished
       * whatever its schedule says, and a stale pending file left by a crash
       * between the sent marker and the unlink must be cleared on the next pass
       * — not sat on until its backoff expires, where it is one clock change
       * away from being posted a second time.
       */
      if (existsSync(this.sentPath(sha))) {
        try {
          unlinkSync(this.pendingPath(sha));
        } catch {
          /* it will be tidied next pass */
        }
        continue;
      }

      const job = this.read(sha);
      if (!job) continue;
      if (new Date(job.nextAttemptAt).getTime() > now.getTime()) continue;

      this.inFlight.add(sha);
      try {
        const result = await this.post(job.record);
        if (result.ok) {
          // The marker goes down BEFORE the pending file comes up, so a crash
          // between the two leaves a sent marker and a stale pending file —
          // which the check above resolves — rather than a job with no record
          // of having been sent.
          this.writeAtomic(this.sentPath(sha), { ...job, attempts: job.attempts + 1, nextAttemptAt: now.toISOString() });
          try {
            unlinkSync(this.pendingPath(sha));
          } catch {
            /* the sent marker is authoritative; a leftover is skipped above */
          }
          sent += 1;
          this.logger.info('outbox.sent', { sha, status: result.status, duplicate: result.duplicate === true });
        } else {
          failed += 1;
          const attempts = job.attempts + 1;
          const waitSeconds = backoffFor(job.attempts);
          this.writeAtomic(this.pendingPath(sha), {
            ...job,
            attempts,
            nextAttemptAt: new Date(now.getTime() + waitSeconds * 1000).toISOString(),
            lastError: result.error ?? `HTTP ${result.status}`,
          });
          this.logger.warn('outbox.retry', {
            sha,
            status: result.status,
            attempts,
            retryInSeconds: waitSeconds,
            depth: this.depth(),
          });
        }
      } finally {
        this.inFlight.delete(sha);
      }
    }

    return { sent, failed, waiting: this.depth() };
  }
}
