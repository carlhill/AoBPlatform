'use client';

/**
 * Every acting-as session there has ever been.
 *
 * SEPARATE FROM THE REGISTER, and the split is the point. `/platform/acting-as`
 * answers "who is doing this right now, and should they be" — a page you open
 * because something is happening. This answers "who has ever done this, to
 * whom, and why" — a page you open because something happened, possibly months
 * ago, and somebody is asking about it.
 *
 * Those are different jobs and they want different shapes. The register is
 * short, loud and refreshes itself; this is long, searchable, and quiet.
 *
 * WHAT IT LINKS TO. A session names a practice, so the practice is where the
 * link goes. It does NOT claim to list the individual acts performed — those
 * are recorded in the vault against that practice, each with its own actor and
 * timestamp, and inventing a "pages visited" list here would be a weaker record
 * pretending to be a stronger one.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, ShieldAlert, UserCheck, X } from 'lucide-react';
import { Button, Chip, Field, Notice, Shell, TextInput, ui } from '../../../ui';
import { SessionControl } from '../../../SessionControl';
import { apiHeaders } from '../../../auth';
import { useRefreshable } from '../../../refresh';
import { strings } from '../../../strings';
import styles from '../../../practice/manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

type Row = {
  id: string;
  practiceId: string;
  practiceName: string | null;
  operatorName: string;
  reason: string;
  reasonLabel: string;
  note: string | null;
  startedAt: string;
  endedAt: string | null;
  endedHow: string | null;
  expiresAt: string | null;
  live: boolean;
  forcedReapproval: boolean;
};

function when(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function ActingAsHistory() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/acting-as`, { headers: apiHeaders() });
      const body = (await res.json().catch(() => ({}))) as { sessions?: Row[]; message?: string };
      if (!res.ok) throw new Error(body.message ?? `That could not be read (${res.status}).`);
      setRows(body.sessions ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * REGISTERED WITH THE TOP-BAR REFRESH. The token is held in memory only, so
   * a browser reload throws the session away and asks for a passkey again --
   * this is the way to re-read without paying that.
   */
  useRefreshable(load);

  /*
   * SEARCHED OVER EVERYTHING SHOWN, because the question that brings somebody
   * here is never predictable. "What did Sam do in March", "has anybody ever
   * acted as this practice", "who used the lockout reason" — one box over
   * operator, practice, reason and note answers all three, and three separate
   * filters would answer each of them slightly worse.
   */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !rows) return rows ?? [];
    return rows.filter((r) =>
      [r.operatorName, r.practiceName ?? r.practiceId, r.reasonLabel, r.note ?? '', r.endedHow ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query]);

  return (
    <Shell right={<SessionControl audience={strings.actingAsHistory.audience} />}>
      <h1 className={ui.pageTitle}>{strings.actingAsHistory.title}</h1>
      <p className={ui.pageLead}>{strings.actingAsHistory.lead}</p>

      {error && (
        <Notice tone="stop" title={strings.actingAsHistory.notLoaded}>
          {error}
        </Notice>
      )}

      <Field label={strings.actingAsHistory.search} hint={strings.actingAsHistory.searchHint}>
        {(props) => (
          <TextInput
            {...props}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={strings.actingAsHistory.searchPlaceholder}
            data-testid="history-search"
          />
        )}
      </Field>

      {rows === null && <p className={ui.hint}>{strings.actingAsHistory.loading}</p>}

      {rows !== null && (
        <p className={ui.hint}>
          {shown.length === rows.length
            ? strings.actingAsHistory.count.replace('{n}', String(rows.length))
            : strings.actingAsHistory.countFiltered
                .replace('{shown}', String(shown.length))
                .replace('{total}', String(rows.length))}
        </p>
      )}

      {rows !== null && shown.length === 0 && <p className={styles.cardNote}>{strings.actingAsHistory.none}</p>}

      <div className={styles.tableScroll}>
        <table className={styles.totalsTable}>
          <thead>
            <tr>
              <th scope="col">{strings.actingAsHistory.started}</th>
              <th scope="col">{strings.actingAsHistory.operator}</th>
              <th scope="col">{strings.actingAsHistory.practice}</th>
              <th scope="col">{strings.actingAsHistory.reason}</th>
              <th scope="col">{strings.actingAsHistory.ended}</th>
              <th scope="col">{strings.actingAsHistory.outcome}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} data-testid={`history-${r.id}`}>
                <th scope="row">{when(r.startedAt)}</th>
                <td>{r.operatorName}</td>
                <td>
                  {/*
                    THE RECORD THAT WAS ACTED ON. A session names a practice, so
                    the practice is where this goes. What was DONE during it is
                    in that practice's vault trail, each act with its own actor
                    and time — listing "pages visited" here would be a weaker
                    record wearing the clothes of a stronger one.
                  */}
                  <Link href={`/practice/entity?practiceId=${r.practiceId}`} data-testid={`history-practice-${r.id}`}>
                    {r.practiceName ?? r.practiceId}
                  </Link>
                </td>
                <td>
                  {r.reasonLabel}
                  {r.note ? <span className={ui.hint}> · {r.note}</span> : null}
                </td>
                <td>{r.live ? <Chip tone="warn">{strings.actingAsHistory.stillOpen}</Chip> : when(r.endedAt)}</td>
                <td>
                  {r.endedHow ? r.endedHow.replace(/_/g, ' ') : r.live ? '—' : strings.actingAsHistory.expired}
                  {r.forcedReapproval && (
                    <>
                      {' '}
                      <Chip tone="warn">
                        <ShieldAlert size={13} aria-hidden="true" />
                        {strings.actingAsHistory.reapproval}
                      </Chip>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Notice tone="warn" title={strings.actingAsHistory.trailTitle}>
        {strings.actingAsHistory.trailBody}
      </Notice>

      <div className={ui.rowActions}>
        <Link href="/platform/acting-as" className={ui.buttonLink} data-testid="history-to-register">
          <UserCheck size={14} aria-hidden="true" />
          {strings.actingAsHistory.toRegister}
        </Link>
        <Button variant="subtle" onClick={() => void load()} data-testid="history-refresh">
          <RefreshCw size={14} aria-hidden="true" />
          {strings.queue.refresh}
        </Button>
        {query && (
          <Button variant="subtle" onClick={() => setQuery('')} data-testid="history-clear">
            <X size={14} aria-hidden="true" />
            {strings.actingAsHistory.clear}
          </Button>
        )}
      </div>
    </Shell>
  );
}
