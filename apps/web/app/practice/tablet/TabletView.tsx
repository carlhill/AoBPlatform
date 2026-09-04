'use client';

/**
 * SEND TO THE TABLET — reception's half of the push (TODO.md "Two front
 * doors", Carl 4 Sep 2026).
 *
 * THE USE CASE, IN ONE SENTENCE. Reception has checked the Medicare card in
 * the PMS, matched the patient, and asked their date of birth, mobile, email
 * and address across the desk — the three-identifier staff check (REQ-VER-03).
 * They then send the visit's agreement to the tablet beside them. The patient
 * ticks their details as correct, reads, and approves. They never search for
 * themselves and they never type.
 *
 * TWO COLUMNS, BECAUSE THERE ARE TWO QUESTIONS. On the left, WHO IS WAITING
 * and can their agreement go. On the right, WHAT ARE MY TABLETS DOING. A
 * receptionist glances between them all morning, and putting either one behind
 * a tab would mean pressing something to find out whether the patient in front
 * of them has finished.
 *
 * THIS PAGE IS THE TABLETS' VIEW OF THE SAME WORK. Its twin,
 * `/practice/patients/<id>`, is the PATIENT'S view — everything open for one
 * person, without leaving them. Both render the SAME controls, from
 * `pushDesk.tsx`, because a second copy of "may this be sent, and what happens
 * when it is refused" is a second place for a rule to be fixed and one place
 * for it to be forgotten. What is left in this file is the arrangement: which
 * lists, in which order, under which headings.
 *
 * A STATUS, NOT A MIRROR (TODO.md). The right-hand column says "Showing to
 * Jamie Sampleton — reading". It does not reproduce the tablet's screen: that
 * would put a patient's date of birth and address on a second monitor, at the
 * front counter, facing the room, for no gain — reception already knows those
 * details, having just asked for them.
 *
 * BLOCKED ROWS ARE SHOWN, NOT HIDDEN, and this is Carl's own live test made
 * structural. On the walk-up kiosk he chose a name, passed all three
 * identifiers, and only then met a hand-over screen that named nobody — the
 * patient's effort spent for nothing and reception with no way to tell who
 * needed fixing. A list that silently omitted the drafts that cannot be sent
 * would reproduce exactly that at the desk. So every row says whether it can
 * go and, if not, which rule is in the way and what to do about it.
 *
 * NOTHING HERE BLOCKS CARE (hard rule 8, REQ-REC-04), and the page says so in
 * words. A patient who walks away from the tablet is still seen; reception
 * bills privately or asks again after the service.
 */

import Link from 'next/link';
import { ArrowRight, ClipboardList, Tablet, Users } from 'lucide-react';
import { Button, Chip, Notice, Section, Shell, ui } from '../../ui';
import { strings } from '../../strings';
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
  subjectForSession,
  usePushDesk,
  when,
} from './pushDesk';

/*
 * THE HELPERS AND THE CONTROLS NOW LIVE IN `pushDesk.tsx`, SHARED WITH THE
 * PATIENT WORK PAGE — re-exported here so every caller and every test that
 * already knew this module by name still finds them. One implementation, two
 * doors to it.
 */
export {
  FIELDS_FOR_DISPUTED_TYPE,
  SEND_AGAIN_ENDINGS,
  blockedMessage,
  describeRefusal,
  disputedLabels,
  fieldsToCorrect,
  liveOnly,
  mayPush,
  serviceFact,
  shortSessionId,
  signingFact,
  whenLabel,
  whoIsBlocked,
  type PatientDetails,
  type PushableRow,
  type RefusalDescription,
} from './pushDesk';

export function TabletView({ practiceId }: { practiceId: string }) {
  const desk = usePushDesk(practiceId);
  const { rows, devices, loadError, canSend, busyId } = desk;

  if (loadError && rows === null) {
    return (
      <Shell
        right={<SessionControl audience={strings.tablet.audience} />}
        title={strings.tablet.title}
        lead={strings.tablet.lead}
      >
        <Notice tone="stop" title={strings.tablet.notLoaded}>
          {loadError}
        </Notice>
      </Shell>
    );
  }

  return (
    <Shell
      right={<SessionControl audience={strings.tablet.audience} />}
      title={strings.tablet.title}
      lead={strings.tablet.lead}
    >
      {/*
        WHAT SENDING ACTUALLY DOES, standing on the screen rather than buried in
        help. The person pressing the button is making a legal record — that
        they checked this patient at the desk — and the platform should say so
        before they press it, not afterwards.
      */}
      <Notice tone="ok" title={strings.tablet.whatItDoes} data-testid="tablet-what-it-does">
        {strings.tablet.neverBlocks}
      </Notice>

      {loadError && (
        <Notice tone="warn" title={strings.tablet.notLoaded}>
          {loadError}
        </Notice>
      )}

      {/*
        LOOKING, NOT WORKING. Somebody without the practice's own claim — a
        platform operator who has not opened an acting-as session — sees the
        state and no controls. It is not a hidden page: the person most likely
        to be asked "why did that tablet not get the agreement" is exactly the
        person who needs to see the answer, and every act behind it is
        `@PracticeScoped` on the server and would refuse them anyway.
      */}
      {!canSend && (
        <Notice tone="warn" title={strings.viewOnly.title} data-testid="tablet-view-only">
          {strings.viewOnly.body}
        </Notice>
      )}

      {/*
        THE OTHER DOOR, NAMED WHERE SOMEBODY IS ALREADY STANDING (Carl, 4 Sep
        2026). This page is organised by TABLET; the work list is organised by
        PATIENT, which is how reception actually works — one person at a time.
      */}
      <p className={ui.hint}>
        <Users size={12} aria-hidden="true" />{' '}
        <Link href="/practice/patients" data-testid="tablet-to-patients">
          {strings.patients.fromTablet}
        </Link>
      </p>

      <Section number={1} title={strings.tablet.todayTitle}>
        <p className={ui.hint}>{strings.tablet.todayLead}</p>

        <div className={styles.queueSummary}>
          <Chip tone={rows && rows.length ? 'warn' : 'ok'}>
            {strings.tablet.todayCount(rows?.length ?? 0)}
          </Chip>
          <Button variant="subtle" onClick={() => void desk.load()} disabled={busyId !== null}>
            {strings.tablet.refresh}
          </Button>
        </div>

        {rows === null && <p className={ui.hint}>{strings.tablet.loading}</p>}

        {rows !== null && rows.length === 0 && (
          <div className={styles.empty}>
            <ClipboardList size={22} aria-hidden="true" />
            <p className={styles.emptyTitle}>{strings.tablet.todayNone}</p>
          </div>
        )}

        <ul className={styles.queueList} data-testid="pushable-list">
          {(rows ?? []).map((row) => (
            <AgreementRow key={row.agreementId} desk={desk} row={row} />
          ))}
        </ul>
      </Section>

      <Section number={2} title={strings.tablet.tabletsTitle}>
        <p className={ui.hint}>{strings.tablet.tabletsLead}</p>

        {devices !== null && desk.paired.length === 0 && (
          <div className={styles.empty}>
            <Tablet size={22} aria-hidden="true" />
            <p className={styles.emptyTitle}>{strings.tablet.tabletsNone}</p>
            <p className={ui.hint}>{strings.tablet.tabletsNoneHint}</p>
          </div>
        )}

        <ul className={styles.list} data-testid="tablet-list">
          {(devices ?? []).map((device) => {
            const session = desk.sessionByDevice.get(device.id);
            const lastEnded = desk.lastEndedByDevice.get(device.id);
            /*
             * WHAT THIS TABLET LAST DID, when it is doing nothing (Carl, 4 Sep
             * 2026). A session that walked away, timed out, was recalled or
             * expired left the agreement untouched, so the ordinary next thing
             * is to send it again — on the row that just said it ended, rather
             * than after a hunt back through the waiting list.
             */
            const ended =
              !session && lastEnded && SEND_AGAIN_ENDINGS.includes(lastEnded.state) ? lastEnded : undefined;
            return (
              <li key={device.id} className={styles.card} data-testid={`tablet-${device.id}`}>
                <div className={styles.cardHead}>
                  <span className={styles.cardIcon}>
                    <Tablet size={18} aria-hidden="true" />
                  </span>
                  <div className={styles.cardMain}>
                    <p className={styles.cardTitle}>{device.label}</p>
                    {/*
                      A STATUS, NOT A MIRROR. A name and a state — never the
                      particulars the tablet is showing, which would put a
                      patient's date of birth on a second screen at the counter.
                    */}
                    <p className={styles.cardSub} data-testid={`tablet-state-${device.id}`}>
                      {device.state === 'revoked'
                        ? strings.tablet.tabletRevoked
                        : device.state === 'awaiting_pairing'
                          ? strings.tablet.tabletUnpaired
                          : session
                            ? strings.tablet.tabletShowing(
                                session.patientName,
                                strings.tablet.states[session.state] ?? session.state,
                              )
                            : strings.tablet.tabletIdle}
                      {/* THE SAME EIGHT CHARACTERS THE TABLET'S FOOTER SHOWS. */}
                      {session && (
                        <>
                          {' · '}
                          <SessionTag id={session.id} testId={`tablet-session-id-${device.id}`} />
                        </>
                      )}
                    </p>
                    {session && (
                      <p className={styles.cardSub}>
                        {strings.tablet.pushedAt(session.pushedBy, when(session.pushedAt))}
                      </p>
                    )}
                    {/*
                      WHAT IT LAST DID, on a tablet that is now idle. A name
                      and an ending — still a status, not a mirror.
                    */}
                    {ended && (
                      <p className={styles.cardSub} data-testid={`tablet-last-${device.id}`}>
                        {strings.tablet.tabletLastSession(
                          ended.patientName,
                          strings.tablet.states[ended.state] ?? ended.state,
                        )}
                        {' · '}
                        <SessionTag id={ended.id} testId={`tablet-last-session-id-${device.id}`} />
                      </p>
                    )}
                  </div>
                  <div className={styles.cardAside}>
                    <Chip tone={session ? (STATE_TONE[session.state] ?? 'neutral') : 'ok'}>
                      {session ? (strings.tablet.states[session.state] ?? session.state) : strings.tablet.tabletIdle}
                    </Chip>
                  </div>
                </div>

                {session && <SessionDisputeNotices session={session} />}
                {session && <SessionActions desk={desk} session={session} />}
                {ended && <SendAgain desk={desk} ended={ended} />}
                {session && <CorrectionPanel desk={desk} subject={subjectForSession(session)} />}
                {session && (
                  <CorrectOutcomeNotice
                    desk={desk}
                    subjectKey={session.id}
                    testId={`correct-outcome-${device.id}`}
                  />
                )}
                <SessionOutcomeNotice
                  desk={desk}
                  id={session?.id ?? ended?.id}
                  testId={`recall-outcome-${device.id}`}
                  linkTestId={`recall-outcome-link-${device.id}`}
                  recallTestId={`recall-outcome-recall-${device.id}`}
                />
              </li>
            );
          })}
        </ul>

        <p className={ui.hint}>
          <ArrowRight size={12} aria-hidden="true" /> {strings.tablet.tabletsNoneHint}
        </p>
      </Section>
    </Shell>
  );
}
