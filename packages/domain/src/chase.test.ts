/**
 * Named tests for the deadline-driven stop rule (REQ-CHASE-05..10).
 */
import {
  attemptAllowed,
  CHASE_BAND_POLICIES,
  chaseBandFor,
  daysRemainingInLodgementWindow,
  LODGEMENT_WINDOW_DAYS,
} from './chase';

describe('chase_bands_match_req_chase_05', () => {
  it.each([
    [365, 'standard'],
    [200, 'standard'],
    [180, 'standard'],
    [179, 'compressed'],
    [90, 'compressed'],
    [89, 'urgent'],
    [30, 'urgent'],
    [29, 'last_chance'],
    [7, 'last_chance'],
    [6, 'expired'],
    [0, 'expired'],
    [-10, 'expired'],
  ] as const)('%i days remaining → %s', (days, band) => {
    expect(chaseBandFor(days).band).toBe(band);
  });

  it('urgent band skips AI attempt 2 — human first', () => {
    expect(chaseBandFor(60).escalation[0]).toBe('human');
  });

  it('last chance is one human attempt handed to the principal', () => {
    const policy = chaseBandFor(10);
    expect(policy.attempts).toBe(1);
    expect(policy.escalation).toEqual(['human']);
    expect(policy.handback).toContain('principal');
  });

  it('bands cover the whole number line with no gaps or overlaps', () => {
    for (let d = -30; d <= 400; d++) {
      const matches = CHASE_BAND_POLICIES.filter((p) => d >= p.minDaysRemaining && d <= p.maxDaysRemaining);
      expect(matches.length).toBeLessThanOrEqual(1);
      expect(chaseBandFor(d)).toBeDefined();
    }
  });

  it('intensity_direction_not_configurable — cadence tightens monotonically as the deadline nears', () => {
    const windows = CHASE_BAND_POLICIES.filter((p) => p.attemptWindowHours !== null).map(
      (p) => p.attemptWindowHours as number,
    );
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]).toBeLessThanOrEqual(windows[i - 1]);
    }
  });
});

describe('never_chase_past_the_deadline (REQ-CHASE-08)', () => {
  it('no attempt is ever allowed in the expired band — even with a raised cap', () => {
    expect(attemptAllowed({ attemptsMade: 0, daysRemaining: 3 })).toBe(false);
    expect(attemptAllowed({ attemptsMade: 0, daysRemaining: 3, practiceRaisedCapTo: 10 })).toBe(false);
  });
});

describe('attempt_cap_economics (REQ-CHASE-09/-10)', () => {
  it('caps at the band attempts by default', () => {
    expect(attemptAllowed({ attemptsMade: 2, daysRemaining: 200 })).toBe(true);
    expect(attemptAllowed({ attemptsMade: 3, daysRemaining: 200 })).toBe(false);
  });
  it('a recorded practice instruction can raise — never lower — the cap', () => {
    expect(attemptAllowed({ attemptsMade: 4, daysRemaining: 200, practiceRaisedCapTo: 5 })).toBe(true);
    // A "raise" below the band cap has no effect: the band still allows its attempts.
    expect(attemptAllowed({ attemptsMade: 1, daysRemaining: 200, practiceRaisedCapTo: 1 })).toBe(true);
  });
});

describe('daysRemainingInLodgementWindow', () => {
  it('counts down from the service date over the 12-month window', () => {
    const now = new Date('2026-08-21T00:00:00Z');
    expect(daysRemainingInLodgementWindow('2026-08-21', now)).toBe(LODGEMENT_WINDOW_DAYS);
    expect(daysRemainingInLodgementWindow('2025-08-26', now)).toBe(5);
    expect(daysRemainingInLodgementWindow('2025-08-01', now)).toBeLessThan(0);
  });
});
