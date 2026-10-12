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

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ASSIGNOR_RELATIONSHIP_OPTIONS,
  TELEHEALTH_CONTENT,
  TELEHEALTH_IDENTITY_CHECKLIST,
  TELEHEALTH_NOT_DONE_REASONS,
  TELEHEALTH_NOT_DONE_NOTE_MAX,
} from '@aobplatform/domain';
import type { TelehealthMaskedContact, TelehealthSendResult, TelehealthSessionView } from '@aobplatform/contracts';
import { Button, Checkbox, Chip, Field, Notice, SelectInput, Shell, TextInput } from '../../../ui';
import { SessionControl } from '../../../SessionControl';
import { strings } from '../../../strings';
import { useRefreshable } from '../../../refresh';
import { useLiveRefresh } from '../../../useLiveRefresh';
import { apiHeaders } from '../../../auth';
import { usePractice } from '../../usePractice';
import styles from '../practitioner.module.css';

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
}

const WAITING_STATES = ['opened', 'code_checked'];
const LINK_STATES = ['opened', 'code_checked', 'agreed'];

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
  /** Which not-done form is open: a session id, or 'new' for the chosen patient with no session. */
  const [notDoneFor, setNotDoneFor] = useState<string | null>(null);

  const headers = useCallback(
    (json = false) => ({ ...apiHeaders(chosen), ...(json ? { 'content-type': 'application/json' } : {}) }),
    [chosen],
  );

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
  useLiveRefresh(sessions.some((s) => WAITING_STATES.includes(s.state)), loadSessions, LIVE_MS);

  const find = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const res = await fetch(`${CORE_URL}/telehealth/patients?q=${encodeURIComponent(term)}`, { headers: headers() }).catch(
      () => null,
    );
    if (!res) return setError(strings.status.unreachable);
    if (!res.ok) return setError(await refusal(res));
    setHits((await res.json()) as PatientHit[]);
  };

  const choose = async (hit: PatientHit) => {
    setPatient(hit);
    setSent(null);
    setTypes([]);
    setIsPatient(null);
    setRelationship('');
    setOver18(false);
    setChannel('');
    setError(null);
    const res = await fetch(`${CORE_URL}/telehealth/patients/${hit.patientId}/contact`, { headers: headers() }).catch(() => null);
    if (res?.ok) {
      const c = (await res.json()) as TelehealthMaskedContact;
      setContact(c);
      setChannel(c.maskedMobile ? 'sms' : c.maskedEmail ? 'email' : '');
    }
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
        headers: headers(true),
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
        headers: headers(true),
        body: JSON.stringify(body),
      }).catch(() => null);
      if (!res) return setError(strings.status.unreachable);
      if (!res.ok) return setError(await refusal(res));
      const result = (await res.json()) as TelehealthSendResult | TelehealthSessionView;
      if ('code' in result) setSent(result);
      setNotDoneFor(null);
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

  const noContact = contact !== null && !contact.maskedMobile && !contact.maskedEmail;
  const channels = contact
    ? (['sms', 'email', 'both'] as const).filter((c) =>
        c === 'sms' ? contact.maskedMobile : c === 'email' ? contact.maskedEmail : contact.maskedMobile && contact.maskedEmail,
      )
    : [];

  return (
    <Shell title={p.title} lead={p.lede} right={<SessionControl audience={strings.practitionerQueue.audience} />}>
      <p className={styles.cardBody}>{p.goesAhead}</p>
      {error && (
        <Notice tone="warn" data-testid="telehealth-error">
          {error}
        </Notice>
      )}

      <section aria-labelledby="th-find">
        <h2 id="th-find">{p.findHeading}</h2>
        <form onSubmit={(e) => void find(e)}>
          <Field label={p.searchLabel}>
            {({ id, describedBy }) => (
              <TextInput id={id} describedBy={describedBy} value={term} onChange={(e) => setTerm(e.target.value)} data-testid="telehealth-search" />
            )}
          </Field>
          <Button type="submit" data-testid="telehealth-find">
            {p.searchButton}
          </Button>
        </form>
        {hits && hits.length === 0 && <p data-testid="telehealth-no-matches">{p.noMatches}</p>}
        {hits && hits.length > 0 && (
          <ul data-testid="telehealth-hits">
            {hits.map((hit) => (
              <li key={hit.patientId}>
                {hit.givenNames} {hit.familyName} · {p.dateOfBirth(hit.dateOfBirth)}{' '}
                <Button onClick={() => void choose(hit)} data-testid={`telehealth-choose-${hit.patientId}`}>
                  {p.choose}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {patient && (
        <>
          <section aria-labelledby="th-check">
            <h2 id="th-check">{p.checkHeading}</h2>
            <p>{p.checkHint}</p>
            {TELEHEALTH_IDENTITY_CHECKLIST.map((type) => (
              <Checkbox
                key={type}
                label={p.identifierType[type] ?? type}
                checked={types.includes(type)}
                onCheckedChange={(on) => toggle(type, on)}
                testId={`telehealth-type-${type}`}
              />
            ))}
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
                  {contact.maskedMobile && (
                    <p data-testid="telehealth-mobile">
                      {p.mobileOnFile(contact.maskedMobile)} — {p.readBack(p.mobileEnding(mobileEnding(contact.maskedMobile)))}
                    </p>
                  )}
                  {contact.maskedEmail && (
                    <p data-testid="telehealth-email">
                      {p.emailOnFile(contact.maskedEmail)} — {p.readBack(p.emailLike(contact.maskedEmail))}
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
                  <Button variant="primary" onClick={() => void send()} disabled={!canSend || busy} data-testid="telehealth-send">
                    {busy ? p.sending : p.send}
                  </Button>
                </>
              )
            )}
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
          <p className={styles.cardTitle} data-testid="telehealth-code" aria-live="polite">
            {sent.code.split('').join(' ')}
          </p>
          <p>{p.codeHint(new Date(sent.codeExpiresAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }))}</p>
          <p>{p.queued(sent.queued.map((q) => p.channel[q]).join(' + '))}</p>
        </section>
      )}

      <section aria-labelledby="th-sessions">
        <h2 id="th-sessions">{p.sessionsHeading}</h2>
        {sessions.length === 0 && <p data-testid="telehealth-empty">{p.empty}</p>}
        <ul>
          {sessions.map((s) => (
            <li key={s.id} data-testid={`telehealth-session-${s.id}`}>
              <strong>{s.patientName}</strong>{' '}
              <Chip tone={s.state === 'agreed' ? 'ok' : s.state === 'not_done' || s.state === 'did_not_proceed' ? 'neutral' : 'warn'}>
                <span data-testid={`telehealth-status-${s.id}`}>{p.status[s.state] ?? s.state}</span>
              </Chip>
              {s.codeLocked && <Notice tone="stop">{p.locked}</Notice>}
              {!s.codeLocked && s.state === 'opened' && s.codeAttemptsLeft !== null && s.codeAttemptsLeft < TELEHEALTH_CONTENT.code.wrongAttemptsBeforeLock && (
                <span> {p.attemptsLeft(s.codeAttemptsLeft)}</span>
              )}
              {s.notDoneReason && <span> {p.reasonWas(p.reasons[s.notDoneReason] ?? s.notDoneReason)}</span>}
              {s.outcomeRecordedAt && <span> · {p.recordedAt(new Date(s.outcomeRecordedAt).toLocaleString('en-AU'))}</span>}
              {s.consultationAt && <span> · {p.consultationAt(new Date(s.consultationAt).toLocaleString('en-AU'))}</span>}
              <div>
                {LINK_STATES.includes(s.state) && s.linkSentCount > 0 && (
                  <Button onClick={() => void act(`sessions/${s.id}/send-again`, {})} disabled={busy} data-testid={`telehealth-send-again-${s.id}`}>
                    {p.sendAgain}
                  </Button>
                )}
                {WAITING_STATES.includes(s.state) && (
                  <Button variant="subtle" onClick={() => setNotDoneFor(s.id)} data-testid={`telehealth-not-done-${s.id}`}>
                    {p.markNotDone}
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
      </section>
    </Shell>
  );
}

/**
 * "NOT DONE, WITH A REASON" (§4). The reasons in content-file order with
 * labels from the string table; the note only for the reason that takes one,
 * with the warning against identifiers beside it; the consultation time
 * optional, because the recorded time is kept regardless.
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
  const [at, setAt] = useState('');
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
      <Field label={p.consultationAtLabel}>
        {({ id, describedBy }) => (
          <TextInput id={id} describedBy={describedBy} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} data-testid="telehealth-consultation-at" />
        )}
      </Field>
      <Button
        variant="primary"
        disabled={!ready || busy}
        onClick={() =>
          onSave({
            reason,
            ...(takesNote ? { note: note.trim() } : {}),
            ...(at ? { consultationAt: new Date(at).toISOString() } : {}),
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
