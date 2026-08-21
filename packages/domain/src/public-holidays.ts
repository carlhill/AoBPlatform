/**
 * Australian public holidays — the business-day calendar behind the
 * 2-BUSINESS-day termination rule (REQ-END-06, REQ-OFF-03).
 *
 * ⚠ THIS DATASET IS DERIVED, NOT AUTHORITATIVE. State public holidays are
 * gazetted per jurisdiction and change (one-off holidays, proclaimed dates,
 * substitution rule changes). The rules below encode the standing pattern for
 * each state, and `DATASET.verified` is FALSE until a human has checked them
 * against each state's official list. `verifiedAgainst` records what was
 * checked and when.
 *
 * WHY IT IS COMPUTED, NOT FETCHED: adding a runtime network dependency needs
 * Carl's sign-off (CLAUDE.md §7), and a termination date that silently
 * depends on a third-party API being up is a bad trade for a legal effective
 * date. This is versioned CONTENT — the same discipline as rule sets and the
 * Basic Service Description mapping (rule 14): to change a holiday, change
 * the rule, bump the version, review the diff.
 *
 * Easter-derived dates are computed with the anonymous Gregorian computus, so
 * they are correct for any year rather than a hand-typed table that expires.
 */

export const AUSTRALIAN_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const;
export type AustralianState = (typeof AUSTRALIAN_STATES)[number];

export function isAustralianState(value: string): value is AustralianState {
  return (AUSTRALIAN_STATES as readonly string[]).includes(value);
}

type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

export interface HolidayRule {
  readonly name: string;
  readonly states: readonly AustralianState[];
  /** Fixed calendar date. */
  readonly fixed?: { readonly month: number; readonly day: number };
  /** nth weekday of a month; nth = -1 means the last one. */
  readonly nthWeekday?: { readonly month: number; readonly weekday: Weekday; readonly nth: number };
  /** Days offset from Easter Sunday (Good Friday = -2, Easter Monday = +1). */
  readonly easterOffset?: number;
  /**
   * Whether a weekend occurrence moves to the following Monday (and Tuesday
   * where Monday is already taken). ANZAC Day is the notable split: NSW, VIC,
   * TAS and ACT do NOT substitute — the day is always 25 April — while QLD,
   * WA, SA and NT do.
   */
  readonly substituteIfWeekend?: boolean;
}

const ALL = AUSTRALIAN_STATES;

/**
 * The standing rules. Each entry states its own scope; anything genuinely
 * uncertain is LEFT OUT rather than guessed, because a missing holiday makes
 * a termination land a day early (visible, arguable) whereas an invented one
 * makes it land late (silently wrong).
 *
 * Deliberately omitted pending verification: local/regional show days
 * (e.g. Brisbane's Royal Queensland Show), northern-Tasmania-only days,
 * proclaimed one-offs, and Easter Sunday/Saturday, whose state-by-state
 * status has changed repeatedly in recent years.
 */
export const HOLIDAY_RULES: readonly HolidayRule[] = [
  { name: "New Year's Day", states: ALL, fixed: { month: 1, day: 1 }, substituteIfWeekend: true },
  { name: 'Australia Day', states: ALL, fixed: { month: 1, day: 26 }, substituteIfWeekend: true },
  { name: 'Good Friday', states: ALL, easterOffset: -2 },
  { name: 'Easter Monday', states: ALL, easterOffset: 1 },
  // ANZAC Day: substitution differs by state — see the HolidayRule comment.
  { name: 'ANZAC Day', states: ['NSW', 'VIC', 'TAS', 'ACT'], fixed: { month: 4, day: 25 }, substituteIfWeekend: false },
  { name: 'ANZAC Day', states: ['QLD', 'WA', 'SA', 'NT'], fixed: { month: 4, day: 25 }, substituteIfWeekend: true },
  { name: 'Christmas Day', states: ALL, fixed: { month: 12, day: 25 }, substituteIfWeekend: true },
  { name: 'Boxing Day', states: ALL, fixed: { month: 12, day: 26 }, substituteIfWeekend: true },

  // Labour Day — the same name, four different dates.
  { name: 'Labour Day', states: ['NSW', 'SA', 'ACT'], nthWeekday: { month: 10, weekday: 1, nth: 1 } },
  { name: 'Labour Day', states: ['VIC'], nthWeekday: { month: 3, weekday: 1, nth: 2 } },
  { name: 'Eight Hours Day', states: ['TAS'], nthWeekday: { month: 3, weekday: 1, nth: 2 } },
  { name: 'Labour Day', states: ['WA'], nthWeekday: { month: 3, weekday: 1, nth: 1 } },
  { name: 'May Day', states: ['QLD', 'NT'], nthWeekday: { month: 5, weekday: 1, nth: 1 } },

  // Sovereign's Birthday — also state-dependent.
  { name: "King's Birthday", states: ['NSW', 'VIC', 'SA', 'TAS', 'NT', 'ACT'], nthWeekday: { month: 6, weekday: 1, nth: 2 } },
  { name: "King's Birthday", states: ['QLD'], nthWeekday: { month: 10, weekday: 1, nth: 1 } },
  { name: "King's Birthday", states: ['WA'], nthWeekday: { month: 9, weekday: 1, nth: -1 } },

  // Single-state days.
  { name: 'Canberra Day', states: ['ACT'], nthWeekday: { month: 3, weekday: 1, nth: 2 } },
  { name: 'Adelaide Cup Day', states: ['SA'], nthWeekday: { month: 3, weekday: 1, nth: 2 } },
  { name: 'Western Australia Day', states: ['WA'], nthWeekday: { month: 6, weekday: 1, nth: 1 } },
  { name: 'Melbourne Cup Day', states: ['VIC'], nthWeekday: { month: 11, weekday: 2, nth: 1 } },
  { name: 'Picnic Day', states: ['NT'], nthWeekday: { month: 8, weekday: 1, nth: 1 } },
];

export interface HolidayDataset {
  readonly version: string;
  /** FALSE until a human has checked the rules against each state's official list. */
  readonly verified: boolean;
  readonly verifiedAgainst: string | null;
  readonly rules: readonly HolidayRule[];
}

export const DATASET: HolidayDataset = {
  version: 'holidays-2026-08-1',
  verified: false,
  verifiedAgainst: null,
  rules: HOLIDAY_RULES,
};

/** Anonymous Gregorian computus — Easter Sunday for any year. */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nthWeekdayOf(year: number, month: number, weekday: Weekday, nth: number): Date {
  if (nth === -1) {
    const last = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last day of this
    while (last.getUTCDay() !== weekday) last.setUTCDate(last.getUTCDate() - 1);
    return last;
  }
  const cursor = new Date(Date.UTC(year, month - 1, 1));
  while (cursor.getUTCDay() !== weekday) cursor.setUTCDate(cursor.getUTCDate() + 1);
  cursor.setUTCDate(cursor.getUTCDate() + (nth - 1) * 7);
  return cursor;
}

function resolve(rule: HolidayRule, year: number): Date | null {
  if (rule.fixed) return new Date(Date.UTC(year, rule.fixed.month - 1, rule.fixed.day));
  if (rule.nthWeekday) {
    return nthWeekdayOf(year, rule.nthWeekday.month, rule.nthWeekday.weekday, rule.nthWeekday.nth);
  }
  if (rule.easterOffset !== undefined) {
    const easter = easterSunday(year);
    easter.setUTCDate(easter.getUTCDate() + rule.easterOffset);
    return easter;
  }
  return null;
}

export interface ResolvedHoliday {
  readonly date: string;
  readonly name: string;
  readonly substituted: boolean;
}

/** Every holiday observed in `state` during `year`, substitutions applied. */
export function holidaysFor(state: AustralianState, year: number, dataset: HolidayDataset = DATASET): ResolvedHoliday[] {
  const taken = new Set<string>();
  const resolved: ResolvedHoliday[] = [];

  for (const rule of dataset.rules) {
    if (!rule.states.includes(state)) continue;
    const date = resolve(rule, year);
    if (!date) continue;

    let observed = new Date(date.getTime());
    let substituted = false;
    if (rule.substituteIfWeekend && (observed.getUTCDay() === 0 || observed.getUTCDay() === 6)) {
      // Move to the next weekday not already claimed by another holiday —
      // this is what produces the 27/28 December pattern.
      substituted = true;
      do {
        observed.setUTCDate(observed.getUTCDate() + 1);
      } while (observed.getUTCDay() === 0 || observed.getUTCDay() === 6 || taken.has(isoDate(observed)));
    }
    if (!substituted && taken.has(isoDate(observed))) continue; // two rules landing on one day
    taken.add(isoDate(observed));
    resolved.push({ date: isoDate(observed), name: rule.name, substituted });
  }
  return resolved.sort((a, b) => a.date.localeCompare(b.date));
}

/** The set a BusinessDayCalendar needs, spanning the years a calculation may cross. */
export function holidaySetFor(
  state: AustralianState,
  years: readonly number[],
  dataset: HolidayDataset = DATASET,
): Set<string> {
  const set = new Set<string>();
  for (const year of years) {
    for (const holiday of holidaysFor(state, year, dataset)) set.add(holiday.date);
  }
  return set;
}
