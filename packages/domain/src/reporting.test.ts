import {
  REPORT_MAX_YEARS,
  ReportingError,
  bucketKey,
  matrix,
  mayGroupByOrganisation,
  monthLabel,
  partsInReportTimezone,
  reportWindow,
  scopeFor,
  startOfWeek,
  summarise,
  weekOfMonth,
} from './reporting';

/** 9am on 22 August 2026 in Sydney is 23:00 on the 21st, UTC. */
const NINE_AM_SYDNEY = new Date('2026-08-21T23:00:00Z');

describe('bucketing happens in the reporting timezone', () => {
  it('files a Sydney morning under the Sydney day, not the UTC one', () => {
    /*
     * The bug this prevents: bucketing in UTC puts everything sent before 10am
     * Sydney into the previous day for most of the year. Nobody notices until
     * they compare a daily report against what they remember doing, and by
     * then every historical figure is wrong the same way.
     */
    expect(partsInReportTimezone(NINE_AM_SYDNEY).day).toBe(22);
    expect(NINE_AM_SYDNEY.getUTCDate()).toBe(21);
    expect(bucketKey(NINE_AM_SYDNEY, 'day')).toBe('2026-08-22');
  });

  it('handles both sides of a daylight-saving change', () => {
    // Sydney is +11 in January and +10 in August. A fixed offset would be
    // wrong for half the year, which is why this goes through Intl.
    const january = new Date('2026-01-14T13:30:00Z'); // 00:30 on the 15th, +11
    const august = new Date('2026-08-14T14:30:00Z'); // 00:30 on the 15th, +10
    expect(partsInReportTimezone(january).day).toBe(15);
    expect(partsInReportTimezone(august).day).toBe(15);
  });
});

describe('the grains', () => {
  const at = new Date('2026-08-22T02:00:00Z'); // midday Sydney, 22 Aug 2026

  it('keys each grain the way it sorts', () => {
    expect(bucketKey(at, 'all')).toBe('all');
    expect(bucketKey(at, 'quarter')).toBe('2026-Q3');
    expect(bucketKey(at, 'month')).toBe('2026-08');
    expect(bucketKey(at, 'day')).toBe('2026-08-22');
  });

  it('keys a week on its Monday, so a week spanning two months is one bucket', () => {
    // 22 August 2026 is a Saturday; its week began Monday the 17th.
    expect(bucketKey(at, 'week')).toBe('2026-08-17');

    const sunday = new Date('2026-08-23T02:00:00Z');
    expect(bucketKey(sunday, 'week')).toBe('2026-08-17');

    const monday = new Date('2026-08-24T02:00:00Z');
    expect(bucketKey(monday, 'week')).toBe('2026-08-24');
  });

  it('treats Sunday as the end of its week, not the start of the next', () => {
    const sunday = new Date('2026-08-23T02:00:00Z');
    expect(partsInReportTimezone(startOfWeek(sunday)).day).toBe(17);
  });

  it('totals into buckets, oldest first, omitting empty ones', () => {
    const rows = [
      { at: new Date('2026-07-15T02:00:00Z'), count: 3 },
      { at: new Date('2026-08-01T02:00:00Z'), count: 5 },
      { at: new Date('2026-08-22T02:00:00Z'), count: 2 },
    ];
    expect(summarise(rows, 'month')).toEqual([
      { key: '2026-07', count: 3 },
      { key: '2026-08', count: 7 },
    ]);
  });
});

describe('the two-year limit', () => {
  const now = new Date('2026-08-22T02:00:00Z');

  it('caps a request that reaches further back than we keep', () => {
    const asked = new Date('2020-01-01T00:00:00Z');
    const window = reportWindow(now, asked);
    expect(window.capped).toBe(true);
    expect(window.from.getUTCFullYear()).toBe(2024);
  });

  it('leaves a request inside the window alone', () => {
    const asked = new Date('2026-01-01T00:00:00Z');
    expect(reportWindow(now, asked)).toMatchObject({ from: asked, capped: false });
  });

  it('defaults to the full window when nothing is asked for', () => {
    const window = reportWindow(now);
    expect(window.from.getUTCFullYear()).toBe(now.getUTCFullYear() - REPORT_MAX_YEARS);
    // Not "capped": nobody asked for more, so nothing was withheld.
    expect(window.capped).toBe(false);
  });
});

describe('week of the month', () => {
  it('counts from the 1st, so there is never a week zero', () => {
    // Counting from the first Monday would give a month starting on a Sunday a
    // stray week 0. The question is "how far into the month", not "which ISO
    // week".
    expect(weekOfMonth(new Date('2026-08-01T02:00:00Z'))).toBe(1);
    expect(weekOfMonth(new Date('2026-08-07T02:00:00Z'))).toBe(1);
    expect(weekOfMonth(new Date('2026-08-08T02:00:00Z'))).toBe(2);
    expect(weekOfMonth(new Date('2026-08-29T02:00:00Z'))).toBe(5);
  });
});

describe('the comparison matrices', () => {
  const rows = [
    { at: new Date('2026-07-02T02:00:00Z'), count: 4 }, // Jul, week 1, day 2
    { at: new Date('2026-07-20T02:00:00Z'), count: 6 }, // Jul, week 3, day 20
    { at: new Date('2026-08-02T02:00:00Z'), count: 1 }, // Aug, week 1, day 2
    { at: new Date('2026-08-22T02:00:00Z'), count: 9 }, // Aug, week 4, day 22
  ];

  it('puts comparable cells above each other', () => {
    /*
     * The whole reason to draw this. Week 1 of July sits directly above week 1
     * of August, so "is this month worse, or just further through?" has an
     * answer a running total cannot give.
     */
    const m = matrix(rows, 'month_by_week');
    expect(m.columns).toEqual([1, 2, 3, 4, 5]);
    expect(m.rows.map((r) => r.label)).toEqual(['July 2026', 'August 2026']);
    expect(m.rows[0].cells[0]).toBe(4);
    expect(m.rows[1].cells[0]).toBe(1);
    expect(m.rows[0].total).toBe(10);
    expect(m.grandTotal).toBe(20);
  });

  it('totals the columns, which is the comparison itself', () => {
    const m = matrix(rows, 'month_by_week');
    expect(m.columnTotals[0]).toBe(5); // week 1 across both months
    expect(m.columnTotals[2]).toBe(6); // week 3, July only
  });

  it('DISTINGUISHES "nothing sent" FROM "no such day"', () => {
    /*
     * A zero says we sent nothing that day. A null says the day does not exist
     * in that month. Showing 0 for 31 February would be a claim about a date
     * that never happened, and somebody hunting a gap would chase it.
     */
    const february = matrix([{ at: new Date('2026-02-10T02:00:00Z'), count: 1 }], 'month_by_day');
    const cells = february.rows[0].cells;
    expect(cells[9]).toBe(1); // the 10th
    expect(cells[0]).toBe(0); // the 1st: real day, nothing sent
    expect(cells[27]).toBe(0); // the 28th: exists in 2026
    expect(cells[28]).toBeNull(); // the 29th: 2026 is not a leap year
    expect(cells[30]).toBeNull(); // the 31st: never in February
  });

  it('marks the fifth week absent only where no day falls in it', () => {
    // February 2026 has 28 days, so a fifth week (days 29+) cannot exist.
    const m = matrix([{ at: new Date('2026-02-10T02:00:00Z'), count: 1 }], 'month_by_week');
    expect(m.rows[0].cells[4]).toBeNull();

    // August has 31, so week 5 exists and is genuinely empty.
    const august = matrix([{ at: new Date('2026-08-10T02:00:00Z'), count: 1 }], 'month_by_week');
    expect(august.rows[0].cells[4]).toBe(0);
  });

  it('labels months for a reader, not for a sort key', () => {
    expect(monthLabel(2026, 8)).toBe('August 2026');
  });
});

describe('whose figures somebody sees', () => {
  it('decides from who they are, never from what they asked for', () => {
    expect(scopeFor({ roles: ['platform_admin'] })).toBe('platform');
    expect(scopeFor({ practiceId: 'p1' })).toBe('organisation');
    expect(scopeFor({ practitionerId: 'dr1' })).toBe('practitioner');
    expect(scopeFor({ patientId: 'pat1' })).toBe('patient');
  });

  it('refuses rather than defaulting when it cannot tell', () => {
    // A report with no scope is everybody's. Better to show nothing.
    expect(() => scopeFor({})).toThrow(ReportingError);
  });

  it('lets only the platform group by organisation', () => {
    /*
     * Grouping a PRACTITIONER's totals by organisation would answer "which
     * practices does this person work at" — and answer it to whoever ran the
     * report. That is the directory the hard rules forbid, arriving as a
     * grouping option rather than a screen.
     */
    expect(mayGroupByOrganisation('platform')).toBe(true);
    expect(mayGroupByOrganisation('practitioner')).toBe(false);
    expect(mayGroupByOrganisation('organisation')).toBe(false);
    expect(mayGroupByOrganisation('patient')).toBe(false);
  });
});
