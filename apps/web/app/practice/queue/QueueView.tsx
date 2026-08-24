'use client';

/**
 * The outbound queue, for the people who operate it.
 *
 * WHAT QUESTION THIS SCREEN ANSWERS: is anything stuck, and what is in it. It
 * is the dashboard that BullMQ's Workbench or RabbitMQ's management plugin
 * would have given us for free, and it is the one thing those genuinely had
 * over a Postgres queue.
 *
 * ⚠ WHAT IT IS NOT. It is not "what was sent to me". Practitioners and
 * patients asking that must be answered from `Notice`, which is retained for
 * the statutory period — this table is transport and is pruned after thirty
 * days, so a patient watching this screen would see their own records vanish.
 * That is a different screen over different data (TODO.md).
 *
 * WHO SEES WHAT is decided on the server, not here. A practice user's token
 * carries their practice claim and the guard overwrites the header with it, so
 * nothing this screen sends can widen the scope. The role check below only
 * decides whether to OFFER a practice chooser.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, FileJson, FileText, Mail, RefreshCw, Search, XCircle } from 'lucide-react';
import { isPlatformOperator } from '@aobplatform/domain';
import { Button, Chip, Field, Notice, SelectInput, Shell, TextInput, ui } from '../../ui';
import { SessionControl } from '../../SessionControl';
import { apiHeaders, currentSession } from '../../auth';
import { useRefreshable } from '../../refresh';
import { strings } from '../../strings';
import { usePractice } from '../usePractice';
import { useLiveRefresh } from '../../useLiveRefresh';
import styles from '../manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/** Distinguishes "they picked somebody" from "they typed a word". */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface QueueItem {
  id: string;
  channel: string;
  mediaType: string;
  destination: string | null;
  subjectType: string;
  subjectId: string;
  state: string;
  attempts: number;
  availableAt: string;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
  artefactId: string | null;
  locationId: string | null;
  departmentId: string | null;
  recipientType: string | null;
  recipientId: string | null;
  recipientName: string | null;
  resendOfId: string | null;
  resendCount: number;
  resendByName: string | null;
}

interface FilterOptions {
  locations: { id: string; label: string; active: boolean }[];
  departments: { id: string; label: string; locationId: string }[];
  recipients: { id: string; type: string | null; name: string | null }[];
}

interface Catalogue {
  states: string[];
  mediaTypes: string[];
  channels: string[];
}

/** Tone per state, so the table reads at a glance rather than word by word. */
function stateChip(state: string): { tone: 'ok' | 'warn' | 'stop' | 'neutral'; icon: React.ReactNode } {
  switch (state) {
    case 'sent':
      return { tone: 'ok', icon: <CheckCircle2 size={13} aria-hidden="true" /> };
    case 'dead':
      return { tone: 'stop', icon: <XCircle size={13} aria-hidden="true" /> };
    case 'failed':
      return { tone: 'warn', icon: <AlertTriangle size={13} aria-hidden="true" /> };
    case 'leased':
      return { tone: 'neutral', icon: <RefreshCw size={13} aria-hidden="true" /> };
    default:
      return { tone: 'warn', icon: <Clock size={13} aria-hidden="true" /> };
  }
}

function mediaIcon(mediaType: string) {
  if (mediaType === 'email') return <Mail size={14} aria-hidden="true" />;
  if (mediaType === 'json' || mediaType === 'xml') return <FileJson size={14} aria-hidden="true" />;
  return <FileText size={14} aria-hidden="true" />;
}

function when(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

export function QueueView() {
  const { practiceId, checked } = usePractice();
  const isOperator = isPlatformOperator({ roles: currentSession()?.roles ?? [] });

  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [mediaType, setMediaType] = useState('');
  const [state, setState] = useState('');
  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [orgId, setOrgId] = useState('');
  const [practices, setPractices] = useState<{ id: string; label: string }[]>([]);
  /*
   * Holds EITHER a recipient id (picked from the list) or free text
   * (typed). Carl asked for both -- "anybody or we enter a word" -- so the
   * value is sent as an id when it looks like one and as a search term
   * when it does not.
   */
  const [recipient, setRecipient] = useState('');
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${CORE_URL}/outbound/catalogue`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => c && setCatalogue(c))
      .catch(() => {
        // Filters degrade to "everything"; the list still works.
      });
  }, []);

  /*
   * Options built FROM THE QUEUE, so every value in a dropdown matches at
   * least one message. A list of every site a practice has ever had, most
   * of which return nothing, teaches people the filters are broken.
   */
  useEffect(() => {
    const forPractice = orgId || practiceId;
    if (!forPractice) return;
    fetch(`${CORE_URL}/outbound/filters`, { headers: apiHeaders(forPractice) })
      .then((r) => (r.ok ? r.json() : null))
      .then((o) => o && setOptions(o))
      .catch(() => {
        // The dropdowns stay empty; the free-text search still works.
      });
  }, [practiceId]);

  useEffect(() => {
    if (!isOperator) return;
    fetch(`${CORE_URL}/outbound/practices`, { headers: apiHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setPractices((b.practices ?? []).map((x: { id: string; name: string }) => ({ id: x.id, label: x.name }))))
      .catch(() => {
        // The chooser stays empty; a practice can still be reached from
        // the practice list, which is where operators usually start.
      });
  }, [isOperator]);

  const load = useCallback(async () => {
    const scope = orgId || practiceId;
    if (!scope) return;
    setError(null);
    const params = new URLSearchParams();
    if (mediaType) params.set('mediaType', mediaType);
    if (state) params.set('state', state);
    if (locationId) params.set('locationId', locationId);
    if (departmentId) params.set('departmentId', departmentId);
    if (recipient) {
      // A picked person filters exactly; a typed word searches names and
      // addresses. Same box, because to the person using it they are the
      // same question.
      if (UUID_SHAPE.test(recipient)) params.set('recipientId', recipient);
      else params.set('search', recipient);
    }
    if (search.trim()) params.set('search', search.trim());
    try {
      const res = await fetch(`${CORE_URL}/outbound?${params.toString()}`, { headers: apiHeaders(scope) });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Could not read the queue (${res.status}).`);
      }
      const body = await res.json();
      setItems(body.items ?? []);
    } catch (e) {
      setError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    }
  }, [practiceId, orgId, mediaType, state, search, locationId, departmentId, recipient]);

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
   * Anything not yet sent is worth a count at the top. An operator opening this
   * screen is asking "is it moving", and a number answers that before the table
   * has finished being read.
   */
  const waiting = useMemo(
    () => (items ?? []).filter((i) => i.state === 'pending' || i.state === 'failed' || i.state === 'leased').length,
    [items],
  );
  const dead = useMemo(() => (items ?? []).filter((i) => i.state === 'dead').length, [items]);

  /*
   * AUTO-REFRESH WHILE ANYTHING IS STILL MOVING. A queue screen that needs a
   * manual refresh is a screen that shows you the past — and the question it
   * answers, "is it stuck", is about now.
   *
   * Gated on there being something unsent, so a settled queue polls not at
   * all.
   */
  useLiveRefresh(waiting > 0, load);

  if (!checked) return null;

  if (!practiceId) {
    return (
      <Shell right={<SessionControl audience={strings.setup.audience} />}>
        <h1 className={ui.pageTitle}>{strings.queue.title}</h1>
        <Notice tone="warn" title={strings.queue.chooseTitle}>
          {isOperator ? strings.queue.chooseBodyOperator : strings.queue.chooseBodyPractice}
        </Notice>
      </Shell>
    );
  }

  return (
    <Shell right={<SessionControl audience={strings.setup.audience} />}>
      <h1 className={ui.pageTitle}>{strings.queue.title}</h1>
      <p className={`${ui.pageLead} ${styles.queueLead}`}>{strings.queue.lead}</p>

      <div className={styles.queueSummary}>
        <span>{(items ?? []).length} shown</span>
        {waiting > 0 && (
          <Chip tone="warn">
            <Clock size={13} aria-hidden="true" /> {waiting} {strings.queue.waiting}
          </Chip>
        )}
        {dead > 0 && (
          <Chip tone="stop">
            <XCircle size={13} aria-hidden="true" /> {dead} {strings.queue.dead}
          </Chip>
        )}
        <Button variant="subtle" onClick={() => void load()} data-testid="queue-refresh">
          <RefreshCw size={14} aria-hidden="true" />
          {strings.queue.refresh}
        </Button>
      </div>

      <div className={styles.queueFilters}>
        <Field label={strings.queue.filterMedia}>
          {(props) => (
            <SelectInput {...props} value={mediaType} onChange={(e) => setMediaType(e.target.value)} data-testid="filter-media">
              <option value="">{strings.queue.anyMedia}</option>
              {(catalogue?.mediaTypes ?? []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
        <Field label={strings.queue.filterState}>
          {(props) => (
            <SelectInput {...props} value={state} onChange={(e) => setState(e.target.value)} data-testid="filter-state">
              <option value="">{strings.queue.anyState}</option>
              {(catalogue?.states ?? []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
        {/*
          THE ORGANISATION, for a platform operator. A practice user has one
          practice and their token says which, so offering them a chooser
          would be offering a list of other people’s practices.
        */}
        {isOperator && (
          <ComboFilter
            label={strings.queue.filterOrg}
            hint={strings.queue.orgHint}
            placeholder={strings.queue.orgPlaceholder}
            value={orgId}
            onChange={setOrgId}
            options={practices}
            testId="filter-org"
          />
        )}
        <ComboFilter
          label={strings.queue.filterLocation}
          hint={strings.queue.typeToNarrow}
          placeholder={strings.queue.anyLocation}
          value={locationId}
          onChange={(v) => {
            setLocationId(v);
            // A department belongs to a site, so changing the site
            // invalidates the department beneath it.
            setDepartmentId('');
          }}
          options={(options?.locations ?? []).map((l) => ({
            id: l.id,
            label: l.active ? l.label : `${l.label} (${strings.queue.inactive})`,
          }))}
          testId="filter-location"
        />
        <ComboFilter
          label={strings.queue.filterDepartment}
          hint={strings.queue.typeToNarrow}
          placeholder={strings.queue.anyDepartment}
          value={departmentId}
          onChange={setDepartmentId}
          options={(options?.departments ?? [])
            .filter((d) => !locationId || d.locationId === locationId)
            .map((d) => ({ id: d.id, label: d.label }))}
          testId="filter-department"
        />
        <ComboFilter
          label={strings.queue.filterRecipient}
          hint={strings.queue.recipientHint}
          placeholder={strings.queue.recipientPlaceholder}
          value={recipient}
          onChange={setRecipient}
          options={(options?.recipients ?? []).map((r) => ({ id: r.id, label: r.name ?? r.id }))}
          testId="filter-recipient"
        />
        <Field label={strings.queue.filterSearch} hint={strings.queue.filterSearchWide}>
          {(props) => (
            <div className={styles.searchWrap}>
              <Search size={15} aria-hidden="true" className={styles.searchIcon} />
              <TextInput {...props} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="filter-search" />
            </div>
          )}
        </Field>
      </div>

      {error && (
        <Notice tone="stop" title={strings.queue.notLoaded}>
          {error}
        </Notice>
      )}

      {items !== null && items.length === 0 && !error && (
        <Notice tone="ok" title={strings.queue.emptyTitle}>
          {strings.queue.emptyBody}
        </Notice>
      )}

      {/*
        A HEADER, because six columns with no labels means "—" is a
        mystery rather than "no site". Marked aria-hidden: the rows are a
        list of buttons rather than a real table, so a screen reader gets
        the labels from each row instead of from here.
      */}
      <div className={styles.queueHead} aria-hidden="true">
        <span>{strings.queue.colType}</span>
        <span>{strings.queue.colRecipient}</span>
        <span>{strings.queue.colSite}</span>
        <span>{strings.queue.colState}</span>
        <span>{strings.queue.colWhen}</span>
      </div>

      <ul className={styles.queueList}>
        {(items ?? []).map((item) => {
          const chip = stateChip(item.state);
          return (
            <li key={item.id} className={styles.queueRow}>
              <button
                type="button"
                className={styles.queueRowMain}
                onClick={() => setOpenItem(openItem === item.id ? null : item.id)}
                data-testid={`queue-open-${item.id}`}
              >
                <span className={styles.queueMedia}>
                  {mediaIcon(item.mediaType)} {item.mediaType}
                </span>
                <span className={styles.queueDest}>
                  {item.recipientName ?? item.destination ?? strings.queue.awaitingDevice}
                  {item.recipientName && item.destination && (
                    <span className={styles.queueSub}>{item.destination}</span>
                  )}
                </span>
                <span className={styles.queueSubject}>
                  {siteLabel(options, item) ?? strings.queue.noSite}
                </span>
                <Chip tone={chip.tone}>
                  {chip.icon} {item.state}
                </Chip>
                {item.resendOfId && <Chip tone="neutral">{strings.queue.resentCopy}</Chip>}
                {item.resendCount > 0 && (
                  <Chip tone="neutral">
                    {item.resendCount}× {strings.queue.resentTimes}
                  </Chip>
                )}
                <span className={styles.queueWhen}>{when(item.sentAt ?? item.createdAt)}</span>
              </button>

              {item.lastError && (
                <p className={styles.queueError}>
                  <AlertTriangle size={13} aria-hidden="true" /> {item.lastError}
                  {item.attempts > 0 && ` (${item.attempts} ${strings.queue.attempts})`}
                </p>
              )}

              {openItem === item.id && (
                <>
                  {/* The chosen org, not the viewer's own — an operator
                      looking at another practice must read and resend within
                      THAT practice, or the scope silently reverts. */}
                  <PayloadViewer practiceId={orgId || practiceId} item={item} />
                  <ResendControl practiceId={orgId || practiceId} item={item} onDone={load} />
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}

/**
 * Renders one payload in the shape it actually is.
 *
 * FETCHED ONE AT A TIME, never with the list. A page of two hundred rows would
 * otherwise ship two hundred patient-bearing bodies to the browser to render a
 * table that shows none of them — and the server logs each open as an
 * `access.read`, which only means anything if opening is a deliberate act.
 */
function PayloadViewer({ practiceId, item }: { practiceId: string; item: QueueItem }) {
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${CORE_URL}/outbound/item/${item.id}`, { headers: apiHeaders(practiceId) })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Could not open it (${r.status}).`);
        return r.json();
      })
      .then((full) => {
        if (live) setPayload((full.payload ?? {}) as Record<string, unknown>);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [item.id, practiceId]);

  if (error) {
    return (
      <Notice tone="stop" title={strings.queue.notOpened}>
        {error}
      </Notice>
    );
  }
  if (!payload) return <p className={styles.cardNote}>{strings.queue.opening}</p>;

  if (item.mediaType === 'email') {
    return (
      <div className={styles.viewer}>
        <p className={styles.viewerSubject}>{String(payload.subject ?? '')}</p>
        {/*
          THE PLAIN-TEXT PART, deliberately, not the HTML. Rendering somebody
          else's HTML inside our console would run their markup in our origin —
          and these bodies are assembled from practice-supplied names and
          reasons. The text part carries the same words with none of that.
        */}
        <pre className={styles.viewerBody}>{String(payload.body ?? '')}</pre>
      </div>
    );
  }

  if (item.mediaType === 'json') {
    return (
      <div className={styles.viewer}>
        <pre className={styles.viewerBody}>{JSON.stringify(payload, null, 2)}</pre>
      </div>
    );
  }

  if (item.mediaType === 'xml' || item.mediaType === 'markdown') {
    /*
     * Shown as source rather than rendered. A markdown renderer would follow
     * links and images out of a payload we did not write, and an XML renderer
     * would parse entities — both are how a document becomes an exfiltration
     * channel. Source is honest and, for an operator debugging a queue, more
     * useful anyway.
     */
    return (
      <div className={styles.viewer}>
        <pre className={styles.viewerBody}>{String(payload.content ?? payload.body ?? JSON.stringify(payload, null, 2))}</pre>
      </div>
    );
  }

  if (item.mediaType === 'pdf') {
    return (
      <div className={styles.viewer}>
        {item.artefactId ? (
          <p className={styles.cardNote}>
            {strings.queue.pdfInStore} <code>{item.artefactId}</code>
          </p>
        ) : (
          <p className={styles.cardNote}>{strings.queue.pdfMissing}</p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.viewer}>
      <pre className={styles.viewerBody}>{JSON.stringify(payload, null, 2)}</pre>
    </div>
  );
}

/** The site a message belongs to, resolved from the filter options. */
function siteLabel(options: FilterOptions | null, item: QueueItem): string | null {
  if (!item.locationId) return null;
  const site = options?.locations.find((l) => l.id === item.locationId)?.label ?? item.locationId.slice(0, 8);
  const dept = item.departmentId
    ? options?.departments.find((d) => d.id === item.departmentId)?.label
    : null;
  return dept ? `${site} · ${dept}` : site;
}

/**
 * Sending one again.
 *
 * A RESEND IS A COPY, not a retry of this row. The original keeps whatever
 * state it reached — including `dead` — because that attempt really did
 * happen and a resend does not make it untrue.
 */
type ResendReason = { key: string; label: string; detail: string };

function ResendControl({
  practiceId,
  item,
  onDone,
}: {
  practiceId: string;
  item: QueueItem;
  onDone: () => void | Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [reasons, setReasons] = useState<ResendReason[]>([]);
  const [minWords, setMinWords] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * THE REASONS COME FROM THE SERVER, which reads them from a table.
   *
   * A copy of the list in this file would drift the first time somebody adds a
   * sixth reason and updates only one of the two places — and the screen would
   * then offer something the server refuses, or refuse something it accepts.
   */
  useEffect(() => {
    fetch(`${CORE_URL}/outbound/resend-reasons`, { headers: apiHeaders(practiceId) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b: { reasons?: ResendReason[]; minWords?: number }) => {
        setReasons(b.reasons ?? []);
        if (typeof b.minWords === 'number') setMinWords(b.minWords);
      })
      .catch(() => setReasons([]));
  }, [practiceId]);

  const chosen = reasons.find((r) => r.key === reason);
  const words = note.trim().split(/\s+/).filter(Boolean).length;
  const ready = Boolean(reason) && words >= minWords;

  // Nothing in flight may be copied — that is how a statutory notice gets
  // sent twice because somebody was impatient. The server refuses it too.
  const inFlight = item.state === 'pending' || item.state === 'leased';

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/outbound/item/${item.id}/resend`, {
        method: 'POST',
        headers: apiHeaders(practiceId),
        body: JSON.stringify({ reason, note: note.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `That failed (${res.status}).`);
      }
      setReason('');
      setNote('');
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (inFlight) return null;

  return (
    <div className={styles.resendBar}>
      <p className={styles.cardNote}>{strings.queue.resendBody}</p>
      <div className={styles.inlineForm}>
        {/*
          A LIST AND A NOTE, because they do different work. The list makes
          answers countable — "how often do our messages not arrive" is a
          deliverability question nobody could answer while this was free text.
          The note makes one resend accountable.
        */}
        <Field label={strings.queue.resendReason} hint={chosen?.detail ?? strings.queue.resendReasonHint} required>
          {(props) => (
            <SelectInput
              {...props}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              data-testid={`resend-reason-${item.id}`}
            >
              <option value="">{strings.queue.resendChoose}</option>
              {reasons.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>

        <Field
          label={strings.queue.resendNote}
          hint={
            words > 0 && words < minWords
              ? strings.queue.resendNoteShort.replace('{n}', String(minWords - words))
              : strings.queue.resendNoteHint.replace('{n}', String(minWords))
          }
          required
        >
          {(props) => (
            <TextInput
              {...props}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              data-testid={`resend-note-${item.id}`}
            />
          )}
        </Field>

        {/*
          Disabled until both are given. The server checks the same thing, so
          this is courtesy rather than control — a disabled button is a
          suggestion, and the rule lives where it cannot be edited away.
        */}
        <Button
          variant="primary"
          onClick={() => void send()}
          disabled={busy || !ready}
          data-testid={`resend-${item.id}`}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {busy ? strings.queue.resending : strings.queue.resend}
        </Button>
      </div>
      {error && (
        <Notice tone="stop" title={strings.queue.resendFailed}>
          {error}
        </Notice>
      )}
    </div>
  );
}
/**
 * A filter you can type into.
 *
 * A plain <select> with two hundred practices in it is unusable — you
 * scroll, you cannot type, and you give up. This is an input with a
 * datalist behind it: the browser narrows the list as you type, and
 * anything you type that is NOT in the list is still accepted, which is
 * what Carl asked for on "send to" (pick somebody, or enter a word).
 *
 * Native rather than a custom dropdown, deliberately. The browser already
 * handles keyboard, screen readers and touch, and a hand-rolled listbox
 * gets those wrong in ways nobody notices until somebody who needs them
 * tries to use it.
 */
function ComboFilter({
  label,
  hint,
  placeholder,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  hint?: string;
  placeholder?: string;
  /** The id currently chosen, or free text. */
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string }[];
  testId: string;
}) {
  const listId = `${testId}-list`;
  /*
   * The input shows the LABEL while the caller holds the ID. Showing a
   * uuid in a filter box would be unreadable, and holding the label would
   * break the moment two sites share a name.
   */
  const chosen = options.find((o) => o.id === value);
  const [text, setText] = useState(chosen?.label ?? value);

  useEffect(() => {
    const match = options.find((o) => o.id === value);
    setText(match?.label ?? (value || ''));
  }, [value, options]);

  return (
    <Field label={label} hint={hint}>
      {(props) => (
        <>
          <TextInput
            {...props}
            list={listId}
            value={text}
            placeholder={placeholder}
            onChange={(e) => {
              const next = e.target.value;
              setText(next);
              // A typed value that matches an option becomes that option;
              // anything else is passed through as free text.
              const hit = options.find((o) => o.label === next);
              onChange(hit ? hit.id : next);
            }}
            data-testid={testId}
          />
          <datalist id={listId}>
            {options.map((o) => (
              <option key={o.id} value={o.label} />
            ))}
          </datalist>
        </>
      )}
    </Field>
  );
}