import { calendarFor, isBusinessDay, terminationEffectiveDate } from './enduring';
import { AUSTRALIAN_STATES, DATASET, easterSunday, holidaysFor } from './public-holidays';

describe('easterSunday (computus)', () => {
  it.each([
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
  ])('%i → %s', (year, expected) => {
    expect(easterSunday(year).toISOString().slice(0, 10)).toBe(expected);
  });
});

describe('national holidays land on the right dates', () => {
  const nsw2026 = holidaysFor('NSW', 2026);
  const find = (name: string) => nsw2026.filter((h) => h.name === name).map((h) => h.date);

  it("New Year's Day and Australia Day 2026 need no substitution (Thu and Mon)", () => {
    expect(find("New Year's Day")).toEqual(['2026-01-01']);
    expect(find('Australia Day')).toEqual(['2026-01-26']);
  });

  it('Good Friday and Easter Monday derive from Easter, not a hand-typed table', () => {
    expect(find('Good Friday')).toEqual(['2026-04-03']);
    expect(find('Easter Monday')).toEqual(['2026-04-06']);
  });

  it('Boxing Day 2026 falls on a Saturday and substitutes to the Monday', () => {
    const boxing = nsw2026.find((h) => h.name === 'Boxing Day')!;
    expect(boxing.substituted).toBe(true);
    expect(boxing.date).toBe('2026-12-28');
  });
});

describe('anzac_day_substitution_differs_by_state', () => {
  // 25 April 2026 is a Saturday.
  it('NSW/VIC/TAS/ACT do NOT substitute — the day is always 25 April', () => {
    for (const state of ['NSW', 'VIC', 'TAS', 'ACT'] as const) {
      const anzac = holidaysFor(state, 2026).find((h) => h.name === 'ANZAC Day')!;
      expect(anzac.date).toBe('2026-04-25');
      expect(anzac.substituted).toBe(false);
    }
  });

  it('QLD/WA/SA/NT DO substitute to the following Monday', () => {
    for (const state of ['QLD', 'WA', 'SA', 'NT'] as const) {
      const anzac = holidaysFor(state, 2026).find((h) => h.name === 'ANZAC Day')!;
      expect(anzac.date).toBe('2026-04-27');
      expect(anzac.substituted).toBe(true);
    }
  });
});

describe('labour_day_is_four_different_dates', () => {
  it('NSW takes the first Monday in October; VIC the second Monday in March', () => {
    expect(holidaysFor('NSW', 2026).find((h) => h.name === 'Labour Day')?.date).toBe('2026-10-05');
    expect(holidaysFor('VIC', 2026).find((h) => h.name === 'Labour Day')?.date).toBe('2026-03-09');
  });
  it("QLD takes the King's Birthday in October while others take June", () => {
    expect(holidaysFor('QLD', 2026).find((h) => h.name === "King's Birthday")?.date).toBe('2026-10-05');
    expect(holidaysFor('NSW', 2026).find((h) => h.name === "King's Birthday")?.date).toBe('2026-06-08');
  });
  it('Melbourne Cup Day is the first Tuesday in November, Victoria only', () => {
    expect(holidaysFor('VIC', 2026).find((h) => h.name === 'Melbourne Cup Day')?.date).toBe('2026-11-03');
    expect(holidaysFor('NSW', 2026).some((h) => h.name === 'Melbourne Cup Day')).toBe(false);
  });
});

describe('every state produces a usable calendar', () => {
  it.each(AUSTRALIAN_STATES)('%s has holidays, all unique, all valid dates', (state) => {
    const holidays = holidaysFor(state, 2027);
    expect(holidays.length).toBeGreaterThan(6);
    expect(new Set(holidays.map((h) => h.date)).size).toBe(holidays.length);
    for (const h of holidays) expect(h.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('the dataset is honest about its own status', () => {
  it('reports itself unverified until a human checks it against the official lists', () => {
    expect(DATASET.verified).toBe(false);
    expect(DATASET.version).toMatch(/^holidays-/);
  });
});

describe('termination_respects_state_holidays (REQ-OFF-03) — the real point', () => {
  it('the SAME notice produces DIFFERENT effective dates in NSW and QLD', () => {
    // Notice on Thursday 23 April 2026. ANZAC Day (Sat 25 April) substitutes
    // to Monday 27 April in QLD but not in NSW.
    const notice = new Date('2026-04-23T09:00:00Z');
    const nsw = terminationEffectiveDate(notice, calendarFor('NSW', notice));
    const qld = terminationEffectiveDate(notice, calendarFor('QLD', notice));
    expect(nsw.toISOString().slice(0, 10)).toBe('2026-04-27'); // Fri 24 + Mon 27
    expect(qld.toISOString().slice(0, 10)).toBe('2026-04-28'); // Mon 27 is a holiday → Tue 28
    expect(nsw.getTime()).not.toBe(qld.getTime());
  });

  it('a notice before the Christmas cluster skips the substituted days', () => {
    // Thu 24 Dec 2026. Fri 25 = Christmas, Sat/Sun weekend, Mon 28 = Boxing
    // Day substitute ⇒ the two business days are Tue 29 and Wed 30.
    const notice = new Date('2026-12-24T09:00:00Z');
    const effective = terminationEffectiveDate(notice, calendarFor('NSW', notice));
    expect(effective.toISOString().slice(0, 10)).toBe('2026-12-30');
  });

  it('a late-December notice crosses into January’s holidays correctly', () => {
    const notice = new Date('2026-12-30T09:00:00Z');
    const calendar = calendarFor('NSW', notice);
    expect(calendar.publicHolidays.has('2027-01-01')).toBe(true);
    const effective = terminationEffectiveDate(notice, calendar);
    // Thu 31 Dec is a business day; Fri 1 Jan is New Year's Day ⇒ Mon 4 Jan.
    expect(effective.toISOString().slice(0, 10)).toBe('2027-01-04');
    expect(isBusinessDay(effective, calendar)).toBe(true);
  });

  it('the calendar carries its dataset version and verification status into the evidence', () => {
    const calendar = calendarFor('NSW');
    expect(calendar.datasetVersion).toBe(DATASET.version);
    expect(calendar.datasetVerified).toBe(false);
  });
});
