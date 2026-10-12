/**
 * The 7-day PDF archive (D-2026-09-29-03).
 *
 * WHAT THESE PIN: the archive holds no readable byte of the page; the same
 * print is archived once; nothing is destroyed early; everything is destroyed
 * on time; and both are audit events — so "where is the PDF for this form"
 * always has an answer, even when the answer is "destroyed on the 6th".
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrintArchive } from './archive';
import { decryptPayload, encryptPayload, type EncryptedPayload } from './keystore';
import { makeLogger } from './log';
import type { Cipher } from './retention';
import { openStore, type AobPrinterStore } from './store';

const KEY = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').subarray(0, 32);
const CIPHER: Cipher = { encrypt: (p) => encryptPayload(KEY, p), decrypt: (p) => decryptPayload(KEY, p) };
const SHA = 'd'.repeat(64);
// A page with a patient on it, obviously fake.
const PAGE = Buffer.from('%PDF-1.7 Fakesurname Fakegivenname 1 Imaginary Ave %%EOF', 'latin1');

describe('the PDF archive', () => {
  let dir: string;
  let store: AobPrinterStore;
  let clock: Date;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aobprinter-archive-'));
    clock = new Date('2026-09-29T09:00:00.000Z');
    store = openStore(dir, { cipher: CIPHER, printerVersion: '1.0.0', now: () => clock });
    store.printReceived({ sha: SHA, claimFile: 'claim-1.pdf', queueName: 'AOBPRINTER-Front', byteCount: PAGE.byteLength });
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const archiveFor = (days = 7) => new PrintArchive(dir, store, CIPHER, makeLogger(() => undefined), days, () => clock);

  it('a_captured_pdf_is_archived_encrypted_and_named_by_its_hash', () => {
    const archive = archiveFor();
    archive.keep(SHA, PAGE);

    const path = archive.pathOf(SHA);
    expect(path.endsWith(`${SHA}.pdf.enc`)).toBe(true);
    const onDisk = readFileSync(path, 'utf8');
    for (const word of ['Fakesurname', 'Fakegivenname', 'Imaginary', '%PDF']) expect(onDisk).not.toContain(word);

    // It is the page, recoverable with the key and only with the key.
    expect(CIPHER.decrypt(JSON.parse(onDisk) as EncryptedPayload).equals(PAGE)).toBe(true);

    // And the audit says so, and where.
    const event = store.auditEvents({ subject: SHA }).find((e) => e.kind === 'print.archived')!;
    expect(store.locationOf(event.locationEncrypted!)).toBe(path);
    expect(store.getJob(SHA)?.archivedAt).toBe('2026-09-29T09:00:00.000Z');
  });

  it('the_same_print_is_archived_once', () => {
    const archive = archiveFor();
    archive.keep(SHA, PAGE);
    archive.keep(SHA, PAGE);
    expect(store.auditEvents({ subject: SHA }).filter((e) => e.kind === 'print.archived')).toHaveLength(1);
  });

  it('an_archive_is_kept_for_the_whole_period_and_destroyed_after_it_with_an_event', () => {
    const archive = archiveFor(7);
    archive.keep(SHA, PAGE);

    // Six days and 23 hours: still here.
    clock = new Date(clock.getTime() + (7 * 24 - 1) * 60 * 60 * 1000);
    expect(archive.sweep()).toEqual({ destroyed: 0 });
    expect(existsSync(archive.pathOf(SHA))).toBe(true);

    // Past seven days: gone, recorded, and not destroyed twice.
    clock = new Date(clock.getTime() + 2 * 60 * 60 * 1000);
    expect(archive.sweep()).toEqual({ destroyed: 1 });
    expect(existsSync(archive.pathOf(SHA))).toBe(false);
    expect(store.getJob(SHA)?.archiveDestroyedAt).toBeDefined();
    expect(store.auditEvents({ subject: SHA }).map((e) => e.kind)).toContain('print.archive_destroyed');
    expect(archive.sweep()).toEqual({ destroyed: 0 });
  });

  it('an_archive_the_database_could_not_record_is_not_left_on_disk_forever', () => {
    /*
     * The file was written and renamed, then recording it failed. The sweep
     * only destroys what the database lists, so a file left behind here would
     * outlive the archive period with nothing to find it.
     */
    const failing = Object.create(store) as AobPrinterStore;
    failing.printArchived = () => {
      throw new Error('database is locked');
    };
    const archive = new PrintArchive(dir, failing, CIPHER, makeLogger(() => undefined), 7, () => clock);
    archive.keep(SHA, PAGE);
    expect(existsSync(archive.pathOf(SHA))).toBe(false);
    expect(store.auditEvents({ subject: SHA }).map((e) => e.kind)).toContain('print.archive_failed');
  });

  it('a_failed_archive_write_is_an_event_and_never_stops_capture', () => {
    const broken: Cipher = {
      encrypt: () => {
        throw new Error('disk full');
      },
      decrypt: CIPHER.decrypt,
    };
    const archive = new PrintArchive(dir, store, broken, makeLogger(() => undefined), 7, () => clock);
    expect(() => archive.keep(SHA, PAGE)).not.toThrow();
    expect(store.auditEvents({ subject: SHA }).map((e) => e.kind)).toContain('print.archive_failed');
    expect(existsSync(archive.pathOf(SHA))).toBe(false);
  });
});
