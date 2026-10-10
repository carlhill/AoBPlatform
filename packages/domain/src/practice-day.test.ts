/**
 * THE DAY BOUNDARY IS THE PRACTICE'S, NOT UTC.
 *
 * These are the cheapest place to pin it: no database, no clock, no host
 * timezone. Every case names an instant, so the suite says the same thing on a
 * laptop in Sydney and on a UTC runner — which is the whole point, because the
 * defect this file exists to prevent is invisible on a UTC runner.
 */
import {
  NotACalendarDay,
  PRACTICE_TIMEZONE,
  practiceDayOf,
  practiceDayWindow,
  practiceToday,
  startOfPracticeDay,
} from './practice-day';

describe('one day, as the practice means it', () => {
  it('day_window_is_the_practices_clock_not_utc', () => {
    /*
     * 12 September 2026 in Sydney is AEST (+10) — Australian daylight saving
     * runs October to April — so the practice's day begins at 14:00 UTC on the
     * 11th and ends at 14:00 UTC on the 12th.
     *
     * A UTC window would have been 00:00 to 00:00 on the 12th, which is ten
     * hours out and excludes the whole of the practice's morning.
     */
    const window = practiceDayWindow('2026-09-12');

    expect(window.day).toBe('2026-09-12');
    expect(window.timezone).toBe(PRACTICE_TIMEZONE);
    expect(window.from.toISOString()).toBe('2026-09-11T14:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-09-12T14:00:00.000Z');
  });

  it('day_window_follows_daylight_saving_rather_than_a_fixed_offset', () => {
    // January is AEDT (+11): the same calendar day starts an hour earlier in UTC.
    const summer = practiceDayWindow('2026-01-15');
    expect(summer.from.toISOString()).toBe('2026-01-14T13:00:00.000Z');
    expect(summer.to.toISOString()).toBe('2026-01-15T13:00:00.000Z');

    /*
     * AND THE DAY THE CLOCKS GO BACK IS 25 HOURS LONG. 5 April 2026 is the
     * first Sunday in April, when Sydney leaves AEDT at 3am. A fixed offset
     * would make this window 24 hours and lose the last hour of the day.
     */
    const transition = practiceDayWindow('2026-04-05');
    expect(transition.from.toISOString()).toBe('2026-04-04T13:00:00.000Z');
    expect(transition.to.toISOString()).toBe('2026-04-05T14:00:00.000Z');
    expect(transition.to.getTime() - transition.from.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it('day_window_defaults_to_today_by_the_practices_clock', () => {
    /*
     * 22:30 UTC on 11 September is 08:30 on the 12th in Sydney — a receptionist
     * is at the desk and the register must be headed with the day they are
     * having. `toISOString().slice(0, 10)` would say the 11th.
     */
    const morning = new Date('2026-09-11T22:30:00.000Z');

    expect(practiceToday(morning)).toBe('2026-09-12');
    expect(practiceDayWindow(undefined, morning).day).toBe('2026-09-12');
    expect(practiceDayWindow(null, morning).day).toBe('2026-09-12');
    expect(practiceDayWindow('', morning).day).toBe('2026-09-12');

    // And the instant itself falls inside the window it produced.
    const window = practiceDayWindow(undefined, morning);
    expect(morning.getTime()).toBeGreaterThanOrEqual(window.from.getTime());
    expect(morning.getTime()).toBeLessThan(window.to.getTime());
  });

  it('day_window_refuses_a_date_that_is_not_a_day', () => {
    // Shape.
    expect(() => practiceDayWindow('12/09/2026')).toThrow(NotACalendarDay);
    expect(() => practiceDayWindow('yesterday')).toThrow(NotACalendarDay);
    // Real shape, impossible day — refused rather than nudged to 3 March.
    expect(() => practiceDayWindow('2026-02-31')).toThrow(NotACalendarDay);
    expect(() => practiceDayWindow('2026-13-01')).toThrow(NotACalendarDay);
    // A leap day that exists is not refused.
    expect(practiceDayWindow('2028-02-29').day).toBe('2028-02-29');
  });

  it('day_windows_of_consecutive_days_meet_exactly_once', () => {
    /*
     * HALF-OPEN, SO NOBODY IS COUNTED TWICE OR LOST. One day's `to` is the
     * next day's `from`, exactly — the property a register depends on and the
     * one an off-by-one in the offset arithmetic would break.
     */
    for (const [first, second] of [
      ['2026-09-12', '2026-09-13'],
      ['2026-04-04', '2026-04-05'],
      ['2026-10-03', '2026-10-04'],
      ['2026-12-31', '2027-01-01'],
    ]) {
      expect(practiceDayWindow(first!).to.toISOString()).toBe(practiceDayWindow(second!).from.toISOString());
    }
  });
});

/*
 * THE SAME BOUNDARY, IN A ZONE THE CALLER NAMES (D-2026-10-10-03).
 *
 * A practice's day is its own local day, and Australia has zones that observe
 * daylight saving and zones that do not. Every case names an instant and a
 * zone, so these say the same thing on a Sydney laptop and on a UTC runner.
 *
 * Sydney's daylight saving starts on the first Sunday in October (4 October
 * 2026, 2am AEST becomes 3am AEDT) and ends on the first Sunday in April
 * (5 April 2026, 3am AEDT becomes 2am AEST).
 */
describe("one day, in the practice's own zone", () => {
  it('practice_day_of_is_the_local_date_not_the_utc_date', () => {
    // 8:30am AEDT on 13 October is 21:30 UTC on the 12th.
    expect(practiceDayOf(new Date('2026-10-12T21:30:00Z'), 'Australia/Sydney')).toBe('2026-10-13');
    // Perth is +8 all year: the same instant is 5:30am on the 13th there.
    expect(practiceDayOf(new Date('2026-10-12T21:30:00Z'), 'Australia/Perth')).toBe('2026-10-13');
    // One second before Perth's midnight is still the 12th in Perth...
    expect(practiceDayOf(new Date('2026-10-12T15:59:59Z'), 'Australia/Perth')).toBe('2026-10-12');
    // ...while Sydney is already on the 13th.
    expect(practiceDayOf(new Date('2026-10-12T15:59:59Z'), 'Australia/Sydney')).toBe('2026-10-13');
  });

  it('practice_day_of_turns_at_local_midnight_when_daylight_saving_starts', () => {
    // Midnight before the change is AEST (+10).
    expect(practiceDayOf(new Date('2026-10-03T13:59:59Z'), 'Australia/Sydney')).toBe('2026-10-03');
    expect(practiceDayOf(new Date('2026-10-03T14:00:00Z'), 'Australia/Sydney')).toBe('2026-10-04');
    // The next midnight is AEDT (+11), an hour earlier in UTC.
    expect(practiceDayOf(new Date('2026-10-04T12:59:59Z'), 'Australia/Sydney')).toBe('2026-10-04');
    expect(practiceDayOf(new Date('2026-10-04T13:00:00Z'), 'Australia/Sydney')).toBe('2026-10-05');
    // Brisbane keeps +10 throughout, so its midnight does not move.
    expect(practiceDayOf(new Date('2026-10-04T13:00:00Z'), 'Australia/Brisbane')).toBe('2026-10-04');
    expect(practiceDayOf(new Date('2026-10-04T14:00:00Z'), 'Australia/Brisbane')).toBe('2026-10-05');
  });

  it('practice_day_of_turns_at_local_midnight_when_daylight_saving_ends', () => {
    // Midnight before the change is AEDT (+11).
    expect(practiceDayOf(new Date('2026-04-04T12:59:59Z'), 'Australia/Sydney')).toBe('2026-04-04');
    expect(practiceDayOf(new Date('2026-04-04T13:00:00Z'), 'Australia/Sydney')).toBe('2026-04-05');
    // The 25-hour day ends at the next midnight, which is AEST (+10).
    expect(practiceDayOf(new Date('2026-04-05T13:59:59Z'), 'Australia/Sydney')).toBe('2026-04-05');
    expect(practiceDayOf(new Date('2026-04-05T14:00:00Z'), 'Australia/Sydney')).toBe('2026-04-06');
  });

  it('start_of_practice_day_follows_daylight_saving_starting', () => {
    // 4pm AEDT on 4 October: that day began at midnight AEST.
    expect(startOfPracticeDay(new Date('2026-10-04T05:00:00Z'), 'Australia/Sydney').toISOString()).toBe(
      '2026-10-03T14:00:00.000Z',
    );
    // The next day began at midnight AEDT, an hour earlier in UTC.
    expect(startOfPracticeDay(new Date('2026-10-05T01:00:00Z'), 'Australia/Sydney').toISOString()).toBe(
      '2026-10-04T13:00:00.000Z',
    );
    // Adelaide changes on the same day, half an hour behind.
    expect(startOfPracticeDay(new Date('2026-10-05T01:00:00Z'), 'Australia/Adelaide').toISOString()).toBe(
      '2026-10-04T13:30:00.000Z',
    );
    // Brisbane does not change at all.
    expect(startOfPracticeDay(new Date('2026-10-05T01:00:00Z'), 'Australia/Brisbane').toISOString()).toBe(
      '2026-10-04T14:00:00.000Z',
    );
  });

  it('start_of_practice_day_follows_daylight_saving_ending', () => {
    // 8pm AEST on 5 April: that day began at midnight AEDT.
    expect(startOfPracticeDay(new Date('2026-04-05T10:00:00Z'), 'Australia/Sydney').toISOString()).toBe(
      '2026-04-04T13:00:00.000Z',
    );
    // The next day began at midnight AEST, an hour later in UTC.
    expect(startOfPracticeDay(new Date('2026-04-06T01:00:00Z'), 'Australia/Sydney').toISOString()).toBe(
      '2026-04-05T14:00:00.000Z',
    );
    // Hobart leaves daylight saving on the same day as Sydney.
    expect(startOfPracticeDay(new Date('2026-04-06T01:00:00Z'), 'Australia/Hobart').toISOString()).toBe(
      '2026-04-05T14:00:00.000Z',
    );
  });

  it('start_of_practice_day_is_perth_midnight_for_perth', () => {
    expect(startOfPracticeDay(new Date('2026-10-12T21:30:00Z'), 'Australia/Perth').toISOString()).toBe(
      '2026-10-12T16:00:00.000Z',
    );
    // Midnight itself is the start of its own day, not the end of the last.
    expect(startOfPracticeDay(new Date('2026-10-12T16:00:00Z'), 'Australia/Perth').toISOString()).toBe(
      '2026-10-12T16:00:00.000Z',
    );
  });

  it('an_unknown_zone_is_refused_rather_than_read_as_utc', () => {
    expect(() => practiceDayOf(new Date('2026-10-12T21:30:00Z'), 'Mars/Olympus_Mons')).toThrow(RangeError);
    expect(() => startOfPracticeDay(new Date('2026-10-12T21:30:00Z'), 'Mars/Olympus_Mons')).toThrow(RangeError);
  });
});
