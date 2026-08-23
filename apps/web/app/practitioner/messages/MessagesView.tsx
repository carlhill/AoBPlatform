'use client';

/**
 * What has been sent to this practitioner, wherever they work.
 *
 * WHY A PAGE RATHER THAN A LINK TO THE PLAYGROUND. The card used to open Cube's
 * report builder, which is an analyst's tool — panels for measures, dimensions
 * and granularity, and an empty result until you compose something. Somebody
 * asking "what have you sent me" has already asked their question, and handing
 * them a blank query builder offers them a job instead of an answer. The
 * builder stays on the platform reports screen, where the reader is somebody
 * who wants to compose questions.
 *
 * THEIR OWN, ENFORCED BY THE DATABASE. This queries the `MyMessages` cube under
 * a credential whose connection is pinned to their practitioner id, against an
 * RLS policy keyed on it. The screen filters nothing — it could not widen the
 * result if it tried.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Button, Notice, Shell, ui } from '../../ui';
import { SessionControl } from '../../SessionControl';
import { currentSession } from '../../auth';
import { strings } from '../../strings';
import styles from '../../practice/manage.module.css';

const CUBE_URL = process.env.NEXT_PUBLIC_CUBE_URL ?? 'http://localhost:21030';

type Row = Record<string, string | number | null>;

/**
 * One row per month per practice, and both dimensions earn their place: a
 * practitioner working at two practices wants to know which is writing to them,
 * and "when" is the other half of every question about a message.
 */
const QUERY = {
  measures: ['MyMessages.count', 'MyMessages.sent', 'MyMessages.waiting'],
  dimensions: ['MyMessages.practice'],
  timeDimensions: [
    { dimension: 'MyMessages.occurredAt', granularity: 'month', dateRange: 'from 2 years ago to now' },
  ],
  order: { 'MyMessages.occurredAt': 'desc' },
};

function num(row: Row, key: string): number {
  const value = row[key];
  return typeof value === 'number' ? value : Number(value ?? 0);
}

export function MessagesView() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = currentSession()?.accessToken;
      if (!token) throw new Error(strings.myMessages.noSession);

      const res = await fetch(`${CUBE_URL}/cubejs-api/v1/load?query=${encodeURIComponent(JSON.stringify(QUERY))}`, {
        headers: { Authorization: token },
      });
      const body = (await res.json().catch(() => ({}))) as { data?: Row[]; error?: string };

      /*
       * Cube answers 200 with an `error` field for a refused query, so checking
       * the status alone would render a refusal as "nothing has been sent to
       * you" — which is a claim about us, and would be false.
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    if (!rows) return null;
    return {
      count: rows.reduce((s, r) => s + num(r, 'MyMessages.count'), 0),
      sent: rows.reduce((s, r) => s + num(r, 'MyMessages.sent'), 0),
      waiting: rows.reduce((s, r) => s + num(r, 'MyMessages.waiting'), 0),
    };
  }, [rows]);

  if (!currentSession()) {
    return (
      <Shell right={<SessionControl audience={strings.practitioner.audience} />}>
        <h1 className={ui.pageTitle}>{strings.myMessages.title}</h1>
        <Notice tone="warn" title={strings.practitioner.signedOutTitle}>
          {strings.practitioner.signedOutBody}
        </Notice>
      </Shell>
    );
  }

  return (
    <Shell right={<SessionControl audience={strings.practitioner.audience} />}>
      <Link href="/practitioner" className={ui.backLink} data-testid="messages-back">
        <ArrowLeft size={15} aria-hidden="true" />
        {strings.myAffiliations.back}
      </Link>
      <h1 className={ui.pageTitle}>{strings.myMessages.title}</h1>
      <p className={ui.pageLead}>{strings.myMessages.lead}</p>

      <div className={ui.rowActions}>
        {totals && (
          <span className={ui.hint}>
            {strings.myMessages.totals
              .replace('{count}', String(totals.count))
              .replace('{sent}', String(totals.sent))
              .replace('{waiting}', String(totals.waiting))}
          </span>
        )}
        <Button variant="subtle" onClick={() => void load()} disabled={busy} data-testid="messages-refresh">
          <RefreshCw size={14} aria-hidden="true" />
          {strings.queue.refresh}
        </Button>
      </div>

      {error && (
        <Notice tone="stop" title={strings.myMessages.failed}>
          {error}
        </Notice>
      )}

      {rows && rows.length === 0 && !error && (
        <Notice title={strings.myMessages.emptyTitle}>{strings.myMessages.emptyBody}</Notice>
      )}

      {rows && rows.length > 0 && (
        <div className={styles.tableScroll}>
          <table className={styles.totalsTable}>
            <thead>
              <tr>
                <th scope="col">{strings.myMessages.month}</th>
                <th scope="col">{strings.myMessages.practice}</th>
                <th scope="col" className={styles.stateCol}>
                  {strings.myMessages.sent}
                </th>
                <th scope="col" className={styles.stateCol}>
                  {strings.myMessages.waiting}
                </th>
                <th scope="col" className={styles.totalCol}>
                  {strings.myMessages.total}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <th scope="row">{String(r['MyMessages.occurredAt.month'] ?? '').slice(0, 7)}</th>
                  <td>{r['MyMessages.practice'] ?? strings.practitioner.unnamedPractice}</td>
                  <td className={styles.stateCol}>{num(r, 'MyMessages.sent')}</td>
                  <td className={styles.stateCol}>{num(r, 'MyMessages.waiting')}</td>
                  <td className={styles.totalCol}>{num(r, 'MyMessages.count')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
