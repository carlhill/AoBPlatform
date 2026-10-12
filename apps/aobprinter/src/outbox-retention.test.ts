/**
 * Local retention: the three tiers, receipts instead of records, and the
 * encryption that makes deletion safe (TODO.md, "AOBPRINTER landed", item 3).
 *
 * `outbox.test.ts` covers the outbox's original promise — never lose a form,
 * never post it twice — and every one of those tests passes with retention
 * OFF, because off, this file changes nothing about how a job is stored (see
 * `outbox.ts`'s constructor default). This file covers what changes once
 * `retention.enabled` is true.
 *
 * SINCE 29 SEPTEMBER 2026 THE TIERS ARE STAGES OF A ROW, not folders
 * (D-2026-09-28-04): queued, sent, send_exception. Every rule below is the one
 * the folder version kept, with one change D-2026-09-29-01 made on purpose:
 * where the folder version DELETED a job, the payload is destroyed and the
 * row is kept as the audit subject. "Deleted" in a test name below means the
 * patient data, which is exactly what it always meant.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RetentionConfig } from './config';
import { DEFAULT_RETENTION_CONFIG } from './config';
import type { Db4PrintRecord } from './db4-record';
import { decryptPayload, encryptPayload } from './keystore';
import { makeLogger } from './log';
import { Outbox, type PostResult } from './outbox';
import type { RetentionDeps } from './retention';
import { openStore, type AobPrinterStore } from './store';

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

/** Every store a test opens, closed before its folder is removed — Windows will not delete an open database. */
const opened: AobPrinterStore[] = [];
function storeAt(dir: string): AobPrinterStore {
  const store = openStore(dir);
  opened.push(store);
  return store;
}
function cleanUp(dir: string): void {
  for (const store of opened.splice(0)) store.close();
  rmSync(dir, { recursive: true, force: true });
}

/** Every byte the database has put on disk, for "is this readable anywhere" checks. */
function everythingOnDisk(dir: string): string {
  return readdirSync(dir)
    .filter((name) => name.startsWith('aobprinter.db'))
    .map((name) => readFileSync(join(dir, name)).toString('latin1'))
    .join('\n');
}

/** A retention config wired to a real (non-DPAPI) AES-256-GCM cipher, for tests that need actual encryption. */
function enabledRetention(store: AobPrinterStore, overrides: Partial<RetentionConfig> = {}): RetentionDeps {
  const key = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').subarray(0, 32);
  return {
    config: { ...DEFAULT_RETENTION_CONFIG, enabled: true, ...overrides },
    receipts: store,
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
      const store = storeAt(dir);
      const outbox = new Outbox(store, async () => ACCEPTED, makeLogger(() => undefined));
      const record = aRecord();
      outbox.enqueue(record);
      await outbox.flush();
      // Legacy behaviour, unchanged: the whole record kept, marked sent — not a deletion.
      expect(store.jobState(record.sourceSha256)).toBe('sent');
      expect(store.getJob(record.sourceSha256)?.record?.form?.formReference).toBe('HSS0610012092026120300');
    } finally {
      cleanUp(dir);
    }
  });
});

describe('an_unacknowledged_job_is_never_deleted', () => {
  it('survives flushing, sweeping, and a clock moved a week into the future', async () => {
    const dir = tempDir();
    try {
      let clock = new Date('2026-09-17T00:00:00.000Z');
      const store = storeAt(dir);
      const outbox = new Outbox(store, async () => UNREACHABLE, makeLogger(() => undefined), () => clock, enabledRetention(store));
      const record = aRecord();
      outbox.enqueue(record);
      await outbox.flush();
      expect(store.jobState(record.sourceSha256)).toBe('queued');

      // A machine off for a week: past the alarm threshold, the poison TTL,
      // and the 24-hour hard cap, all at once. None of that is a TTL for a
      // pending job — there is no age at which this tier deletes.
      clock = new Date(clock.getTime() + 7 * 24 * 60 * 60 * 1000);
      const swept = outbox.sweep();
      expect(swept.alarmed).toBe(1);
      expect(store.jobState(record.sourceSha256)).toBe('queued');

      await outbox.flush();
      expect(store.jobState(record.sourceSha256)).toBe('queued');
    } finally {
      cleanUp(dir);
    }
  });
});

describe('an_acknowledged_job_is_deleted_on_ack', () => {
  it('destroys the payload immediately, not after any wait, and keeps the row only as a PII-free audit subject', async () => {
    const dir = tempDir();
    try {
      const store = storeAt(dir);
      const outbox = new Outbox(store, async () => ACCEPTED, makeLogger(() => undefined), () => new Date(), enabledRetention(store));
      const record = aRecord();
      outbox.enqueue(record);
      expect(store.jobState(record.sourceSha256)).toBe('queued');

      await outbox.flush();

      const after = store.getJob(record.sourceSha256);
      expect(after?.stage).toBe('sent');
      expect(after?.record).toBeUndefined();
      expect(after?.encrypted).toBeUndefined();
      expect(after?.payloadDestroyedAt).toBeDefined();
      // And the receipt is what remains — written in the same transaction.
      expect(store.receipts().map((r) => r.sourceSha256)).toEqual([record.sourceSha256]);
      // And a reprint of the same bytes is recognised, where the folder version posted it again.
      expect(outbox.enqueue(record)).toBe('already_sent');
    } finally {
      cleanUp(dir);
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
      const store = storeAt(dir);
      const outbox = new Outbox(
        store,
        async () => UNREACHABLE,
        logger,
        () => clock,
        enabledRetention(store, { pendingAlarmMs: 60 * 60 * 1000 }),
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
      expect(store.jobState(record.sourceSha256)).toBe('queued');

      // Much later still: alarms EVERY sweep, and still never deletes.
      lines.length = 0;
      clock = new Date(clock.getTime() + 30 * 24 * 60 * 60 * 1000);
      expect(outbox.sweep().alarmed).toBe(1);
      expect(lines.join('\n')).toContain('outbox.pending_stale');
      expect(store.jobState(record.sourceSha256)).toBe('queued');
    } finally {
      cleanUp(dir);
    }
  });
});

describe('a_poisoned_job_expires_and_says_so', () => {
  it('leaves pending on rejection, survives under the TTL, then is destroyed with a loud log line', async () => {
    const dir = tempDir();
    try {
      let clock = new Date('2026-09-17T00:00:00.000Z');
      const lines: string[] = [];
      const logger = makeLogger((line) => lines.push(line));
      const record = aRecord();
      const store = storeAt(dir);
      const outbox = new Outbox(
        store,
        async () => REJECTED,
        logger,
        () => clock,
        enabledRetention(store, { poisonTtlMs: 60 * 60 * 1000 }),
      );
      outbox.enqueue(record);
      await outbox.flush();

      // Out of pending immediately — not waiting for the TTL to leave that tier.
      expect(store.jobState(record.sourceSha256)).toBe('send_exception');
      expect(lines.join('\n')).toContain('outbox.poisoned');

      // Under the TTL: still there.
      clock = new Date(clock.getTime() + 30 * 60 * 1000);
      expect(outbox.sweep().expired).toBe(0);
      expect(store.jobState(record.sourceSha256)).toBe('send_exception');

      // Past the TTL: destroyed, and the log says a form was destroyed
      // unposted, names its formReference, and says why.
      clock = new Date(clock.getTime() + 45 * 60 * 1000);
      const swept = outbox.sweep();
      expect(swept.expired).toBe(1);
      // The payload is gone; the row stays, still saying it was refused.
      expect(store.jobState(record.sourceSha256)).toBe('send_exception');
      expect(store.getJob(record.sourceSha256)?.encrypted).toBeUndefined();
      expect(store.getJob(record.sourceSha256)?.payloadDestroyedAt).toBeDefined();
      // And a later sweep does not destroy it a second time.
      expect(outbox.sweep().expired).toBe(0);

      const log = lines.join('\n');
      expect(log).toContain('outbox.poison_expired');
      expect(log).toContain('HSS0610012092026120300');
      expect(log).toContain('destroyed unposted');
      // And none of the record's PII made it into the log at any point.
      for (const forbidden of RECORD_PII) expect(log).not.toContain(forbidden);
    } finally {
      cleanUp(dir);
    }
  });
});

describe('a_payload_at_rest_is_encrypted', () => {
  it('stores the job as ciphertext, with none of the record’s PII readable on disk, and still round-trips', async () => {
    const dir = tempDir();
    try {
      const store = storeAt(dir);
      const retention = enabledRetention(store);
      const record = aRecord();
      const outbox = new Outbox(store, async () => ACCEPTED, makeLogger(() => undefined), () => new Date(), retention);
      outbox.enqueue(record);

      const stored = store.getJob(record.sourceSha256);
      expect(stored?.record).toBeUndefined();
      expect(stored?.encrypted).toBeDefined();
      expect(stored?.encrypted?.alg).toBe('aes-256-gcm');
      // STRONGER THAN THE FOLDER TEST COULD BE: every byte the database wrote,
      // log included, not just the one row.
      const raw = everythingOnDisk(dir);
      for (const forbidden of RECORD_PII) expect(raw).not.toContain(forbidden);

      // Decrypting with the wrong key fails — it is not just base64 or obscured text.
      const wrongKey = Buffer.from('x'.repeat(32));
      expect(() => decryptPayload(wrongKey, stored!.encrypted!)).toThrow();

      // And with the right key, after a restart, it delivers the identical
      // record. A RESTART AS THE PROGRAM DOES ONE: the first process's
      // connection is gone, and the new one is both the outbox's store and
      // its receipts writer — one connection, so one transaction covers both.
      store.close();
      const reopened = storeAt(dir);
      let posted: Db4PrintRecord | undefined;
      const restarted = new Outbox(
        reopened,
        async (r) => {
          posted = r;
          return ACCEPTED;
        },
        makeLogger(() => undefined),
        () => new Date(),
        enabledRetention(reopened),
      );
      await restarted.flush();
      expect(posted?.form?.formReference).toBe('HSS0610012092026120300');
      expect(posted?.patient?.['medicareCardNumber']).toBe('2999 88887 1');
    } finally {
      cleanUp(dir);
    }
  });

  it('refuses to write a job to disk unencrypted if enabled but no cipher is wired up', () => {
    // Should not happen through `retention.ts` (disabled skips the cipher
    // entirely, enabled always builds one) — but the guard exists precisely
    // for the case a caller wires the two up wrong, and rule 3 of this
    // feature is "never falls back to plaintext", not "usually doesn't".
    const dir = tempDir();
    try {
      const store = storeAt(dir);
      const misconfigured: RetentionDeps = {
        config: { ...DEFAULT_RETENTION_CONFIG, enabled: true },
        receipts: store,
        // cipher deliberately omitted.
      };
      const outbox = new Outbox(store, async () => ACCEPTED, makeLogger(() => undefined), () => new Date(), misconfigured);
      expect(() => outbox.enqueue(aRecord())).toThrow(/unencrypted/);
      // And nothing was written for it to leak from.
      expect(store.jobState(aRecord().sourceSha256)).toBeUndefined();
      for (const forbidden of RECORD_PII) expect(everythingOnDisk(dir)).not.toContain(forbidden);
    } finally {
      cleanUp(dir);
    }
  });
});

describe('enqueue also dedups against poisoned jobs', () => {
  it('does not re-queue, and does not reset the poison TTL of, a form already classified unrecoverable', async () => {
    const dir = tempDir();
    try {
      let clock = new Date('2026-09-17T00:00:00.000Z');
      const record = aRecord();
      const store = storeAt(dir);
      const outbox = new Outbox(store, async () => REJECTED, makeLogger(() => undefined), () => clock, enabledRetention(store));
      outbox.enqueue(record);
      await outbox.flush();
      expect(store.jobState(record.sourceSha256)).toBe('send_exception');
      const poisonedAtFirst = store.getJob(record.sourceSha256)?.poisonedAt;

      // Time passes, then the same bytes are "reprinted" (same sha).
      clock = new Date(clock.getTime() + 30 * 60 * 1000);
      expect(outbox.enqueue(record)).toBe('already_poisoned');

      // Not re-queued, and the refused row — including its TTL clock — is
      // untouched by the reprint.
      expect(store.jobState(record.sourceSha256)).toBe('send_exception');
      expect(store.getJob(record.sourceSha256)?.poisonedAt).toBe(poisonedAtFirst);
    } finally {
      cleanUp(dir);
    }
  });
});

describe('migration on first run with retention turned on', () => {
  it('encrypts a legacy plaintext pending job in place, and turns a legacy sent record into a receipt', async () => {
    const dir = tempDir();
    try {
      const pendingRecord = aRecord('1'.repeat(64));
      const sentRecord = aRecord('2'.repeat(64));
      const store = storeAt(dir);

      // Before retention existed: one job stuck retrying, one already delivered.
      const legacyPending = new Outbox(store, async () => UNREACHABLE, makeLogger(() => undefined));
      legacyPending.enqueue(pendingRecord);
      await legacyPending.flush();

      const legacySent = new Outbox(store, async () => ACCEPTED, makeLogger(() => undefined));
      legacySent.enqueue(sentRecord);
      await legacySent.flush();
      expect(store.jobState(sentRecord.sourceSha256)).toBe('sent');

      // Retention turns on. Constructing the next Outbox over the same
      // database migrates both, before anything else touches them.
      new Outbox(store, async () => ACCEPTED, makeLogger(() => undefined), () => new Date(), enabledRetention(store));

      const migratedPending = store.getJob(pendingRecord.sourceSha256);
      expect(migratedPending?.record).toBeUndefined();
      expect(migratedPending?.encrypted).toBeDefined();

      expect(store.getJob(sentRecord.sourceSha256)?.record).toBeUndefined();
      expect(store.getJob(sentRecord.sourceSha256)?.stage).toBe('sent');
      const receipts = JSON.stringify(store.receipts());
      expect(receipts).toContain(sentRecord.sourceSha256);
      for (const forbidden of RECORD_PII) expect(receipts).not.toContain(forbidden);

      /*
       * AND THE PLAINTEXT IS GONE FROM THE FILE, not just from the table.
       * A deleted row's bytes can linger in a free page; `secure_delete`
       * zeroes them. (It cannot reach blocks an SSD has already remapped —
       * which is why encryption, not deletion, is the real protection.)
       */
      for (const forbidden of RECORD_PII) expect(everythingOnDisk(dir)).not.toContain(forbidden);
    } finally {
      cleanUp(dir);
    }
  });
});
