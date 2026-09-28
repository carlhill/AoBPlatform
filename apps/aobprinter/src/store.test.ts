/**
 * The database under AOBPRINTER, and the promises it makes by itself
 * (D-2026-09-28-04, D-2026-09-29-01).
 *
 * WHAT THESE PIN. The audit log is append-only IN THE DATABASE, not by
 * convention; it is hash-chained and a broken chain is found; every stage
 * change and its event commit together or not at all; no file location is
 * ever stored in plain text; prints and returns are never deleted; a newer
 * schema refuses to start; a folder outbox is imported exactly once; and a
 * data folder on a network drive is refused.
 *
 * WHERE A TEST NEEDS TO ATTACK THE FILE, it opens its own raw connection —
 * which is what somebody with a SQLite tool would do.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Db4PrintRecord } from './db4-record';
import { decryptPayload, encryptPayload } from './keystore';
import type { Cipher } from './retention';
import { GENESIS_HASH, SCHEMA_VERSION, assertLocalDataDir, dbPath, openStore, type AobPrinterStore, type StoreOptions } from './store';

const KEY = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').subarray(0, 32);
const CIPHER: Cipher = { encrypt: (p) => encryptPayload(KEY, p), decrypt: (p) => decryptPayload(KEY, p) };

const CHART = '09911';
const REFERENCE = 'HSS0610012092026120300';
const SHA = 'c'.repeat(64);
const AGREEMENT = '11111111-2222-4333-8444-555555555555';
const ARTEFACT_SHA = 'a'.repeat(64);

function aRecord(sha = SHA): Db4PrintRecord {
  return {
    documentType: 'db4_assignment',
    sourceSha256: sha,
    parserTemplateVersion: 'pracsoft3-db4-2026-09-1',
    pms: 'pracsoft3',
    capturedAt: '2026-09-29T00:00:00.000Z',
    form: { formCode: 'DB4', formReference: REFERENCE },
    patient: { pmsLinkageKey: `chart:${CHART}`, patientRecordNumber: CHART },
  };
}

describe('the AOBPRINTER database', () => {
  let dir: string;
  const opened: { close(): void }[] = [];
  const storeAt = (options: StoreOptions = { cipher: CIPHER, printerVersion: '1.0.0' }): AobPrinterStore => {
    const store = openStore(dir, options);
    opened.push(store);
    return store;
  };
  const raw = (): DatabaseSync => {
    const db = new DatabaseSync(dbPath(dir));
    opened.push(db);
    return db;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aobprinter-store-'));
  });
  afterEach(() => {
    for (const handle of opened.splice(0)) handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const queueOne = (store: AobPrinterStore, sha = SHA) =>
    store.queue({
      sha,
      record: aRecord(sha),
      enqueuedAt: '2026-09-29T00:00:00.000Z',
      attempts: 0,
      nextAttemptAt: '2026-09-29T00:00:00.000Z',
      formReference: REFERENCE,
      parserTemplateVersion: 'pracsoft3-db4-2026-09-1',
    });

  describe('the audit log is append-only in the database itself', () => {
    it('audit_log_refuses_an_update_from_any_connection', () => {
      queueOne(storeAt());
      expect(() => raw().exec("UPDATE audit_events SET reason = 'edited' WHERE seq = 1")).toThrow(/append-only/);
    });

    it('audit_log_refuses_a_delete_from_any_connection', () => {
      queueOne(storeAt());
      expect(() => raw().exec('DELETE FROM audit_events')).toThrow(/append-only/);
      expect(() => raw().exec('DELETE FROM audit_events WHERE seq = 1')).toThrow(/append-only/);
    });

    it('audit_log_refuses_an_insert_that_is_not_the_head_of_the_chain', () => {
      queueOne(storeAt());
      expect(() =>
        raw().exec(
          `INSERT INTO audit_events (at, kind, direction, actor, printer_version, prev_hash, hash)
           VALUES ('2026-09-29T00:00:00.000Z', 'print.sent', 'out', 'someone', '0', '${GENESIS_HASH}', '${'f'.repeat(64)}')`,
        ),
      ).toThrow(/head of the chain/);
    });

    it('prints_and_returns_are_never_deleted', () => {
      const store = storeAt();
      queueOne(store);
      store.returnReceived({ agreementId: AGREEMENT, sha256: ARTEFACT_SHA, formReference: REFERENCE });
      expect(() => raw().exec('DELETE FROM prints')).toThrow(/never deleted/);
      expect(() => raw().exec('DELETE FROM returns')).toThrow(/never deleted/);
    });
  });

  describe('the chain', () => {
    it('audit_chain_verifies_when_nothing_has_been_touched', () => {
      const store = storeAt();
      queueOne(store);
      store.markSent(SHA, { attempts: 1, nextAttemptAt: '2026-09-29T00:00:01.000Z' });
      const events = store.auditEvents();
      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(events[0].prevHash).toBe(GENESIS_HASH);
      for (let i = 1; i < events.length; i += 1) expect(events[i].prevHash).toBe(events[i - 1].hash);
      expect(store.verifyAuditChain()).toEqual({ ok: true, events: events.length });
      expect(store.auditHead()).toEqual({ seq: events[events.length - 1].seq, hash: events[events.length - 1].hash });
    });

    it('audit_chain_names_the_first_event_somebody_edited_after_removing_the_guard', () => {
      /*
       * THE HONEST LIMIT, TESTED. Somebody with a SQLite tool can drop the
       * trigger and edit a row. They cannot do it without breaking the chain,
       * and the verifier says where.
       */
      const store = storeAt();
      queueOne(store);
      store.markSent(SHA, { attempts: 1, nextAttemptAt: '2026-09-29T00:00:01.000Z' });
      const target = store.auditEvents()[1].seq;

      const attacker = raw();
      attacker.exec('DROP TRIGGER audit_events_no_update');
      attacker.exec(`UPDATE audit_events SET actor = 'somebody else' WHERE seq = ${target}`);

      expect(store.verifyAuditChain()).toEqual({ ok: false, brokenAtSeq: target, why: 'its contents do not match its hash' });
    });

    it('audit_chain_notices_a_removed_event', () => {
      const store = storeAt();
      queueOne(store);
      store.markSent(SHA, { attempts: 1, nextAttemptAt: '2026-09-29T00:00:01.000Z' });
      const [, second, third] = store.auditEvents();

      const attacker = raw();
      attacker.exec('DROP TRIGGER audit_events_no_delete');
      attacker.exec(`DELETE FROM audit_events WHERE seq = ${second.seq}`);

      expect(store.verifyAuditChain()).toMatchObject({ ok: false, brokenAtSeq: third.seq });
    });
  });

  describe('a stage change and its event are one transaction', () => {
    it('every_stage_change_writes_its_event_or_neither_happens', () => {
      const store = storeAt();
      expect(() =>
        store.transaction(() => {
          queueOne(store);
          throw new Error('the power went out between the row and anything after it');
        }),
      ).toThrow(/power/);
      expect(store.jobState(SHA)).toBeUndefined();
      expect(store.auditEvents()).toEqual([]);
    });

    it('a_print_moves_received_queued_sent_with_one_event_per_step', () => {
      const store = storeAt();
      expect(store.printReceived({ sha: SHA, claimFile: 'claim-1.pdf', queueName: 'AOBPRINTER-Front', byteCount: 1234 })).toBe('new');
      expect(store.jobState(SHA)).toBe('received');
      queueOne(store);
      expect(store.jobState(SHA)).toBe('queued');
      store.markSent(SHA, { attempts: 1, nextAttemptAt: '2026-09-29T00:00:01.000Z' });
      expect(store.jobState(SHA)).toBe('sent');

      expect(store.auditEvents({ subject: SHA }).map((e) => [e.kind, e.stage])).toEqual([
        ['print.received', 'received'],
        ['print.parsed', 'queued'],
        ['print.queued', 'queued'],
        ['print.sent', 'sent'],
      ]);
    });

    it('a_print_received_twice_is_recorded_as_a_duplicate_not_dropped', () => {
      const store = storeAt();
      store.printReceived({ sha: SHA, claimFile: 'claim-1.pdf', queueName: 'AOBPRINTER-Front', byteCount: 1234 });
      expect(store.printReceived({ sha: SHA, claimFile: 'claim-2.pdf', queueName: 'AOBPRINTER-Front', byteCount: 1234 })).toBe('duplicate');
      expect(store.auditEvents({ subject: SHA }).map((e) => e.kind)).toEqual(['print.received', 'print.duplicate']);
    });

    it('the_same_claimed_file_read_again_is_not_a_reprint_and_writes_nothing', () => {
      /*
       * A delete that failed, or a crash before cleanup, leaves the claimed
       * file to be read on every tick. That is not the practice printing
       * again — before this, it wrote a false duplicate twice a second.
       */
      const store = storeAt();
      store.printReceived({ sha: SHA, claimFile: 'claim-1.pdf', queueName: 'AOBPRINTER-Front', byteCount: 1234 });
      for (let i = 0; i < 5; i += 1) {
        expect(store.printReceived({ sha: SHA, claimFile: 'claim-1.pdf', queueName: 'AOBPRINTER-Front', byteCount: 1234 })).toBe('reread');
      }
      expect(store.auditEvents().map((e) => e.kind)).toEqual(['print.received']);
    });

    it('a_parse_exception_never_pulls_a_queued_print_backwards', () => {
      const store = storeAt();
      store.printReceived({ sha: SHA, claimFile: 'claim-1.pdf', queueName: 'AOBPRINTER-Front', byteCount: 1234 });
      queueOne(store);
      store.printParseException(SHA, 'not_a_db4');
      expect(store.jobState(SHA)).toBe('queued');
    });
  });

  describe('file locations', () => {
    it('a_location_is_never_stored_in_plain_text_and_reads_back_on_this_host', () => {
      const store = storeAt();
      const pdf = join('C:', 'PMS', 'Import', CHART, `${REFERENCE}.pdf`);
      const manifest = join('C:', 'PMS', 'Import', CHART, `${REFERENCE}.json`);
      const key = { agreementId: AGREEMENT, sha256: ARTEFACT_SHA, formReference: REFERENCE };
      store.returnReceived(key);
      store.returnFiled(key, pdf, manifest);
      store.checkpoint();

      // The chart number is the folder: nowhere in the file.
      const onDisk = readdirSync(dir)
        .filter((name) => name.startsWith('aobprinter.db'))
        .map((name) => readFileSync(join(dir, name)).toString('latin1'))
        .join('\n');
      expect(onDisk).not.toContain(CHART);
      expect(onDisk).not.toContain('PMS');

      // But this host, with its key, can say exactly where both files went.
      const row = store.getReturn(AGREEMENT, ARTEFACT_SHA)!;
      expect(store.locationOf(row.pdfLocationEncrypted!)).toBe(pdf);
      expect(store.locationOf(row.manifestLocationEncrypted!)).toBe(manifest);
      const filed = store.auditEvents().find((e) => e.kind === 'return.filed')!;
      expect(store.locationOf(filed.locationEncrypted!)).toBe(pdf);
    });

    it('a_location_without_the_key_is_refused_rather_than_written_in_plain_text', () => {
      const store = storeAt({ printerVersion: '1.0.0' });
      const key = { agreementId: AGREEMENT, sha256: ARTEFACT_SHA, formReference: REFERENCE };
      expect(() => store.returnWritten(key, 'pdf', join('C:', 'PMS', CHART, 'x.pdf'))).toThrow(/plain text/);
      expect(store.auditEvents()).toEqual([]);
    });
  });

  describe('exceptions and their resolution', () => {
    it('a_return_that_recovers_closes_its_own_exception', () => {
      const store = storeAt();
      const key = { agreementId: AGREEMENT, sha256: ARTEFACT_SHA, formReference: REFERENCE };
      store.returnReceivedException(key, 'download_failed');
      expect(store.getReturn(AGREEMENT, ARTEFACT_SHA)?.stage).toBe('received_exception');
      store.returnReceived(key);
      const row = store.getReturn(AGREEMENT, ARTEFACT_SHA)!;
      expect(row.stage).toBe('received');
      expect(row.resolvedBy).toBe('system');
      expect(store.auditEvents().map((e) => e.kind)).toContain('return.resolved');
    });

    it('a_human_resolution_needs_who_and_why_and_is_itself_an_event', () => {
      const store = storeAt();
      store.printReceived({ sha: SHA, claimFile: 'claim-1.pdf', queueName: 'AOBPRINTER-Front', byteCount: 10 });
      store.printParseException(SHA, 'not_a_db4');
      expect(() => store.resolvePrint(SHA, '', 'reprinted')).toThrow(/who and why/);
      expect(() => store.resolvePrint(SHA, 'support:jo', ' ')).toThrow(/who and why/);
      // A note is exactly where somebody writes a chart number: it is encrypted, never in the log as text.
      store.resolvePrint(SHA, 'support:jo', `wrong queue, chart ${CHART}`);
      const event = store.auditEvents().at(-1)!;
      expect(event.kind).toBe('print.resolved');
      expect(event.actor).toBe('support:jo');
      expect(store.locationOf(event.noteEncrypted!)).toBe(`wrong queue, chart ${CHART}`);
      expect(store.locationOf(store.getJob(SHA)!.resolutionEncrypted!)).toBe(`wrong queue, chart ${CHART}`);
      store.checkpoint();
      const onDisk = readdirSync(dir)
        .filter((name) => name.startsWith('aobprinter.db'))
        .map((name) => readFileSync(join(dir, name)).toString('latin1'))
        .join('\n');
      expect(onDisk).not.toContain(CHART);
    });
  });

  describe('the program', () => {
    it('program_events_explain_unclean_restarts_and_version_changes', () => {
      const first = storeAt({ cipher: CIPHER, printerVersion: '1.0.0' });
      first.programStarted();
      first.close();
      // No stop recorded: a power cut.
      const second = storeAt({ cipher: CIPHER, printerVersion: '1.1.0' });
      second.programStarted();
      second.programStopped();
      expect(second.auditEvents().map((e) => e.kind)).toEqual([
        'program.started',
        'program.unclean_restart',
        'program.version_changed',
        'program.started',
        'program.stopped',
      ]);
      expect(second.auditEvents().find((e) => e.kind === 'program.version_changed')?.detail).toEqual({ from: '1.0.0', to: '1.1.0' });
    });

    it('a_newer_schema_refuses_to_start', () => {
      storeAt().close();
      raw().exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
      expect(() => storeAt()).toThrow(/refuses to start.*schema version/);
    });
  });

  describe('the folder outbox, imported once', () => {
    it('a_receipt_from_the_earliest_build_without_a_printer_version_imports_rather_than_stopping_the_program', () => {
      mkdirSync(join(dir, 'outbox'), { recursive: true });
      writeFileSync(
        join(dir, 'outbox', 'receipts.jsonl'),
        [
          // a16089d: no printerVersion.
          JSON.stringify({ sourceSha256: '4'.repeat(64), capturedAt: 't0', postedAt: 't1', parserTemplateVersion: 'v', byteCount: 9, attempts: 1, state: 'sent' }),
          // Not a receipt at all: skipped, never fatal.
          'null',
          '{}',
          '',
        ].join('\n'),
        'utf8',
      );
      const store = storeAt();
      expect(store.receipts()).toEqual([expect.objectContaining({ sourceSha256: '4'.repeat(64), printerVersion: 'unknown' })]);
    });

    it('a_corrupt_sent_marker_still_means_sent_so_the_stale_pending_copy_is_not_posted_again', () => {
      const sha = '5'.repeat(64);
      mkdirSync(join(dir, 'outbox', 'sent'), { recursive: true });
      mkdirSync(join(dir, 'outbox', 'pending'), { recursive: true });
      writeFileSync(join(dir, 'outbox', 'sent', `${sha}.json`), '{"record": {"trunc', 'utf8');
      writeFileSync(
        join(dir, 'outbox', 'pending', `${sha}.json`),
        JSON.stringify({ record: aRecord(sha), enqueuedAt: '2026-09-20T00:00:00.000Z', attempts: 1, nextAttemptAt: '2026-09-20T00:00:00.000Z' }),
        'utf8',
      );
      const store = storeAt();
      expect(store.jobState(sha)).toBe('sent');
      expect(store.shas('queued')).toEqual([]);
    });

    it('folder_outbox_is_imported_once_and_its_files_removed', () => {
      const tiers: [string, string][] = [
        ['pending', '1'],
        ['sent', '2'],
        ['poison', '3'],
      ];
      for (const [tier, digit] of tiers) {
        mkdirSync(join(dir, 'outbox', tier), { recursive: true });
        writeFileSync(
          join(dir, 'outbox', tier, `${digit.repeat(64)}.json`),
          JSON.stringify({ record: aRecord(digit.repeat(64)), enqueuedAt: '2026-09-20T00:00:00.000Z', attempts: 2, nextAttemptAt: '2026-09-20T00:05:00.000Z', poisonedAt: '2026-09-20T00:05:00.000Z' }),
          'utf8',
        );
      }
      writeFileSync(
        join(dir, 'outbox', 'receipts.jsonl'),
        `${JSON.stringify({ sourceSha256: '2'.repeat(64), capturedAt: 't0', postedAt: 't1', parserTemplateVersion: 'v', printerVersion: '0.1.0', byteCount: 9, attempts: 1, state: 'sent' })}\n`,
        'utf8',
      );

      const store = storeAt();
      expect(store.jobState('1'.repeat(64))).toBe('queued');
      expect(store.jobState('2'.repeat(64))).toBe('sent');
      expect(store.jobState('3'.repeat(64))).toBe('send_exception');
      expect(store.getJob('1'.repeat(64))?.attempts).toBe(2);
      expect(store.receipts()).toHaveLength(1);
      expect(store.auditEvents().filter((e) => e.kind === 'print.imported')).toHaveLength(3);
      expect(store.auditEvents().filter((e) => e.kind === 'program.folder_outbox_imported')).toHaveLength(1);

      for (const [tier, digit] of tiers) expect(existsSync(join(dir, 'outbox', tier, `${digit.repeat(64)}.json`))).toBe(false);
      expect(existsSync(join(dir, 'outbox', 'receipts.jsonl.imported'))).toBe(true);

      // A second start imports nothing new.
      store.close();
      const again = storeAt();
      expect(again.auditEvents().filter((e) => e.kind === 'print.imported')).toHaveLength(3);
      expect(again.receipts()).toHaveLength(1);
    });
  });
});

describe('a_network_data_folder_refuses_to_start', () => {
  it('refuses a UNC path by its shape, before asking anybody', () => {
    const neverAsked = () => {
      throw new Error('should not have asked Windows about a UNC path');
    };
    expect(() => assertLocalDataDir('\\\\server\\share\\AoBPlatform', neverAsked)).toThrow(/network path/);
    expect(() => assertLocalDataDir('//server/share/AoBPlatform', neverAsked)).toThrow(/network path/);
  });

  it('refuses a mapped network drive', () => {
    expect(() => assertLocalDataDir('Z:\\AoBPlatform', () => 'Network')).toThrow(/network drive/);
  });

  it('fails closed when Windows cannot say what the drive is', () => {
    expect(() => assertLocalDataDir('Q:\\AoBPlatform', () => 'Unknown')).toThrow(/could not confirm/);
  });

  it('accepts a local disk', () => {
    expect(() => assertLocalDataDir('C:\\ProgramData\\AoBPlatform', () => 'Fixed')).not.toThrow();
  });
});
