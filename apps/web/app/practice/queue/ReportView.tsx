'use client';

/**
 * How much was sent, over time.
 *
 * FIVE GRAINS AND TWO MATRICES, because they answer different questions. A
 * running total says how big this is; per-month says whether it is growing; and
 * the matrices answer the one a total never can — "is this month worse than
 * last, or is it just further through?"
 *
 * The columns of a matrix are positions WITHIN the month, 1..5 or 1..31, not
 * calendar weeks. A table of ISO week numbers compares nothing, because week 31
 * belongs to exactly one month and every row would have values in a different
 * set of columns. Numbering within the month puts comparable cells above each
 * other, which is the only reason to draw the table at all.
 *
 * WHOSE FIGURES THESE ARE IS NOT A CONTROL HERE. The server reads it off the
 * caller's own token and refuses if it cannot tell, so there is nothing on this
 * screen to switch. That is why there is no "scope" selector: it would suggest
 * a choice that does not exist.
 */

import { useCallback, useEffect, useState } from 'react';
import { CalendarRange, RefreshCw } from 'lucide-react';
import { Button, Field, Notice, SelectInput, ui } from '../../ui';
import { apiHeaders } from '../../auth';
import { strings } from '../../strings';
import styles from '../manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

type MatrixShape = {
  columns: number[];
  rows: { key: string; label: string; cells: (number | null)[]; total: number }[];
  columnTotals: number[];
  grandTotal: number;
};

type Report = {
  scope: string;
  grain: string;
  timezone: string;
  from: string;
  to: string;
  capped: boolean;
  maxYears: number;
  total: number;
  series: { key: string; count: number }[];
  matrices: { month_by_week: MatrixShape; month_by_day: MatrixShape };
  grains: { key: string; label: string; detail: string }[];
  matrixKinds: { key: string; label: string; detail: string }[];
};

export function ReportView({ practiceId, locationId, departmentId }: {
  practiceId?: string;
  locationId?: string;
  departmentId?: string;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [grain, setGrain] = useState('month');
  const [shown, setShown] = useState<'series' | 'month_by_week' | 'month_by_day'>('series');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const q = new URLSearchParams({ grain });
      if (practiceId) q.set('practiceId', practiceId);
      if (locationId) q.set('locationId', locationId);
      if (departmentId) q.set('departmentId', departmentId);

      const res = await fetch(`${CORE_URL}/outbound/report?${q}`, { headers: apiHeaders(practiceId) });
      const body = (await res.json().catch(() => ({}))) as Report & { message?: string };
      if (!res.ok) throw new Error(body.message ?? `That could not be read (${res.status}).`);
      setReport(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [grain, practiceId, locationId, departmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const matrix = shown === 'series' ? null : report?.matrices[shown];

  return (
    <section className={styles.applicationSection}>
      <h2 className={styles.applicationHeading}>{strings.report.title}</h2>
      <p className={ui.hint}>{strings.report.lead}</p>

      <div className={styles.applicationFields}>
        <Field label={strings.report.grain} hint={strings.report.grainHint}>
          {(props) => (
            <SelectInput
              {...props}
              value={shown === 'series' ? grain : shown}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'month_by_week' || v === 'month_by_day') {
                  setShown(v);
                } else {
                  setShown('series');
                  setGrain(v);
                }
              }}
              data-testid="report-grain"
            >
              {(report?.grains ?? []).map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
              {(report?.matrixKinds ?? []).map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
      </div>

      <div className={ui.rowActions}>
        <span className={ui.hint}>
          <CalendarRange size={13} aria-hidden="true" />{' '}
          {report
            ? strings.report.window
                .replace('{from}', report.from.slice(0, 10))
                .replace('{to}', report.to.slice(0, 10))
                .replace('{tz}', report.timezone)
                .replace('{total}', String(report.total))
            : strings.report.loading}
        </span>
        <Button variant="subtle" onClick={() => void load()} disabled={busy} data-testid="report-refresh">
          <RefreshCw size={14} aria-hidden="true" />
          {strings.queue.refresh}
        </Button>
      </div>

      {/*
        Said out loud rather than left for somebody to notice. A truncated
        report that looks complete is worse than one that says it was cut.
      */}
      {report?.capped && (
        <Notice tone="warn" title={strings.report.cappedTitle}>
          {strings.report.cappedBody.replace('{n}', String(report.maxYears))}
        </Notice>
      )}

      {error && (
        <Notice tone="stop" title={strings.report.failed}>
          {error}
        </Notice>
      )}

      {report && !error && report.total === 0 && (
        <Notice title={strings.report.emptyTitle}>{strings.report.emptyBody}</Notice>
      )}

      {/* The plain series: one bucket per row, oldest first. */}
      {shown === 'series' && report && report.total > 0 && (
        <div className={styles.tableScroll}>
          <table className={styles.totalsTable}>
            <thead>
              <tr>
                <th scope="col">{strings.report.period}</th>
                <th scope="col" className={styles.totalCol}>
                  {strings.report.count}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.series.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.key === 'all' ? strings.report.everything : row.key}</th>
                  <td className={styles.totalCol}>{row.count}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{strings.report.total}</th>
                <td className={styles.totalCol}>{report.total}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/*
        The matrix. A cell is EMPTY rather than 0 where the day does not exist
        in that month — 31 February, or a fifth week in a short one. Zero would
        read as "nothing was sent", which is a different statement, and the
        difference matters to somebody looking for a gap.
      */}
      {matrix && (
        <div className={styles.tableScroll}>
          <table className={styles.totalsTable}>
            <thead>
              <tr>
                <th scope="col">{strings.report.month}</th>
                {matrix.columns.map((c) => (
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
              {matrix.rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  {row.cells.map((cell, i) => (
                    <td key={i} className={styles.stateCol} aria-label={cell === null ? strings.report.noSuchDay : undefined}>
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
                {matrix.columnTotals.map((t, i) => (
                  <td key={i} className={styles.stateCol}>
                    {t}
                  </td>
                ))}
                <td className={styles.totalCol}>{matrix.grandTotal}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
