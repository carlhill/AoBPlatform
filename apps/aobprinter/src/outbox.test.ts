/**
 * The outbox's four promises, each with the test the brief named.
 *
 * These are the tests that decide whether this program can be installed. A
 * parser that reads a field wrongly is a bug somebody notices; an outbox that
 * loses a form is a practice that billed for a service and has no consent
 * record, and nobody notices until an audit.
 *
 * SINCE 29 SEPTEMBER 2026 THE OUTBOX IS A TABLE (D-2026-09-28-04). The
 * promises are word for word the ones the folder version made; what each test
 * inspects is the row instead of the file.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db4PrintRecord } from './db4-record';
import { makeLogger } from './log';
import { OUTBOX_FORMAT_VERSION, Outbox, type PostResult } from './outbox';
import { openStore, type AobPrinterStore } from './store';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'aobprinter-outbox-'));
}

function aRecord(sha = 'c'.repeat(64)): Db4PrintRecord {
  return {
    documentType: 'db4_assignment',
    sourceSha256: sha,
    parserTemplateVersion: 'pracsoft3-db4-2026-09-1',
    pms: 'pracsoft3',
    capturedAt: '2026-09-17T00:00:00.000Z',
    form: { formCode: 'DB4', formReference: 'HSS0610012092026120300' },
    patient: { pmsLinkageKey: 'chart:09911', patientRecordNumber: '09911' },
  };
}

const ACCEPTED: PostResult = { ok: true, status: 202 };
const UNREACHABLE: PostResult = { ok: false, status: 0, error: 'fetch failed' };

/** Every store a test opens, closed before its folder is removed — Windows will not delete an open database. */
const opened: AobPrinterStore[] = [];
function storeAt(dir: string): AobPrinterStore {
  const store = openStore(dir);
  opened.push(store);
  return store;
}
function closeStores(): void {
  for (const store of opened.splice(0)) store.close();
}

describe('the outbox', () => {
  let dir: string;
  const lines: string[] = [];
  const logger = makeLogger((line) => lines.push(line));

  beforeEach(() => {
    dir = tempDir();
    lines.length = 0;
  });
  afterEach(() => {
    closeStores();
    rmSync(dir, { recursive: true, force: true });
  });

  it('a_job_is_never_posted_twice', async () => {
    const posted: string[] = [];
    const outbox = new Outbox(storeAt(dir), async (record) => {
      posted.push(record.sourceSha256);
      return ACCEPTED;
    }, logger);

    outbox.enqueue(aRecord());
    await outbox.flush();
    expect(posted).toHaveLength(1);

    // 1. Flushing again does not re-post: the row says sent, not queued.
    await outbox.flush();
    expect(posted).toHaveLength(1);

    // 2. Nor does the SAME PRINT arriving again — a reprint, or the same spool
    //    bytes claimed twice after a crash. The hash is the identity.
    expect(outbox.enqueue(aRecord())).toBe('already_sent');
    await outbox.flush();
    expect(posted).toHaveLength(1);

    // 3. Nor does a whole new process over the same database.
    const restarted = new Outbox(storeAt(dir), async (record) => {
      posted.push(record.sourceSha256);
      return ACCEPTED;
    }, logger);
    expect(restarted.enqueue(aRecord())).toBe('already_sent');
    await restarted.flush();
    expect(posted).toHaveLength(1);

    // 4. And the store itself refuses to queue the same bytes again,
    //    whatever a future caller forgets to check first.
    expect(() =>
      storeAt(dir).queue({
        sha: 'c'.repeat(64),
        record: aRecord(),
        enqueuedAt: new Date().toISOString(),
        attempts: 0,
        nextAttemptAt: new Date().toISOString(),
      }),
    ).toThrow(/UNIQUE|PRIMARY/i);
    expect(posted).toHaveLength(1);
  });

  it('a_job_is_never_posted_twice_even_from_a_folder_outbox_left_mid_crash', async () => {
    /*
     * THE CRASH CASE THE FOLDER VERSION HAD TO REPAIR, CARRIED ACROSS THE
     * UPGRADE. A folder build that died between writing the sent marker and
     * removing the pending file left the same form in both. The import must
     * treat it as sent — even though the pending copy says it is not due for
     * an hour — because "already delivered" outranks any schedule.
     */
    const sha = 'd'.repeat(64);
    const notDueForAnHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    for (const tier of ['sent', 'pending']) {
      mkdirSync(join(dir, 'outbox', tier), { recursive: true });
      writeFileSync(
        join(dir, 'outbox', tier, `${sha}.json`),
        JSON.stringify({ record: aRecord(sha), enqueuedAt: notDueForAnHour, attempts: 1, nextAttemptAt: notDueForAnHour }),
        'utf8',
      );
    }

    const posted: string[] = [];
    const store = storeAt(dir);
    const outbox = new Outbox(store, async (record) => {
      posted.push(record.sourceSha256);
      return ACCEPTED;
    }, logger, () => new Date(Date.now() + 2 * 60 * 60 * 1000));

    await outbox.flush();
    expect(posted).toEqual([]);
    expect(store.jobState(sha)).toBe('sent');
    expect(existsSync(join(dir, 'outbox', 'pending', `${sha}.json`))).toBe(false);
  });

  it('a_job_survives_a_restart_mid_flight', async () => {
    // The first process queues the job and dies during the attempt. "Dies" is
    // modelled as the poster failing — the row is committed before the
    // attempt, which is the whole design.
    const first = new Outbox(storeAt(dir), async () => UNREACHABLE, logger);
    first.enqueue(aRecord());
    await first.flush();

    const store = storeAt(dir);
    expect(store.shas('queued')).toEqual(['c'.repeat(64)]);
    const stored = store.getJob('c'.repeat(64));
    expect(stored?.attempts).toBe(1);
    expect(stored?.record?.form?.formReference).toBe('HSS0610012092026120300');

    // A completely new process over the same database, with the clock moved
    // past the backoff, finds the job and delivers it.
    const posted: string[] = [];
    const later = new Date(Date.now() + 60 * 60 * 1000);
    const second = new Outbox(
      storeAt(dir),
      async (record) => {
        posted.push(record.sourceSha256);
        return ACCEPTED;
      },
      logger,
      () => later,
    );
    const result = await second.flush();
    expect(posted).toEqual(['c'.repeat(64)]);
    expect(result.sent).toBe(1);
    expect(result.waiting).toBe(0);
  });

  it('an_unreachable_server_never_blocks_printing', async () => {
    // Nothing in this program is on the print path; what this asserts is the
    // consequence that could still bite — that an unreachable server leaves the
    // queue GROWING and healthy rather than erroring, dropping or wedging.
    const store = storeAt(dir);
    const outbox = new Outbox(store, async () => UNREACHABLE, logger);

    for (let i = 0; i < 25; i += 1) {
      expect(outbox.enqueue(aRecord(i.toString(16).padStart(64, '0')))).toBe('queued');
    }

    // Twenty-five forms printed during an outage. Flushing never throws, and
    // nothing is discarded.
    await expect(outbox.flush()).resolves.toEqual({ sent: 0, failed: 25, waiting: 25 });
    expect(outbox.depth()).toBe(25);

    // The domain's `backoffFor` sets the pace and the queue never retires a
    // job: there is no `dead` state here, because nothing watches a
    // receptionist's desktop to notice one.
    const job = store.getJob('0'.repeat(64));
    expect(job?.attempts).toBe(1);
    expect(new Date(job!.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());

    // And when the server comes back, everything queued goes.
    const posted: string[] = [];
    const later = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const recovered = new Outbox(
      storeAt(dir),
      async (record) => {
        posted.push(record.sourceSha256);
        return ACCEPTED;
      },
      logger,
      () => later,
    );
    await recovered.flush();
    expect(posted).toHaveLength(25);
    expect(recovered.depth()).toBe(0);
  });

  it('treats the server saying "already had it" as delivered, not as a failure', async () => {
    const outbox = new Outbox(storeAt(dir), async () => ({ ok: true, status: 202, duplicate: true }), logger);
    outbox.enqueue(aRecord());
    await expect(outbox.flush()).resolves.toMatchObject({ sent: 1, waiting: 0 });
  });

  it('refuses a job that is not keyed by the hash of its source bytes', () => {
    const outbox = new Outbox(storeAt(dir), async () => ACCEPTED, logger);
    expect(() => outbox.enqueue({ ...aRecord(), sourceSha256: 'not-a-hash' })).toThrow(/sha256/);
  });

  it('clears a half-written job file rather than reading it as a form', () => {
    mkdirSync(join(dir, 'outbox', 'tmp'), { recursive: true });
    writeFileSync(join(dir, 'outbox', 'tmp', 'truncated.json'), '{"record": {"patie', 'utf8');
    // Opening the store recovers. A tmp file is by definition one whose rename
    // never happened, so nothing was promised about it.
    const store = storeAt(dir);
    expect(readdirSync(join(dir, 'outbox', 'tmp'))).toEqual([]);
    expect(store.pendingCount()).toBe(0);
  });
});

describe('a_newer_on_disk_format_refuses_to_start', () => {
  afterEach(closeStores);

  it('refuses to open an outbox written by a later build, rather than half-reading it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aobprinter-format-'));
    try {
      // A downgrade that quietly skipped what it could not parse would drop a
      // patient's form on the floor, and the payloads are encrypted by a
      // scheme this build may not know about (D-2026-09-17-01).
      const pending = join(dir, 'outbox', 'pending');
      mkdirSync(pending, { recursive: true });
      writeFileSync(
        join(pending, `${'a'.repeat(64)}.json`),
        JSON.stringify({ formatVersion: OUTBOX_FORMAT_VERSION + 1, record: {}, attempts: 0 }),
        'utf8',
      );

      let thrown: Error | undefined;
      try {
        storeAt(dir);
      } catch (err) {
        thrown = err as Error;
      }

      assert.ok(thrown, 'a newer on-disk format must stop the program starting');
      assert.match(thrown.message, /refuses to start/i);
      assert.match(thrown.message, new RegExp(String(OUTBOX_FORMAT_VERSION + 1)));
      // And the file it refused is still there for a human to look at.
      assert.ok(existsSync(join(pending, `${'a'.repeat(64)}.json`)));
    } finally {
      closeStores();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('opens normally when the format is the one this build writes, or older', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aobprinter-format-'));
    try {
      const pending = join(dir, 'outbox', 'pending');
      mkdirSync(pending, { recursive: true });
      // No formatVersion at all means "written before the field existed",
      // which is version 1 and must still open.
      writeFileSync(join(pending, `${'b'.repeat(64)}.json`), JSON.stringify({ record: {}, attempts: 0 }), 'utf8');
      assert.doesNotThrow(() => storeAt(dir));
    } finally {
      closeStores();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
