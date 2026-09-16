/**
 * `buildRetentionDeps`: the one place that decides whether the real DPAPI
 * wrapper is ever touched.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_RETENTION_CONFIG } from './config';
import type { KeyWrapper } from './keystore';
import { makeLogger } from './log';
import { buildRetentionDeps } from './retention';

describe('buildRetentionDeps', () => {
  let dir: string;
  const logger = makeLogger(() => undefined);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aobprinter-retention-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('never calls the wrapper when retention is disabled, and has no cipher', () => {
    let called = false;
    const wrapper: KeyWrapper = {
      wrap: () => {
        called = true;
        return Buffer.alloc(32);
      },
      unwrap: () => {
        called = true;
        return Buffer.alloc(32);
      },
    };

    const deps = buildRetentionDeps(dir, DEFAULT_RETENTION_CONFIG, logger, wrapper);
    expect(deps.cipher).toBeUndefined();
    expect(called).toBe(false);
    // Receipts are still available — rule 5 of this feature.
    expect(deps.receipts).toBeDefined();
  });

  it('builds a working cipher when retention is enabled and the wrapper works', () => {
    const flip = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0xff));
    const wrapper: KeyWrapper = { wrap: flip, unwrap: flip };

    const deps = buildRetentionDeps(dir, { ...DEFAULT_RETENTION_CONFIG, enabled: true }, logger, wrapper);
    expect(deps.cipher).toBeDefined();
    const plaintext = Buffer.from('a payload that must round-trip', 'utf8');
    const encrypted = deps.cipher!.encrypt(plaintext);
    expect(deps.cipher!.decrypt(encrypted)).toEqual(plaintext);
  });

  it('throws, refusing to build, when retention is enabled and the wrapper fails', () => {
    const wrapper: KeyWrapper = {
      wrap: () => Buffer.alloc(32),
      unwrap: () => {
        throw new Error('simulated unwrap failure');
      },
    };
    // Seed a wrapped key file so the unwrap path (not the create path) runs.
    buildRetentionDeps(dir, { ...DEFAULT_RETENTION_CONFIG, enabled: true }, logger, { wrap: (k) => k, unwrap: (k) => k });

    expect(() => buildRetentionDeps(dir, { ...DEFAULT_RETENTION_CONFIG, enabled: true }, logger, wrapper)).toThrow(
      /unwrap/i,
    );
  });
});
