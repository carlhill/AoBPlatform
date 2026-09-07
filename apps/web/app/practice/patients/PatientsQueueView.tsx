'use client';

/**
 * PATIENTS — reception's queue, one row per person (TODO.md
 * "Reception-centric: the patient work page", Carl 4 Sep 2026).
 *
 * WHY A LIST OF PEOPLE RATHER THAN A LIST OF AGREEMENTS. Reception's job is
 * one patient at a time: somebody is standing at the desk, and everything
 * about them — the agreement waiting, the tablet they were handed, the detail
 * they said was wrong, the reminder due — is spread over four screens today.
 * This is the front door to the one screen that has all of it.
 *
 * IT IS NOT A PATIENT DIRECTORY, AND MUST NEVER BECOME ONE. The server answers
 * exactly one question — who has something open today (`?open=today`, and any
 * other value is refused) — so there is no list of everybody and no way to ask
 * for one. The practice management system holds the patient record
 * (REQ-DATA-10).
 *
 * TYPE-TO-FIND RUNS IN THE BROWSER, over rows the server already scoped to
 * this practice by RLS. It narrows what is on screen and asks the server
 * nothing, which is what stops a filter box from quietly becoming a search
 * endpoint for people who are not on the list.
 *
 * WHAT A ROW SAYS, AND WHAT IT NEVER SAYS. A name, and ONE LINE about what is
 * open — no other patient value, not even a date of birth (Carl, 4 Sep 2026:
 * a front-counter list polled every three seconds is a STATUS, not a mirror
 * of the patient record — TODO.md). The date of birth stays on the work page,
 * read once when it opens, not on the poll. Never a Medicare number, which is
 * not an identity identifier and is not held here at all (hard rule 1,
 * REQ-VER-02), and never a dollar amount (hard rule 4). The disputed details
 * are TYPES, in our words (REQ-VER-04).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, ClipboardList, UserRound } from 'lucide-react';
import type { ArrivalProviderChoice, RefusedArrival } from '@aobplatform/contracts';
import {
  audiencesOf,
  mayReach,
  type Audience,
  type PatientQueueItem,
  type PatientQueueRow,
} from '@aobplatform/domain';
import { Button, Chip, Field, Notice, SelectInput, Section, Shell, TextInput, ui, type Tone } from '../../ui';
import { strings } from '../../strings';
import { apiHeaders, currentSession } from '../../auth';
import { SessionControl } from '../../SessionControl';
import styles from '../manage.module.css';
import { POLL_MS, disputedLabels, shortSessionId } from '../tablet/pushDesk';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/** "3 March 1957" — the same date, read the way a receptionist reads one. */
export function bornOn(dateOfBirth: string): string {
  const parsed = new Date(`${dateOfBirth}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateOfBirth;
  return parsed.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * THE FRESHEST TRUE THING ABOUT THIS PATIENT, IN ONE LINE.
 *
 * ORDERED BY WHAT SOMEBODY MUST DO, not by what happened last. An unanswered
 * cross needs a person to get up; a live session needs watching; a resolved
 * cross needs a re-send; an agreement waiting needs sending. A row that led
 * with "sent to a tablet at 9:04" while a patient stood at the counter saying
 * their address was wrong would be true and useless.
 *
 * THE WORDS ARE THE TABLET PAGE'S OWN wherever the same thing is being said,
 * so one act is not described two ways in one console (REQ-LANG-01).
 */
export function queueSummary(row: Pick<PatientQueueRow, 'items'>): string {
  const items = row.items;

  const unanswered = items.find(
    (item) => (item.disputedDetails?.length ?? 0) > 0 && !item.disputeResolution,
  );
  if (unanswered) return strings.tablet.disputedList(disputedLabels(unanswered.disputedDetails ?? []));

  /*
   * A REQUEST THE PATIENT MADE THEMSELVES, which nobody here has answered. It
   * outranks everything except an unanswered cross because it is the only line
   * on this list that somebody is waiting on us for -- possibly since a day
   * they were nowhere near the practice.
   */
  const correction = items.find((item) => item.kind === 'portal_correction_requested');
  if (correction) {
    return strings.patients.summaryCorrection(
      correction.fieldType
        ? (strings.kiosk.checkDetails.detailNames[correction.fieldType] ?? correction.fieldType)
        : strings.patients.identityTitle,
    );
  }

  /*
   * A PORTAL INVITATION THAT LOCKED, which is also somebody waiting on us and
   * has been since their third attempt (Carl, 5 Sep 2026). Below a request they
   * made in words, above a tablet that is merely busy. The line says what it
   * needs -- a new invitation -- and never which detail did not match, because
   * the platform does not tell the practice that (REQ-VER-04, hard rule 9).
   */
  if (items.some((item) => item.kind === 'portal_activation_locked')) {
    return strings.patients.summaryLocked;
  }

  /*
   * AN ANSWERED CROSS OUTRANKS THE LIVE SESSION IT IS STILL SITTING ON. The
   * session stays `details_disputed` after reception answers -- a resolution
   * is a fact about the dispute, not a new state -- and the thing left to do
   * is send it again, which is what the row should say.
   */
  const resolved = items.find((item) => item.disputeResolution);
  if (resolved) return strings.tablet.resolvedTitle;

  const live = items.find((item) => item.kind === 'session' && item.endedAt === null);
  if (live) {
    const where = strings.tablet.onTabletNow(live.deviceLabel ?? '');
    return live.sessionId
      ? `${where} · ${strings.tablet.sessionTag(shortSessionId(live.sessionId))}`
      : where;
  }

  const waiting = items.find((item) => item.kind === 'awaiting_signature');
  if (waiting) return waiting.pushable ? strings.patients.summaryAwaiting : strings.patients.summaryBlocked;

  const ended = items.find((item) => item.kind === 'session');
  if (ended?.sessionState) {
    return strings.patients.summaryEnded(
      strings.tablet.states[ended.sessionState] ?? ended.sessionState,
    );
  }

  return strings.patients.summaryNothing;
}

/** Stop-tone for a cross nobody has answered; warn while a tablet is live. */
export function queueTone(row: Pick<PatientQueueRow, 'items'>): Tone {
  if (row.items.some((item) => (item.disputedDetails?.length ?? 0) > 0 && !item.disputeResolution)) {
    return 'stop';
  }
  // Somebody is waiting on us, and has been since they pressed the button.
  if (row.items.some((item) => item.kind === 'portal_correction_requested')) return 'warn';
  if (row.items.some((item) => item.kind === 'portal_activation_locked')) return 'warn';
  if (row.items.some((item) => item.kind === 'session' && item.endedAt === null)) return 'warn';
  return 'neutral';
}

/** Name or date of birth, matched the way somebody types at a counter. */
export function matchesTerm(row: PatientQueueRow, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    row.patientName.toLowerCase().includes(needle) || row.dateOfBirth.toLowerCase().includes(needle)
  );
}

export function PatientsQueueView({ practiceId }: { practiceId: string }) {
  const [rows, setRows] = useState<PatientQueueRow[] | null>(null);
  /*
   * ARRIVALS REFUSED FOR NAMING SOMEBODY THE CLAIM CANNOT GO UNDER (Carl,
   * 5–7 Sep 2026). Kept apart from `rows`: a refused arrival has no agreement
   * and may have no patient record at all, so it is not a `PatientQueueRow`,
   * and pretending it is would mean inventing a patient id for somebody the
   * platform has deliberately not written down yet.
   */
  const [refused, setRefused] = useState<RefusedArrival[]>([]);
  const [choices, setChoices] = useState<ArrivalProviderChoice[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [term, setTerm] = useState('');

  /*
   * THE SESSION'S OWN CLAIM, NEVER THE PAGE'S PROP — the same rule every other
   * practice screen follows. The prop says which practice the page is ABOUT;
   * only the token says what the caller may do.
   */
  const audiences: Audience[] = useMemo(() => {
    const session = currentSession();
    return audiencesOf({
      roles: session?.roles,
      practiceId: session?.practiceId ?? null,
      practitionerId: session?.practitionerId,
    });
  }, []);
  const canAct = mayReach('/practice/patients', audiences) && audiences.includes('practice');

  const load = useCallback(async () => {
    try {
      const scope = apiHeaders(practiceId);
      const [res, refusedRes, choicesRes] = await Promise.all([
        fetch(`${CORE_URL}/patients?open=today`, { headers: scope }),
        fetch(`${CORE_URL}/arrivals/needing-a-provider`, { headers: scope }),
        fetch(`${CORE_URL}/arrivals/servicing-providers`, { headers: scope }),
      ]);
      if (!res.ok) throw new Error(String(res.status));
      setRows((await res.json()) as PatientQueueRow[]);
      // Neither of the other two is worth failing the page for: the queue is
      // the subject, and a section that cannot be filled shows nothing.
      setRefused(refusedRes.ok ? ((await refusedRes.json()) as RefusedArrival[]) : []);
      setChoices(choicesRes.ok ? ((await choicesRes.json()) as ArrivalProviderChoice[]) : []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof TypeError ? strings.status.unreachable : (e as Error).message);
    }
  }, [practiceId]);

  /*
   * THE SAME THREE SECONDS AS `/practice/tablet`, and for the same reason: a
   * receptionist glancing at this list while a patient ticks five boxes needs
   * the state within a breath. A poll, not a socket — a dead socket fails
   * silently and a poll fails visibly.
   */
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    void latest.current();
    const timer = setInterval(() => void latest.current(), POLL_MS);
    return () => clearInterval(timer);
  }, [practiceId]);

  const shown = (rows ?? []).filter((row) => matchesTerm(row, term));

  if (loadError && rows === null) {
    return (
      <Shell
        right={<SessionControl audience={strings.patients.audience} />}
        title={strings.patients.title}
        lead={strings.patients.lead}
      >
        <Notice tone="stop" title={strings.patients.notLoaded}>
          {loadError}
        </Notice>
      </Shell>
    );
  }

  return (
    <Shell
      right={<SessionControl audience={strings.patients.audience} />}
      title={strings.patients.title}
      lead={strings.patients.lead}
    >
      {loadError && (
        <Notice tone="warn" title={strings.patients.notLoaded}>
          {loadError}
        </Notice>
      )}

      {/*
        LOOKING, NOT WORKING — the same banner every practice screen shows to
        somebody without the practice's own claim. Every act behind the rows is
        `@PracticeScoped` on the server and would refuse them anyway.
      */}
      {!canAct && (
        <Notice tone="warn" title={strings.viewOnly.title} data-testid="patients-view-only">
          {strings.viewOnly.body}
        </Notice>
      )}

      {/*
        ARRIVALS WAITING FOR A PROVIDER, ABOVE THE QUEUE.

        Above, because somebody is standing at the desk and nothing else on
        this page is about them yet — there is no agreement, no tablet row and
        no work page, which is precisely the state that would otherwise be
        invisible. The reason and the fix are ON the row (Carl, 4 Sep 2026).
      */}
      {refused.length > 0 && (
        <Section number={0} title={strings.needsProvider.title}>
          <p className={ui.hint}>{strings.needsProvider.lead}</p>
          <div className={styles.queueSummary}>
            <Chip tone="warn">{strings.needsProvider.count(refused.length)}</Chip>
          </div>
          <ul className={styles.list} data-testid="needs-provider-list">
            {refused.map((arrival) => (
              <NeedsProviderCard
                key={arrival.arrivalId}
                arrival={arrival}
                choices={choices}
                canAct={canAct}
                practiceId={practiceId}
                onDone={load}
              />
            ))}
          </ul>
        </Section>
      )}

      <Section number={1} title={strings.patients.title}>
        <div className={styles.queueSummary}>
          <Chip tone={rows && rows.length ? 'warn' : 'ok'}>{strings.patients.count(rows?.length ?? 0)}</Chip>
        </div>

        <Field label={strings.patients.findLabel}>
          {(p) => (
            <TextInput
              {...p}
              value={term}
              placeholder={strings.patients.findPlaceholder}
              maxLength={100}
              onChange={(e) => setTerm(e.target.value)}
              data-testid="patients-find"
            />
          )}
        </Field>

        {rows === null && <p className={ui.hint}>{strings.patients.loading}</p>}

        {rows !== null && rows.length === 0 && (
          <div className={styles.empty}>
            <ClipboardList size={22} aria-hidden="true" />
            <p className={styles.emptyTitle}>{strings.patients.none}</p>
            <p className={ui.hint}>{strings.patients.noneHint}</p>
          </div>
        )}

        {rows !== null && rows.length > 0 && shown.length === 0 && (
          <p className={ui.hint} data-testid="patients-no-match">
            {strings.patients.noMatch(term.trim())}
          </p>
        )}

        <ul className={styles.list} data-testid="patients-list">
          {shown.map((row) => (
            <li key={row.patientId} className={styles.card} data-testid={`patient-${row.patientId}`}>
              {/*
                THE WHOLE ROW IS THE LINK. One press from "who is this" to
                everything about them — the point of the page.
              */}
              <Link href={`/practice/patients/${row.patientId}`} className={styles.cardHead}>
                <span className={styles.cardIcon}>
                  <UserRound size={18} aria-hidden="true" />
                </span>
                <div className={styles.cardMain}>
                  <p className={styles.cardTitle}>{row.patientName}</p>
                  <p className={styles.cardSub} data-testid={`patient-summary-${row.patientId}`}>
                    {queueSummary(row)}
                  </p>
                </div>
                <div className={styles.cardAside}>
                  <Chip tone={queueTone(row)}>{strings.patients.open(row.items.length)}</Chip>
                  <ArrowRight size={14} aria-hidden="true" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </Shell>
  );
}

/**
 * ONE ARRIVAL WAITING FOR A PROVIDER, WITH THE FIX ON IT.
 *
 * THE PICKER OFFERS SERVICING PROVIDERS ONLY, from the server, by the same
 * rule that refused the arrival — a picker that could offer the nurse again
 * would be a picker that can reproduce the refusal.
 *
 * CHOOSING RE-SENDS THE ARRIVAL under its original idempotency key, so the
 * retry supersedes the refusal rather than putting one walk-in on the queue
 * twice. The details replayed are the practice management system's own, held
 * on the row since it was refused — the console never retypes a patient
 * detail, because the PMS is the source of truth (REQ-DATA-10).
 */
function NeedsProviderCard({
  arrival,
  choices,
  canAct,
  practiceId,
  onDone,
}: {
  arrival: RefusedArrival;
  choices: ArrivalProviderChoice[];
  canAct: boolean;
  practiceId: string;
  onDone: () => Promise<void>;
}) {
  const [providerId, setProviderId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roleName = arrival.billingRole
    ? (strings.billingRoles.names[arrival.billingRole] ?? arrival.billingRole)
    : null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/arrivals/${arrival.arrivalId}/provider`, {
        method: 'POST',
        headers: apiHeaders(practiceId),
        body: JSON.stringify({ providerId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
        throw new Error(
          Array.isArray(body.message) ? body.message.join(' ') : (body.message ?? String(res.status)),
        );
      }
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={styles.card} data-testid={`needs-provider-${arrival.arrivalId}`}>
      <div className={styles.cardHead}>
        <span className={styles.cardIcon}>
          <AlertTriangle size={18} aria-hidden="true" />
        </span>
        <div className={styles.cardMain}>
          {/*
            A NAME ONLY IF THE PRACTICE ALREADY HAD ONE. A refused arrival
            changes nothing about the person, so a walk-in the platform has
            never seen is identified by the practice's own record number —
            which is what reception is reading off their own screen anyway.
          */}
          <p className={styles.cardTitle}>
            {arrival.patientName ?? strings.needsProvider.recordNumber(arrival.pmsPatientRecordNumber)}
          </p>
          <p className={styles.cardSub} data-testid={`needs-provider-reason-${arrival.arrivalId}`}>
            {arrival.reason === 'provider_not_servicing' && arrival.providerName && roleName
              ? strings.needsProvider.reason(arrival.providerName, roleName)
              : strings.needsProvider.unknownReason(arrival.reason)}
          </p>
        </div>
      </div>

      {error && (
        <Notice tone="stop" title={strings.needsProvider.failed}>
          {error}
        </Notice>
      )}

      {choices.length === 0 ? (
        <p className={ui.hint}>{strings.needsProvider.noneToChoose}</p>
      ) : (
        <div className={styles.cardActions}>
          <Field label={strings.needsProvider.pickLabel}>
            {(props) => (
              <SelectInput
                {...props}
                value={providerId}
                disabled={!canAct || busy}
                onChange={(e) => setProviderId(e.target.value)}
                data-testid={`needs-provider-pick-${arrival.arrivalId}`}
              >
                <option value="">{strings.needsProvider.pickPlaceholder}</option>
                {choices.map((choice) => (
                  <option key={choice.providerId} value={choice.providerId}>
                    {choice.name}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Button
            variant="primary"
            disabled={!canAct || busy || providerId.length === 0}
            onClick={() => void submit()}
            data-testid={`needs-provider-submit-${arrival.arrivalId}`}
          >
            {busy ? strings.needsProvider.submitting : strings.needsProvider.submit}
          </Button>
        </div>
      )}
    </li>
  );
}

/** Re-exported for the work page, which draws the same one-line summaries. */
export type { PatientQueueItem };
