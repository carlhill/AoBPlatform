/**
 * The heartbeat, AOBPRINTER's side (PRINTER-HEARTBEAT.md §2, D-2026-10-10-02).
 *
 * WHAT THESE PIN. A beat carries counts, hashes, ids, codes and versions and
 * nothing else; it never writes an audit event for itself; it checks the
 * chain a bounded chunk at a time; the reply's outcomes reach the audit trail
 * once each; a return filed but never recorded as confirmed is repaired; and
 * a beat that fails says so once and never throws (hard rule 8).
 *
 * FIXTURES ARE OBVIOUSLY FAKE: an invented name, an invented chart number,
 * and a Medicare-format number whose checksum is wrong.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AobPrinterHeartbeat, AobPrinterHeartbeatReply, AobPrinterJobState, SignedFormForCollection } from '@aobplatform/contracts';
import { Collector, type CollectionClient } from './collector';
import type { Db4PrintRecord } from './db4-record';
import { HEARTBEAT_VERIFY_CHUNK, Heartbeat, HeartbeatHttpError, type HeartbeatClient, type HeartbeatFacts, type HeartbeatStore } from './heartbeat';
import { decryptPayload, encryptPayload } from './keystore';
import { makeLogger } from './log';
import type { Cipher } from './retention';
import { dbPath, openStore, type AobPrinterStore, type ReturnsTrail } from './store';

const KEY = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').subarray(0, 32);
const CIPHER: Cipher = { encrypt: (p) => encryptPayload(KEY, p), decrypt: (p) => decryptPayload(KEY, p) };

const GIVEN = 'Testy';
const FAMILY = 'McFakeface';
const CHART = '9876543';
/** Medicare-shaped, invalid checksum (the ninth digit should be 3). */
const CARD = '2999 88887 1';
const REFERENCE = 'HSS0610012092026120300';
const AGREEMENT = '11111111-2222-4333-8444-555555555555';
const PAGE = Buffer.from('%PDF-1.7 a signed reproduction of the practice DB4', 'utf8');
const PAGE_SHA = createHash('sha256').update(PAGE).digest('hex');

const FACTS: HeartbeatFacts = {
  printerVersion: '1.2.3',
  templateVersion: 'pracsoft3-db4-2026-09-1',
  intervalMs: 60_000,
  queueCount: 1,
  collecting: true,
  retentionEnabled: false,
  startedAt: '2026-10-10T00:00:00.000Z',
};

function aRecord(sha: string): Db4PrintRecord {
  return {
    documentType: 'db4_assignment',
    sourceSha256: sha,
    parserTemplateVersion: 'pracsoft3-db4-2026-09-1',
    pms: 'pracsoft3',
    capturedAt: '2026-10-10T00:00:00.000Z',
    form: { formCode: 'DB4', formReference: REFERENCE },
    patient: {
      pmsLinkageKey: `chart:${CHART}`,
      patientRecordNumber: CHART,
      ['medicareCardNumber']: CARD,
      givenNames: GIVEN,
      familyName: FAMILY,
    },
  };
}

const sha = (c: string) => c.repeat(64);

/** A platform that answers every beat; `answer` shapes the reply from the body it was sent. */
function aPlatform(answer: (body: AobPrinterHeartbeat) => Partial<AobPrinterHeartbeatReply> = () => ({})): HeartbeatClient & {
  sent: AobPrinterHeartbeat[];
} {
  const sent: AobPrinterHeartbeat[] = [];
  return {
    sent,
    async beat(body) {
      sent.push(JSON.parse(JSON.stringify(body)) as AobPrinterHeartbeat);
      return {
        receivedAt: '2026-10-10T00:00:00.000Z',
        chain: { status: 'unverified', anchorSeq: body.head.seq },
        jobs: [],
        returns: [],
        ...answer(body),
      };
    },
  };
}

describe('the heartbeat', () => {
  let dir: string;
  let importFolder: string;
  let store: AobPrinterStore;
  let clock: Date;
  let lines: string[];
  const raws: DatabaseSync[] = [];
  const logger = makeLogger((line) => lines.push(line));
  const signal = () => new AbortController().signal;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aob-heartbeat-'));
    importFolder = mkdtempSync(join(tmpdir(), 'aob-heartbeat-pms-'));
    clock = new Date('2026-10-10T01:00:00.000Z');
    lines = [];
    store = openStore(dir, { cipher: CIPHER, printerVersion: '1.2.3', now: () => clock });
    store.programStarted({ queues: 1 });
  });
  afterEach(() => {
    for (const db of raws.splice(0)) db.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(importFolder, { recursive: true, force: true });
  });

  const heartbeatWith = (client: HeartbeatClient, over: { store?: HeartbeatStore; verifyChunk?: number } = {}) =>
    new Heartbeat({ store: over.store ?? store, client, logger, now: () => clock, facts: FACTS, verifyChunk: over.verifyChunk });

  const queueOne = (s: string) =>
    store.queue({
      sha: s,
      record: aRecord(s),
      enqueuedAt: clock.toISOString(),
      attempts: 0,
      nextAttemptAt: clock.toISOString(),
      formReference: REFERENCE,
      parserTemplateVersion: 'pracsoft3-db4-2026-09-1',
    });
  const sendOne = (s: string) => {
    queueOne(s);
    store.markSent(s, { attempts: 1, nextAttemptAt: clock.toISOString() });
  };
  const receiveOne = (s: string) => store.printReceived({ sha: s, claimFile: `claim-${s.slice(0, 4)}.pdf`, queueName: 'AOBPRINTER', byteCount: 10 });
  const fileOne = (agreementId = AGREEMENT, sha256 = PAGE_SHA) => {
    const key = { agreementId, sha256, formReference: REFERENCE };
    store.returnReceived(key);
    store.returnFiled(key, join(importFolder, CHART, `${REFERENCE}.pdf`), join(importFolder, CHART, `${REFERENCE}.json`));
  };
  const editEvent = (seq: number) => {
    const attacker = new DatabaseSync(dbPath(dir));
    raws.push(attacker);
    attacker.exec('DROP TRIGGER IF EXISTS audit_events_no_update');
    attacker.exec(`UPDATE audit_events SET actor = 'somebody else' WHERE seq = ${seq}`);
  };
  const count = (event: string) => lines.filter((l) => l.includes(event)).length;

  it('heartbeat_carries_counts_hashes_and_versions_and_nothing_else', async () => {
    queueOne(sha('c'));
    sendOne(sha('d'));
    receiveOne(sha('e'));
    store.printParseException(sha('e'), 'not_a_db4');
    fileOne();
    store.returnFilingException({ agreementId: '22222222-3333-4444-8555-666666666666', sha256: sha('a'), formReference: REFERENCE }, 'write_failed');

    const platform = aPlatform();
    const heartbeat = heartbeatWith(platform);
    await heartbeat.beat(signal());
    await heartbeat.beat(signal());

    const [first, second] = platform.sent;
    const expected = [
      'awaitingOutcome',
      'chainId',
      'collecting',
      'counts',
      'filedUnconfirmed',
      'head',
      'intervalMs',
      'localCheck',
      'openExceptions',
      'printerVersion',
      'queueCount',
      'retentionEnabled',
      'runtimeVersion',
      'schemaVersion',
      'sentAt',
      'startedAt',
      'templateVersion',
    ];
    // Absent until the platform names an anchor; present from then on.
    expect(Object.keys(first).sort()).toEqual(expected);
    expect(Object.keys(second).sort()).toEqual([...expected, 'atAnchor'].sort());
    expect(Object.keys(first.counts).sort()).toEqual(
      ['gapsLast24h', 'oldestFiledUnconfirmedAt', 'oldestQueuedAt', 'openExceptions', 'prints', 'returns', 'staleQueued'].sort(),
    );
    for (const exception of first.openExceptions) {
      expect(['agreementId', 'direction', 'reason', 'since', 'sourceSha256', 'stage']).toEqual(expect.arrayContaining(Object.keys(exception)));
    }
    expect(first.openExceptions).toHaveLength(2);
    expect(first.awaitingOutcome).toEqual([sha('d')]);
    expect(first.filedUnconfirmed).toEqual([{ agreementId: AGREEMENT, sha256: PAGE_SHA }]);
    expect(first.printerVersion).toBe('1.2.3');
    expect(first.runtimeVersion).toBe(process.version);

    // No name, chart number, card number or form reference anywhere in what goes over the wire.
    const wire = JSON.stringify(platform.sent);
    for (const value of [GIVEN, FAMILY, CHART, CARD, CARD.replace(/\s/g, ''), REFERENCE, importFolder]) {
      expect(wire).not.toContain(value);
    }
  });

  it('heartbeat_counts_every_stage_in_both_directions', async () => {
    receiveOne(sha('1'));
    receiveOne(sha('2'));
    store.printParseException(sha('2'), 'incomplete_pdf');
    queueOne(sha('3'));
    store.markStale(sha('3'), 2 * 60 * 60 * 1000);
    sendOne(sha('4'));
    queueOne(sha('5'));
    store.markPoisoned(sha('5'), { attempts: 1, nextAttemptAt: clock.toISOString(), poisonedAt: clock.toISOString(), status: 400 });
    store.printGap({ queue: 'AOBPRINTER', printed: 2, claimed: 1, windowStart: clock.toISOString(), windowEnd: clock.toISOString() });

    const key = (n: string) => ({ agreementId: `${n}1111111-2222-4333-8444-555555555555`, sha256: sha(n), formReference: REFERENCE });
    store.returnReceived(key('a'));
    store.returnReceivedException(key('b'), 'download_failed');
    fileOne(key('c').agreementId, key('c').sha256);
    store.returnFilingException(key('d'), 'write_failed');
    fileOne(key('e').agreementId, key('e').sha256);
    store.returnConfirmed(key('e'));

    const platform = aPlatform();
    await heartbeatWith(platform).beat(signal());
    const { counts } = platform.sent[0];

    expect(counts.prints).toEqual({ received: 1, parse_exception: 1, queued: 1, sent: 1, send_exception: 1 });
    expect(counts.returns).toEqual({ received: 1, received_exception: 1, filed: 1, filing_exception: 1, confirmed: 1 });
    expect(counts.openExceptions).toEqual({ parse: 1, send: 1, received: 1, filing: 1 });
    expect(counts.oldestQueuedAt).toBe(clock.toISOString());
    expect(counts.oldestFiledUnconfirmedAt).toBe(clock.toISOString());
    expect(counts.staleQueued).toBe(1);
    expect(counts.gapsLast24h).toBe(1);
  });

  it('heartbeat_counts_only_unresolved_exceptions_as_open', async () => {
    receiveOne(sha('1'));
    store.printParseException(sha('1'), 'no_text_layer');
    receiveOne(sha('2'));
    store.printParseException(sha('2'), 'not_a_db4');
    store.resolvePrint(sha('2'), 'support:test', 'reprinted');
    queueOne(sha('3'));
    store.markPoisoned(sha('3'), { attempts: 1, nextAttemptAt: clock.toISOString(), poisonedAt: clock.toISOString(), status: 400 });
    const open = { agreementId: AGREEMENT, sha256: sha('a') };
    const closed = { agreementId: '22222222-3333-4444-8555-666666666666', sha256: sha('b') };
    store.returnReceivedException(open, 'hash_mismatch');
    store.returnReceivedException(closed, 'download_failed');
    store.resolveReturn(closed.agreementId, closed.sha256, 'support:test', 'withdrawn');

    const platform = aPlatform();
    await heartbeatWith(platform).beat(signal());
    const [beat] = platform.sent;

    expect(beat.counts.prints.parse_exception).toBe(2);
    expect(beat.counts.openExceptions).toEqual({ parse: 1, send: 1, received: 1, filing: 0 });
    expect(beat.openExceptions).toEqual([
      { direction: 'out', stage: 'parse_exception', reason: 'no_text_layer', since: clock.toISOString(), sourceSha256: sha('1') },
      { direction: 'out', stage: 'send_exception', reason: 'http_400', since: clock.toISOString(), sourceSha256: sha('3') },
      { direction: 'in', stage: 'received_exception', reason: 'hash_mismatch', since: clock.toISOString(), agreementId: AGREEMENT },
    ]);
  });

  it('heartbeat_chain_id_is_the_hash_of_the_first_event', async () => {
    queueOne(sha('c'));
    const platform = aPlatform();
    await heartbeatWith(platform).beat(signal());
    const [first] = store.auditEvents();
    expect(first.kind).toBe('program.started');
    expect(platform.sent[0].chainId).toBe(first.hash);
    expect(platform.sent[0].chainId).toBe(store.chainId());
  });

  it('heartbeat_carries_the_head_and_the_hash_at_the_anchor_it_was_asked_for', async () => {
    let anchorSeq = 1;
    const platform = aPlatform(() => ({ chain: { status: 'unverified', anchorSeq } }));
    const heartbeat = heartbeatWith(platform);

    await heartbeat.beat(signal());
    expect(platform.sent[0].atAnchor).toBeUndefined();
    expect(platform.sent[0].head).toEqual(store.auditHead());

    queueOne(sha('c'));
    anchorSeq = 9_999;
    await heartbeat.beat(signal());
    expect(platform.sent[1].atAnchor).toEqual({ seq: 1, hash: store.auditEvents()[0].hash });
    expect(platform.sent[1].head).toEqual(store.auditHead());

    // An anchor past the head is answered honestly: there is no hash there.
    await heartbeat.beat(signal());
    expect(platform.sent[2].atAnchor).toEqual({ seq: 9_999, hash: null });

    // After a restart the anchor is not known until the platform names it again.
    const restarted = aPlatform();
    await heartbeatWith(restarted).beat(signal());
    expect(restarted.sent[0].atAnchor).toBeUndefined();
  });

  it('a_heartbeat_that_finds_nothing_new_does_not_extend_the_audit_chain', async () => {
    sendOne(sha('d'));
    fileOne();
    const before = store.auditHead();
    const events = store.auditEvents().length;

    const platform = aPlatform();
    const heartbeat = heartbeatWith(platform);
    for (let i = 0; i < 3; i += 1) await heartbeat.beat(signal());

    expect(platform.sent).toHaveLength(3);
    expect(store.auditHead()).toEqual(before);
    expect(store.auditEvents()).toHaveLength(events);
    expect(platform.sent.every((b) => b.head.seq === before.seq && b.head.hash === before.hash)).toBe(true);
  });

  it('chain_verification_advances_in_chunks_and_reports_how_far_it_got', async () => {
    expect(HEARTBEAT_VERIFY_CHUNK).toBe(2_000);
    for (const c of ['1', '2', '3']) sendOne(sha(c));
    const head = store.auditHead().seq;
    expect(head).toBeGreaterThan(6);

    const platform = aPlatform();
    const heartbeat = heartbeatWith(platform, { verifyChunk: 3 });
    const reached: number[] = [];
    for (let i = 0; i < Math.ceil(head / 3) + 1; i += 1) {
      await heartbeat.beat(signal());
      const check = platform.sent.at(-1)!.localCheck;
      if (!check.ok) throw new Error(`broken at ${check.brokenAtSeq}`);
      reached.push(check.verifiedThroughSeq);
    }
    expect(reached.slice(0, 2)).toEqual([3, 6]);
    expect(reached.at(-1)).toBe(head);

    // An edit BEHIND the frontier is not re-read every minute ...
    editEvent(2);
    await heartbeat.beat(signal());
    expect(platform.sent.at(-1)!.localCheck).toEqual({ ok: true, verifiedThroughSeq: head });

    // ... and is found once the frontier resets, every 24 hours.
    clock = new Date(clock.getTime() + 24 * 60 * 60 * 1000);
    await heartbeat.beat(signal());
    expect(platform.sent.at(-1)!.localCheck).toEqual({ ok: false, brokenAtSeq: 2, why: 'content' });
  });

  it('an_edited_event_is_reported_by_the_next_heartbeat_with_its_seq', async () => {
    sendOne(sha('d'));
    const events = store.auditEvents().length;
    editEvent(3);

    const platform = aPlatform();
    const heartbeat = heartbeatWith(platform);
    await heartbeat.beat(signal());
    await heartbeat.beat(signal());

    expect(platform.sent[0].localCheck).toEqual({ ok: false, brokenAtSeq: 3, why: 'content' });
    expect(platform.sent[1].localCheck).toEqual({ ok: false, brokenAtSeq: 3, why: 'content' });
    // Logged once at error level, and no local audit event (decision 14).
    expect(count('heartbeat.local_check_failed')).toBe(1);
    expect(lines.find((l) => l.includes('heartbeat.local_check_failed'))).toContain('ERROR');
    expect(store.auditEvents()).toHaveLength(events);
  });

  it('the_reply_records_processed_by_aob_once_per_print', async () => {
    sendOne(sha('d'));
    // The platform repeats itself every beat; the host records it once.
    const platform = aPlatform(() => ({
      jobs: [{ sourceSha256: sha('d'), state: 'done', placed: true, reason: null, agreementId: AGREEMENT }],
    }));
    const heartbeat = heartbeatWith(platform);
    await heartbeat.beat(signal());
    await heartbeat.beat(signal());

    const processed = store.auditEvents({ subject: sha('d') }).filter((e) => e.kind === 'print.processed');
    expect(processed).toHaveLength(1);
    expect(processed[0].detail).toEqual({ state: 'done', placed: true, agreementId: AGREEMENT });
    expect(store.jobState(sha('d'))).toBe('sent');
    expect(platform.sent[0].awaitingOutcome).toEqual([sha('d')]);
    expect(platform.sent[1].awaitingOutcome).toEqual([]);
  });

  it('a_print_still_waiting_on_the_platform_writes_nothing_and_is_asked_again', async () => {
    sendOne(sha('d'));
    const events = store.auditEvents().length;
    const platform = aPlatform(() => ({
      jobs: [{ sourceSha256: sha('d'), state: 'waiting', placed: null, reason: null, agreementId: null }],
    }));
    const heartbeat = heartbeatWith(platform);
    await heartbeat.beat(signal());
    await heartbeat.beat(signal());

    expect(store.auditEvents()).toHaveLength(events);
    expect(platform.sent[1].awaitingOutcome).toEqual([sha('d')]);
  });

  it('a_print_in_a_state_the_host_does_not_recognise_writes_nothing_and_is_asked_again', async () => {
    sendOne(sha('d'));
    const events = store.auditEvents().length;
    // A platform newer than this host may answer in a state it has never met.
    const platform = aPlatform(() => ({
      jobs: [{ sourceSha256: sha('d'), state: 'held_for_review' as AobPrinterJobState, placed: null, reason: null, agreementId: null }],
    }));
    const heartbeat = heartbeatWith(platform);
    await heartbeat.beat(signal());
    await heartbeat.beat(signal());

    expect(store.auditEvents()).toHaveLength(events);
    expect(store.auditEvents({ subject: sha('d') }).map((e) => e.kind)).not.toContain('print.not_on_platform');
    expect(platform.sent[1].awaitingOutcome).toEqual([sha('d')]);
  });

  it('a_print_the_platform_never_had_is_recorded_as_not_on_platform', async () => {
    sendOne(sha('d'));
    sendOne(sha('e'));
    // A job the host did not ask about is not the host's to record.
    sendOne(sha('f'));
    clock = new Date(clock.getTime() + 15 * 24 * 60 * 60 * 1000);
    sendOne(sha('1'));
    const platform = aPlatform(() => ({
      jobs: [
        { sourceSha256: sha('1'), state: 'unknown', placed: null, reason: null, agreementId: null },
        { sourceSha256: sha('f'), state: 'dead', placed: null, reason: null, agreementId: null },
      ],
    }));
    await heartbeatWith(platform).beat(signal());

    // Outside the 14-day window, the older three are not asked about.
    expect(platform.sent[0].awaitingOutcome).toEqual([sha('1')]);
    expect(store.auditEvents({ subject: sha('1') }).map((e) => e.kind)).toContain('print.not_on_platform');
    expect(store.auditEvents({ subject: sha('f') }).map((e) => e.kind)).not.toContain('print.processing_failed');
    expect(store.jobState(sha('1'))).toBe('sent');
  });

  describe('returns', () => {
    /* The setup of `collect.confirmed_not_recorded` in `collector-audit.test.ts`. */
    function aRow(): SignedFormForCollection {
      return {
        agreementId: AGREEMENT,
        patientRecordNumber: CHART,
        formReference: REFERENCE,
        artefactId: '99999999-8888-4777-8666-555555555555',
        sha256: PAGE_SHA,
        signedAt: '2026-10-10T00:30:00.000Z',
        rendererVersion: 'signed-db4-1',
        contentVersion: 'signed-db4-2026-09-1',
        formCode: 'DB4',
      };
    }
    const aClient: CollectionClient = {
      pending: async () => [aRow()],
      download: async () => new Uint8Array(PAGE),
      confirm: async () => undefined,
    };
    function stuckTrail(): ReturnsTrail {
      return {
        returnReceived: (k) => store.returnReceived(k),
        returnReceivedException: (k, r) => store.returnReceivedException(k, r),
        returnAlreadyOnDisk: (k, l) => store.returnAlreadyOnDisk(k, l),
        returnWritten: (k, w, l) => store.returnWritten(k, w, l),
        returnFiled: (k, p, m) => store.returnFiled(k, p, m),
        returnFilingException: (k, r) => store.returnFilingException(k, r),
        returnConfirmed: () => {
          throw new Error('disk full');
        },
        returnConfirmFailed: (k) => store.returnConfirmFailed(k),
      };
    }
    const confirmedButNotRecorded = async () => {
      await new Collector(aClient, importFolder, logger, '1.2.3', () => clock, stuckTrail()).sweep();
      expect(lines.join('\n')).toContain('collect.confirmed_not_recorded');
      expect(store.getReturn(AGREEMENT, PAGE_SHA)?.stage).toBe('filed');
    };

    it('filed_but_never_recorded_as_confirmed_is_repaired_by_the_heartbeat', async () => {
      await confirmedButNotRecorded();
      const platform = aPlatform((body) => ({
        returns: body.filedUnconfirmed.map((r) => ({ agreementId: r.agreementId, writtenBack: true, sha256Matches: true, listed: false })),
      }));
      const heartbeat = heartbeatWith(platform);
      await heartbeat.beat(signal());
      await heartbeat.beat(signal());

      expect(platform.sent[0].filedUnconfirmed).toEqual([{ agreementId: AGREEMENT, sha256: PAGE_SHA }]);
      expect(platform.sent[1].filedUnconfirmed).toEqual([]);
      const row = store.getReturn(AGREEMENT, PAGE_SHA)!;
      expect(row.stage).toBe('confirmed');
      expect(row.confirmedAt).toBeDefined();
      const last = store.auditEvents().at(-1)!;
      expect(last.kind).toBe('return.confirmed');
      expect(last.detail).toEqual({ via: 'heartbeat' });
      expect(store.auditEvents().filter((e) => e.kind === 'return.confirmed')).toHaveLength(1);
      expect(store.verifyAuditChain()).toMatchObject({ ok: true });
    });

    it('a_return_the_platform_has_not_written_back_stays_filed', async () => {
      fileOne();
      const events = store.auditEvents().length;
      const platform = aPlatform(() => ({ returns: [{ agreementId: AGREEMENT, writtenBack: false, sha256Matches: false, listed: true }] }));
      await heartbeatWith(platform).beat(signal());

      expect(store.getReturn(AGREEMENT, PAGE_SHA)?.stage).toBe('filed');
      expect(store.auditEvents()).toHaveLength(events);
      expect(lines.join('\n')).not.toContain('heartbeat.return_hash_differs');
    });

    it('a_return_written_back_with_a_different_hash_stays_filed_and_is_logged', async () => {
      fileOne();
      const events = store.auditEvents().length;
      const platform = aPlatform(() => ({ returns: [{ agreementId: AGREEMENT, writtenBack: true, sha256Matches: false, listed: false }] }));
      const heartbeat = heartbeatWith(platform);
      await heartbeat.beat(signal());
      await heartbeat.beat(signal());

      expect(store.getReturn(AGREEMENT, PAGE_SHA)?.stage).toBe('filed');
      expect(store.auditEvents()).toHaveLength(events);
      // Said once, not every minute.
      expect(count('heartbeat.return_hash_differs')).toBe(1);
    });
  });

  it('a_failing_heartbeat_is_logged_once_and_never_throws', async () => {
    let failing = true;
    const platform = aPlatform();
    const flaky: HeartbeatClient = {
      beat: async (body, s) => {
        if (failing) throw new Error('connect ECONNREFUSED 127.0.0.1:3001');
        return platform.beat(body, s);
      },
    };
    const heartbeat = heartbeatWith(flaky);
    for (let i = 0; i < 3; i += 1) await expect(heartbeat.beat(signal())).resolves.toBeUndefined();
    expect(count('heartbeat.unreachable')).toBe(1);

    failing = false;
    await heartbeat.beat(signal());
    await heartbeat.beat(signal());
    expect(count('heartbeat.recovered')).toBe(1);

    failing = true;
    await heartbeat.beat(signal());
    expect(count('heartbeat.unreachable')).toBe(2);

    // A store that cannot be read is a failed beat too — logged once, never thrown.
    const broken = {
      ...pickStore(store),
      heartbeatSnapshot: () => {
        throw new Error('database is locked');
      },
    } as HeartbeatStore;
    const unreadable = heartbeatWith(aPlatform(), { store: broken });
    await expect(unreadable.beat(signal())).resolves.toBeUndefined();
    await expect(unreadable.beat(signal())).resolves.toBeUndefined();
    expect(count('heartbeat.not_built')).toBe(1);
  });

  it('a_refused_heartbeat_is_said_once_not_every_minute', async () => {
    const refusing: HeartbeatClient = {
      beat: async () => {
        throw new HeartbeatHttpError(403);
      },
    };
    const heartbeat = heartbeatWith(refusing);
    for (let i = 0; i < 5; i += 1) await expect(heartbeat.beat(signal())).resolves.toBeUndefined();
    expect(count('heartbeat.refused')).toBe(1);
    expect(lines.find((l) => l.includes('heartbeat.refused'))).toContain('status=403');
    expect(count('heartbeat.unreachable')).toBe(0);
  });
});

/** The store's heartbeat methods, bound, so a test can replace one. */
function pickStore(store: AobPrinterStore): HeartbeatStore {
  return {
    heartbeatSnapshot: (n, d, l) => store.heartbeatSnapshot(n, d, l),
    chainId: () => store.chainId(),
    auditHead: () => store.auditHead(),
    auditHashAt: (s) => store.auditHashAt(s),
    verifyAuditRange: (a, p, l) => store.verifyAuditRange(a, p, l),
    recordPlatformOutcome: (s, o) => store.recordPlatformOutcome(s, o),
    returnConfirmedByPlatform: (k) => store.returnConfirmedByPlatform(k),
  };
}
