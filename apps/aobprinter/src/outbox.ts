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
import { DEFAULT_RETENTION_CONFIG } from './config';
import type { Db4PrintRecord } from './db4-record';
import type { EncryptedPayload } from './keystore';
import { redactError, type Logger } from './log';
import { buildReceipt } from './receipts';
import type { RetentionDeps } from './retention';

/**
 * What a queued job looks like on disk.
 *
 * EXACTLY ONE OF `record` / `encrypted` IS SET, NEVER BOTH. `record` is the
 * plaintext DB4 Print Record and is what every job has always looked like;
 * `encrypted` is the same record under `retention.ts`'s cipher, present only
 * once `retention.enabled` is true (`config.ts`). A job is never written with
 * `record` set while retention is enabled — see `encode` below.
 */
interface QueuedJob {
  readonly record?: Db4PrintRecord;
  readonly encrypted?: EncryptedPayload;
  readonly enqueuedAt: string;
  readonly attempts: number;
  /** ISO instant; the job is not tried before this. */
  readonly nextAttemptAt: string;
  readonly lastError?: string;
  /** Set only in `poison/`: when the job was classified unrecoverable, for the TTL sweep. */
  readonly poisonedAt?: string;
}

export interface PostResult {
  readonly ok: boolean;
  readonly status: number;
  /** The server already had this exact document. Success, not an error. */
  readonly duplicate?: boolean;
  readonly error?: string;
  /** The server's id for the accepted job, when it returned one. */
  readonly jobId?: string;
  /**
   * Set when `ok` is false: `false` means the server will never accept this
   * job as it stands (a non-408/429 4xx) and, once retention is enabled, it is
   * classified into `poison/` rather than retried forever. `true` or absent
   * means keep retrying in `pending/` on the usual backoff — the default when
   * a poster does not say, so nothing is poisoned by a caller that has not
   * been told about the distinction.
   */
  readonly retryable?: boolean;
}

/** What actually talks to AoB. Injected so the outbox can be tested without a server. */
export type Poster = (record: Db4PrintRecord) => Promise<PostResult>;

export interface OutboxPaths {
  readonly pending: string;
  readonly sent: string;
  readonly tmp: string;
  /** Parsed and posted, but rejected outright by the server. Destroyed after `retention.poisonTtlMs`, only once retention is enabled. */
  readonly poison: string;
}

export function outboxPaths(dataDir: string): OutboxPaths {
  return {
    pending: join(dataDir, 'outbox', 'pending'),
    sent: join(dataDir, 'outbox', 'sent'),
    tmp: join(dataDir, 'outbox', 'tmp'),
    poison: join(dataDir, 'outbox', 'poison'),
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
    // Absent retention deps behave exactly as this file did before retention
    // existed: plaintext, `sent/` kept forever. A default rather than a
    // required constructor argument so every existing caller and test still
    // compiles and still gets that behaviour without being told to.
    private readonly retention: RetentionDeps = { config: DEFAULT_RETENTION_CONFIG, receipts: { record: () => undefined } },
  ) {
    this.paths = outboxPaths(dataDir);
    for (const dir of [this.paths.pending, this.paths.sent, this.paths.tmp, this.paths.poison]) mkdirSync(dir, { recursive: true });
    this.recoverTmp();
    if (this.retention.config.enabled) this.migrateLegacyPayloads();
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
   * The sent marker.
   *
   * RETENTION OFF (the shipped default): still holds the WHOLE record, as
   * this file always has. Measured 17 September 2026, the server's envelope
   * DTO whitelists five fields and strips the rest at the door, so a DB4
   * posted today is accepted, stored as its envelope, and its content
   * discarded — and the claimed spool PDF is already gone by then, so this is
   * the only complete copy of the form anywhere (TODO.md, "AOBPRINTER
   * landed", item 3). Deleting it before that server-side piece lands would
   * acknowledge a form and then lose it.
   *
   * RETENTION ON: this file is never written. `flush()` deletes the pending
   * job immediately on ack instead, after handing the receipt to
   * `retention.receipts`. See `config.ts`'s `RetentionConfig` for what flips
   * this.
   */
  private sentPath(sha: string): string {
    return join(this.paths.sent, `${sha}.json`);
  }

  /** A job the server has rejected outright, waiting out `retention.poisonTtlMs` before it is destroyed. Only used when retention is enabled. */
  private poisonPath(sha: string): string {
    return join(this.paths.poison, `${sha}.json`);
  }

  /**
   * Everything a stored job needs to carry, shaped for whichever tier is
   * writing it — plaintext when retention is off, encrypted when it is on.
   * Never both, and never plaintext while `config.enabled` is true: if the
   * cipher is somehow missing this throws rather than falling back to writing
   * the form unencrypted (rule 3 of this feature).
   */
  private encodeForStorage(record: Db4PrintRecord): Pick<QueuedJob, 'record' | 'encrypted'> {
    if (!this.retention.config.enabled) return { record };
    if (!this.retention.cipher) {
      throw new Error('Retention is enabled but no cipher is configured; refusing to write a form to disk unencrypted.');
    }
    return { encrypted: this.retention.cipher.encrypt(Buffer.from(JSON.stringify(record), 'utf8')) };
  }

  /** The record a stored job carries, decrypting it first if that is how it is held. */
  private recordOf(job: QueuedJob): Db4PrintRecord {
    if (job.record) return job.record;
    if (job.encrypted) {
      if (!this.retention.cipher) throw new Error('This job is encrypted and no cipher is configured to read it back.');
      return JSON.parse(this.retention.cipher.decrypt(job.encrypted).toString('utf8')) as Db4PrintRecord;
    }
    throw new Error('This job has neither a plaintext nor an encrypted payload.');
  }

  /**
   * Put a record in the queue.
   *
   * Idempotent on `sourceSha256`, three ways: a record already sent is not
   * queued again, a record already poisoned is not restarted with a fresh
   * poison TTL, and a record already queued is not restarted either (which
   * would reset its backoff and hammer a server that is already struggling).
   *
   * ONE GAP, HONESTLY STATED: with retention enabled, `sent/` no longer keeps
   * a marker (it is deleted, not shrunk — see `sentPath`), so a reprint of
   * bytes already fully delivered and purged is queued and posted again
   * rather than short-circuited here. That is safe, not silent: the server
   * dedups on `sourceSha256` and answers `duplicate: true`, which `flush()`
   * treats as delivered, so nothing doubles up where it would be seen — only
   * an extra request and an extra receipt line, on the rarest of paths.
   */
  enqueue(record: Db4PrintRecord): 'queued' | 'already_queued' | 'already_sent' | 'already_poisoned' {
    const sha = record.sourceSha256;
    if (!SHA256.test(sha)) throw new Error('A job must be keyed by a 64-character hex sha256 of its source bytes.');

    if (existsSync(this.sentPath(sha))) {
      this.logger.info('outbox.already_sent', { sha });
      return 'already_sent';
    }
    if (existsSync(this.poisonPath(sha))) {
      // The server has already said "never" about these exact bytes. Queuing
      // it again would re-attempt (pointlessly — the payload has not
      // changed) and reset the poison TTL on every reprint, which is the same
      // "never actually expires" failure the TTL exists to prevent.
      this.logger.info('outbox.already_poisoned', { sha });
      return 'already_poisoned';
    }
    if (existsSync(this.pendingPath(sha))) {
      this.logger.info('outbox.already_queued', { sha });
      return 'already_queued';
    }

    const at = this.now().toISOString();
    this.writeAtomic(this.pendingPath(sha), { ...this.encodeForStorage(record), enqueuedAt: at, attempts: 0, nextAttemptAt: at });
    this.logger.info('outbox.queued', { sha, template: record.parserTemplateVersion, depth: this.depth() });
    return 'queued';
  }

  /** How many forms are waiting. The number that matters when AoB is unreachable. */
  depth(): number {
    return readdirSync(this.paths.pending).filter((n) => n.endsWith('.json')).length;
  }

  private readFrom(dir: string, sha: string): QueuedJob | null {
    try {
      return JSON.parse(readFileSync(join(dir, `${sha}.json`), 'utf8')) as QueuedJob;
    } catch (err) {
      // Unreadable rather than absent. Left where it is: a job we cannot parse
      // is a job for a human, and deleting it would be the one unrecoverable act.
      this.logger.error('outbox.unreadable', { sha, error: redactError(err) });
      return null;
    }
  }

  private read(sha: string): QueuedJob | null {
    return this.readFrom(this.paths.pending, sha);
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

      let record: Db4PrintRecord;
      try {
        record = this.recordOf(job);
      } catch (err) {
        // A corrupt or undecryptable job is a job for a human, not a reason to
        // abort every other job due this pass. It stays in `pending/` (rule 1
        // of this feature still holds: never deleted) and alarms via `sweep()`
        // once it is old enough.
        this.logger.error('outbox.unreadable', { sha, error: redactError(err) });
        continue;
      }

      this.inFlight.add(sha);
      try {
        const result = await this.post(record);
        const attempts = job.attempts + 1;

        if (result.ok) {
          const postedAt = now.toISOString();
          // Written for every job that lands, on or off: it carries no PII, so
          // there is no reason to wait on the flag that gates the payload
          // itself (rule 5 of this feature).
          this.retention.receipts.record(
            buildReceipt(record, {
              postedAt,
              attempts,
              byteCount: Buffer.byteLength(JSON.stringify(record), 'utf8'),
              state: 'sent',
              jobId: result.jobId,
            }),
          );

          if (this.retention.config.enabled) {
            // No marker: the receipt just written is the durable trace, and it
            // carries no PII. See `sentPath`'s comment and `enqueue`'s note on
            // the one gap this leaves (a rare re-post the server dedups).
            try {
              unlinkSync(this.pendingPath(sha));
            } catch {
              /* tidied next pass */
            }
          } else {
            // The marker goes down BEFORE the pending file comes up, so a crash
            // between the two leaves a sent marker and a stale pending file —
            // which the check above resolves — rather than a job with no record
            // of having been sent.
            this.writeAtomic(this.sentPath(sha), { ...job, attempts, nextAttemptAt: postedAt });
            try {
              unlinkSync(this.pendingPath(sha));
            } catch {
              /* the sent marker is authoritative; a leftover is skipped above */
            }
          }
          sent += 1;
          this.logger.info('outbox.sent', { sha, status: result.status, duplicate: result.duplicate === true });
        } else {
          failed += 1;

          if (this.retention.config.enabled && result.retryable === false) {
            // The server has said, in effect, "never" — a practice id it does
            // not know, a payload it will not take (see `poster.ts`). Left in
            // `pending/` it would sit forever under NO TTL, EVER, which is
            // right for a form that might yet succeed and wrong for one that
            // cannot. `poison/` is the honest place for it: bounded, logged,
            // and its receipt is already written so its existence is not lost
            // when the payload is destroyed.
            const poisonedAt = now.toISOString();
            this.retention.receipts.record(
              buildReceipt(record, {
                postedAt: poisonedAt,
                attempts,
                byteCount: Buffer.byteLength(JSON.stringify(record), 'utf8'),
                state: 'poisoned',
              }),
            );
            this.writeAtomic(this.poisonPath(sha), {
              ...job,
              attempts,
              nextAttemptAt: poisonedAt,
              lastError: result.error ?? `HTTP ${result.status}`,
              poisonedAt,
            });
            try {
              unlinkSync(this.pendingPath(sha));
            } catch {
              /* tidied next pass */
            }
            this.logger.error('outbox.poisoned', {
              sha,
              formReference: record.form?.formReference,
              status: result.status,
              attempts,
              note: 'the server rejected this job outright; it will be destroyed after the poison TTL unless fixed and re-sent by hand',
            });
          } else {
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
        }
      } finally {
        this.inFlight.delete(sha);
      }
    }

    return { sent, failed, waiting: this.depth() };
  }

  /**
   * The pending alarm and the poison TTL. Run once at startup and again on an
   * interval (`main.ts`) — the machine is off overnight, so a job or a
   * poisoned form that aged out at 2am must not survive silently until
   * somebody prints again.
   *
   * PENDING JOBS ARE NEVER DELETED HERE, AT ANY AGE. This loop only ever logs
   * about them. That is the whole point of the tier: a form nobody can post is
   * an alarm, not a candidate for deletion (rule 1 of this feature).
   */
  sweep(): { alarmed: number; expired: number } {
    const now = this.now();
    let alarmed = 0;

    for (const name of readdirSync(this.paths.pending).filter((n) => n.endsWith('.json'))) {
      const sha = name.replace(/\.json$/, '');
      const job = this.read(sha);
      if (!job) continue;
      const ageMs = now.getTime() - new Date(job.enqueuedAt).getTime();
      if (ageMs <= this.retention.config.pendingAlarmMs) continue;
      alarmed += 1;
      this.logger.error('outbox.pending_stale', {
        sha,
        ageMs: Math.round(ageMs),
        attempts: job.attempts,
        note: 'unacknowledged past the alarm threshold; this is never deleted regardless of age',
      });
    }

    let expired = 0;
    if (this.retention.config.enabled) {
      for (const name of readdirSync(this.paths.poison).filter((n) => n.endsWith('.json'))) {
        const sha = name.replace(/\.json$/, '');
        const job = this.readFrom(this.paths.poison, sha);
        if (!job?.poisonedAt) continue;
        const ageMs = now.getTime() - new Date(job.poisonedAt).getTime();
        if (ageMs <= this.retention.config.poisonTtlMs) continue;

        let formReference: string | undefined;
        try {
          formReference = this.recordOf(job).form?.formReference;
        } catch {
          /* undecryptable is still destroyed; its receipt was written when it was poisoned */
        }
        try {
          unlinkSync(this.poisonPath(sha));
        } catch {
          /* tidied next pass */
        }
        expired += 1;
        this.logger.error('outbox.poison_expired', {
          sha,
          formReference,
          ageMs: Math.round(ageMs),
          note: 'destroyed unposted after the poison TTL; its receipt already recorded the rejection',
        });
      }
    }

    return { alarmed, expired };
  }

  /**
   * Run once, only when retention turns on, before anything else in this
   * class looks at `pending/` or `sent/`: a full `sent/` record from before
   * piece 1 landed (see `sentPath`) is reduced to what it should always have
   * been — a receipt — with the record itself deleted, and a plaintext job
   * left in `pending/` from a run before retention existed is encrypted in
   * place.
   *
   * `sent/` FIRST, DELIBERATELY. A crash between writing a `sent/` marker and
   * unlinking the matching `pending/` file (the ordinary case `flush()`
   * already guards against — see its check at the top of the loop) can leave
   * the same sha in both places. Migrating `pending/` first would encrypt
   * that stale copy as if it still needed sending; migrating `sent/` first
   * and clearing its matching `pending/` file the same way `flush()` does
   * means a sha already delivered is never re-queued, re-posted, or given a
   * second receipt line.
   */
  private migrateLegacyPayloads(): void {
    if (existsSync(this.paths.sent)) {
      for (const name of readdirSync(this.paths.sent).filter((n) => n.endsWith('.json'))) {
        const sha = name.replace(/\.json$/, '');
        const job = this.readFrom(this.paths.sent, sha);
        if (job?.record) {
          this.retention.receipts.record(
            buildReceipt(job.record, {
              postedAt: job.nextAttemptAt ?? job.enqueuedAt,
              attempts: job.attempts,
              byteCount: Buffer.byteLength(JSON.stringify(job.record), 'utf8'),
              state: 'sent',
            }),
          );
        }
        try {
          unlinkSync(join(this.paths.sent, name));
        } catch {
          /* tidied next pass */
        }
        // The same dedup `flush()` already does for a marker/pending crash:
        // a sha that is in `sent/` is finished, whatever is left in `pending/`.
        try {
          unlinkSync(this.pendingPath(sha));
        } catch {
          /* nothing pending under this sha, or already gone */
        }
        this.logger.info('outbox.migrated_sent', { sha });
      }
    }

    for (const name of readdirSync(this.paths.pending).filter((n) => n.endsWith('.json'))) {
      const sha = name.replace(/\.json$/, '');
      const job = this.read(sha);
      if (!job || !job.record || !this.retention.cipher) continue;
      const encrypted = this.retention.cipher.encrypt(Buffer.from(JSON.stringify(job.record), 'utf8'));
      this.writeAtomic(this.pendingPath(sha), {
        enqueuedAt: job.enqueuedAt,
        attempts: job.attempts,
        nextAttemptAt: job.nextAttemptAt,
        lastError: job.lastError,
        encrypted,
      });
      this.logger.info('outbox.migrated_pending', { sha });
    }
  }
}
