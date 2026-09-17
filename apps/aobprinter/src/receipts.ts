/**
 * Receipts, not records: an append-only ledger that answers "did this form
 * get through, and when" forever, without holding the form.
 *
 * THIS IS WHAT MAKES DELETION SAFE. Once `sent/<sha>.json` (a whole DB4 Print
 * Record, Medicare number and all) is gone, the only trace of that form is
 * whatever this file wrote about it. So the fields here are named
 * exhaustively, never spread from the record, and never grown by adding a
 * field to `Db4PrintRecord` without a matching decision here — a receipt
 * that quietly started holding one more field than it does today is the
 * failure this whole feature exists to prevent.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Db4PrintRecord } from './db4-record';

export type ReceiptState = 'sent' | 'poisoned';

export interface Receipt {
  readonly sourceSha256: string;
  readonly formReference?: string;
  /** The server's id for the job, when it gave one (never present for a rejection). */
  readonly jobId?: string;
  readonly capturedAt: string;
  /** When this outcome (delivered, or rejected outright) became final. */
  readonly postedAt: string;
  readonly parserTemplateVersion: string;
  /**
   * WHICH BUILD OF AOBPRINTER POSTED IT. The receipt outlives the form, so a
   * question asked in 2028 about a form captured today — was this the build
   * with the parser bug, was this before or after the template changed — can
   * only be answered if the build is written down here at the time. There is
   * nowhere else left to look once the payload is gone.
   */
  readonly printerVersion: string;
  /** Which print queue produced the form, when the record carried one. Attribution, never PII — see `db4-record.ts`. */
  readonly queueName?: string;
  readonly queueLabel?: string;
  /** Size of the JSON record actually posted. The original spool PDF is already gone by the time this is written (it is deleted the moment its record is durable — see `watcher.ts`). */
  readonly byteCount: number;
  readonly attempts: number;
  readonly state: ReceiptState;
}

export interface ReceiptOutcome {
  readonly postedAt: string;
  readonly attempts: number;
  readonly byteCount: number;
  readonly state: ReceiptState;
  readonly jobId?: string;
  /** Required, not optional: a receipt that cannot say which build wrote it is the gap this field exists to close. */
  readonly printerVersion: string;
}

/**
 * Build a receipt from a record and its outcome.
 *
 * EVERY FIELD IS NAMED HERE, NOT SPREAD FROM THE RECORD. `{ ...record }`
 * would carry forward whatever the parser finds next — a new field on
 * `Db4PrintRecord` would ride along into every receipt ever written from
 * that day, silently, until someone happened to look. Naming exactly what a
 * receipt holds makes "no PII in a receipt" a property of this function,
 * provable by reading it, rather than a promise about what callers remember
 * not to pass in.
 */
export function buildReceipt(record: Db4PrintRecord, outcome: ReceiptOutcome): Receipt {
  return {
    sourceSha256: record.sourceSha256,
    formReference: record.form?.formReference,
    jobId: outcome.jobId,
    capturedAt: record.capturedAt,
    postedAt: outcome.postedAt,
    parserTemplateVersion: record.parserTemplateVersion,
    printerVersion: outcome.printerVersion,
    queueName: record.queueName,
    queueLabel: record.queueLabel,
    byteCount: outcome.byteCount,
    attempts: outcome.attempts,
    state: outcome.state,
  };
}

export function receiptsPath(dataDir: string): string {
  return join(dataDir, 'outbox', 'receipts.jsonl');
}

export function appendReceipt(dataDir: string, receipt: Receipt): void {
  mkdirSync(join(dataDir, 'outbox'), { recursive: true });
  appendFileSync(receiptsPath(dataDir), `${JSON.stringify(receipt)}\n`, 'utf8');
}

/** Where the outbox sends a finished job's receipt. Injectable so a test can read what was written. */
export interface ReceiptsWriter {
  record(receipt: Receipt): void;
}

export function makeFileReceiptsWriter(dataDir: string): ReceiptsWriter {
  return { record: (receipt) => appendReceipt(dataDir, receipt) };
}
