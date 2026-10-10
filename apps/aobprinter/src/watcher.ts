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
 * WHICH IS WHY EACH WORKSTATION GETS ITS OWN SLOT. On a LAN host serving
 * several workstations, "less fraught" stops being true: two receptionists
 * printing within the settle window are two writes to one path, and the first
 * form is gone. `QueueWatcher` below holds one `SpoolClaimer` per configured
 * queue, each with its own port, its own file and its own folders
 * (`config.ts`'s `QueueConfig`). A single-workstation practice is that same
 * list with one entry — one code path, not two.
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
import type { QueueConfig } from './config';
import type { Db4PrintRecord } from './db4-record';
import { redactError, type Logger } from './log';
import { parseDb4 } from './parser';
import { readPdfText } from './pdf-text';
import type { PrintArchive } from './archive';
import { Outbox, sha256Hex } from './outbox';
import type { ParseReason, PrintsTrail } from './store';
import type { ParserTemplate } from './template';

/**
 * Where a captured print is written down (D-2026-09-29-01) and kept
 * (D-2026-09-29-03). Optional so a test of the parser's behaviour need not
 * stand up a database; the program always passes it.
 */
export interface CaptureTrail {
  readonly prints: PrintsTrail;
  readonly archive?: PrintArchive;
}

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

/**
 * Where one queue's claimed and parked files live.
 *
 * ONE SUBDIRECTORY PER QUEUE, AND THE QUEUE NAME IS REQUIRED RATHER THAN
 * DEFAULTED. Two queues sharing `jobs/` would work right up until a restart:
 * the recovery scan (`claimedJobs`) would hand every queue's leftovers to
 * whichever queue asked first, and the record would then be stamped with the
 * wrong room. Attribution that is wrong is worse than attribution that is
 * missing, so the separation is structural — there is no path through this
 * file that can put two queues' files in one folder.
 */
export function watcherDirs(dataDir: string, queueName: string): WatcherDirs {
  return { jobs: join(dataDir, 'jobs', queueName), unparsed: join(dataDir, 'unparsed', queueName) };
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
 * Watches ONE spool path and claims what lands there.
 *
 * Stateful across polls only in the one way it has to be: the size the spool
 * file was last seen at, and when. That state is per instance, which is what
 * makes several of them — one per configured queue, built by `QueueWatcher` —
 * correct without changing anything here: one queue's file growing says
 * nothing about another's.
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

/** One queue, its own folders, its own claimer. What `QueueWatcher` holds one of per configured queue. */
export interface WatchedQueue {
  readonly queue: QueueConfig;
  readonly dirs: WatcherDirs;
}

/**
 * Every configured queue, watched independently, on one loop.
 *
 * WHY ONE PROCESS AND SEVERAL CLAIMERS RATHER THAN SEVERAL PROCESSES. Each
 * `SpoolClaimer` already carries all the state a queue needs (the size it
 * last saw and when), so "one per queue" needs nothing new from it. What one
 * process buys is a single outbox, a single instance lock and a single
 * version — the alternative is N processes racing over one `pending/` folder,
 * which is the problem this whole design is avoiding, not solving.
 *
 * ONE QUEUE CANNOT STARVE ANOTHER. `claimAll` asks every claimer on every
 * tick and collects what each returns; a queue whose spool file is still
 * growing returns null and holds nobody up, and a claimer that throws would
 * be caught by the loop's own catch-all (`main.ts`) rather than stopping the
 * others. There is no shared state between claimers to contend over.
 */
export class QueueWatcher {
  private readonly claimers: { readonly watched: WatchedQueue; readonly claimer: SpoolClaimer }[];

  constructor(
    queues: readonly QueueConfig[],
    dataDir: string,
    settleMs: number,
    private readonly logger: Logger,
    now: () => Date = () => new Date(),
  ) {
    if (queues.length === 0) {
      throw new Error('AOBPRINTER was started with no print queues to watch. A host with no queue captures nothing.');
    }
    this.claimers = queues.map((queue) => {
      const dirs = watcherDirs(dataDir, queue.name);
      return { watched: { queue, dirs }, claimer: new SpoolClaimer(queue.spoolFile, dirs, settleMs, logger, now) };
    });
    this.recoverPreQueueJobs(dataDir);
  }

  /** Every queue and its folders, for the recovery scan a restart does. */
  get watched(): readonly WatchedQueue[] {
    return this.claimers.map((c) => c.watched);
  }

  /** One look at every slot. Returns each queue that had something in it. */
  claimAll(): { queue: QueueConfig; path: string }[] {
    const claimed: { queue: QueueConfig; path: string }[] = [];
    for (const { watched, claimer } of this.claimers) {
      const path = claimer.claim();
      if (path !== null) claimed.push({ queue: watched.queue, path });
    }
    return claimed;
  }

  /**
   * A form claimed by a build from before queues existed.
   *
   * Claimed jobs used to sit directly in `<dataDir>/jobs`; they now sit in
   * `<dataDir>/jobs/<queue>`. An upgrade that happened while a PDF was
   * claimed-but-not-yet-parsed would otherwise leave that form in a folder
   * nothing scans — a form lost to a version number, which is precisely what
   * this program may not do.
   *
   * MOVED ONLY WHEN THERE IS ONE QUEUE, because only then is the answer
   * knowable: a single-queue install upgrading is the only way these files
   * can exist. With several queues configured, guessing which room a form
   * came from would be inventing attribution, so it is left where it is and
   * said out loud. Nothing here deletes anything.
   */
  private recoverPreQueueJobs(dataDir: string): void {
    const legacy = join(dataDir, 'jobs');
    let names: string[];
    try {
      names = readdirSync(legacy, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.pdf'))
        .map((e) => e.name);
    } catch {
      return; // No jobs folder yet: a fresh install.
    }
    if (names.length === 0) return;

    if (this.claimers.length > 1) {
      this.logger.error('jobs.pre_queue_files_left', {
        count: names.length,
        path: legacy,
        note: 'claimed forms from a build before per-queue folders, and this host has several queues; move them into the right jobs/<queue> folder by hand — nothing has been deleted',
      });
      return;
    }

    const target = this.claimers[0].watched.dirs.jobs;
    for (const name of names) {
      try {
        renameSync(join(legacy, name), join(target, name));
      } catch (err) {
        this.logger.error('jobs.pre_queue_move_failed', { job: name, error: redactError(err) });
      }
    }
    this.logger.warn('jobs.pre_queue_recovered', {
      count: names.length,
      queue: this.claimers[0].watched.queue.name,
      note: 'claimed forms from a build before per-queue folders, moved into this queue so they are still parsed',
    });
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
 *
 * AND THE AUDIT COMES FIRST (D-2026-09-29-01). `received` is written before
 * anything is decided about the page, then the encrypted archive, then the
 * outcome — so a print that is later unreadable still has a row and a story,
 * and a print received twice is recorded as a duplicate rather than dropped.
 */
export function processClaimedJob(
  path: string,
  template: ParserTemplate,
  outbox: Outbox,
  dirs: WatcherDirs,
  queue: QueueConfig,
  logger: Logger,
  now: () => Date = () => new Date(),
  trail?: CaptureTrail,
): { outcome: ProcessOutcome; record?: Db4PrintRecord } {
  const bytes = readFileSync(path);
  const name = path.split(/[\\/]/).pop() ?? '';
  const sourceSha256 = sha256Hex(bytes);

  if (trail) {
    /*
     * THE CLAIMED FILE'S NAME TELLS A RE-READ FROM A REPRINT. The same file
     * read again (its delete failed, or a crash came before cleanup) is not
     * the practice printing again, and writes nothing; the same bytes in a
     * new claim are a real duplicate and are recorded.
     */
    trail.prints.printReceived({ sha: sourceSha256, claimFile: name, queueName: queue.name, queueLabel: queue.label, byteCount: bytes.byteLength });
    // Idempotent: a print already archived is not archived again.
    trail.archive?.keep(sourceSha256, bytes);
  }

  if (!isCompletePdf(bytes)) {
    // Claimed too early, or the writer died. Parked, never parsed: half a form
    // read as a whole one is the failure that puts a wrong record in front of a
    // patient, and it is the one this program must not have.
    park(path, dirs, logger, 'incomplete_pdf', trail, sourceSha256);
    return { outcome: 'incomplete' };
  }

  const text = readPdfText(bytes);
  if (!text) {
    // No text layer at all: an image-only or encrypted print. Not readable, and
    // saying so is the point — never "the form was blank".
    park(path, dirs, logger, 'no_text_layer', trail, sourceSha256);
    return { outcome: 'incomplete' };
  }

  const parsed = parseDb4(template, { lines: text.lines, sourceSha256, capturedAt: now().toISOString() });
  if (!parsed) {
    // Somebody printed something else to this queue. It happens, and it is not
    // an error — but nothing is posted for it.
    park(path, dirs, logger, 'not_a_db4', trail, sourceSha256);
    return { outcome: 'parked' };
  }

  /*
   * THE QUEUE IS STAMPED HERE, NOT IN THE PARSER. The parser's whole rule is
   * that it reports what is on the page and never adds to it (`parser.ts`);
   * which printer the page arrived through is not on the page, it is
   * something only this layer knows. Kept as attribution, never as an
   * identifier — see `db4-record.ts`.
   */
  const record: Db4PrintRecord = { ...parsed, queueName: queue.name, queueLabel: queue.label };

  const outcome = outbox.enqueue(record);
  logger.info('job.parsed', {
    job: name,
    sha: sourceSha256,
    template: record.parserTemplateVersion,
    queue: queue.name,
    services: record.services?.length ?? 0,
    // A count, never the lines themselves (D-2026-10-11-01): non-zero is a
    // form core will refuse to send to a tablet.
    unparsedServiceLines: record.unparsedServiceLines ?? 0,
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

function park(path: string, dirs: WatcherDirs, logger: Logger, reason: ParseReason, trail?: CaptureTrail, sha?: string): void {
  const name = path.split(/[\\/]/).pop() ?? '';
  const target = join(dirs.unparsed, name);
  try {
    /*
     * CREATED HERE, NOT ASSUMED. The claimer makes this folder at start, but a
     * folder somebody tidied away would leave the print in `jobs/`, re-read
     * every tick — and, since the audit trail, a duplicate event every tick.
     */
    mkdirSync(dirs.unparsed, { recursive: true });
    renameSync(path, target);
    // A note beside it, so whoever looks does not have to guess. The reason is
    // a code, not a description of the page.
    writeFileSync(`${target}.reason.txt`, `${reason}\n`, 'utf8');
  } catch (err) {
    logger.error('job.park_failed', { job: name, reason, error: redactError(err) });
    // Still an exception in the audit: the print was unreadable whether or not the move worked.
    if (trail && sha) trail.prints.printParseException(sha, reason);
    return;
  }
  logger.warn('job.parked', { job: name, reason });
  if (trail && sha) trail.prints.printParseException(sha, reason, target);
}

/** Everything already claimed and not yet parsed — what a restart finds. */
export function claimedJobs(dirs: WatcherDirs): string[] {
  if (!existsSync(dirs.jobs)) return [];
  return readdirSync(dirs.jobs)
    .filter((n) => n.toLowerCase().endsWith('.pdf'))
    .sort()
    .map((n) => join(dirs.jobs, n));
}
