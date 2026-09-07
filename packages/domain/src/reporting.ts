/**
 * Summarising what was sent, over time.
 *
 * FIVE GRAINS AND TWO MATRICES, because they answer different questions. A
 * running total says how big this is; per-month says whether it is growing;
 * and the matrices answer the one a total never can — "is this month worse than
 * last month, or is it just further through?"
 *
 * WHY THE MATRIX COLUMNS ARE POSITIONS WITHIN THE MONTH rather than calendar
 * weeks. A table of ISO week numbers down one axis and months down the other is
 * mostly empty and compares nothing: week 31 belongs to exactly one month, so
 * every row has values in a different set of columns. Numbering the weeks 1..5
 * WITHIN each month puts comparable cells above each other, which is the entire
 * reason to draw the table. Same for days: day-of-month 1..31.
 *
 * ONE TIMEZONE, AND IT IS NOT UTC. These roll up across organisations, so the
 * buckets have to agree on when a day starts or the totals do not reconcile.
 * Bucketing in UTC would file a notice sent at 9am in Sydney under the previous
 * day for most of the year, which is wrong in a way nobody notices until they
 * compare a daily report against what they remember doing.
 */

export class ReportingError extends Error {}

/**
 * TWO YEARS, and it is a retention rule rather than a default.
 *
 * We do not keep sending records longer than this, so a report offering "since
 * the start" must mean "as far back as anything exists" rather than implying
 * there is older data being withheld. Enforced where the query is built, not
 * only in the picker, because a hand-made request is still a request.
 */
export const REPORT_MAX_YEARS = 2;

export const REPORT_TIMEZONE = 'Australia/Sydney';

export const REPORT_GRAINS = [
  { key: 'all', label: 'Since the start', detail: 'Everything we still hold, which is at most two years.' },
  { key: 'quarter', label: 'Per quarter', detail: 'Four buckets a year. The shape of a trend, without the noise.' },
  { key: 'month', label: 'Per month', detail: 'The usual one.' },
  { key: 'week', label: 'Per week', detail: 'Weeks begin on Monday.' },
  { key: 'day', label: 'Per day', detail: 'Useful for finding a spike, unwieldy over a year.' },
] as const;
export type ReportGrain = (typeof REPORT_GRAINS)[number]['key'];

export const REPORT_MATRICES = [
  {
    key: 'month_by_week',
    label: 'Months down, weeks across',
    detail: 'Compares the same week of each month — week 1 against week 1, rather than against a running total.',
  },
  {
    key: 'month_by_day',
    label: 'Months down, days across',
    detail: 'The same, by day of the month. Wide, and the only way to see a recurring day-of-month pattern.',
  },
] as const;
export type ReportMatrix = (typeof REPORT_MATRICES)[number]['key'];

export function isReportGrain(value: string): value is ReportGrain {
  return REPORT_GRAINS.some((g) => g.key === value);
}

/**
 * The calendar parts of an instant, IN THE REPORTING TIMEZONE.
 *
 * Via `Intl` rather than by adding an offset, because the offset changes twice
 * a year and a fixed one is wrong for half of it. Sydney is +10 or +11
 * depending on the date, and a report that silently shifted by an hour every
 * October would misfile everything sent late in the evening.
 */
export function partsInReportTimezone(at: Date): {
  year: number;
  month: number;
  day: number;
  weekday: number;
} {
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });

  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: Math.max(0, weekdays.indexOf(String(parts.weekday))),
  };
}

/**
 * Which week of its own month a date falls in, 1..5.
 *
 * Counted from the 1st rather than from the first Monday. A month starting on
 * a Sunday would otherwise have a stray "week 0", and the question being asked
 * is "how far into the month", not "which ISO week".
 */
export function weekOfMonth(at: Date): number {
  const { day } = partsInReportTimezone(at);
  return Math.floor((day - 1) / 7) + 1;
}

/** `2026-Q3`, `2026-08`, `2026-W34`, `2026-08-22`, or `all`. */
export function bucketKey(at: Date, grain: ReportGrain): string {
  const { year, month, day } = partsInReportTimezone(at);
  const pad = (n: number) => String(n).padStart(2, '0');

  switch (grain) {
    case 'all':
      return 'all';
    case 'quarter':
      return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
    case 'month':
      return `${year}-${pad(month)}`;
    case 'week': {
      // Keyed on the MONDAY that starts the week, so a week spanning two months
      // is one bucket rather than two halves.
      const monday = startOfWeek(at);
      const p = partsInReportTimezone(monday);
      return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    }
    case 'day':
      return `${year}-${pad(month)}-${pad(day)}`;
  }
}

/** The Monday of the week containing `at`, at 00:00 in the reporting timezone. */
export function startOfWeek(at: Date): Date {
  const { weekday } = partsInReportTimezone(at);
  // Monday is 1; Sunday (0) belongs to the week that began six days earlier.
  const back = weekday === 0 ? 6 : weekday - 1;
  return new Date(at.getTime() - back * 24 * 60 * 60 * 1000);
}

/**
 * How far back a report may look.
 *
 * `from` is never earlier than the retention limit, whatever was asked for.
 */
export function reportWindow(now: Date, requestedFrom?: Date | null): { from: Date; to: Date; capped: boolean } {
  const limit = new Date(now);
  limit.setUTCFullYear(limit.getUTCFullYear() - REPORT_MAX_YEARS);

  if (!requestedFrom || requestedFrom.getTime() < limit.getTime()) {
    return { from: limit, to: now, capped: Boolean(requestedFrom) };
  }
  return { from: requestedFrom, to: now, capped: false };
}

export type Counted = { at: Date; count: number };

/** Totals per bucket, oldest first. Buckets with nothing in them are omitted. */
export function summarise(rows: readonly Counted[], grain: ReportGrain): { key: string; count: number }[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = bucketKey(row.at, grain);
    totals.set(key, (totals.get(key) ?? 0) + row.count);
  }
  return [...totals.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => a.key.localeCompare(b.key));
}

export type Matrix = {
  /** Column headings, in order. Week 1..5, or day 1..31. */
  columns: number[];
  rows: { key: string; label: string; cells: (number | null)[]; total: number }[];
  columnTotals: number[];
  grandTotal: number;
};

/**
 * Months down the side, positions within the month across the top.
 *
 * A cell is NULL rather than 0 when that position does not exist in that month
 * — 31 February, or a fifth week in a short month. Zero would read as "nothing
 * was sent", which is a different statement from "there was no such day", and
 * the difference matters when somebody is looking for a gap.
 */
export function matrix(rows: readonly Counted[], kind: ReportMatrix): Matrix {
  const byMonth = new Map<string, Map<number, number>>();

  for (const row of rows) {
    const { year, month } = partsInReportTimezone(row.at);
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const column = kind === 'month_by_week' ? weekOfMonth(row.at) : partsInReportTimezone(row.at).day;

    const cells = byMonth.get(monthKey) ?? new Map<number, number>();
    cells.set(column, (cells.get(column) ?? 0) + row.count);
    byMonth.set(monthKey, cells);
  }

  const width = kind === 'month_by_week' ? 5 : 31;
  const columns = Array.from({ length: width }, (_, i) => i + 1);
  const monthKeys = [...byMonth.keys()].sort();

  const out: Matrix['rows'] = monthKeys.map((key) => {
    const cells = byMonth.get(key)!;
    const [year, month] = key.split('-').map(Number);
    const length = daysInMonth(year, month);

    const values = columns.map((column) => {
      const exists = kind === 'month_by_week' ? (column - 1) * 7 + 1 <= length : column <= length;
      if (!exists) return null;
      return cells.get(column) ?? 0;
    });

    return {
      key,
      label: monthLabel(year, month),
      cells: values,
      total: values.reduce<number>((sum, v) => sum + (v ?? 0), 0),
    };
  });

  const columnTotals = columns.map((_, i) => out.reduce((sum, row) => sum + (row.cells[i] ?? 0), 0));

  return {
    columns,
    rows: out,
    columnTotals,
    grandTotal: out.reduce((sum, row) => sum + row.total, 0),
  };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`;
}

/**
 * WHOSE NUMBERS SOMEBODY MAY SEE.
 *
 * The same report serves four audiences and the scope is not a filter they
 * choose — it is decided from who they are, server-side, before any counting
 * happens. A filter can be removed by editing a request; this cannot.
 *
 * `practitioner` and `patient` are single-subject by construction. There is no
 * "all practitioners" scope even for the platform here, because that report
 * would be a directory of who works where — the thing the hard rules forbid.
 * Platform sees ORGANISATIONS, and a practitioner's own totals belong to them.
 */
export const REPORT_SCOPES = ['platform', 'organisation', 'practitioner', 'patient'] as const;
export type ReportScope = (typeof REPORT_SCOPES)[number];

export function scopeFor(principal: {
  roles?: readonly string[];
  practiceId?: string | null;
  practitionerId?: string | null;
  patientId?: string | null;
}): ReportScope {
  if (principal.roles?.includes('platform_admin')) return 'platform';
  if (principal.practiceId) return 'organisation';
  if (principal.practitionerId) return 'practitioner';
  if (principal.patientId) return 'patient';

  throw new ReportingError(
    'We could not tell whose figures to show, so nothing is shown. That is deliberate: a report with no ' +
      'scope would be everybody’s.',
  );
}

/** Whether a scope may be asked for totals broken down by organisation. */
export function mayGroupByOrganisation(scope: ReportScope): boolean {
  // A practice's own report is already one organisation, and grouping by org
  // for a practitioner would say which practices they work at — to whoever
  // asked, not to them.
  return scope === 'platform';
}
