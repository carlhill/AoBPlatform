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
  matrix,
  packedQuery,
  packedReport,
} from '@aobplatform/domain';
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

      const query = packedQuery(report, breakdown);
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
  }, [report, breakdown]);

  useEffect(() => {
    void load();
  }, [load]);

  const dimensions = useMemo(
    () => PACKED_BREAKDOWNS.find((b) => b.key === breakdown)?.dimensions ?? [],
    [breakdown],
  );

  // The matrices need dates, so they are built from the daily rows Cube returns.
  const built = useMemo(() => {
    if (!rows || (report.shape !== 'matrix_week' && report.shape !== 'matrix_day')) return null;
    const counted = rows
      .map((r) => ({ at: timeOf(r), count: num(r, 'OutboundMessages.count') }))
      .filter((r): r is { at: string; count: number } => Boolean(r.at))
      .map((r) => ({ at: new Date(r.at), count: r.count }));
    return matrix(counted, report.shape === 'matrix_week' ? 'month_by_week' : 'month_by_day');
  }, [rows, report.shape]);

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
      {built && built.rows.length > 0 && (
        <div className={styles.tableScroll}>
          <table className={styles.totalsTable}>
            <thead>
              <tr>
                <th scope="col">{strings.report.month}</th>
                {built.columns.map((c) => (
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
              {built.rows.map((row) => (
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
                {built.columnTotals.map((t, i) => (
                  <td key={i} className={styles.stateCol}>
                    {t}
                  </td>
                ))}
                <td className={styles.totalCol}>{built.grandTotal}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <Notice title={strings.reports.moreTitle}>
        {strings.reports.moreBody}{' '}
        <a href={CUBE_URL} target="_blank" rel="noreferrer">
          <BarChart3 size={13} aria-hidden="true" /> {strings.reports.playground}
        </a>
      </Notice>
    </Shell>
  );
}
