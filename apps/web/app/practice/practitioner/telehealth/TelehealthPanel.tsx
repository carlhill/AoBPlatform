'use client';

/**
 * THE PRACTITIONER'S TELEHEALTH PANEL (TELEHEALTH-PLAN.md §3 steps 2–8, §4).
 *
 * In order, as the call goes: find the patient (PMS sync), tick which KINDS of
 * identifier were checked on the call (the approved six, never the Medicare
 * number, never a value), say who is on the call, read back the masked contact
 * on file, choose SMS / email / both, Send — and the code appears here and
 * nowhere else. Below, the sessions from the last day with live status, and
 * the ways past: a fresh link and code, "not done, with a reason", "did not go
 * ahead".
 *
 * IT NEVER BLOCKS THE CONSULTATION (hard rule 8). Every refusal says what the
 * server observed for THIS record, and "not done" is always one press away,
 * including with no link sent at all.
 *
 * WHICH PRACTICE: the same rule as the waiting list. A practice claim wins,
 * then `?practice=`, then nothing (the server resolves the practitioner's one
 * practice). The server checks it against their own affiliations.
 *
 * The console's passkey sign-in is untouched (hard rule 15).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ASSIGNOR_RELATIONSHIP_OPTIONS,
  TELEHEALTH_CONTENT,
  TELEHEALTH_IDENTITY_CHECKLIST,
  TELEHEALTH_NOT_DONE_REASONS,
  TELEHEALTH_NOT_DONE_NOTE_MAX,
} from '@aobplatform/domain';
import type {
  TelehealthMaskedContact,
  TelehealthSendResult,
  TelehealthSessionDetail,
  TelehealthSessionView,
} from '@aobplatform/contracts';
import { Button, Checkbox, Chip, Field, Notice, SelectInput, Shell, TextInput } from '../../../ui';
import { SessionControl } from '../../../SessionControl';
import { strings } from '../../../strings';
import { useRefreshable } from '../../../refresh';
import { useLiveRefresh } from '../../../useLiveRefresh';
import { apiHeaders } from '../../../auth';
import { usePractice } from '../../usePractice';
import styles from '../practitioner.module.css';
import th from './telehealth.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';
/*
 * FASTER THAN THE CONSOLE'S DEFAULT, deliberately. `useLiveRefresh`'s 15 s
 * suits an event that arrives hours later; here the practitioner is on the
 * phone waiting for "code entered", which arrives in seconds. It still runs
 * only while a session is waiting and only while the tab is visible.
 */
const LIVE_MS = 3_000;
const p = strings.telehealth.panel;

interface PatientHit {
  patientId: string;
  givenNames: string;
  familyName: string;
  dateOfBirth: string;
  patientRecordNumber: string | null;
}

const WAITING_STATES = ['opened', 'code_checked'];
const LINK_STATES = ['opened', 'code_checked', 'agreed'];
/**
 * A fresh link and code only BEFORE the patient has agreed (Carl,
 * D-2026-10-12-03 item 3). Revisit when the DB4 goes to the patient's page
 * (TELEHEALTH-PLAN.md section 8 step 3): a page closed after agreeing then
 * needs a way back.
 */
const RESEND_STATES = ['opened', 'code_checked'];

type PatientRecord = TelehealthMaskedContact['record'];

/** The record's value for one kind of identifier, for the doctor to compare. Shown, never stored. */
export function recordValue(record: PatientRecord, type: string): string | null {
  switch (type) {
    case 'name':
      return `${record.givenNames} ${record.familyName}`;
    case 'date_of_birth':
      return record.dateOfBirth;
    case 'gender':
      return record.gender;
    case 'address':
      return record.address;
    case 'patient_record_number':
      return record.patientRecordNumber;
    case 'ihi':
      return record.ihi;
    default:
      return null;
  }
}

/**
 * IS ANYBODY STILL ABOUT TO ACT ON THIS SESSION? Only then is it worth
 * polling. A link whose code has lapsed or locked, or a page whose window has
 * closed, is not waiting for anything the patient can still do; polling it
 * forever would be a busy-loop wearing a status chip.
 */
export function isWaiting(
  s: Pick<TelehealthSessionView, 'state' | 'codeExpiresAt' | 'pageExpiresAt' | 'codeLocked'>,
  now: number,
): boolean {
  const ahead = (iso: string | null) => iso !== null && Date.parse(iso) > now;
  if (s.state === 'opened') return !s.codeLocked && ahead(s.codeExpiresAt);
  if (s.state === 'code_checked') return ahead(s.pageExpiresAt);
  return false;
}

/** The last three digits of a masked mobile ("•••••• 412" → "412"), for the read-back. */
export function mobileEnding(masked: string): string {
  return masked.replace(/\D/g, '').slice(-3);
}

/** A server refusal as words: the server's own message, which names the observation. */
async function refusal(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] | { message?: string } };
  const m = body.message;
  if (typeof m === 'string') return m;
  if (Array.isArray(m)) return m.join(' ');
  return String(res.status);
}

export function TelehealthPanel() {
  const { practiceId } = usePractice();
  const search = useSearchParams();
  const chosen = practiceId ?? search.get('practice') ?? undefined;

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<PatientHit[] | null>(null);
  const [patient, setPatient] = useState<PatientHit | null>(null);
  const [contact, setContact] = useState<TelehealthMaskedContact | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [isPatient, setIsPatient] = useState<boolean | null>(null);
  const [relationship, setRelationship] = useState('');
  const [over18, setOver18] = useState(false);
  const [channel, setChannel] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<TelehealthSendResult | null>(null);
  const [sessions, setSessions] = useState<TelehealthSessionView[]>([]);
  /** The patient chosen last. A contact answer for anybody else arrived late and is dropped. */
  const latestChoice = useRef<string | null>(null);
  /** Which session in the side panel is expanded to its details. */
  const [openSession, setOpenSession] = useState<string | null>(null);
  /** Which not-done form is open: a session id, or 'new' for the chosen patient with no session. */
  const [notDoneFor, setNotDoneFor] = useState<string | null>(null);

  /*
   * apiHeaders already says `Content-Type: application/json`. Adding a
   * lower-case `content-type` as well sent BOTH, the browser joined them into
   * "application/json, application/json", Nest's body parser did not
   * recognise that, and every POST arrived with an empty body (12 Oct 2026:
   * "Send the link" refused with every field missing). See apiHeaders.test.ts.
   */
  const headers = useCallback(() => apiHeaders(chosen), [chosen]);

  const loadSessions = useCallback(async () => {
    const res = await fetch(`${CORE_URL}/telehealth/sessions`, { headers: headers() }).catch(() => null);
    if (res?.ok) setSessions((await res.json()) as TelehealthSessionView[]);
  }, [headers]);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`${CORE_URL}/telehealth/enabled`, { headers: headers() }).catch(() => null);
      const body = res?.ok ? ((await res.json()) as { enabled: boolean }) : { enabled: false };
      setEnabled(body.enabled);
      if (body.enabled) await loadSessions();
    })();
  }, [headers, loadSessions]);

  useRefreshable(loadSessions);
  useLiveRefresh(sessions.some((s) => isWaiting(s, Date.now())), loadSessions, LIVE_MS);

  /** Back to the list: nothing about the patient who was chosen survives, least of all their contact. */
  const clearChoice = () => {
    latestChoice.current = null;
    setPatient(null);
    setContact(null);
    setSent(null);
    setTypes([]);
    setIsPatient(null);
    setRelationship('');
    setOver18(false);
    setChannel('');
    setNotDoneFor(null);
    setError(null);
  };

  /** The term searched last. An answer for an older term arrived late and is dropped. */
  const latestTerm = useRef('');

  const searchPatients = useCallback(
    async (q: string, sayRefusal: boolean) => {
      latestTerm.current = q;
      const res = await fetch(`${CORE_URL}/telehealth/patients?q=${encodeURIComponent(q)}`, { headers: headers() }).catch(() => null);
      if (latestTerm.current !== q) return;
      if (!res) return sayRefusal ? setError(strings.status.unreachable) : undefined;
      if (!res.ok) {
        const said = await refusal(res);
        return sayRefusal && latestTerm.current === q ? setError(said) : undefined;
      }
      const found = (await res.json()) as PatientHit[];
      if (latestTerm.current === q) setHits(found);
    },
    [headers],
  );

  /** START A NEW CONSULTATION (Carl, 12 Oct 2026): a clean form, search box included. Sessions already sent are untouched. */
  const startNew = () => {
    clearChoice();
    latestTerm.current = '';
    setTerm('');
    setHits(null);
  };

  const find = async (event: React.FormEvent) => {
    event.preventDefault();
    // A new search is a new choice: the list it returns must be choosable.
    clearChoice();
    await searchPatients(term, true);
  };

  /*
   * SEARCH AS YOU TYPE (Carl, D-2026-10-12-03 item 4): the matches drop down
   * under the box once there are enough characters for the server to answer
   * (it refuses fewer than two: this is not a patient directory). Typing
   * after a choice starts a new choice.
   */
  const typeTerm = (value: string) => {
    setTerm(value);
    if (patient) clearChoice();
  };
  useEffect(() => {
    if (patient || term.trim().length < 2) {
      if (!patient) setHits(null);
      return;
    }
    const timer = setTimeout(() => void searchPatients(term, false), 300);
    return () => clearTimeout(timer);
  }, [term, patient, searchPatients]);

  const choose = async (hit: PatientHit) => {
    // Nothing from the last patient survives a new choice, least of all their contact.
    latestChoice.current = hit.patientId;
    setContact(null);
    setPatient(hit);
    setSent(null);
    setTypes([]);
    setIsPatient(null);
    setRelationship('');
    setOver18(false);
    setChannel('');
    setError(null);
    const res = await fetch(`${CORE_URL}/telehealth/patients/${hit.patientId}/contact`, { headers: headers() }).catch(() => null);
    // OUT OF ORDER IS NORMAL: a slow answer for the previous patient must never land under this one.
    if (latestChoice.current !== hit.patientId) return;
    if (!res) return setError(strings.status.unreachable);
    if (!res.ok) {
      const said = await refusal(res);
      if (latestChoice.current !== hit.patientId) return;
      return setError(said);
    }
    const c = (await res.json()) as TelehealthMaskedContact;
    if (latestChoice.current !== hit.patientId || c.patientId !== hit.patientId) return;
    setContact(c);
    setChannel(c.maskedMobile ? 'sms' : c.maskedEmail ? 'email' : '');
  };

  const toggle = (type: string, on: boolean) =>
    setTypes((was) => (on ? [...new Set([...was, type])] : was.filter((t) => t !== type)));

  const canSend =
    patient !== null &&
    types.length >= 3 &&
    channel !== '' &&
    (isPatient === true || (isPatient === false && relationship !== '' && over18));

  const send = async () => {
    if (!patient || !canSend) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/telehealth/sessions`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          patientId: patient.patientId,
          identifierTypes: types,
          channel,
          consenterIsPatient: isPatient,
          ...(isPatient ? {} : { consenterRelationship: relationship, consenterAttested18: over18 }),
        }),
      }).catch(() => null);
      if (!res) return setError(strings.status.unreachable);
      if (!res.ok) return setError(await refusal(res));
      setSent((await res.json()) as TelehealthSendResult);
      await loadSessions();
    } finally {
      setBusy(false);
    }
  };

  const act = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/telehealth/${path}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      }).catch(() => null);
      if (!res) return setError(strings.status.unreachable);
      if (!res.ok) return setError(await refusal(res));
      const result = (await res.json()) as TelehealthSendResult | TelehealthSessionView;
      if ('code' in result) setSent(result);
      setNotDoneFor(null);
      // AN OUTCOME ENDS THE CALL, SO THE FORM GOES BLANK (Carl, 12 Oct 2026). The session stays in the panel.
      if (/(^|\/)(went-ahead|did-not-proceed|not-done)$/.test(path)) startNew();
      await loadSessions();
    } finally {
      setBusy(false);
    }
  };

  if (enabled === false) {
    return (
      <Shell title={p.title} right={<SessionControl audience={strings.practitionerQueue.audience} />}>
        <Notice tone="warn" title={p.notEnabledTitle} data-testid="telehealth-not-enabled">
          {p.notEnabledBody}
        </Notice>
      </Shell>
    );
  }

  const errorNotice = (
    <Notice tone="warn" data-testid="telehealth-error">
      {error}
    </Notice>
  );

  const noContact = contact !== null && !contact.maskedMobile && !contact.maskedEmail;
  const channels = contact
    ? (['sms', 'email', 'both'] as const).filter((c) =>
        c === 'sms' ? contact.maskedMobile : c === 'email' ? contact.maskedEmail : contact.maskedMobile && contact.maskedEmail,
      )
    : [];

  return (
    <Shell title={p.title} lead={p.lede} right={<SessionControl audience={strings.practitionerQueue.audience} />}>
     <div className={th.layout}>
      <div className={th.main}>
      <div className={th.newRow}>
        <p className={styles.cardBody}>{p.goesAhead}</p>
        <Button variant="primary" onClick={startNew} data-testid="telehealth-start-new">
          {p.startNew}
        </Button>
      </div>
      {/* Once a patient is chosen the refusal shows by the Send button, where the eye is, not off-screen up here. */}
      {error && !patient && errorNotice}

      <section aria-labelledby="th-find">
        <h2 id="th-find">{p.findHeading}</h2>
        {/*
         * WHO IS CHOSEN IS SHOWN, NOT IMPLIED (Carl, 12 Oct 2026: pressing
         * Choose changed nothing he could see). The matches drop down under
         * the box, each with its record number because several records can
         * share a name and a date of birth; once one is chosen the list folds
         * away, the choice says so, and "Choose someone else" starts again.
         */}
        <form onSubmit={(e) => void find(e)} className={th.picker}>
          <div className={th.searchRow}>
            <Field label={p.searchLabel}>
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  describedBy={describedBy}
                  value={term}
                  placeholder={p.searchPlaceholder}
                  autoComplete="off"
                  onChange={(e) => typeTerm(e.target.value)}
                  data-testid="telehealth-search"
                />
              )}
            </Field>
            {/* No Find button (Carl, 12 Oct 2026): the matches come up as you type; Enter still searches at once. */}
          </div>
          {!patient && hits && hits.length === 0 && <p data-testid="telehealth-no-matches">{p.noMatches}</p>}
          {!patient && hits && hits.length > 0 && (
            <ul className={th.dropdown} data-testid="telehealth-hits" aria-label={p.findHeading}>
              {hits.map((hit) => (
                <li key={hit.patientId}>
                  <button type="button" className={th.option} onClick={() => void choose(hit)} data-testid={`telehealth-choose-${hit.patientId}`}>
                    <span className={th.optionName}>
                      {hit.givenNames} {hit.familyName}
                    </span>
                    <span className={th.optionMeta}>
                      {p.dateOfBirth(hit.dateOfBirth)}
                      {hit.patientRecordNumber ? ` · ${p.recordNumber(hit.patientRecordNumber)}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
        {patient && (
          <div className={th.chosen} data-testid="telehealth-chosen">
            <strong>
              {patient.givenNames} {patient.familyName}
            </strong>
            <span>
              {p.dateOfBirth(patient.dateOfBirth)}
              {patient.patientRecordNumber ? ` · ${p.recordNumber(patient.patientRecordNumber)}` : ''}
            </span>
            <Chip tone="ok">{p.chosen}</Chip>
            <Button variant="subtle" onClick={clearChoice} data-testid="telehealth-choose-again">
              {p.chooseSomeoneElse}
            </Button>
          </div>
        )}
      </section>

      {patient && (
        <>
          <section aria-labelledby="th-check">
            <h2 id="th-check">{p.checkHeading}</h2>
            <p>{p.checkHint}</p>
            {TELEHEALTH_IDENTITY_CHECKLIST.map((type) => {
              const value = contact ? recordValue(contact.record, type) : null;
              return (
                <div key={type} className={th.checkRow}>
                  <Checkbox
                    label={p.identifierType[type] ?? type}
                    checked={types.includes(type)}
                    onCheckedChange={(on) => toggle(type, on)}
                    testId={`telehealth-type-${type}`}
                  />
                  {contact && (
                    <span className={value ? th.recordValue : th.recordNone} data-testid={`telehealth-record-${type}`}>
                      {value ?? p.recordNone}
                    </span>
                  )}
                </div>
              );
            })}
            {types.length < 3 && <p data-testid="telehealth-need-three">{p.needThree(types.length)}</p>}
          </section>

          <section aria-labelledby="th-who">
            <h2 id="th-who">{p.whoHeading}</h2>
            <Checkbox label={p.whoPatient} checked={isPatient === true} onCheckedChange={(on) => setIsPatient(on ? true : null)} testId="telehealth-who-patient" />
            <Checkbox
              label={p.whoSomeoneElse}
              checked={isPatient === false}
              onCheckedChange={(on) => setIsPatient(on ? false : null)}
              testId="telehealth-who-someone-else"
            />
            {isPatient === false && (
              <>
                <Field label={p.relationshipLabel}>
                  {({ id, describedBy }) => (
                    <SelectInput id={id} describedBy={describedBy} value={relationship} onChange={(e) => setRelationship(e.target.value)} data-testid="telehealth-relationship">
                      <option value="">{p.relationshipChoose}</option>
                      {ASSIGNOR_RELATIONSHIP_OPTIONS.map((o) => (
                        <option key={o.key} value={o.key}>
                          {strings.kiosk.assignor.relationshipNames[o.key] ?? o.key}
                        </option>
                      ))}
                    </SelectInput>
                  )}
                </Field>
                <Checkbox label={p.attested18} checked={over18} onCheckedChange={setOver18} testId="telehealth-over-18" />
              </>
            )}
          </section>

          <section aria-labelledby="th-contact">
            <h2 id="th-contact">{p.contactHeading}</h2>
            {noContact ? (
              <Notice tone="warn" data-testid="telehealth-no-contact">
                {p.noContact}
              </Notice>
            ) : (
              contact && (
                <>
                  <p>{p.askContact}</p>
                  {contact.record.mobile && (
                    <p className={th.recordValue} data-testid="telehealth-mobile">
                      {p.mobileFull(contact.record.mobile)}
                    </p>
                  )}
                  {contact.record.email && (
                    <p className={th.recordValue} data-testid="telehealth-email">
                      {p.emailFull(contact.record.email)}
                    </p>
                  )}
                  <Field label={p.channelLabel}>
                    {({ id, describedBy }) => (
                      <SelectInput id={id} describedBy={describedBy} value={channel} onChange={(e) => setChannel(e.target.value)} data-testid="telehealth-channel">
                        {channels.map((c) => (
                          <option key={c} value={c}>
                            {p.channel[c]}
                          </option>
                        ))}
                      </SelectInput>
                    )}
                  </Field>
                  {/* ONE SEND PER CHOICE (Carl, 12 Oct 2026): once sent, the button goes; a new link is offered by the code. */}
                  {sent ? (
                    <p data-testid="telehealth-sent-note">{p.sentNote}</p>
                  ) : (
                    <Button variant="primary" onClick={() => void send()} disabled={!canSend || busy} data-testid="telehealth-send">
                      {busy ? p.sending : p.send}
                    </Button>
                  )}
                </>
              )
            )}
            {error && errorNotice}
            <p>
              <Button variant="subtle" onClick={() => setNotDoneFor('new')} data-testid="telehealth-record-not-done">
                {p.recordNotDone}
              </Button>
            </p>
            {notDoneFor === 'new' && (
              <NotDoneForm
                busy={busy}
                onCancel={() => setNotDoneFor(null)}
                onSave={(body) => void act('not-done', { ...body, patientId: patient.patientId })}
              />
            )}
          </section>
        </>
      )}

      {sent && (
        <section aria-labelledby="th-code" className={styles.card} data-testid="telehealth-code-panel">
          <h2 id="th-code">{p.codeHeading}</h2>
          <p data-testid="telehealth-code-for">
            {p.codeFor(sent.session.patientName)} · {p.consultationId(sent.session.consultationId)}
          </p>
          <p className={th.code} data-testid="telehealth-code" aria-live="polite">
            {sent.code.split('').join(' ')}
          </p>
          <p>{p.codeHint(new Date(sent.codeExpiresAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }))}</p>
          <p>{p.queued(sent.queued.map((q) => p.channel[q]).join(' + '))}</p>
          {/* Where the eye is after sending: a fresh link and code for this same session, if it did not arrive. */}
          <p>
            {p.didNotArrive}{' '}
            <Button
              onClick={() => void act(`sessions/${sent.session.id}/send-again`, {})}
              disabled={busy}
              data-testid="telehealth-code-send-again"
            >
              {p.sendAgain}
            </Button>
          </p>
        </section>
      )}
      </div>

      {/* THE DOCTOR'S SESSIONS, BESIDE THE STEPS (Carl, D-2026-10-12-03 item 5); below them on a narrow screen. */}
      <aside aria-labelledby="th-sessions" className={th.aside}>
        <h2 id="th-sessions">{p.sessionsHeading}</h2>
        {sessions.length === 0 && <p data-testid="telehealth-empty">{p.empty}</p>}
        <ul className={th.sessions}>
          {sessions.map((s) => (
            <li key={s.id} className={th.session} data-testid={`telehealth-session-${s.id}`}>
              {/* Click the name for everything a call-back needs (Carl, 12 Oct 2026), without leaving the page. */}
              <button
                type="button"
                className={th.sessionName}
                aria-expanded={openSession === s.id}
                onClick={() => setOpenSession(openSession === s.id ? null : s.id)}
                data-testid={`telehealth-open-${s.id}`}
              >
                {s.patientName}
              </button>
              {openSession === s.id && <SessionDetails sessionId={s.id} headers={headers} />}
              <span className={th.reference} data-testid={`telehealth-id-${s.id}`}>
                {p.consultationId(s.consultationId)}
              </span>
              {/* Who agreed for the patient, and how to reach them (D-2026-10-12-03 item 12). */}
              {s.consenterName && (
                <span data-testid={`telehealth-consenter-${s.id}`}>{p.consenter(s.consenterName, s.consenterMobile ?? '')}</span>
              )}
              <Chip tone={s.state === 'agreed' || s.state === 'went_ahead' ? 'ok' : s.state === 'not_done' || s.state === 'did_not_proceed' ? 'neutral' : 'warn'}>
                <span data-testid={`telehealth-status-${s.id}`}>{p.status[s.state] ?? s.state}</span>
              </Chip>
              {s.codeLocked && <Notice tone="stop">{p.locked}</Notice>}
              {!s.codeLocked && s.state === 'opened' && s.codeAttemptsLeft !== null && s.codeAttemptsLeft < TELEHEALTH_CONTENT.code.wrongAttemptsBeforeLock && (
                <span> {p.attemptsLeft(s.codeAttemptsLeft)}</span>
              )}
              {s.notDoneReason && <span> {p.reasonWas(p.reasons[s.notDoneReason] ?? s.notDoneReason)}</span>}
              {s.outcomeRecordedAt && <span> · {p.recordedAt(new Date(s.outcomeRecordedAt).toLocaleString('en-AU'))}</span>}
              {s.consultationAt && <span> · {p.consultationAt(new Date(s.consultationAt).toLocaleString('en-AU'))}</span>}
              <div className={th.sessionActions}>
                {RESEND_STATES.includes(s.state) && s.linkSentCount > 0 && (
                  <Button onClick={() => void act(`sessions/${s.id}/send-again`, {})} disabled={busy} data-testid={`telehealth-send-again-${s.id}`}>
                    {p.sendAgain}
                  </Button>
                )}
                {WAITING_STATES.includes(s.state) && (
                  <Button variant="subtle" onClick={() => setNotDoneFor(s.id)} data-testid={`telehealth-not-done-${s.id}`}>
                    {p.markNotDone}
                  </Button>
                )}
                {/* The two outcomes after the patient agreed (Carl, D-2026-10-12-03 item 6). */}
                {s.state === 'agreed' && (
                  <Button
                    variant="primary"
                    onClick={() => void act(`sessions/${s.id}/went-ahead`, {})}
                    disabled={busy}
                    data-testid={`telehealth-went-ahead-${s.id}`}
                  >
                    {p.wentAhead}
                  </Button>
                )}
                {LINK_STATES.includes(s.state) && (
                  <Button
                    variant="subtle"
                    onClick={() => void act(`sessions/${s.id}/did-not-proceed`, {})}
                    disabled={busy}
                    data-testid={`telehealth-did-not-proceed-${s.id}`}
                  >
                    {p.didNotProceed}
                  </Button>
                )}
              </div>
              {notDoneFor === s.id && (
                <NotDoneForm busy={busy} onCancel={() => setNotDoneFor(null)} onSave={(body) => void act(`sessions/${s.id}/not-done`, body)} />
              )}
            </li>
          ))}
        </ul>
      </aside>
     </div>
    </Shell>
  );
}

/**
 * "NOT DONE, WITH A REASON" (§4). The reasons in content-file order with
 * labels from the string table; the note only for the reason that takes one,
 * with the warning against identifiers beside it. NO DATE (Carl, 12 Oct 2026):
 * the panel shows today's calls, and the time it is recorded is kept anyway.
 */
export function NotDoneForm({
  busy,
  onSave,
  onCancel,
}: {
  busy: boolean;
  onSave: (body: { reason: string; note?: string; consultationAt?: string }) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const takesNote = TELEHEALTH_NOT_DONE_REASONS.find((r) => r.key === reason)?.takesNote ?? false;
  const ready = reason !== '' && (!takesNote || note.trim().length > 0);

  return (
    <div className={styles.card} data-testid="telehealth-not-done-form">
      <h3>{p.notDoneHeading}</h3>
      <Field label={p.reasonLabel}>
        {({ id, describedBy }) => (
          <SelectInput id={id} describedBy={describedBy} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="telehealth-reason">
            <option value="">{p.reasonChoose}</option>
            {TELEHEALTH_NOT_DONE_REASONS.map((r) => (
              <option key={r.key} value={r.key}>
                {p.reasons[r.key] ?? r.key}
              </option>
            ))}
          </SelectInput>
        )}
      </Field>
      {takesNote && (
        <Field label={p.noteLabel} hint={p.noteWarning}>
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              describedBy={describedBy}
              maxLength={TELEHEALTH_NOT_DONE_NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              data-testid="telehealth-note"
            />
          )}
        </Field>
      )}
      <Button
        variant="primary"
        disabled={!ready || busy}
        onClick={() =>
          onSave({
            reason,
            ...(takesNote ? { note: note.trim() } : {}),
          })
        }
        data-testid="telehealth-save-not-done"
      >
        {p.save}
      </Button>{' '}
      <Button variant="subtle" onClick={onCancel}>
        {p.cancel}
      </Button>
    </div>
  );
}

/**
 * ONE SESSION, EXPANDED IN THE SIDE PANEL (Carl, 12 Oct 2026): what a doctor
 * needs to call back, in an emergency above all, without leaving the page.
 * The patient's record and contact are read NOW from the practice's records
 * (so a call-back uses today's number), with the kinds of detail checked on
 * the call and who was on it. Read only; fetched each time it is opened.
 */
export function SessionDetails({ sessionId, headers }: { sessionId: string; headers: () => Record<string, string> }) {
  const [detail, setDetail] = useState<TelehealthSessionDetail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await fetch(`${CORE_URL}/telehealth/sessions/${sessionId}`, { headers: headers() }).catch(() => null);
      if (!live) return;
      if (!res) return setFailed(strings.status.unreachable);
      if (!res.ok) return setFailed(await refusal(res));
      setDetail((await res.json()) as TelehealthSessionDetail);
    })();
    return () => {
      live = false;
    };
  }, [sessionId, headers]);

  if (failed) return <Notice tone="warn">{failed}</Notice>;
  if (!detail) return <p className={styles.cardBody}>{p.detailLoading}</p>;
  const { session, record } = detail;
  const row = (label: string, value: string | null, testId?: string) => (
    <>
      <dt>{label}</dt>
      <dd data-testid={testId} className={value ? undefined : th.recordNone}>
        {value ?? p.recordNone}
      </dd>
    </>
  );
  return (
    <dl className={th.details} data-testid={`telehealth-detail-${sessionId}`}>
      {row(p.consultationIdLabel, session.consultationId)}
      {record ? (
        <>
          {row(p.identifierType.name, `${record.givenNames} ${record.familyName}`)}
          {row(p.identifierType.date_of_birth, record.dateOfBirth)}
          {row(p.identifierType.gender, record.gender)}
          {row(p.identifierType.address, record.address)}
          {row(p.identifierType.patient_record_number, record.patientRecordNumber)}
          {row(p.mobileLabel, record.mobile, `telehealth-detail-mobile-${sessionId}`)}
          {row(p.emailLabel, record.email)}
        </>
      ) : (
        row(p.recordLabel, null)
      )}
      {row(p.checkedLabel, session.identifierTypes.map((type) => p.identifierType[type] ?? type).join(', ') || null)}
      {row(
        p.whoLabel,
        session.consenterIsPatient === false
          ? p.whoSomeoneElseWas(
              strings.kiosk.assignor.relationshipNames[detail.consenterRelationship ?? ''] ?? detail.consenterRelationship ?? '',
              session.consenterName,
            )
          : session.consenterIsPatient
            ? p.whoPatient
            : null,
      )}
      {session.consenterIsPatient === false && row(p.consenterMobileLabel, session.consenterMobile, `telehealth-detail-carer-mobile-${sessionId}`)}
      {row(p.sentByLabel, session.channel ? (p.channel[session.channel] ?? session.channel) : null)}
    </dl>
  );
}