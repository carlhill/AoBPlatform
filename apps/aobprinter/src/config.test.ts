/**
 * `retention`'s defaults and its one hard cap.
 *
 * Everything else in `AobPrinterConfig` already had no test of its own before
 * this feature (`parseConfig` was exercised only indirectly, through fixtures
 * built by hand elsewhere) — this file is scoped to what the retention
 * feature adds, not a retrofit of coverage for the rest of the file.
 */
import assert from 'node:assert/strict';
import { AOBPRINTER_HEARTBEAT_INTERVAL } from '@aobplatform/contracts';
import { DEFAULT_RETENTION_CONFIG, RETENTION_HARD_CAP_MS, parseConfig } from './config';

const PATH = 'aobprinter.config.json';

function minimalDoc(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    practiceId: 'a2629964-c984-4a07-8db6-c42f40243654',
    endpoint: 'https://api.example.test/inbound/print-jobs',
    ...extra,
  };
}

describe('collection_is_off_until_somebody_says_where', () => {
  /*
   * THE REASON IT IS OFF BY DEFAULT IS NOT TIDINESS. This half writes into a
   * folder a PMS is WATCHING -- whatever lands there is filed into a
   * patient's record by the practice's own software -- so an install pointed
   * at the wrong folder does not fail, it files. An existing install
   * upgrading to this build must do nothing new until somebody has said
   * where (GA-PLAN B13; DB4-AND-AOBL.md 6a).
   */
  it('is disabled when the config file says nothing about it at all', () => {
    const config = parseConfig(minimalDoc(), PATH);
    expect(config.collection.enabled).toBe(false);
    expect(config.collection.importFolder).toBe('');
  });

  it('refuses to start when it is switched on with nowhere to file', () => {
    /*
     * NOT A QUIET NO-OP. An administrator who switched this on and left the
     * path blank believes signed forms are being filed; a program that
     * agreed by doing nothing would let them believe it for months.
     */
    expect(() => parseConfig(minimalDoc({ collection: { enabled: true } }), PATH)).toThrow(
      /importFolder/,
    );
  });

  it('takes a folder and a pace when it is switched on properly', () => {
    const config = parseConfig(
      minimalDoc({ collection: { enabled: true, importFolder: 'D:\\PMS\\Incoming', pollMs: 60_000 } }),
      PATH,
    );
    expect(config.collection).toEqual({
      enabled: true,
      importFolder: 'D:\\PMS\\Incoming',
      pollMs: 60_000,
    });
  });
});

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

describe('the_pdf_archive_keeps_seven_days_by_default_and_never_more_than_thirty', () => {
  // D-2026-09-29-03: seven is Carl's number; thirty is the ceiling so a typo cannot keep patient PDFs for years.
  it('keeps seven days when the config says nothing, with retention off', () => {
    expect(parseConfig(minimalDoc(), PATH).retention.archiveDays).toBe(7);
  });

  it('takes a number of days in range', () => {
    expect(parseConfig(minimalDoc({ retention: { archiveDays: 14 } }), PATH).retention.archiveDays).toBe(14);
  });

  it.each([0, 31, 1.5, '7'])('refuses %p, and says it wanted days', (archiveDays) => {
    expect(() => parseConfig(minimalDoc({ retention: { archiveDays } }), PATH)).toThrow(/archiveDays.*days from 1 to 30/);
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

describe('the heartbeat (D-2026-10-10-02, decisions 1 and 11)', () => {
  it('heartbeat_is_on_by_default_every_minute', () => {
    /*
     * ON FOR AN UPGRADE TOO. Unlike collection it writes nothing into a PMS
     * folder, so an existing install that says nothing about it beats.
     */
    const config = parseConfig(minimalDoc(), PATH);
    expect(config.heartbeat).toEqual({
      enabled: true,
      intervalMs: AOBPRINTER_HEARTBEAT_INTERVAL.defaultMs,
      firstDelayMs: AOBPRINTER_HEARTBEAT_INTERVAL.firstDelayMs,
    });
    expect(config.heartbeat.intervalMs).toBe(60_000);
    expect(config.heartbeat.firstDelayMs).toBe(5_000);
    // Switched off only by saying so.
    expect(parseConfig(minimalDoc({ heartbeat: { enabled: false } }), PATH).heartbeat.enabled).toBe(false);
  });

  it('a_heartbeat_interval_outside_15s_to_10min_refuses_to_start', () => {
    for (const intervalMs of [14_999, 600_001, 1_000, 3_600_000]) {
      expect(() => parseConfig(minimalDoc({ heartbeat: { intervalMs } }), PATH)).toThrow(/heartbeat\.intervalMs/);
    }
    // The bounds themselves are allowed.
    expect(parseConfig(minimalDoc({ heartbeat: { intervalMs: 15_000 } }), PATH).heartbeat.intervalMs).toBe(15_000);
    expect(parseConfig(minimalDoc({ heartbeat: { intervalMs: 600_000 } }), PATH).heartbeat.intervalMs).toBe(600_000);
    // And a half-shaped section is refused like every other one.
    expect(() => parseConfig(minimalDoc({ heartbeat: 'on' }), PATH)).toThrow(/"heartbeat" must be a JSON object/);
    expect(() => parseConfig(minimalDoc({ heartbeat: { enabled: 'yes' } }), PATH)).toThrow(/heartbeat\.enabled/);
  });
});
