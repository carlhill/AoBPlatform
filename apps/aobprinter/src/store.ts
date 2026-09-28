/**
 * AOBPRINTER's database: one SQLite file per practice, on the host's own disk
 * (D-2026-09-28-04, amended 29 Sep 2026), holding an end-to-end audit trail
 * with no gaps (D-2026-09-29-01).
 *
 * THREE KINDS OF THING, AND THE RULE FOR EACH.
 *  - `prints`: one row per print, for its whole life — received, queued, sent,
 *    or one of two exceptions. Keyed by the hash of the print.
 *  - `returns`: one row per signed form coming back — received, filed,
 *    confirmed, or one of two exceptions. Keyed by agreement and artefact hash.
 *  - `audit_events`: every stage change and every file written, APPEND-ONLY
 *    AND HASH-CHAINED. Triggers refuse any UPDATE or DELETE; an insert whose
 *    `prev_hash` is not the current head is refused; `verifyAuditChain` walks
 *    it. A form that moved without an event cannot exist, because every
 *    transition method here writes its event in the same transaction.
 *
 * ROWS ARE NOT DELETED EITHER. A trigger refuses a DELETE on `prints` and
 * `returns`. When patient data has to go (acknowledged with retention on, or
 * refused and expired — D-2026-09-17-01) the PAYLOAD is removed and the row
 * stays as the audit subject.
 *
 * NO IDENTIFIER VALUE IN PLAIN TEXT (`CLAUDE.md` §6). A return is filed under
 * the chart number, so every file location is encrypted before it is written
 * and decrypted only on this host, by `locationOf`. Form references, hashes,
 * ids, stages and reason codes are not identifiers and are stored as they are.
 *
 * THIS IS THE ONLY FILE THAT WRITES SQL, so a full SQL database later is a
 * second implementation of `OutboxStore` and the transition methods here, not
 * a hunt through the program for queries.
 *
 * ONE PROCESS, ONE HOST, LOCAL DISK. SQLite's own documentation says WAL mode
 * does not work over a network filesystem and that network file locking has
 * corrupted databases. `assertLocalDataDir` refuses anything else at start-up.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite';
import type { Db4PrintRecord } from './db4-record';
import type { EncryptedPayload } from './keystore';
import { redactError, type Logger } from './log';
import type { Receipt, ReceiptsWriter, ReceiptState } from './receipts';
import type { Cipher } from './retention';
import { readPackageVersion } from './version';

export const DB_FILE_NAME = 'aobprinter.db';

/**
 * Held in SQLite's own `PRAGMA user_version`. Going forward is a migration;
 * going BACKWARD — an older build put back on a host — refuses to start
 * rather than half-read a schema it does not know.
 */
export const SCHEMA_VERSION = 1;

/** The last folder-outbox format this build can import. A later one refuses to start. */
export const OUTBOX_FORMAT_VERSION = 1;

/** The hash the first event in a chain points back to. */
export const GENESIS_HASH = '0'.repeat(64);

export type PrintStage = 'received' | 'parse_exception' | 'queued' | 'sent' | 'send_exception';
export type ReturnStage = 'received' | 'received_exception' | 'filed' | 'filing_exception' | 'confirmed';

/** Why a print could not be read. Codes, never a description of the page. */
export type ParseReason = 'incomplete_pdf' | 'no_text_layer' | 'not_a_db4';

/** Why a signed form did not get past a step. Named, so a screen can say which. */
export type ReturnReason = 'unsafe_name' | 'download_failed' | 'hash_mismatch' | 'write_failed' | 'write_verify_failed';

/** Why a payload was removed. */
export type PayloadDestroyedWhy = 'acknowledged' | 'poison_ttl' | 'retention_migration';

export type AuditKind =
  // Out: a print on its way to AoB.
  | 'print.received'
  | 'print.duplicate'
  | 'print.archived'
  | 'print.archive_failed'
  | 'print.archive_destroyed'
  | 'print.parse_exception'
  | 'print.parsed'
  | 'print.queued'
  | 'print.send_retry'
  | 'print.stale'
  | 'print.sent'
  | 'print.send_exception'
  | 'print.payload_encrypted'
  | 'print.payload_destroyed'
  | 'print.imported'
  | 'print.gap'
  | 'print.resolved'
  // Back: a signed form on its way into the PMS.
  | 'return.received'
  | 'return.received_exception'
  | 'return.already_on_disk'
  | 'return.pdf_written'
  | 'return.manifest_written'
  | 'return.filed'
  | 'return.filing_exception'
  | 'return.confirmed'
  | 'return.confirm_failed'
  | 'return.resolved'
  // The program itself — a missing form is explained by the program not running.
  | 'program.started'
  | 'program.stopped'
  | 'program.unclean_restart'
  | 'program.version_changed'
  | 'program.start_failed'
  | 'program.folder_outbox_imported';

export type AuditDirection = 'out' | 'in' | 'program';

/** Scalar details only, named at each call site. Never a spread record — that is how PII rides along. */
export type AuditDetail = Readonly<Record<string, string | number | boolean | null>>;

export interface AuditInput {
  readonly kind: AuditKind;
  readonly direction: AuditDirection;
  /** The print's hash, or `<agreementId>:<artefact hash>` for a return. */
  readonly subject?: string;
  readonly formReference?: string;
  /** The stage the subject is in AFTER this event. */
  readonly stage?: string;
  readonly reason?: string;
  readonly detail?: AuditDetail;
  /** A file location in plain text. Encrypted by the store before it is written; never stored as given. */
  readonly location?: string;
  /**
   * Free text a person typed - a resolution note. ENCRYPTED like a location:
   * the log can never be edited or shredded, and a note is exactly where
   * somebody writes "wrong patient, chart 12345" (CLAUDE.md 6).
   */
  readonly note?: string;
  /** `system`, or who did it by hand. */
  readonly actor?: string;
}

export interface AuditEvent {
  readonly seq: number;
  readonly at: string;
  readonly kind: AuditKind;
  readonly direction: AuditDirection;
  readonly subject?: string;
  readonly formReference?: string;
  readonly stage?: string;
  readonly reason?: string;
  readonly detail?: AuditDetail;
  /** Ciphertext. `locationOf` turns it back into a path, on this host. */
  readonly locationEncrypted?: string;
  /** Ciphertext. `locationOf` decrypts it too - same key, same format. */
  readonly noteEncrypted?: string;
  readonly actor: string;
  readonly printerVersion: string;
  readonly prevHash: string;
  readonly hash: string;
}

/** One print. Exactly one of `record` / `encrypted` while queued; neither once the payload is destroyed. */
export interface StoredJob {
  readonly sha: string;
  readonly stage: PrintStage;
  readonly queueName?: string;
  readonly queueLabel?: string;
  readonly formReference?: string;
  readonly receivedAt: string;
  readonly byteCount?: number;
  readonly parseReason?: ParseReason;
  readonly record?: Db4PrintRecord;
  readonly encrypted?: EncryptedPayload;
  readonly enqueuedAt: string;
  readonly attempts: number;
  /** ISO instant; the job is not tried before this. */
  readonly nextAttemptAt: string;
  readonly lastError?: string;
  /** When it was refused outright, for the poison TTL. */
  readonly poisonedAt?: string;
  readonly sentAt?: string;
  readonly payloadDestroyedAt?: string;
  readonly staleAlarmedAt?: string;
  readonly archiveFile?: string;
  readonly archivedAt?: string;
  readonly archiveDestroyedAt?: string;
  readonly resolvedAt?: string;
  readonly resolvedBy?: string;
  readonly resolutionEncrypted?: string;
}

export interface NewJob {
  readonly sha: string;
  readonly record?: Db4PrintRecord;
  readonly encrypted?: EncryptedPayload;
  readonly enqueuedAt: string;
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly lastError?: string;
  /** Carried on the row for screens; none of these is an identifier. */
  readonly formReference?: string;
  readonly queueName?: string;
  readonly queueLabel?: string;
  readonly parserTemplateVersion?: string;
}

export interface JobProgress {
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly lastError?: string;
}

/** What the outbox needs from storage. The seam a full SQL database would implement. */
export interface OutboxStore {
  jobState(sha: string): PrintStage | undefined;
  /** Throws if the stored payload cannot be read back; the caller decides what that means. */
  getJob(sha: string): StoredJob | undefined;
  /** Put a parsed record in the queue: a new row, or a `received` / `parse_exception` row moving on. */
  queue(job: NewJob): void;
  /** Every sha in a stage, oldest first — for `queued`, the order the practice printed in. `withPayload` skips rows whose payload is gone. */
  shas(stage: PrintStage, options?: { readonly withPayload?: boolean }): string[];
  pendingCount(): number;
  /** Rows in a stage still holding a PLAINTEXT record. Only the retention migration asks. */
  plaintextShas(stage: PrintStage): string[];
  reschedule(sha: string, progress: JobProgress): void;
  markSent(sha: string, progress: JobProgress): void;
  markPoisoned(sha: string, progress: JobProgress & { readonly poisonedAt: string; readonly status?: number }): void;
  replaceWithEncrypted(sha: string, encrypted: EncryptedPayload): void;
  destroyPayload(sha: string, why: PayloadDestroyedWhy): void;
  /** Once per job: the first sweep that finds it past the alarm threshold. Later sweeps still log; the audit records it once. */
  markStale(sha: string, ageMs: number): void;
  /** Fold the write-ahead log into the file and empty it, so deleted plaintext does not linger there. */
  checkpoint(): void;
  /** Several writes, all or none. */
  transaction<T>(work: () => T): T;
}

/** One signed form coming back, as a screen reads it. Locations stay encrypted until `locationOf`. */
export interface StoredReturn {
  readonly agreementId: string;
  readonly sha256: string;
  readonly stage: ReturnStage;
  readonly artefactId?: string;
  readonly formReference?: string;
  readonly firstSeenAt: string;
  readonly receivedAt?: string;
  readonly filedAt?: string;
  readonly confirmedAt?: string;
  readonly reason?: ReturnReason;
  readonly attempts: number;
  readonly pdfLocationEncrypted?: string;
  readonly manifestLocationEncrypted?: string;
  readonly resolvedAt?: string;
  readonly resolvedBy?: string;
  readonly resolutionEncrypted?: string;
}

/** Identifies one signed form coming back. */
export interface ReturnKey {
  readonly agreementId: string;
  readonly sha256: string;
  readonly artefactId?: string;
  /** Only once it has passed the filename check; a refused value is not written down as though it were one. */
  readonly formReference?: string;
}

/** What the collector writes as it goes. Every method writes its audit event with it. */
export interface ReturnsTrail {
  returnReceived(key: ReturnKey): void;
  returnReceivedException(key: ReturnKey, reason: ReturnReason): void;
  returnAlreadyOnDisk(key: ReturnKey, pdfLocation: string): void;
  returnWritten(key: ReturnKey, which: 'pdf' | 'manifest', location: string): void;
  returnFiled(key: ReturnKey, pdfLocation: string, manifestLocation: string): void;
  returnFilingException(key: ReturnKey, reason: ReturnReason): void;
  returnConfirmed(key: ReturnKey): void;
  returnConfirmFailed(key: ReturnKey): void;
}

/** One claimed spool file. */
export interface PrintArrival {
  readonly sha: string;
  /** The claimed file's generated name - what tells a re-read from a reprint. */
  readonly claimFile: string;
  readonly queueName: string;
  readonly queueLabel?: string;
  readonly byteCount: number;
}

/** What the watcher writes as a print is captured. */
export interface PrintsTrail {
  /** `duplicate` when these exact bytes have been received before; the duplicate is recorded, not dropped. */
  /**
   * `reread` when this exact claimed file has been seen before - writes
   * nothing, because nothing new happened. `duplicate` when the same bytes
   * arrive in a NEW claim: the practice printed it again, recorded not dropped.
   */
  printReceived(print: PrintArrival): 'new' | 'duplicate' | 'reread';
  printArchived(sha: string, archiveFile: string, location: string): void;
  printArchiveFailed(sha: string): void;
  printParseException(sha: string, reason: ParseReason, parkedLocation?: string): void;
}

export interface StoreOptions {
  readonly logger?: Logger;
  /** Needed for any event with a location. Without it, such an event is refused rather than written in plain text. */
  readonly cipher?: Cipher;
  readonly printerVersion?: string;
  readonly now?: () => Date;
  /**
   * Runs once the schema is ready and before the folder-outbox import. The
   * program records `program.started` here, so everything this start does -
   * the import included - sits after the marker that explains it.
   */
  readonly beforeImport?: (store: AobPrinterStore) => void;
  /** Runs if the import refuses (a folder from a later build). The program records `program.start_failed` here. */
  readonly afterImportFailed?: (store: AobPrinterStore) => void;
}

const SCHEMA_V1 = `
CREATE TABLE prints (
  sha                     TEXT PRIMARY KEY CHECK (length(sha) = 64 AND sha NOT GLOB '*[^0-9a-f]*'),
  stage                   TEXT NOT NULL CHECK (stage IN ('received', 'parse_exception', 'queued', 'sent', 'send_exception')),
  queue_name              TEXT,
  queue_label             TEXT,
  form_reference          TEXT,
  parser_template_version TEXT,
  received_at             TEXT NOT NULL,
  byte_count              INTEGER,
  parse_reason            TEXT CHECK (parse_reason IS NULL OR parse_reason IN ('incomplete_pdf', 'no_text_layer', 'not_a_db4')),
  record_json             TEXT,
  encrypted_json          TEXT,
  enqueued_at             TEXT,
  attempts                INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at         TEXT,
  last_error              TEXT,
  poisoned_at             TEXT,
  sent_at                 TEXT,
  payload_destroyed_at    TEXT,
  stale_alarmed_at        TEXT,
  archive_file            TEXT,
  archived_at             TEXT,
  archive_destroyed_at    TEXT,
  resolved_at             TEXT,
  resolved_by             TEXT,
  resolution_encrypted    TEXT,
  CHECK (NOT (record_json IS NOT NULL AND encrypted_json IS NOT NULL)),
  CHECK (stage <> 'queued' OR record_json IS NOT NULL OR encrypted_json IS NOT NULL),
  CHECK (stage NOT IN ('received', 'parse_exception') OR (record_json IS NULL AND encrypted_json IS NULL)),
  CHECK (stage <> 'send_exception' OR poisoned_at IS NOT NULL),
  CHECK (stage <> 'parse_exception' OR parse_reason IS NOT NULL)
) STRICT;
CREATE INDEX prints_by_stage ON prints (stage, enqueued_at, sha);

-- Every claimed spool file, by its generated name (a timestamp and random
-- bytes; no PII). A file read twice is a RE-READ - a delete that failed, a
-- crash before cleanup - not the practice printing again.
CREATE TABLE print_claims (
  claim_file TEXT PRIMARY KEY,
  sha        TEXT NOT NULL,
  claimed_at TEXT NOT NULL
) STRICT;
CREATE INDEX prints_by_form ON prints (form_reference);

CREATE TABLE returns (
  agreement_id                TEXT NOT NULL,
  sha256                      TEXT NOT NULL,
  stage                       TEXT NOT NULL CHECK (stage IN ('received', 'received_exception', 'filed', 'filing_exception', 'confirmed')),
  artefact_id                 TEXT,
  form_reference              TEXT,
  first_seen_at               TEXT NOT NULL,
  received_at                 TEXT,
  filed_at                    TEXT,
  confirmed_at                TEXT,
  reason                      TEXT CHECK (reason IS NULL OR reason IN ('unsafe_name', 'download_failed', 'hash_mismatch', 'write_failed', 'write_verify_failed')),
  attempts                    INTEGER NOT NULL DEFAULT 0,
  pdf_location_encrypted      TEXT,
  manifest_location_encrypted TEXT,
  resolved_at                 TEXT,
  resolved_by                 TEXT,
  resolution_encrypted        TEXT,
  PRIMARY KEY (agreement_id, sha256),
  CHECK (stage NOT IN ('received_exception', 'filing_exception') OR reason IS NOT NULL)
) STRICT;
CREATE INDEX returns_by_stage ON returns (stage, first_seen_at);
CREATE INDEX returns_by_form ON returns (form_reference);

CREATE TABLE receipts (
  id                      INTEGER PRIMARY KEY,
  source_sha256           TEXT NOT NULL,
  form_reference          TEXT,
  job_id                  TEXT,
  captured_at             TEXT NOT NULL,
  posted_at               TEXT NOT NULL,
  parser_template_version TEXT NOT NULL,
  printer_version         TEXT NOT NULL,
  queue_name              TEXT,
  queue_label             TEXT,
  byte_count              INTEGER NOT NULL,
  attempts                INTEGER NOT NULL,
  state                   TEXT NOT NULL CHECK (state IN ('sent', 'poisoned')),
  UNIQUE (source_sha256, state, posted_at)
) STRICT;
CREATE INDEX receipts_by_time ON receipts (posted_at);

CREATE TABLE audit_events (
  seq                INTEGER PRIMARY KEY AUTOINCREMENT,
  at                 TEXT NOT NULL,
  kind               TEXT NOT NULL,
  direction          TEXT NOT NULL CHECK (direction IN ('out', 'in', 'program')),
  subject            TEXT,
  form_reference     TEXT,
  stage              TEXT,
  reason             TEXT,
  detail_json        TEXT,
  location_encrypted TEXT,
  note_encrypted     TEXT,
  actor              TEXT NOT NULL,
  printer_version    TEXT NOT NULL,
  prev_hash          TEXT NOT NULL CHECK (length(prev_hash) = 64),
  hash               TEXT NOT NULL UNIQUE CHECK (length(hash) = 64)
) STRICT;
CREATE INDEX audit_by_subject ON audit_events (subject, seq);
CREATE INDEX audit_by_form ON audit_events (form_reference, seq);
CREATE INDEX audit_by_time ON audit_events (at);

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only: an event is never changed'); END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only: an event is never removed'); END;
CREATE TRIGGER audit_events_chain_head BEFORE INSERT ON audit_events
WHEN NEW.prev_hash <> COALESCE((SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1), '${GENESIS_HASH}')
BEGIN SELECT RAISE(ABORT, 'audit_events: prev_hash is not the head of the chain'); END;

CREATE TRIGGER prints_no_delete BEFORE DELETE ON prints
BEGIN SELECT RAISE(ABORT, 'prints are never deleted: destroy the payload, keep the row'); END;
CREATE TRIGGER returns_no_delete BEFORE DELETE ON returns
BEGIN SELECT RAISE(ABORT, 'returns are never deleted'); END;
`;

const text = (value: SQLOutputValue | undefined): string | undefined => (typeof value === 'string' ? value : undefined);
const int = (value: SQLOutputValue | undefined): number => (typeof value === 'number' ? value : Number(value ?? 0));
const optionalInt = (value: SQLOutputValue | undefined): number | undefined => (value === null || value === undefined ? undefined : int(value));

/** The fields an event's hash covers, in a fixed order, so the verifier and the writer can never disagree. */
interface Hashed {
  readonly at: string;
  readonly kind: string;
  readonly direction: string;
  readonly subject?: string;
  readonly formReference?: string;
  readonly stage?: string;
  readonly reason?: string;
  readonly detailJson?: string;
  readonly locationEncrypted?: string;
  readonly noteEncrypted?: string;
  readonly actor: string;
  readonly printerVersion: string;
}

function hashOf(prevHash: string, row: Hashed): string {
  const canonical = JSON.stringify([
    prevHash,
    row.at,
    row.kind,
    row.direction,
    row.subject ?? null,
    row.formReference ?? null,
    row.stage ?? null,
    row.reason ?? null,
    row.detailJson ?? null,
    row.locationEncrypted ?? null,
    row.noteEncrypted ?? null,
    row.actor,
    row.printerVersion,
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** One database, several roles, each role's methods named for what they do. */
export class AobPrinterStore implements OutboxStore, ReceiptsWriter, PrintsTrail, ReturnsTrail {
  private readonly db: DatabaseSync;
  private readonly cipher?: Cipher;
  private readonly printerVersion: string;
  private readonly now: () => Date;

  private constructor(db: DatabaseSync, options: StoreOptions) {
    this.db = db;
    this.cipher = options.cipher;
    this.printerVersion = options.printerVersion ?? readPackageVersion();
    this.now = options.now ?? (() => new Date());
  }

  /** @internal — `openStore` is the only caller. */
  static adopt(db: DatabaseSync, options: StoreOptions): AobPrinterStore {
    return new AobPrinterStore(db, options);
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  transaction<T>(work: () => T): T {
    // Nested calls join the outer transaction rather than failing on BEGIN.
    if (this.db.isTransaction) return work();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      /*
       * SQLite rolls back by itself on some errors (disk full, I/O error), and
       * a ROLLBACK then would throw "no transaction is active" over the real
       * cause. The message must say what actually happened.
       */
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw err;
    }
  }

  checkpoint(): void {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }

  private run(sql: string, ...params: SQLInputValue[]): void {
    this.db.prepare(sql).run(...params);
  }

  private encryptLocation(location: string): string {
    if (!this.cipher) {
      throw new Error('Recording a file location needs the encryption key; refusing to write a location in plain text.');
    }
    return JSON.stringify(this.cipher.encrypt(Buffer.from(location, 'utf8')));
  }

  // ─── The audit chain ──────────────────────────────────────────────────────

  /**
   * Append one event. INSIDE THE CALLER'S TRANSACTION when there is one,
   * which is what makes "a change without its event" impossible: the two
   * commit together or not at all.
   */
  audit(input: AuditInput): AuditEvent {
    return this.transaction(() => {
      const locationEncrypted = input.location === undefined ? undefined : this.encryptLocation(input.location);
      const noteEncrypted = input.note === undefined ? undefined : this.encryptLocation(input.note);
      const prevHash = text(this.db.prepare('SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1').get()?.hash) ?? GENESIS_HASH;
      const detailJson = input.detail === undefined ? undefined : JSON.stringify(input.detail);
      const row: Hashed = {
        at: this.now().toISOString(),
        kind: input.kind,
        direction: input.direction,
        subject: input.subject,
        formReference: input.formReference,
        stage: input.stage,
        reason: input.reason,
        detailJson,
        locationEncrypted,
        noteEncrypted,
        actor: input.actor ?? 'system',
        printerVersion: this.printerVersion,
      };
      const hash = hashOf(prevHash, row);
      const result = this.db
        .prepare(
          `INSERT INTO audit_events (at, kind, direction, subject, form_reference, stage, reason, detail_json,
             location_encrypted, note_encrypted, actor, printer_version, prev_hash, hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.at,
          row.kind,
          row.direction,
          row.subject ?? null,
          row.formReference ?? null,
          row.stage ?? null,
          row.reason ?? null,
          detailJson ?? null,
          locationEncrypted ?? null,
          noteEncrypted ?? null,
          row.actor,
          row.printerVersion,
          prevHash,
          hash,
        );
      return {
        seq: Number(result.lastInsertRowid),
        at: row.at,
        kind: input.kind,
        direction: input.direction,
        subject: input.subject,
        formReference: input.formReference,
        stage: input.stage,
        reason: input.reason,
        detail: input.detail,
        locationEncrypted,
        noteEncrypted,
        actor: row.actor,
        printerVersion: row.printerVersion,
        prevHash,
        hash,
      };
    });
  }

  /** Every event, oldest first, or one subject's, or one form's. */
  auditEvents(filter: { readonly subject?: string; readonly formReference?: string } = {}): AuditEvent[] {
    let where = '';
    const params: string[] = [];
    if (filter.subject !== undefined) {
      where = 'WHERE subject = ?';
      params.push(filter.subject);
    } else if (filter.formReference !== undefined) {
      where = 'WHERE form_reference = ?';
      params.push(filter.formReference);
    }
    return this.db
      .prepare(`SELECT * FROM audit_events ${where} ORDER BY seq`)
      .all(...params)
      .map((r) => ({
        seq: int(r.seq),
        at: String(r.at),
        kind: String(r.kind) as AuditKind,
        direction: String(r.direction) as AuditDirection,
        subject: text(r.subject),
        formReference: text(r.form_reference),
        stage: text(r.stage),
        reason: text(r.reason),
        detail: text(r.detail_json) === undefined ? undefined : (JSON.parse(String(r.detail_json)) as AuditDetail),
        locationEncrypted: text(r.location_encrypted),
        noteEncrypted: text(r.note_encrypted),
        actor: String(r.actor),
        printerVersion: String(r.printer_version),
        prevHash: String(r.prev_hash),
        hash: String(r.hash),
      }));
  }

  /** The newest event's hash — what the heartbeat will carry to the platform. */
  auditHead(): { readonly seq: number; readonly hash: string } {
    const head = this.db.prepare('SELECT seq, hash FROM audit_events ORDER BY seq DESC LIMIT 1').get();
    return head ? { seq: int(head.seq), hash: String(head.hash) } : { seq: 0, hash: GENESIS_HASH };
  }

  /**
   * Walk the whole chain. `ok: false` names the first event that does not
   * follow from the one before it — edited, inserted out of order, or with a
   * predecessor removed.
   *
   * THE STORED JSON IS HASHED AS STORED, not re-serialised from the parsed
   * detail, so a verifier can never disagree with the writer over key order.
   */
  verifyAuditChain(): { readonly ok: true; readonly events: number } | { readonly ok: false; readonly brokenAtSeq: number; readonly why: string } {
    let prev = GENESIS_HASH;
    let count = 0;
    for (const r of this.db.prepare('SELECT * FROM audit_events ORDER BY seq').all()) {
      const seq = int(r.seq);
      if (String(r.prev_hash) !== prev) return { ok: false, brokenAtSeq: seq, why: 'it does not point at the event before it' };
      const recomputed = hashOf(String(r.prev_hash), {
        at: String(r.at),
        kind: String(r.kind),
        direction: String(r.direction),
        subject: text(r.subject),
        formReference: text(r.form_reference),
        stage: text(r.stage),
        reason: text(r.reason),
        detailJson: text(r.detail_json),
        locationEncrypted: text(r.location_encrypted),
        noteEncrypted: text(r.note_encrypted),
        actor: String(r.actor),
        printerVersion: String(r.printer_version),
      });
      if (recomputed !== String(r.hash)) return { ok: false, brokenAtSeq: seq, why: 'its contents do not match its hash' };
      prev = String(r.hash);
      count += 1;
    }
    return { ok: true, events: count };
  }

  /** A stored location, back as a path. On this host, with this key, and nowhere else. */
  locationOf(locationEncrypted: string): string {
    if (!this.cipher) throw new Error('Reading a location needs the encryption key.');
    return this.cipher.decrypt(JSON.parse(locationEncrypted) as EncryptedPayload).toString('utf8');
  }

  // ─── Prints: the outbox, and what the watcher records ─────────────────────

  jobState(sha: string): PrintStage | undefined {
    return text(this.db.prepare('SELECT stage FROM prints WHERE sha = ?').get(sha)?.stage) as PrintStage | undefined;
  }

  getJob(sha: string): StoredJob | undefined {
    const r = this.db.prepare('SELECT * FROM prints WHERE sha = ?').get(sha);
    if (!r) return undefined;
    const recordJson = text(r.record_json);
    const encryptedJson = text(r.encrypted_json);
    return {
      sha,
      stage: String(r.stage) as PrintStage,
      queueName: text(r.queue_name),
      queueLabel: text(r.queue_label),
      formReference: text(r.form_reference),
      receivedAt: String(r.received_at),
      byteCount: optionalInt(r.byte_count),
      parseReason: text(r.parse_reason) as ParseReason | undefined,
      record: recordJson === undefined ? undefined : (JSON.parse(recordJson) as Db4PrintRecord),
      encrypted: encryptedJson === undefined ? undefined : (JSON.parse(encryptedJson) as EncryptedPayload),
      enqueuedAt: text(r.enqueued_at) ?? String(r.received_at),
      attempts: int(r.attempts),
      nextAttemptAt: text(r.next_attempt_at) ?? String(r.received_at),
      lastError: text(r.last_error),
      poisonedAt: text(r.poisoned_at),
      sentAt: text(r.sent_at),
      payloadDestroyedAt: text(r.payload_destroyed_at),
      staleAlarmedAt: text(r.stale_alarmed_at),
      archiveFile: text(r.archive_file),
      archivedAt: text(r.archived_at),
      archiveDestroyedAt: text(r.archive_destroyed_at),
      resolvedAt: text(r.resolved_at),
      resolvedBy: text(r.resolved_by),
      resolutionEncrypted: text(r.resolution_encrypted),
    };
  }

  /** Every print, oldest first. For screens and tests. */
  prints(): StoredJob[] {
    return this.db
      .prepare('SELECT sha FROM prints ORDER BY received_at, sha')
      .all()
      .map((r) => this.getJob(String(r.sha)))
      .filter((job): job is StoredJob => job !== undefined);
  }

  private formReferenceOf(sha: string): string | undefined {
    return text(this.db.prepare('SELECT form_reference FROM prints WHERE sha = ?').get(sha)?.form_reference);
  }

  printReceived(print: PrintArrival): 'new' | 'duplicate' | 'reread' {
    return this.transaction(() => {
      /*
       * THE NAME AND THE BYTES, NOT THE NAME ALONE. A claim taken while the
       * writer was still writing is read again complete under the same name;
       * those are new bytes, and they get their row and their event.
       */
      const claimed = text(this.db.prepare('SELECT sha FROM print_claims WHERE claim_file = ?').get(print.claimFile)?.sha);
      if (claimed === print.sha) return 'reread';
      if (claimed === undefined) {
        this.run('INSERT INTO print_claims (claim_file, sha, claimed_at) VALUES (?, ?, ?)', print.claimFile, print.sha, this.now().toISOString());
      } else {
        this.run('UPDATE print_claims SET sha = ?, claimed_at = ? WHERE claim_file = ?', print.sha, this.now().toISOString(), print.claimFile);
      }
      const existing = this.jobState(print.sha);
      if (existing !== undefined) {
        this.audit({
          kind: 'print.duplicate',
          direction: 'out',
          subject: print.sha,
          formReference: this.formReferenceOf(print.sha),
          stage: existing,
          detail: { queue: print.queueName, bytes: print.byteCount },
        });
        return 'duplicate';
      }
      this.run(
        `INSERT INTO prints (sha, stage, queue_name, queue_label, received_at, byte_count) VALUES (?, 'received', ?, ?, ?, ?)`,
        print.sha,
        print.queueName,
        print.queueLabel ?? null,
        this.now().toISOString(),
        print.byteCount,
      );
      this.audit({ kind: 'print.received', direction: 'out', subject: print.sha, stage: 'received', detail: { queue: print.queueName, bytes: print.byteCount } });
      return 'new';
    });
  }

  printArchived(sha: string, archiveFile: string, location: string): void {
    this.transaction(() => {
      /*
       * A ROW OR NOTHING. The sweep destroys only what a row lists, so an
       * archive recorded against no row would be kept for ever. Throwing
       * makes `PrintArchive.keep` remove the file and say so.
       */
      const updated = this.db.prepare('UPDATE prints SET archive_file = ?, archived_at = ? WHERE sha = ?').run(archiveFile, this.now().toISOString(), sha);
      if (Number(updated.changes) === 0) throw new Error('Archiving a print that has no print row; refusing to record an archive nothing will destroy.');
      this.audit({ kind: 'print.archived', direction: 'out', subject: sha, stage: this.jobState(sha), location });
    });
  }

  printArchiveFailed(sha: string): void {
    this.audit({ kind: 'print.archive_failed', direction: 'out', subject: sha, stage: this.jobState(sha) });
  }

  printParseException(sha: string, reason: ParseReason, parkedLocation?: string): void {
    this.transaction(() => {
      /*
       * ONLY FROM `received`. The same bytes parse the same way, so a print
       * already queued or sent cannot honestly become unreadable — and one
       * already an exception has said so; its duplicate event is the record.
       */
      if (this.jobState(sha) !== 'received') return;
      this.run("UPDATE prints SET stage = 'parse_exception', parse_reason = ? WHERE sha = ?", reason, sha);
      this.audit({ kind: 'print.parse_exception', direction: 'out', subject: sha, stage: 'parse_exception', reason, location: parkedLocation });
    });
  }

  queue(job: NewJob): void {
    this.transaction(() => {
      const existing = this.jobState(job.sha);
      const recordJson = job.record === undefined ? null : JSON.stringify(job.record);
      const encryptedJson = job.encrypted === undefined ? null : JSON.stringify(job.encrypted);
      if (existing === undefined) {
        this.run(
          `INSERT INTO prints (sha, stage, queue_name, queue_label, form_reference, parser_template_version, received_at,
             record_json, encrypted_json, enqueued_at, attempts, next_attempt_at, last_error)
           VALUES (?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          job.sha,
          job.queueName ?? null,
          job.queueLabel ?? null,
          job.formReference ?? null,
          job.parserTemplateVersion ?? null,
          job.enqueuedAt,
          recordJson,
          encryptedJson,
          job.enqueuedAt,
          job.attempts,
          job.nextAttemptAt,
          job.lastError ?? null,
        );
      } else if (existing === 'received' || existing === 'parse_exception') {
        this.run(
          `UPDATE prints SET stage = 'queued', parse_reason = NULL, form_reference = ?, parser_template_version = ?,
             queue_name = COALESCE(queue_name, ?), queue_label = COALESCE(queue_label, ?),
             record_json = ?, encrypted_json = ?, enqueued_at = ?, attempts = ?, next_attempt_at = ?, last_error = ?
           WHERE sha = ?`,
          job.formReference ?? null,
          job.parserTemplateVersion ?? null,
          job.queueName ?? null,
          job.queueLabel ?? null,
          recordJson,
          encryptedJson,
          job.enqueuedAt,
          job.attempts,
          job.nextAttemptAt,
          job.lastError ?? null,
          job.sha,
        );
      } else {
        // The primary key says the same thing; this says it in words.
        throw new Error(`UNIQUE: print ${job.sha.slice(0, 8)} is already ${existing}; it is never queued twice.`);
      }
      this.audit({
        kind: 'print.parsed',
        direction: 'out',
        subject: job.sha,
        formReference: job.formReference,
        stage: 'queued',
        detail: { template: job.parserTemplateVersion ?? null },
      });
      this.audit({ kind: 'print.queued', direction: 'out', subject: job.sha, formReference: job.formReference, stage: 'queued' });
    });
  }

  shas(stage: PrintStage, options: { readonly withPayload?: boolean } = {}): string[] {
    const payload = options.withPayload ? ' AND (record_json IS NOT NULL OR encrypted_json IS NOT NULL)' : '';
    return this.db
      .prepare(`SELECT sha FROM prints WHERE stage = ?${payload} ORDER BY enqueued_at, received_at, sha`)
      .all(stage)
      .map((r) => String(r.sha));
  }

  pendingCount(): number {
    return int(this.db.prepare("SELECT count(*) AS n FROM prints WHERE stage = 'queued'").get()?.n);
  }

  plaintextShas(stage: PrintStage): string[] {
    return this.db
      .prepare('SELECT sha FROM prints WHERE stage = ? AND record_json IS NOT NULL ORDER BY enqueued_at, sha')
      .all(stage)
      .map((r) => String(r.sha));
  }

  reschedule(sha: string, progress: JobProgress): void {
    this.transaction(() => {
      this.run(
        "UPDATE prints SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE sha = ? AND stage = 'queued'",
        progress.attempts,
        progress.nextAttemptAt,
        progress.lastError ?? null,
        sha,
      );
      this.audit({
        kind: 'print.send_retry',
        direction: 'out',
        subject: sha,
        formReference: this.formReferenceOf(sha),
        stage: 'queued',
        detail: { attempts: progress.attempts, nextAttemptAt: progress.nextAttemptAt },
      });
    });
  }

  markSent(sha: string, progress: JobProgress): void {
    this.transaction(() => {
      this.run(
        "UPDATE prints SET stage = 'sent', attempts = ?, next_attempt_at = ?, last_error = NULL, sent_at = ? WHERE sha = ?",
        progress.attempts,
        progress.nextAttemptAt,
        this.now().toISOString(),
        sha,
      );
      this.audit({ kind: 'print.sent', direction: 'out', subject: sha, formReference: this.formReferenceOf(sha), stage: 'sent', detail: { attempts: progress.attempts } });
    });
  }

  markPoisoned(sha: string, progress: JobProgress & { readonly poisonedAt: string; readonly status?: number }): void {
    this.transaction(() => {
      this.run(
        "UPDATE prints SET stage = 'send_exception', attempts = ?, next_attempt_at = ?, last_error = ?, poisoned_at = ? WHERE sha = ?",
        progress.attempts,
        progress.nextAttemptAt,
        progress.lastError ?? null,
        progress.poisonedAt,
        sha,
      );
      this.audit({
        kind: 'print.send_exception',
        direction: 'out',
        subject: sha,
        formReference: this.formReferenceOf(sha),
        stage: 'send_exception',
        reason: progress.status === undefined ? 'refused' : `http_${progress.status}`,
        detail: { attempts: progress.attempts },
      });
    });
  }

  replaceWithEncrypted(sha: string, encrypted: EncryptedPayload): void {
    this.transaction(() => {
      this.run('UPDATE prints SET record_json = NULL, encrypted_json = ? WHERE sha = ?', JSON.stringify(encrypted), sha);
      this.audit({ kind: 'print.payload_encrypted', direction: 'out', subject: sha, formReference: this.formReferenceOf(sha), stage: this.jobState(sha) });
    });
  }

  destroyPayload(sha: string, why: PayloadDestroyedWhy): void {
    this.transaction(() => {
      this.run('UPDATE prints SET record_json = NULL, encrypted_json = NULL, payload_destroyed_at = ? WHERE sha = ?', this.now().toISOString(), sha);
      this.audit({ kind: 'print.payload_destroyed', direction: 'out', subject: sha, formReference: this.formReferenceOf(sha), stage: this.jobState(sha), reason: why });
    });
  }

  markStale(sha: string, ageMs: number): void {
    this.transaction(() => {
      const already = text(this.db.prepare('SELECT stale_alarmed_at FROM prints WHERE sha = ?').get(sha)?.stale_alarmed_at);
      if (already !== undefined) return;
      this.run('UPDATE prints SET stale_alarmed_at = ? WHERE sha = ?', this.now().toISOString(), sha);
      this.audit({ kind: 'print.stale', direction: 'out', subject: sha, formReference: this.formReferenceOf(sha), stage: 'queued', detail: { ageMs: Math.round(ageMs) } });
    });
  }

  /** Archives older than `cutoff` that are still on disk. */
  archivesBefore(cutoff: string): { readonly sha: string; readonly archiveFile: string }[] {
    return this.db
      .prepare('SELECT sha, archive_file FROM prints WHERE archive_file IS NOT NULL AND archive_destroyed_at IS NULL AND archived_at < ? ORDER BY archived_at')
      .all(cutoff)
      .map((r) => ({ sha: String(r.sha), archiveFile: String(r.archive_file) }));
  }

  printArchiveDestroyed(sha: string, location: string): void {
    this.transaction(() => {
      this.run('UPDATE prints SET archive_destroyed_at = ? WHERE sha = ?', this.now().toISOString(), sha);
      this.audit({ kind: 'print.archive_destroyed', direction: 'out', subject: sha, formReference: this.formReferenceOf(sha), stage: this.jobState(sha), location });
    });
  }

  /** The reconciler's "printed but never received" — the one gap that can happen before a print has a row. */
  printGap(gap: { readonly queue: string; readonly printed: number; readonly claimed: number; readonly windowStart: string; readonly windowEnd: string }): void {
    this.audit({
      kind: 'print.gap',
      direction: 'out',
      reason: 'printed_not_received',
      detail: {
        queue: gap.queue,
        printed: gap.printed,
        claimed: gap.claimed,
        missing: gap.printed - gap.claimed,
        windowStart: gap.windowStart,
        windowEnd: gap.windowEnd,
      },
    });
  }

  /** A human closes an exception. Who and why are required — an exception closed without either is a gap. */
  resolvePrint(sha: string, actor: string, resolution: string): void {
    if (actor.trim() === '' || resolution.trim() === '') throw new Error('Resolving an exception needs who and why.');
    this.transaction(() => {
      const stage = this.jobState(sha);
      if (stage !== 'parse_exception' && stage !== 'send_exception') throw new Error(`Print ${sha.slice(0, 8)} is ${stage ?? 'unknown'}, not an exception.`);
      this.run(
        'UPDATE prints SET resolved_at = ?, resolved_by = ?, resolution_encrypted = ? WHERE sha = ?',
        this.now().toISOString(),
        actor,
        this.encryptLocation(resolution),
        sha,
      );
      this.audit({ kind: 'print.resolved', direction: 'out', subject: sha, formReference: this.formReferenceOf(sha), stage, actor, note: resolution });
    });
  }

  // ─── Returns: signed forms coming back ────────────────────────────────────

  private returnSubject(key: ReturnKey): string {
    return `${key.agreementId}:${key.sha256}`;
  }

  getReturn(agreementId: string, sha256: string): StoredReturn | undefined {
    const r = this.db.prepare('SELECT * FROM returns WHERE agreement_id = ? AND sha256 = ?').get(agreementId, sha256);
    return r ? this.returnFromRow(r) : undefined;
  }

  returns(): StoredReturn[] {
    return this.db
      .prepare('SELECT * FROM returns ORDER BY first_seen_at, agreement_id')
      .all()
      .map((r) => this.returnFromRow(r));
  }

  private returnFromRow(r: Record<string, SQLOutputValue>): StoredReturn {
    return {
      agreementId: String(r.agreement_id),
      sha256: String(r.sha256),
      stage: String(r.stage) as ReturnStage,
      artefactId: text(r.artefact_id),
      formReference: text(r.form_reference),
      firstSeenAt: String(r.first_seen_at),
      receivedAt: text(r.received_at),
      filedAt: text(r.filed_at),
      confirmedAt: text(r.confirmed_at),
      reason: text(r.reason) as ReturnReason | undefined,
      attempts: int(r.attempts),
      pdfLocationEncrypted: text(r.pdf_location_encrypted),
      manifestLocationEncrypted: text(r.manifest_location_encrypted),
      resolvedAt: text(r.resolved_at),
      resolvedBy: text(r.resolved_by),
      resolutionEncrypted: text(r.resolution_encrypted),
    };
  }

  /**
   * Move a return to a stage, creating its row on first sight. Leaving an
   * exception stage for a later one closes the exception as resolved by the
   * system — the retry worked — and says so in its own event.
   */
  private moveReturn(key: ReturnKey, stage: ReturnStage, reason?: ReturnReason): void {
    const now = this.now().toISOString();
    const existing = this.getReturn(key.agreementId, key.sha256);
    const isException = stage === 'received_exception' || stage === 'filing_exception';
    if (!existing) {
      this.run(
        `INSERT INTO returns (agreement_id, sha256, stage, artefact_id, form_reference, first_seen_at, reason, attempts)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        key.agreementId,
        key.sha256,
        stage,
        key.artefactId ?? null,
        key.formReference ?? null,
        now,
        reason ?? null,
      );
      return;
    }
    const wasException = existing.stage === 'received_exception' || existing.stage === 'filing_exception';
    this.run(
      `UPDATE returns SET stage = ?, reason = ?, attempts = attempts + ?,
         form_reference = COALESCE(form_reference, ?), artefact_id = COALESCE(artefact_id, ?)
       WHERE agreement_id = ? AND sha256 = ?`,
      stage,
      reason ?? null,
      isException || stage === 'received' ? 1 : 0,
      key.formReference ?? null,
      key.artefactId ?? null,
      key.agreementId,
      key.sha256,
    );
    if (wasException && !isException && existing.resolvedAt === undefined) {
      this.run(
        "UPDATE returns SET resolved_at = ?, resolved_by = 'system' WHERE agreement_id = ? AND sha256 = ?",
        now,
        key.agreementId,
        key.sha256,
      );
      this.audit({
        kind: 'return.resolved',
        direction: 'in',
        subject: this.returnSubject(key),
        formReference: key.formReference,
        stage,
        detail: { resolution: 'retried', was: existing.stage },
      });
    }
  }

  returnReceived(key: ReturnKey): void {
    this.transaction(() => {
      this.moveReturn(key, 'received');
      this.run('UPDATE returns SET received_at = ? WHERE agreement_id = ? AND sha256 = ?', this.now().toISOString(), key.agreementId, key.sha256);
      this.audit({
        kind: 'return.received',
        direction: 'in',
        subject: this.returnSubject(key),
        formReference: key.formReference,
        stage: 'received',
        detail: { artefactId: key.artefactId ?? null },
      });
    });
  }

  returnReceivedException(key: ReturnKey, reason: ReturnReason): void {
    this.transaction(() => {
      this.moveReturn(key, 'received_exception', reason);
      this.audit({ kind: 'return.received_exception', direction: 'in', subject: this.returnSubject(key), formReference: key.formReference, stage: 'received_exception', reason });
    });
  }

  returnAlreadyOnDisk(key: ReturnKey, pdfLocation: string): void {
    this.transaction(() => {
      /*
       * THE RESUMABLE CASE: filed, and the confirmation was lost. A return
       * that is already `filed` stays filed — going back to `received` would
       * be a stage that did not happen. One never seen, or last seen as an
       * exception, has now been received.
       */
      const current = this.getReturn(key.agreementId, key.sha256)?.stage;
      if (current === undefined || current === 'received_exception' || current === 'filing_exception') {
        this.moveReturn(key, 'received');
        this.run('UPDATE returns SET received_at = ? WHERE agreement_id = ? AND sha256 = ?', this.now().toISOString(), key.agreementId, key.sha256);
      }
      this.audit({
        kind: 'return.already_on_disk',
        direction: 'in',
        subject: this.returnSubject(key),
        formReference: key.formReference,
        stage: this.getReturn(key.agreementId, key.sha256)?.stage,
        location: pdfLocation,
      });
    });
  }

  returnWritten(key: ReturnKey, which: 'pdf' | 'manifest', location: string): void {
    this.audit({
      kind: which === 'pdf' ? 'return.pdf_written' : 'return.manifest_written',
      direction: 'in',
      subject: this.returnSubject(key),
      formReference: key.formReference,
      stage: this.getReturn(key.agreementId, key.sha256)?.stage,
      location,
    });
  }

  returnFiled(key: ReturnKey, pdfLocation: string, manifestLocation: string): void {
    this.transaction(() => {
      /*
       * ONCE. A sweep retrying a lost confirmation re-verifies the file and
       * lands here again; the stage did not change, so there is no new event.
       * The retry's own events (already on disk, manifest written) say what it did.
       */
      if (this.getReturn(key.agreementId, key.sha256)?.stage === 'filed') return;
      this.moveReturn(key, 'filed');
      this.run(
        'UPDATE returns SET filed_at = ?, pdf_location_encrypted = ?, manifest_location_encrypted = ? WHERE agreement_id = ? AND sha256 = ?',
        this.now().toISOString(),
        this.encryptLocation(pdfLocation),
        this.encryptLocation(manifestLocation),
        key.agreementId,
        key.sha256,
      );
      this.audit({ kind: 'return.filed', direction: 'in', subject: this.returnSubject(key), formReference: key.formReference, stage: 'filed', location: pdfLocation });
    });
  }

  returnFilingException(key: ReturnKey, reason: ReturnReason): void {
    this.transaction(() => {
      this.moveReturn(key, 'filing_exception', reason);
      this.audit({ kind: 'return.filing_exception', direction: 'in', subject: this.returnSubject(key), formReference: key.formReference, stage: 'filing_exception', reason });
    });
  }

  returnConfirmed(key: ReturnKey): void {
    this.transaction(() => {
      this.moveReturn(key, 'confirmed');
      this.run('UPDATE returns SET confirmed_at = ? WHERE agreement_id = ? AND sha256 = ?', this.now().toISOString(), key.agreementId, key.sha256);
      this.audit({ kind: 'return.confirmed', direction: 'in', subject: this.returnSubject(key), formReference: key.formReference, stage: 'confirmed' });
    });
  }

  returnConfirmFailed(key: ReturnKey): void {
    // Not a stage: filed and not yet confirmed IS the state. The next sweep confirms.
    this.audit({
      kind: 'return.confirm_failed',
      direction: 'in',
      subject: this.returnSubject(key),
      formReference: key.formReference,
      stage: this.getReturn(key.agreementId, key.sha256)?.stage,
    });
  }

  resolveReturn(agreementId: string, sha256: string, actor: string, resolution: string): void {
    if (actor.trim() === '' || resolution.trim() === '') throw new Error('Resolving an exception needs who and why.');
    this.transaction(() => {
      const current = this.getReturn(agreementId, sha256);
      if (!current || (current.stage !== 'received_exception' && current.stage !== 'filing_exception')) {
        throw new Error(`Return ${agreementId} is ${current?.stage ?? 'unknown'}, not an exception.`);
      }
      this.run(
        'UPDATE returns SET resolved_at = ?, resolved_by = ?, resolution_encrypted = ? WHERE agreement_id = ? AND sha256 = ?',
        this.now().toISOString(),
        actor,
        this.encryptLocation(resolution),
        agreementId,
        sha256,
      );
      this.audit({
        kind: 'return.resolved',
        direction: 'in',
        subject: `${agreementId}:${sha256}`,
        formReference: current.formReference,
        stage: current.stage,
        actor,
        note: resolution,
      });
    });
  }

  // ─── The program ──────────────────────────────────────────────────────────

  /**
   * Called once at start. An earlier start with no stop after it is an
   * unclean restart — a power cut, a crash, a killed process — and a changed
   * version is an upgrade or a rollback. Both are events, so a gap in
   * capture is explained by the log rather than guessed at.
   */
  programStarted(detail: AuditDetail = {}): void {
    this.transaction(() => {
      const last = this.db
        .prepare("SELECT kind FROM audit_events WHERE kind IN ('program.started', 'program.stopped', 'program.start_failed') ORDER BY seq DESC LIMIT 1")
        .get();
      if (text(last?.kind) === 'program.started') this.audit({ kind: 'program.unclean_restart', direction: 'program' });
      const lastVersion = text(
        this.db.prepare("SELECT printer_version FROM audit_events WHERE kind = 'program.started' ORDER BY seq DESC LIMIT 1").get()?.printer_version,
      );
      if (lastVersion !== undefined && lastVersion !== this.printerVersion) {
        this.audit({ kind: 'program.version_changed', direction: 'program', detail: { from: lastVersion, to: this.printerVersion } });
      }
      this.audit({ kind: 'program.started', direction: 'program', detail });
    });
  }

  programStopped(): void {
    this.audit({ kind: 'program.stopped', direction: 'program' });
  }

  /** A start that recorded `program.started` and then refused. Ends that session cleanly: it never ran. */
  programStartFailed(): void {
    this.audit({ kind: 'program.start_failed', direction: 'program' });
  }

  // ─── Receipts ─────────────────────────────────────────────────────────────

  /**
   * `ReceiptsWriter`. Every field named, as `buildReceipt` names them — a
   * receipt is PII-free because of what this list does NOT contain.
   * IDEMPOTENT ON (sha, state, postedAt), so a re-import does not double a line.
   */
  record(receipt: Receipt): void {
    this.run(
      `INSERT OR IGNORE INTO receipts (source_sha256, form_reference, job_id, captured_at, posted_at,
         parser_template_version, printer_version, queue_name, queue_label, byte_count, attempts, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      receipt.sourceSha256,
      receipt.formReference ?? null,
      receipt.jobId ?? null,
      receipt.capturedAt,
      receipt.postedAt,
      receipt.parserTemplateVersion,
      receipt.printerVersion,
      receipt.queueName ?? null,
      receipt.queueLabel ?? null,
      receipt.byteCount,
      receipt.attempts,
      receipt.state,
    );
  }

  receipts(): Receipt[] {
    return this.db
      .prepare('SELECT * FROM receipts ORDER BY posted_at, id')
      .all()
      .map((r) => ({
        sourceSha256: String(r.source_sha256),
        formReference: text(r.form_reference),
        jobId: text(r.job_id),
        capturedAt: String(r.captured_at),
        postedAt: String(r.posted_at),
        parserTemplateVersion: String(r.parser_template_version),
        printerVersion: String(r.printer_version),
        queueName: text(r.queue_name),
        queueLabel: text(r.queue_label),
        byteCount: int(r.byte_count),
        attempts: int(r.attempts),
        state: String(r.state) as ReceiptState,
      }));
  }

  // ─── The one-time import of a folder outbox ───────────────────────────────

  /** @internal — the folder import's own insert: the row as it was, with one `print.imported` event. */
  importJob(sha: string, stage: 'queued' | 'sent' | 'send_exception', job: LegacyJob, enqueuedAt: string): void {
    this.transaction(() => {
      this.run(
        `INSERT INTO prints (sha, stage, form_reference, parser_template_version, queue_name, queue_label, received_at,
           record_json, encrypted_json, enqueued_at, attempts, next_attempt_at, last_error, poisoned_at, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sha,
        stage,
        job.record?.form?.formReference ?? null,
        job.record?.parserTemplateVersion ?? null,
        job.record?.queueName ?? null,
        job.record?.queueLabel ?? null,
        enqueuedAt,
        job.record === undefined ? null : JSON.stringify(job.record),
        job.encrypted === undefined ? null : JSON.stringify(job.encrypted),
        enqueuedAt,
        job.attempts ?? 0,
        job.nextAttemptAt ?? enqueuedAt,
        job.lastError ?? null,
        stage === 'send_exception' ? (job.poisonedAt ?? enqueuedAt) : null,
        stage === 'sent' ? (job.nextAttemptAt ?? enqueuedAt) : null,
      );
      this.audit({
        kind: 'print.imported',
        direction: 'out',
        subject: sha,
        formReference: job.record?.form?.formReference,
        stage,
        detail: { from: 'folder_outbox', attempts: job.attempts ?? 0 },
      });
    });
  }
}

export function dbPath(dataDir: string): string {
  return join(dataDir, DB_FILE_NAME);
}

/**
 * Open (creating if needed) the database under `dataDir`, bring its schema to
 * this build's version, and import any folder outbox left by a build before
 * this one.
 *
 * DURABILITY. `synchronous = FULL` in WAL mode syncs the log on every commit.
 * That matters here more than anywhere: the watcher deletes the claimed spool
 * PDF once its row is committed, so a commit a power cut could undo is a form
 * that never existed.
 */
export function openStore(dataDir: string, options: StoreOptions = {}): AobPrinterStore {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(dbPath(dataDir), { timeout: 5000 });
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
    /*
     * A DELETED OR OVERWRITTEN VALUE IS ZEROED, NOT LEFT IN A FREE PAGE. It
     * cannot reach blocks an SSD has already remapped, which is why
     * encryption and not deletion is the real protection (D-2026-09-17-01) —
     * but a plaintext record from before retention was switched on should not
     * sit readable in the file after it has been removed.
     */
    db.exec('PRAGMA secure_delete = ON');
    db.enableDefensive(true);
    migrate(db, dbPath(dataDir));
  } catch (err) {
    db.close();
    throw err;
  }
  const store = AobPrinterStore.adopt(db, options);
  try {
    options.beforeImport?.(store);
    try {
      importFolderOutbox(dataDir, store, options.logger);
    } catch (err) {
      // The refusal is what the technician needs; a start failure that cannot be recorded must not replace it.
      try {
        options.afterImportFailed?.(store);
      } catch (recordErr) {
        options.logger?.error('audit.start_failure_not_recorded', { error: redactError(recordErr) });
      }
      throw err;
    }
  } catch (err) {
    store.close();
    throw err;
  }
  return store;
}

function migrate(db: DatabaseSync, file: string): void {
  const onDisk = int(db.prepare('PRAGMA user_version').get()?.user_version);
  if (onDisk > SCHEMA_VERSION) {
    throw new Error(
      `AOBPRINTER refuses to start: ${file} is schema version ${onDisk} but this build only understands ` +
        `schema version ${SCHEMA_VERSION}. A newer build wrote this database. A downgrade must never half-read ` +
        'what a later version wrote — install that build again, or move the database aside once somebody has ' +
        'decided what to do with the forms in it.',
    );
  }
  if (onDisk === SCHEMA_VERSION) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    // Version 0 is a new file. Later versions add their steps here, in order.
    if (onDisk < 1) db.exec(SCHEMA_V1);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
}

/** The folders the outbox used before this file, relative to `dataDir`. */
const LEGACY = { root: 'outbox', pending: 'pending', sent: 'sent', poison: 'poison', tmp: 'tmp', receipts: 'receipts.jsonl' };

/** A job as the folder outbox wrote it. */
export interface LegacyJob {
  readonly formatVersion?: number;
  readonly record?: Db4PrintRecord;
  readonly encrypted?: EncryptedPayload;
  readonly enqueuedAt?: string;
  readonly attempts?: number;
  readonly nextAttemptAt?: string;
  readonly lastError?: string;
  readonly poisonedAt?: string;
}

/**
 * A HOST UPGRADED MID-QUEUE LOSES NOTHING. The first start of this build on a
 * data folder that still has the folder outbox reads every job and receipt
 * into the database, one `print.imported` event each, then removes the files
 * it imported.
 *
 * ORDER, AND IT IS THE FOLDER OUTBOX'S OWN ORDER: `sent/` first, so a sha left
 * in both `sent/` and `pending/` by a crash between the marker and the unlink
 * is imported as sent and never posted twice. Then `poison/`, then `pending/`.
 * A sha already in the database is skipped, so a crash between the commit and
 * the file deletions imports nothing new next time.
 *
 * A FILE IT CANNOT PARSE IS LEFT WHERE IT IS and logged: a job nobody can read
 * is a job for a human, and deleting it would be the one unrecoverable act. A
 * file from a LATER build refuses to start, as the folder outbox did.
 */
function importFolderOutbox(dataDir: string, store: AobPrinterStore, logger?: Logger): void {
  const root = join(dataDir, LEGACY.root);
  if (!existsSync(root)) return;

  const tmp = join(root, LEGACY.tmp);
  if (existsSync(tmp)) {
    // A half-written job whose rename never happened: nothing was promised about it.
    for (const name of readdirSync(tmp)) {
      try {
        unlinkSync(join(tmp, name));
      } catch {
        /* locked; the next start gets it */
      }
    }
  }

  const tiers: { dir: string; stage: 'queued' | 'sent' | 'send_exception' }[] = [
    { dir: join(root, LEGACY.sent), stage: 'sent' },
    { dir: join(root, LEGACY.poison), stage: 'send_exception' },
    { dir: join(root, LEGACY.pending), stage: 'queued' },
  ];

  /*
   * `sent/` BY FILENAME FIRST, BEFORE ANYTHING IS PARSED. The folder outbox
   * treated any `sent/<sha>.json` that EXISTED as sent. A truncated marker
   * beside the stale pending copy from the old crash window must still mean
   * "sent" here, or the pending copy is posted a second time.
   */
  const sentDir = join(root, LEGACY.sent);
  const sentNames = new Set(
    existsSync(sentDir) ? readdirSync(sentDir).filter((n) => /^[0-9a-f]{64}\.json$/.test(n)).map((n) => n.slice(0, 64)) : [],
  );

  const found: { file: string; sha: string; stage: 'queued' | 'sent' | 'send_exception'; job: LegacyJob }[] = [];
  for (const { dir, stage: tierStage } of tiers) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((n) => /^[0-9a-f]{64}\.json$/.test(n))) {
      const file = join(dir, name);
      let job: LegacyJob;
      try {
        job = JSON.parse(readFileSync(file, 'utf8')) as LegacyJob;
      } catch (err) {
        logger?.error('store.import_unreadable', { sha: name.slice(0, 64), error: redactError(err) });
        continue;
      }
      if (typeof job.formatVersion === 'number' && job.formatVersion > OUTBOX_FORMAT_VERSION) {
        throw new Error(
          `AOBPRINTER refuses to start: ${file} is outbox format version ${job.formatVersion} but this build only ` +
            `understands format version ${OUTBOX_FORMAT_VERSION}. A newer build wrote this folder. A downgrade ` +
            'must never half-read a payload written by a later version — install that build again, or move this ' +
            'folder aside once somebody has decided what to do with the forms in it.',
        );
      }
      if ((job.record === undefined) === (job.encrypted === undefined)) {
        logger?.error('store.import_unreadable', { sha: name.slice(0, 64), error: 'neither or both payloads' });
        continue;
      }
      const sha = name.slice(0, 64);
      // A sha with a sent marker is sent, whichever copy is readable.
      found.push({ file, sha, stage: sentNames.has(sha) ? 'sent' : tierStage, job });
    }
  }

  const receiptsFile = join(root, LEGACY.receipts);
  const receipts: Receipt[] = [];
  if (existsSync(receiptsFile)) {
    for (const line of readFileSync(receiptsFile, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        logger?.error('store.import_receipt_unreadable', {});
        continue;
      }
      const receipt = legacyReceipt(parsed);
      if (receipt) receipts.push(receipt);
      else logger?.error('store.import_receipt_unreadable', { note: 'a line with the wrong shape; left in the renamed file' });
    }
  }

  if (found.length === 0 && receipts.length === 0) return;

  let imported = 0;
  store.transaction(() => {
    for (const { sha, stage, job } of found) {
      if (store.jobState(sha) !== undefined) continue;
      store.importJob(sha, stage, job, job.enqueuedAt ?? job.nextAttemptAt ?? new Date(0).toISOString());
      imported += 1;
    }
    for (const receipt of receipts) store.record(receipt);
    store.audit({ kind: 'program.folder_outbox_imported', direction: 'program', detail: { jobs: imported, receipts: receipts.length } });
  });

  // Only after the commit: a crash before here leaves the files, and the next start imports nothing new.
  for (const { file } of found) {
    try {
      unlinkSync(file);
    } catch {
      /* the database is authoritative now; a leftover is skipped next start */
    }
  }
  if (receipts.length > 0) {
    try {
      // Kept, renamed: it holds no patient data, and it is the evidence the import happened.
      renameSync(receiptsFile, `${receiptsFile}.imported`);
    } catch {
      /* INSERT OR IGNORE makes a re-import harmless */
    }
  }
  logger?.info('store.imported_folder_outbox', { jobs: imported, receipts: receipts.length });
}

/**
 * One line of `receipts.jsonl`, checked field by field. THE EARLIEST RECEIPTS
 * BUILD (a16089d) WROTE NO `printerVersion`; those lines import as `unknown`
 * rather than failing the whole import - which would refuse to start on every
 * restart and stop capture completely. A line missing anything else is
 * skipped and logged: it stays in the renamed file for a human.
 */
function legacyReceipt(value: unknown): Receipt | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : undefined);
  const num = (k: string) => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? (r[k] as number) : undefined);
  const sourceSha256 = str('sourceSha256');
  const capturedAt = str('capturedAt');
  const postedAt = str('postedAt');
  const parserTemplateVersion = str('parserTemplateVersion');
  const byteCount = num('byteCount');
  const attempts = num('attempts');
  const state = r.state === 'sent' || r.state === 'poisoned' ? r.state : undefined;
  if (!sourceSha256 || !capturedAt || !postedAt || !parserTemplateVersion || byteCount === undefined || attempts === undefined || !state) {
    return null;
  }
  return {
    sourceSha256,
    formReference: str('formReference'),
    jobId: str('jobId'),
    capturedAt,
    postedAt,
    parserTemplateVersion,
    printerVersion: str('printerVersion') ?? 'unknown',
    queueName: str('queueName'),
    queueLabel: str('queueLabel'),
    byteCount,
    attempts,
    state,
  };
}

/** What Windows says a drive is. `Network` is the one that matters. */
export type DriveType = 'Fixed' | 'Removable' | 'Network' | 'CDRom' | 'Ram' | 'NoRootDirectory' | 'Unknown';

/**
 * A NETWORK PATH IS REFUSED, NOT WARNED ABOUT. The database must sit on the
 * disk of the machine that runs this program (see this file's header), and a
 * warning in a log nobody reads is how a practice ends up with a corrupted
 * outbox on a mapped drive. UNC paths are refused by shape; a drive letter is
 * asked of Windows.
 *
 * AN UNKNOWN FAILS CLOSED (D-2026-09-17-02): if Windows cannot be asked, the
 * program does not start, and the message says why.
 */
export function assertLocalDataDir(dataDir: string, driveTypeOf: (letter: string) => DriveType = windowsDriveType): void {
  const absolute = resolve(dataDir);
  if (/^(\\\\|\/\/)/.test(dataDir) || /^(\\\\|\/\/)/.test(absolute)) {
    throw new Error(
      `AOBPRINTER refuses to start: its data folder ${dataDir} is a network path. The database must be on the ` +
        "host's own disk — SQLite on a network share can corrupt. Run AOBPRINTER on the server itself and point " +
        'dataDir at a local folder there (LAN mode lets every workstation print to it).',
    );
  }
  // The path as given first: off Windows, `resolve('Z:\\x')` is not a drive-letter path at all.
  const drive = /^([A-Za-z]):/.exec(dataDir) ?? /^([A-Za-z]):/.exec(absolute);
  if (!drive) return;
  const letter = drive[1].toUpperCase();
  const type = driveTypeOf(letter);
  if (type === 'Network') {
    throw new Error(
      `AOBPRINTER refuses to start: its data folder ${dataDir} is on ${letter}:, a network drive. The database ` +
        "must be on the host's own disk — SQLite on a network share can corrupt. Point dataDir at a local folder " +
        'on the machine running AOBPRINTER.',
    );
  }
  if (type === 'Unknown') {
    throw new Error(
      `AOBPRINTER refuses to start: it could not confirm that ${letter}: is a local disk. The database must not ` +
        'be on a network drive, and a check that cannot run is not a pass.',
    );
  }
}

const driveTypes = new Map<string, DriveType>();

/**
 * Asks Windows via PowerShell — no native module, the same approach as
 * `keystore.ts`. Remembered per letter for the life of the process: a drive
 * does not change type while the program runs.
 */
function windowsDriveType(letter: string): DriveType {
  if (process.platform !== 'win32') return 'Fixed';
  if (!/^[A-Z]$/.test(letter)) return 'Unknown';
  const known = driveTypes.get(letter);
  if (known) return known;
  const answer = askWindows(letter);
  // An unknown is not remembered: the next start should ask again.
  if (answer !== 'Unknown') driveTypes.set(letter, answer);
  return answer;
}

function askWindows(letter: string): DriveType {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `[System.IO.DriveInfo]::new('${letter}').DriveType.ToString()`],
    { encoding: 'utf8', timeout: 15000, windowsHide: true },
  );
  const answer = result.status === 0 ? result.stdout.trim() : '';
  const types: DriveType[] = ['Fixed', 'Removable', 'Network', 'CDRom', 'Ram', 'NoRootDirectory'];
  return (types as string[]).includes(answer) ? (answer as DriveType) : 'Unknown';
}
