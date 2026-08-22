'use client';

/**
 * The packaged reports, answered by Cube.
 *
 * TALKS TO CUBE DIRECTLY, carrying the same Keycloak token as everything else.
 * Proxying through our own API would put an endpoint in front of a query engine
 * whose whole value is answering questions nobody wrote an endpoint for — which
 * is the situation Cube was adopted to end.
 *
 * THERE IS NO SCOPE CONTROL ON THIS PAGE, and that is not an omission. Whose
 * figures these are comes off a signed claim in the token; Cube adds the filter
 * and the database refuses anything wider. A control here would imply a choice
 * that does not exist, and the first thing anybody would do is try to widen it.
 *
 * THE TWO MATRICES ARE RESHAPED HERE rather than asked for. "Week 3 of its own
 * month" is not a calendar unit — Cube groups by calendar week, which puts week
 * 31 in exactly one month and leaves every row of the table in a different set
 * of columns, comparing nothing. So they fetch daily rows and go through the
 * same `matrix()` the API uses, which is why the two agree.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BarChart3, RefreshCw } from 'lucide-react';
import {
  PACKED_BREAKDOWNS,
  PACKED_REPORTS,
  type PackedBreakdown,
  type PlaceFilter,
  matrix,
  packedQuery,
  packedReport,
  placeOptionsQuery,
} from '@aobplatform/domain';
import { BarChart, type Bar } from './BarChart';
import { Button, Field, Notice, SelectInput, Shell, ui } from '../../ui';
import { SessionControl } from '../../SessionControl';
import { currentSession } from '../../auth';
import { strings } from '../../strings';
import styles from '../manage.module.css';

const CUBE_URL = process.env.NEXT_PUBLIC_CUBE_URL ?? 'http://localhost:21030';

const MEASURES = [
  { key: 'OutboundMessages.count', label: 'Messages' },
  { key: 'OutboundMessages.sent', label: 'Sent' },
  { key: 'OutboundMessages.failed', label: 'Failed' },
];

const TIME_KEYS = ['OutboundMessages.occurredAt', 'OutboundMessages.occurredAt.day'];

type Row = Record<string, string | number | null>;

function timeOf(row: Row): string | null {
  for (const key of TIME_KEYS) {
    const value = row[key];
    if (typeof value === 'string') return value;
  }
  return null;
}

function num(row: Row, key: string): number {
  const value = row[key];
  return typeof value === 'number' ? value : Number(value ?? 0);
}

export function ReportsView() {
  const [reportKey, setReportKey] = useState('month');
  const [breakdown, setBreakdown] = useState<PackedBreakdown>('none');
  const [place, setPlace] = useState<PlaceFilter>({});
  const [places, setPlaces] = useState<Row[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const report = packedReport(reportKey) ?? PACKED_REPORTS[2];

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = currentSession()?.accessToken;
      if (!token) throw new Error(strings.reports.noSession);

      const query = packedQuery(report, breakdown, place);
      const res = await fetch(`${CUBE_URL}/cubejs-api/v1/load?query=${encodeURIComponent(JSON.stringify(query))}`, {
        headers: { Authorization: token },
      });
      const body = (await res.json().catch(() => ({}))) as { data?: Row[]; error?: string };

      /*
       * Cube answers 200 with an `error` field for a refused query, so checking
       * the status alone would render a refusal as an empty report — and an
       * empty report reads as "you have sent nothing", which is a claim.
       */
      if (body.error) throw new Error(String(body.error));
      if (!res.ok) throw new Error(`That could not be read (${res.status}).`);

      setRows(body.data ?? []);
    } catch (e) {
      setError((e as Error).message);
      setRows(null);
    } finally {
      setBusy(false);
    }
  }, [report, breakdown, place]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * The values to choose between, asked ONCE and not per report. A dropdown
   * whose options changed when you switched report would be unusable — and
   * these are the same places whichever question is being asked.
   */
  useEffect(() => {
    const token = currentSession()?.accessToken;
    if (!token) return;
    fetch(`${CUBE_URL}/cubejs-api/v1/load?query=${encodeURIComponent(JSON.stringify(placeOptionsQuery()))}`, {
      headers: { Authorization: token },
    })
      .then((r) => r.json())
      .then((b: { data?: Row[] }) => setPlaces(b.data ?? []))
      .catch(() => setPlaces([]));
  }, []);

  /*
   * CASCADING, because a department only means anything inside its site.
   * Offering every department at every site would let somebody pick a pair
   * that never occurs together and get an empty report that looks like an
   * absence of messages rather than an impossible question.
   */
  const orgOptions = useMemo(
    () => [...new Set(places.map((p) => p['OutboundMessages.organisation'] as string).filter(Boolean))].sort(),
    [places],
  );
  const siteOptions = useMemo(
    () =>
      [
        ...new Set(
          places
            .filter((p) => !place.organisation || p['OutboundMessages.organisation'] === place.organisation)
            .map((p) => p['OutboundMessages.site'] as string)
            .filter(Boolean),
        ),
      ].sort(),
    [places, place.organisation],
  );
  const deptOptions = useMemo(
    () =>
      [
        ...new Set(
          places
            .filter((p) => !place.organisation || p['OutboundMessages.organisation'] === place.organisation)
            .filter((p) => !place.site || p['OutboundMessages.site'] === place.site)
            .map((p) => p['OutboundMessages.department'] as string)
            .filter(Boolean),
        ),
      ].sort(),
    [places, place.organisation, place.site],
  );

  const dimensions = useMemo(
    () => PACKED_BREAKDOWNS.find((b) => b.key === breakdown)?.dimensions ?? [],
    [breakdown],
  );

  /*
   * ONE MATRIX PER GROUP, which is the bug this replaced. The previous version
   * poured every row into a single matrix and threw the dimensions away — so
   * choosing "by site and department" changed the query, changed nothing on
   * screen, and looked like the control did not work.
   */
  const built = useMemo(() => {
    if (!rows || (report.shape !== 'matrix_week' && report.shape !== 'matrix_day')) return null;
    const kind = report.shape === 'matrix_week' ? 'month_by_week' : 'month_by_day';

    const groups = new Map<string, { heading: string; counted: { at: Date; count: number }[] }>();
    for (const row of rows) {
      const at = timeOf(row);
      if (!at) continue;

      // Org › Site › Department, with the empty parts said in words: a message
      // addressed to the practice itself genuinely has no site.
      const parts = dimensions.map((d) => (row[d] as string) || strings.reports.none);
      const key = parts.join(' › ') || strings.reports.everything;

      const group = groups.get(key) ?? { heading: key, counted: [] };
      group.counted.push({ at: new Date(at), count: num(row, 'OutboundMessages.count') });
      groups.set(key, group);
    }

    return [...groups.values()]
      .map((g) => ({ heading: g.heading, matrix: matrix(g.counted, kind) }))
      .sort((a, b) => a.heading.localeCompare(b.heading));
  }, [rows, report.shape, dimensions]);

  /*
   * THE SAME ROWS THE TABLE IS BUILT FROM. A chart that fetched its own data is
   * a chart that can disagree with the numbers beside it, and the reader has no
   * way to tell which one is wrong.
   */
  const bars = useMemo<Bar[]>(() => {
    if (!rows || rows.length === 0) return [];

    if (built) {
      // For a matrix, one bar per month across every group — the chart answers
      // "how is this trending", which the grouped tables do not.
      const perMonth = new Map<string, number>();
      for (const group of built) {
        for (const row of group.matrix.rows) {
          perMonth.set(row.label, (perMonth.get(row.label) ?? 0) + row.total);
        }
      }
      return [...perMonth.entries()].map(([label, value]) => ({ label, value }));
    }

    if (report.shape === 'total') return [];

    const perPeriod = new Map<string, number>();
    for (const row of rows) {
      const at = (timeOf(row) ?? '').slice(0, 10);
      if (!at) continue;
      perPeriod.set(at, (perPeriod.get(at) ?? 0) + num(row, 'OutboundMessages.count'));
    }
    return [...perPeriod.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value }));
  }, [rows, built, report.shape]);

  const totals = useMemo(() => {
    if (!rows) return null;
    return MEASURES.map((m) => ({ ...m, value: rows.reduce((sum, r) => sum + num(r, m.key), 0) }));
  }, [rows]);

  return (
    <Shell right={<SessionControl audience={strings.setup.audience} />}>
      <Link href="/practice/queue" className={ui.backLink} data-testid="reports-back">
        <ArrowLeft size={15} aria-hidden="true" />
        {strings.queue.back}
      </Link>

      <h1 className={ui.pageTitle}>{strings.reports.title}</h1>
      <p className={`${ui.pageLead} ${styles.queueLead}`}>{strings.reports.lead}</p>

      <div className={styles.applicationFields}>
        <Field label={strings.reports.report} hint={report.detail}>
          {(props) => (
            <SelectInput
              {...props}
              value={reportKey}
              onChange={(e) => setReportKey(e.target.value)}
              data-testid="packed-report"
            >
              {PACKED_REPORTS.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>

        <Field label={strings.reports.breakdown} hint={strings.reports.breakdownHint}>
          {(props) => (
            <SelectInput
              {...props}
              value={breakdown}
              onChange={(e) => setBreakdown(e.target.value as PackedBreakdown)}
              data-testid="packed-breakdown"
            >
              {PACKED_BREAKDOWNS.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
      </div>

      {/*
        NARROWING TO ONE PLACE, which is a different question from breaking down
        BY place — "what did Yagoona do in March" rather than "how do my sites
        compare". Cascading, because choosing a department that never occurs at
        the chosen site would give an empty report that reads as an absence of
        messages rather than an impossible question.
      */}
      <div className={styles.applicationFields}>
        <Field label={strings.reports.organisation} hint={strings.reports.placeHint}>
          {(props) => (
            <SelectInput
              {...props}
              value={place.organisation ?? ''}
              onChange={(e) => setPlace({ organisation: e.target.value || undefined })}
              data-testid="place-org"
            >
              <option value="">{strings.reports.allOrganisations}</option>
              {orgOptions.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>

        <Field label={strings.reports.site}>
          {(props) => (
            <SelectInput
              {...props}
              value={place.site ?? ''}
              onChange={(e) => setPlace((p) => ({ ...p, site: e.target.value || undefined, department: undefined }))}
              data-testid="place-site"
            >
              <option value="">{strings.reports.allSites}</option>
              {siteOptions.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>

        <Field label={strings.reports.department}>
          {(props) => (
            <SelectInput
              {...props}
              value={place.department ?? ''}
              onChange={(e) => setPlace((p) => ({ ...p, department: e.target.value || undefined }))}
              data-testid="place-dept"
            >
              <option value="">{strings.reports.allDepartments}</option>
              {deptOptions.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
      </div>

      <div className={ui.rowActions}>
        <Button variant="subtle" onClick={() => void load()} disabled={busy} data-testid="reports-refresh">
          <RefreshCw size={14} aria-hidden="true" />
          {busy ? strings.reports.reading : strings.queue.refresh}
        </Button>
        <span className={ui.hint}>{strings.reports.window}</span>
      </div>

      {error && (
        <Notice tone="stop" title={strings.reports.failed}>
          {error}
        </Notice>
      )}

      {rows && rows.length === 0 && !error && (
        <Notice title={strings.reports.emptyTitle}>{strings.reports.emptyBody}</Notice>
      )}

      {/* The headline numbers, which every shape has. */}
      {totals && rows && rows.length > 0 && (
        <div className={styles.queueSummary}>
          {totals.map((t) => (
            <span key={t.key} className={styles.summaryStat}>
              <strong>{t.value}</strong> {t.label}
            </span>
          ))}
        </div>
      )}

      {/* A single number, and nothing pretending to be a trend. */}
      {report.shape === 'total' && rows && rows.length > 0 && (
        <Notice title={strings.reports.totalTitle}>{strings.reports.totalBody}</Notice>
      )}

      {report.shape === 'series' && rows && rows.length > 0 && (
        <div className={styles.tableScroll}>
          <table className={styles.totalsTable}>
            <thead>
              <tr>
                <th scope="col">{strings.report.period}</th>
                {dimensions.map((d) => (
                  <th key={d} scope="col">
                    {d.split('.').pop()}
                  </th>
                ))}
                {MEASURES.map((m) => (
                  <th key={m.key} scope="col" className={styles.stateCol}>
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <th scope="row">{(timeOf(row) ?? '').slice(0, 10)}</th>
                  {dimensions.map((d) => (
                    // An empty dimension is a real answer -- a message addressed
                    // to the practice itself has no site -- so it is said in
                    // words rather than left blank.
                    <td key={d}>{(row[d] as string) || <span className={ui.hint}>{strings.reports.none}</span>}</td>
                  ))}
                  {MEASURES.map((m) => (
                    <td key={m.key} className={styles.stateCol}>
                      {num(row, m.key)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        A cell is EMPTY rather than 0 where the day does not exist in that month
        -- 31 February, or a fifth week in a short one. Zero says nothing was
        sent; empty says there was no such day, and the difference matters to
        anybody hunting a gap.
      */}
      {/*
        ONE TABLE PER GROUP, headed Org › Site › Department. Stacked rather than
        nested into a single table because a matrix already uses both axes —
        months down, weeks across — so a third dimension has nowhere to go
        except a repeat of the table.
      */}
      {built &&
        built.map((group) => (
          <div key={group.heading}>
            {dimensions.length > 0 && <h2 className={styles.applicationHeading}>{group.heading}</h2>}
            <div className={styles.tableScroll}>
              <table className={styles.totalsTable}>
                <thead>
                  <tr>
                    <th scope="col">{strings.report.month}</th>
                    {group.matrix.columns.map((c) => (
                      <th key={c} scope="col" className={styles.stateCol}>
                        {c}
                      </th>
                    ))}
                    <th scope="col" className={styles.totalCol}>
                      {strings.report.total}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {group.matrix.rows.map((row) => (
                    <tr key={row.key}>
                      <th scope="row">{row.label}</th>
                      {row.cells.map((cell, i) => (
                        <td key={i} className={styles.stateCol}>
                          {cell === null ? '' : cell}
                        </td>
                      ))}
                      <td className={styles.totalCol}>{row.total}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">{strings.report.total}</th>
                    {group.matrix.columnTotals.map((t, i) => (
                      <td key={i} className={styles.stateCol}>
                        {t}
                      </td>
                    ))}
                    <td className={styles.totalCol}>{group.matrix.grandTotal}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))}

      {/* Below the table, deliberately: the numbers are the answer and the
          chart is the shape of them. */}
      {bars.length > 0 && <BarChart bars={bars} caption={strings.reports.chartCaption} />}

      <Notice title={strings.reports.moreTitle}>
        {strings.reports.moreBody}{' '}
        <a href={CUBE_URL} target="_blank" rel="noreferrer">
          <BarChart3 size={13} aria-hidden="true" /> {strings.reports.playground}
        </a>
      </Notice>
    </Shell>
  );
}
