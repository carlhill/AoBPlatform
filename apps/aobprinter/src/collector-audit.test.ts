/**
 * The return trip, written down (D-2026-09-29-01): which PDF and which
 * manifest went into which folder, when, and what happened when it did not.
 *
 * `collector.test.ts` pins what lands on disk. These pin that every step of
 * it is in the audit trail with no gaps — and that a step the trail cannot
 * record is a step the platform is not told about.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SignedFormForCollection } from '@aobplatform/contracts';
import { Collector, type CollectionClient } from './collector';
import { decryptPayload, encryptPayload } from './keystore';
import { makeLogger } from './log';
import type { Cipher } from './retention';
import { openStore, type AobPrinterStore, type ReturnsTrail } from './store';

const KEY = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').subarray(0, 32);
const CIPHER: Cipher = { encrypt: (p) => encryptPayload(KEY, p), decrypt: (p) => decryptPayload(KEY, p) };

const CHART = '00680';
const REFERENCE = 'HSS0610012092026120300';
const PAGE = Buffer.from('%PDF-1.7 a signed reproduction of the practice DB4', 'utf8');
const PAGE_SHA = createHash('sha256').update(PAGE).digest('hex');
const AGREEMENT = '11111111-2222-4333-8444-555555555555';

function aRow(over: Partial<SignedFormForCollection> = {}): SignedFormForCollection {
  return {
    agreementId: AGREEMENT,
    patientRecordNumber: CHART,
    formReference: REFERENCE,
    artefactId: '99999999-8888-4777-8666-555555555555',
    sha256: PAGE_SHA,
    signedAt: '2026-09-29T02:00:00.000Z',
    rendererVersion: 'signed-db4-1',
    contentVersion: 'signed-db4-2026-09-1',
    formCode: 'DB4',
    ...over,
  };
}

function aClient(over: Partial<CollectionClient> = {}): CollectionClient & { confirmed: number } {
  const client = {
    confirmed: 0,
    async pending() {
      return [aRow()];
    },
    async download() {
      return new Uint8Array(PAGE);
    },
    async confirm() {
      client.confirmed += 1;
    },
    ...over,
  };
  return client;
}

describe('the return trip in the audit trail', () => {
  let dataDir: string;
  let importFolder: string;
  let store: AobPrinterStore;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'aob-trail-data-'));
    importFolder = mkdtempSync(join(tmpdir(), 'aob-trail-pms-'));
    store = openStore(dataDir, { cipher: CIPHER, printerVersion: '1.2.3' });
  });
  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(importFolder, { recursive: true, force: true });
  });

  const collectorFor = (client: CollectionClient, trail: ReturnsTrail = store) =>
    new Collector(client, importFolder, makeLogger(() => undefined), '1.2.3', () => new Date('2026-09-29T03:00:00.000Z'), trail);
  const kinds = () => store.auditEvents().map((e) => e.kind);

  it('which_pdf_and_which_manifest_went_into_which_folder_is_recorded_step_by_step', async () => {
    await collectorFor(aClient()).sweep();

    expect(kinds()).toEqual(['return.received', 'return.pdf_written', 'return.manifest_written', 'return.filed', 'return.confirmed']);
    const row = store.getReturn(AGREEMENT, PAGE_SHA)!;
    expect(row.stage).toBe('confirmed');
    expect(row.formReference).toBe(REFERENCE);
    expect(row.filedAt).toBeDefined();
    expect(row.confirmedAt).toBeDefined();

    // Exactly where each file went — decryptable on this host.
    const pdf = join(importFolder, CHART, `${REFERENCE}.pdf`);
    const manifest = join(importFolder, CHART, `${REFERENCE}.json`);
    expect(store.locationOf(row.pdfLocationEncrypted!)).toBe(pdf);
    expect(store.locationOf(row.manifestLocationEncrypted!)).toBe(manifest);
    const written = store.auditEvents().filter((e) => e.kind === 'return.pdf_written' || e.kind === 'return.manifest_written');
    expect(written.map((e) => store.locationOf(e.locationEncrypted!))).toEqual([pdf, manifest]);

    // And the chart number — the folder — is in no byte of the database.
    store.checkpoint();
    const onDisk = readdirSync(dataDir)
      .filter((name) => name.startsWith('aobprinter.db'))
      .map((name) => readFileSync(join(dataDir, name)).toString('latin1'))
      .join('\n');
    expect(onDisk).not.toContain(CHART);
    expect(store.verifyAuditChain()).toMatchObject({ ok: true });
  });

  it('filed_but_not_confirmed_is_a_state_and_the_next_sweep_closes_it', async () => {
    const failing = aClient({
      async confirm() {
        throw new Error('the platform answered 503');
      },
    });
    await collectorFor(failing).sweep();
    expect(store.getReturn(AGREEMENT, PAGE_SHA)?.stage).toBe('filed');
    expect(kinds().at(-1)).toBe('return.confirm_failed');

    const working = aClient();
    await collectorFor(working).sweep();
    expect(working.confirmed).toBe(1);
    expect(store.getReturn(AGREEMENT, PAGE_SHA)?.stage).toBe('confirmed');
    // The second sweep found the file already there, and says so rather than pretending to re-download.
    expect(kinds()).toContain('return.already_on_disk');
    expect(kinds().at(-1)).toBe('return.confirmed');
  });

  it('a_page_whose_hash_disagrees_is_a_received_exception_with_its_reason', async () => {
    await collectorFor(aClient({ download: async () => new Uint8Array(Buffer.from('not the page', 'utf8')) })).sweep();
    const row = store.getReturn(AGREEMENT, PAGE_SHA)!;
    expect(row.stage).toBe('received_exception');
    expect(row.reason).toBe('hash_mismatch');
  });

  it('a_download_that_fails_is_a_received_exception_and_recovers_on_retry', async () => {
    await collectorFor(
      aClient({
        download: async () => {
          throw new Error('ECONNRESET');
        },
      }),
    ).sweep();
    expect(store.getReturn(AGREEMENT, PAGE_SHA)?.reason).toBe('download_failed');

    await collectorFor(aClient()).sweep();
    const row = store.getReturn(AGREEMENT, PAGE_SHA)!;
    expect(row.stage).toBe('confirmed');
    expect(row.resolvedBy).toBe('system');
    expect(kinds()).toContain('return.resolved');
  });

  it('an_unsafe_name_is_recorded_without_the_value_nobody_understood', async () => {
    await collectorFor(aClient({ pending: async () => [aRow({ formReference: '../../autoexec' })] })).sweep();
    const row = store.getReturn(AGREEMENT, PAGE_SHA)!;
    expect(row.stage).toBe('received_exception');
    expect(row.reason).toBe('unsafe_name');
    expect(row.formReference).toBeUndefined();
    expect(JSON.stringify(store.auditEvents())).not.toContain('autoexec');
  });

  it('a_step_the_trail_cannot_record_is_a_step_the_platform_is_not_told_about', async () => {
    /*
     * NO GAPS, THE HARD WAY. If "filed" cannot be written down, the platform
     * must not be told the practice holds the document — otherwise AoB would
     * say written-back and this host could not account for it. The file is
     * on disk; the next sweep records it and confirms then.
     */
    const client = aClient();
    const failingTrail: ReturnsTrail = {
      ...bindTrail(store),
      returnFiled: () => {
        throw new Error('database is locked');
      },
    };
    await collectorFor(client, failingTrail).sweep();
    expect(client.confirmed).toBe(0);

    await collectorFor(client).sweep();
    expect(client.confirmed).toBe(1);
    expect(store.getReturn(AGREEMENT, PAGE_SHA)?.stage).toBe('confirmed');
  });

  it('a_confirmation_the_trail_fails_to_record_once_is_retried_and_recorded', async () => {
    /*
     * The one step no later sweep can repair: once confirmed, the platform
     * stops listing the form. A locked database is usually free a moment
     * later, so the write is tried again.
     */
    let failures = 1;
    const flaky: ReturnsTrail = {
      ...bindTrail(store),
      returnConfirmed: (k) => {
        if (failures > 0) {
          failures -= 1;
          throw new Error('database is locked');
        }
        store.returnConfirmed(k);
      },
    };
    await collectorFor(aClient(), flaky).sweep();
    expect(store.getReturn(AGREEMENT, PAGE_SHA)?.stage).toBe('confirmed');
  });

  it('a_confirmation_that_can_never_be_recorded_is_said_out_loud', async () => {
    const lines: string[] = [];
    const stuck: ReturnsTrail = {
      ...bindTrail(store),
      returnConfirmed: () => {
        throw new Error('disk full');
      },
    };
    await new Collector(aClient(), importFolder, makeLogger((l) => lines.push(l)), '1.2.3', () => new Date(), stuck).sweep();
    expect(lines.join('\n')).toContain('collect.confirmed_not_recorded');
    expect(store.getReturn(AGREEMENT, PAGE_SHA)?.stage).toBe('filed');
  });

  it('a_retried_confirmation_does_not_record_filed_twice', async () => {
    await collectorFor(
      aClient({
        async confirm() {
          throw new Error('503');
        },
      }),
    ).sweep();
    await collectorFor(aClient()).sweep();
    expect(kinds().filter((k) => k === 'return.filed')).toHaveLength(1);
  });
});

/** The store's trail methods, bound, so a test can replace one of them. */
function bindTrail(store: AobPrinterStore): ReturnsTrail {
  return {
    returnReceived: (k) => store.returnReceived(k),
    returnReceivedException: (k, r) => store.returnReceivedException(k, r),
    returnAlreadyOnDisk: (k, l) => store.returnAlreadyOnDisk(k, l),
    returnWritten: (k, w, l) => store.returnWritten(k, w, l),
    returnFiled: (k, p, m) => store.returnFiled(k, p, m),
    returnFilingException: (k, r) => store.returnFilingException(k, r),
    returnConfirmed: (k) => store.returnConfirmed(k),
    returnConfirmFailed: (k) => store.returnConfirmFailed(k),
  };
}
