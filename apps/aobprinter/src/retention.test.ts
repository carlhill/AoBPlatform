/**
 * `loadCipher` and `buildRetentionDeps`: where the key is loaded.
 *
 * THE FIRST TEST HERE USED TO PROVE THE OPPOSITE. Until 29 September 2026 it
 * was `never calls the wrapper when retention is disabled, and has no
 * cipher`. D-2026-09-29-02 reversed that guarantee on Carl's say-so — the key
 * always exists, because audit locations and archived PDFs are encrypted from
 * day one — so the test now pins the new rule rather than being deleted.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_RETENTION_CONFIG } from './config';
import type { KeyWrapper } from './keystore';
import { makeLogger } from './log';
import type { ReceiptsWriter } from './receipts';
import { buildRetentionDeps, loadCipher } from './retention';

/** Where receipts go is `store.ts`'s business; this suite is about the key. */
const NO_RECEIPTS: ReceiptsWriter = { record: () => undefined };

describe('loadCipher', () => {
  let dir: string;
  const logger = makeLogger(() => undefined);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aobprinter-retention-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('the_key_is_loaded_whatever_retention_says', () => {
    let called = false;
    const flip = (b: Buffer) => {
      called = true;
      return Buffer.from(b.map((x) => x ^ 0xff));
    };

    const cipher = loadCipher(dir, logger, { wrap: flip, unwrap: flip });
    expect(called).toBe(true);

    // And it is carried into the outbox's deps with retention OFF, the shipped default.
    const deps = buildRetentionDeps(DEFAULT_RETENTION_CONFIG, NO_RECEIPTS, cipher);
    expect(deps.config.enabled).toBe(false);
    expect(deps.cipher).toBe(cipher);
    expect(deps.receipts).toBe(NO_RECEIPTS);
  });

  it('builds a working cipher when the wrapper works, and reads the same key back on a second start', () => {
    const flip = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0xff));
    const wrapper: KeyWrapper = { wrap: flip, unwrap: flip };

    const first = loadCipher(dir, logger, wrapper);
    const plaintext = Buffer.from('a payload that must round-trip', 'utf8');
    const encrypted = first.encrypt(plaintext);
    expect(first.decrypt(encrypted)).toEqual(plaintext);

    // A restart unwraps the key already on disk rather than making a new one.
    expect(loadCipher(dir, logger, wrapper).decrypt(encrypted)).toEqual(plaintext);
  });

  it('throws, refusing to start, when a key on disk cannot be unwrapped', () => {
    const wrapper: KeyWrapper = {
      wrap: () => Buffer.alloc(32),
      unwrap: () => {
        throw new Error('simulated unwrap failure');
      },
    };
    // Seed a wrapped key file so the unwrap path (not the create path) runs.
    loadCipher(dir, logger, { wrap: (k) => k, unwrap: (k) => k });

    expect(() => loadCipher(dir, logger, wrapper)).toThrow(/unwrap/i);
  });
});
