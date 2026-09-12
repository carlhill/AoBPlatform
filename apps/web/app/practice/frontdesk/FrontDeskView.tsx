'use client';

/**
 * PRACTICE FRONTDESK — the queue rail and, from 12 September 2026, the whole
 * of one patient's work in the panel beside it.
 *
 * CARL, 12 SEP 2026, APPROVING THE BUILD: *"Everything to do with the patient
 * must be on this page — no going to another page."* (FRONT-DESK-PAGE.md §13.)
 * The placeholder that named a person and then pointed at `/practice/tablet`
 * is gone. Who is signing, choosing a tablet, sending, bringing it back,
 * fixing a detail the patient crossed and saying no change was needed all
 * happen in the panel, for the person chosen on the left.
 *
 * WHAT IS ON THE PANEL, IN THE ORDER IT IS READ (FRONT-DESK-PAGE.md §4, §13;
 * VISIT-CHECKLIST.md §9 phases 1 and 2):
 *
 *  1. THE NAME, then ONE SENTENCE saying what is true for them right now —
 *     the sentence somebody would say out loud, never a code and never a list
 *     of possibilities.
 *  2. TODAY'S PAPERWORK, four rows, computed and never marked by hand
 *     (`visitChecklist.ts`). It answers "what is this patient here for and
 *     what is done" before anybody presses anything.
 *  3. THE SEND CARD, INSIDE ROW 3 — Carl's second note on the annotated
 *     screenshot: the numbered strip belongs to "get the patient to sign on a
 *     tablet", so it is drawn as that row's own body rather than floating
 *     above the list it belongs to.
 *  4. THE REASON IT CANNOT GO, with its own fix in it (`AgreementBands`,
 *     shared with the tablet desk), and the who-is-signing form the card's
 *     step ① opens.
 *  5. ONE DISCLOSURE for everything else — "More", or "Get help" in the
 *     situation §4's table calls *cannot proceed*. It REVEALS; it never
 *     navigates (§13).
 *
 * ONE PRIMARY ACTION, AND IT IS THE SENTENCE YOU WOULD SAY (§4). The panel's
 * action area (`frontdesk-action`) holds exactly one enabled primary control
 * at a time — the numbered card lights one step, or a single button says
 * "Bring it back" / "Fix their details". A first-day user is never choosing
 * between two things that both look like the answer. Everything else is
 * behind the disclosure, and the fix inside a blocked band is a repair rather
 * than an answer, so it lives in the band and not in the action area.
 *
 * NOTHING IS RE-DERIVED (§7). Every fact comes from `usePushDesk` — the same
 * hook, the same reads and the same three-second poll the tablet desk uses —
 * plus two reads of its own: `GET /arrivals/expected` for the booking list and
 * `GET /arrivals/day` for the register the rails are checked against. There is
 * no new endpoint, no second copy of the refusal mapping and no second
 * definition of what "can be sent" means. A second implementation aimed at
 * beginners would be the one that quietly went wrong.
 *
 * AND THE RAILS ADD UP (§14; Carl, 12 September 2026: *"Both pages have to
 * reconcile."*). The desk showed three, `/practice/day` showed fifteen, both
 * were right, and twelve people — including two who had come in and owed a
 * signature — were on no screen at all. The four arrived rails are now a
 * PARTITION of the register's rows (`dayRails`), so the number at the top of
 * the column is the same number the register prints for the same day, by
 * construction rather than by coincidence.
 *
 * THE RAIL IS A PLACE TO LOOK; THE PANEL IS WHERE YOU ACT (§12.2). Three
 * rules hold it there, each with a named test:
 *
 *  - CHOOSING NEVER ACTS (`front_desk_rail_never_acts_on_selection`). Every
 *    row that CAN be chosen is a `<button>` whose entire effect is `setChosen`;
 *    a row with no queue row behind it — a finished visit, an arrival with
 *    nothing open — is not a control at all, because a button that fills the
 *    panel with nothing is a dead end a first-day starter cannot get out of.
 *  - IT DOES NOT RE-SORT UNDER THE HAND
 *    (`front_desk_rail_keeps_its_order_between_polls`). See `stableByFirstSeen`.
 *  - A NAME, A TIME AND A GROUP, AND NOTHING ELSE
 *    (`front_desk_rail_shows_no_clinical_detail`). No condition, no provider,
 *    no reason code, no identifier of any kind (hard rules 1 and 9), no amount
 *    (hard rule 4). The one addition is the mark on the single row that is
 *    next (§4), which is an ordering fact and not a detail about anybody.
 *
 * NOTHING HERE BLOCKS CARE (hard rule 8, REQ-REC-04), and the page says so in
 * words — including when the platform itself cannot be reached, which is the
 * moment a beginner is most likely to think a patient has to wait.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, PencilLine, Users } from 'lucide-react';
import type { DayRegister, DayRegisterRow, ExpectedAppointment } from '@aobplatform/contracts';
import type { DeviceRow } from '@aobplatform/domain';
import { Button, Chip, Notice, PatientIdentity, Shell, ui } from '../../ui';
import { SessionControl } from '../../SessionControl';
import { strings } from '../../strings';
import { useRefreshable } from '../../refresh';
import { apiHeaders } from '../../auth';
/*
 * THE TABLET DESK'S OWN CONTROLS, RENDERED IN PLACE (§13). Imported rather
 * than reimplemented: "may this be sent, and what happens when it is refused"
 * has one implementation, and a beginner's page is the last place that should
 * be allowed to drift from it.
 */
import {
  AgreementBands,
  CorrectOutcomeNotice,
  CorrectionPanel,
  STATE_TONE,
  SendAgain,
  SendSteps,
  SessionActions,
  SessionDisputeNotices,
  SessionOutcomeNotice,
  SessionTag,
  canSendAgain,
  disputedLabels,
  subjectForPatient,
  subjectForSession,
  usePushDesk,
  type PushDesk,
  type PushableRow,
} from '../tablet/pushDesk';
import { arrivedAtLabel, visitStateLabel } from '../practitioner/waiting/WaitingView';
import { dayRails } from './dayRails';
import { situationFor, visitChecklist, type ChecklistRow } from './visitChecklist';
import styles from './frontdesk.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/**
 * THE SAME THREE SECONDS THE TABLET DESK POLLS ON. `usePushDesk` runs its own
 * interval; this one is for the rail's one extra read, so the two halves of
 * the page never drift more than a tick apart.
 */
const POLL_MS = 3000;

/**
 * WHAT A CHOICE IS MADE OF — and it is NOT an agreement id (Carl, 12 Sep
 * 2026, testing).
 *
 * WHY THAT MATTERS MORE THAN IT SOUNDS. Answering "who is signing" on a
 * prepared row SUPERSEDES: the agreement reception was looking at leaves the
 * desk and a NEW one with a NEW id takes its place. A selection keyed on the
 * agreement id was therefore dropped on every successful save — the panel
 * snapped back to "Choose a name on the left" the moment somebody finished the
 * one form on it, which is the sharpest possible breach of §13's rule that
 * everything about the patient happens on this page.
 *
 * SO IT IS KEYED ON THE PERSON. A patient id survives supersession, survives
 * the row moving from "Here now" to "On a tablet", and is what a receptionist
 * thinks they chose in the first place. A booking that has not arrived has no
 * queue row at all, so that one is keyed on the appointment.
 */
type Kind = 'patient' | 'appointment';

interface Chosen {
  readonly kind: Kind;
  readonly key: string;
}

/**
 * HOLD THE ORDER SOMEBODY IS LOOKING AT (§12.3).
 *
 * WHAT IT DOES. Every key is remembered the first time it is seen, in the
 * order the server gave it; the list is then rendered in that remembered
 * order. On the FIRST load the memory is empty, so the result is exactly the
 * server's own order — which for `pushable` is arrival order through the
 * supersession chain, and this page must not second-guess it. On every later
 * poll, rows already on screen keep their place and new ones join the end.
 *
 * WHY, IN ONE SENTENCE. A list that reorders while somebody is reaching for it
 * is how the wrong patient gets chosen, and at a front desk the wrong patient
 * is a real person handed the wrong screen.
 *
 * A ROW THAT LEAVES IS FORGOTTEN, so the memory cannot grow all morning — and
 * one that comes back later comes back at the end, which is the truth: it is
 * new to the list again.
 *
 * EXPORTED FOR ITS OWN TEST. The rule is worth asserting directly as well as
 * through the rendered rail.
 */
export function stableByFirstSeen<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  memory: Map<string, number>,
): T[] {
  let next = 0;
  for (const rank of memory.values()) next = Math.max(next, rank + 1);
  for (const item of items) {
    const key = keyOf(item);
    if (!memory.has(key)) {
      memory.set(key, next);
      next += 1;
    }
  }
  const live = new Set(items.map(keyOf));
  for (const key of [...memory.keys()]) if (!live.has(key)) memory.delete(key);
  return [...items].sort((a, b) => (memory.get(keyOf(a)) ?? 0) - (memory.get(keyOf(b)) ?? 0));
}

/** The time on a row, or the honest statement that the booking carried none. */
export function timeLabel(time: string | null): string {
  return time && time.trim() !== '' ? time : strings.frontdesk.rail.noTime;
}

/**
 * WHICH TABLET, BY THE NAME THE DESK USES FOR IT — "the blue one" is how the
 * room talks (§12.2). Null when the devices read has not landed or failed,
 * and the panel then says "one of your tablets" rather than inventing a name.
 */
export function deviceLabelFor(deviceId: string | null | undefined, devices: readonly DeviceRow[]): string | null {
  if (!deviceId) return null;
  return devices.find((device) => device.id === deviceId)?.label ?? null;
}

export function FrontDeskView({ practiceId }: { practiceId: string }) {
  /*
   * THE TABLET DESK'S HOOK, WHOLE. It owns the reads, the three-second poll,
   * the outcome of the last press and every act reception can perform. This
   * page is a different ARRANGEMENT of the same work, never a second system
   * (§7) — so it takes the desk rather than fetching for itself.
   */
  const desk = usePushDesk(practiceId);
  const [expected, setExpected] = useState<ExpectedAppointment[]>([]);
  /**
   * TODAY'S REGISTER — every person who came in, including the ones the queue
   * has finished with (`GET /arrivals/day`, no date, so the day is the
   * SERVER's by the practice's clock and never this machine's guess).
   *
   * IT IS THE DENOMINATOR AND NOT DECORATION. The four arrived rails are a
   * partition of these rows, so the column adds up to the same number
   * `/practice/day` prints for the same day — which is the whole of Carl's
   * *"both pages have to reconcile"*.
   *
   * NULL MEANS "NOT READ", NOT "NOBODY CAME IN". Until it lands, and for as
   * long as it fails, the rail is the queue-only pair of groups the page had
   * before and there is no total on screen. Hard rule 8: a read that failed
   * slows the evidence, never the service.
   */
  const [register, setRegister] = useState<DayRegister | null>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  /**
   * WHO HAS JUST LEFT THE DESK, held only long enough to say so (§4's last
   * row). A name and nothing else — no agreement, no row, no state that could
   * be acted on — so this can never become a second, stale copy of a patient.
   */
  const [finished, setFinished] = useState<string | null>(null);
  /** Which patient's secondary controls are showing. One at a time, by choice. */
  const [expertFor, setExpertFor] = useState<string | null>(null);

  /*
   * TWO MEMORIES, NOT ONE. The queue and the expected list are pruned against
   * their own contents, and a single shared map would have each list deleting
   * the other's places on every poll — which is the exact re-sort this exists
   * to prevent.
   */
  const queueOrder = useRef(new Map<string, number>());
  const expectedOrder = useRef(new Map<string, number>());
  /** And a third, for the register, for the same reason and pruned the same way. */
  const dayOrder = useRef(new Map<string, number>());

  /*
   * A CHOICE BELONGS TO ONE PRACTICE AND NEVER FOLLOWS THE PAGE TO ANOTHER,
   * and neither does the order it was made in. The same reasoning the tablet
   * desk applies to a half-typed panel.
   */
  useEffect(() => {
    setChosen(null);
    setFinished(null);
    setExpertFor(null);
    queueOrder.current = new Map();
    expectedOrder.current = new Map();
    dayOrder.current = new Map();
    setRegister(null);
  }, [practiceId]);

  /*
   * THE ONE READ THE DESK DOES NOT MAKE (§12.4). Its failure is never the
   * page's: nobody is waiting on the booking list, and a queue that emptied
   * because an appointment feed was down would be the platform blocking work
   * over something nobody needs (hard rule 8).
   */
  const loadExpected = useCallback(async () => {
    const answer = await fetch(`${CORE_URL}/arrivals/expected`, { headers: apiHeaders(practiceId) }).catch(
      () => null,
    );
    const body = answer && answer.ok ? ((await answer.json()) as unknown) : null;
    setExpected(Array.isArray(body) ? (body as ExpectedAppointment[]) : []);
  }, [practiceId]);

  /*
   * AND THE READ THAT MAKES THE COLUMN ADD UP — the same `GET /arrivals/day`
   * that `/practice/day` makes, with NO DATE, because the day is the server's
   * answer by the practice's clock. Two pages asking the same endpoint the
   * same question is what "reconcile by construction" means here; a front desk
   * that worked out its own day would be the second definition of "today" this
   * codebase already has too many of.
   *
   * A FAILURE LEAVES THE REGISTER AS IT WAS rather than blanking it, so a
   * single dropped poll does not make the four arrived rails and the total
   * flicker out from under somebody mid-patient. The queue-only fallback is
   * for a register that has NEVER landed.
   */
  const loadDay = useCallback(async () => {
    const answer = await fetch(`${CORE_URL}/arrivals/day`, { headers: apiHeaders(practiceId) }).catch(
      () => null,
    );
    if (!answer || !answer.ok) return;
    const body = (await answer.json().catch(() => null)) as DayRegister | null;
    if (!body || !Array.isArray(body.rows)) return;
    setRegister(body);
  }, [practiceId]);

  /*
   * THE TOP BAR'S REFRESH BUTTON RE-READS EVERY HALF OF THE PAGE — and its
   * identity has to be STABLE, or `useRefreshable` de-registers and
   * re-registers it on every render (three times a second, once the poll is
   * running). `usePushDesk` returns a fresh object each render, so the
   * loaders are read through a ref rather than closed over.
   */
  const loaders = useRef({ desk: desk.load, expected: loadExpected, day: loadDay });
  loaders.current = { desk: desk.load, expected: loadExpected, day: loadDay };
  const reload = useCallback(async () => {
    await Promise.all([loaders.current.desk(), loaders.current.expected(), loaders.current.day()]);
  }, []);
  useRefreshable(reload);

  const latest = useRef({ expected: loadExpected, day: loadDay });
  latest.current = { expected: loadExpected, day: loadDay };
  useEffect(() => {
    const both = () => {
      void latest.current.expected();
      void latest.current.day();
    };
    both();
    const timer = setInterval(both, POLL_MS);
    return () => clearInterval(timer);
  }, [practiceId]);

  /*
   * THE QUEUE AND THE REGISTER, EACH HELD IN THE ORDER SOMEBODY IS LOOKING AT
   * (§12.3). Both arrive in arrival order — the queue through the supersession
   * chain, the register straight off `arrivedAt` — and nothing below re-sorts
   * either, so "who has waited longest" is still the server's answer.
   */
  const rows = desk.rows;
  const queue = useMemo(
    () => stableByFirstSeen(rows ?? [], (row) => row.agreementId, queueOrder.current),
    [rows],
  );
  const registerRows = register?.rows;
  const day = useMemo(
    () =>
      registerRows
        ? stableByFirstSeen(
            registerRows as readonly DayRegisterRow[],
            (row) => row.arrivalId,
            dayOrder.current,
          )
        : null,
    [registerRows],
  );

  /*
   * FIVE GROUPS, AND THE FIRST FOUR ARE A PARTITION OF THE DAY (`dayRails`).
   * Every row of the register lands in exactly one of them, so
   * `rails.arrivedToday` IS the number `/practice/day` prints for the same
   * day — which is the reconciliation, done by construction rather than by
   * two screens happening to agree.
   */
  const rails = useMemo(() => dayRails({ queue, day }), [queue, day]);
  const here = rails.here;
  const onTablet = rails.onTablet;

  /*
   * AND NOBODY IS IN TWO PLACES AT ONCE. A booking can have a draft waiting on
   * it before the patient walks in, so the same person could be named both in
   * the queue and among the expected. The queue wins: it is the list with work
   * on it, and a name under "yet to arrive" while there is something to do for
   * them at the desk would be a screen arguing with itself.
   */
  const inQueue = new Set(queue.map((row) => row.patientId));
  const waiting = stableByFirstSeen(
    expected.filter((appointment) => !inQueue.has(appointment.patientId)),
    (appointment) => appointment.appointmentId,
    expectedOrder.current,
  );

  /*
   * A CHOICE THAT HAS LEFT THE LIST IS NO CHOICE. The person signed, walked
   * away or arrived; keeping their name on the panel would leave somebody
   * acting on a person who is no longer there.
   */
  useEffect(() => {
    if (!chosen) return;
    const stillThere =
      chosen.kind === 'appointment'
        ? waiting.some((appointment) => appointment.appointmentId === chosen.key)
        : queue.some((row) => row.patientId === chosen.key);
    if (stillThere) return;
    /*
     * AND SAY SO RATHER THAN GOING BLANK (§4's last row). The panel used to
     * empty itself under somebody's hand the instant a row was signed, which
     * is the one moment the page should be clearest about. `setChosen(null)`
     * in the same pass means this fires once, not on every render after.
     */
    setFinished(chosen.kind === 'patient' ? (lastName.current ?? null) : null);
    setChosen(null);
  });

  /*
   * THE CHOSEN PERSON'S NAME, KEPT ONE RENDER AHEAD OF THEIR ROW LEAVING. By
   * the time the effect above notices, the row is already gone from the list
   * and there is nothing left to read a name off.
   */
  const lastName = useRef<string | null>(null);

  /*
   * THE PERSON'S CURRENT ROW, FOUND FRESH ON EVERY RENDER. After a party
   * change this is the SUCCESSOR — a different agreement id, the same patient
   * — which is exactly the row reception should now be acting on, and it
   * arrives without them having to find their place again.
   */
  const chosenRow = chosen && chosen.kind === 'patient'
    ? queue.find((row) => row.patientId === chosen.key) ?? null
    : null;
  const chosenAppointment = chosen && chosen.kind === 'appointment'
    ? waiting.find((appointment) => appointment.appointmentId === chosen.key) ?? null
    : null;
  if (chosenRow) lastName.current = chosenRow.patientName;

  /*
   * EXACTLY ONE ROW IS MARKED "DO THIS NEXT" (§4) — the top of "Here now",
   * which is the person who has waited longest, because the server orders the
   * queue by arrival through the supersession chain and this page never
   * re-sorts it. Not a priority scheme: the list said out loud, so there is no
   * decision to make.
   */
  const nextKey = here[0]?.key ?? null;

  /** Choosing anybody clears the line about whoever has just left. */
  const choosePerson = (next: Chosen) => {
    setFinished(null);
    setChosen(next);
  };

  if (desk.loadError && rows === null) {
    return (
      <Shell
        right={<SessionControl audience={strings.frontdesk.audience} />}
        title={strings.frontdesk.title}
        lead={strings.frontdesk.lead}
      >
        <Notice tone="stop" title={strings.frontdesk.notLoaded}>
          {desk.loadError}
        </Notice>
        {/*
          HARD RULE 8, LOUDEST WHERE IT MATTERS MOST. A page that cannot load
          is exactly where a first-day starter decides a patient has to wait,
          so the outage says the opposite before they can.
        */}
        <Notice tone="ok" data-testid="frontdesk-see-them-anyway">{strings.frontdesk.seeThemAnyway}</Notice>
      </Shell>
    );
  }

  return (
    <Shell
      right={<SessionControl audience={strings.frontdesk.audience} />}
      title={strings.frontdesk.title}
      lead={strings.frontdesk.lead}
    >
      {/* Hard rule 8, said out loud to the person most likely to doubt it. */}
      <Notice tone="ok" data-testid="frontdesk-never-blocks">{strings.frontdesk.neverBlocks}</Notice>

      {desk.loadError && (
        <>
          <Notice tone="warn" title={strings.frontdesk.notLoaded}>
            {desk.loadError}
          </Notice>
          <Notice tone="ok" data-testid="frontdesk-see-them-anyway">{strings.frontdesk.seeThemAnyway}</Notice>
        </>
      )}

      {/*
        LOOKING, NOT WORKING. The same statement the tablet desk makes for the
        same reason: an account without the practice's own claim sees the state
        and no controls, and every act behind them is `@PracticeScoped` on the
        server and would refuse it anyway.
      */}
      {!desk.canSend && (
        <Notice tone="warn" title={strings.viewOnly.title} data-testid="frontdesk-view-only">
          {strings.viewOnly.body}
        </Notice>
      )}

      <div className={styles.layout}>
        <nav className={styles.rail} aria-label={strings.frontdesk.rail.label} data-testid="frontdesk-rail">
          {/*
            THE NUMBER THE COLUMN ADDS UP TO (Carl, 12 September 2026: *"Both
            pages have to reconcile."*). It is `/practice/day`'s own count for
            the same day, and the four groups beneath it are a partition of the
            rows behind it — so a receptionist who sees fifteen there and three
            here can read where the other twelve went instead of concluding the
            desk is broken.

            ONLY WHEN THE REGISTER HAS LANDED. A total nobody can stand behind
            is worse than no total, so a read that has never answered leaves
            the page exactly as it was before this existed.
          */}
          {rails.arrivedToday !== null && (
            <p className={styles.total} data-testid="frontdesk-day-total">
              <span className={styles.totalCount}>
                <span className={styles.totalNumber} data-testid="frontdesk-day-total-number">
                  {rails.arrivedToday}
                </span>
                {strings.frontdesk.rail.dayTotalUnit(rails.arrivedToday)}
              </span>
              <span className={styles.totalWhy}>{strings.frontdesk.rail.dayTotalWhy}</span>
            </p>
          )}

          <RailGroup
            kind="patient"
            testId="here"
            tone="plain"
            title={strings.frontdesk.rail.hereNow}
            empty={strings.frontdesk.rail.hereNoneYet}
            chosen={chosen}
            nextKey={nextKey}
            onChoose={choosePerson}
            /*
              THE OTHER DOOR, UNDER THE GROUP IT IS ABOUT (Carl, 12 September
              2026: *"provide a button to go look at all patients here now
              (like we have in section [1] of /tablet page)."*).

              IT IS THE TABLET DESK'S OWN SECTION 1, which is that page's
              whole list of everybody waiting today with every control beside
              them — and it is REUSED rather than rebuilt here, because a
              second everybody-at-once list aimed at beginners would be the one
              that quietly went wrong (§7). The pairing already exists in the
              other direction: that page carries "Work one patient at a time →"
              to the patients list.

              A LINK, WHICH ACTS ON NOTHING — the rule the whole rail is built
              on (§12.3) — and it is not about a patient, so §13 is untouched.
            */
            link={{
              href: '/practice/tablet',
              label: strings.frontdesk.rail.seeEveryone,
              why: strings.frontdesk.rail.seeEveryoneWhy,
              testId: 'frontdesk-see-everyone',
            }}
            items={here.map((row) => ({
              key: row.key,
              selectKey: row.patientId,
              name: row.name,
              time: timeLabel(row.time),
              ticket: row.queueTicket,
              device: null,
            }))}
          />

          <RailGroup
            kind="patient"
            testId="tablet"
            tone="ok"
            title={strings.frontdesk.rail.onATablet}
            empty={strings.frontdesk.rail.tabletNoneYet}
            chosen={chosen}
            nextKey={null}
            onChoose={choosePerson}
            items={onTablet.map((row) => ({
              key: row.key,
              selectKey: row.patientId,
              name: row.name,
              time: timeLabel(row.time),
              ticket: row.queueTicket,
              /*
                WHICH TABLET, BY THE NAME THE PRACTICE GAVE IT (Carl, 12
                September 2026). Printed exactly as they wrote it and with
                nothing added around it — a sentence built around the label
                produces "has the Blue tablet tablet". Null while the devices
                read has not landed, and the row then says nothing rather than
                inventing a name.
              */
              device: deviceLabelFor(row.deviceId, desk.devices ?? []),
            }))}
          />

          {/*
            THE TWO GROUPS THAT CLOSE THE DAY, AND THEY ONLY EXIST ONCE THE
            REGISTER HAS BEEN READ — they are made of its rows, so without it
            there is nothing honest to put in them.

            "NEEDS A LOOK" COMES FIRST AND "FINISHED" LAST (Carl, 12 September
            2026). Finished is the one rail nobody has to act on, so it goes to
            the bottom of the arrived groups; the anomaly sits directly under
            the work, where somebody scanning the column reaches it before they
            reach the people they have nothing left to do for.

            NEITHER IS SELECTABLE, and that is deliberate rather than
            unfinished. There is no queue row behind either, so there is
            nothing for the panel to be about and no control that could be
            offered; a button that fills the panel with nothing is a dead end
            a first-day starter cannot get out of. The rail is a place to LOOK
            (§12.2), and these two are the part of the day it was not looking
            at. What reception DOES about "needs a look" is the sentence under
            the group, not a control this build invented.
          */}
          {rails.arrivedToday !== null && (
            <>
              <RailGroup
                kind="patient"
                testId="needs-a-look"
                tone="warn"
                title={strings.frontdesk.rail.needsALook}
                empty={strings.frontdesk.rail.needsALookNoneYet}
                why={rails.needsALook.length > 0 ? strings.frontdesk.rail.needsALookWhy : undefined}
                chosen={chosen}
                nextKey={null}
                onChoose={choosePerson}
                items={rails.needsALook.map((row) => ({
                  key: row.key,
                  selectKey: row.patientId,
                  name: row.name,
                  time: timeLabel(row.time ? arrivedAtLabel(row.time) : null),
                  ticket: row.queueTicket,
                  device: null,
                }))}
              />

              {/*
                SIGNED, AND STILL WAITING FOR THE PRACTITIONER
                (D-2026-09-12-20). Between the anomaly and the finished,
                because that is where they are in the morning: nothing is wrong
                with anybody here, and there is nothing for the desk to do.
              */}
              <RailGroup
                kind="patient"
                testId="waiting-to-be-seen"
                tone="quiet"
                title={strings.frontdesk.rail.waitingToBeSeen}
                empty={strings.frontdesk.rail.waitingToBeSeenNoneYet}
                chosen={chosen}
                nextKey={null}
                onChoose={choosePerson}
                items={rails.waitingToBeSeen.map((row) => ({
                  key: row.key,
                  selectKey: row.patientId,
                  name: row.name,
                  time: timeLabel(row.time ? arrivedAtLabel(row.time) : null),
                  ticket: row.queueTicket,
                  device: null,
                }))}
              />

              <RailGroup
                kind="patient"
                testId="finished"
                tone="info"
                title={strings.frontdesk.rail.finished}
                empty={strings.frontdesk.rail.finishedNoneYet}
                chosen={chosen}
                nextKey={null}
                onChoose={choosePerson}
                items={rails.finished.map((row) => ({
                  key: row.key,
                  selectKey: row.patientId,
                  name: row.name,
                  time: timeLabel(row.time ? arrivedAtLabel(row.time) : null),
                  ticket: row.queueTicket,
                  device: null,
                }))}
              />
            </>
          )}

          {/*
            PAPERWORK OPEN WITH NOBODY RECORDED AS COMING IN FOR IT TODAY —
            shown ONLY when it has somebody in it, which is the difference
            between it and "Expected" below. Expected is empty in every
            practice today for a reason worth explaining on screen; this one is
            empty because the day is behaving, and a permanently empty box
            saying so would be noise on a first shift.

            OUTSIDE THE TOTAL, and it says so, because these are not rows of
            the day the number is counting — which is also why it is quiet
            rather than coloured like the four that are.
          */}
          {rails.notArrived.length > 0 && (
            <RailGroup
              kind="patient"
              testId="not-arrived"
              tone="quiet"
              title={strings.frontdesk.rail.notArrived}
              empty={strings.frontdesk.rail.hereNoneYet}
              why={strings.frontdesk.rail.notArrivedWhy}
              chosen={chosen}
              nextKey={null}
              onChoose={choosePerson}
              items={rails.notArrived.map((row) => ({
                key: row.key,
                selectKey: row.patientId,
                name: row.name,
                time: timeLabel(row.time),
                ticket: row.queueTicket,
                device: deviceLabelFor(row.deviceId, desk.devices ?? []),
              }))}
            />
          )}

          {/*
            EXPECTED IS ALWAYS HERE, EVEN — ESPECIALLY — WHEN IT IS EMPTY
            (§12.5, and Carl's recommendation there). Appointments only reach
            us when the practice's software sends them, which is behind blocker
            D-01, so this list is empty in every practice today. Hiding it
            would make that a silent gap; showing it with the reason turns "why
            can't I see my bookings" into an answer from the screen.

            THE QUIETEST OF THE FIVE, because nobody has arrived yet and it is
            outside the day's total.
          */}
          <RailGroup
            kind="appointment"
            testId="expected"
            tone="quiet"
            title={strings.frontdesk.rail.expected}
            empty={strings.frontdesk.rail.expectedNoneYet}
            why={waiting.length === 0 ? strings.frontdesk.rail.expectedWhy : undefined}
            chosen={chosen}
            nextKey={null}
            onChoose={choosePerson}
            items={waiting.map((appointment) => ({
              key: appointment.appointmentId,
              selectKey: appointment.appointmentId,
              name: appointment.patientName,
              time: timeLabel(appointment.time),
              /* A booking has no card: nobody has handed them one yet. */
              ticket: null,
              device: null,
            }))}
          />

          {/*
            THE WHOLE DAY, BELOW THE THREE RAILS (Carl, 12 September 2026: *"Add
            a button here with a link to show all Patients seen at this practice
            today. You could put a filter on this to search for any day. Default
            to today."*).

            BELOW THEM RATHER THAN AMONG THEM, and that is the meaning. The
            three groups above are the morning as it stands, and a person leaves
            them the moment their paperwork is done; the register keeps
            everybody, including the people these lists have already finished
            with. A fourth `RailGroup` would have said the two were the same
            kind of thing.

            A LINK, WHICH ACTS ON NOTHING. §12.3: there is no control anywhere
            in this column that sends, recalls or confirms — and a navigation
            link is the one thing that can be added here without breaking that.
          */}
          <p className={styles.dayLink}>
            <Link href="/practice/day" className={ui.buttonLink} data-testid="frontdesk-to-day">
              <CalendarDays size={15} aria-hidden="true" />
              {strings.frontdesk.rail.dayRegister}
            </Link>
            <span className={styles.dayWhy}>{strings.frontdesk.rail.dayRegisterWhy}</span>
          </p>
        </nav>

        <section className={styles.panel} aria-label={strings.frontdesk.title} data-testid="frontdesk-panel">
          {!chosen && !finished && (
            <>
              <h2 className={styles.panelName}>{strings.frontdesk.panel.nothingChosen}</h2>
              <p className={styles.panelLead}>{strings.frontdesk.panel.nothingChosenLead}</p>
            </>
          )}

          {!chosen && finished && (
            <>
              <h2 className={styles.panelName} data-testid="frontdesk-finished">
                {strings.frontdesk.panel.finished(finished)}
              </h2>
              <p className={styles.panelLead}>{strings.frontdesk.panel.finishedLead}</p>
              <div className={styles.action} data-testid="frontdesk-action">
                <Button
                  variant="primary"
                  onClick={() => setFinished(null)}
                  data-testid="frontdesk-next-patient"
                >
                  {strings.frontdesk.panel.nextPatient}
                </Button>
              </div>
            </>
          )}

          {chosenRow && (
            /*
             * KEYED ON THE PERSON. Without a key React reuses one instance
             * across a change of selection, and any state inside it — a
             * half-opened disclosure, a confirmation waiting for an answer —
             * would arrive already open on the next patient. Keying it throws
             * that state away with the person it belonged to.
             */
            <PatientPanel
              key={chosenRow.patientId}
              desk={desk}
              row={chosenRow}
              expertOpen={expertFor === chosenRow.patientId}
              onExpert={(open) => setExpertFor(open ? chosenRow.patientId : null)}
            />
          )}

          {chosenAppointment && (
            <>
              <h2 className={styles.panelName} data-testid="frontdesk-chosen-name">
                {chosenAppointment.patientName}
              </h2>
              <p className={styles.panelLead} data-testid="frontdesk-chosen-what">
                {strings.frontdesk.panel.expected(chosenAppointment.patientName)}
              </p>
              <p className={styles.panelNext}>{strings.frontdesk.panel.expectedNext}</p>
            </>
          )}
        </section>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// One patient, everything about them
// ---------------------------------------------------------------------------

/**
 * ONE CHOSEN PERSON: the sentence, the checklist, the one action, the reason
 * it cannot go, and every other control behind one disclosure.
 *
 * NOTHING ABOUT THE PATIENT LEAVES THIS COMPONENT (§13). It renders no
 * `Link`, and the one refusal whose shortcut is a per-patient screen has that
 * destination withheld (`offerPatientPage={false}`) — the sentence still says
 * what is in the way. Configuration destinations that a refusal offers — the
 * devices page, the kiosk setting — are practice work rather than patient
 * work and §13 leaves them alone.
 */
function PatientPanel({
  desk,
  row,
  expertOpen,
  onExpert,
}: {
  desk: PushDesk;
  row: PushableRow;
  expertOpen: boolean;
  onExpert: (open: boolean) => void;
}) {
  /*
   * IS IT ON A TABLET RIGHT NOW? — the same question, decided the same way, as
   * on the tablet desk's own row: a session that has ENDED leaves the row a
   * thing to send again.
   */
  const session = row.activeSession
    ? desk.sessions.find((s) => s.id === row.activeSession!.id)
    : undefined;
  const live = session && session.endedAt === null ? session : undefined;
  const situation = situationFor(row, live ?? null);

  /*
   * THE CHECKLIST IS ABOUT THE PERSON, NOT ABOUT ONE AGREEMENT. A patient can
   * have an agreement for today's visit AND one raised after a service was
   * billed, and reading only the chosen row would hide half of their morning.
   */
  const mine = (desk.rows ?? []).filter((r) => r.patientId === row.patientId);
  const covered = (desk.covered ?? []).filter((line) => line.patientId === row.patientId);
  const checklist = visitChecklist(mine, covered, (id) => deviceLabelFor(id, desk.devices ?? []));

  /*
   * THE LAST SESSION THIS AGREEMENT HAD, where it has ended and the agreement
   * could still go. `SendAgain` carries the signature-failure sentence as well
   * as the button, which is why it is drawn even though the numbered card can
   * also send.
   */
  const ended = !live
    ? [...desk.sessions]
        .filter((s) => s.agreementId === row.agreementId && s.endedAt !== null)
        .sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt)))[0]
    : undefined;
  const again = ended && canSendAgain(ended) ? ended : undefined;

  /*
   * WHOSE DETAILS "FIX A DETAIL" IS ABOUT. A live session knows which rows the
   * patient crossed; without one there is still a patient whose details can be
   * corrected at the desk, which is the ordinary "they mentioned it across the
   * counter" case.
   */
  const subject = live ? subjectForSession(live) : subjectForPatient(row.patientId);
  const deviceName = deviceLabelFor(row.activeSession?.deviceId ?? live?.deviceId, desk.devices ?? []);

  const sentence =
    situation === 'on_a_tablet'
      ? deviceName
        ? strings.frontdesk.panel.onATablet(row.patientName, deviceName)
        : strings.frontdesk.panel.onATabletUnnamed(row.patientName)
      : situation === 'detail_wrong'
        ? strings.frontdesk.panel.detailWrong(
            row.patientName,
            disputedLabels(live?.disputedDetails ?? []),
          )
        : situation === 'waiting'
          ? strings.frontdesk.panel.waiting(row.patientName)
          : situation === 'who_is_signing'
            ? strings.frontdesk.panel.whoIsSigning(row.patientName)
            : strings.frontdesk.panel.readyToSend(row.patientName, row.providerName);

  /*
   * THE NUMBERED CARD, IN ROW 3 OF THE CHECKLIST — Carl's second note. It is
   * drawn only where it could actually be used: a strip of three steps over an
   * agreement that can never go would teach a beginner the page is broken
   * (CLAUDE.md §6), so the situations that need something else say so instead
   * and the reason band below carries the fix.
   */
  const sendCard =
    situation === 'who_is_signing' || situation === 'ready_to_send' ? (
      <div className={styles.action} data-testid="frontdesk-action">
        <SendSteps desk={desk} row={row} />
      </div>
    ) : null;

  /*
   * WHERE IT IS RIGHT NOW, IN THE TABLET DESK'S OWN WORDS AND COLOURS (Carl,
   * 12 Sep 2026: *"Why are you not just copying the existing logic."*).
   *
   * "On Blue tablet now · a1b2c3d4" — the same sentence, the same tone map and
   * the same eight-character session tag `AgreementRow` shows, so a
   * receptionist reading this page and a colleague reading the tablet desk are
   * looking at the same fact in the same words. Built from the ROW's own
   * `activeSession`, which the server derives from the sessions it has not
   * ended, rather than from the separate session list — so it is right on the
   * first render rather than one read later.
   *
   * "STILL TO DO" ON ROW 3 IS A DIFFERENT FACT and both are shown. Whether
   * the paperwork is done and where the paperwork currently IS are two
   * questions, and a checklist state cannot answer the second.
   */
  const liveChip = (where: string) =>
    row.activeSession ? (
      <Chip tone={STATE_TONE[row.activeSession.state] ?? 'neutral'}>
        {strings.tablet.onTabletNow(deviceName ?? strings.frontdesk.panel.someTablet)}{' '}
        ·{' '}
        {/*
          A FUNCTION AND NOT A CONSTANT, so the two places it is drawn — over
          the panel and beside checklist row 3 — carry different test ids. One
          element rendered twice would put the same id in the DOM twice, which
          makes every query for it ambiguous.
        */}
        <SessionTag id={row.activeSession.id} testId={`frontdesk-session-id-${where}`} />
      </Chip>
    ) : null;

  /*
   * AND WHAT HAS GONE WRONG ON IT, IF ANYTHING — the same two faults the
   * tablet desk's row chips, computed the same way and closed by the same
   * resolution. NO LINK BESIDE IT, and that is §13 rather than an omission:
   * the tablet desk's chip links to the device card because the fix lives
   * there; here the fix is the four buttons directly below.
   */
  const liveFault = !live
    ? null
    : live.disputedDetails.length > 0 && !live.disputeResolution
      ? strings.tablet.liveFaultDetail
      : live.signatureFailureReason
        ? strings.tablet.liveFaultSignature
        : null;

  return (
    <>
      <h2 className={styles.panelName} data-testid="frontdesk-chosen-name">
        {row.patientName}
      </h2>
      {/*
        THE PRACTICE'S OWN NUMBER, DIRECTLY UNDER THE NAME (Carl, 12 September
        2026: "patientid missing under patient name"). It is the handle
        reception reads out and types into the practice's own software, so a
        panel that named the person without it made somebody cross-check by
        name and date of birth -- slower, and wrong for two people who share a
        name. Said even when absent, because a blank line under a name reads as
        a page that failed to load.
      */}
      {/*
        AND OUR OWN RECORD ID UNDER IT (Carl, 12 September 2026: *"ok. In that
        case show both ids."*). The tablet desk used to print ours where this
        printed the practice's, so the two screens named one person two ways;
        `PatientIdentity` is the single component both now render, in one order
        and one set of words, so they cannot disagree again.
      */}
      <PatientIdentity
        className={styles.panelRecordNumber}
        practiceNumber={row.patientRecordNumber}
        recordId={row.patientId}
        testId="frontdesk-chosen-record-number"
      />
      <p className={styles.panelLead} data-testid="frontdesk-chosen-what">
        {sentence}
      </p>

      {row.activeSession && (
        <p className={styles.liveLine} data-testid="frontdesk-live">
          {liveChip('panel')}
          {liveFault && <Chip tone="stop">{liveFault}</Chip>}
        </p>
      )}

      {/*
        WHAT THE PATIENT SAID IS WRONG, IF ANYTHING — the reason, above the
        action that answers it. The tablet desk's own notice, unchanged: types
        in our words, never values (hard rule 9), and it closes itself once
        somebody has answered the dispute.
      */}
      {live && <SessionDisputeNotices session={live} />}

      <div className={styles.checklist} data-testid="frontdesk-checklist">
        <h3 className={styles.checklistTitle}>{strings.frontdesk.checklist.title}</h3>
        <p className={ui.hint}>{strings.frontdesk.checklist.lead}</p>
        <ol className={styles.checkRows}>
          {checklist.map((item) => (
            <li
              key={item.key}
              className={styles.checkRow}
              data-state={item.state}
              data-testid={`frontdesk-check-${item.key}`}
            >
              <div className={styles.checkHead}>
                <span className={styles.checkLabel}>{strings.frontdesk.checklist.rows[item.key]}</span>
                <Chip tone={item.state === 'done' ? 'ok' : item.state === 'outstanding' ? 'warn' : 'neutral'}>
                  <span data-testid={`frontdesk-check-state-${item.key}`}>{stateWord(item.state)}</span>
                </Chip>
              </div>
              <p className={ui.hint} data-testid={`frontdesk-check-detail-${item.key}`}>
                {detailSentence(item)}
              </p>
              {/*
                THE VERSIONED POLICY'S OWN ANSWER, WHERE ONE DECIDED THIS ROW
                (hard rule 14) — and the rule key itself where this screen has
                no wording for it, so a newer reason is quotable rather than
                hidden (CLAUDE.md §7).
              */}
              {item.ruleKey && (
                <p className={ui.hint} data-testid={`frontdesk-check-why-${item.key}`}>
                  {strings.frontdesk.checklist.why[item.ruleKey]
                    ?? strings.frontdesk.checklist.whyUnknown(item.ruleKey)}
                </p>
              )}
              {/*
                AND WHERE IT IS. Carl, 12 Sep 2026: row 3 said "Still to do"
                and nothing about the agreement being in somebody's hands at
                that moment. The state is the paperwork; the chip is the
                place.
              */}
              {item.key === 'signed' && row.activeSession && (
                <p className={styles.liveLine} data-testid="frontdesk-check-live">
                  {liveChip('row')}
                </p>
              )}
              {/* CARL'S SECOND NOTE: the send card belongs to this step. */}
              {item.key === 'signed' && sendCard}
            </li>
          ))}
        </ol>
      </div>

      {/*
        THE ONE PRIMARY ACTION, where it is not the numbered card. Its label is
        the sentence somebody would say; everything else is behind the
        disclosure below.
      */}
      {/*
        A LIVE TABLET IS ANSWERED BY THE TABLET DESK'S OWN CONTROLS, VERBATIM
        (Carl, 12 Sep 2026). Recall, Correct, "No change needed — the details
        were right" and Re-send, in that order, from `SessionActions` — the
        same component `/practice/tablet` renders, so the two pages cannot come
        to offer different answers to the same session.

        AND IT IS STILL ONE ANSWER (§4). `SessionActions` lights exactly one
        primary — Re-send, and only once a detail has been disputed; a session
        nobody has crossed anything on offers Recall alone. What was here
        before was a simplified "Bring it back" of this page's own, which said
        a different thing about the same act and hid the other three.
      */}
      {live && (
        <div className={styles.action} data-testid="frontdesk-action">
          <SessionActions desk={desk} session={live} />
        </div>
      )}

      {/*
        THE REASON IT CANNOT GO WITH ITS OWN FIX IN IT, THE OUTCOME OF THE LAST
        PRESS, AND THE WHO-IS-SIGNING FORM — the tablet desk's own bands,
        rendered here rather than copied (§7). `offerPatientPage={false}` is
        §13: the sentence stays, the hop to another patient screen does not.
      */}
      <AgreementBands desk={desk} row={row} offerPatientPage={false} />

      {/*
        THE CORRECTION FORM, OUTSIDE THE DISCLOSURE, because the primary action
        above opens it. It draws nothing until it is open.
      */}
      <CorrectionPanel desk={desk} subject={subject} />
      <CorrectOutcomeNotice desk={desk} subjectKey={subject.key} testId="frontdesk-correct-outcome" />

      {/*
        ONE CONTROL FOR EVERYTHING ELSE (§4), NAMED FOR WHAT THE READER WANTS.
        In the situation §4's table calls "cannot proceed" it says "Get help" —
        and §13 changed what that means: it REVEALS the expert controls here,
        under the same patient, instead of handing them to another page
        mid-task.
      */}
      <div className={styles.disclose}>
        <Button
          variant="subtle"
          aria-expanded={expertOpen}
          onClick={() => onExpert(!expertOpen)}
          data-testid="frontdesk-disclose"
        >
          {expertOpen
            ? strings.frontdesk.panel.moreClose
            : situation === 'waiting'
              ? strings.frontdesk.panel.getHelp
              : strings.frontdesk.panel.more}
        </Button>
      </div>

      {expertOpen && (
        <div className={styles.expert} data-testid="frontdesk-expert">
          <p className={styles.checklistTitle}>{strings.frontdesk.panel.expertTitle}</p>
          <p className={ui.hint}>{strings.frontdesk.panel.expertLead}</p>
          {again && <SendAgain desk={desk} ended={again} />}
          {!live && !again && (
            <Button
              disabled={!desk.canSend || desk.correctBusy}
              onClick={() => (desk.correctFor === subject.key ? desk.closeCorrect() : void desk.openCorrect(subject))}
              data-testid="frontdesk-expert-correct"
            >
              <PencilLine size={14} aria-hidden="true" />
              {strings.frontdesk.panel.fixTheirDetails}
            </Button>
          )}
          <SessionOutcomeNotice
            desk={desk}
            id={live?.id ?? again?.id}
            testId="frontdesk-session-outcome"
            linkTestId="frontdesk-session-outcome-link"
            recallTestId="frontdesk-session-outcome-recall"
          />
        </div>
      )}
    </>
  );
}

/**
 * DONE, STILL TO DO, DROPPED, OR NOTHING TO SIGN — the words, from the table.
 *
 * EXPORTED, AND THE SECOND COPY DELETED (wow.md §10 rule 3). The small front
 * desk had an identical one, which meant every new state and every new detail
 * key had to be learned twice and one of them would eventually be missed —
 * `visitState` was, within an hour of being added. One renderer, two screens.
 */
export function stateWord(state: ChecklistRow['state']): string {
  return state === 'done'
    ? strings.frontdesk.checklist.state.done
    : state === 'outstanding'
      ? strings.frontdesk.checklist.state.outstanding
      : state === 'cancelled'
        ? strings.frontdesk.checklist.state.cancelled
        : strings.frontdesk.checklist.state.notNeeded;
}

/** The row's own sentence, resolved from the key the computation returned. */
export function detailSentence(item: ChecklistRow): string {
  const said = strings.frontdesk.checklist.detail;
  switch (item.detail) {
    case 'todaysVisit':
      return said.todaysVisit(item.provider ?? null);
    case 'ongoing':
      return said.ongoing(item.provider ?? null);
    case 'withThemNow':
      return said.withThemNow(item.device ?? null);
    /*
     * THE VISIT'S OWN STATE, IN THE VERSIONED LIST'S OWN WORDS
     * (D-2026-09-12-20). `visitStateLabel` is the practitioner queue's, reused
     * rather than copied: the front desk and the practitioner must read ONE
     * word for one state, which is the entire point of the step. An unmapped
     * key shows its key rather than a blank (CLAUDE.md §7).
     */
    case 'visitState':
      return item.visitState ? visitStateLabel(item.visitState) : said.noVisitToSee;
    default:
      return said[item.detail];
  }
}

interface RailItem {
  /** The row's own id, which is what a test and a support ticket name. */
  readonly key: string;
  /**
   * WHAT CHOOSING IT SELECTS — the person, or the booking. See `Chosen`.
   *
   * NULL WHERE THERE IS NOTHING TO CHOOSE. A finished visit and an arrival
   * with nothing open have no queue row behind them, so the panel would have
   * nothing to be about; the row is drawn as text instead of as a control,
   * because a button that leads nowhere is a dead end a first-day starter
   * cannot get back out of.
   */
  readonly selectKey: string | null;
  readonly name: string;
  readonly time: string;
  /**
   * THE NUMBER ON THE CARD IN THEIR HAND, LEADING THE ROW
   * (`QUEUE-TICKETS.md` §4.2: *"call number twelve" is the job*). Null at every
   * practice that does not hand out cards, which is the default, and null on a
   * booking nobody has handed one to yet.
   */
  readonly ticket: string | null;
  /**
   * WHICH TABLET THEY HAVE, as the practice named it (Carl, 12 September
   * 2026). Small, quiet, and printed with nothing added around it — a sentence
   * built around the label produces "has the Blue tablet tablet".
   */
  readonly device: string | null;
}

/**
 * A COLOUR PER RAIL, SO THE EYE LANDS ON THE RIGHT ONE (Carl, 12 September
 * 2026: *"Put colour on the list heading and the number. Reason: I want my eye
 * to be drawn to each list."*).
 *
 * IT IS A PLACE, NOT A SEVERITY. Four colours read as a taxonomy if they are
 * meant as one; these are meant as landmarks, so nothing anywhere ranks them
 * and no key has to be learned. `plain` is "Here now" — uncoloured, which is
 * the STRONGEST treatment on the column, because it is the work.
 *
 * COLOUR IS NEVER THE ONLY CARRIER (WCAG 2.2 AA 1.4.1). Every heading says in
 * words what its rail is and the count is spoken as a whole sentence beside
 * it; every value is an existing token and every one passes AA for small text
 * on the panel (see `frontdesk.module.css`).
 */
type RailTone = 'plain' | 'ok' | 'warn' | 'info' | 'quiet';

const TONE_CLASS: Record<RailTone, string | undefined> = {
  plain: undefined,
  ok: styles.toneOk,
  warn: styles.toneWarn,
  info: styles.toneInfo,
  quiet: styles.toneQuiet,
};

/**
 * ONE GROUP OF THE RAIL.
 *
 * THE COUNT IS THE LIVE REGION, NOT THE ROWS (§12.3). A patient moving from
 * Expected to Here now is worth announcing; every poll is not. The spoken
 * version names its group — "Here now: 2 people" — because a bare number
 * announced on its own, minutes after the heading was read, tells nobody
 * anything.
 *
 * EVERY ROW IS A BUTTON AND EVERY BUTTON ONLY CHOOSES. `aria-pressed` says
 * which one is chosen, so the choice is carried by more than a background
 * colour, and the whole row is the target rather than the name inside it.
 *
 * EXACTLY ONE ROW IS MARKED NEXT (§4), and only in "Here now" — the other two
 * groups are people nobody can act on yet. The mark is a word, not a colour,
 * for the same reason every other state on this page is.
 */
function RailGroup({
  kind,
  testId,
  tone,
  title,
  empty,
  why,
  link,
  items,
  chosen,
  nextKey,
  onChoose,
}: {
  kind: Kind;
  testId: string;
  tone: RailTone;
  title: string;
  empty: string;
  why?: string;
  /** One way out of this group, and it navigates rather than acting (§12.3). */
  link?: { href: string; label: string; why: string; testId: string };
  items: readonly RailItem[];
  chosen: Chosen | null;
  nextKey: string | null;
  onChoose: (chosen: Chosen) => void;
}) {
  const count = strings.frontdesk.rail.count(items.length);
  return (
    <div
      className={[styles.group, TONE_CLASS[tone]].filter(Boolean).join(' ')}
      data-testid={`frontdesk-group-${testId}`}
    >
      <div className={styles.groupHead}>
        <h2 className={styles.groupTitle}>{title}</h2>
        {/*
          THE NUMBER, PICKED OUT (Carl, 12 September 2026: *"Make the font bold
          and a diff colour for the number - so it stands out"*). Drawn as two
          pieces so the digit can carry the weight and the accent while the
          word stays quiet; the whole thing is still one sentence to a screen
          reader, next door, because "3" announced on its own says nothing.
        */}
        <span className={styles.groupCount} aria-hidden="true" data-testid={`frontdesk-count-${testId}`}>
          <span className={styles.countNumber}>{items.length}</span>
          {` ${strings.frontdesk.rail.countUnit(items.length)}`}
        </span>
        <span className={styles.visuallyHidden} aria-live="polite">
          {`${title}: ${count}`}
        </span>
      </div>

      {items.length === 0 ? (
        <p className={styles.empty} data-testid={`frontdesk-empty-${testId}`}>
          {empty}
        </p>
      ) : (
        <ul className={styles.rows}>
          {items.map((item) => {
            const body = (
              <>
                {/*
                  THE CARD NUMBER FIRST, because "call number twelve" is the
                  job (QUEUE-TICKETS.md §4.2). Spoken with its word so a screen
                  reader hears "Number 12" and not a stray digit; drawn as the
                  number alone, because the card in their hand says nothing
                  else either. Absent entirely at a practice with no card box.
                */}
                {item.ticket && (
                  <span className={styles.ticket} data-testid={`frontdesk-ticket-${item.key}`}>
                    <span aria-hidden="true">{item.ticket}</span>
                    <span className={styles.visuallyHidden}>
                      {strings.frontdesk.rail.ticket(item.ticket)}
                    </span>
                  </span>
                )}
                <span className={styles.name}>{item.name}</span>
                {item.key === nextKey && (
                  <span className={styles.next} data-testid={`frontdesk-next-${item.key}`}>
                    {strings.frontdesk.rail.next}
                  </span>
                )}
                <span className={styles.time}>{item.time}</span>
                {/*
                  AND WHICH TABLET, AS THE PRACTICE NAMED IT — nothing added
                  around the label, because "has the Blue tablet tablet" is
                  what a sentence built around it produces.
                */}
                {item.device && (
                  <span className={styles.device} data-testid={`frontdesk-device-${item.key}`}>
                    {item.device}
                  </span>
                )}
              </>
            );
            return (
              <li key={item.key} className={styles.row}>
                {item.selectKey === null ? (
                  /*
                    A ROW WITH NOTHING BEHIND IT IS NOT A CONTROL. Same layout,
                    no button: it can be read, it cannot be pressed, and there
                    is no focus stop that leads to an empty panel.
                  */
                  <span className={styles.read} data-testid={`frontdesk-row-${item.key}`}>
                    {body}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={styles.pick}
                    aria-pressed={chosen?.kind === kind && chosen.key === item.selectKey}
                    onClick={() => onChoose({ kind, key: item.selectKey as string })}
                    data-testid={`frontdesk-row-${item.key}`}
                  >
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {why && (
        <p className={styles.why} data-testid={`frontdesk-why-${testId}`}>
          {why}
        </p>
      )}

      {link && (
        <p className={styles.groupLink}>
          <Link href={link.href} className={ui.buttonLink} data-testid={link.testId}>
            <Users size={15} aria-hidden="true" />
            {link.label}
          </Link>
          <span className={styles.dayWhy}>{link.why}</span>
        </p>
      )}
    </div>
  );
}
