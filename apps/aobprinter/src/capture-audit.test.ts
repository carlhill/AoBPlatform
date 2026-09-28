/**
 * The outbound trip, written down (D-2026-09-29-01): a print from the moment
 * it is received, through parsing, into the queue — or into an exception —
 * with the encrypted archive beside it; and the one gap that can happen
 * before a print has a row at all, "printed but never received".
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrintArchive } from './archive';
import type { QueueConfig } from './config';
import { decryptPayload, encryptPayload } from './keystore';
import { makeLogger } from './log';
import { Outbox } from './outbox';
import { Reconciler } from './print-service-log';
import type { Cipher } from './retention';
import { openStore, type AobPrinterStore } from './store';
import { DEFAULT_TEMPLATE_VERSION, templateFor } from './template';
import { processClaimedJob, watcherDirs } from './watcher';

const KEY = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').subarray(0, 32);
const CIPHER: Cipher = { encrypt: (p) => encryptPayload(KEY, p), decrypt: (p) => decryptPayload(KEY, p) };
const FIXTURE = join(__dirname, '..', 'test-fixtures', 'pracsoft3-db4-probe.pdf');
const template = templateFor(DEFAULT_TEMPLATE_VERSION)!;
const QUEUE: QueueConfig = { name: 'AOBPRINTER', spoolFile: 'unused', label: 'Front desk' };

/** A complete, readable, uninteresting one-line PDF: somebody printed the wrong thing to the queue. */
const NOT_A_DB4 = [
  '%PDF-1.4',
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/Contents 4 0 R>>endobj',
  '4 0 obj<</Length 44>>stream',
  'BT /F1 12 Tf 72 720 Td (A different page) Tj ET',
  'endstream endobj',
  'trailer<</Root 1 0 R>>',
  '%%EOF',
].join('\n');

describe('a print in the audit trail', () => {
  let dir: string;
  let store: AobPrinterStore;
  const logger = makeLogger(() => undefined);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aobprinter-capture-'));
    store = openStore(dir, { cipher: CIPHER, printerVersion: '1.0.0' });
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const claim = (name: string, bytes?: Buffer) => {
    const dirs = watcherDirs(dir, QUEUE.name);
    mkdirSync(dirs.jobs, { recursive: true });
    const path = join(dirs.jobs, name);
    if (bytes) writeFileSync(path, bytes);
    else copyFileSync(FIXTURE, path);
    return { path, dirs };
  };
  const trail = () => ({ prints: store, archive: new PrintArchive(dir, store, CIPHER, logger, 7) });

  it('a_print_is_received_archived_parsed_and_queued_in_that_order', () => {
    const outbox = new Outbox(store, async () => ({ ok: true, status: 202 }), logger);
    const { path, dirs } = claim('2026-09-29T09-00-00-000Z-aaaaaaaaaaaa.pdf');
    const { outcome, record } = processClaimedJob(path, template, outbox, dirs, QUEUE, logger, undefined, trail());

    expect(outcome).toBe('queued');
    const sha = record!.sourceSha256;
    expect(store.auditEvents({ subject: sha }).map((e) => e.kind)).toEqual(['print.received', 'print.archived', 'print.parsed', 'print.queued']);
    const row = store.getJob(sha)!;
    expect(row.stage).toBe('queued');
    expect(row.queueName).toBe('AOBPRINTER');
    expect(row.formReference).toBe(record!.form?.formReference);
    expect(row.archiveFile).toBe(`${sha}.pdf.enc`);
  });

  it('the_same_print_received_twice_is_one_row_and_a_duplicate_event', () => {
    const outbox = new Outbox(store, async () => ({ ok: true, status: 202 }), logger);
    for (const name of ['a.pdf', 'b.pdf']) {
      const { path, dirs } = claim(name);
      processClaimedJob(path, template, outbox, dirs, QUEUE, logger, undefined, trail());
    }
    expect(store.prints()).toHaveLength(1);
    const kinds = store.auditEvents().map((e) => e.kind);
    expect(kinds.filter((k) => k === 'print.duplicate')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'print.archived')).toHaveLength(1);
  });

  it('a_page_that_is_not_a_db4_is_a_parse_exception_with_its_reason_and_where_it_was_parked', () => {
    const outbox = new Outbox(store, async () => ({ ok: true, status: 202 }), logger);
    const { path, dirs } = claim('not-a-db4.pdf', Buffer.from(NOT_A_DB4, 'latin1'));
    processClaimedJob(path, template, outbox, dirs, QUEUE, logger, undefined, trail());

    const [row] = store.prints();
    expect(row.stage).toBe('parse_exception');
    expect(row.parseReason).toBe('not_a_db4');
    const event = store.auditEvents({ subject: row.sha }).find((e) => e.kind === 'print.parse_exception')!;
    expect(event.reason).toBe('not_a_db4');
    expect(store.locationOf(event.locationEncrypted!)).toBe(join(dirs.unparsed, 'not-a-db4.pdf'));
    // Unreadable is still archived: the archive is for exactly this.
    expect(row.archiveFile).toBeDefined();
  });

  it('printed_but_never_received_is_in_the_audit_trail_not_only_the_log', async () => {
    let clock = new Date('2026-09-29T00:00:00.000Z');
    const reconciler = new Reconciler(async () => new Map([['AOBPRINTER', 3]]), logger, () => clock, 0, (gap) => store.printGap(gap));
    reconciler.recordClaim('AOBPRINTER');
    clock = new Date(clock.getTime() + 60 * 60 * 1000);
    await reconciler.reconcile(['AOBPRINTER']);

    const gap = store.auditEvents().find((e) => e.kind === 'print.gap')!;
    expect(gap.reason).toBe('printed_not_received');
    expect(gap.detail).toMatchObject({ queue: 'AOBPRINTER', printed: 3, claimed: 1, missing: 2 });
  });

  it('a_gap_that_cannot_be_recorded_is_still_logged_and_never_stops_reconciling', async () => {
    const lines: string[] = [];
    let clock = new Date('2026-09-29T00:00:00.000Z');
    const reconciler = new Reconciler(
      async () => new Map([['AOBPRINTER', 2]]),
      makeLogger((line) => lines.push(line)),
      () => clock,
      0,
      () => {
        throw new Error('database is locked');
      },
    );
    clock = new Date(clock.getTime() + 60 * 60 * 1000);
    await expect(reconciler.reconcile(['AOBPRINTER'])).resolves.toMatchObject({ gaps: 1 });
    expect(lines.join('\n')).toContain('reconcile.gap_not_recorded');
  });
});
