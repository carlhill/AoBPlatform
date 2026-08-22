'use client';

/**
 * Queue totals — by practice, or by site and department.
 *
 * ONE COMPONENT FOR BOTH, because they are the same table with a different
 * first column. Two components would mean two places computing a row total,
 * and the first time they disagreed nobody would know which was right.
 *
 * WHY TOTALS ARE A DIFFERENT DISCLOSURE FROM THE ITEM LIST, and why this one
 * may cross practices while that one may not: these are COUNTS. Knowing a
 * practice sent 412 emails yesterday tells an operator whether the platform is
 * working. It tells them nothing about any patient, practitioner or consent
 * record. The item list carries names and message bodies, so it stays scoped
 * to one practice at a time.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Button, Notice, Shell, ui } from '../../ui';
import { SessionControl } from '../../SessionControl';
import { apiHeaders } from '../../auth';
import { strings } from '../../strings';
import { usePractice } from '../usePractice';
import { useLiveRefresh } from '../../useLiveRefresh';
import { ReportView } from './ReportView';
import styles from '../manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

interface Row {
  key: string;
  label: string;
  sublabel?: string | null;
  byType: Record<string, number>;
  byState: Record<string, number>;
  total: number;
}

interface Summary {
  rows: Row[];
  mediaTypes: string[];
  states: string[];
  grandTotal: number;
}

export function SummaryView({ groupBy }: { groupBy: 'org' | 'site' }) {
  const { practiceId, checked } = usePractice();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const path = groupBy === 'org' ? 'summary/by-org' : 'summary/by-site';
      const res = await fetch(`${CORE_URL}/outbound/${path}`, { headers: apiHeaders(practiceId ?? undefined) });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `That could not be read (${res.status}).`);
      }
      const body = await res.json();
      /*
       * Normalised into one row shape here, so the table below knows nothing
       * about which grouping it is rendering. The alternative — two branches
       * inside the table — is how the two views drift apart.
       */
      const rows: Row[] =
        groupBy === 'org'
          ? (body.practices ?? []).map((p: { practiceId: string; practiceName: string } & Row) => ({
              key: p.practiceId,
              label: p.practiceName,
              byType: p.byType,
              byState: p.byState,
              total: p.total,
            }))
          : (body.sites ?? []).map((s: { key: string; locationName: string | null; departmentName: string | null } & Row) => ({
              key: s.key,
              // A message with no site is not an error — an acting-as notice
              // goes to the practice itself. Named, so a blank does not read
              // as a bug.
              label: s.locationName ?? strings.summary.wholePractice,
              sublabel: s.departmentName,
              byType: s.byType,
              byState: s.byState,
              total: s.total,
            }));
      setSummary({ rows, mediaTypes: body.mediaTypes ?? [], states: body.states ?? [], grandTotal: body.grandTotal ?? 0 });
    } catch (e) {
      setError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    }
  }, [groupBy, practiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Totals move as the worker drains; a stale total is a wrong answer.
  useLiveRefresh(true, load, 30_000);

  if (!checked) return null;

  const title = groupBy === 'org' ? strings.summary.byOrgTitle : strings.summary.bySiteTitle;

  return (
    <Shell right={<SessionControl audience={strings.setup.audience} />}>
      <Link href="/practice/queue" className={ui.backLink} data-testid="summary-back">
        <ArrowLeft size={15} aria-hidden="true" />
        {strings.summary.backToQueue}
      </Link>
      <h1 className={ui.pageTitle}>{title}</h1>
      <p className={`${ui.pageLead} ${styles.queueLead}`}>
        {groupBy === 'org' ? strings.summary.byOrgLead : strings.summary.bySiteLead}
      </p>

      <div className={styles.queueSummary}>
        <span>
          {summary?.grandTotal ?? 0} {strings.summary.messages}
        </span>
        <Button variant="subtle" onClick={() => void load()} data-testid="summary-refresh">
          <RefreshCw size={14} aria-hidden="true" />
          {strings.queue.refresh}
        </Button>
      </div>

      {error && (
        <Notice tone="stop" title={strings.summary.notLoaded}>
          {error}
        </Notice>
      )}

      {summary && summary.rows.length === 0 && !error && (
        <Notice tone="ok" title={strings.queue.emptyTitle}>
          {strings.summary.emptyBody}
        </Notice>
      )}

      {summary && summary.rows.length > 0 && (
        <div className={styles.tableScroll}>
          <table className={styles.totalsTable}>
            <thead>
              <tr>
                <th scope="col">{groupBy === 'org' ? strings.summary.colOrg : strings.summary.colSite}</th>
                {summary.mediaTypes.map((t) => (
                  <th key={t} scope="col">
                    {t}
                  </th>
                ))}
                {/*
                  States after types, and separated, because they answer
                  different questions: what was sent, versus whether it got
                  there. Mixing them in one run of columns invites reading a
                  "failed" count as a type.
                */}
                {summary.states.map((st) => (
                  <th key={st} scope="col" className={styles.stateCol}>
                    {st}
                  </th>
                ))}
                <th scope="col">{strings.summary.colTotal}</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">
                    {row.label}
                    {row.sublabel && <span className={styles.queueSub}>{row.sublabel}</span>}
                  </th>
                  {summary.mediaTypes.map((t) => (
                    <td key={t}>{row.byType[t] ?? 0}</td>
                  ))}
                  {summary.states.map((st) => (
                    <td key={st} className={styles.stateCol}>
                      {/*
                        A zero is written as a dash. In a grid of counts the
                        eye is looking for the non-zero, and a field of noughts
                        hides it.
                      */}
                      {row.byState[st] ? row.byState[st] : '—'}
                    </td>
                  ))}
                  <td className={styles.totalCol}>{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        THE SAME NUMBERS, OVER TIME. The table above answers "who is sending
        how much"; this answers "is that growing, and when". Sharing a page
        because the second question is always the next one asked.
      */}
      <ReportView />
    </Shell>
  );
}
