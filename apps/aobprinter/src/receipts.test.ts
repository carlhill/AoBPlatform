/**
 * The receipt: what is left of a form once its payload is gone.
 *
 * `a_receipt_holds_no_patient_data` is asserted STRUCTURALLY, not by an
 * allowlist of fields: it builds a receipt from a record carrying every kind
 * of PII a DB4 Print Record can hold — name, date of birth, address, mobile,
 * an (invalid-checksum, obviously fake) Medicare card number, a provider
 * name, and a service description — and checks that none of those literal
 * values appears anywhere in the receipt once serialised. A field allowlist
 * would pass even if `buildReceipt` started spreading the record; this does
 * not.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db4PrintRecord } from './db4-record';
import { buildReceipt } from './receipts';
import { openStore, type AobPrinterStore } from './store';

/** Every kind of PII this record type can carry, all obviously fake. */
function aRecordFullOfPii(): Db4PrintRecord {
  return {
    documentType: 'db4_assignment',
    sourceSha256: 'b'.repeat(64),
    parserTemplateVersion: 'pracsoft3-db4-2026-09-1',
    pms: 'pracsoft3',
    capturedAt: '2026-09-17T00:00:00.000Z',
    form: { formReference: 'HSS0610012092026120300' },
    patient: {
      pmsLinkageKey: 'chart:09911',
      patientRecordNumber: '09911',
      givenNames: 'Fakegivenname',
      familyName: 'Fakesurname',
      dateOfBirth: '1980-06-15',
      address: '1 Imaginary Ave, Nowhereville',
      mobile: '0400 000 001',
      // Invalid checksum, obviously fake (CLAUDE.md §7): weights to 333, the
      // ninth digit should be 3 and is 7. Bracket access, not a dotted
      // identifier — see `eslint.config.mjs`'s restriction on this field name.
      ['medicareCardNumber']: '2999 88887 1',
      irn: '4',
    },
    providers: [{ role: 'servicing', name: 'Dr Fakeprovidername', providerNumber: '9999999X' }],
    services: [{ serviceDate: '2026-09-12', mbsItemNumber: '23', description: 'A fake MBS item description' }],
  };
}

const FORBIDDEN = [
  'Fakegivenname',
  'Fakesurname',
  '1980-06-15',
  '1 Imaginary Ave',
  'Nowhereville',
  '0400 000 001',
  '0400000001',
  '2999 88887 1',
  '2999888871',
  'Dr Fakeprovidername',
  '9999999X',
  'A fake MBS item description',
];

describe('a_receipt_holds_no_patient_data', () => {
  it('carries none of the record’s PII once built and serialised', () => {
    const record = aRecordFullOfPii();
    const receipt = buildReceipt(record, {
      postedAt: '2026-09-17T00:00:05.000Z',
      attempts: 1,
      byteCount: 512,
      state: 'sent',
      jobId: 'job-1',
      printerVersion: '9.9.9',
    });

    const serialised = JSON.stringify(receipt);
    for (const forbidden of FORBIDDEN) {
      expect(serialised).not.toContain(forbidden);
    }

    // It is not empty of meaning, though — it answers "did this get through".
    expect(receipt).toEqual({
      sourceSha256: 'b'.repeat(64),
      formReference: 'HSS0610012092026120300',
      jobId: 'job-1',
      capturedAt: '2026-09-17T00:00:00.000Z',
      postedAt: '2026-09-17T00:00:05.000Z',
      parserTemplateVersion: 'pracsoft3-db4-2026-09-1',
      printerVersion: '9.9.9',
      byteCount: 512,
      attempts: 1,
      state: 'sent',
    });
  });

  it('holds no PII for a poisoned outcome either, which has no jobId', () => {
    const record = aRecordFullOfPii();
    const receipt = buildReceipt(record, { postedAt: '2026-09-17T01:00:00.000Z', attempts: 3, byteCount: 400, state: 'poisoned', printerVersion: '9.9.9' });
    const serialised = JSON.stringify(receipt);
    for (const forbidden of FORBIDDEN) {
      expect(serialised).not.toContain(forbidden);
    }
    expect(receipt.jobId).toBeUndefined();
    expect(receipt.state).toBe('poisoned');
  });
});

/*
 * THE LEDGER IS A TABLE SINCE 29 SEPTEMBER 2026 (D-2026-09-28-04). The two
 * promises are the ones `receipts.jsonl` made: append, never overwrite; and
 * nothing a receipt holds names a patient — checked against every byte the
 * database put on disk, not only against what it reads back.
 */
describe('the receipts ledger', () => {
  let dir: string;
  let store: AobPrinterStore | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aobprinter-receipts-'));
  });
  afterEach(() => {
    store?.close();
    store = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends one row per receipt, never overwriting the last', () => {
    store = openStore(dir);
    store.record(buildReceipt(aRecordFullOfPii(), { postedAt: 't1', attempts: 1, byteCount: 1, state: 'sent', printerVersion: '9.9.9' }));
    store.record(
      buildReceipt({ ...aRecordFullOfPii(), sourceSha256: 'c'.repeat(64) }, { postedAt: 't2', attempts: 1, byteCount: 2, state: 'sent', printerVersion: '9.9.9' }),
    );

    const rows = store.receipts();
    expect(rows).toHaveLength(2);
    expect(rows[0].sourceSha256).toBe('b'.repeat(64));
    expect(rows[1].sourceSha256).toBe('c'.repeat(64));

    // And the database itself carries none of the PII either.
    const onDisk = readdirSync(dir)
      .filter((name) => name.startsWith('aobprinter.db'))
      .map((name) => readFileSync(join(dir, name)).toString('latin1'))
      .join('\n');
    for (const forbidden of FORBIDDEN) {
      expect(onDisk).not.toContain(forbidden);
    }
  });

  it('works on a data folder that does not exist yet', () => {
    const fresh = join(dir, 'not-yet-created');
    store = openStore(fresh);
    store.record(buildReceipt(aRecordFullOfPii(), { postedAt: 't1', attempts: 1, byteCount: 1, state: 'sent', printerVersion: '9.9.9' }));
    expect(existsSync(join(fresh, 'aobprinter.db'))).toBe(true);
    expect(store.receipts()).toHaveLength(1);
  });
});
