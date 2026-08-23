'use client';

/**
 * The review queue — changes that need a second look.
 *
 * WHAT A REVIEWER IS ACTUALLY DOING HERE: deciding whether a change a practice
 * made to its own record is ordinary, or whether it looks like somebody taking
 * over the account. So the screen leads with the DIFF, not with metadata. What
 * moved, from what, to what — everything else is context for that.
 *
 * THE AUTOMATED VERDICT IS SHOWN AS ADVICE AND NEVER AS A DECISION. When a
 * check has run and was not allowed to close the task, its opinion appears
 * above the diff, labelled as a machine's, with its confidence. That is the
 * useful shape: the reviewer starts with an opinion rather than a blank page,
 * and is still unambiguously the one deciding.
 *
 * A task closed automatically never reaches this screen at all, and the vault
 * event for it says plainly that no person reviewed it.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Bot, Check, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button, Chip, Field, Notice, SelectInput, Shell, TextInput, ui } from '../../ui';
import { isPlatformOperator } from '@aobplatform/domain';
import { SessionControl } from '../../SessionControl';
import { apiHeaders, currentSession } from '../../auth';
import { strings } from '../../strings';
import { usePractice } from '../usePractice';
import { PracticePicker } from '../PracticePicker';
import { useLiveRefresh } from '../../useLiveRefresh';
import styles from '../manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

interface Change {
  field: string;
  from: string | null;
  to: string | null;
}

interface Task {
  id: string;
  kind: string;
  kindLabel: string;
  question: string | null;
  stakes: 'low' | 'high';
  subjectType: string;
  subjectId: string;
  summary: string;
  detail: { reason?: string; changes?: Change[]; handover?: boolean };
  state: string;
  raisedBy: string;
  raisedAt: string;
  claimedBy: string | null;
  claimable: boolean;
  autoVerdict: string | null;
  autoConfidence: number | null;
  autoReasoning: string | null;
  autoCheckedBy: string | null;
}

interface Catalogue {
  kinds: { key: string; label: string; stakes: string; autoResolvable: boolean }[];
  resolutions: string[];
}

function when(value: string): string {
  return new Date(value).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

export function ReviewsView() {
  const { practiceId, checked } = usePractice();
  /*
   * A PLATFORM OPERATOR HAS NO PRACTICE CLAIM, so this screen was
   * rendering an empty list with no error and no way forward — which
   * looks exactly like "there is nothing here" and was not.
   */
  const [chosen, setChosen] = useState('');
  const isOperator = isPlatformOperator({ roles: currentSession()?.roles ?? [] });
  const scope = practiceId ?? chosen;
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState('');
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch(`${CORE_URL}/review-tasks/catalogue`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => c && setCatalogue(c))
      .catch(() => {
        // Filters degrade; the list still works.
      });
  }, []);

  const load = useCallback(async () => {
    if (!scope) return;
    setError(null);
    const params = new URLSearchParams();
    if (state) params.set('state', state);
    if (kind) params.set('kind', kind);
    try {
      const res = await fetch(`${CORE_URL}/review-tasks?${params.toString()}`, { headers: apiHeaders(scope) });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `The review queue could not be read (${res.status}).`);
      }
      const body = await res.json();
      setTasks(body.tasks ?? []);
    } catch (e) {
      setError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    }
  }, [scope, state, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  // Tasks arrive from elsewhere — a practice amending its own record — so a
  // reviewer sitting on this screen should see them appear.
  useLiveRefresh(true, load, 30_000);

  if (!checked) return null;

  if (!scope) {
    return (
      <Shell right={<SessionControl audience={strings.setup.audience} />}>
        <h1 className={ui.pageTitle}>{strings.reviews.title}</h1>
        <PracticePicker value={chosen} onChange={setChosen} isOperator={isOperator} />
      </Shell>
    );
  }

  /*
   * SEARCH OVER WHAT THE CARD ACTUALLY SHOWS, which is mostly the change
   * itself. The state and kind dropdowns narrow by category; this narrows by
   * VALUE — "which task was about that address" is the question somebody has
   * when they already know the answer they are looking for.
   *
   * Client-side over the loaded page, deliberately for now. At the volumes
   * Carl is planning for this becomes a server-side filter, and the API
   * already takes query parameters for the other two. Said plainly on the
   * screen so nobody mistakes a page of matches for all of them.
   */
  /*
   * A PLAIN FUNCTION, NOT A HOOK. `useCallback` here sat after the early
   * returns above, so on the renders that take one it was never called and
   * React saw the hook order change between renders — which it reports as
   * "a change in the order of Hooks" and which genuinely does cause wrong
   * state later.
   *
   * It never needed memoising: it closes over one string and runs over a list
   * already in memory.
   */
  const matches = (t: Task) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;

    const haystack = [
      t.summary,
      t.raisedBy,
      t.detail?.reason,
      ...(t.detail?.changes ?? []).flatMap((c) => [c.field, c.from ?? '', c.to ?? '']),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(term);
  };

  const visible = (tasks ?? []).filter(matches);
  const open = (tasks ?? []).filter((t) => t.state === 'open' || t.state === 'claimed');
  const highStakes = open.filter((t) => t.stakes === 'high').length;

  return (
    <Shell right={<SessionControl audience={strings.setup.audience} />}>
      <Link href="/practice/setup" className={ui.backLink} data-testid="reviews-back">
        <ArrowLeft size={15} aria-hidden="true" />
        {strings.queue.back}
      </Link>
      <h1 className={ui.pageTitle}>{strings.reviews.title}</h1>
      <p className={`${ui.pageLead} ${styles.queueLead}`}>{strings.reviews.lead}</p>

      <div className={styles.queueSummary}>
        <span>
          {open.length} {strings.reviews.waiting}
        </span>
        {highStakes > 0 && (
          <Chip tone="stop">
            <ShieldAlert size={13} aria-hidden="true" /> {highStakes} {strings.reviews.needAPerson}
          </Chip>
        )}
        <Button variant="subtle" onClick={() => void load()} data-testid="reviews-refresh">
          <RefreshCw size={14} aria-hidden="true" />
          {strings.queue.refresh}
        </Button>
      </div>

      <div className={styles.queueFilters}>
        <Field label={strings.reviews.filterState}>
          {(props) => (
            <SelectInput {...props} value={state} onChange={(e) => setState(e.target.value)} data-testid="reviews-state">
              <option value="">{strings.reviews.anyOpen}</option>
              <option value="resolved">{strings.reviews.resolved}</option>
            </SelectInput>
          )}
        </Field>
        <Field label={strings.reviews.search} hint={strings.reviews.searchHint}>
          {(props) => (
            <TextInput
              {...props}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={strings.reviews.searchPlaceholder}
              data-testid="review-search"
            />
          )}
        </Field>

        <Field label={strings.reviews.filterKind}>
          {(props) => (
            <SelectInput {...props} value={kind} onChange={(e) => setKind(e.target.value)} data-testid="reviews-kind">
              <option value="">{strings.reviews.anyKind}</option>
              {(catalogue?.kinds ?? []).map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
      </div>

      {error && (
        <Notice tone="stop" title={strings.reviews.notLoaded}>
          {error}
        </Notice>
      )}

      {tasks && tasks.length > 0 && visible.length === 0 && (
        <Notice title={strings.reviews.noMatchTitle}>
          {strings.reviews.noMatchBody.replace('{n}', String(tasks.length))}
        </Notice>
      )}

      {tasks && tasks.length === 0 && !error && (
        <Notice tone="ok" title={strings.reviews.emptyTitle}>
          {strings.reviews.emptyBody}
        </Notice>
      )}

      <ul className={styles.reviewList}>
        {visible.map((task) => (
          <TaskCard key={task.id} task={task} practiceId={scope} catalogue={catalogue} onDone={load} />
        ))}
      </ul>
    </Shell>
  );
}

function TaskCard({
  task,
  practiceId,
  catalogue,
  onDone,
}: {
  task: Task;
  practiceId: string;
  catalogue: Catalogue | null;
  onDone: () => void | Promise<void>;
}) {
  const [resolution, setResolution] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decided = task.state === 'resolved' || task.state === 'dismissed';

  async function act(path: string, body?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/review-tasks/${task.id}/${path}`, {
        method: 'POST',
        headers: apiHeaders(practiceId),
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(b.message ?? `That failed (${res.status}).`);
      }
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`${styles.reviewCard} ${task.stakes === 'high' ? styles.reviewHigh : ''}`}>
      <div className={styles.reviewHead}>
        <span className={styles.reviewKind}>
          {task.stakes === 'high' && <ShieldAlert size={14} aria-hidden="true" />}
          {task.kindLabel}
        </span>
        <Chip tone={task.stakes === 'high' ? 'stop' : 'neutral'}>
          {task.stakes === 'high' ? strings.reviews.highStakes : strings.reviews.lowStakes}
        </Chip>
        <span className={styles.queueWhen}>
          {when(task.raisedAt)} · {task.raisedBy}
        </span>
      </div>

      {/* The question, not a title. A reviewer needs to know what they are
          being asked to decide before they read the diff. */}
      {task.question && <p className={styles.reviewQuestion}>{task.question}</p>}

      {task.detail?.reason && (
        <p className={styles.cardNote}>
          <strong>{strings.reviews.theySaid}</strong> {task.detail.reason}
        </p>
      )}

      {/*
        THE DIFF, which is the point of the screen. Before and after, side by
        side, because "adminEmail changed" is not a thing anybody can judge and
        "carl+x@… became carl_x@…" is.
      */}
      {task.detail?.changes && task.detail.changes.length > 0 && (
        <table className={styles.diffTable}>
          <thead>
            <tr>
              <th scope="col">{strings.reviews.colField}</th>
              <th scope="col">{strings.reviews.colFrom}</th>
              <th scope="col" aria-hidden="true" />
              <th scope="col">{strings.reviews.colTo}</th>
            </tr>
          </thead>
          <tbody>
            {task.detail.changes.map((c) => (
              <tr key={c.field}>
                <th scope="row">{c.field}</th>
                <td className={styles.diffFrom}>{c.from || strings.reviews.wasEmpty}</td>
                <td aria-hidden="true">
                  <ArrowRight size={13} />
                </td>
                <td className={styles.diffTo}>{c.to || strings.reviews.nowEmpty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/*
        AN AUTOMATED OPINION, labelled as one. Shown because starting from an
        opinion beats starting from a blank page — and labelled because the
        reviewer, not the check, is the one deciding. A task the check WAS
        allowed to close never appears on this screen at all.
      */}
      {task.autoVerdict && (
        <div className={styles.autoVerdict}>
          <p className={styles.autoHead}>
            <Bot size={14} aria-hidden="true" />
            {strings.reviews.automatedSaid} <strong>{task.autoVerdict}</strong>
            {typeof task.autoConfidence === 'number' && (
              <span className={styles.queueSub}>
                {strings.reviews.confidence} {task.autoConfidence.toFixed(2)} · {task.autoCheckedBy}
              </span>
            )}
          </p>
          {task.autoReasoning && <p className={styles.cardNote}>{task.autoReasoning}</p>}
          <p className={ui.hint}>{strings.reviews.adviceOnly}</p>
        </div>
      )}

      {decided ? (
        <p className={styles.cardNote}>
          <Check size={13} aria-hidden="true" /> {task.state} · {task.summary}
        </p>
      ) : (
        <>
          {/*
            CLAIMING IS ITS OWN LINE. It answers a different question from the
            decision below it — "is anybody already on this" versus "what did
            you conclude" — and sitting them in one grid row made the claim
            button look like a third field of the form.
          */}
          {(task.claimedBy || (task.claimable && task.state === 'open')) && (
            <div className={styles.claimRow}>
              {task.claimedBy && !task.claimable && (
                <Chip tone="warn">
                  {strings.reviews.claimedBy} {task.claimedBy}
                </Chip>
              )}
              {task.claimedBy && task.claimable && (
                <Chip tone="neutral">{strings.reviews.claimLapsed}</Chip>
              )}
              {task.claimable && task.state === 'open' && (
                <Button onClick={() => void act('claim')} disabled={busy} data-testid={`claim-${task.id}`}>
                  {strings.reviews.claim}
                </Button>
              )}
            </div>
          )}

          <div className={styles.reviewActions}>
            <Field label={strings.reviews.decision}>
            {(props) => (
              <SelectInput
                {...props}
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                data-testid={`resolution-${task.id}`}
              >
                <option value="">{strings.reviews.chooseDecision}</option>
                {(catalogue?.resolutions ?? []).map((r) => (
                  <option key={r} value={r}>
                    {strings.reviews.resolutionLabels[r as keyof typeof strings.reviews.resolutionLabels] ?? r}
                  </option>
                ))}
              </SelectInput>
            )}
            </Field>
            <Field label={strings.reviews.note} hint={strings.reviews.noteHint}>
            {(props) => (
              <TextInput
                {...props}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                data-testid={`note-${task.id}`}
              />
            )}
            </Field>
          </div>

          {/*
            THE BUTTON GETS ITS OWN ROW. Beside the two fields it meant aligning
            three things of different heights — a label plus a select, a label
            plus an input plus a hint, and a bare button — and whichever way they
            were aligned, one of them looked dropped.
          */}
          <div className={styles.decideRow}>
            <Button
              variant="primary"
              onClick={() => void act('resolve', { resolution, note: note.trim() || undefined })}
              disabled={busy || !resolution}
              data-testid={`resolve-${task.id}`}
            >
              {busy ? strings.reviews.deciding : strings.reviews.decide}
            </Button>
          </div>
        </>
      )}

      {error && (
        <Notice tone="stop" title={strings.reviews.actionFailed}>
          {error}
        </Notice>
      )}
    </li>
  );
}
