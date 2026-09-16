/**
 * AOBPRINTER — the desktop half of the DB4 print channel.
 *
 * A virtual printer the practice prints its PracSoft DB4 to; the spooled PDF is
 * claimed off a single-slot port, read for its text layer, parsed into a DB4
 * Print Record by a VERSIONED template, and posted to `POST /inbound/print-jobs`
 * through an on-disk outbox that never loses a form and never sends one twice.
 *
 * DB4-AND-AOBL.md §5 and §13 piece 5. The pull half — the signed list, the
 * Write-back Manifest and dropping the Signed-DB4 into the patient folder — is
 * piece 4 and is not here.
 */
export { loadConfig, parseConfig, DEFAULT_CONFIG_PATH, DEFAULT_DATA_DIR, DEFAULT_SPOOL_FILE } from './config';
export type { AobPrinterConfig } from './config';
export { DB4_DOCUMENT_TYPE } from './db4-record';
export type { Db4PrintRecord } from './db4-record';
export { makeLogger, consoleLogger, redact, redactError } from './log';
export type { Logger, LogSink } from './log';
export { start } from './main';
export type { RunHandles } from './main';
export { Outbox, outboxPaths, sha256Hex } from './outbox';
export type { PostResult, Poster } from './outbox';
export { parseDb4 } from './parser';
export type { ParseInput } from './parser';
export { readPdfText } from './pdf-text';
export type { PdfText } from './pdf-text';
export { makeHttpPoster } from './poster';
export { parseTemplate, templateFor, DEFAULT_TEMPLATE_VERSION } from './template';
export type { ParserTemplate } from './template';
export { SpoolClaimer, claimedJobs, claimedJobName, isCompletePdf, processClaimedJob, watcherDirs } from './watcher';
export type { ProcessOutcome, WatcherDirs } from './watcher';
