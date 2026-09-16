/**
 * The key primitives, tested against a FAKE wrapper throughout.
 *
 * The real `dpapiKeyWrapper()` shells to PowerShell and calls a Windows-only
 * API; this suite runs on Linux CI as well as on a dev machine, so every test
 * here injects a fake `KeyWrapper` (a round-trip identity, or one that fails
 * on cue) rather than exercising DPAPI. `retention.ts`'s tests cover the
 * wiring that decides WHEN the real one is used; this file covers what
 * happens once a key is in hand.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decryptPayload, encryptPayload, keystorePaths, loadOrCreateKey, type KeyWrapper } from './keystore';
import { makeLogger } from './log';

function identityWrapper(): KeyWrapper {
  // A fake that stands in for DPAPI: bitwise-complementing every byte is
  // reversible (its own inverse) and, unlike a plain marker prefix, actually
  // ensures the "wrapped" bytes never contain the raw key as a subsequence —
  // enough to test `loadOrCreateKey`'s wiring without touching real DPAPI.
  const flip = (buf: Buffer) => Buffer.from(buf.map((b) => b ^ 0xff));
  return { wrap: flip, unwrap: flip };
}

describe('the AES-256-GCM primitives', () => {
  it('round-trips a payload under a random key', () => {
    const key = Buffer.from('k'.repeat(32));
    const plaintext = Buffer.from(JSON.stringify({ hello: 'world', n: 42 }), 'utf8');

    const encrypted = encryptPayload(key, plaintext);
    expect(encrypted.alg).toBe('aes-256-gcm');
    expect(decryptPayload(key, encrypted)).toEqual(plaintext);
  });

  it('produces ciphertext that does not contain the plaintext', () => {
    const key = Buffer.from('k'.repeat(32));
    const plaintext = Buffer.from('a secret nobody should see in the ciphertext blob', 'utf8');
    const encrypted = encryptPayload(key, plaintext);
    expect(Buffer.from(encrypted.ciphertext, 'base64').includes(plaintext)).toBe(false);
    expect(JSON.stringify(encrypted)).not.toContain('a secret nobody should see');
  });

  it('refuses to decrypt under the wrong key', () => {
    const key = Buffer.from('k'.repeat(32));
    const wrongKey = Buffer.from('x'.repeat(32));
    const encrypted = encryptPayload(key, Buffer.from('hello', 'utf8'));
    expect(() => decryptPayload(wrongKey, encrypted)).toThrow();
  });

  it('refuses to decrypt a tampered ciphertext (the GCM tag catches it)', () => {
    const key = Buffer.from('k'.repeat(32));
    const encrypted = encryptPayload(key, Buffer.from('hello', 'utf8'));
    const tampered = { ...encrypted, ciphertext: Buffer.from('tampered!!!!').toString('base64') };
    expect(() => decryptPayload(key, tampered)).toThrow();
  });
});

describe('loadOrCreateKey', () => {
  let dir: string;
  const logger = makeLogger(() => undefined);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aobprinter-keystore-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates and wraps a fresh key when none exists on disk', () => {
    const wrapper = identityWrapper();
    const key = loadOrCreateKey(dir, wrapper, logger);
    expect(key).toHaveLength(32);
    expect(existsSync(keystorePaths(dir).wrappedKeyFile)).toBe(true);
    // What is on disk is WRAPPED, not the raw key.
    const onDisk = readFileSync(keystorePaths(dir).wrappedKeyFile);
    expect(onDisk.includes(key)).toBe(false);
  });

  it('reuses the same key across a restart rather than generating a new one', () => {
    const wrapper = identityWrapper();
    const first = loadOrCreateKey(dir, wrapper, logger);
    const second = loadOrCreateKey(dir, wrapper, logger);
    expect(second).toEqual(first);
  });

  it('refuses rather than silently generate a new key when the wrapped one cannot be unwrapped (the unit-level half of the_program_refuses_to_start_if_the_key_cannot_be_unwrapped, integration-tested in poster.test.ts)', () => {
    writeFileSync(keystorePaths(dir).wrappedKeyFile, Buffer.from('whatever was on disk'));
    const brokenWrapper: KeyWrapper = {
      wrap: () => Buffer.from('irrelevant'),
      unwrap: () => {
        throw new Error('DPAPI refused: simulated for the test');
      },
    };
    expect(() => loadOrCreateKey(dir, brokenWrapper, logger)).toThrow(/cannot unwrap/i);
  });

  it('refuses rather than accept a key of the wrong length', () => {
    const shortWrapper: KeyWrapper = { wrap: (k) => k, unwrap: () => Buffer.from('too-short') };
    writeFileSync(keystorePaths(dir).wrappedKeyFile, Buffer.from('anything'));
    expect(() => loadOrCreateKey(dir, shortWrapper, logger)).toThrow(/32/);
  });
});
