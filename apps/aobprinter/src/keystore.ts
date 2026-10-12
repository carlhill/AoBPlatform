/**
 * The retention key: generated once, wrapped at rest, never on a plaintext
 * disk and never in a log.
 *
 * NOTE FOR THE HUMAN REVIEW PASS. CLAUDE.md §7 marks "anything touching key
 * management" as human-authored — assisted by Claude Code, not authored
 * wholesale by it. This file is exactly that, built to the brief's explicit
 * algorithm choices (AES-256-GCM, DPAPI at LocalMachine scope) because the
 * feature it backs (`retention.ts`, `outbox.ts`) ships with `retention.enabled
 * = false` by default and touches no live practice until Carl turns it on.
 * Treat this file as a draft for the human review the working rule calls for
 * before that flag is ever set to `true` anywhere real.
 *
 * WHY DPAPI AND NOT A PASSWORD OR AN ENV VAR. There is no human at a
 * receptionist's desktop to type a passphrase in, and an env var next to the
 * program is just the key sitting in another plaintext file. DPAPI at
 * `LocalMachine` scope ties the wrapped key to THIS Windows install — it
 * cannot be read by copying the file to another machine — without asking
 * anyone for a secret.
 *
 * WHAT THIS DOES NOT PROTECT AGAINST, SAID PLAINLY. `LocalMachine` scope with
 * no optional entropy means any process able to run code as any local user on
 * this desktop can unwrap the key — it is not scoped to this program's own
 * account, and it is not a defence against a compromised machine, only
 * against the wrapped file being copied or read off the disk by something
 * that is not running on it. That is still strictly better than the
 * plaintext-on-disk problem this feature exists to fix, but it is a
 * machine-boundary, not a process- or account-boundary — read it as that, not
 * as more. `aob-tech-stack.md`'s posture for this desktop is outbound mutual
 * TLS with a per-practice credential (not yet built, `config.ts` says so);
 * DPAPI is the interim answer to a narrower question — "how does an
 * unattended desktop app hold a symmetric key" — and is not a substitute for
 * that decision.
 *
 * WHY SHELL TO POWERSHELL RATHER THAN A NATIVE ADDON. `node:crypto` has no
 * DPAPI binding and CLAUDE.md §7 forbids adding a dependency without asking
 * first; PowerShell's `System.Security.Cryptography.ProtectedData` is
 * built into every Windows install this program targets and needs nothing
 * added to `package.json`.
 *
 * THE KEY CROSSES OVER STDIN, NEVER AS AN ARGV ELEMENT OR IN THE SCRIPT TEXT.
 * The payloads this key protects are never passed to a subprocess at all —
 * they never leave this process (see `outbox.ts`) — but the key itself has to
 * reach PowerShell somehow, and `runProtectedData`'s own comment records why
 * an argv element was tried first, measured to be actively broken, and
 * replaced with stdin.
 */
import { spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from './log';

const KEY_BYTES = 32;
const GCM_IV_BYTES = 12;

export interface EncryptedPayload {
  readonly alg: 'aes-256-gcm';
  readonly iv: string;
  readonly authTag: string;
  readonly ciphertext: string;
}

/** AES-256-GCM over a raw key already in memory. Never touches the filesystem or a wrapper. */
export function encryptPayload(key: Buffer, plaintext: Buffer): EncryptedPayload {
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptPayload(key: Buffer, payload: EncryptedPayload): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]);
}

/** Wraps and unwraps the retention key. Real implementation is DPAPI; tests inject a fake. */
export interface KeyWrapper {
  wrap(key: Buffer): Buffer;
  unwrap(blob: Buffer): Buffer;
}

/**
 * The real wrapper: Windows DPAPI at `LocalMachine` scope, via PowerShell.
 *
 * NEVER CALLED UNLESS `retention.enabled` IS TRUE (see `retention.ts`), which
 * is why a default, disabled install never shells out to PowerShell or
 * touches DPAPI at all — including in CI, which runs this suite on Linux.
 */
export function dpapiKeyWrapper(): KeyWrapper {
  return {
    wrap: (key) => runProtectedData('Protect', key),
    unwrap: (blob) => runProtectedData('Unprotect', blob),
  };
}

/**
 * THE KEY GOES IN OVER STDIN, NOT AS AN ARGV ELEMENT — a correction from the
 * first version of this function, caught in review. That version passed the
 * base64 key as a trailing `spawnSync` argument on the theory that an argv
 * array has no shell to inject through, which is true and answered the wrong
 * question: `-Command '<script>' <value>` does not bind `<value>` to the
 * script's `param()` block the way a `.ps1` file's arguments would — verified
 * on this machine, 17 September 2026 — so PowerShell tries to parse the value
 * itself as a second statement and fails with a `ParserError` that QUOTES the
 * offending token. On `Protect`, that token is the retention key, in full,
 * inside the error text this function raises — which is exactly the path the
 * caller (`loadOrCreateKey`) turns into a thrown `Error` and, uncaught,
 * whatever prints an unhandled exception. Reading the value from stdin
 * instead means it is never part of the command line OR the script text
 * PowerShell parses, so neither a parser error nor process-listing tools
 * (Sysmon, WMI, Task Manager's command-line column) ever see it.
 */
function runProtectedData(operation: 'Protect' | 'Unprotect', data: Buffer): Buffer {
  // LocalMachine scope, no per-user entropy (nobody is logged in to supply
  // any) — `$null` optional entropy is deliberate for the same reason.
  const script = [
    '$B64 = [Console]::In.ReadToEnd().Trim()',
    'Add-Type -AssemblyName System.Security',
    '$bytes = [Convert]::FromBase64String($B64)',
    `$result = [System.Security.Cryptography.ProtectedData]::${operation}(` +
      '$bytes, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)',
    '[Convert]::ToBase64String($result)',
  ].join('; ');

  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    input: `${data.toString('base64')}\n`,
  });

  if (result.error) {
    throw new Error(`DPAPI ${operation.toLowerCase()} could not run PowerShell: ${result.error.message}`);
  }
  if (result.status !== 0 || !result.stdout?.trim()) {
    // `stderr` is truncated and, unlike the key itself, never contains it: the
    // key crosses over stdin, never through anything PowerShell's parser or
    // error reporting looks at.
    throw new Error(`DPAPI ${operation.toLowerCase()} failed (exit ${result.status}): ${(result.stderr ?? '').trim().slice(0, 300)}`);
  }
  return Buffer.from(result.stdout.trim(), 'base64');
}

export function keystorePaths(dataDir: string): { readonly wrappedKeyFile: string } {
  return { wrappedKeyFile: join(dataDir, 'retention.key') };
}

/**
 * Load the wrapped key from disk, or generate and wrap a fresh one.
 *
 * REFUSES, NEVER FALLS BACK. Rule 3 of this feature is not "encrypt when
 * convenient" — an unwrap failure means the key cannot be recovered on THIS
 * machine (DPAPI refusing, a restored file from another PC, a Windows
 * upgrade that changed the machine's DPAPI master key). Generating a
 * replacement key would silently make every payload already encrypted under
 * the old one unrecoverable; writing plaintext instead would defeat the
 * feature entirely. Both are worse than refusing to start, which is loud, is
 * fixable by a human, and loses nothing that unwrapping would not also have
 * been needed to read.
 */
export function loadOrCreateKey(dataDir: string, wrapper: KeyWrapper, logger: Logger): Buffer {
  const paths = keystorePaths(dataDir);
  mkdirSync(dataDir, { recursive: true });

  if (existsSync(paths.wrappedKeyFile)) {
    let key: Buffer;
    try {
      key = wrapper.unwrap(readFileSync(paths.wrappedKeyFile));
    } catch (err) {
      throw new Error(
        `Cannot unwrap the retention key at ${paths.wrappedKeyFile}: ${err instanceof Error ? err.message : String(err)}. ` +
          'Refusing to start: writing plaintext, or generating a key that cannot read what is already ' +
          'encrypted, are both worse than a support call.',
        { cause: err },
      );
    }
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `The retention key at ${paths.wrappedKeyFile} unwrapped to ${key.length} bytes, not ${KEY_BYTES}. Refusing to start.`,
      );
    }
    return key;
  }

  const key = randomBytes(KEY_BYTES);
  writeFileSync(paths.wrappedKeyFile, wrapper.wrap(key));
  logger.info('retention.key_created', { path: paths.wrappedKeyFile });
  return key;
}
