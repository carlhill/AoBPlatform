'use client';

/**
 * ONE PATIENT, EVERYTHING OPEN, ONE PAGE (TODO.md "Reception-centric: the
 * patient work page", Carl 4 Sep 2026).
 *
 * THE PROBLEM IT ANSWERS. A patient is standing at the desk. Their agreement
 * is on `/practice/tablet`, the message that did not arrive is on
 * `/practice/correspondence`, the reminder is on the reconciliation screen and
 * their details are somewhere else again. Reception does not work in screens;
 * they work in people. This is the person.
 *
 * IT ADDS NO CONTROLS OF ITS OWN. Every tablet control here is the SAME
 * component `/practice/tablet` renders (`pushDesk.tsx`) — Send with its device
 * picker, the live session, Recall, Correct, "No change needed", Re-send, Send
 * again, and every refusal mapped to copy plus a destination. That is what
 * makes the two screens incapable of disagreeing, and it is what the named test
 * `work_page_tablet_controls_match_tablet_page` pins.
 *
 * THE EXISTING PAGES STAY. `/practice/tablet`, `/practice/correspondence` and
 * `/practice/reconciliation` are unchanged and each card links to the one it
 * summarises: this is the fast path, not a replacement for the full tooling.
 *
 * WHY THE FIVE DETAILS ARE ON SCREEN HERE AND NOT ON `/practice/tablet`. That
 * page is a list of everybody, polled every three seconds at the front
 * counter, so it carries a STATUS and fetches values only when somebody opens
 * a correction. This page is one patient, opened deliberately, about the
 * person already standing there — and the five details are the very thing the
 * patient is being asked to check. They are read ONCE when the page opens and
 * again after a correction; they are never on the poll.
 *
 * NEVER A MEDICARE NUMBER (hard rule 1, REQ-VER-02 — there is no column for
 * one), never a dollar amount (hard rule 4), never an identifier VALUE in the
 * history (REQ-VER-04), and nothing here claims anything is certified,
 * approved or accredited (hard rule 12).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, ClipboardList, History, Mail, PencilLine, Tablet, UserRound } from 'lucide-react';
import {
  audiencesOf,
  mayReach,
  type Audience,
  type PatientQueueItem,
  type PatientQueueRow,
  type PatientTimelineEntry,
  type TabletSessionRow,
} from '@aobplatform/domain';
import { Button, Chip, Notice, Section, Shell, ui } from '../../ui';
import { strings } from '../../strings';
import { apiHeaders, currentSession } from '../../auth';
import { SessionControl } from '../../SessionControl';
import styles from '../manage.module.css';
import {
  AgreementRow,
  CorrectOutcomeNotice,
  CorrectionPanel,
  SEND_AGAIN_ENDINGS,
  SendAgain,
  SessionActions,
  SessionDisputeNotices,
  SessionOutcomeNotice,
  SessionTag,
  STATE_TONE,
  subjectForPatient,
  subjectForSession,
  usePushDesk,
  when,
  type PatientDetails,
  type PushableRow,
} from '../tablet/pushDesk';
import { bornOn } from './PatientsQueueView';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/** What the follow-up card reads — the trail endpoint's own shape. */
interface ChaseTrail {
  agreementId: string | null;
  daysRemaining: number;
  band: string;
  policy: { attempts: number };
  attemptsMade: number;
  nextStep: string | null;
  attempts: Array<{
    id: string;
    channel: string;
    outcome: string;
    occurredAt: string;
    superseded: boolean;
  }>;
}

/** What the messages card reads. STATES, never bodies — the card draws no text. */
interface MessageRow {
  id: string;
  channel: string | null;
  state: string;
  queuedAt: string;
  sentAt: string | null;
}

/**
 * HOW ONE AGREEMENT IS NAMED ON THIS PAGE.
 *
 * ENDURING IS PER PRACTITIONER × PATIENT AND GP-ONLY (hard rule 6,
 * REQ-END-01/-01a), so an enduring agreement is named UNDER ITS PROVIDER and
 * never as anything practice-wide. Getting this heading wrong would be the
 * rule broken in the one place a receptionist would believe it.
 */
export function agreementHeading(row: Pick<PushableRow, 'agreementType' | 'providerName'>): string {
  if (row.agreementType === 'enduring') {
    return row.providerName
      ? strings.patients.enduringUnder(row.providerName)
      : strings.patients.enduringNoProvider;
  }
  if (row.agreementType === 'treatment_plan') return strings.patients.treatmentPlan;
  return strings.patients.episodicToday;
}

/**
 * "4 Sep 2026 at 8:31 pm" — when the patient asked.
 *
 * NOT `when()`, WHICH IS TIME ONLY. That is right for a tablet session
 * happening now and wrong for a request a patient may have made on Sunday
 * night: "8:31 pm" with no day reads as this evening, and reception would
 * think somebody was standing there.
 */
export function askedAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const day = parsed.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${day} at ${parsed.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`;
}

/** The detail's own label, as it reads inside a sentence rather than above a field. */
export function detailInSentence(fieldType: string | undefined): string {
  const label = fieldType ? (strings.kiosk.checkDetails.detailNames[fieldType] ?? fieldType) : '';
  if (!label) return strings.patients.identityTitle.toLowerCase();
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** One history line: the words for the type, then whatever short codes it carries. */
export function historyLine(entry: PatientTimelineEntry): string {
  // AN UNMAPPED TYPE SHOWS ITS OWN CODE rather than being swallowed — the same
  // rule the refusal mapping follows (CLAUDE.md §7).
  const head = strings.patients.historyTypes[entry.type] ?? entry.type;
  const parts = [head];
  if (entry.detailTypes?.length) {
    parts.push(
      strings.patients.historyTypesList(
        entry.detailTypes
          .map((type) => strings.kiosk.checkDetails.detailNames[type] ?? type)
          .join(', '),
      ),
    );
  }
  if (entry.detail) parts.push(strings.patients.historyDetail(entry.detail));
  return parts.join(' ');
}

export function PatientWorkView({ practiceId, patientId }: { practiceId: string; patientId: string }) {
  const desk = usePushDesk(practiceId);

  const [identity, setIdentity] = useState<PatientDetails | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  /*
   * WHAT THE PATIENT ASKED FOR THEMSELVES (Carl, 4 Sep 2026). Read from the
   * queue endpoint — the same one the list reads, so the row at the counter and
   * the banner on this page can never disagree — and re-read after anything
   * that could close it. It is NOT on the three-second poll: a request that
   * arrived while somebody stood here does not need to appear within a breath,
   * and this page keeps patient values off the poll on purpose.
   */
  const [corrections, setCorrections] = useState<PatientQueueItem[]>([]);
  /*
   * AND WHETHER THEIR PORTAL INVITATION LOCKED (Carl, 5 Sep 2026). From the
   * same queue read as the corrections, for the same reason: the row at the
   * counter and the banner on this page must be reading one answer. The item
   * carries the task to close, when it locked, and the agreement a new
   * invitation is minted against — never which detail did not match, which the
   * platform does not hold anywhere reception can reach (REQ-VER-04).
   */
  const [lockedInvitations, setLockedInvitations] = useState<PatientQueueItem[]>([]);
  const [lockedBusy, setLockedBusy] = useState<string | null>(null);
  const [lockedError, setLockedError] = useState<string | null>(null);
  const [lockedOutcome, setLockedOutcome] = useState<'sent' | 'dismissed' | null>(null);
  const [markBusy, setMarkBusy] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  const [markDone, setMarkDone] = useState(false);
  const [trails, setTrails] = useState<Record<string, ChaseTrail>>({});
  const [messages, setMessages] = useState<MessageRow[] | null>(null);
  const [timeline, setTimeline] = useState<PatientTimelineEntry[] | null>(null);

  const audiences: Audience[] = useMemo(() => {
    const session = currentSession();
    return audiencesOf({
      roles: session?.roles,
      practiceId: session?.practiceId ?? null,
      practitionerId: session?.practitionerId,
    });
  }, []);
  const canAct = mayReach('/practice/patients', audiences) && audiences.includes('practice');

  /*
   * THE FIVE DETAILS AND THE HISTORY, READ WHEN THE PAGE OPENS AND AFTER A
   * CORRECTION — never on the three-second poll that the tablet controls run
   * on. A correction changes both, which is why they are re-read together.
   */
  const readPatient = useCallback(async () => {
    try {
      const [d, t, q] = await Promise.all([
        fetch(`${CORE_URL}/patients/${patientId}/details`, { headers: apiHeaders(practiceId) }),
        fetch(`${CORE_URL}/patients/${patientId}/timeline`, { headers: apiHeaders(practiceId) }),
        fetch(`${CORE_URL}/patients?open=today`, { headers: apiHeaders(practiceId) }),
      ]);
      if (!d.ok) throw new Error(String(d.status));
      setIdentity((await d.json()) as PatientDetails);
      setIdentityError(null);
      if (t.ok) setTimeline(((await t.json()) as { entries: PatientTimelineEntry[] }).entries);
      if (q.ok) {
        const rows = (await q.json()) as PatientQueueRow[];
        const mine = Array.isArray(rows) ? rows.find((row) => row.patientId === patientId) : undefined;
        setCorrections(
          (mine?.items ?? []).filter((item) => item.kind === 'portal_correction_requested'),
        );
        setLockedInvitations(
          (mine?.items ?? []).filter((item) => item.kind === 'portal_activation_locked'),
        );
      }
    } catch (e) {
      setIdentityError(e instanceof TypeError ? strings.status.unreachable : (e as Error).message);
    }
  }, [practiceId, patientId]);

  /**
   * MARK THE PATIENT'S REQUEST DONE.
   *
   * IT GOES THROUGH THE REVIEW-TASKS MODULE'S OWN RESOLVE ENDPOINT, which is
   * practice-scoped, needs a signed-in staff member and writes the
   * `review_task.resolved` event. There is no second closing path with weaker
   * evidence, and this control is the one for the OTHER outcome — the value we
   * hold turned out to be right, or the change belongs in the PMS alone. Saving
   * a correction to the same detail closes it on the server without anybody
   * pressing this.
   */
  const markAsDone = useCallback(
    async (reviewTaskId: string) => {
      setMarkBusy(reviewTaskId);
      setMarkError(null);
      try {
        const res = await fetch(`${CORE_URL}/review-tasks/${reviewTaskId}/resolve`, {
          method: 'POST',
          headers: { ...apiHeaders(practiceId), 'content-type': 'application/json' },
          body: JSON.stringify({ resolution: 'no_change_needed' }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setMarkDone(true);
        await readPatient();
      } catch (e) {
        setMarkError(e instanceof TypeError ? strings.status.unreachable : (e as Error).message);
      } finally {
        setMarkBusy(null);
      }
    },
    [practiceId, readPatient],
  );

  /**
   * SEND THEM A NEW INVITATION — the whole remedy for a locked one, in one
   * press.
   *
   * IT IS THE EXISTING MINT ENDPOINT AND NOT A NEW ONE. `POST
   * /agreements/:id/portal-invitation` mints against a SIGNED agreement
   * (FR-1.14), delivers the message through the sandbox gateway in the same
   * transaction, and closes the locked task itself — so this screen does not
   * resolve anything after it, and there is no path where a message went and
   * the task stayed open. The agreement id is the patient's most recent signed
   * one, chosen by the server rather than by this page.
   */
  const sendNewInvitation = useCallback(
    async (item: PatientQueueItem) => {
      if (!item.reviewTaskId || !item.agreementId) return;
      setLockedBusy(item.reviewTaskId);
      setLockedError(null);
      try {
        const res = await fetch(`${CORE_URL}/agreements/${item.agreementId}/portal-invitation`, {
          method: 'POST',
          headers: apiHeaders(practiceId),
        });
        if (!res.ok) throw new Error(String(res.status));
        setLockedOutcome('sent');
        await readPatient();
      } catch (e) {
        setLockedError(e instanceof TypeError ? strings.status.unreachable : (e as Error).message);
      } finally {
        setLockedBusy(null);
      }
    },
    [practiceId, readPatient],
  );

  /**
   * DISMISS — nobody is waiting on this after all. The same review-tasks
   * resolve endpoint the correction banner uses: practice-scoped, a named staff
   * member, one `review_task.resolved` event. `reinvited` is deliberately not
   * writable from here — that resolution means an invitation actually went.
   */
  const dismissLocked = useCallback(
    async (reviewTaskId: string) => {
      setLockedBusy(reviewTaskId);
      setLockedError(null);
      try {
        const res = await fetch(`${CORE_URL}/review-tasks/${reviewTaskId}/resolve`, {
          method: 'POST',
          headers: { ...apiHeaders(practiceId), 'content-type': 'application/json' },
          body: JSON.stringify({ resolution: 'no_change_needed' }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setLockedOutcome('dismissed');
        await readPatient();
      } catch (e) {
        setLockedError(e instanceof TypeError ? strings.status.unreachable : (e as Error).message);
      } finally {
        setLockedBusy(null);
      }
    },
    [practiceId, readPatient],
  );

  /*
   * THE FIELDS THE PATIENT NAMED, PASSED TO THE SAME CORRECTION PANEL THE
   * TABLET PAGE USES, so the detail they asked about is MARKED exactly as a
   * crossed row is. Every field stays editable — the patient may mention a
   * second one while they are on the phone.
   */
  const subject = useMemo(
    () =>
      subjectForPatient(
        patientId,
        corrections.map((item) => item.fieldType).filter((type): type is string => Boolean(type)),
      ),
    [patientId, corrections],
  );

  useEffect(() => {
    void readPatient();
  }, [readPatient]);

  /*
   * A CORRECTION MOVED SOMETHING, SO THE PAGE RE-READS IT. Keyed on the
   * outcome's identity rather than on a counter, so a failed save does not
   * quietly refresh as though it had worked.
   */
  const lastCorrection = desk.correctOutcome?.ok ? `${desk.correctOutcome.id}:${desk.correctOutcome.text}` : null;
  const seenCorrection = useRef<string | null>(null);
  useEffect(() => {
    if (!lastCorrection || seenCorrection.current === lastCorrection) return;
    seenCorrection.current = lastCorrection;
    void readPatient();
  }, [lastCorrection, readPatient]);

  /* What has been sent to this patient — states and times, never bodies. */
  useEffect(() => {
    void fetch(`${CORE_URL}/correspondence?patientId=${patientId}`, { headers: apiHeaders(practiceId) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: MessageRow[]) => setMessages(Array.isArray(body) ? body : []))
      .catch(() => setMessages([]));
  }, [practiceId, patientId]);

  const rows = (desk.rows ?? []).filter((row) => row.patientId === patientId);
  const sessions = desk.sessions.filter((session) => session.patientId === patientId);

  /*
   * THE FOLLOW-UP STATE FOR THIS PATIENT'S OPEN AGREEMENTS. Keyed on the IDS,
   * joined, so the poll refreshing the rows array does not re-fetch a trail
   * every three seconds for data that changes when somebody makes a call.
   */
  const agreementIds = [...new Set(rows.map((row) => row.agreementId))].sort();
  const agreementKey = agreementIds.join(',');
  useEffect(() => {
    if (agreementKey.length === 0) {
      setTrails({});
      return;
    }
    let live = true;
    void Promise.all(
      agreementKey.split(',').map(async (id) => {
        try {
          const res = await fetch(`${CORE_URL}/chase-attempts/Agreement/${id}`, {
            headers: apiHeaders(practiceId),
          });
          return res.ok ? ((await res.json()) as ChaseTrail) : null;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (!live) return;
      const next: Record<string, ChaseTrail> = {};
      for (const trail of results) {
        if (trail?.agreementId) next[trail.agreementId] = trail;
      }
      setTrails(next);
    });
    return () => {
      live = false;
    };
  }, [practiceId, agreementKey]);

  /*
   * THE NAME AT THE TOP comes from the patient record once it is read, and
   * from the row that named them until then — so the page has a title from its
   * first paint rather than saying "Loading…" over a person's own page.
   */
  const name =
    (identity && `${identity.givenNames} ${identity.familyName}`) ??
    rows[0]?.patientName ??
    sessions[0]?.patientName ??
    strings.patients.title;

  const detailValue = (value: string | null | undefined) =>
    value && value.length > 0 ? value : strings.patients.identityNotHeld;

  return (
    <Shell
      right={<SessionControl audience={strings.patients.audience} />}
      title={name}
      lead={strings.patients.workLead}
    >
      <p className={ui.hint}>
        <Link href="/practice/patients" data-testid="work-to-queue">
          {strings.patients.toQueue}
        </Link>
      </p>

      {!canAct && (
        <Notice tone="warn" title={strings.viewOnly.title} data-testid="work-view-only">
          {strings.viewOnly.body}
        </Notice>
      )}

      {desk.loadError && (
        <Notice tone="warn" title={strings.patients.notLoaded}>
          {desk.loadError}
        </Notice>
      )}

      {/* -------------------------------------------------------------- */}
      <Section
        number={1}
        title={strings.patients.identityTitle}
        aside={
          <span className={styles.cardIcon}>
            <UserRound size={16} aria-hidden="true" />
          </span>
        }
      >
        {/*
          THE ANSWER TO "WHAT HAPPENS WHEN THE PATIENT PRESSES THE BUTTON"
          (Carl, 4 Sep 2026). It is at the top of their own page, it names the
          detail and when they asked, and both routes out of it are right here:
          correct it, or mark it done. Nothing about it blocks anything else on
          the page.
        */}
        {corrections.map((request) => (
          <Notice
            key={request.reviewTaskId}
            tone="warn"
            title={strings.patients.correctionRequestTitle}
            data-testid={`correction-request-${request.reviewTaskId}`}
          >
            <p>
              {strings.patients.correctionRequestBody(
                detailInSentence(request.fieldType),
                request.requestedAt ? askedAt(request.requestedAt) : '',
              )}
            </p>
            <p className={ui.hint}>{strings.patients.correctionRequestLead}</p>
            <div className={styles.formActions}>
              <Button
                disabled={!canAct || desk.correctBusy}
                onClick={() => {
                  if (desk.correctFor === subject.key) {
                    desk.closeCorrect();
                    return;
                  }
                  void desk.openCorrect(subject);
                }}
                data-testid={`correction-request-open-${request.reviewTaskId}`}
              >
                <PencilLine size={14} aria-hidden="true" />
                {desk.correctFor === subject.key
                  ? strings.patients.identityClose
                  : strings.patients.correctionRequestOpen}
              </Button>
              <Button
                disabled={!canAct || markBusy !== null}
                onClick={() => void markAsDone(request.reviewTaskId!)}
                data-testid={`correction-request-done-${request.reviewTaskId}`}
              >
                <Check size={14} aria-hidden="true" />
                {markBusy === request.reviewTaskId
                  ? strings.patients.correctionRequestDoing
                  : strings.patients.correctionRequestDone}
              </Button>
            </div>
          </Notice>
        ))}

        {markError && (
          <Notice tone="stop" title={strings.patients.correctionRequestFailed} data-testid="correction-request-error">
            {markError}
          </Notice>
        )}

        {/*
          THEIR PORTAL INVITATION LOCKED, AND THE PRACTICE IS THE ONE BEING TOLD
          (Carl, 5 Sep 2026). The patient's own screen still says only "ask your
          practice for a new invitation"; this is the practice being asked
          without waiting for the patient to remember. It names when, and the
          two ways out are both here — send another, or dismiss it — rather than
          a sentence pointing at a queue (CLAUDE.md §7).

          NOT ONE WORD ABOUT WHICH DETAIL DID NOT MATCH. The task does not carry
          it, this page could not show it, and the remedy is the same whichever
          it was (REQ-VER-04, hard rule 9).
        */}
        {lockedInvitations.map((locked) => (
          <Notice
            key={locked.reviewTaskId}
            tone="warn"
            title={strings.patients.lockedTitle}
            data-testid={`locked-invitation-${locked.reviewTaskId}`}
          >
            <p>{strings.patients.lockedBody(locked.lockedAt ? askedAt(locked.lockedAt) : '')}</p>
            {!locked.agreementId && (
              <p className={ui.hint} data-testid={`locked-invitation-no-agreement-${locked.reviewTaskId}`}>
                {strings.patients.lockedNoAgreement}
              </p>
            )}
            <div className={styles.formActions}>
              <Button
                disabled={!canAct || lockedBusy !== null || !locked.agreementId}
                onClick={() => void sendNewInvitation(locked)}
                data-testid={`locked-invitation-send-${locked.reviewTaskId}`}
              >
                <Mail size={14} aria-hidden="true" />
                {lockedBusy === locked.reviewTaskId
                  ? strings.patients.lockedSending
                  : strings.patients.lockedSend}
              </Button>
              <Button
                disabled={!canAct || lockedBusy !== null}
                onClick={() => void dismissLocked(locked.reviewTaskId!)}
                data-testid={`locked-invitation-dismiss-${locked.reviewTaskId}`}
              >
                <Check size={14} aria-hidden="true" />
                {lockedBusy === locked.reviewTaskId
                  ? strings.patients.lockedDismissing
                  : strings.patients.lockedDismiss}
              </Button>
            </div>
          </Notice>
        ))}

        {lockedError && (
          <Notice tone="stop" title={strings.patients.lockedFailed} data-testid="locked-invitation-error">
            {lockedError}
          </Notice>
        )}

        {lockedOutcome && lockedInvitations.length === 0 && (
          <Notice tone="ok" title={strings.patients.lockedTitle} data-testid="locked-invitation-outcome">
            {lockedOutcome === 'sent' ? strings.patients.lockedSent : strings.patients.lockedDismissed}
          </Notice>
        )}

        {markDone && corrections.length === 0 && (
          <Notice tone="ok" title={strings.patients.correctionRequestTitle} data-testid="correction-request-done-notice">
            {strings.patients.correctionRequestDoneOutcome}
          </Notice>
        )}

        <p className={ui.hint}>{strings.patients.identityLead}</p>

        {identityError && (
          <Notice tone="stop" title={strings.patients.notLoaded} data-testid="identity-error">
            {identityError}
          </Notice>
        )}

        {identity === null && !identityError && <p className={ui.hint}>{strings.patients.loading}</p>}

        {identity && (
          <>
            <ul className={styles.list} data-testid="identity-list">
              {/*
                THE FIVE DETAILS THE PATIENT IS ASKED TO CHECK, in the order the
                tablet draws them. Name is two columns and one question, which
                is why it reads as one row here and marks two fields in the
                correction panel.
              */}
              <li className={styles.card} data-testid="identity-name">
                <p className={styles.cardSub}>{strings.kiosk.checkDetails.detailNames.name}</p>
                <p className={styles.cardTitle}>{`${identity.givenNames} ${identity.familyName}`}</p>
              </li>
              <li className={styles.card} data-testid="identity-date_of_birth">
                <p className={styles.cardSub}>{strings.kiosk.checkDetails.detailNames.date_of_birth}</p>
                <p className={styles.cardTitle}>{bornOn(identity.dateOfBirth)}</p>
              </li>
              <li className={styles.card} data-testid="identity-address">
                <p className={styles.cardSub}>{strings.kiosk.checkDetails.detailNames.address}</p>
                <p className={styles.cardTitle}>{detailValue(identity.address)}</p>
              </li>
              <li className={styles.card} data-testid="identity-mobile">
                <p className={styles.cardSub}>{strings.kiosk.checkDetails.detailNames.mobile}</p>
                <p className={styles.cardTitle}>{detailValue(identity.mobile)}</p>
              </li>
              <li className={styles.card} data-testid="identity-email">
                <p className={styles.cardSub}>{strings.kiosk.checkDetails.detailNames.email}</p>
                <p className={styles.cardTitle}>{detailValue(identity.email)}</p>
              </li>
            </ul>

            {identity.detailsCorrectedAt && (
              <p className={ui.hint} data-testid="identity-corrected-at">
                {strings.tablet.correctedAt(when(identity.detailsCorrectedAt))}
              </p>
            )}

            <div className={styles.formActions}>
              {/*
                THE SAME CORRECTION THE TABLET PAGE MAKES — same component, same
                endpoint, same refusal of any Medicare-shaped field, same
                supersession of a locked agreement whose particular moved
                (HARD-02). What is missing here is the dispute resolution,
                because there is no cross to close: nobody crossed anything.
              */}
              <Button
                disabled={!canAct || desk.correctBusy}
                onClick={() => {
                  if (desk.correctFor === subject.key) {
                    desk.closeCorrect();
                    return;
                  }
                  void desk.openCorrect(subject);
                }}
                data-testid="identity-correct-open"
              >
                <PencilLine size={14} aria-hidden="true" />
                {desk.correctFor === subject.key
                  ? strings.patients.identityClose
                  : strings.patients.identityCorrect}
              </Button>
            </div>

            <CorrectionPanel desk={desk} subject={subject} />
            <CorrectOutcomeNotice desk={desk} subjectKey={subject.key} testId="identity-correct-outcome" />
          </>
        )}
      </Section>

      {/* -------------------------------------------------------------- */}
      <Section
        number={2}
        title={strings.patients.agreementsTitle}
        aside={
          <span className={styles.cardIcon}>
            <ClipboardList size={16} aria-hidden="true" />
          </span>
        }
      >
        <p className={ui.hint}>{strings.patients.agreementsLead}</p>

        {desk.rows !== null && rows.length === 0 && (
          <div className={styles.empty}>
            <ClipboardList size={22} aria-hidden="true" />
            <p className={styles.emptyTitle}>{strings.patients.agreementsNone}</p>
          </div>
        )}

        {/*
          THE ROWS THEMSELVES ARE THE TABLET PAGE'S ROWS, unchanged. The
          patient's name is not repeated -- the page is already about them and
          their name is at the top of it -- and the heading in its place says
          what KIND of agreement this is.
        */}
        <ul className={styles.queueList} data-testid="work-agreements">
          {rows.map((row) => (
            <AgreementRow
              key={row.agreementId}
              desk={desk}
              row={row}
              showPatientName={false}
              heading={agreementHeading(row)}
            />
          ))}
        </ul>

        <p className={ui.hint}>
          <Tablet size={12} aria-hidden="true" />{' '}
          <Link href="/practice/tablet" data-testid="work-to-tablet">
            {strings.tablet.title} <ArrowRight size={12} aria-hidden="true" />
          </Link>
        </p>
      </Section>

      {/* -------------------------------------------------------------- */}
      <Section
        number={3}
        title={strings.patients.sessionsTitle}
        aside={
          <span className={styles.cardIcon}>
            <Tablet size={16} aria-hidden="true" />
          </span>
        }
      >
        {sessions.length === 0 && <p className={ui.hint}>{strings.patients.sessionsNone}</p>}

        <ul className={styles.list} data-testid="work-sessions">
          {sessions.map((session: TabletSessionRow) => {
            const live = session.endedAt === null;
            const canSendAgain = !live && SEND_AGAIN_ENDINGS.includes(session.state);
            return (
              <li key={session.id} className={styles.card} data-testid={`work-session-${session.id}`}>
                <div className={styles.cardHead}>
                  <span className={styles.cardIcon}>
                    <Tablet size={18} aria-hidden="true" />
                  </span>
                  <div className={styles.cardMain}>
                    <p className={styles.cardTitle}>
                      {strings.patients.sessionOn(
                        session.deviceLabel,
                        strings.tablet.states[session.state] ?? session.state,
                      )}
                    </p>
                    <p className={styles.cardSub}>
                      {strings.tablet.pushedAt(session.pushedBy, when(session.pushedAt))}
                      {' · '}
                      <SessionTag id={session.id} testId={`work-session-id-${session.id}`} />
                    </p>
                  </div>
                  <div className={styles.cardAside}>
                    <Chip tone={STATE_TONE[session.state] ?? 'neutral'}>
                      {strings.tablet.states[session.state] ?? session.state}
                    </Chip>
                  </div>
                </div>

                <SessionDisputeNotices session={session} />
                {live && <SessionActions desk={desk} session={session} />}
                {canSendAgain && <SendAgain desk={desk} ended={session} />}
                <CorrectionPanel desk={desk} subject={subjectForSession(session)} />
                <CorrectOutcomeNotice
                  desk={desk}
                  subjectKey={session.id}
                  testId={`work-correct-outcome-${session.id}`}
                />
                <SessionOutcomeNotice
                  desk={desk}
                  id={session.id}
                  testId={`work-session-outcome-${session.id}`}
                  linkTestId={`work-session-link-${session.id}`}
                  recallTestId={`work-session-recall-${session.id}`}
                />
              </li>
            );
          })}
        </ul>
      </Section>

      {/* -------------------------------------------------------------- */}
      <Section number={4} title={strings.patients.followUpTitle}>
        <p className={ui.hint}>{strings.patients.followUpLead}</p>

        {Object.keys(trails).length === 0 && (
          <p className={ui.hint} data-testid="follow-up-none">
            {strings.patients.followUpNone}
          </p>
        )}

        <ul className={styles.list} data-testid="work-follow-up">
          {Object.values(trails).map((trail) => {
            const last = [...trail.attempts].reverse().find((attempt) => !attempt.superseded);
            return (
              <li
                key={trail.agreementId ?? 'none'}
                className={styles.card}
                data-testid={`follow-up-${trail.agreementId}`}
              >
                <div className={styles.cardHead}>
                  <div className={styles.cardMain}>
                    <p className={styles.cardTitle}>
                      {strings.patients.followUpBands[trail.band] ?? trail.band}
                    </p>
                    <p className={styles.cardSub}>{strings.patients.followUpDays(trail.daysRemaining)}</p>
                    <p className={styles.cardSub}>
                      {strings.patients.followUpAttempts(trail.attemptsMade, trail.policy.attempts)}
                    </p>
                    {/*
                      NOTHING IS CHASED PAST THE DEADLINE (REQ-CHASE-08), so a
                      closed window says there is no next step rather than
                      naming one. A reg 89AA notice is never chased at all and
                      never reaches this card (hard rule 7, REQ-CHASE-02).
                    */}
                    <p className={styles.cardSub} data-testid={`follow-up-next-${trail.agreementId}`}>
                      {trail.nextStep
                        ? strings.patients.followUpNext(
                            strings.patients.followUpSteps[trail.nextStep] ?? trail.nextStep,
                          )
                        : strings.patients.followUpNoneLeft}
                    </p>
                    {last && (
                      <p className={styles.cardSub}>
                        {strings.patients.followUpLast(when(last.occurredAt), last.channel, last.outcome)}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {/*
          RECORDING AN ATTEMPT BELONGS TO THE RECONCILIATION SCREEN, which has
          the form and the rules around it. A second form here would be a second
          place for the same rule to be enforced differently.
        */}
        <p className={ui.hint}>
          <Link href="/practice/reconciliation" data-testid="work-to-reconciliation">
            {strings.patients.followUpToReconciliation}
          </Link>
        </p>
      </Section>

      {/* -------------------------------------------------------------- */}
      <Section
        number={5}
        title={strings.patients.correspondenceTitle}
        aside={
          <span className={styles.cardIcon}>
            <Mail size={16} aria-hidden="true" />
          </span>
        }
      >
        <p className={ui.hint}>{strings.patients.correspondenceLead}</p>

        {messages !== null && messages.length === 0 && (
          <p className={ui.hint} data-testid="messages-none">
            {strings.patients.correspondenceNone}
          </p>
        )}

        <ul className={styles.list} data-testid="work-messages">
          {(messages ?? []).map((message) => (
            <li key={message.id} className={styles.card} data-testid={`message-${message.id}`}>
              {/*
                STATES, NOT BODIES. What a message said belongs on the message
                log, behind its own control; this card answers "was it sent, and
                did it arrive".
              */}
              <p className={styles.cardSub}>
                {strings.patients.correspondenceRow(
                  message.channel ?? '—',
                  strings.correspondence.states[message.state] ?? message.state,
                  when(message.sentAt ?? message.queuedAt),
                )}
              </p>
            </li>
          ))}
        </ul>

        <p className={ui.hint}>
          <Link href="/practice/correspondence" data-testid="work-to-correspondence">
            {strings.patients.correspondenceToLog}
          </Link>
        </p>
      </Section>

      {/* -------------------------------------------------------------- */}
      <Section
        number={6}
        title={strings.patients.historyTitle}
        collapsible
        defaultOpen={false}
        summary={<span className={ui.hint}>{strings.patients.historyLead}</span>}
        aside={
          <span className={styles.cardIcon}>
            <History size={16} aria-hidden="true" />
          </span>
        }
      >
        <p className={ui.hint}>{strings.patients.historyLead}</p>

        {timeline !== null && timeline.length === 0 && (
          <p className={ui.hint} data-testid="history-none">
            {strings.patients.historyNone}
          </p>
        )}

        <ul className={styles.list} data-testid="work-history">
          {(timeline ?? []).map((entry, index) => (
            <li key={`${entry.at}-${entry.type}-${index}`} className={styles.card}>
              <p className={styles.cardSub}>
                {when(entry.at)} · {historyLine(entry)}
              </p>
            </li>
          ))}
        </ul>
      </Section>
    </Shell>
  );
}
