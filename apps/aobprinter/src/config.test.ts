/**
 * `retention`'s defaults and its one hard cap.
 *
 * Everything else in `AobPrinterConfig` already had no test of its own before
 * this feature (`parseConfig` was exercised only indirectly, through fixtures
 * built by hand elsewhere) — this file is scoped to what the retention
 * feature adds, not a retrofit of coverage for the rest of the file.
 */
import assert from 'node:assert/strict';
import { DEFAULT_RETENTION_CONFIG, RETENTION_HARD_CAP_MS, parseConfig } from './config';

const PATH = 'aobprinter.config.json';

function minimalDoc(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    practiceId: 'a2629964-c984-4a07-8db6-c42f40243654',
    endpoint: 'https://api.example.test/inbound/print-jobs',
    ...extra,
  };
}

describe('retention_is_off_by_default', () => {
  it('is disabled when the config file says nothing about it at all', () => {
    const config = parseConfig(minimalDoc(), PATH);
    expect(config.retention).toEqual(DEFAULT_RETENTION_CONFIG);
    expect(config.retention.enabled).toBe(false);
  });

  it('is disabled when "retention" is present but does not say "enabled"', () => {
    const config = parseConfig(minimalDoc({ retention: { poisonTtlMs: 30 * 60 * 1000 } }), PATH);
    expect(config.retention.enabled).toBe(false);
    // The one value that was set is still honoured.
    expect(config.retention.poisonTtlMs).toBe(30 * 60 * 1000);
  });

  it('only turns on when a config explicitly says so', () => {
    const config = parseConfig(minimalDoc({ retention: { enabled: true } }), PATH);
    expect(config.retention.enabled).toBe(true);
  });
});

describe('the 24-hour hard cap, once retention is enabled', () => {
  it('rejects a poisonTtlMs beyond 24 hours on its own', () => {
    expect(() =>
      parseConfig(minimalDoc({ retention: { enabled: true, poisonTtlMs: RETENTION_HARD_CAP_MS + 1, sweepIntervalMs: 1 } }), PATH),
    ).toThrow(/24 hours/);
  });

  it('rejects a pendingAlarmMs beyond 24 hours', () => {
    expect(() =>
      parseConfig(minimalDoc({ retention: { enabled: true, pendingAlarmMs: RETENTION_HARD_CAP_MS + 1 } }), PATH),
    ).toThrow(/24 hours/);
  });

  it('rejects poisonTtlMs and sweepIntervalMs that are each under the cap but together exceed it', () => {
    // A poisoned job is only actually swept once per interval, so the real
    // worst case before it is destroyed is the SUM — a large sweep interval
    // must not be able to quietly stretch retention past 24 hours while
    // poisonTtlMs alone looks fine.
    expect(() =>
      parseConfig(
        minimalDoc({
          retention: {
            enabled: true,
            poisonTtlMs: RETENTION_HARD_CAP_MS - 1000,
            sweepIntervalMs: 2000,
          },
        }),
        PATH,
      ),
    ).toThrow(/together exceed/);
  });

  it('allows exactly 24 hours as the sum of poisonTtlMs and sweepIntervalMs', () => {
    const config = parseConfig(
      minimalDoc({
        retention: {
          enabled: true,
          poisonTtlMs: RETENTION_HARD_CAP_MS - 1000,
          sweepIntervalMs: 1000,
          pendingAlarmMs: RETENTION_HARD_CAP_MS,
        },
      }),
      PATH,
    );
    expect(config.retention.poisonTtlMs).toBe(RETENTION_HARD_CAP_MS - 1000);
  });

  it('does not enforce the cap while retention stays disabled', () => {
    // The same numbers are harmless when they govern nothing but a log
    // threshold and a sweep's pace.
    const config = parseConfig(
      minimalDoc({ retention: { poisonTtlMs: RETENTION_HARD_CAP_MS * 10, sweepIntervalMs: RETENTION_HARD_CAP_MS * 10 } }),
      PATH,
    );
    expect(config.retention.poisonTtlMs).toBe(RETENTION_HARD_CAP_MS * 10);
  });
});

describe('the_queue_label_is_never_a_patient_identifier', () => {
  /*
   * A queue label is attribution the practice chooses — 'Room 3', 'Front
   * desk' — and it is written into logs, receipts and every record that queue
   * produces. Somebody naming a queue after the patient in front of them
   * would put an identifier into all three (hard rule 9). Refused at load,
   * loudly, rather than redacted quietly: a redacted label is a label nobody
   * can use, and the practice would never know why.
   */
  const identifierish = [
    { label: '2454 23237 1', why: 'a Medicare card number' },
    { label: '0413284418', why: 'a mobile number' },
  ];
  /*
   * NOT covered, deliberately: a date of birth like '1965-10-10'. The shared
   * vocabulary in `log.ts` has no notion of a date, and giving it one would
   * redact every timestamp in every log line. Flagged rather than widened.
   */

  for (const { label, why } of identifierish) {
    it(`refuses a queue label that looks like ${why}`, () => {
      const doc = minimalDoc({ queues: [{ name: 'AOBPRINTER', spoolFile: 'C:/spool/out.pdf', label }] });
      assert.throws(() => parseConfig(doc, PATH), /looks like a patient identifier/);
    });
  }

  it('refuses an identifier-shaped queue NAME too, because the name travels as well', () => {
    const doc = minimalDoc({ queues: [{ name: '0413284418', spoolFile: 'C:/spool/out.pdf', label: 'Room 3' }] });
    assert.throws(() => parseConfig(doc, PATH), /looks like a patient identifier/);
  });

  it('accepts the labels a practice would actually choose', () => {
    const doc = minimalDoc({
      queues: [
        { name: 'AOBPRINTER-Room3', spoolFile: 'C:/spool/room3.pdf', label: 'Room 3' },
        { name: 'AOBPRINTER-Desk', spoolFile: 'C:/spool/desk.pdf', label: 'Front desk' },
      ],
    });
    const config = parseConfig(doc, PATH);
    assert.deepEqual(
      config.queues.map((q) => q.label),
      ['Room 3', 'Front desk'],
    );
  });
});
