/**
 * Claiming print jobs off a port that is ONE file path.
 *
 * THE PROBLEM THIS FILE EXISTS FOR. A Windows printer on a file-path local port
 * writes every job to the same file, overwriting the last. Two forms printed
 * ten seconds apart are two writes to `aobprinter-out.pdf`, and the second
 * silently replaces the first. So the file is not a queue and must not be
 * treated as one: it is a slot, and the only safe thing to do with it is to
 * take the contents OUT of the slot, under a unique name, as soon as they are
 * complete. Print queues serialise, which makes this far less fraught than it
 * sounds — but "less fraught" is not "cannot happen", and losing a form is the
 * one failure this program may not have.
 *
 * A HALF-WRITTEN PDF IS NEVER PARSED, and three independent things say so:
 *
 *   1. THE FILE MUST STOP GROWING. Its size is compared across polls and it is
 *      left alone until it has been the same size for `settleMs`.
 *   2. THE RENAME MUST SUCCEED. Windows refuses to rename a file the spooler
 *      still holds open, and that refusal is the operating system telling us
 *      the truth about whether the write has finished. It is treated as "not
 *      yet", never as an error.
 *   3. THE BYTES MUST BE A WHOLE PDF. `%PDF-` at the front and `%%EOF` at the
 *      back. A PDF's trailer is written last, so its presence is the writer's
 *      own statement that it finished.
 *
 * NOTHING HERE TOUCHES THE PRINTING. It reads what the spooler has already
 * written and moves it. If this program is not running, or is broken, or is
 * three hours behind, the practice prints and bills exactly as it does today
 * (hard rule 8) — the worst case is that a form is claimed later.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Db4PrintRecord } from './db4-record';
import { redactError, type Logger } from './log';
import { parseDb4 } from './parser';
import { readPdfText } from './pdf-text';
import { Outbox, sha256Hex } from './outbox';
import type { ParserTemplate } from './template';

/**
 * Is this a complete PDF?
 *
 * The trailer is the last thing a writer emits, so `%%EOF` near the end is the
 * writer saying it finished. Checked in the tail rather than anywhere, because
 * a PDF can legitimately contain the bytes `%%EOF` inside an embedded file.
 */
export function isCompletePdf(bytes: Uint8Array): boolean {
  if (bytes.length < 32) return false;
  const buffer = Buffer.from(bytes);
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') return false;
  return buffer.subarray(Math.max(0, buffer.length - 2048)).toString('latin1').includes('%%EOF');
}

export interface WatcherDirs {
  /** Claimed jobs, waiting to be parsed. */
  readonly jobs: string;
  /** Pages that were not the document the template reads. Parked for a human. */
  readonly unparsed: string;
}

export function watcherDirs(dataDir: string): WatcherDirs {
  return { jobs: join(dataDir, 'jobs'), unparsed: join(dataDir, 'unparsed') };
}

/**
 * A claimed job's filename.
 *
 * TIMESTAMP AND RANDOM BYTES, AND NOTHING ELSE. Not the patient, not the chart
 * number, not the form reference, and above all not the Medicare card number —
 * a filename is the single most-copied piece of text on a computer, it turns up
 * in error messages, backup logs and support emails, and hard rule 9 does not
 * stop at the log file. The hash is not used either: it is not known until the
 * file has been read, and reading it is what claiming makes safe.
 */
export function claimedJobName(now: Date): string {
  return `${now.toISOString().replace(/[:.]/g, '-')}-${randomBytes(6).toString('hex')}.pdf`;
}

/**
 * Watches the one spool path and claims what lands there.
 *
 * Stateful across polls only in the one way it has to be: the size the spool
 * file was last seen at, and when.
 */
export class SpoolClaimer {
  private lastSize: number | null = null;
  private lastChangedAt = 0;

  constructor(
    private readonly spoolFile: string,
    private readonly dirs: WatcherDirs,
    private readonly settleMs: number,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {
    mkdirSync(this.dirs.jobs, { recursive: true });
    mkdirSync(this.dirs.unparsed, { recursive: true });
  }

  /** One look at the slot. Returns the path it was claimed to, or null. */
  claim(): string | null {
    let size: number;
    try {
      size = statSync(this.spoolFile).size;
    } catch {
      this.lastSize = null;
      return null;
    }

    const nowMs = this.now().getTime();
    if (this.lastSize !== size) {
      this.lastSize = size;
      this.lastChangedAt = nowMs;
      return null; // Still growing, or only just appeared.
    }
    if (size === 0) return null;
    if (nowMs - this.lastChangedAt < this.settleMs) return null;

    const target = join(this.dirs.jobs, claimedJobName(this.now()));
    try {
      renameSync(this.spoolFile, target);
    } catch (err) {
      // Held open by the spooler, or gone between the stat and the rename.
      // Both mean "not yet", and neither is a fault worth alarming about.
      this.logger.info('spool.not_ready', { error: redactError(err) });
      return null;
    }

    this.lastSize = null;
    this.logger.info('spool.claimed', { job: target.split(/[\\/]/).pop() ?? '' });
    return target;
  }
}

export type ProcessOutcome = 'queued' | 'already_queued' | 'already_sent' | 'already_poisoned' | 'parked' | 'incomplete';

/**
 * One claimed file → one record in the outbox.
 *
 * THE ORDER IS THE POINT. The record is durably in the outbox before the
 * claimed PDF is deleted, so there is no window in which the form exists
 * nowhere. If the process dies between the two, the next start finds the PDF
 * still in `jobs/`, parses it again, and the outbox's hash key collapses the
 * duplicate.
 */
export function processClaimedJob(
  path: string,
  template: ParserTemplate,
  outbox: Outbox,
  dirs: WatcherDirs,
  logger: Logger,
  now: () => Date = () => new Date(),
): { outcome: ProcessOutcome; record?: Db4PrintRecord } {
  const bytes = readFileSync(path);
  const name = path.split(/[\\/]/).pop() ?? '';

  if (!isCompletePdf(bytes)) {
    // Claimed too early, or the writer died. Parked, never parsed: half a form
    // read as a whole one is the failure that puts a wrong record in front of a
    // patient, and it is the one this program must not have.
    park(path, dirs, logger, 'incomplete_pdf');
    return { outcome: 'incomplete' };
  }

  const sourceSha256 = sha256Hex(bytes);
  const text = readPdfText(bytes);
  if (!text) {
    // No text layer at all: an image-only or encrypted print. Not readable, and
    // saying so is the point — never "the form was blank".
    park(path, dirs, logger, 'no_text_layer');
    return { outcome: 'incomplete' };
  }

  const record = parseDb4(template, { lines: text.lines, sourceSha256, capturedAt: now().toISOString() });
  if (!record) {
    // Somebody printed something else to this queue. It happens, and it is not
    // an error — but nothing is posted for it.
    park(path, dirs, logger, 'not_a_db4');
    return { outcome: 'parked' };
  }

  const outcome = outbox.enqueue(record);
  logger.info('job.parsed', {
    job: name,
    sha: sourceSha256,
    template: record.parserTemplateVersion,
    services: record.services?.length ?? 0,
    providers: record.providers?.length ?? 0,
    outcome,
  });

  // The record is durable now, so the source may go. The practice's own copy is
  // whatever they printed; ours is the record plus its hash (§12a).
  try {
    unlinkSync(path);
  } catch (err) {
    logger.warn('job.cleanup_failed', { job: name, error: redactError(err) });
  }

  return { outcome, record };
}

function park(path: string, dirs: WatcherDirs, logger: Logger, reason: string): void {
  const name = path.split(/[\\/]/).pop() ?? '';
  const target = join(dirs.unparsed, name);
  try {
    renameSync(path, target);
    // A note beside it, so whoever looks does not have to guess. The reason is
    // a code, not a description of the page.
    writeFileSync(`${target}.reason.txt`, `${reason}\n`, 'utf8');
  } catch (err) {
    logger.error('job.park_failed', { job: name, reason, error: redactError(err) });
    return;
  }
  logger.warn('job.parked', { job: name, reason });
}

/** Everything already claimed and not yet parsed — what a restart finds. */
export function claimedJobs(dirs: WatcherDirs): string[] {
  if (!existsSync(dirs.jobs)) return [];
  return readdirSync(dirs.jobs)
    .filter((n) => n.toLowerCase().endsWith('.pdf'))
    .sort()
    .map((n) => join(dirs.jobs, n));
}
