/**
 * Local retention: the three tiers, receipts instead of records, and the
 * encryption that makes deletion safe (TODO.md, "AOBPRINTER landed", item 3).
 *
 * `outbox.test.ts` covers the outbox's original promise — never lose a form,
 * never post it twice — and every one of those tests still passes unchanged,
 * because retention defaults to OFF and, off, this file changes nothing about
 * how a job is stored (see `outbox.ts`'s constructor default). This file
 * covers what changes once `retention.enabled` is true.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RetentionConfig } from './config';
import { DEFAULT_RETENTION_CONFIG } from './config';
import type { Db4PrintRecord } from './db4-record';
import { decryptPayload, encryptPayload } from './keystore';
import { makeLogger } from './log';
import { Outbox, outboxPaths, type PostResult } from './outbox';
import { makeFileReceiptsWriter, receiptsPath } from './receipts';
import type { RetentionDeps } from './retention';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'aobprinter-retention-outbox-'));
}

function aRecord(sha = 'c'.repeat(64)): Db4PrintRecord {
  return {
    documentType: 'db4_assignment',
    sourceSha256: sha,
    parserTemplateVersion: 'pracsoft3-db4-2026-09-1',
    pms: 'pracsoft3',
    capturedAt: '2026-09-17T00:00:00.000Z',
    form: { formCode: 'DB4', formReference: 'HSS0610012092026120300' },
    patient: {
      pmsLinkageKey: 'chart:09911',
      patientRecordNumber: '09911',
      givenNames: 'Fakegivenname',
      familyName: 'Fakesurname',
      dateOfBirth: '1980-06-15',
      address: '1 Imaginary Ave, Nowhereville',
      mobile: '0400 000 001',
      // Invalid checksum, obviously fake (CLAUDE.md §7). Bracket access, not a
      // dotted identifier — see `eslint.config.mjs`'s restriction on this name.
      ['medicareCardNumber']: '2999 88887 1',
    },
  };
}

const RECORD_PII = ['Fakegivenname', 'Fakesurname', '1980-06-15', 'Imaginary Ave', '0400 000 001', '2999 88887 1', '2999888871'];

const ACCEPTED: PostResult = { ok: true, status: 202 };
const UNREACHABLE: PostResult = { ok: false, status: 0, error: 'fetch failed', retryable: true };
const REJECTED: PostResult = { ok: false, status: 422, error: 'HTTP 422', retryable: false };

function pendingFile(dir: string, sha: string): string {
  return join(outboxPaths(dir).pending, `${sha}.json`);
}

function poisonFile(dir: string, sha: string): string {
  return join(outboxPaths(dir).poison, `${sha}.json`);
}

/** A retention config wired to a real (non-DPAPI) AES-256-GCM cipher, for tests that need actual encryption. */
function enabledRetention(dir: string, overrides: Partial<RetentionConfig> = {}): RetentionDeps {
  const key = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').subarray(0, 32);
  return {
    config: { ...DEFAULT_RETENTION_CONFIG, enabled: true, ...overrides },
    receipts: makeFileReceiptsWriter(dir),
    cipher: {
      encrypt: (plaintext) => encryptPayload(key, plaintext),
      decrypt: (payload) => decryptPayload(key, payload),
    },
  };
}

describe('retention_is_off_by_default (outbox behaviour)', () => {
  it('an Outbox built without retention deps behaves exactly as before this feature', async () => {
    const dir = tempDir();
    try {
      const outbox = new Outbox(dir, async () => ACCEPTED, makeLogger(() => undefined));
      const record = aRecord();
      outbox.enqueue(record);
      await outbox.flush();
      // Legacy behaviour, unchanged: a full sent/ marker, not a deletion.
      expect(existsSync(join(outboxPaths(dir).sent, `${record.sourceSha256}.json`))).toBe(true);
      expect(existsSync(pendingFile(dir, record.sourceSha256))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('an_unacknowledged_job_is_never_deleted', () => {
  it('survives flushing, sweeping, and a clock moved a week into the future', async () => {
    const dir = tempDir();
    try {
      let clock = new Date('2026-09-17T00:00:00.000Z');
      const outbox = new Outbox(dir, async () => UNREACHABLE, makeLogger(() => undefined), () => clock, enabledRetention(dir));
      const record = aRecord();
      outbox.enqueue(record);
      await outbox.flush();
      expect(existsSync(pendingFile(dir, record.sourceSha256))).toBe(true);

      // A machine off for a week: past the alarm threshold, the poison TTL,
      // and the 24-hour hard cap, all at once. None of that is a TTL for
      // `pending/` — there is no age at which this tier deletes.
      clock = new Date(clock.getTime() + 7 * 24 * 60 * 60 * 1000);
      const swept = outbox.sweep();
      expect(swept.alarmed).toBe(1);
      expect(existsSync(pendingFile(dir, record.sourceSha256))).toBe(true);

      await outbox.flush();
      expect(existsSync(pendingFile(dir, record.sourceSha256))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('an_acknowledged_job_is_deleted_on_ack', () => {
  it('removes the pending job immediately, not after any wait, and never writes a sent/ marker', async () => {
    const dir = tempDir();
    try {
      const outbox = new Outbox(dir, async () => ACCEPTED, makeLogger(() => undefined), () => new Date(), enabledRetention(dir));
      const record = aRecord();
      outbox.enqueue(record);
      expect(existsSync(pendingFile(dir, record.sourceSha256))).toBe(true);

      await outbox.flush();

      expect(existsSync(pendingFile(dir, record.sourceSha256))).toBe(false);
      expect(existsSync(join(outboxPaths(dir).sent, `${record.sourceSha256}.json`))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a_stale_pending_job_alarms_instead_of_expiring', () => {
  it('logs at error level once past the threshold, on every sweep, and never deletes', () => {
    const dir = tempDir();
    try {
      let clock = new Date('2026-09-17T00:00:00.000Z');
      const lines: string[] = [];
      const logger = makeLogger((line) => lines.push(line));
      const outbox = new Outbox(
        dir,
        async () => UNREACHABLE,
        logger,
        () => clock,
        enabledRetention(dir, { pendingAlarmMs: 60 * 60 * 1000 }),
      );
      const record = aRecord();
      outbox.enqueue(record);

      // Under the threshold: quiet.
      clock = new Date(clock.getTime() + 30 * 60 * 1000);
      expect(outbox.sweep()).toEqual({ alarmed: 0, expired: 0 });
      expect(lines.join('\n')).not.toContain('outbox.pending_stale');

      // Past it: alarms, and the job is untouched.
      clock = new Date(clock.getTime() + 45 * 60 * 1000);
      expect(outbox.sweep().alarmed).toBe(1);
      expect(lines.join('\n')).toContain('outbox.pending_stale');
      expect(existsSync(pendingFile(dir, record.sourceSha256))).toBe(true);

      // Much later still: alarms EVERY sweep, and still never deletes.
      lines.length = 0;
      clock = new Date(clock.getTime() + 30 * 24 * 60 * 60 * 1000);
      expect(outbox.sweep().alarmed).toBe(1);
      expect(lines.join('\n')).toContain('outbox.pending_stale');
      expect(existsSync(pendingFile(dir, record.sourceSha256))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a_poisoned_job_expires_and_says_so', () => {
  it('moves out of pending/ on rejection, survives under the TTL, then is destroyed with a loud log line', async () => {
    const dir = tempDir();
    try {
      let clock = new Date('2026-09-17T00:00:00.000Z');
      const lines: string[] = [];
      const logger = makeLogger((line) => lines.push(line));
      const record = aRecord();
      const outbox = new Outbox(
        dir,
        async () => REJECTED,
        logger,
        () => clock,
        enabledRetention(dir, { poisonTtlMs: 60 * 60 * 1000 }),
      );
      outbox.enqueue(record);
      await outbox.flush();

      // Out of pending/ immediately — not waiting for the TTL to leave that tier.
      expect(existsSync(pendingFile(dir, record.sourceSha256))).toBe(false);
      expect(existsSync(poisonFile(dir, record.sourceSha256))).toBe(true);
      expect(lines.join('\n')).toContain('outbox.poisoned');

      // Under the TTL: still there.
      clock = new Date(clock.getTime() + 30 * 60 * 1000);
      expect(outbox.sweep().expired).toBe(0);
      expect(existsSync(poisonFile(dir, record.sourceSha256))).toBe(true);

      // Past the TTL: destroyed, and the log says a form was destroyed
      // unposted, names its formReference, and says why.
      clock = new Date(clock.getTime() + 45 * 60 * 1000);
      const swept = outbox.sweep();
      expect(swept.expired).toBe(1);
      expect(existsSync(poisonFile(dir, record.sourceSha256))).toBe(false);

      const log = lines.join('\n');
      expect(log).toContain('outbox.poison_expired');
      expect(log).toContain('HSS0610012092026120300');
      expect(log).toContain('destroyed unposted');
      // And none of the record's PII made it into the log at any point.
      for (const forbidden of RECORD_PII) expect(log).not.toContain(forbidden);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a_payload_at_rest_is_encrypted', () => {
  it('writes pending/ as ciphertext, with none of the record’s PII readable on disk, and still round-trips', async () => {
    const dir = tempDir();
    try {
      const retention = enabledRetention(dir);
      const record = aRecord();
      const outbox = new Outbox(dir, async () => ACCEPTED, makeLogger(() => undefined), () => new Date(), retention);
      outbox.enqueue(record);

      const raw = readFileSync(pendingFile(dir, record.sourceSha256), 'utf8');
      const stored = JSON.parse(raw);
      expect(stored.record).toBeUndefined();
      expect(stored.encrypted).toBeDefined();
      expect(stored.encrypted.alg).toBe('aes-256-gcm');
      for (const forbidden of RECORD_PII) expect(raw).not.toContain(forbidden);

      // Decrypting with the wrong key fails — it is not just base64 or obscured text.
      const wrongKey = Buffer.from('x'.repeat(32));
      expect(() => decryptPayload(wrongKey, stored.encrypted)).toThrow();

      // And with the right key (a second Outbox over the same folder and
      // cipher, as a restart would be), it delivers the identical record.
      let posted: Db4PrintRecord | undefined;
      const restarted = new Outbox(
        dir,
        async (r) => {
          posted = r;
          return ACCEPTED;
        },
        makeLogger(() => undefined),
        () => new Date(),
        retention,
      );
      await restarted.flush();
      expect(posted?.form?.formReference).toBe('HSS0610012092026120300');
      expect(posted?.patient?.['medicareCardNumber']).toBe('2999 88887 1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to write a job to disk unencrypted if enabled but no cipher is wired up', () => {
    // Should not happen through `retention.ts` (disabled skips the cipher
    // entirely, enabled always builds one) — but the guard exists precisely
    // for the case a caller wires the two up wrong, and rule 3 of this
    // feature is "never falls back to plaintext", not "usually doesn't".
    const dir = tempDir();
    try {
      const misconfigured: RetentionDeps = {
        config: { ...DEFAULT_RETENTION_CONFIG, enabled: true },
        receipts: makeFileReceiptsWriter(dir),
        // cipher deliberately omitted.
      };
      const outbox = new Outbox(dir, async () => ACCEPTED, makeLogger(() => undefined), () => new Date(), misconfigured);
      expect(() => outbox.enqueue(aRecord())).toThrow(/unencrypted/);
      // And nothing was written for it to leak from.
      expect(existsSync(pendingFile(dir, aRecord().sourceSha256))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('enqueue also dedups against poison/', () => {
  it('does not re-queue, and does not reset the poison TTL of, a form already classified unrecoverable', async () => {
    const dir = tempDir();
    try {
      let clock = new Date('2026-09-17T00:00:00.000Z');
      const record = aRecord();
      const outbox = new Outbox(dir, async () => REJECTED, makeLogger(() => undefined), () => clock, enabledRetention(dir));
      outbox.enqueue(record);
      await outbox.flush();
      expect(existsSync(poisonFile(dir, record.sourceSha256))).toBe(true);
      const poisonedAtFirst = JSON.parse(readFileSync(poisonFile(dir, record.sourceSha256), 'utf8')).poisonedAt;

      // Time passes, then the same bytes are "reprinted" (same sha).
      clock = new Date(clock.getTime() + 30 * 60 * 1000);
      expect(outbox.enqueue(record)).toBe('already_poisoned');

      // Not re-queued into pending/, and the poison file — including its
      // TTL clock — is untouched by the reprint.
      expect(existsSync(pendingFile(dir, record.sourceSha256))).toBe(false);
      const poisonedAtAfter = JSON.parse(readFileSync(poisonFile(dir, record.sourceSha256), 'utf8')).poisonedAt;
      expect(poisonedAtAfter).toBe(poisonedAtFirst);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('migration on first run with retention turned on', () => {
  it('encrypts a legacy plaintext pending job in place, and turns a legacy sent/ record into a receipt', async () => {
    const dir = tempDir();
    try {
      const pendingRecord = aRecord('1'.repeat(64));
      const sentRecord = aRecord('2'.repeat(64));

      // Before retention existed: one job stuck retrying, one already delivered.
      const legacyPending = new Outbox(dir, async () => UNREACHABLE, makeLogger(() => undefined));
      legacyPending.enqueue(pendingRecord);
      await legacyPending.flush();

      const legacySent = new Outbox(dir, async () => ACCEPTED, makeLogger(() => undefined));
      legacySent.enqueue(sentRecord);
      await legacySent.flush();
      expect(existsSync(join(outboxPaths(dir).sent, `${sentRecord.sourceSha256}.json`))).toBe(true);

      // Retention turns on. Constructing the next Outbox over the same folder
      // migrates both, before anything else touches them.
      new Outbox(dir, async () => ACCEPTED, makeLogger(() => undefined), () => new Date(), enabledRetention(dir));

      const rawPending = JSON.parse(readFileSync(pendingFile(dir, pendingRecord.sourceSha256), 'utf8'));
      expect(rawPending.record).toBeUndefined();
      expect(rawPending.encrypted).toBeDefined();

      expect(existsSync(join(outboxPaths(dir).sent, `${sentRecord.sourceSha256}.json`))).toBe(false);
      const receipts = readFileSync(receiptsPath(dir), 'utf8');
      expect(receipts).toContain(sentRecord.sourceSha256);
      for (const forbidden of RECORD_PII) expect(receipts).not.toContain(forbidden);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
