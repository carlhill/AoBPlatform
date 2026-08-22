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
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, FileJson, FileText, Mail, RefreshCw, Search, XCircle } from 'lucide-react';
import { isPlatformOperator } from '@aobplatform/domain';
import { Button, Chip, Field, Notice, SelectInput, Shell, TextInput, ui } from '../../ui';
import { SessionControl } from '../../SessionControl';
import { apiHeaders, currentSession } from '../../auth';
import { strings } from '../../strings';
import { usePractice } from '../usePractice';
import { useLiveRefresh } from '../../useLiveRefresh';
import styles from '../manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

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
  locations: { id: string; label: string }[];
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
  const [recipientId, setRecipientId] = useState('');
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
    if (!practiceId) return;
    fetch(`${CORE_URL}/outbound/filters`, { headers: apiHeaders(practiceId) })
      .then((r) => (r.ok ? r.json() : null))
      .then((o) => o && setOptions(o))
      .catch(() => {
        // The dropdowns stay empty; the free-text search still works.
      });
  }, [practiceId]);

  const load = useCallback(async () => {
    if (!practiceId) return;
    setError(null);
    const params = new URLSearchParams();
    if (mediaType) params.set('mediaType', mediaType);
    if (state) params.set('state', state);
    if (locationId) params.set('locationId', locationId);
    if (departmentId) params.set('departmentId', departmentId);
    if (recipientId) params.set('recipientId', recipientId);
    if (search.trim()) params.set('search', search.trim());
    try {
      const res = await fetch(`${CORE_URL}/outbound?${params.toString()}`, { headers: apiHeaders(practiceId) });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Could not read the queue (${res.status}).`);
      }
      const body = await res.json();
      setItems(body.items ?? []);
    } catch (e) {
      setError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    }
  }, [practiceId, mediaType, state, search, locationId, departmentId, recipientId]);

  useEffect(() => {
    void load();
  }, [load]);

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
        <Link href="/practice/setup" className={ui.backLink} data-testid="queue-back">
          <ArrowLeft size={15} aria-hidden="true" />
          {strings.queue.back}
        </Link>
        <h1 className={ui.pageTitle}>{strings.queue.title}</h1>
        <Notice tone="warn" title={strings.queue.chooseTitle}>
          {isOperator ? strings.queue.chooseBodyOperator : strings.queue.chooseBodyPractice}
        </Notice>
      </Shell>
    );
  }

  return (
    <Shell right={<SessionControl audience={strings.setup.audience} />}>
      <Link href="/practice/setup" className={ui.backLink} data-testid="queue-back">
        <ArrowLeft size={15} aria-hidden="true" />
        {strings.queue.back}
      </Link>
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
        <Field label={strings.queue.filterLocation}>
          {(props) => (
            <SelectInput
              {...props}
              value={locationId}
              onChange={(e) => {
                setLocationId(e.target.value);
                // A department belongs to a site, so changing the site
                // invalidates the department beneath it.
                setDepartmentId('');
              }}
              data-testid="filter-location"
            >
              <option value="">{strings.queue.anyLocation}</option>
              {(options?.locations ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
        <Field label={strings.queue.filterDepartment}>
          {(props) => (
            <SelectInput
              {...props}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              data-testid="filter-department"
            >
              <option value="">{strings.queue.anyDepartment}</option>
              {(options?.departments ?? [])
                .filter((d) => !locationId || d.locationId === locationId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
            </SelectInput>
          )}
        </Field>
        <Field label={strings.queue.filterRecipient}>
          {(props) => (
            <SelectInput
              {...props}
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              data-testid="filter-recipient"
            >
              <option value="">{strings.queue.anyRecipient}</option>
              {(options?.recipients ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name ?? r.id}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
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
                  <PayloadViewer practiceId={practiceId} item={item} />
                  <ResendControl practiceId={practiceId} item={item} onDone={load} />
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `That failed (${res.status}).`);
      }
      setReason('');
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
        <Field label={strings.queue.resendReason} hint={strings.queue.resendReasonHint}>
          {(props) => (
            <TextInput
              {...props}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              data-testid={`resend-reason-${item.id}`}
            />
          )}
        </Field>
        <Button variant="primary" onClick={() => void send()} disabled={busy} data-testid={`resend-${item.id}`}>
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