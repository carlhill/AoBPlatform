/**
 * The HTTP half of the heartbeat (PRINTER-HEARTBEAT.md §2). `fetch` is
 * stubbed rather than a server started, the way `poster.test.ts` does it:
 * what is under test is the URL, the headers and how a response is read.
 */
import type { AobPrinterHeartbeat, AobPrinterHeartbeatReply } from '@aobplatform/contracts';
import { DEFAULT_COLLECTION_CONFIG, DEFAULT_HEARTBEAT_CONFIG, DEFAULT_RETENTION_CONFIG, type AobPrinterConfig } from './config';
import { HeartbeatHttpError } from './heartbeat';
import { heartbeatUrlOf, makeHttpHeartbeatClient } from './heartbeat-client';
import { readPackageVersion } from './version';

const PRACTICE = 'a2629964-c984-4a07-8db6-c42f40243654';

function aConfig(endpoint: string): AobPrinterConfig {
  return {
    practiceId: PRACTICE,
    endpoint,
    queues: [{ name: 'AOBPRINTER', spoolFile: 'C:\\spool\\aobprinter-out.pdf', label: 'AOBPRINTER' }],
    dataDir: 'C:\\ProgramData\\AoBPlatform',
    pollMs: 500,
    settleMs: 750,
    templateVersion: 'pracsoft3-db4-2026-09-1',
    retention: DEFAULT_RETENTION_CONFIG,
    collection: DEFAULT_COLLECTION_CONFIG,
    heartbeat: DEFAULT_HEARTBEAT_CONFIG,
  };
}

/** Only the shape matters to the client; it sends what it is given. */
const BEAT = { chainId: 'a'.repeat(64), head: { seq: 3, hash: 'b'.repeat(64) } } as unknown as AobPrinterHeartbeat;

const REPLY: AobPrinterHeartbeatReply = {
  receivedAt: '2026-10-10T00:00:00.000Z',
  chain: { status: 'unverified', anchorSeq: 3 },
  jobs: [],
  returns: [],
};

describe('the heartbeat client', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('posts_to_the_heartbeat_url_derived_from_the_ingest_endpoint_with_the_practice_header', async () => {
    let seenUrl = '';
    let seenInit: RequestInit = {};
    globalThis.fetch = ((url: string, init: RequestInit) => {
      seenUrl = url;
      seenInit = init;
      return Promise.resolve(new Response(JSON.stringify(REPLY), { status: 200, headers: { 'content-type': 'application/json' } }));
    }) as typeof fetch;

    // A trailing slash on the configured URL does not double up.
    const config = aConfig('https://api.example.test/inbound/print-jobs/');
    const caller = new AbortController();
    const reply = await makeHttpHeartbeatClient(config).beat(BEAT, caller.signal);

    expect(seenUrl).toBe('https://api.example.test/inbound/print-jobs/heartbeat');
    expect(heartbeatUrlOf(config)).toBe(seenUrl);
    expect(seenInit.method).toBe('POST');
    expect(seenInit.headers).toEqual({
      'content-type': 'application/json',
      'x-practice-id': PRACTICE,
      'x-aobprinter-version': readPackageVersion(),
      'x-read-by': 'aobprinter',
    });
    expect(JSON.parse(String(seenInit.body))).toEqual(BEAT);
    expect(reply).toEqual(REPLY);

    expect(caller.signal.aborted).toBe(false);

    // The caller's signal reaches a request in flight: a stop aborts it.
    let inFlight: AbortSignal | undefined;
    globalThis.fetch = ((_url: string, init: RequestInit) => {
      inFlight = init.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }) as typeof fetch;
    const stopping = new AbortController();
    const hanging = makeHttpHeartbeatClient(config).beat(BEAT, stopping.signal);
    expect(inFlight?.aborted).toBe(false);
    stopping.abort();
    await expect(hanging).rejects.toThrow('aborted');
    expect(inFlight?.aborted).toBe(true);
  });

  it('a_non_2xx_is_a_rejection_carrying_its_status', async () => {
    for (const status of [403, 503]) {
      globalThis.fetch = (() => Promise.resolve(new Response('{}', { status }))) as typeof fetch;
      const rejection = makeHttpHeartbeatClient(aConfig('http://localhost:3001/inbound/print-jobs')).beat(BEAT, new AbortController().signal);
      await expect(rejection).rejects.toBeInstanceOf(HeartbeatHttpError);
      await expect(rejection).rejects.toMatchObject({ status });
    }
  });
});
