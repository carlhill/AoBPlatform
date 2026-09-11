'use client';

/**
 * Who is acting as which practice, and the way to stop it.
 *
 * WHY A REGISTER AT ALL, given that every session already expires by the clock.
 *
 * Expiry answers "can one be left open forever" — no, and it answers it without
 * a background job, which matters more than it sounds: a sweep that has silently
 * stopped running looks exactly like a period in which nobody left a session
 * open. `isSessionLive` computes it on every read, so there is nothing to fail.
 *
 * What expiry does NOT answer is "who is doing this right now, and should they
 * be". That is a question somebody has to be able to ask, and until this page
 * existed the answer lived only in a table. A session running for a good reason
 * and a session running for a bad one look identical from the outside; the point
 * of a register is that somebody can look.
 *
 * AND STOP ONE EARLY. Without that, noticing a session you do not like leaves
 * you waiting up to the cap. The stop is recorded against whoever pressed it,
 * because ending another operator's session is itself worth being able to
 * question later.
 *
 * THE REAPPROVAL IT FORCED IS NOT UNDONE. Acting as a practice makes that
 * practice need approving again, by somebody other than the operator who acted.
 * Stopping the session early does not withdraw that — the acts were performed,
 * and whether the session ended tidily has nothing to do with whether they need
 * looking at.
 */

import { useCallback, useEffect, useState } from 'react';
import { UserCheck, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button, Chip, Notice, Shell, ui } from '../../ui';
import { SessionControl } from '../../SessionControl';
import { apiHeaders } from '../../auth';
import { forgetActingAs } from '../../effectivePractice';
import { useRefreshable } from '../../refresh';
import { strings } from '../../strings';
import styles from '../../practice/manage.module.css';

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

export function ActingAsRegister() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [maxMinutes, setMaxMinutes] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stopped, setStopped] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/acting-as`, { headers: apiHeaders() });
      const body = (await res.json().catch(() => ({}))) as {
        sessions?: Row[];
        maxMinutes?: number;
        message?: string;
      };
      if (!res.ok) throw new Error(body.message ?? `That could not be read (${res.status}).`);
      setRows(body.sessions ?? []);
      if (typeof body.maxMinutes === 'number') setMaxMinutes(body.maxMinutes);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Registered with the top-bar refresh; see refresh.ts.
  useRefreshable(load);

  useEffect(() => {
    void load();
    /*
     * REFRESHED WHILE THE PAGE IS OPEN. A register of what is happening NOW is
     * wrong the moment it is a minute old, and somebody watching a session they
     * are unhappy about should see it end without pressing anything.
     */
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  async function stop(id: string) {
    setBusy(id);
    setError(null);
    setStopped(null);
    try {
      const res = await fetch(`${CORE_URL}/acting-as/${id}/end`, { method: 'POST', headers: apiHeaders() });
      const body = (await res.json().catch(() => ({}))) as { message?: string; detail?: string };
      if (!res.ok) throw new Error(body.message ?? `That could not be stopped (${res.status}).`);
      // The reader may be the operator whose session this was, so the console's
      // own idea of its scope is now stale.
      forgetActingAs();
      setStopped(body.detail ?? strings.actingAsRegister.stopped);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const open = (rows ?? []).filter((r) => r.live);
  const past = (rows ?? []).filter((r) => !r.live);

  return (
    <Shell right={<SessionControl audience={strings.actingAsRegister.audience} />}
      title={strings.actingAsRegister.title}
      lead={strings.actingAsRegister.lead}
    >

      {error && (
        <Notice tone="stop" title={strings.actingAsRegister.notLoaded}>
          {error}
        </Notice>
      )}
      {stopped && <Notice tone="ok" title={strings.actingAsRegister.stop}>{stopped}</Notice>}

      <Notice tone="warn" title={strings.actingAsRegister.openHeading}>
        {strings.actingAsRegister.capNote.replace('{n}', String(maxMinutes))}
      </Notice>

      {rows === null && <p className={ui.hint}>{strings.actingAsRegister.loading}</p>}

      {rows !== null && open.length === 0 && <p className={styles.cardNote}>{strings.actingAsRegister.nobody}</p>}

      {open.map((r) => (
        <section key={r.id} className={styles.card} data-testid={`acting-as-${r.id}`}>
          <div className={ui.rowActions}>
            <Chip tone="warn">
              <UserCheck size={13} aria-hidden="true" />
              {strings.actingAsRegister.openHeading}
            </Chip>
            {r.forcedReapproval && (
              <Chip tone="warn">
                <ShieldAlert size={13} aria-hidden="true" />
                {strings.actingAsRegister.reapproval}
              </Chip>
            )}
          </div>

          <p className={styles.cardNote}>
            <strong>{r.operatorName}</strong> — {strings.actingAsRegister.practice}:{' '}
            <strong>{r.practiceName ?? r.practiceId}</strong>
          </p>
          <p className={ui.hint}>
            {strings.actingAsRegister.reason}: {r.reasonLabel}
            {r.note ? ` · ${strings.actingAsRegister.note}: ${r.note}` : ''}
          </p>
          <p className={ui.hint}>
            {strings.actingAsRegister.started}: {when(r.startedAt)} · {strings.actingAsRegister.ends}:{' '}
            {when(r.expiresAt)}
          </p>

          <Button
            variant="primary"
            onClick={() => void stop(r.id)}
            disabled={busy === r.id}
            data-testid={`stop-${r.id}`}
          >
            {busy === r.id ? strings.actingAsRegister.stopping : strings.actingAsRegister.stop}
          </Button>
        </section>
      ))}

      {past.length > 0 && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>{strings.actingAsRegister.pastHeading}</h2>
          {past.map((r) => (
            <p key={r.id} className={styles.cardNote}>
              <strong>{r.operatorName}</strong> · {r.practiceName ?? r.practiceId} · {r.reasonLabel} ·{' '}
              {when(r.startedAt)} → {when(r.endedAt)}
              {r.endedHow ? ` (${r.endedHow.replace(/_/g, ' ')})` : ''}
            </p>
          ))}
        </section>
      )}

      <div className={ui.rowActions}>
        <Button variant="subtle" onClick={() => void load()} data-testid="acting-as-refresh">
          <RefreshCw size={14} aria-hidden="true" />
          {strings.queue.refresh}
        </Button>
      </div>
    </Shell>
  );
}
