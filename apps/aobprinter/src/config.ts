/**
 * Where AOBPRINTER is pointed, and at whom.
 *
 * NOTHING HERE IS IN CODE OR IN A FIXTURE (CLAUDE.md §7). The practice id and
 * the endpoint are per-install facts that the installer writes and an
 * administrator can change; a build with a practice baked into it is a build
 * that can only be installed once.
 *
 * TRANSPORT IS AN OPEN GAP, AND IT IS SAID OUT LOUD RATHER THAN INVENTED.
 * `aob-tech-stack.md` gives the site connector outbound-only MUTUAL TLS with a
 * per-practice credential, revocable from the console, and AOBPRINTER is a
 * connector that happens to read a print spool instead of an API — so it should
 * have the same posture. It does not yet: this build sends the `x-practice-id`
 * header the endpoint already takes, over whatever the configured URL says.
 * That is enough to prove the channel on a bench and is NOT enough for a
 * practice. The certificate fields below are where the credential goes; they
 * are unread until the decision is made, and the program says so at startup.
 */
import { readFileSync } from 'node:fs';
import { AOBPRINTER_HEARTBEAT_INTERVAL } from '@aobplatform/contracts';
import { looksLikeAnIdentifier } from './log';
import { DEFAULT_TEMPLATE_VERSION } from './template';

/**
 * One print queue: one Windows printer, one file-path port, one spool file.
 *
 * WHY THERE IS A LIST OF THESE AND NOT ONE SPOOL PATH. A file-path port is a
 * SLOT, not a queue: every job overwrites the last (`watcher.ts`). One
 * AOBPRINTER host serving several workstations over the LAN through a single
 * shared spool file would therefore destroy a form whenever two people print
 * within the settle window — the second write lands on top of the first
 * before the watcher has claimed it. So each workstation gets its own queue,
 * its own port and its own file. A single-workstation practice is this same
 * list with exactly one entry: ONE code path, never two, because the
 * single-queue path is the one that gets tested and the LAN path is the one
 * that would quietly rot.
 */
export interface QueueConfig {
  /** The Windows printer name. Also what the spooler's own event log calls it, which is how reconciliation matches. */
  readonly name: string;
  /** The file-path port this queue writes to. Never shared with another queue — that IS the bug this shape prevents. */
  readonly spoolFile: string;
  /** Practice-chosen attribution shown against a form: "Room 3", "Front desk". Never a patient identifier. */
  readonly label: string;
}

export interface AobPrinterConfig {
  /** The practice this install belongs to. Sent as `x-practice-id`. */
  readonly practiceId: string;
  /** Full URL of `POST /inbound/print-jobs`. */
  readonly endpoint: string;
  /** Every queue this host watches. Never empty; a single-queue install is a one-entry list. */
  readonly queues: readonly QueueConfig[];
  /** Where claimed jobs, the outbox and the log live. */
  readonly dataDir: string;
  /** How often the spool file is looked at. */
  readonly pollMs: number;
  /** How long a job must stop growing before it is claimed. */
  readonly settleMs: number;
  readonly templateVersion: string;
  /** Reserved for the mutual-TLS credential; unread until that decision lands. */
  readonly clientCertPath?: string;
  readonly clientKeyPath?: string;
  /** Local retention of the outbox's own payloads. See `RetentionConfig`. */
  readonly retention: RetentionConfig;
  /** Filing signed forms back into the PMS. See `CollectionConfig`. */
  readonly collection: CollectionConfig;
  /** Telling the platform this host is alive and what it holds. See `HeartbeatConfig`. */
  readonly heartbeat: HeartbeatConfig;
}

/**
 * THE HEARTBEAT (PRINTER-HEARTBEAT.md, D-2026-10-10-02).
 *
 * `enabled` DEFAULTS TO TRUE, the opposite of collection and retention, and
 * for the reason those two are off: they write or delete things a practice
 * cares about, and this writes nothing anywhere but a request to the platform
 * (decision 11). An install upgrading to this build starts beating.
 *
 * THE INTERVAL IS BOUNDED BY THE CONTRACT, NOT BY A LITERAL HERE: 15 s to
 * 10 min, every minute by default, and outside that the program refuses to
 * start (decision 1). The platform judges staleness at the interval the host
 * reports, so the two sides read one set of numbers.
 */
export interface HeartbeatConfig {
  readonly enabled: boolean;
  readonly intervalMs: number;
  /** How long after start the first beat goes. */
  readonly firstDelayMs: number;
}

/**
 * WRITE-BACK BY COLLECTION -- where signed forms are filed, and whether this
 * install files them at all (GA-PLAN B13; Carl, 28 September 2026: *"build
 * the import-folder write-back"*).
 *
 * `enabled` DEFAULTS TO FALSE, and the reason has the same shape as
 * retention's. This half writes into a folder a PMS is WATCHING: whatever
 * lands there is filed into a patient's record by the practice's own
 * software, so an install pointed at the wrong folder does not fail -- it
 * files. An existing install upgrading to this build must therefore do
 * nothing new until somebody has said where, and confirmed that the chart
 * number is what those folders are named for (DB4-AND-AOBL.md 6a).
 *
 * THE PLATFORM HOLDS THE OTHER HALF OF THAT GATE. `documentFolderKey` on the
 * practice is null until the same question is answered there, and the waiting
 * list is empty until it is set -- so a desktop switched on early collects
 * nothing rather than filing into a guess. Two gates for one question,
 * deliberately: the answer has to be true at both ends.
 */
export interface CollectionConfig {
  readonly enabled: boolean;
  /**
   * The PMS's document-import root. Patient folders are created UNDER it and
   * never beside it, and nothing outside it is ever written -- the folder and
   * the filename come off the wire, so `collector.ts` refuses any value that
   * is not a plain name.
   */
  readonly importFolder: string;
  /** How often the platform is asked what is waiting. Minutes, not seconds. */
  readonly pollMs: number;
}

/**
 * How long a form's OWN copy is kept on this desktop after it is no longer
 * needed to prove delivery.
 *
 * `enabled` DEFAULTS TO FALSE, ON PURPOSE, AND THE REASON IS RECORDED HERE
 * RATHER THAN LEFT TO BE REDISCOVERED. Measured 17 September 2026: the
 * server's `ValidationPipe` whitelist strips a DB4 Print Record's body at the
 * door and the lane worker discards it, so `outbox/sent/<sha>.json` on this
 * desktop is today THE ONLY COMPLETE COPY of a posted form anywhere in the
 * platform (TODO.md, "AOBPRINTER landed", item 3; see the comment on
 * `sentPath` in `outbox.ts`). Deleting it on ack before that server-side piece
 * lands would acknowledge a form and then lose it — worse than the PII-on-disk
 * problem this feature exists to fix. Once the platform side lands, this flips
 * on and `sent/` starts emptying itself.
 *
 * WITH IT OFF: `pending/` and `sent/` behave exactly as before this feature —
 * unencrypted, `sent/` never swept. Receipts are still written (they carry no
 * PII, so there is no reason to wait) and a stale `pending/` job still alarms
 * (an unacknowledged form is worth knowing about whether or not retention is
 * on).
 *
 * WITH IT ON: `pending/` and any new `poison/` payload are encrypted at rest;
 * `sent/` is deleted immediately on acknowledgement rather than kept; a
 * non-retryable rejection moves to `poison/` and is destroyed after
 * `poisonTtlMs`, logged loudly.
 */
export interface RetentionConfig {
  readonly enabled: boolean;
  /**
   * How long an unacknowledged `pending/` job may go without being logged at
   * error level. NOT A TTL — nothing in `pending/` is ever deleted by age, at
   * any value of this number, whether or not retention is enabled. A form
   * nobody can post is an alarm, not a candidate for deletion (rule 1 of this
   * feature).
   */
  readonly pendingAlarmMs: number;
  /** How long a job the server has rejected outright sits in `poison/` before it is destroyed. Only enforced when `enabled`. */
  readonly poisonTtlMs: number;
  /** How often the sweep (the alarm check, and the poison TTL) runs, besides the one run at startup. */
  readonly sweepIntervalMs: number;
  /**
   * How many days a captured PDF is kept, encrypted, in `archive/`
   * (D-2026-09-29-03). Applies whether or not `enabled` is true — the archive
   * is always encrypted, so it does not wait on that flag.
   */
  readonly archiveDays: number;
}

/**
 * THE ARCHIVE'S BOUNDS. Seven days is Carl's number. Thirty is the ceiling,
 * and it is Claude's, recorded in D-2026-09-29-03: a typo should not keep
 * patient PDFs for years. Below one day the archive would not survive a
 * weekend, which is what it is for.
 */
export const ARCHIVE_DAYS_DEFAULT = 7;
export const ARCHIVE_DAYS_MAX = 30;

/**
 * Once `retention.enabled` is true, nothing this feature can actually delete
 * may take longer than this to go. `pending/` IS NOT COVERED — it has no TTL
 * at any value, by design (rule 1 of this feature; `pendingAlarmMs` above is
 * capped to this number too, but only as a sanity bound on an alarm
 * threshold, not as a claim that pending jobs are ever removed by age.
 * `poisonTtlMs` is checked once per sweep, so the true worst case before a
 * poisoned payload is gone is `poisonTtlMs + sweepIntervalMs` — validation
 * below caps that SUM, not `poisonTtlMs` alone, so a large `sweepIntervalMs`
 * cannot quietly stretch the real retention window past 24 hours.
 */
export const RETENTION_HARD_CAP_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  enabled: false,
  pendingAlarmMs: 60 * 60 * 1000,
  poisonTtlMs: 60 * 60 * 1000,
  sweepIntervalMs: 5 * 60 * 1000,
  archiveDays: ARCHIVE_DAYS_DEFAULT,
};

/**
 * OFF, AND POINTED NOWHERE. An install that has not been told where to file
 * must not guess at a path, and a default that happened to exist on one
 * desktop would be the worst possible kind of working.
 */
export const DEFAULT_COLLECTION_CONFIG: CollectionConfig = {
  enabled: false,
  importFolder: '',
  pollMs: 5 * 60 * 1000,
};

/** On, every minute, the first beat five seconds after start (decisions 1 and 11). */
export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  enabled: true,
  intervalMs: AOBPRINTER_HEARTBEAT_INTERVAL.defaultMs,
  firstDelayMs: AOBPRINTER_HEARTBEAT_INTERVAL.firstDelayMs,
};

export const DEFAULT_DATA_DIR = 'C:\\ProgramData\\AoBPlatform';
export const DEFAULT_SPOOL_FILE = 'C:\\ProgramData\\AoBPlatform\\spool\\aobprinter-out.pdf';
export const DEFAULT_CONFIG_PATH = 'C:\\ProgramData\\AoBPlatform\\aobprinter.config.json';

/**
 * `why` exists so a queue's missing field does not explain itself by talking
 * about the practice id. The default is the original sentence, unchanged, for
 * the two fields it was written about.
 */
function requireString(
  raw: Record<string, unknown>,
  key: string,
  path: string,
  why = 'AOBPRINTER will not start without it: a practice id and an endpoint are per-install configuration and are never defaulted.',
): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} is missing "${key}". ${why}`);
  }
  return value.trim();
}

function optionalNumber(raw: Record<string, unknown>, key: string, fallback: number): number {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`"${key}" must be a positive number of milliseconds.`);
  }
  return value;
}

/**
 * `retention`, validated the same way as everything above it: present or not,
 * but never half-shaped.
 */
function parseRetention(raw: unknown, path: string): RetentionConfig {
  if (raw === undefined) return DEFAULT_RETENTION_CONFIG;
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path}: "retention" must be a JSON object when present.`);
  }
  const doc = raw as Record<string, unknown>;

  const enabled = doc.enabled === undefined ? false : doc.enabled;
  if (typeof enabled !== 'boolean') {
    throw new Error(`${path}: "retention.enabled" must be a boolean.`);
  }

  const pendingAlarmMs = optionalNumber(doc, 'pendingAlarmMs', DEFAULT_RETENTION_CONFIG.pendingAlarmMs);
  const poisonTtlMs = optionalNumber(doc, 'poisonTtlMs', DEFAULT_RETENTION_CONFIG.poisonTtlMs);
  const sweepIntervalMs = optionalNumber(doc, 'sweepIntervalMs', DEFAULT_RETENTION_CONFIG.sweepIntervalMs);
  // Not `optionalNumber`: its message speaks of milliseconds, and this is days.
  const archiveDays = doc.archiveDays === undefined ? DEFAULT_RETENTION_CONFIG.archiveDays : doc.archiveDays;
  if (typeof archiveDays !== 'number' || !Number.isInteger(archiveDays) || archiveDays < 1 || archiveDays > ARCHIVE_DAYS_MAX) {
    throw new Error(`${path}: "retention.archiveDays" must be a whole number of days from 1 to ${ARCHIVE_DAYS_MAX}.`);
  }

  /*
   * THE HARD CAP APPLIES ONLY ONCE RETENTION IS SWITCHED ON. Disabled, these
   * numbers govern nothing but a log threshold and a sweep's pace and cannot
   * cause anything to be kept, so there is nothing to cap. Enabled:
   *
   * - `pendingAlarmMs` is capped on its own — not because `pending/` is ever
   *   deleted by age (it never is, at any value: rule 1 of this feature), but
   *   as a sanity bound on the alarm threshold itself.
   * - `poisonTtlMs` IS a real deletion timer, but it is only CHECKED once per
   *   sweep — a poisoned job that ages past `poisonTtlMs` one second after a
   *   sweep just ran waits out the rest of `sweepIntervalMs` before the next
   *   one catches it. So the cap is on `poisonTtlMs + sweepIntervalMs`, the
   *   true worst case, not on `poisonTtlMs` alone — an uncapped sweep interval
   *   would otherwise let a large one quietly stretch real retention past 24
   *   hours without either individual number looking wrong.
   */
  if (enabled) {
    if (pendingAlarmMs > RETENTION_HARD_CAP_MS) {
      throw new Error(
        `${path}: "retention.pendingAlarmMs" may not exceed 24 hours (${RETENTION_HARD_CAP_MS}ms) once retention is enabled.`,
      );
    }
    if (poisonTtlMs + sweepIntervalMs > RETENTION_HARD_CAP_MS) {
      throw new Error(
        `${path}: "retention.poisonTtlMs" plus "retention.sweepIntervalMs" may not together exceed 24 hours ` +
          `(${RETENTION_HARD_CAP_MS}ms) once retention is enabled — a poisoned job is only actually swept once per ` +
          'interval, so the sum is the real worst-case time before it is destroyed.',
      );
    }
  }

  return { enabled, pendingAlarmMs, poisonTtlMs, sweepIntervalMs, archiveDays };
}

/** The one-entry list a config written before LAN mode existed describes. */
const LEGACY_QUEUE_NAME = 'default';
const LEGACY_QUEUE_LABEL = 'AOBPRINTER';

/**
 * The queue list, or the single-queue install expressed as one.
 *
 * BACKWARD COMPATIBILITY IS NOT OPTIONAL HERE. Every config file written
 * before this feature says `spoolFile` and nothing about queues, and a
 * practice's config is not ours to rewrite on their disk. Such a file
 * synthesises a one-entry list and behaves exactly as it did — the same code
 * path the LAN install uses, just with one entry in it.
 *
 * TWO QUEUES MAY NEVER SHARE A SPOOL FILE, and that is checked rather than
 * documented: two `SpoolClaimer`s racing for one slot is the precise failure
 * this whole feature exists to prevent, and a copy-pasted config entry is how
 * it would arrive in real life.
 */
function parseQueues(doc: Record<string, unknown>, path: string): readonly QueueConfig[] {
  if (doc.queues === undefined) {
    return [
      {
        name: LEGACY_QUEUE_NAME,
        spoolFile: typeof doc.spoolFile === 'string' && doc.spoolFile.trim().length > 0 ? doc.spoolFile.trim() : DEFAULT_SPOOL_FILE,
        label: LEGACY_QUEUE_LABEL,
      },
    ];
  }

  if (!Array.isArray(doc.queues) || doc.queues.length === 0) {
    throw new Error(
      `${path}: "queues" must be a non-empty JSON array of { "name", "spoolFile", "label" }. A host with no ` +
        'queue watches nothing; remove the key entirely to keep the single-queue default.',
    );
  }

  const queues: QueueConfig[] = [];
  const names = new Set<string>();
  const spoolFiles = new Set<string>();

  doc.queues.forEach((entry, index) => {
    const where = `${path}: queue ${index + 1}`;
    if (typeof entry !== 'object' || entry === null) throw new Error(`${where} is not a JSON object.`);
    const q = entry as Record<string, unknown>;

    const name = requireString(q, 'name', where, 'Every queue is named after the Windows printer that feeds it.');
    const spoolFile = requireString(
      q,
      'spoolFile',
      where,
      'Every queue watches its own file-path port; there is no default path for a named queue.',
    );
    const label = typeof q.label === 'string' && q.label.trim().length > 0 ? q.label.trim() : name;

    if (names.has(name)) throw new Error(`${where}: two queues are both named "${name}". A queue name is how a form says where it came from.`);
    if (spoolFiles.has(spoolFile)) {
      throw new Error(
        `${where}: "${spoolFile}" is already another queue's spool file. Two queues sharing one file-path port ` +
          'is how a printed form is destroyed before it is claimed — every queue gets its own path.',
      );
    }

    /*
     * A QUEUE LABEL IS ATTRIBUTION, NEVER A PATIENT. It travels on the record,
     * into receipts, and into log lines about which queue produced a form, so
     * a practice that typed a card number into it would have put a patient
     * identifier in all three (hard rule 9). Refused at load, loudly, rather
     * than redacted quietly — `log.ts`'s `looksLikeAnIdentifier` is the same
     * test the redactor applies, asked as a question.
     */
    for (const [field, value] of [['name', name], ['label', label]] as const) {
      if (looksLikeAnIdentifier(value)) {
        throw new Error(
          `${where}: "${field}" looks like a patient identifier. A queue label is practice-chosen attribution ` +
            "text (e.g. 'Room 3'), never a patient identifier — it is written to logs and receipts.",
        );
      }
    }

    names.add(name);
    spoolFiles.add(spoolFile);
    queues.push({ name, spoolFile, label });
  });

  return queues;
}

export function parseConfig(raw: unknown, path: string): AobPrinterConfig {
  if (typeof raw !== 'object' || raw === null) throw new Error(`${path} is not a JSON object.`);
  const doc = raw as Record<string, unknown>;

  return {
    practiceId: requireString(doc, 'practiceId', path),
    endpoint: requireString(doc, 'endpoint', path),
    queues: parseQueues(doc, path),
    dataDir: typeof doc.dataDir === 'string' ? doc.dataDir : DEFAULT_DATA_DIR,
    pollMs: optionalNumber(doc, 'pollMs', 500),
    settleMs: optionalNumber(doc, 'settleMs', 750),
    templateVersion: typeof doc.templateVersion === 'string' ? doc.templateVersion : DEFAULT_TEMPLATE_VERSION,
    clientCertPath: typeof doc.clientCertPath === 'string' ? doc.clientCertPath : undefined,
    clientKeyPath: typeof doc.clientKeyPath === 'string' ? doc.clientKeyPath : undefined,
    retention: parseRetention(doc.retention, path),
    collection: parseCollection(doc.collection, path),
    heartbeat: parseHeartbeat(doc.heartbeat, path),
  };
}

/**
 * `heartbeat`, present or absent, never half-shaped — and AN INTERVAL OUTSIDE
 * THE AGREED RANGE IS A REFUSAL TO START (decision 1). Too fast and a
 * practice's link notices; too slow and the console says "stale" about a host
 * that is fine, which teaches people to ignore it.
 */
function parseHeartbeat(raw: unknown, path: string): HeartbeatConfig {
  if (raw === undefined) return DEFAULT_HEARTBEAT_CONFIG;
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path}: "heartbeat" must be a JSON object when present.`);
  }
  const doc = raw as Record<string, unknown>;

  const enabled = doc.enabled === undefined ? DEFAULT_HEARTBEAT_CONFIG.enabled : doc.enabled;
  if (typeof enabled !== 'boolean') {
    throw new Error(`${path}: "heartbeat.enabled" must be a boolean.`);
  }
  const { minMs, maxMs } = AOBPRINTER_HEARTBEAT_INTERVAL;
  const intervalMs = doc.intervalMs === undefined ? DEFAULT_HEARTBEAT_CONFIG.intervalMs : doc.intervalMs;
  if (typeof intervalMs !== 'number' || !Number.isInteger(intervalMs) || intervalMs < minMs || intervalMs > maxMs) {
    throw new Error(
      `${path}: "heartbeat.intervalMs" must be a whole number of milliseconds from ${minMs} to ${maxMs} (15 seconds to 10 minutes).`,
    );
  }
  const firstDelayMs = optionalNumber(doc, 'firstDelayMs', DEFAULT_HEARTBEAT_CONFIG.firstDelayMs);

  return { enabled, intervalMs, firstDelayMs };
}

/**
 * `collection`, validated like everything else: present or absent, never
 * half-shaped -- and ENABLED WITHOUT A FOLDER IS A REFUSAL TO START rather
 * than a quiet no-op. An administrator who switched this on and left the path
 * blank believes signed forms are being filed; a program that agreed by doing
 * nothing would let them believe it for months.
 */
function parseCollection(raw: unknown, path: string): CollectionConfig {
  if (raw === undefined) return DEFAULT_COLLECTION_CONFIG;
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path}: "collection" must be a JSON object when present.`);
  }
  const doc = raw as Record<string, unknown>;

  const enabled = doc.enabled === undefined ? false : doc.enabled;
  if (typeof enabled !== 'boolean') {
    throw new Error(`${path}: "collection.enabled" must be a boolean.`);
  }
  const importFolder = typeof doc.importFolder === 'string' ? doc.importFolder.trim() : '';
  if (enabled && importFolder.length === 0) {
    throw new Error(
      `${path}: "collection.enabled" is true but "collection.importFolder" is empty. ` +
        'Signed forms are filed into the PMS document-import folder and there is no default for it.',
    );
  }
  const pollMs = optionalNumber(doc, 'pollMs', DEFAULT_COLLECTION_CONFIG.pollMs);

  return { enabled, importFolder, pollMs };
}

export function loadConfig(path = process.env.AOBPRINTER_CONFIG ?? DEFAULT_CONFIG_PATH): AobPrinterConfig {
  return parseConfig(JSON.parse(readFileSync(path, 'utf8')), path);
}
