/**
 * The PDF archive: every captured print, encrypted, for a few days, in case
 * there are issues (D-2026-09-29-03).
 *
 * Carl: *"PDF should not be deleted once parsed but archived for say 7 days,
 * just in case there are issues."* A parsed DB4 is full of patient data, so
 * this overrides D-2026-09-17-01's 24-hour cap for this one thing, on that
 * decision's own terms: ENCRYPTED at rest under the same key, and DESTROYED on
 * a timer with an audit event that says so.
 *
 * THE FILENAME IS THE HASH, `<sha>.pdf.enc`, so it names nothing. The
 * contents are an `EncryptedPayload` as JSON — no plaintext byte of the page
 * is ever written here.
 *
 * NEITHER HALF MAY STOP CAPTURE (hard rule 8). A write that fails is an
 * audit event and the print carries on; the sweep never throws.
 */
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactError, type Logger } from './log';
import type { Cipher } from './retention';
import type { AobPrinterStore } from './store';

export const ARCHIVE_DIR = 'archive';

export class PrintArchive {
  private readonly dir: string;

  constructor(
    dataDir: string,
    private readonly store: AobPrinterStore,
    private readonly cipher: Cipher,
    private readonly logger: Logger,
    private readonly days: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.dir = join(dataDir, ARCHIVE_DIR);
  }

  /** Where a print's archive lives. */
  pathOf(sha: string): string {
    return join(this.dir, `${sha}.pdf.enc`);
  }

  /**
   * Keep one print. WRITE, THEN RENAME, so a half-written archive never sits
   * under the final name; the audit event is written only once the file is.
   */
  keep(sha: string, bytes: Uint8Array): void {
    const target = this.pathOf(sha);
    const partial = `${target}.part`;
    let renamed = false;
    try {
      // The same bytes printed twice are archived once; the duplicate has its own event.
      if (this.store.getJob(sha)?.archivedAt !== undefined) return;
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(partial, JSON.stringify(this.cipher.encrypt(Buffer.from(bytes))), 'utf8');
      renameSync(partial, target);
      renamed = true;
      this.store.printArchived(sha, `${sha}.pdf.enc`, target);
    } catch (err) {
      try {
        if (existsSync(partial)) unlinkSync(partial);
        /*
         * AN ARCHIVE THE DATABASE DOES NOT KNOW ABOUT IS REMOVED TOO. The
         * sweep only destroys what the database lists, so a file whose record
         * failed would be kept forever — past the period D-2026-09-29-03 sets.
         */
        if (renamed && existsSync(target)) unlinkSync(target);
      } catch {
        /* an encrypted leftover is untidy, never a leak */
      }
      this.logger.error('archive.write_failed', { sha, error: redactError(err) });
      try {
        this.store.printArchiveFailed(sha);
      } catch (auditErr) {
        this.logger.error('archive.audit_failed', { sha, error: redactError(auditErr) });
      }
    }
  }

  /**
   * Destroy what is older than the archive period. Runs on the same sweep as
   * the outbox's alarms; a machine off overnight catches up at start.
   */
  sweep(): { destroyed: number } {
    let destroyed = 0;
    try {
      const cutoff = new Date(this.now().getTime() - this.days * 24 * 60 * 60 * 1000).toISOString();
      for (const { sha, archiveFile } of this.store.archivesBefore(cutoff)) {
        const path = join(this.dir, archiveFile);
        try {
          if (existsSync(path)) unlinkSync(path);
          this.store.printArchiveDestroyed(sha, path);
          destroyed += 1;
        } catch (err) {
          this.logger.error('archive.destroy_failed', { sha, error: redactError(err) });
        }
      }
    } catch (err) {
      this.logger.error('archive.sweep_failed', { error: redactError(err) });
    }
    if (destroyed > 0) this.logger.info('archive.swept', { destroyed, days: this.days });
    return { destroyed };
  }
}
