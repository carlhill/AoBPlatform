/**
 * THE PRACTICE TIMEZONE LIST IS CONTENT (D-2026-10-10-03; CLAUDE.md §7c,
 * "option lists are content, not code").
 *
 * What is protected: the zones a practice may choose are read from
 * `content/practice-timezones.json`, in file order, with a default that is in
 * the list; every entry is a zone `Intl` can actually measure a day in; and a
 * bad edit is refused at load rather than discovered at a desk.
 */
import {
  DEFAULT_PRACTICE_TIMEZONE,
  PRACTICE_TIMEZONE_KEYS,
  PRACTICE_TIMEZONES_VERSION,
  isPracticeTimezone,
  parsePracticeTimezoneContent,
} from './practice-timezones';

describe('the practice timezone list is versioned content', () => {
  it('timezone_list_is_loaded_from_content_in_file_order', () => {
    expect(PRACTICE_TIMEZONES_VERSION).toMatch(/^practice-timezones-/);
    // The default leads, because it is what every practice has until somebody changes it.
    expect(DEFAULT_PRACTICE_TIMEZONE).toBe('Australia/Sydney');
    expect(PRACTICE_TIMEZONE_KEYS[0]).toBe('Australia/Sydney');
    // The zones D-2026-10-10-03 names are all offered.
    for (const zone of [
      'Australia/Sydney',
      'Australia/Brisbane',
      'Australia/Adelaide',
      'Australia/Darwin',
      'Australia/Perth',
      'Australia/Hobart',
    ]) {
      expect(PRACTICE_TIMEZONE_KEYS).toContain(zone);
    }
    expect(new Set(PRACTICE_TIMEZONE_KEYS).size).toBe(PRACTICE_TIMEZONE_KEYS.length);
  });

  it('every_listed_zone_is_one_intl_can_measure_a_day_in', () => {
    for (const zone of PRACTICE_TIMEZONE_KEYS) {
      expect(() => new Intl.DateTimeFormat('en-AU', { timeZone: zone })).not.toThrow();
    }
  });

  it('is_practice_timezone_accepts_the_list_and_nothing_else', () => {
    expect(isPracticeTimezone('Australia/Perth')).toBe(true);
    // A real IANA zone that is not on the list is still refused.
    expect(isPracticeTimezone('Pacific/Auckland')).toBe(false);
    // An offset is never a zone (D-2026-09-12-17: store the name, never an offset).
    expect(isPracticeTimezone('+10:00')).toBe(false);
    expect(isPracticeTimezone(undefined)).toBe(false);
  });

  it('a_bad_edit_is_refused_at_load', () => {
    const good = { version: 'practice-timezones-test', default: 'Australia/Sydney', zones: ['Australia/Sydney'] };
    expect(parsePracticeTimezoneContent(good).zones).toEqual(['Australia/Sydney']);

    expect(() => parsePracticeTimezoneContent(null)).toThrow(/not usable/);
    expect(() => parsePracticeTimezoneContent({ ...good, version: '' })).toThrow(/version/);
    expect(() => parsePracticeTimezoneContent({ ...good, zones: [] })).toThrow(/zones/);
    expect(() =>
      parsePracticeTimezoneContent({ ...good, zones: ['Australia/Sydney', 'Australia/Sydney'] }),
    ).toThrow(/twice/);
    expect(() => parsePracticeTimezoneContent({ ...good, zones: ['Australia/Sydney', 'Mars/Olympus_Mons'] })).toThrow(
      /Mars\/Olympus_Mons/,
    );
    expect(() => parsePracticeTimezoneContent({ ...good, default: 'Australia/Perth' })).toThrow(/default/);
  });
});
