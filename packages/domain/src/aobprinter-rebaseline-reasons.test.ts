/**
 * The re-baseline reasons are CONTENT, and this is the test that keeps them so
 * (D-2026-10-10-02 decision 7; CLAUDE.md §7c "option lists are content").
 *
 * A re-baseline accepts a practice's AOBPRINTER audit chain afresh after a
 * regression. Only a platform operator may do it, and only with a reason from
 * a fixed list. The console renders that list in file order and core refuses
 * any code that is not in it, so both read this one loader.
 */
import {
  AOBPRINTER_REBASELINE_REASON_KEYS,
  AOBPRINTER_REBASELINE_REASONS,
  AOBPRINTER_REBASELINE_REASONS_VERSION,
  isAobPrinterRebaselineReason,
  parseAobPrinterRebaselineReasonContent,
} from './aobprinter-rebaseline-reasons';

describe('the AOBPRINTER re-baseline reasons are versioned content', () => {
  it('rebaseline_reasons_are_loaded_from_content_in_file_order', () => {
    // Decision 7 names exactly these three, and the screen shows them in this order.
    expect(AOBPRINTER_REBASELINE_REASON_KEYS).toEqual(['reinstalled', 'database_restored', 'investigated']);
    expect(AOBPRINTER_REBASELINE_REASONS.map((r) => r.key)).toEqual(AOBPRINTER_REBASELINE_REASON_KEYS);
    expect(AOBPRINTER_REBASELINE_REASONS_VERSION).toMatch(/^aobprinter-rebaseline-reasons-/);
  });

  it('only_a_listed_code_is_a_rebaseline_reason', () => {
    expect(isAobPrinterRebaselineReason('reinstalled')).toBe(true);
    expect(isAobPrinterRebaselineReason('investigated')).toBe(true);
    expect(isAobPrinterRebaselineReason('because')).toBe(false);
    expect(isAobPrinterRebaselineReason('')).toBe(false);
    expect(isAobPrinterRebaselineReason(undefined)).toBe(false);
    expect(isAobPrinterRebaselineReason(7)).toBe(false);
  });

  it('a_malformed_reason_file_fails_at_load', () => {
    const ok = { version: 'aobprinter-rebaseline-reasons-test', reasons: [{ key: 'reinstalled' }] };
    expect(parseAobPrinterRebaselineReasonContent(ok).reasons).toEqual([{ key: 'reinstalled' }]);

    expect(() => parseAobPrinterRebaselineReasonContent(null)).toThrow(/not usable/);
    expect(() => parseAobPrinterRebaselineReasonContent({ reasons: [{ key: 'a' }] })).toThrow(/version/);
    expect(() => parseAobPrinterRebaselineReasonContent({ version: 'v', reasons: [] })).toThrow(/reasons/);
    expect(() =>
      parseAobPrinterRebaselineReasonContent({ version: 'v', reasons: [{ key: 'Not Snake' }] }),
    ).toThrow(/lower_snake_case/);
    expect(() =>
      parseAobPrinterRebaselineReasonContent({ version: 'v', reasons: [{ key: 'a' }, { key: 'a' }] }),
    ).toThrow(/twice/);
    // The core DTO's reason pattern is ^[a-z0-9_]{1,40}$; a longer key could never be posted.
    expect(() =>
      parseAobPrinterRebaselineReasonContent({ version: 'v', reasons: [{ key: 'a'.repeat(41) }] }),
    ).toThrow(/40/);
  });
});
