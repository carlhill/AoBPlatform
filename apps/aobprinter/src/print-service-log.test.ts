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

describe('a_printed_job_that_never_became_a_record_is_alarmed', () => {
  it('logs an error naming the queue and both counts when the spooler printed more than we claimed', () => {
    const { lines, logger } = capture();
    let clock = new Date('2026-09-17T00:00:00.000Z');
    // The spooler says ten; we will claim nine.
    const reconciler = new Reconciler(() => new Map([['AOBPRINTER-Room3', 10]]), logger, () => clock, 0);

    for (let i = 0; i < 9; i += 1) reconciler.recordClaim('AOBPRINTER-Room3');
    clock = new Date(clock.getTime() + HOUR);

    const summary = reconciler.reconcile(['AOBPRINTER-Room3']);

    assert.equal(summary.checked, true);
    assert.equal(summary.gaps, 1);
    const alarm = lines.find((l) => l.includes('reconcile.gap'));
    assert.ok(alarm, 'a gap must be logged, and at error level');
    assert.match(alarm, /ERROR/);
    assert.match(alarm, /AOBPRINTER-Room3/);
    assert.match(alarm, /missing=1|"missing":1|missing 1/);
  });

  it('says nothing when every printed job was claimed', () => {
    const { lines, logger } = capture();
    let clock = new Date('2026-09-17T00:00:00.000Z');
    const reconciler = new Reconciler(() => new Map([['AOBPRINTER', 3]]), logger, () => clock, 0);

    for (let i = 0; i < 3; i += 1) reconciler.recordClaim('AOBPRINTER');
    clock = new Date(clock.getTime() + HOUR);

    assert.equal(reconciler.reconcile(['AOBPRINTER']).gaps, 0);
    assert.equal(lines.filter((l) => l.includes('reconcile.gap')).length, 0);
  });

  it('never counts a claim that happened after the window it is comparing', () => {
    // A form claimed a millisecond after the window closes belongs to the next
    // window. Counting it here would hide a real gap.
    const { logger } = capture();
    let clock = new Date('2026-09-17T00:00:00.000Z');
    const reconciler = new Reconciler(() => new Map([['AOBPRINTER', 1]]), logger, () => clock, 0);

    clock = new Date(clock.getTime() + HOUR);
    reconciler.recordClaim('AOBPRINTER'); // at the window's edge, not inside it

    assert.equal(reconciler.reconcile(['AOBPRINTER']).gaps, 1);
  });
});

describe('reconciliation_failure_never_blocks_printing', () => {
  it('degrades to a warning when the event log cannot be read, and never throws', () => {
    const { lines, logger } = capture();
    let clock = new Date('2026-09-17T00:00:00.000Z');
    // null is the reader saying "could not ask", which is not the same as
    // "nothing printed" — the difference between degraded and a false alarm.
    const reconciler = new Reconciler(() => null, logger, () => clock, 0);

    clock = new Date(clock.getTime() + HOUR);
    const summary = reconciler.reconcile(['AOBPRINTER']);

    assert.equal(summary.checked, false);
    assert.equal(summary.gaps, 0, 'an unreadable log must never be reported as a missing form');
    assert.ok(lines.some((l) => l.includes('reconcile.unavailable') && l.includes('WARN')));
  });

  it('never throws when the reader itself throws', () => {
    const { lines, logger } = capture();
    let clock = new Date('2026-09-17T00:00:00.000Z');
    const reconciler = new Reconciler(
      () => {
        throw new Error('Get-WinEvent exploded');
      },
      logger,
      () => clock,
      0,
    );

    clock = new Date(clock.getTime() + HOUR);
    // This runs on the same loop that claims forms. A throw here would stop
    // capture for a reporting feature (hard rule 8).
    assert.doesNotThrow(() => reconciler.reconcile(['AOBPRINTER']));
    assert.ok(lines.some((l) => l.includes('reconcile.unavailable')));
  });

  it('warns once, not once per cycle, while the log stays unreadable', () => {
    const { lines, logger } = capture();
    let clock = new Date('2026-09-17T00:00:00.000Z');
    const reconciler = new Reconciler(() => null, logger, () => clock, 0);

    for (let i = 0; i < 4; i += 1) {
      clock = new Date(clock.getTime() + HOUR);
      reconciler.reconcile(['AOBPRINTER']);
    }

    // A log full of the same line every fifteen minutes is a log nobody reads.
    assert.equal(lines.filter((l) => l.includes('reconcile.unavailable')).length, 1);
  });
});
