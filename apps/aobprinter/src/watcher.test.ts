/**
 * Claiming, and the promise that a half-written page is never read as a whole
 * one.
 *
 * The fixture is the real printed PDF (see parser.test.ts); the truncations
 * below are slices of those same bytes, which is what a spool file caught
 * mid-write actually looks like.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLogger } from './log';
import { Outbox, sha256Hex } from './outbox';
import { DEFAULT_TEMPLATE_VERSION, templateFor } from './template';
import { SpoolClaimer, claimedJobs, isCompletePdf, processClaimedJob, watcherDirs } from './watcher';

const FIXTURE = join(__dirname, '..', 'test-fixtures', 'pracsoft3-db4-probe.pdf');
const template = templateFor(DEFAULT_TEMPLATE_VERSION)!;

describe('claiming a job off a one-slot port', () => {
  let dir: string;
  let spool: string;
  const lines: string[] = [];
  const logger = makeLogger((line) => lines.push(line));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aobprinter-watch-'));
    mkdirSync(join(dir, 'spool'), { recursive: true });
    spool = join(dir, 'spool', 'aobprinter-out.pdf');
    lines.length = 0;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('a_half_written_spool_file_is_never_parsed', () => {
    const dirs = watcherDirs(dir);
    const whole = readFileSync(FIXTURE);

    /*
     * GUARD ONE: it must stop growing. A file seen for the first time is never
     * claimed on that look, and a file whose size changed since the last look
     * is not claimed either — however long it has been there.
     */
    let clock = new Date('2026-09-17T00:00:00.000Z');
    const claimer = new SpoolClaimer(spool, dirs, 750, logger, () => clock);

    writeFileSync(spool, whole.subarray(0, 10_000));
    expect(claimer.claim()).toBeNull(); // first sight

    clock = new Date(clock.getTime() + 5_000);
    writeFileSync(spool, whole.subarray(0, 30_000)); // the spooler wrote more
    expect(claimer.claim()).toBeNull(); // grew: not claimed, however long it sat

    clock = new Date(clock.getTime() + 100);
    expect(claimer.claim()).toBeNull(); // stable, but not for long enough yet

    /*
     * GUARD TWO: the bytes must be a whole PDF. Here the size HAS settled and
     * the file is claimed — and the content check catches that it is a
     * truncation with no `%%EOF`, so it is parked and never parsed.
     */
    clock = new Date(clock.getTime() + 1_000);
    const claimed = claimer.claim();
    expect(claimed).not.toBeNull();

    expect(isCompletePdf(whole.subarray(0, 30_000))).toBe(false);
    expect(isCompletePdf(whole)).toBe(true);

    const posted: string[] = [];
    const outbox = new Outbox(dir, async (r) => {
      posted.push(r.sourceSha256);
      return { ok: true, status: 202 };
    }, logger);

    const result = processClaimedJob(claimed!, template, outbox, dirs, logger, () => clock);
    expect(result.outcome).toBe('incomplete');
    expect(result.record).toBeUndefined();
    expect(posted).toEqual([]);
    expect(outbox.depth()).toBe(0);

    // Parked where a human can look, with a reason code beside it.
    const parked = readdirSync(dirs.unparsed);
    expect(parked.filter((n) => n.endsWith('.pdf'))).toHaveLength(1);
    expect(readFileSync(join(dirs.unparsed, `${parked.filter((n) => n.endsWith('.pdf'))[0]}.reason.txt`), 'utf8')).toBe(
      'incomplete_pdf\n',
    );
  });

  it('claims a settled job out of the slot before the next print can overwrite it', () => {
    const dirs = watcherDirs(dir);
    let clock = new Date('2026-09-17T01:00:00.000Z');
    const claimer = new SpoolClaimer(spool, dirs, 750, logger, () => clock);

    copyFileSync(FIXTURE, spool);
    expect(claimer.claim()).toBeNull();
    clock = new Date(clock.getTime() + 1_000);

    const first = claimer.claim();
    expect(first).not.toBeNull();
    // The slot is EMPTY again, which is the point: the next job cannot
    // overwrite a form we have not read.
    expect(existsSync(spool)).toBe(false);
    expect(statSync(first!).size).toBe(statSync(FIXTURE).size);

    // A second print into the same slot becomes a second, separately named job.
    copyFileSync(FIXTURE, spool);
    clock = new Date(clock.getTime() + 1_000);
    expect(claimer.claim()).toBeNull(); // first sight of the new file
    clock = new Date(clock.getTime() + 1_000);
    const second = claimer.claim();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(claimedJobs(dirs)).toHaveLength(2);
  });

  it('parses a claimed job, queues it, and removes the source only once the record is durable', () => {
    const dirs = watcherDirs(dir);
    mkdirSync(dirs.jobs, { recursive: true });
    const claimed = join(dirs.jobs, '2026-09-17T02-00-00-000Z-abcdef012345.pdf');
    copyFileSync(FIXTURE, claimed);

    const outbox = new Outbox(dir, async () => ({ ok: true, status: 202 }), logger);
    const { outcome, record } = processClaimedJob(claimed, template, outbox, dirs, logger);

    expect(outcome).toBe('queued');
    expect(record!.sourceSha256).toBe(sha256Hex(readFileSync(FIXTURE)));
    expect(outbox.depth()).toBe(1);
    expect(existsSync(claimed)).toBe(false);
  });

  it('the same print claimed twice produces one queued job', () => {
    // What a crash between "record queued" and "source deleted" leaves behind.
    const dirs = watcherDirs(dir);
    mkdirSync(dirs.jobs, { recursive: true });
    const outbox = new Outbox(dir, async () => ({ ok: true, status: 202 }), logger);

    for (const name of ['a.pdf', 'b.pdf']) {
      const path = join(dirs.jobs, name);
      copyFileSync(FIXTURE, path);
      processClaimedJob(path, template, outbox, dirs, logger);
    }
    expect(outbox.depth()).toBe(1);
  });

  it('parks a page that is not a DB4 instead of posting a mystery', () => {
    const dirs = watcherDirs(dir);
    mkdirSync(dirs.jobs, { recursive: true });
    const path = join(dirs.jobs, 'not-a-db4.pdf');
    // A complete PDF with a text layer that is not this form: the fixture's own
    // bytes with the form reference and the statements removed would need a
    // re-render, so a minimal hand-built PDF stands in for "some other page".
    writeFileSync(path, Buffer.from(MINIMAL_PDF, 'latin1'));

    const outbox = new Outbox(dir, async () => ({ ok: true, status: 202 }), logger);
    expect(processClaimedJob(path, template, outbox, dirs, logger).outcome).not.toBe('queued');
    expect(outbox.depth()).toBe(0);
  });
});

/** A complete, readable, uninteresting one-line PDF. */
const MINIMAL_PDF = [
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
