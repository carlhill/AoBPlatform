/**
 * The other direction: signed forms come back and land in the PMS's
 * document-import folder.
 *
 * Carl, 28 September 2026: *"build the import-folder write-back"*, and
 * *"where do we write the signed copy to send back to [the PMS] (folder)"*.
 *
 * ── WHY THIS PROGRAM AND NOT THE SERVER ──
 *
 * Printing cannot write back — nothing prints *into* a PMS — and REQ-INT-02
 * says write-back is the product. So the installed thing that already reads
 * the practice's print spool closes the loop from the other side: it asks the
 * platform what is signed, downloads it, writes the page and its manifest
 * into the folder, and says it did. Print-capture in, import-folder out, one
 * program and one credential (CONSULTATION-CAPTURE-PLAN.md §8.6).
 *
 * IT IS A PULL, AND THAT IS THE POINT. A practice's network is outbound-only;
 * a server that pushed would need an inbound port on a receptionist's PC
 * (DB4-AND-AOBL.md §6b).
 *
 * ── THE ORDER OF OPERATIONS IS THE WHOLE DESIGN ──
 *
 * Download, verify, write, re-hash what was written, confirm. The confirmation
 * carries the hash of the bytes ON DISK rather than the bytes that arrived,
 * because the platform's `writtenBackAt` is a claim that the practice HOLDS
 * the document — a truncated write, a full disk or something else mangling
 * the file has to be caught here, and is.
 *
 * AT-LEAST-ONCE, LIKE THE OUTBOX AT THE OTHER END. Die after writing and
 * before confirming and the row is still on the list next sweep: the same
 * bytes are written to the same path (a no-op) and the confirmation is made
 * again. The server answers the second one `written: false`. Nothing here
 * needs exactly-once and nothing here pretends to have it.
 *
 * ── WHAT IT REFUSES TO DO ──
 *
 * IT NEVER BUILDS A PATH OUT OF A STRING IT DID NOT CHECK. The folder and the
 * filename come off the wire, and a form reference of `..\..\Windows` would
 * put a signed consent somewhere no one would ever look — or overwrite
 * something. `safeSegment` below is the only way either value becomes a path
 * component, and anything outside a narrow character set is refused and
 * logged rather than cleaned up: a value we had to repair is a value we did
 * not understand, and guessing at where a document goes is the one mistake
 * with no recovery.
 *
 * IT NEVER WRITES A PAGE WHOSE HASH DISAGREES. Hard rule 13 says a later
 * display re-verifies the render; a copy into a patient's permanent record is
 * the same question with more at stake.
 *
 * IT NEVER STOPS THE PRINT LOOP. Every failure here is logged and returned;
 * none of it can prevent the next form being captured (hard rule 8). Filing
 * is the less urgent half — a document filed tomorrow is a nuisance, a
 * consent never captured is the practice's problem.
 *
 * AND NOTHING IT LOGS NAMES A PATIENT. The chart number is the folder, the
 * form reference is the filename, and neither goes in a log line — the
 * agreement id and the first eight of the hash are enough to trace one, which
 * is the same discipline `receipts.ts` keeps (hard rule 9, REQ-LOG-08).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SignedFormForCollection, WriteBackManifest } from '@aobplatform/contracts';
import { redactError, type Logger } from './log';

/**
 * WHAT MAY BE A PATH COMPONENT. Letters, digits, dot, dash, underscore, and
 * nothing else — no separator, no colon, no drive letter, and `..` cannot be
 * expressed because a segment of exactly `.` or `..` is refused below.
 *
 * DELIBERATELY NARROWER THAN WINDOWS ALLOWS. A chart number is a practice's
 * own key and a form reference is PracSoft's; both are alphanumeric in every
 * example anyone has produced. Widening this is a decision to take with a
 * real value in hand, not a convenience to grant in advance.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;

function safeSegment(value: string): string | null {
  if (!SAFE_SEGMENT.test(value)) return null;
  if (value === '.' || value === '..') return null;
  return value;
}

/** What the platform is asked, and told. One place, so the shape cannot drift. */
export interface CollectionClient {
  pending(): Promise<readonly SignedFormForCollection[]>;
  download(artefactId: string): Promise<Uint8Array>;
  confirm(agreementId: string, body: { artefactSha256: string; pmsDocumentKey: string }): Promise<void>;
}

export interface CollectorResult {
  readonly filed: number;
  readonly skipped: number;
  readonly failed: number;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export class Collector {
  constructor(
    private readonly client: CollectionClient,
    private readonly importFolder: string,
    private readonly logger: Logger,
    private readonly printerVersion: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * ONE SWEEP. Ask, and file whatever came back.
   *
   * IT NEVER THROWS. The caller is a timer in `main.ts`, and an unhandled
   * rejection from a timer takes the process down — which would stop the
   * program capturing forms because it could not file one.
   */
  async sweep(): Promise<CollectorResult> {
    let pending: readonly SignedFormForCollection[];
    try {
      pending = await this.client.pending();
    } catch (err) {
      this.logger.warn('collect.list_failed', { error: redactError(err) });
      return { filed: 0, skipped: 0, failed: 0 };
    }
    if (pending.length === 0) return { filed: 0, skipped: 0, failed: 0 };

    let filed = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of pending) {
      const outcome = await this.file(row);
      if (outcome === 'filed') filed += 1;
      else if (outcome === 'skipped') skipped += 1;
      else failed += 1;
    }
    this.logger.info('collect.swept', { waiting: pending.length, filed, skipped, failed });
    return { filed, skipped, failed };
  }

  private async file(row: SignedFormForCollection): Promise<'filed' | 'skipped' | 'failed'> {
    const folder = safeSegment(row.patientRecordNumber);
    const name = safeSegment(row.formReference);
    if (!folder || !name) {
      /*
       * REFUSED, NOT REPAIRED, AND NOT CONFIRMED. The row stays on the
       * platform's list, where FR-9.3's staleness alert finds it after four
       * hours and a human is asked what this practice's folders are really
       * called. Neither value is logged — that is the whole reason the
       * agreement id is.
       */
      this.logger.error('collect.unsafe_name', {
        agreementId: row.agreementId,
        which: !folder ? 'folder' : 'filename',
      });
      return 'failed';
    }

    const directory = join(this.importFolder, folder);
    const pdfPath = join(directory, `${name}.pdf`);
    const manifestPath = join(directory, `${name}.json`);
    /** What the practice would call it, and what the platform records. */
    const pmsDocumentKey = `${folder}/${name}.pdf`;

    try {
      /*
       * ALREADY THERE AND ALREADY RIGHT. The resumable case: a previous sweep
       * wrote the pair and died before confirming, or the confirmation was
       * lost on the wire. Re-downloading would be honest and wasteful, and
       * re-writing a file a PMS may already have picked up would be worse —
       * so the bytes on disk are hashed and, if they are the published ones,
       * only the confirmation is repeated.
       */
      let onDisk = existsSync(pdfPath) ? readFileSync(pdfPath) : null;
      if (onDisk && sha256(onDisk) !== row.sha256) {
        /*
         * A FILE OF THAT NAME THAT IS NOT OURS. Almost certainly a previous
         * version of the same form, superseded and re-rendered. Overwriting
         * is right: the filename is the FORM's reference and the newest
         * signed reproduction of that form is what the record should hold.
         */
        this.logger.info('collect.replacing', { agreementId: row.agreementId });
        onDisk = null;
      }

      if (!onDisk) {
        const downloaded = await this.client.download(row.artefactId);
        if (sha256(downloaded) !== row.sha256) {
          /*
           * HARD RULE 13. What is filed must be the bytes the platform
           * rendered and hashed, or it is not evidence of anything. Nothing
           * is written, nothing is confirmed, and the row stays on the list.
           */
          this.logger.error('collect.hash_mismatch', { agreementId: row.agreementId });
          return 'failed';
        }
        mkdirSync(directory, { recursive: true });
        writeAtomic(pdfPath, Buffer.from(downloaded));
        onDisk = Buffer.from(downloaded);
      }

      const manifest: WriteBackManifest = {
        formReference: row.formReference,
        patientRecordNumber: row.patientRecordNumber,
        agreementId: row.agreementId,
        signedAt: row.signedAt,
        sha256: row.sha256,
        rendererVersion: row.rendererVersion,
        contentVersion: row.contentVersion,
        formCode: row.formCode,
        collectedAt: this.now().toISOString(),
        printerVersion: this.printerVersion,
      };
      mkdirSync(directory, { recursive: true });
      writeAtomic(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));

      /*
       * THE HASH OF WHAT IS ON DISK, RE-READ, NOT OF WHAT ARRIVED. This is
       * the difference between "the platform sent us a document" and "the
       * practice holds that document", and the second is what
       * `writtenBackAt` is going to claim.
       */
      const written = sha256(readFileSync(pdfPath));
      if (written !== row.sha256) {
        this.logger.error('collect.write_verify_failed', { agreementId: row.agreementId });
        return 'failed';
      }

      await this.client.confirm(row.agreementId, { artefactSha256: written, pmsDocumentKey });
      this.logger.info('collect.filed', {
        agreementId: row.agreementId,
        sha: row.sha256.slice(0, 8),
        bytes: onDisk.byteLength,
      });
      return 'filed';
    } catch (err) {
      /*
       * A FAILURE HERE IS A RETRY, NEVER A LOSS. The row stays published
       * until it is confirmed, so an unreachable server, a folder that is not
       * mounted or a disk that is full means this sweep does less — and the
       * next one picks it up. Nothing is discarded and nothing is claimed.
       */
      this.logger.warn('collect.failed', { agreementId: row.agreementId, error: redactError(err) });
      return 'failed';
    }
  }
}

/**
 * WRITE, THEN RENAME. A PMS import folder is watched by something that files
 * whatever appears in it, and a half-written PDF appearing there is a
 * corrupt document in a patient's record. The rename is atomic within a
 * volume, so what appears is always complete.
 *
 * THE TEMPORARY NAME IS NOT THE FINAL ONE PLUS A SUFFIX, deliberately: a
 * watcher globbing `*.pdf` would pick up `x.pdf.tmp` on a loose pattern.
 */
function writeAtomic(path: string, bytes: Buffer): void {
  const temporary = `${path}.part`;
  try {
    writeFileSync(temporary, bytes);
    renameSync(temporary, path);
  } catch (err) {
    try {
      if (existsSync(temporary)) unlinkSync(temporary);
    } catch {
      /* Best effort. A stray `.part` is untidy; failing the write over it is worse. */
    }
    throw err;
  }
}
