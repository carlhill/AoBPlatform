/**
 * Reconciliation: the guard rail that says a printed form never vanished
 * quietly. If the spooler completed ten jobs on a queue and we claimed nine,
 * one patient's assignment was printed and never became a record, and nobody
 * would otherwise find out.
 */
import assert from 'node:assert/strict';
import { makeLogger } from './log';
import { Reconciler } from './print-service-log';

/** Lines the reconciler emitted, so a test can assert on what a human would read. */
function capture(): { lines: string[]; logger: ReturnType<typeof makeLogger> } {
  const lines: string[] = [];
  return { lines, logger: makeLogger((line) => lines.push(line)) };
}

const HOUR = 60 * 60 * 1000;

/** The reader is asynchronous; these wrap a fixed answer in the shape it returns. */
const counts = (entries: [string, number][]) => async () => new Map(entries);
const unreadable = async () => null;

describe('a_printed_job_that_never_became_a_record_is_alarmed', () => {
  it('logs an error naming the queue and both counts when the spooler printed more than we claimed', async () => {
    const { lines, logger } = capture();
    let clock = new Date('2026-09-17T00:00:00.000Z');
    // The spooler says ten; we will claim nine.
    const reconciler = new Reconciler(counts([['AOBPRINTER-Room3', 10]]), logger, () => clock, 0);

    for (let i = 0; i < 9; i += 1) reconciler.recordClaim('AOBPRINTER-Room3');
    clock = new Date(clock.getTime() + HOUR);

    const summary = await reconciler.reconcile(['AOBPRINTER-Room3']);

    assert.equal(summary.checked, true);
    assert.equal(summary.gaps, 1);
    const alarm = lines.find((l) => l.includes('reconcile.gap'));
    assert.ok(alarm, 'a gap must be logged, and at error level');
    assert.match(alarm, /ERROR/);
    assert.match(alarm, /AOBPRINTER-Room3/);
    assert.match(alarm, /missing=1|"missing":1|missing 1/);
  });

  it('says nothing when every printed job was claimed', async () => {
    const { lines, logger } = capture();
    let clock = new Date('2026-09-17T00:00:00.000Z');
    const reconciler = new Reconciler(counts([['AOBPRINTER', 3]]), logger, () => clock, 0);

    for (let i = 0; i < 3; i += 1) reconciler.recordClaim('AOBPRINTER');
    clock = new Date(clock.getTime() + HOUR);

    assert.equal((await reconciler.reconcile(['AOBPRINTER'])).gaps, 0);
    assert.equal(lines.filter((l) => l.includes('reconcile.gap')).length, 0);
  });

  it('never counts a claim that happened after the window it is comparing', async () => {
    // A form claimed a millisecond after the window closes belongs to the next
    // window. Counting it here would hide a real gap.
    const { logger } = capture();
    let clock = new Date('2026-09-17T00:00:00.000Z');
    const reconciler = new Reconciler(counts([['AOBPRINTER', 1]]), logger, () => clock, 0);

    clock = new Date(clock.getTime() + HOUR);
    reconciler.recordClaim('AOBPRINTER'); // at the window's edge, not inside it

    assert.equal((await reconciler.reconcile(['AOBPRINTER'])).gaps, 1);
  });
});

describe('a_queue_name_that_matches_no_printer_is_never_reported_as_clean', () => {
  /*
   * Regression, 17 September 2026, found in review. The gap test was
   * `counts.get(name) ?? 0`, so a queue the spooler has never heard of scored
   * printed = 0, which can never exceed claimed — "checked, no gaps", forever.
   * Every config written before that day synthesises the queue name 'default'
   * (config.ts LEGACY_QUEUE_NAME) and no Windows printer is called that, so on
   * every already-installed desktop this guard rail was off while reporting
   * that it was on. A typo in a LAN queue name did the same.
   */
  it('alarms when forms were claimed from a queue the spooler reports nothing for', async () => {
    const { lines, logger } = capture();
    let clock = new Date('2026-09-17T00:00:00.000Z');
    // The spooler knows AOBPRINTER-Room3. It has never heard of 'default'.
    const reconciler = new Reconciler(counts([['AOBPRINTER-Room3', 2]]), logger, () => clock, 0);

    reconciler.recordClaim('default');
    reconciler.recordClaim('default');
    for (let i = 0; i < 2; i += 1) reconciler.recordClaim('AOBPRINTER-Room3');
    clock = new Date(clock.getTime() + HOUR);

    const summary = await reconciler.reconcile(['default', 'AOBPRINTER-Room3']);

    assert.equal(summary.unknownQueues, 1, 'the misconfigured queue must be reported, not scored as zero');
    assert.equal(summary.gaps, 0, 'an unknown queue is not a missing form; it is a broken check');
    const alarm = lines.find((l) => l.includes('reconcile.queue_unknown_to_spooler'));
    assert.ok(alarm, 'the operator has to be told the check cannot run for that queue');
    assert.match(alarm, /ERROR/);
    assert.match(alarm, /default/);
  });

  it('stays quiet about a queue that is simply idle', async () => {
    // No claims and no events is a quiet morning, not a misconfiguration.
    const { lines, logger } = capture();
    let clock = new Date('2026-09-17T00:00:00.000Z');
    const reconciler = new Reconciler(counts([]), logger, () => clock, 0);

    clock = new Date(clock.getTime() + HOUR);
    const summary = await reconciler.reconcile(['AOBPRINTER']);

    assert.equal(summary.unknownQueues, 0);
    assert.equal(summary.gaps, 0);
    assert.equal(lines.length, 0);
  });
});

describe('reconciliation_failure_never_blocks_printing', () => {
  it('degrades to a warning when the event log cannot be read, and never throws', async () => {
    const { lines, logger } = capture();
    let clock = new Date('2026-09-17T00:00:00.000Z');
    // null is the reader saying "could not ask", which is not the same as
    // "nothing printed" — the difference between degraded and a false alarm.
    const reconciler = new Reconciler(unreadable, logger, () => clock, 0);

    clock = new Date(clock.getTime() + HOUR);
    const summary = await reconciler.reconcile(['AOBPRINTER']);

    assert.equal(summary.checked, false);
    assert.equal(summary.gaps, 0, 'an unreadable log must never be reported as a missing form');
    assert.ok(lines.some((l) => l.includes('reconcile.unavailable') && l.includes('WARN')));
  });

  it('never throws when the reader itself rejects', async () => {
    const { lines, logger } = capture();
    let clock = new Date('2026-09-17T00:00:00.000Z');
    const reconciler = new Reconciler(
      async () => {
        throw new Error('Get-WinEvent exploded');
      },
      logger,
      () => clock,
      0,
    );

    clock = new Date(clock.getTime() + HOUR);
    // This shares a process with the loop that claims forms. A throw here
    // would stop capture for a reporting feature (hard rule 8).
    await assert.doesNotReject(() => reconciler.reconcile(['AOBPRINTER']));
    assert.ok(lines.some((l) => l.includes('reconcile.unavailable')));
  });

  it('warns once, not once per cycle, while the log stays unreadable', async () => {
    const { lines, logger } = capture();
    let clock = new Date('2026-09-17T00:00:00.000Z');
    const reconciler = new Reconciler(unreadable, logger, () => clock, 0);

    for (let i = 0; i < 4; i += 1) {
      clock = new Date(clock.getTime() + HOUR);
      await reconciler.reconcile(['AOBPRINTER']);
    }

    // A log full of the same line every fifteen minutes is a log nobody reads.
    assert.equal(lines.filter((l) => l.includes('reconcile.unavailable')).length, 1);
  });
});

describe('reconciliation_never_blocks_the_claim_loop', () => {
  /*
   * Regression, 17 September 2026, found in review and the worst defect in the
   * feature. The reader was `spawnSync`, on the same single-threaded event loop
   * that claims spool files. Node stops entirely for the duration — one to
   * three seconds of PowerShell start-up, up to fifteen on a busy log — and the
   * port is ONE FILE. A form printed during that stall had nothing running to
   * claim it, and the next job overwrote it. A reporting feature would have
   * destroyed the evidence it exists to account for.
   *
   * The property that prevents it is that the reader is AWAITED: other work
   * scheduled on the loop runs while the query is outstanding.
   */
  it('lets the claim loop run while the event log query is outstanding', async () => {
    const { logger } = capture();
    let clock = new Date('2026-09-17T00:00:00.000Z');
    let releaseReader: (() => void) | undefined;
    const slowReader = async () => {
      await new Promise<void>((resolve) => {
        releaseReader = resolve;
      });
      return new Map<string, number>();
    };

    const reconciler = new Reconciler(slowReader, logger, () => clock, 0);
    clock = new Date(clock.getTime() + HOUR);

    const claims: string[] = [];
    const inFlight = reconciler.reconcile(['AOBPRINTER']);

    // A claim arriving while PowerShell is still running must be serviced.
    await new Promise<void>((resolve) => setImmediate(resolve));
    claims.push('a form was claimed mid-query');

    assert.deepEqual(claims, ['a form was claimed mid-query'], 'the loop kept running while the query was outstanding');

    releaseReader?.();
    await inFlight;
  });
});
