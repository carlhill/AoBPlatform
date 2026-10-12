/**
 * Hard rule 1's logging half, and hard rule 9.
 *
 * D-2026-09-14-03 let the Medicare card number and IRN travel on the DB4 Print
 * Record. It changed nothing about where they may appear: never in a log line,
 * never in an error message, never in a filename, never in an event, never used
 * to verify or to match a patient. This file is the test that says so about the
 * one program that holds a whole form.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { looksLikeAnIdentifier, makeLogger, redact, redactError } from './log';
import { Outbox } from './outbox';
import { DEFAULT_TEMPLATE_VERSION, templateFor } from './template';
import { processClaimedJob, watcherDirs } from './watcher';
import { openStore, type AobPrinterStore } from './store';

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

/** One queue, named the way a single-workstation install names it. */
const QUEUE = { name: 'AOBPRINTER', spoolFile: 'unused-in-this-test', label: 'Front desk' };

const FIXTURE = join(__dirname, '..', 'test-fixtures', 'pracsoft3-db4-probe.pdf');

/** The fixture's number. Obviously fake, and its checksum is invalid. */
const CARD = '2999 88887 1';
const CARD_UNSPACED = '2999888871';

describe('the_medicare_number_never_appears_in_a_log_or_a_filename', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aobprinter-log-'));
  });
  afterEach(() => {
    closeStores();
    rmSync(dir, { recursive: true, force: true });
  });

  it('never writes it to a log line, from any path through the program', async () => {
    const lines: string[] = [];
    const logger = makeLogger((line) => lines.push(line));

    const dirs = watcherDirs(dir, QUEUE.name);
    mkdirSync(dirs.jobs, { recursive: true });
    const claimed = join(dirs.jobs, '2026-09-17T03-00-00-000Z-0123456789ab.pdf');
    copyFileSync(FIXTURE, claimed);

    // The unhappy path as well as the happy one: a server that refuses the job
    // is where an unredacted body most plausibly reaches a log.
    const outbox = new Outbox(storeAt(dir), async () => ({ ok: false, status: 422, error: `rejected: ${CARD}` }), logger);
    const { record } = processClaimedJob(claimed, template(), outbox, dirs, QUEUE, logger);
    await outbox.flush();
    await outbox.flush();

    // The record really does carry it — this is not a test that passes because
    // the number was never there.
    expect(record!.patient!['medicareCardNumber']).toBe(CARD);

    const log = lines.join('\n');
    expect(log).not.toContain(CARD);
    expect(log).not.toContain(CARD_UNSPACED);
    // And nothing else off the form either.
    expect(log).not.toContain('Fakesurname');
    expect(log).not.toContain('Imaginary Ave');
    expect(log).not.toContain('0400 000 001');
    // It is not silent, though: the log still answers "what happened".
    expect(log).toContain('outbox.queued');
    expect(log).toContain('outbox.retry');
  });

  it('never writes it into a filename, anywhere under the data directory', () => {
    const lines: string[] = [];
    const logger = makeLogger((line) => lines.push(line));
    const dirs = watcherDirs(dir, QUEUE.name);
    mkdirSync(dirs.jobs, { recursive: true });
    const claimed = join(dirs.jobs, '2026-09-17T04-00-00-000Z-ba9876543210.pdf');
    copyFileSync(FIXTURE, claimed);

    const store = storeAt(dir);
    const outbox = new Outbox(store, async () => ({ ok: false, status: 0, error: 'unreachable' }), logger);
    processClaimedJob(claimed, template(), outbox, dirs, QUEUE, logger);

    for (const path of walk(dir)) {
      expect(path).not.toContain(CARD_UNSPACED);
      expect(path).not.toContain(CARD.replace(/ /g, ''));
      expect(path).not.toContain('09911'); // nor the chart number
      expect(path).not.toContain('Fakesurname');
    }
    // The queued job is keyed by the source hash and nothing else (a row since 29 Sep 2026, not a file).
    expect(store.shas('queued')).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/)]);
  });

  it('redacts the card number wherever it turns up in a string', () => {
    expect(redact(`Medicare Card Number: ${CARD} IRN: 4`)).not.toContain('2999');
    expect(redact(`card=${CARD_UNSPACED}`)).toBe('card=[redacted]');
    expect(redact('mobile 0400 000 001')).not.toContain('0400');
    expect(redactError(new Error(`ECONNREFUSED posting ${CARD_UNSPACED}`))).not.toContain(CARD_UNSPACED);
  });

  it('leaves the things that must stay readable alone', () => {
    // A hash is not PII and IS the thing a support call needs.
    const sha = 'a1b2c3d4'.repeat(8);
    expect(redact(sha)).toBe(sha);
    expect(redact('outbox.retry status=503 attempts=2')).toContain('status=503');
    // A form reference is a form reference, not a person.
    expect(redact('HSS0610012092026120300')).toBe('HSS0610012092026120300');

    /*
     * THE DIAGNOSTICS SURVIVE. The first real log line this program produced
     * read `template=pracsoft3-db4-[redacted]`, because the redactor was
     * treating hyphens as a digit separator and a version number looks like a
     * long digit run. A redactor that eats the template version and the job
     * timestamp is one that gets switched off by whoever is debugging at three
     * in the morning, which is worse for PII than a narrower one.
     */
    expect(redact('pracsoft3-db4-2026-09-1')).toBe('pracsoft3-db4-2026-09-1');
    expect(redact('2026-09-16T22-33-15-595Z-a0e640ec3b7f.pdf')).toBe('2026-09-16T22-33-15-595Z-a0e640ec3b7f.pdf');
    expect(redact('2026-09-12')).toBe('2026-09-12');
  });
});

function template() {
  return templateFor(DEFAULT_TEMPLATE_VERSION)!;
}

/** Every path under a directory, files and folders alike. */
function walk(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    out.push(path);
    if (entry.isDirectory()) out.push(...walk(path));
  }
  return out;
}

describe('the log carries no page text by construction', () => {
  it('has no path that accepts a record or a line of the page', () => {
    // A structural check rather than a behavioural one: `logger.info` takes
    // scalars, so there is no call that could pass a record in. Reading the
    // source is the only way to assert "there is no such call"; this asserts
    // the next best thing — that nothing in the program logs the text layer.
    const source = readFileSync(join(__dirname, 'watcher.ts'), 'utf8');
    expect(source).not.toMatch(/logger\.(info|warn|error)\([^)]*\btext\b/);
    expect(source).not.toMatch(/logger\.(info|warn|error)\([^)]*\brecord\b(?!\.)/);
  });
});

describe('a_digits_only_string_is_never_mistaken_for_a_hash', () => {
  /*
   * Regression, 17 September 2026. `HASH` was `^[0-9a-f]{8,64}$`, and digits
   * are hex characters — so every purely numeric string of eight to sixty-four
   * digits was exempted from the identifier check. A mobile number, a Medicare
   * number typed without spaces and a record number were all waved through by
   * the guard that exists to catch them, and a queue label carrying one would
   * have reached logs and receipts (hard rule 9).
   */
  it('treats numeric strings as identifiers and real hashes as hashes', () => {
    expect(looksLikeAnIdentifier('0413284418')).toBe(true);
    expect(looksLikeAnIdentifier('2454232371')).toBe(true);
    expect(looksLikeAnIdentifier('09911001')).toBe(true);

    // Our own identifiers still pass through unrefused.
    expect(looksLikeAnIdentifier('a'.repeat(64))).toBe(false);
    expect(looksLikeAnIdentifier('3f9a1b2c')).toBe(false);
    expect(looksLikeAnIdentifier('Room 3')).toBe(false);
  });
});
