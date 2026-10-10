/**
 * HOW LONG AN UNSIGNED AGREEMENT WAITS, WITH NO SERVICE RECORDED FOR ITS
 * VISIT, BEFORE IT IS CLOSED AS NOT NEEDED (D-2026-10-10-09, option 3).
 *
 * Carl, 10 Oct 2026: "N is 7 days - make N a configurable setting". N is a
 * threshold, so it is VERSIONED CONTENT (hard rule 14):
 * `content/unsigned-draft-closure.json` holds the default, the bounds a
 * practice's own value must sit inside, and which agreement types are drafted
 * for one visit. Every closure records the file's version and the N applied.
 *
 * CLOSING IS A STATE CHANGE, NEVER A DELETE: `expired` (which the lifecycle
 * already allows from every unsigned state) with a closure reason beside it
 * and a vault event. Nothing that could still be claimed is closed: core's
 * sweep refuses a draft that is signed, linked to a service, associated with
 * one, matched by one, on a tablet, or younger than N.
 *
 * HAND-WRITTEN VALIDATION, NOT ZOD, for the reason the other loaders give:
 * this package has zero runtime dependencies. It runs at module load, so a
 * malformed edit fails the build and the test run, not the sweep.
 */
import content from '../content/unsigned-draft-closure.json';
import type { AgreementType } from './agreement';

const KNOWN_TYPES: readonly AgreementType[] = ['episodic_pre', 'episodic_post', 'treatment_plan', 'enduring'];

export interface UnsignedDraftClosureContent {
  /** Bump on every edit. */
  readonly version: string;
  readonly defaultDays: number;
  readonly minDays: number;
  readonly maxDays: number;
  /** Which agreement types are drafted for one visit and may be closed this way. */
  readonly types: readonly AgreementType[];
}

/** Exhaustive, and it throws rather than repairing: a bad edit is a mistake to surface. */
export function parseUnsignedDraftClosureContent(raw: unknown): UnsignedDraftClosureContent {
  const fail = (why: string): never => {
    throw new Error(
      `content/unsigned-draft-closure.json is not usable: ${why}. This file is versioned content ` +
        '(hard rule 14) and is validated at load so a bad edit fails the build rather than the sweep.',
    );
  };
  if (typeof raw !== 'object' || raw === null) return fail('it is not an object');
  const doc = raw as Record<string, unknown>;
  if (typeof doc.version !== 'string' || doc.version.trim().length === 0) {
    return fail('`version` must be a non-empty string');
  }
  const whole = (key: string): number => {
    const value = doc[key];
    if (typeof value !== 'number' || !Number.isInteger(value)) return fail(`\`${key}\` must be a whole number`);
    return value;
  };
  const minDays = whole('minDays');
  const maxDays = whole('maxDays');
  const defaultDays = whole('defaultDays');
  if (minDays < 1) return fail('`minDays` must be at least 1: closing a draft on its own day would close one still in use');
  if (maxDays < minDays) return fail('`maxDays` must not be below `minDays`');
  if (defaultDays < minDays || defaultDays > maxDays) return fail('`defaultDays` must sit between `minDays` and `maxDays`');
  if (!Array.isArray(doc.types) || doc.types.length === 0) return fail('`types` must be a non-empty array');
  const types = doc.types.map((type, index) => {
    if (typeof type !== 'string' || !(KNOWN_TYPES as readonly string[]).includes(type)) {
      return fail(`types[${index}] must be an agreement type (${KNOWN_TYPES.join(', ')})`);
    }
    return type as AgreementType;
  });
  return { version: doc.version, defaultDays, minDays, maxDays, types };
}

const parsed = parseUnsignedDraftClosureContent(content);

export const UNSIGNED_DRAFT_CLOSURE_VERSION: string = parsed.version;
export const UNSIGNED_DRAFT_CLOSURE_DEFAULT_DAYS: number = parsed.defaultDays;
export const UNSIGNED_DRAFT_CLOSURE_MIN_DAYS: number = parsed.minDays;
export const UNSIGNED_DRAFT_CLOSURE_MAX_DAYS: number = parsed.maxDays;
export const UNSIGNED_DRAFT_CLOSURE_TYPES: readonly AgreementType[] = parsed.types;

/**
 * WHY AN AGREEMENT WAS CLOSED. One code today, stored beside the agreement and
 * carried on its vault event; the console owns the words.
 */
export const UNSIGNED_DRAFT_CLOSURE_REASONS = ['no_service_recorded'] as const;
export type UnsignedDraftClosureReason = (typeof UNSIGNED_DRAFT_CLOSURE_REASONS)[number];

/** A practice's own N must be a whole number of days inside the content's bounds. */
export function isUnsignedDraftClosureDaysInRange(days: unknown): days is number {
  return (
    typeof days === 'number' &&
    Number.isInteger(days) &&
    days >= UNSIGNED_DRAFT_CLOSURE_MIN_DAYS &&
    days <= UNSIGNED_DRAFT_CLOSURE_MAX_DAYS
  );
}

/**
 * THE N THAT APPLIES, AND WHERE IT CAME FROM. The practice's own value when it
 * has set one inside the bounds; otherwise the content default. Both carry the
 * content version, which every closure records.
 */
export function effectiveClosureDays(practiceDays: number | null | undefined): {
  days: number;
  source: 'practice' | 'content_default';
  ruleVersion: string;
} {
  return isUnsignedDraftClosureDaysInRange(practiceDays)
    ? { days: practiceDays, source: 'practice', ruleVersion: UNSIGNED_DRAFT_CLOSURE_VERSION }
    : { days: UNSIGNED_DRAFT_CLOSURE_DEFAULT_DAYS, source: 'content_default', ruleVersion: UNSIGNED_DRAFT_CLOSURE_VERSION };
}

/**
 * `YYYY-MM-DD` plus whole calendar days. Calendar arithmetic, in UTC on purpose:
 * a day is a label here, not an instant, so a daylight-saving change cannot move it.
 */
export function addCalendarDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/**
 * DUE ON DAY `forDay + N`, NOT BEFORE. A draft for 1 October with N = 7 is
 * closed on 8 October, the first practice-local day on which a full seven days
 * have passed since its own.
 */
export function isClosureDue(forDay: string, days: number, today: string): boolean {
  return today >= addCalendarDays(forDay, days);
}
