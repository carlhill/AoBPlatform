/**
 * The outbox: a table that must never lose a form and never send one twice.
 *
 * WHY STORED AND NOT A QUEUE IN MEMORY. The practice prints, the receptionist
 * hands the patient a tablet, and somewhere in between this program can be
 * killed by a reboot, an antivirus update, or somebody closing a window. A form
 * that existed only in a process is gone, and what is lost is not a message —
 * it is the practice's record that a service was rendered and consent is due.
 * The record is committed to the database BEFORE the first attempt, and only
 * moved on once the server has said 202.
 *
 * WHY A TABLE AND NOT THE FOLDERS THIS USED TO BE (D-2026-09-28-04). Until 29
 * September 2026 this was `outbox/pending|sent|poison/<sha>.json`. The rules
 * are unchanged; what changed is that a state transition is now one
 * transaction instead of a write, a rename and an unlink — so the crash
 * windows between them, which the folder version had to detect and repair,
 * no longer exist. `store.ts` imports any folder outbox on first start.
 *
 * WHY THE KEY IS THE HASH. `sourceSha256` — the hash of the spool bytes the
 * driver saw — is the idempotency key end to end: it is the primary key here,
 * it is what the server dedups on, and it is what a dispute uses to tie this
 * record to that printing. Two claims of the same bytes collapse to one row,
 * and a re-post of a form already sent cannot happen because its row already
 * says so. It is also safe to log: a hash of a page is not the page (hard rule 9).
 *
 * EXACTLY-ONCE IS NOT AVAILABLE, AND THE HONEST VERSION IS SAID HERE. If the
 * process dies after the server has accepted a job and before this commits
 * that, the next run posts it again. That is why the server dedups on
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
import { backoffFor } from '@aobplatform/domain';
import { DEFAULT_RETENTION_CONFIG } from './config';
import type { Db4PrintRecord } from './db4-record';
import { redactError, type Logger } from './log';
import { buildReceipt } from './receipts';
import type { RetentionDeps } from './retention';
import type { OutboxStore, StoredJob } from './store';
import { readPackageVersion } from './version';

export { OUTBOX_FORMAT_VERSION } from './store';

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
   * classified as poisoned rather than retried forever. `true` or absent
   * means keep retrying on the usual backoff — the default when a poster does
   * not say, so nothing is poisoned by a caller that has not been told about
   * the distinction.
   */
  readonly retryable?: boolean;
}

/** What actually talks to AoB. Injected so the outbox can be tested without a server. */
export type Poster = (record: Db4PrintRecord) => Promise<PostResult>;

/** A hex sha256 and nothing else may key a job. */
const SHA256 = /^[0-9a-f]{64}$/;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class Outbox {
  /** Jobs being posted right now, so two timers cannot both take one. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly store: OutboxStore,
    private readonly post: Poster,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
    // Absent retention deps behave exactly as this file did before retention
    // existed: plaintext, sent rows kept forever. A default rather than a
    // required constructor argument so every caller that has not been told
    // about retention still gets that behaviour without being told to.
    private readonly retention: RetentionDeps = { config: DEFAULT_RETENTION_CONFIG, receipts: { record: () => undefined } },
    /**
     * Stamped onto every receipt. Defaulted rather than required, and read
     * from `package.json` rather than passed around as a string nobody can
     * trace back.
     */
    private readonly printerVersion: string = readPackageVersion(),
  ) {
    if (this.retention.config.enabled) this.migrateLegacyPayloads();
  }

  /**
   * Everything a stored job needs to carry — plaintext when retention is off,
   * encrypted when it is on. Never both, and never plaintext while
   * `config.enabled` is true: if the cipher is somehow missing this throws
   * rather than falling back to writing the form unencrypted (rule 3 of this
   * feature).
   */
  private encodeForStorage(record: Db4PrintRecord): Pick<StoredJob, 'record' | 'encrypted'> {
    if (!this.retention.config.enabled) return { record };
    if (!this.retention.cipher) {
      throw new Error('Retention is enabled but no cipher is configured; refusing to write a form to disk unencrypted.');
    }
    return { encrypted: this.retention.cipher.encrypt(Buffer.from(JSON.stringify(record), 'utf8')) };
  }

  /** The record a stored job carries, decrypting it first if that is how it is held. */
  private recordOf(job: StoredJob): Db4PrintRecord {
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
   * THE GAP THE FOLDER VERSION HAD IS CLOSED. It deleted a delivered job's
   * file once retention was on, so a reprint of bytes already delivered was
   * posted again (safely — the server dedups). Rows are never deleted now
   * (D-2026-09-29-01); only the payload is, so a reprint is `already_sent`.
   */
  enqueue(record: Db4PrintRecord): 'queued' | 'already_queued' | 'already_sent' | 'already_poisoned' {
    const sha = record.sourceSha256;
    if (!SHA256.test(sha)) throw new Error('A job must be keyed by a 64-character hex sha256 of its source bytes.');

    const stage = this.store.jobState(sha);
    if (stage === 'sent') {
      this.logger.info('outbox.already_sent', { sha });
      return 'already_sent';
    }
    if (stage === 'send_exception') {
      // The server has already said "never" about these exact bytes. Queuing
      // it again would re-attempt (pointlessly — the payload has not
      // changed) and reset the poison TTL on every reprint, which is the same
      // "never actually expires" failure the TTL exists to prevent.
      this.logger.info('outbox.already_poisoned', { sha });
      return 'already_poisoned';
    }
    if (stage === 'queued') {
      this.logger.info('outbox.already_queued', { sha });
      return 'already_queued';
    }

    // `received` and `parse_exception` move on; a row the watcher never saw is created.
    const at = this.now().toISOString();
    this.store.queue({
      sha,
      ...this.encodeForStorage(record),
      enqueuedAt: at,
      attempts: 0,
      nextAttemptAt: at,
      formReference: record.form?.formReference,
      queueName: record.queueName,
      queueLabel: record.queueLabel,
      parserTemplateVersion: record.parserTemplateVersion,
    });
    this.logger.info('outbox.queued', { sha, template: record.parserTemplateVersion, depth: this.depth() });
    return 'queued';
  }

  /** How many forms are waiting. The number that matters when AoB is unreachable. */
  depth(): number {
    return this.store.pendingCount();
  }

  /**
   * One job, or null if it cannot be read. Unreadable rather than absent is
   * left where it is: a job we cannot parse is a job for a human, and
   * deleting it would be the one unrecoverable act.
   */
  private read(sha: string): StoredJob | null {
    try {
      return this.store.getJob(sha) ?? null;
    } catch (err) {
      this.logger.error('outbox.unreadable', { sha, error: redactError(err) });
      return null;
    }
  }

  /**
   * Try everything that is due. Returns how many were accepted.
   *
   * ONE PASS, NO PARALLELISM. A practice prints one form at a time and the
   * server answers in milliseconds; posting in sequence, oldest first, keeps
   * the order the practice printed in, which is the order a receptionist
   * expects to see them.
   */
  async flush(): Promise<{ sent: number; failed: number; waiting: number }> {
    const now = this.now();
    let sent = 0;
    let failed = 0;

    for (const sha of this.store.shas('queued')) {
      if (!SHA256.test(sha) || this.inFlight.has(sha)) continue;

      const job = this.read(sha);
      /*
       * THE SECOND HALF OF "NEVER TWICE". A row is in exactly one state, and
       * the state changes in one transaction, so a job already delivered is
       * never in this list — the folder version's "stale pending file beside
       * a sent marker" cannot happen. The check stays because a job can
       * change state between the list being read and this line (a second
       * timer), and "already delivered" outranks any schedule.
       */
      if (!job || job.stage !== 'queued') continue;
      if (new Date(job.nextAttemptAt).getTime() > now.getTime()) continue;

      let record: Db4PrintRecord;
      try {
        record = this.recordOf(job);
      } catch (err) {
        // A corrupt or undecryptable job is a job for a human, not a reason to
        // abort every other job due this pass. It stays pending (rule 1 of
        // this feature still holds: never deleted) and alarms via `sweep()`
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
          /*
           * THE RECEIPT AND THE STATE CHANGE ARE ONE TRANSACTION. The receipt
           * is written for every job that lands, on or off — it carries no
           * PII, so there is no reason to wait on the flag that gates the
           * payload itself (rule 5 of this feature) — and a crash can no
           * longer leave a delivered job with no receipt, or a receipt for a
           * job still marked pending.
           */
          this.store.transaction(() => {
            this.retention.receipts.record(
              buildReceipt(record, {
                postedAt,
                attempts,
                byteCount: Buffer.byteLength(JSON.stringify(record), 'utf8'),
                state: 'sent',
                jobId: result.jobId,
                printerVersion: this.printerVersion,
              }),
            );
            this.store.markSent(sha, { attempts, nextAttemptAt: postedAt });
            if (this.retention.config.enabled) {
              // The patient data goes on acknowledgement; the row stays as the
              // audit subject and the receipt just written is its trace.
              this.store.destroyPayload(sha, 'acknowledged');
            }
          });
          sent += 1;
          this.logger.info('outbox.sent', { sha, status: result.status, duplicate: result.duplicate === true });
        } else {
          failed += 1;

          if (this.retention.config.enabled && result.retryable === false) {
            // The server has said, in effect, "never" — a practice id it does
            // not know, a payload it will not take (see `poster.ts`). Left
            // pending it would sit forever under NO TTL, EVER, which is right
            // for a form that might yet succeed and wrong for one that cannot.
            // Poisoned is the honest state for it: bounded, logged, and its
            // receipt is written in the same transaction so its existence is
            // not lost when the payload is destroyed.
            const poisonedAt = now.toISOString();
            this.store.transaction(() => {
              this.retention.receipts.record(
                buildReceipt(record, {
                  postedAt: poisonedAt,
                  attempts,
                  byteCount: Buffer.byteLength(JSON.stringify(record), 'utf8'),
                  state: 'poisoned',
                  printerVersion: this.printerVersion,
                }),
              );
              this.store.markPoisoned(sha, {
                attempts,
                nextAttemptAt: poisonedAt,
                lastError: result.error ?? `HTTP ${result.status}`,
                poisonedAt,
                status: result.status,
              });
            });
            this.logger.error('outbox.poisoned', {
              sha,
              formReference: record.form?.formReference,
              status: result.status,
              attempts,
              note: 'the server rejected this job outright; it will be destroyed after the poison TTL unless fixed and re-sent by hand',
            });
          } else {
            const waitSeconds = backoffFor(job.attempts);
            this.store.reschedule(sha, {
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

    for (const sha of this.store.shas('queued')) {
      const job = this.read(sha);
      if (!job) continue;
      const ageMs = now.getTime() - new Date(job.enqueuedAt).getTime();
      if (ageMs <= this.retention.config.pendingAlarmMs) continue;
      alarmed += 1;
      // Logged every sweep; recorded in the audit once.
      this.store.markStale(sha, ageMs);
      this.logger.error('outbox.pending_stale', {
        sha,
        ageMs: Math.round(ageMs),
        attempts: job.attempts,
        note: 'unacknowledged past the alarm threshold; this is never deleted regardless of age',
      });
    }

    let expired = 0;
    if (this.retention.config.enabled) {
      for (const sha of this.store.shas('send_exception', { withPayload: true })) {
        const job = this.read(sha);
        if (!job?.poisonedAt) continue;
        const ageMs = now.getTime() - new Date(job.poisonedAt).getTime();
        if (ageMs <= this.retention.config.poisonTtlMs) continue;

        let formReference: string | undefined;
        try {
          formReference = this.recordOf(job).form?.formReference;
        } catch {
          /* undecryptable is still destroyed; its receipt was written when it was poisoned */
        }
        this.store.destroyPayload(sha, 'poison_ttl');
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
   * class reads a job: a full sent row from before retention (see `flush`)
   * is reduced to what it should always have been — a receipt — with the
   * record itself destroyed and the row kept, and a plaintext job still
   * queued from a run before retention existed is encrypted in place.
   *
   * SENT FIRST, AS THE FOLDER VERSION DID. With one state per row a sha can
   * no longer be both sent and pending, so the order no longer guards a
   * crash; it is kept because it is the order that reads correctly.
   */
  private migrateLegacyPayloads(): void {
    this.migrateLegacyRows();
    // The plaintext is out of the tables; this takes it out of the write-ahead log too.
    this.store.checkpoint();
  }

  private migrateLegacyRows(): void {
    for (const sha of this.store.shas('sent', { withPayload: true })) {
      const job = this.read(sha);
      this.store.transaction(() => {
        if (job?.record) {
          this.retention.receipts.record(
            buildReceipt(job.record, {
              postedAt: job.nextAttemptAt || job.enqueuedAt,
              attempts: job.attempts,
              byteCount: Buffer.byteLength(JSON.stringify(job.record), 'utf8'),
              state: 'sent',
              // The build doing the migration, which is the only one that can
              // be stated truthfully: the build that originally posted this
              // form left no version behind to quote.
              printerVersion: this.printerVersion,
            }),
          );
        }
        this.store.destroyPayload(sha, 'retention_migration');
      });
      this.logger.info('outbox.migrated_sent', { sha });
    }

    if (!this.retention.cipher) return;
    for (const sha of this.store.plaintextShas('queued')) {
      const job = this.read(sha);
      if (!job?.record) continue;
      this.store.replaceWithEncrypted(sha, this.retention.cipher.encrypt(Buffer.from(JSON.stringify(job.record), 'utf8')));
      this.logger.info('outbox.migrated_pending', { sha });
    }
  }
}
