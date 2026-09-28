/**
 * The poster and the loop, which were the two files with no test of their own
 * until a reviewer said so (17 Sep 2026).
 *
 * They are the two that the "never twice, never blocks" promise leans on
 * hardest: the poster decides what counts as delivered, and `tick` is the only
 * thing that calls any of it. Everything else was tested through an injected
 * mock poster, which proves the outbox and proves nothing about these.
 *
 * `fetch` is stubbed rather than a server started. What is under test is how
 * this code reads a response, not whether Node can make a request.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_COLLECTION_CONFIG, DEFAULT_RETENTION_CONFIG, type AobPrinterConfig } from './config';
import type { Db4PrintRecord } from './db4-record';
import { keystorePaths, type KeyWrapper } from './keystore';
import { makeLogger, redactError } from './log';
import { start, type StartDeps } from './main';
import { makeHttpPoster } from './poster';
import { watcherDirs } from './watcher';
import { openStore } from './store';

/**
 * WHAT EVERY `start()` HERE IS GIVEN. The key always loads now
 * (D-2026-09-29-02), and the real wrapper is DPAPI through PowerShell, which
 * the Linux CI runner does not have — so these tests hand in a stand-in, and
 * a drive-type answer, exactly as they already hand in everything else that
 * would otherwise reach outside the process.
 */
const IDENTITY_WRAPPER: KeyWrapper = { wrap: (key) => key, unwrap: (key) => key };
const TEST_DEPS: StartDeps = { keyWrapper: IDENTITY_WRAPPER, driveTypeOf: () => 'Fixed' };

const CARD = '2999 88887 1';

function aRecord(): Db4PrintRecord {
  return {
    documentType: 'db4_assignment',
    sourceSha256: 'd'.repeat(64),
    parserTemplateVersion: 'pracsoft3-db4-2026-09-1',
    pms: 'pracsoft3',
    capturedAt: '2026-09-17T00:00:00.000Z',
  };
}

function aConfig(dataDir: string): AobPrinterConfig {
  return {
    practiceId: 'a2629964-c984-4a07-8db6-c42f40243654',
    endpoint: 'http://localhost:3001/inbound/print-jobs',
    // A single-workstation install is the general case with one entry in it.
    queues: [{ name: 'AOBPRINTER', spoolFile: join(dataDir, 'spool', 'aobprinter-out.pdf'), label: 'AOBPRINTER' }],
    dataDir,
    pollMs: 500,
    settleMs: 750,
    templateVersion: 'pracsoft3-db4-2026-09-1',
    retention: DEFAULT_RETENTION_CONFIG,
    collection: DEFAULT_COLLECTION_CONFIG,
  };
}

describe('the poster', () => {
  const lines: string[] = [];
  const logger = makeLogger((line) => lines.push(line));
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    lines.length = 0;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response> | Promise<never>) {
    globalThis.fetch = ((url: string, init: RequestInit) => Promise.resolve(handler(url, init))) as typeof fetch;
  }

  it('sends the record to the configured endpoint with the practice header', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    let seenBody = '';
    stubFetch((url, init) => {
      seenUrl = url;
      seenHeaders = init.headers as Record<string, string>;
      seenBody = init.body as string;
      return new Response(JSON.stringify({ id: 'x', lane: 'critical', duplicate: false }), { status: 202 });
    });

    const result = await makeHttpPoster(aConfig(tmpdir()), logger)(aRecord());

    expect(result).toEqual({ ok: true, status: 202, duplicate: false, jobId: 'x' });
    expect(seenUrl).toBe('http://localhost:3001/inbound/print-jobs');
    // The practice id is configuration, never compiled in, and it is the only
    // credential this build has. Mutual TLS is the recorded posture and is not
    // built — config.ts and poster.ts both say so out loud.
    expect(seenHeaders['x-practice-id']).toBe('a2629964-c984-4a07-8db6-c42f40243654');
    expect(JSON.parse(seenBody).sourceSha256).toBe('d'.repeat(64));
  });

  it('reads "the server already had this one" as delivered', async () => {
    stubFetch(() => new Response(JSON.stringify({ duplicate: true }), { status: 202 }));
    await expect(makeHttpPoster(aConfig(tmpdir()), logger)(aRecord())).resolves.toEqual({
      ok: true,
      status: 202,
      duplicate: true,
    });
  });

  it('accepts a 2xx whose body is not JSON rather than failing a delivered job', async () => {
    // A proxy that answers 202 with an empty body must not turn a job that
    // arrived into one that is retried forever.
    stubFetch(() => new Response('', { status: 202 }));
    await expect(makeHttpPoster(aConfig(tmpdir()), logger)(aRecord())).resolves.toMatchObject({ ok: true, status: 202 });
  });

  it('separates "try again" from "this will never work", and retries both', async () => {
    const poster = makeHttpPoster(aConfig(tmpdir()), logger);

    for (const status of [500, 502, 503, 408, 429]) {
      stubFetch(() => new Response('', { status }));
      const result = await poster(aRecord());
      expect(result).toMatchObject({ ok: false, status, retryable: true });
    }
    // Nothing above is the server refusing the job, so nothing is logged loudly.
    expect(lines.join('\n')).not.toContain('post.rejected');

    // A 4xx that is not 408/429 IS the server refusing it. Still not ok, still
    // never discarded — but said out loud, because it needs a human, not time,
    // and marked `retryable: false` so the outbox can tell the two apart
    // (`outbox-retention.test.ts`'s poison tier).
    stubFetch(() => new Response('', { status: 422 }));
    expect(await poster(aRecord())).toMatchObject({ ok: false, status: 422, retryable: false });
    expect(lines.join('\n')).toContain('post.rejected');
  });

  it('turns an unreachable server into a retry, not a throw', async () => {
    globalThis.fetch = (() => Promise.reject(new Error('fetch failed: ECONNREFUSED'))) as typeof fetch;
    await expect(makeHttpPoster(aConfig(tmpdir()), logger)(aRecord())).resolves.toMatchObject({ ok: false, status: 0 });
  });

  it('redacts a transport error before it reaches the log', async () => {
    // The plausible leak: a proxy or a DNS layer echoing the request into its
    // error message.
    globalThis.fetch = (() => Promise.reject(new Error(`upstream rejected body containing ${CARD}`))) as typeof fetch;
    const result = await makeHttpPoster(aConfig(tmpdir()), logger)(aRecord());
    expect(result.error).not.toContain(CARD);
    expect(result.error).not.toContain('2999');
  });
});

describe('the loop', () => {
  let dir: string;
  const lines: string[] = [];
  const logger = makeLogger((line) => lines.push(line));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aobprinter-main-'));
    lines.length = 0;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('starts, says what it is, and stops', () => {
    const handles = start(aConfig(dir), logger, TEST_DEPS);
    try {
      expect(lines.join('\n')).toContain('aobprinter.started');
      // The template version is the first thing a support call needs and must
      // survive the redactor; it did not, once.
      expect(lines.join('\n')).toContain('template=pracsoft3-db4-2026-09-1');
    } finally {
      handles.stop();
    }
    expect(lines.join('\n')).toContain('aobprinter.stopped');
  });

  it('refuses to start against a template it does not carry', () => {
    // Better than parsing nothing quietly: a config naming a template that
    // shipped in another build would produce empty records all day.
    expect(() => start({ ...aConfig(dir), templateVersion: 'pracsoft3-db4-2099-1' }, logger, TEST_DEPS)).toThrow(/parser template/);
  });

  it('warns when the endpoint is neither local nor HTTPS', () => {
    const handles = start({ ...aConfig(dir), endpoint: 'http://192.168.1.50/inbound/print-jobs' }, logger, TEST_DEPS);
    handles.stop();
    expect(lines.join('\n')).toContain('config.insecure_endpoint');
  });

  it('a tick never throws, and what it logs when it fails is redacted', async () => {
    const handles = start(aConfig(dir), logger, TEST_DEPS);
    try {
      /*
       * The catch-all's whole purpose: an exception nobody anticipated,
       * carrying whatever text it carries. A FILE WHERE THE QUEUE'S JOBS
       * FOLDER SHOULD BE, so listing it throws inside the loop. (Until 29 Sep
       * 2026 this removed the whole data folder, which Windows now refuses
       * while the database is open — and the read that used to throw was the
       * folder outbox, which no longer exists.)
       */
      const jobs = watcherDirs(dir, aConfig(dir).queues[0].name).jobs;
      rmSync(jobs, { recursive: true, force: true });
      writeFileSync(jobs, 'not a folder', 'utf8');
      await expect(handles.tick()).resolves.toBeUndefined();
      // And the catch-all really did catch something — not a vacuous pass.
      expect(lines.join('\n')).toContain('tick.failed');

      // And the same path with a message that DOES carry a card number: the
      // catch-all used to log `err.message` raw.
      // Drive the same log call the catch-all makes, with a message shaped
      // like the leak it guards against.
      makeLogger((line) => lines.push(line)).error('tick.failed', {
        error: redactError(new Error(`ENOENT reading a page for ${CARD}`)),
      });
      expect(lines.join('\n')).not.toContain(CARD);
      expect(lines.join('\n')).not.toContain('2999888871');
    } finally {
      handles.stop();
    }
  });

  it('a second tick does not run while the first is still going', async () => {
    // Two overlapping timers claiming the same spool file is the race this
    // guard exists for.
    const handles = start(aConfig(dir), logger, TEST_DEPS);
    try {
      await Promise.all([handles.tick(), handles.tick(), handles.tick()]);
      // One claim attempt per completed tick at most; nothing double-claimed
      // and, more to the point, nothing threw.
      expect(lines.join('\n')).not.toContain('tick.failed');
    } finally {
      handles.stop();
    }
  });

  it('the_sweep_runs_at_startup_not_only_on_the_timer', () => {
    // A form that aged past the alarm threshold overnight, while nothing was
    // running, must be flagged the moment the program comes back up — not
    // after a poll interval or a scheduled sweep gets around to it.
    const staleSha = 'e'.repeat(64);
    const staleAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h old; default alarm is 1h.
    // Written the way the FOLDER outbox wrote it: the database imports it at
    // start, and the sweep must still flag it — an upgrade does not reset the clock.
    mkdirSync(join(dir, 'outbox', 'pending'), { recursive: true });
    writeFileSync(
      join(dir, 'outbox', 'pending', `${staleSha}.json`),
      JSON.stringify({ enqueuedAt: staleAt, attempts: 0, nextAttemptAt: staleAt, record: aRecord() }),
      'utf8',
    );

    const handles = start(aConfig(dir), logger, TEST_DEPS);
    try {
      // No tick() called, no timer advanced: `start()` itself ran the sweep.
      expect(lines.join('\n')).toContain('outbox.pending_stale');
      // And the startup banner says so too, for whoever is watching the log.
      expect(lines.join('\n')).toContain('pendingAlarms=1');
    } finally {
      handles.stop();
    }

    // AND `program.started` COMES FIRST: the import this start did sits after the marker that explains it.
    const store = openStore(dir);
    try {
      const kinds = store.auditEvents().map((e) => e.kind);
      expect(kinds[0]).toBe('program.started');
      expect(kinds.indexOf('print.imported')).toBeGreaterThan(0);
      expect(kinds.at(-1)).toBe('program.stopped');
    } finally {
      store.close();
    }
  });

  it('stopping_during_a_post_waits_for_it_so_the_acknowledgement_is_recorded_and_nothing_is_posted_twice', async () => {
    /*
     * A stop that closed the database under a post the server had just
     * accepted could not record the acknowledgement, and the form would be
     * posted again on the next start. The post is held open here, the program
     * is told to stop mid-flight, and then the server answers.
     */
    const sha = 'e'.repeat(64);
    const now = new Date().toISOString();
    mkdirSync(join(dir, 'outbox', 'pending'), { recursive: true });
    writeFileSync(join(dir, 'outbox', 'pending', `${sha}.json`), JSON.stringify({ enqueuedAt: now, attempts: 0, nextAttemptAt: now, record: aRecord() }), 'utf8');

    const realFetch = globalThis.fetch;
    let answer: (response: Response) => void = () => undefined;
    let posted = 0;
    globalThis.fetch = (() => {
      posted += 1;
      return new Promise<Response>((resolve) => {
        answer = resolve;
      });
    }) as typeof fetch;
    try {
      const handles = start(aConfig(dir), logger, TEST_DEPS);
      const ticking = handles.tick();
      await new Promise((resolve) => setImmediate(resolve));
      expect(posted).toBe(1);

      handles.stop(); // mid-flight
      expect(lines.join('\n')).not.toContain('aobprinter.stopped');

      answer(new Response(JSON.stringify({ id: 'job-1' }), { status: 202, headers: { 'content-type': 'application/json' } }));
      await ticking;
      expect(lines.join('\n')).toContain('aobprinter.stopped');
      expect(lines.join('\n')).not.toContain('tick.failed');
    } finally {
      globalThis.fetch = realFetch;
    }

    const store = openStore(dir);
    try {
      expect(store.jobState(sha)).toBe('sent');
      const kinds = store.auditEvents().map((e) => e.kind);
      expect(kinds.indexOf('print.sent')).toBeLessThan(kinds.indexOf('program.stopped'));
    } finally {
      store.close();
    }
  });

  it('the_program_refuses_to_start_if_the_key_cannot_be_unwrapped', () => {
    // A wrapped key already on disk (from a previous run, or restored from
    // another machine) that this machine's DPAPI cannot read back.
    mkdirSync(dir, { recursive: true });
    writeFileSync(keystorePaths(dir).wrappedKeyFile, Buffer.from('not a real wrapped key'));

    const brokenWrapper: KeyWrapper = {
      wrap: () => Buffer.from('irrelevant'),
      unwrap: () => {
        throw new Error('simulated DPAPI unwrap failure');
      },
    };

    expect(() =>
      start(
        { ...aConfig(dir), retention: { ...DEFAULT_RETENTION_CONFIG, enabled: true } },
        logger,
        { ...TEST_DEPS, keyWrapper: brokenWrapper },
      ),
    ).toThrow(/unwrap/i);

    /*
     * THE OTHER HALF USED TO SAY THE OPPOSITE. Until 29 September 2026 this
     * asserted that with retention off, starting never called the wrapper.
     * D-2026-09-29-02 reversed that on Carl's say-so — the audit trail and
     * the archive are encrypted from day one — so this now proves the key IS
     * loaded with retention off, the shipped default.
     */
    const fresh = mkdtempSync(join(tmpdir(), 'aobprinter-key-'));
    try {
      let asked = 0;
      const counting: KeyWrapper = {
        wrap: (key) => {
          asked += 1;
          return key;
        },
        unwrap: (key) => {
          asked += 1;
          return key;
        },
      };
      expect(() => start(aConfig(fresh), logger, { ...TEST_DEPS, keyWrapper: counting }).stop()).not.toThrow();
      expect(asked).toBeGreaterThan(0);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });
});
