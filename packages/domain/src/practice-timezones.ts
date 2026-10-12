/**
 * THE ZONES A PRACTICE'S DAY MAY BE MEASURED IN (D-2026-10-10-03).
 *
 * A practice's "today" is its own local day: the desk, the tablet's waiting
 * list and the earlier-days notice all turn at that practice's midnight.
 * Sydney, Brisbane, Adelaide, Darwin, Perth and Hobart differ, and only some
 * of them observe daylight saving, so the zone is stored per practice as an
 * IANA NAME (never an offset — D-2026-09-12-17) chosen from this list.
 *
 * WHY THE LIST IS A JSON FILE (CLAUDE.md §7c, "option lists are content, not
 * code"). `content/practice-timezones.json` is versioned content: adding a
 * zone is an edit there plus a migration widening the CHECK on
 * `practices.timezone`, which copies the list.
 *
 * HAND-WRITTEN VALIDATION, NOT ZOD, for the reason `assignor-relationships.ts`
 * gives: this package has zero runtime dependencies by charter. It runs at
 * module load, so a malformed edit fails the build and the test run rather
 * than a desk.
 *
 * EVERY ZONE IS PROVED MEASURABLE AT LOAD. A name `Intl` does not know would
 * otherwise surface as a RangeError on the first desk read of the first
 * practice that chose it.
 *
 * NOT HERE: the display words. They live in the string table keyed by zone
 * name (REQ-LANG-01).
 */
import content from '../content/practice-timezones.json';

export interface PracticeTimezoneContent {
  /** Bump on every edit. */
  readonly version: string;
  /** What every practice has until somebody changes it. One of `zones`. */
  readonly default: string;
  /** IANA zone names. ORDER IS THE ORDER ON SCREEN. */
  readonly zones: readonly string[];
}

/** Exhaustive, and it throws rather than repairing — see the file comment. */
export function parsePracticeTimezoneContent(raw: unknown): PracticeTimezoneContent {
  const fail = (why: string): never => {
    throw new Error(
      `content/practice-timezones.json is not usable: ${why}. This file is versioned content ` +
        'and is validated at load so a bad edit fails the build rather than a desk.',
    );
  };

  if (typeof raw !== 'object' || raw === null) return fail('it is not an object');
  const doc = raw as Record<string, unknown>;

  if (typeof doc.version !== 'string' || doc.version.trim().length === 0) {
    return fail('`version` must be a non-empty string');
  }
  if (!Array.isArray(doc.zones) || doc.zones.length === 0) {
    return fail('`zones` must be a non-empty array');
  }

  const seen = new Set<string>();
  const zones = doc.zones.map((zone, index) => {
    if (typeof zone !== 'string' || zone.length === 0) return fail(`zones[${index}] is not a zone name`);
    if (seen.has(zone)) return fail(`zones[${index}] "${zone}" appears twice`);
    seen.add(zone);
    try {
      new Intl.DateTimeFormat('en-AU', { timeZone: zone });
    } catch {
      return fail(`zones[${index}] "${zone}" is not an IANA zone this runtime can measure a day in`);
    }
    return zone;
  });

  if (typeof doc.default !== 'string' || !seen.has(doc.default)) {
    return fail('`default` must be one of `zones`');
  }

  return { version: doc.version, default: doc.default, zones };
}

const parsed = parsePracticeTimezoneContent(content);

/** The zones, in file order, which is screen order. */
export const PRACTICE_TIMEZONE_KEYS: readonly string[] = parsed.zones;

/** Which list a stored zone was chosen from. */
export const PRACTICE_TIMEZONES_VERSION: string = parsed.version;

/** The column default, `Australia/Sydney`. */
export const DEFAULT_PRACTICE_TIMEZONE: string = parsed.default;

/** True only for a zone on the list — a real IANA zone that is not on it is still refused. */
export function isPracticeTimezone(value: unknown): value is string {
  return typeof value === 'string' && PRACTICE_TIMEZONE_KEYS.includes(value);
}
