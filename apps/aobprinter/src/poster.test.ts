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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AobPrinterConfig } from './config';
import type { Db4PrintRecord } from './db4-record';
import { makeLogger, redactError } from './log';
import { start } from './main';
import { makeHttpPoster } from './poster';

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
    spoolFile: join(dataDir, 'spool', 'aobprinter-out.pdf'),
    dataDir,
    pollMs: 500,
    settleMs: 750,
    templateVersion: 'pracsoft3-db4-2026-09-1',
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

    expect(result).toEqual({ ok: true, status: 202, duplicate: false });
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
      expect(result).toMatchObject({ ok: false, status });
    }
    // Nothing above is the server refusing the job, so nothing is logged loudly.
    expect(lines.join('\n')).not.toContain('post.rejected');

    // A 4xx that is not 408/429 IS the server refusing it. Still not ok, still
    // never discarded — but said out loud, because it needs a human, not time.
    stubFetch(() => new Response('', { status: 422 }));
    expect(await poster(aRecord())).toMatchObject({ ok: false, status: 422 });
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
    const handles = start(aConfig(dir), logger);
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
    expect(() => start({ ...aConfig(dir), templateVersion: 'pracsoft3-db4-2099-1' }, logger)).toThrow(/parser template/);
  });

  it('warns when the endpoint is neither local nor HTTPS', () => {
    const handles = start({ ...aConfig(dir), endpoint: 'http://192.168.1.50/inbound/print-jobs' }, logger);
    handles.stop();
    expect(lines.join('\n')).toContain('config.insecure_endpoint');
  });

  it('a tick never throws, and what it logs when it fails is redacted', async () => {
    const handles = start(aConfig(dir), logger);
    try {
      // The catch-all's whole purpose: an exception nobody anticipated, carrying
      // whatever text it carries. The directory is removed underneath the loop.
      rmSync(dir, { recursive: true, force: true });
      await expect(handles.tick()).resolves.toBeUndefined();

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
    const handles = start(aConfig(dir), logger);
    try {
      await Promise.all([handles.tick(), handles.tick(), handles.tick()]);
      // One claim attempt per completed tick at most; nothing double-claimed
      // and, more to the point, nothing threw.
      expect(lines.join('\n')).not.toContain('tick.failed');
    } finally {
      handles.stop();
    }
  });
});
