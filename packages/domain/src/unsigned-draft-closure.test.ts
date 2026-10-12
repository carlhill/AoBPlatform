/**
 * HOW LONG AN UNSIGNED AGREEMENT WAITS BEFORE IT IS CLOSED AS NOT NEEDED
 * (D-2026-10-10-09 option 3; Carl: "N is 7 days - make N a configurable
 * setting"). N is versioned content (hard rule 14), overridable per practice.
 */
import {
  UNSIGNED_DRAFT_CLOSURE_DEFAULT_DAYS,
  UNSIGNED_DRAFT_CLOSURE_MAX_DAYS,
  UNSIGNED_DRAFT_CLOSURE_MIN_DAYS,
  UNSIGNED_DRAFT_CLOSURE_REASONS,
  UNSIGNED_DRAFT_CLOSURE_TYPES,
  UNSIGNED_DRAFT_CLOSURE_VERSION,
  addCalendarDays,
  effectiveClosureDays,
  isClosureDue,
  isUnsignedDraftClosureDaysInRange,
  parseUnsignedDraftClosureContent,
} from './unsigned-draft-closure';

describe('unsigned draft closure (option 3)', () => {
  it('closure_days_default_is_seven_from_versioned_content', () => {
    expect(UNSIGNED_DRAFT_CLOSURE_DEFAULT_DAYS).toBe(7);
    expect(UNSIGNED_DRAFT_CLOSURE_MIN_DAYS).toBe(1);
    expect(UNSIGNED_DRAFT_CLOSURE_MAX_DAYS).toBe(90);
    expect(UNSIGNED_DRAFT_CLOSURE_VERSION).toMatch(/^unsigned-draft-closure-/);
    expect(UNSIGNED_DRAFT_CLOSURE_REASONS).toEqual(['no_service_recorded']);
    expect(UNSIGNED_DRAFT_CLOSURE_TYPES).not.toContain('treatment_plan');
  });

  it('a_practice_value_overrides_the_default_and_says_so', () => {
    expect(effectiveClosureDays(null)).toEqual({ days: 7, source: 'content_default', ruleVersion: UNSIGNED_DRAFT_CLOSURE_VERSION });
    expect(effectiveClosureDays(undefined).source).toBe('content_default');
    expect(effectiveClosureDays(14)).toEqual({ days: 14, source: 'practice', ruleVersion: UNSIGNED_DRAFT_CLOSURE_VERSION });
    // Out of range is never applied; the default is, and the source says so.
    expect(effectiveClosureDays(0).source).toBe('content_default');
    expect(effectiveClosureDays(91).days).toBe(7);
  });

  it('practice_closure_days_are_bounded_one_to_ninety', () => {
    expect(isUnsignedDraftClosureDaysInRange(1)).toBe(true);
    expect(isUnsignedDraftClosureDaysInRange(90)).toBe(true);
    expect(isUnsignedDraftClosureDaysInRange(0)).toBe(false);
    expect(isUnsignedDraftClosureDaysInRange(91)).toBe(false);
    expect(isUnsignedDraftClosureDaysInRange(7.5)).toBe(false);
  });

  it('closes_at_n_days_not_n_minus_one', () => {
    expect(isClosureDue('2026-10-01', 7, '2026-10-07')).toBe(false);
    expect(isClosureDue('2026-10-01', 7, '2026-10-08')).toBe(true);
    expect(isClosureDue('2026-10-01', 7, '2026-10-20')).toBe(true);
  });

  it('calendar_days_cross_months_and_the_dst_change_without_drift', () => {
    // Sydney moved to daylight time on 4 Oct 2026; calendar days do not care.
    expect(addCalendarDays('2026-10-01', 7)).toBe('2026-10-08');
    expect(addCalendarDays('2026-09-28', 7)).toBe('2026-10-05');
    expect(addCalendarDays('2027-03-30', 7)).toBe('2027-04-06');
    expect(addCalendarDays('2026-12-28', 7)).toBe('2027-01-04');
  });

  it('a_malformed_closure_file_fails_at_load', () => {
    const ok = { version: 'v', defaultDays: 7, minDays: 1, maxDays: 90, types: ['episodic_pre'] };
    expect(parseUnsignedDraftClosureContent(ok).defaultDays).toBe(7);
    expect(() => parseUnsignedDraftClosureContent(null)).toThrow(/not usable/);
    expect(() => parseUnsignedDraftClosureContent({ ...ok, version: '' })).toThrow(/version/);
    expect(() => parseUnsignedDraftClosureContent({ ...ok, defaultDays: 0 })).toThrow(/defaultDays/);
    expect(() => parseUnsignedDraftClosureContent({ ...ok, defaultDays: 100 })).toThrow(/defaultDays/);
    expect(() => parseUnsignedDraftClosureContent({ ...ok, minDays: 0 })).toThrow(/minDays/);
    expect(() => parseUnsignedDraftClosureContent({ ...ok, types: [] })).toThrow(/types/);
    expect(() => parseUnsignedDraftClosureContent({ ...ok, types: ['nonsense'] })).toThrow(/types/);
  });
});
