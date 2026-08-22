/**
 * The reports we ship ready-made, expressed as Cube queries.
 *
 * WHY THESE ARE DEFINITIONS RATHER THAN SCREENS. Cube can answer far more than
 * this, and the Playground is there for anyone who wants to ask something new.
 * But most people do not want to compose a query — they want the answer to a
 * question they already have, which is nearly always one of seven. Naming
 * those seven means the common case is one click and the uncommon case is
 * still possible.
 *
 * ONE PLACE, so the report and its meaning cannot drift apart. A query built in
 * the browser and a title written beside it are two facts that agree until
 * somebody edits one of them.
 *
 * THE SCOPE IS NOT HERE, deliberately. None of these carries a practice filter.
 * Cube adds it from the caller's signed token, and the database refuses
 * anything wider regardless — so a report definition cannot widen its own
 * scope, however it is edited.
 */

export type CubeGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

export type CubeQuery = {
  measures: string[];
  dimensions?: string[];
  timeDimensions?: { dimension: string; granularity?: CubeGranularity; dateRange?: string | string[] }[];
  order?: Record<string, 'asc' | 'desc'>;
  limit?: number;
};

/**
 * How a report is drawn, which is not the same as what it asks for.
 *
 * `series` is a period per row. `matrix` reshapes DAILY rows into months down
 * the side and positions within the month across the top — a shape Cube has no
 * way to express, because "week 3 of its own month" is not a calendar unit.
 */
export type PackedReportShape = 'total' | 'series' | 'matrix_week' | 'matrix_day';

export type PackedReport = {
  key: string;
  label: string;
  /** What question this answers. Shown under the title, not as a tooltip. */
  detail: string;
  shape: PackedReportShape;
  query: CubeQuery;
};

/**
 * TWO YEARS, and it is retention rather than a default.
 *
 * We do not keep sending records longer than that, so "since the start" means
 * "as far back as anything exists" rather than implying older figures are being
 * withheld. The view enforces it too; this makes the query say so as well, so
 * a reader of the generated SQL is not left wondering where the limit came
 * from.
 *
 * NOT `last 2 years`, WHICH MEANS SOMETHING ELSE. Cube reads that as the last
 * two COMPLETE CALENDAR YEARS — asked on 22 August 2026 it resolved to
 * 2024-01-01 → 2025-12-31, excluding everything sent this year. Every report
 * came back empty, which reads as "you have sent nothing" rather than as a
 * misunderstanding about dates.
 *
 * `from 2 years ago to now` is the rolling window that was actually meant.
 */
export const PACKED_REPORT_RANGE = 'from 2 years ago to now';

const TIME = 'OutboundMessages.occurredAt';
const MEASURES = ['OutboundMessages.count', 'OutboundMessages.sent', 'OutboundMessages.failed'];

function timeSeries(granularity: CubeGranularity): CubeQuery {
  return {
    measures: MEASURES,
    timeDimensions: [{ dimension: TIME, granularity, dateRange: PACKED_REPORT_RANGE }],
    order: { [TIME]: 'asc' },
  };
}

export const PACKED_REPORTS: readonly PackedReport[] = [
  {
    key: 'total',
    label: 'Total since the start',
    detail: 'Everything we still hold. That is at most two years — we do not keep sending records longer.',
    shape: 'total',
    // No granularity: one number, which is the whole point of this one.
    query: {
      measures: MEASURES,
      timeDimensions: [{ dimension: TIME, dateRange: PACKED_REPORT_RANGE }],
    },
  },
  {
    key: 'quarter',
    label: 'Per quarter',
    detail: 'Four buckets a year. The shape of a trend, with the week-to-week noise taken out.',
    shape: 'series',
    query: timeSeries('quarter'),
  },
  {
    key: 'month',
    label: 'Per month',
    detail: 'The usual one, and the one most questions turn out to be.',
    shape: 'series',
    query: timeSeries('month'),
  },
  {
    key: 'week',
    label: 'Per week',
    detail: 'Weeks begin on Monday.',
    shape: 'series',
    query: timeSeries('week'),
  },
  {
    key: 'day',
    label: 'Per day',
    detail: 'Good for finding a spike. Unwieldy across a whole year.',
    shape: 'series',
    query: timeSeries('day'),
  },
  {
    key: 'month_by_week',
    label: 'Months down, weeks across',
    detail:
      'Compares the same week of each month — week 1 against week 1 — which answers "is this month worse, ' +
      'or just further through?" A running total never can.',
    shape: 'matrix_week',
    // ASKED FOR BY DAY, then reshaped here. Cube can group by calendar week,
    // but "week 3 of its own month" is not a calendar unit and it has no way
    // to express it.
    query: timeSeries('day'),
  },
  {
    key: 'month_by_day',
    label: 'Months down, days across',
    detail: 'The same, by day of the month. Wide, and the only way to see a recurring day-of-month pattern.',
    shape: 'matrix_day',
    query: timeSeries('day'),
  },
];

export function packedReport(key: string): PackedReport | undefined {
  return PACKED_REPORTS.find((r) => r.key === key);
}

/**
 * The same reports, split by where the messages went.
 *
 * A separate axis rather than fourteen more reports: every report above can be
 * asked with or without a breakdown, and listing the combinations would make a
 * menu nobody reads.
 *
 * `site` groups by site AND department together, because a department only
 * means anything inside its site — "Reception" is not one thing across four
 * buildings.
 */
export const PACKED_BREAKDOWNS = [
  { key: 'none', label: 'Everything together', dimensions: [] as string[] },
  { key: 'org', label: 'By organisation', dimensions: ['OutboundMessages.organisation'] },
  {
    key: 'site',
    label: 'By site and department',
    dimensions: ['OutboundMessages.organisation', 'OutboundMessages.site', 'OutboundMessages.department'],
  },
  { key: 'channel', label: 'By channel', dimensions: ['OutboundMessages.channel'] },
  { key: 'format', label: 'By format', dimensions: ['OutboundMessages.mediaType'] },
] as const;

export type PackedBreakdown = (typeof PACKED_BREAKDOWNS)[number]['key'];

/** The query to actually send: a report, plus a breakdown if one was chosen. */
export function packedQuery(report: PackedReport, breakdown: PackedBreakdown): CubeQuery {
  const chosen = PACKED_BREAKDOWNS.find((b) => b.key === breakdown);
  if (!chosen || chosen.dimensions.length === 0) return report.query;

  return {
    ...report.query,
    dimensions: [...chosen.dimensions],
  };
}
