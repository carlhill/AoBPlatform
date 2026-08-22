import {
  PACKED_BREAKDOWNS,
  PACKED_REPORTS,
  PACKED_REPORT_RANGE,
  packedQuery,
  packedReport,
} from './packed-reports';

describe('the packaged reports', () => {
  it('covers the seven that were asked for', () => {
    expect(PACKED_REPORTS.map((r) => r.key)).toEqual([
      'total',
      'quarter',
      'month',
      'week',
      'day',
      'month_by_week',
      'month_by_day',
    ]);
  });

  it('NEVER carries a practice filter of its own', () => {
    /*
     * The scope is added by Cube from a signed token, and the database refuses
     * anything wider regardless. A report definition that filtered by practice
     * would be a second place the boundary lived — and the one somebody edits
     * when a report "looks empty".
     */
    for (const report of PACKED_REPORTS) {
      const json = JSON.stringify(report.query);
      expect(json).not.toMatch(/practiceId/i);
      expect(report.query).not.toHaveProperty('filters');
    }
  });

  it('bounds every report to what we still hold, on a ROLLING window', () => {
    /*
     * `last 2 years` would be wrong and was: Cube reads it as the last two
     * COMPLETE CALENDAR YEARS. Asked on 22 August 2026 it resolved to
     * 2024-01-01 → 2025-12-31 and excluded everything sent this year, so every
     * report came back empty — which reads as "you have sent nothing" rather
     * than as a misunderstanding about dates.
     */
    expect(PACKED_REPORT_RANGE).toBe('from 2 years ago to now');
    expect(PACKED_REPORT_RANGE).not.toBe('last 2 years');
    for (const report of PACKED_REPORTS) {
      expect(report.query.timeDimensions?.[0].dateRange).toBe(PACKED_REPORT_RANGE);
    }
  });

  it('asks the total without a granularity, or it would not be a total', () => {
    expect(packedReport('total')!.query.timeDimensions?.[0].granularity).toBeUndefined();
  });

  it('asks BOTH matrices by day, because Cube cannot express their columns', () => {
    /*
     * "Week 3 of its own month" is not a calendar unit. Cube groups by calendar
     * week, which puts week 31 in exactly one month and leaves every row of the
     * table in a different set of columns — comparing nothing. So the matrices
     * fetch daily rows and are reshaped against the same domain code the API
     * uses.
     */
    for (const key of ['month_by_week', 'month_by_day']) {
      expect(packedReport(key)!.query.timeDimensions?.[0].granularity).toBe('day');
    }
  });

  it('orders series oldest first, so a table reads down the page', () => {
    for (const report of PACKED_REPORTS.filter((r) => r.shape === 'series')) {
      expect(report.query.order).toEqual({ 'OutboundMessages.occurredAt': 'asc' });
    }
  });

  it('says what each one answers, not just what it is called', () => {
    // The detail line is shown under the title. A report nobody understands the
    // purpose of gets used to answer the wrong question.
    for (const report of PACKED_REPORTS) {
      expect(report.detail.length).toBeGreaterThan(20);
      expect(report.label.length).toBeGreaterThan(3);
    }
  });
});

describe('breakdowns', () => {
  it('leaves the query alone when nothing is broken down', () => {
    const report = packedReport('month')!;
    expect(packedQuery(report, 'none')).toBe(report.query);
  });

  it('groups site and department together, because a department lives inside a site', () => {
    // "Reception" is not one thing across four buildings, so grouping by
    // department alone would add up rooms that share a name.
    const dims = packedQuery(packedReport('month')!, 'site').dimensions;
    expect(dims).toEqual([
      'OutboundMessages.organisation',
      'OutboundMessages.site',
      'OutboundMessages.department',
    ]);
  });

  it('adds dimensions without disturbing the time axis', () => {
    const report = packedReport('week')!;
    const query = packedQuery(report, 'org');
    expect(query.timeDimensions).toEqual(report.query.timeDimensions);
    expect(query.measures).toEqual(report.query.measures);
  });

  it('never lets a breakdown introduce a filter', () => {
    for (const breakdown of PACKED_BREAKDOWNS) {
      for (const report of PACKED_REPORTS) {
        expect(packedQuery(report, breakdown.key)).not.toHaveProperty('filters');
      }
    }
  });
});
