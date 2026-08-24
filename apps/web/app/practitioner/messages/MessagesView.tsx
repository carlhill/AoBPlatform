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

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { matrix } from '@aobplatform/domain';
import { Button, Field, Notice, SelectInput, Shell, ui } from '../../ui';
import { SessionControl } from '../../SessionControl';
import { apiHeaders, currentSession } from '../../auth';
import { strings } from '../../strings';
import styles from '../../practice/manage.module.css';

const CUBE_URL = process.env.NEXT_PUBLIC_CUBE_URL ?? 'http://localhost:21030';
const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

type Row = Record<string, string | number | null>;

/**
 * THE SAME GRAINS AS THE PLATFORM REPORT, because "how much and when" is the
 * same question whoever is asking it. The two matrices are reshaped from daily
 * rows through the same `matrix()` the other screen uses, so the two agree
 * about what "week 3 of its own month" means.
 */
const GRAINS = [
  { key: 'all', label: 'Since the start', granularity: null },
  { key: 'quarter', label: 'Per quarter', granularity: 'quarter' },
  { key: 'month', label: 'Per month', granularity: 'month' },
  { key: 'week', label: 'Per week', granularity: 'week' },
  { key: 'day', label: 'Per day', granularity: 'day' },
  { key: 'month_by_week', label: 'Months down, weeks across', granularity: 'day' },
  { key: 'month_by_day', label: 'Months down, days across', granularity: 'day' },
] as const;

type GrainKey = (typeof GRAINS)[number]['key'];

function queryFor(grain: GrainKey) {
  const chosen = GRAINS.find((g) => g.key === grain) ?? GRAINS[2];
  return {
    measures: ['MyMessages.count', 'MyMessages.sent', 'MyMessages.waiting'],
    dimensions: ['MyMessages.practice'],
    timeDimensions: [
      {
        dimension: 'MyMessages.occurredAt',
        ...(chosen.granularity ? { granularity: chosen.granularity } : {}),
        dateRange: 'from 2 years ago to now',
      },
    ],
    order: { 'MyMessages.occurredAt': 'desc' },
  };
}

/**
 * The period cell, whatever grain was chosen.
 *
 * Cube names the column after the granularity — `occurredAt.month`,
 * `occurredAt.week`, `occurredAt.quarter` — so reading `.month` unconditionally
 * left every other grain with an empty first column under a heading that said
 * MONTH. Empty cells under a wrong label read as missing data rather than as a
 * screen looking in the wrong place.
 */
function periodOf(row: Row, grain: GrainKey): string {
  const chosen = GRAINS.find((g) => g.key === grain);
  const value =
    (chosen?.granularity ? row[`MyMessages.occurredAt.${chosen.granularity}`] : null) ??
    row['MyMessages.occurredAt'] ??
    '';

  const text = String(value);
  if (!text) return '';

  // Trimmed to the precision actually being shown: a day needs the date, a
  // month does not need the day, and nothing here needs the time.
  if (chosen?.granularity === 'month') return text.slice(0, 7);
  if (chosen?.granularity === 'quarter') {
    const month = Number(text.slice(5, 7));
    return `${text.slice(0, 4)} Q${Math.floor((month - 1) / 3) + 1}`;
  }
  return text.slice(0, 10);
}

function num(row: Row, key: string): number {
  const value = row[key];
  return typeof value === 'number' ? value : Number(value ?? 0);
}

type Message = {
  id: string;
  practice: string | null;
  channel: string;
  state: string;
  occurredAt: string;
  subject: string | null;
  body: string | null;
  sentBy: string;
};

export function MessagesView() {
  const [grain, setGrain] = useState<GrainKey>('month');
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const token = currentSession()?.accessToken;
      if (!token) throw new Error(strings.myMessages.noSession);

      const res = await fetch(
        `${CUBE_URL}/cubejs-api/v1/load?query=${encodeURIComponent(JSON.stringify(queryFor(grain)))}`,
        { headers: { Authorization: token } },
      );
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
  }, [grain]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * THE MESSAGES THEMSELVES, from core rather than from Cube.
   *
   * The reporting layer carries counts and no content — that is what makes it
   * safe to let a query engine compose its own SQL over it. Reading a message
   * sent TO YOU is a different question, answered from a different place rather
   * than by widening that surface.
   *
   * Fetched once, not per grain: the grain changes how the SUMMARY is grouped,
   * and a list of what arrived does not group at all.
   */
  const loadMessages = useCallback(() => {
    return fetch(`${CORE_URL}/practitioner/me/messages`, { headers: apiHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b: { messages?: Message[] }) => setMessages(b.messages ?? []))
      .catch(() => setMessages([]));
  }, []);

  /*
   * REFETCHED ALONGSIDE THE SUMMARY, not once on mount. Fetching the list only
   * at mount let the two disagree: the summary said two messages and the list
   * showed one, because the second had arrived between the page loading and
   * being looked at. Two counts on one screen that do not match is worse than
   * either being slightly stale.
   */
  useEffect(() => {
    void loadMessages();
  }, [loadMessages, rows]);

  /*
   * The two matrices are reshaped from daily rows, exactly as the platform
   * report does. Cube groups by CALENDAR week, which puts week 31 in one month
   * and leaves every row in a different set of columns, comparing nothing.
   * `matrix()` is shared, so the two screens cannot disagree about what
   * "week 3 of its own month" means.
   */
  const built = useMemo(() => {
    if (!rows || (grain !== 'month_by_week' && grain !== 'month_by_day')) return null;
    const counted = rows
      .map((r) => ({
        at: String(r['MyMessages.occurredAt.day'] ?? r['MyMessages.occurredAt'] ?? ''),
        count: num(r, 'MyMessages.count'),
      }))
      .filter((r) => r.at)
      .map((r) => ({ at: new Date(r.at), count: r.count }));
    return matrix(counted, grain === 'month_by_week' ? 'month_by_week' : 'month_by_day');
  }, [rows, grain]);

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
      <h1 className={ui.pageTitle}>{strings.myMessages.title}</h1>
      <p className={ui.pageLead}>{strings.myMessages.lead}</p>

      <div className={styles.applicationFields}>
        <Field label={strings.myMessages.grain} hint={strings.myMessages.grainHint}>
          {(props) => (
            <SelectInput
              {...props}
              value={grain}
              onChange={(e) => setGrain(e.target.value as GrainKey)}
              data-testid="messages-grain"
            >
              {GRAINS.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
      </div>

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

      {built && (
        <div className={styles.tableScroll}>
          <table className={styles.totalsTable}>
            <thead>
              <tr>
                <th scope="col">{strings.myMessages.month}</th>
                {built.columns.map((c) => (
                  <th key={c} scope="col" className={styles.stateCol}>
                    {c}
                  </th>
                ))}
                <th scope="col" className={styles.totalCol}>
                  {strings.myMessages.total}
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
          </table>
        </div>
      )}

      {!built && rows && rows.length > 0 && (
        <div className={styles.tableScroll}>
          <table className={styles.totalsTable}>
            <thead>
              <tr>
                {/* NOT "Month". The column holds whatever grain was chosen,
                    and labelling it Month made a quarter look like missing
                    data. */}
                <th scope="col">{strings.myMessages.period}</th>
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
                  <th scope="row">{periodOf(r, grain) || strings.myMessages.everything}</th>
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
      {/*
        THE MESSAGES THEMSELVES. The table above answers "how many and when";
        this answers "which ones, and what did each say" — the question somebody
        actually has when they open a page called "what we have sent you".

        A table rather than a list of buttons, because the columns are what
        people scan by: when it arrived, who from, and what it was about.
      */}
      {messages && messages.length > 0 && (
        <section className={styles.applicationSection}>
          <h2 className={styles.applicationHeading}>{strings.myMessages.listTitle}</h2>
          <p className={ui.hint}>{strings.myMessages.listHint}</p>

          <div className={styles.tableScroll}>
            <table className={styles.totalsTable}>
              <thead>
                <tr>
                  <th scope="col">{strings.myMessages.when}</th>
                  <th scope="col">{strings.myMessages.practice}</th>
                  <th scope="col">{strings.myMessages.subject}</th>
                  <th scope="col">{strings.myMessages.state}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <Fragment key={m.id}>
                    <tr>
                      <th scope="row">{String(m.occurredAt).slice(0, 10)}</th>
                      <td>{m.practice ?? strings.practitioner.unnamedPractice}</td>
                      <td>{m.subject ?? strings.myMessages.noSubject}</td>
                      <td>{m.state}</td>
                      <td>
                        <Button
                          variant="subtle"
                          onClick={() => setOpenId(openId === m.id ? null : m.id)}
                          data-testid={`message-${m.id}`}
                        >
                          {openId === m.id ? (
                            <ChevronDown size={14} aria-hidden="true" />
                          ) : (
                            <ChevronRight size={14} aria-hidden="true" />
                          )}
                          {openId === m.id ? strings.myMessages.hide : strings.myMessages.view}
                        </Button>
                      </td>
                    </tr>

                    {openId === m.id && (
                      <tr>
                        {/* The detail spans the table, so it reads as belonging
                            to the row above rather than as a new record. */}
                        <td colSpan={5}>
                          {m.body ? (
                            <pre className={styles.messageBody}>{m.body}</pre>
                          ) : (
                            /*
                              NOT A BLANK. A sign-in link is composed and sent by
                              Keycloak, so we record that it went and hold the
                              subject, never the text. Rendering nothing would
                              read as a message with nothing in it, which is a
                              different and false thing to say.
                            */
                            <Notice title={strings.myMessages.noBodyTitle}>
                              {strings.myMessages.noBodyBody.replace('{who}', m.sentBy)}
                            </Notice>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

    </Shell>
  );
}
