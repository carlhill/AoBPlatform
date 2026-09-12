'use client';

/**
 * THE FRONT DESK ON A SMALL SCREEN — one list, not five rails.
 *
 * CARL, 12 SEPTEMBER 2026: *"If the Practice has small screens, we will need
 * to go to a different design."* The design is written up in
 * SESSION-HANDOVER.md, "A proposal for the small-screen version"; this is it.
 *
 * ONE LIST, AND WHY THAT IS NOT A RESTYLE. `/practice/frontdesk` stacks five
 * rails, and the five rails are five STATES. They exist because the day has to
 * partition so the desk and the day register reconcile — a requirement on the
 * DATA, not on the layout. A receptionist does not think in states; they think
 * "who do I deal with next". So this page prints **everybody here today in
 * arrival order, each row carrying its own state marker**, and moves the
 * partition into one strip of filter chips above it.
 *
 * WHAT THAT BUYS, IN PIXELS. On the morning this was written four of the five
 * rails were empty and still carried a heading, a count and an explanatory
 * paragraph each — most of the column, spent on nobody. Those five headings,
 * five counts and five empty-state paragraphs collapse into one strip. That is
 * the difference between seeing three patients on a 1366x768 screen and seeing
 * the room.
 *
 * WHAT IT COSTS, STATED HONESTLY. At-a-glance grouping. On the wide desk you
 * can see "three people are finished" without reading anything; here the chip
 * has to carry it, and a chip is smaller than a heading. That is the trade,
 * and it is only worth taking when the room is bigger than the screen — which
 * is why BOTH pages exist and neither replaces the other.
 *
 * THE DETAIL OPENS IN PLACE, under the person's own row, and the list never
 * leaves the screen. This honours Carl's §13 — *"everything to do with the
 * patient must be on this page — no going to another page"* — more literally
 * than a second column does, because there is nowhere to be sent: no panel to
 * scroll to, no place to lose.
 *
 * IT IS A SECOND VIEW OF ONE DATASET, NEVER A SECOND DATASET (§7). Every fact
 * comes from `usePushDesk` — the tablet desk's own hook, reads and three-second
 * poll — plus the booking list and the day register (`useDayReads`), and every
 * state comes from `dayRails`, which `/practice/frontdesk` also calls. There is
 * no second definition of "here now", of "pushable", or of what day it is.
 *
 * AND THE CHIPS ADD UP (`frontdesk_small_chips_add_up_to_the_day_register`).
 * `Here now + On a tablet + Needs a look + Finished` IS the number
 * `/practice/day` prints for the same day, exactly as the five rails are. That
 * test is the guard against two views of one morning drifting apart; the
 * layout is merely how it is satisfied.
 *
 * NOTHING HERE BLOCKS CARE (hard rule 8, REQ-REC-04) — and the promise costs
 * one line rather than three stacked notices, because Carl's own note is that
 * three notices push the work a third of the way down the screen. It is said
 * quietly on every ordinary morning and LOUDLY in the one moment it matters:
 * when the platform itself cannot be reached.
 *
 * NO MEDICARE CARD NUMBER ANYWHERE (hard rule 1, REQ-VER-02). The practice's
 * own patient number is an approved identifier and is on the row, because it
 * is the handle reception reads out; the card number is not an identifier in
 * this regime, there is no field for it, and there never will be. No amounts
 * (hard rule 4) and no identifier values in anything logged (hard rule 9).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button, Chip, Notice, PatientIdentity, Shell, ui } from '../../ui';
import { SessionControl } from '../../SessionControl';
import { strings } from '../../strings';
import { useRefreshable } from '../../refresh';
/*
 * THE TABLET DESK'S OWN CONTROLS, RENDERED IN PLACE. Imported rather than
 * reimplemented: "may this be sent, and what happens when it is refused" has
 * ONE implementation, and a third arrangement of the desk is the last place
 * that should be allowed to drift from it (wow.md §10).
 */
import {
  AgreementBands,
  CorrectOutcomeNotice,
  CorrectionPanel,
  STATE_TONE,
  SendSteps,
  SessionActions,
  SessionDisputeNotices,
  SessionTag,
  disputedLabels,
  subjectForPatient,
  subjectForSession,
  usePushDesk,
  type PushDesk,
  type PushableRow,
} from '../tablet/pushDesk';
/*
 * AND THE WIDE DESK'S OWN HELPERS, likewise. `stableByFirstSeen` is the rule
 * that a list must not re-sort under somebody's hand between polls, and it is
 * the same rule here — a list that reorders while a receptionist is reaching
 * for it is how the wrong patient is handed the wrong screen.
 */
import {
  detailSentence,
  deviceLabelFor,
  stableByFirstSeen,
  stateWord,
  timeLabel,
} from '../frontdesk/FrontDeskView';
import { situationFor, visitChecklist } from '../frontdesk/visitChecklist';
import { arrivedAtLabel } from '../practitioner/waiting/WaitingView';
import { deskCounts, deskLines, type DeskLine, type DeskState } from './deskLines';
import { useDayReads } from './useDayReads';
import styles from './frontdesksmall.module.css';

/**
 * THE CHIPS, IN THE ORDER THEY ARE READ, AND THE COLOUR EACH ONE CARRIES.
 *
 * THE COLOURS ARE THE WIDE DESK'S, UNCHANGED — Carl set them there on 12
 * September so his eye would land on the right list, and a second page using
 * different ones would undo exactly that. Every value is an existing token
 * (`tokens.css`); nothing was invented.
 *
 *  - HERE NOW takes no colour, which is the STRONGEST treatment rather than
 *    the weakest: `--ink` is the darkest text this product has and this is
 *    the work.
 *  - ON A TABLET `--ok`, NEEDS A LOOK `--warn`, FINISHED `--info`, EXPECTED
 *    and NOT ARRIVED TODAY `--ink-muted`.
 *
 * COLOUR IS NEVER THE ONLY CARRIER (WCAG 2.2 AA, 1.4.1). Every chip says in
 * words what it is, every row repeats the state as a word beside the name, and
 * the pressed chip is marked with `aria-pressed` and an outline rather than
 * only a wash. There is no key anywhere that has to be learned.
 */
const CHIPS: readonly { readonly state: DeskState; readonly tone: string }[] = [
  { state: 'here', tone: styles.toneWork },
  { state: 'onTablet', tone: styles.toneOk },
  { state: 'needsALook', tone: styles.toneWarn },
  { state: 'finished', tone: styles.toneInfo },
  { state: 'expected', tone: styles.toneQuiet },
  /*
   * THE SIXTH IS DRAWN ONLY WHEN IT HAS SOMEBODY IN IT. It sits outside the
   * register's total on purpose (paperwork open with nobody recorded as
   * walking in for it today), so a permanent chip would put a count on the
   * strip that is not part of the sum the strip exists to prove — and on a
   * day that is behaving it would say nothing at all.
   */
  { state: 'notArrived', tone: styles.toneQuiet },
];

/** The state, in the words the wide desk already uses for the same group. */
const STATE_WORD: Record<DeskState, string> = {
  here: strings.frontdesk.rail.hereNow,
  onTablet: strings.frontdesk.rail.onATablet,
  needsALook: strings.frontdesk.rail.needsALook,
  finished: strings.frontdesk.rail.finished,
  expected: strings.frontdesk.rail.expected,
  notArrived: strings.frontdesk.rail.notArrived,
};

export function SmallDeskView({ practiceId }: { practiceId: string }) {
  /*
   * THE TABLET DESK'S HOOK, WHOLE. It owns the reads, the poll, the outcome of
   * the last press and every act reception can perform. This page is a
   * different ARRANGEMENT of the same work, never a second system.
   */
  const desk = usePushDesk(practiceId);
  const reads = useDayReads(practiceId);

  /** Which chip is pressed, or null for everybody. Pressing it again clears it. */
  const [filter, setFilter] = useState<DeskState | null>(null);
  /** Whose detail is open. One at a time — this is a small screen. */
  const [openFor, setOpenFor] = useState<string | null>(null);

  /*
   * THE TOP BAR'S REFRESH RE-READS EVERY HALF OF THE PAGE, and its identity
   * has to be STABLE or `useRefreshable` de-registers and re-registers it on
   * every render — three times a second once the poll is running.
   * `usePushDesk` returns a fresh object each render, so the two loaders are
   * reached through a ref rather than closed over.
   */
  const loaders = useRef({ desk: desk.load, reads: reads.load });
  loaders.current = { desk: desk.load, reads: reads.load };
  const reload = useMemo(
    () => async () => {
      await Promise.all([loaders.current.desk(), loaders.current.reads()]);
    },
    [],
  );
  useRefreshable(reload);

  /*
   * TWO MEMORIES, NOT ONE, and neither follows the page to another practice.
   * The queue and the register are pruned against their own contents, and a
   * single shared map would have each list deleting the other's places on
   * every poll — the exact re-sort they exist to prevent.
   */
  const queueOrder = useRef(new Map<string, number>());
  const dayOrder = useRef(new Map<string, number>());
  useEffect(() => {
    queueOrder.current = new Map();
    dayOrder.current = new Map();
    setFilter(null);
    setOpenFor(null);
  }, [practiceId]);

  /*
   * BOTH LISTS HELD IN THE ORDER SOMEBODY IS LOOKING AT. The queue and the
   * register each arrive in arrival order and neither is re-sorted here; the
   * memories only stop a poll shuffling rows under a hand.
   */
  const rows = desk.rows;
  const registerRows = reads.register?.rows ?? null;
  const queue = useMemo(
    () => stableByFirstSeen(rows ?? [], (row) => row.agreementId, queueOrder.current),
    [rows],
  );
  const day = useMemo(
    () => (registerRows ? stableByFirstSeen([...registerRows], (row) => row.arrivalId, dayOrder.current) : null),
    [registerRows],
  );

  /*
   * AND NOBODY IS IN TWO PLACES AT ONCE. A booking can carry a draft before
   * the patient walks in, so the same person could be named in the queue and
   * among the expected. The queue wins: it is the list with work on it, and a
   * name under "yet to arrive" while there is something to do for them would
   * be a screen arguing with itself.
   */
  const inQueue = new Set(queue.map((row) => row.patientId));
  const expected = reads.expected.filter((appointment) => !inQueue.has(appointment.patientId));

  const { lines, arrivedToday } = useMemo(
    () => deskLines({ queue, day, expected }),
    [queue, day, expected],
  );
  const counts = deskCounts(lines);
  const shown = filter ? lines.filter((line) => line.state === filter) : lines;

  /*
   * EXACTLY ONE ROW IS MARKED "DO THIS NEXT" — the first person still here,
   * which is whoever has waited longest, because the list is in arrival order
   * and nothing on this page re-sorts it. Not a priority scheme: the list said
   * out loud, so there is no decision to make on a first shift.
   */
  const nextKey = lines.find((line) => line.state === 'here')?.key ?? null;

  /** The queue row behind a line, where there is one. Found fresh every render,
   * so a party change that supersedes an agreement hands back the SUCCESSOR
   * without anybody having to find their place again. */
  const rowFor = (line: DeskLine): PushableRow | null =>
    line.patientId ? (queue.find((row) => row.patientId === line.patientId) ?? null) : null;

  if (desk.loadError && rows === null) {
    return (
      <Shell
        right={<SessionControl audience={strings.frontdeskSmall.audience} />}
        title={strings.frontdeskSmall.title}
        lead={strings.frontdeskSmall.lead}
      >
        <Notice tone="stop" title={strings.frontdesk.notLoaded}>
          {desk.loadError}
        </Notice>
        {/*
          HARD RULE 8, LOUD IN THE ONE MOMENT IT MATTERS. The promise is a
          quiet line on an ordinary morning; a page that cannot load is exactly
          where somebody decides a patient has to wait, so here it takes the
          room a notice takes.
        */}
        <Notice tone="ok" data-testid="frontdesksmall-see-them-anyway">
          {strings.frontdesk.seeThemAnyway}
        </Notice>
      </Shell>
    );
  }

  return (
    <Shell
      right={<SessionControl audience={strings.frontdeskSmall.audience} />}
      title={strings.frontdeskSmall.title}
      lead={strings.frontdeskSmall.lead}
    >
      {desk.loadError && (
        <>
          <Notice tone="warn" title={strings.frontdesk.notLoaded}>
            {desk.loadError}
          </Notice>
          <Notice tone="ok" data-testid="frontdesksmall-see-them-anyway">
            {strings.frontdesk.seeThemAnyway}
          </Notice>
        </>
      )}

      {/*
        LOOKING, NOT WORKING. The same statement the tablet desk makes for the
        same reason: an account without the practice's own claim sees the state
        and no controls, and every act behind them is `@PracticeScoped` on the
        server and would refuse it anyway.
      */}
      {!desk.canSend && (
        <Notice tone="warn" title={strings.viewOnly.title} data-testid="frontdesksmall-view-only">
          {strings.viewOnly.body}
        </Notice>
      )}

      {/*
        THE WHOLE RECONCILIATION ON ONE LINE. Five headings, five counts and
        five empty-state paragraphs, in the space one row of chips takes.
      */}
      <div
        className={styles.chips}
        role="group"
        aria-label={strings.frontdeskSmall.filtersLabel}
        data-testid="frontdesksmall-chips"
      >
        {CHIPS.map(({ state, tone }) =>
          state === 'notArrived' && counts.notArrived === 0 ? null : (
            <button
              key={state}
              type="button"
              className={`${styles.chip} ${tone}`}
              aria-pressed={filter === state}
              onClick={() => setFilter(filter === state ? null : state)}
              data-testid={`frontdesksmall-chip-${state}`}
            >
              <span className={styles.chipLabel}>{STATE_WORD[state]}</span>
              <span className={styles.chipCount} data-testid={`frontdesksmall-count-${state}`}>
                {counts[state]}
              </span>
              {/*
                THE COUNT AS A SENTENCE, for anybody who cannot see the strip.
                A bare digit announced on its own says nothing.
              */}
              <span className={styles.visuallyHidden}>
                {strings.frontdesk.rail.count(counts[state])}
              </span>
            </button>
          ),
        )}
      </div>

      {/*
        ONE QUIET LINE CARRYING THREE FACTS: the number the chips add up to, why
        they add up to it, and hard rule 8. Carl's note on the wide desk was
        that three stacked notices push the work a third of the way down the
        screen; on a small screen that is the whole screen, so the promise is
        kept in a sentence rather than in a banner — and it becomes a banner
        the moment there is an outage, above.
      */}
      <p className={styles.strapline}>
        {arrivedToday !== null && (
          <span data-testid="frontdesksmall-day-total">
            <span className={styles.totalNumber} data-testid="frontdesksmall-day-total-number">
              {arrivedToday}
            </span>{' '}
            {strings.frontdesk.rail.dayTotalUnit(arrivedToday)}
          </span>
        )}
        {arrivedToday !== null && <span>{strings.frontdesk.rail.dayTotalWhy}</span>}
        <span data-testid="frontdesksmall-never-blocks">{strings.frontdeskSmall.neverBlocks}</span>
      </p>

      {filter && (
        <p className={styles.filtered} data-testid="frontdesksmall-filtered">
          {strings.frontdeskSmall.showingOnly(STATE_WORD[filter])}{' '}
          <Button variant="subtle" onClick={() => setFilter(null)} data-testid="frontdesksmall-show-all">
            {strings.frontdeskSmall.showAll}
          </Button>
        </p>
      )}

      {shown.length === 0 ? (
        <p className={styles.empty} data-testid="frontdesksmall-empty">
          {filter ? strings.frontdeskSmall.noneOfThose(STATE_WORD[filter]) : strings.frontdeskSmall.nobodyYet}
        </p>
      ) : (
        <ol className={styles.list} aria-label={strings.frontdeskSmall.listLabel} data-testid="frontdesksmall-list">
          {shown.map((line) => (
            <DeskRow
              key={line.key}
              line={line}
              row={rowFor(line)}
              desk={desk}
              isNext={line.key === nextKey}
              open={openFor === line.key}
              onOpen={(next) => setOpenFor(next ? line.key : null)}
            />
          ))}
        </ol>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// One line of the list, and the whole of that person's work under it
// ---------------------------------------------------------------------------

/**
 * ONE PERSON'S ROW: the state, the name, the practice's own number, the time —
 * and, when it is opened, everything about them, directly underneath.
 *
 * A ROW WITH NOTHING BEHIND IT IS NOT A CONTROL. A finished visit and an
 * arrival with nothing open have no queue row, so there is nothing for a
 * detail to be about; they are drawn as text, with no focus stop that leads
 * somewhere empty. That is the same decision `/practice/frontdesk` makes for
 * the same reason, and it is why "needs a look" says what it means on the row
 * rather than offering a button that does nothing.
 *
 * THE NAME IS THE CONTROL AND THE STATE IS BESIDE IT, never only a colour
 * (1.4.1). The disclosure triangle is decoration; `aria-expanded` on the
 * button is the fact.
 */
function DeskRow({
  line,
  row,
  desk,
  isNext,
  open,
  onOpen,
}: {
  line: DeskLine;
  row: PushableRow | null;
  desk: PushDesk;
  isNext: boolean;
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  /*
   * WHAT OPENING IT WOULD SHOW. A queue row means their work; an expected
   * booking means the one sentence there is to say about somebody who has not
   * walked in. Anything else opens nothing, so it is not offered.
   */
  const canOpen = row !== null || line.state === 'expected';

  const body = (
    <>
      <span className={styles.state} data-testid={`frontdesksmall-state-${line.key}`}>
        {STATE_WORD[line.state]}
      </span>
      <span className={styles.name}>{line.name}</span>
      {/*
        THE PRACTICE'S OWN NUMBER, ON THE ROW (Carl, 12 September 2026, on the
        wide desk: "patientid missing under patient name"). It is the handle
        reception reads out and types into the practice's own software, and it
        is labelled — a bare run of digits beside a name could be read as
        anything, and what it must never be read as is a Medicare card number,
        which is not an identifier in this regime and is not on this row
        (hard rule 1, REQ-VER-02).
      */}
      <span className={styles.record} data-testid={`frontdesksmall-practice-number-${line.key}`}>
        {line.recordNumber
          ? strings.recordId.practiceNumber(line.recordNumber)
          : strings.recordId.practiceNumberUnknown}
      </span>
      <span className={styles.time}>
        {timeLabel(line.time && line.timeIsArrival ? arrivedAtLabel(line.time) : line.time)}
      </span>
      {isNext && (
        <span className={styles.next} data-testid={`frontdesksmall-next-${line.key}`}>
          {strings.frontdesk.rail.next}
        </span>
      )}
    </>
  );

  return (
    <li className={styles.line} data-state={line.state}>
      {canOpen ? (
        <button
          type="button"
          className={styles.open}
          aria-expanded={open}
          onClick={() => onOpen(!open)}
          data-state={line.state}
          data-testid={`frontdesksmall-row-${line.key}`}
        >
          {open ? (
            <ChevronDown size={14} aria-hidden="true" className={styles.caret} />
          ) : (
            <ChevronRight size={14} aria-hidden="true" className={styles.caret} />
          )}
          {body}
        </button>
      ) : (
        <span className={styles.read} data-state={line.state} data-testid={`frontdesksmall-row-${line.key}`}>
          <span className={styles.caret} aria-hidden="true" />
          {body}
        </span>
      )}

      {/*
        WHAT "NEEDS A LOOK" MEANS, ON THE ROW THAT SAYS IT. There is nothing to
        press, so the sentence has to do the work: nobody was held up — they
        were seen as usual — and it is the PAPERWORK that has to be caught up
        (hard rule 8).
      */}
      {line.state === 'needsALook' && (
        <p className={styles.why} data-testid={`frontdesksmall-why-${line.key}`}>
          {strings.frontdesk.rail.needsALookWhy}
        </p>
      )}

      {open && (
        <div className={styles.detail} data-testid={`frontdesksmall-detail-${line.key}`}>
          {row ? (
            /*
             * KEYED ON THE PERSON. Without a key React reuses one instance
             * across a change of row, and any state inside it — a half-opened
             * panel, a confirmation waiting for an answer — would arrive
             * already open on the next patient.
             */
            <PatientWork key={row.patientId} desk={desk} row={row} />
          ) : (
            <>
              <p className={ui.hint} data-testid={`frontdesksmall-expected-${line.key}`}>
                {strings.frontdesk.panel.expectedNext}
              </p>
              {line.patientId && (
                <PatientIdentity
                  practiceNumber={line.recordNumber}
                  recordId={line.patientId}
                  testId={`frontdesksmall-who-${line.key}`}
                />
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * EVERYTHING ABOUT ONE PATIENT, UNDER THEIR OWN ROW (§13, Carl 12 Sep 2026:
 * *"Everything to do with the patient must be on this page — no going to
 * another page."*).
 *
 * IT RENDERS NO LINK. The one refusal whose shortcut is a per-patient screen
 * has that destination withheld (`offerPatientPage={false}`) — the sentence
 * still says what is in the way, and the fix is in the band.
 *
 * EVERY CONTROL IS THE TABLET DESK'S OWN, IMPORTED. `SendSteps`,
 * `SessionActions`, `AgreementBands`, `CorrectionPanel` and the dispute
 * notices are the same components `/practice/tablet`, `/practice/patients` and
 * `/practice/frontdesk` render, so four surfaces cannot come to offer
 * different answers to the same session. This component is the ARRANGEMENT —
 * compact, in place, no heading of its own because the row above already names
 * the person.
 */
function PatientWork({ desk, row }: { desk: PushDesk; row: PushableRow }) {
  const session = row.activeSession ? desk.sessions.find((s) => s.id === row.activeSession!.id) : undefined;
  const live = session && session.endedAt === null ? session : undefined;
  const situation = situationFor(row, live ?? null);

  /*
   * THE CHECKLIST IS ABOUT THE PERSON, NOT ABOUT ONE AGREEMENT. A patient can
   * have one for today's visit AND one raised after a service was billed, and
   * reading only this row would hide half of their morning.
   */
  const mine = (desk.rows ?? []).filter((r) => r.patientId === row.patientId);
  const covered = (desk.covered ?? []).filter((c) => c.patientId === row.patientId);
  const checklist = visitChecklist(mine, covered, (id) => deviceLabelFor(id, desk.devices ?? []));

  const subject = live ? subjectForSession(live) : subjectForPatient(row.patientId);
  const deviceName = deviceLabelFor(row.activeSession?.deviceId ?? live?.deviceId, desk.devices ?? []);

  const sentence =
    situation === 'on_a_tablet'
      ? deviceName
        ? strings.frontdesk.panel.onATablet(row.patientName, deviceName)
        : strings.frontdesk.panel.onATabletUnnamed(row.patientName)
      : situation === 'detail_wrong'
        ? strings.frontdesk.panel.detailWrong(row.patientName, disputedLabels(live?.disputedDetails ?? []))
        : situation === 'waiting'
          ? strings.frontdesk.panel.waiting(row.patientName)
          : situation === 'who_is_signing'
            ? strings.frontdesk.panel.whoIsSigning(row.patientName)
            : strings.frontdesk.panel.readyToSend(row.patientName, row.providerName);

  return (
    <>
      <p className={styles.sentence} data-testid={`frontdesksmall-what-${row.patientId}`}>
        {sentence}
      </p>

      {row.activeSession && (
        <p className={styles.liveLine}>
          <Chip tone={STATE_TONE[row.activeSession.state] ?? 'neutral'}>
            {strings.tablet.onTabletNow(deviceName ?? strings.frontdesk.panel.someTablet)} ·{' '}
            <SessionTag id={row.activeSession.id} testId={`frontdesksmall-session-${row.patientId}`} />
          </Chip>
        </p>
      )}

      {/* What the patient said is wrong — types in our words, never values (hard rule 9). */}
      {live && <SessionDisputeNotices session={live} />}

      {/*
        TODAY'S PAPERWORK, AS ONE LINE PER ROW RATHER THAN AS CARDS. The wide
        desk has room to give each of the four its own block; here the answer
        has to fit under a row, so the state and the sentence sit on one line
        and the state is still a WORD as well as a colour.
      */}
      <ul className={styles.checklist} data-testid={`frontdesksmall-checklist-${row.patientId}`}>
        {checklist.map((item) => (
          <li key={item.key} className={styles.checkRow} data-testid={`frontdesksmall-check-${item.key}`}>
            <Chip tone={item.state === 'done' ? 'ok' : item.state === 'outstanding' ? 'warn' : 'neutral'}>
              {stateWord(item.state)}
            </Chip>
            <span className={styles.checkLabel}>{strings.frontdesk.checklist.rows[item.key]}</span>
            <span className={ui.hint}>{detailSentence(item)}</span>
          </li>
        ))}
      </ul>

      {/*
        THE NUMBERED CARD, drawn only where it could actually be used: a strip
        of three steps over an agreement that can never go would teach a
        beginner the page is broken, so the situations that need something else
        say so and the band below carries the fix.
      */}
      {(situation === 'who_is_signing' || situation === 'ready_to_send') && (
        <div className={styles.action} data-testid={`frontdesksmall-send-${row.patientId}`}>
          <SendSteps desk={desk} row={row} />
        </div>
      )}

      {/*
        A LIVE TABLET IS ANSWERED BY THE TABLET DESK'S OWN CONTROLS, VERBATIM —
        Recall, Correct, "No change needed" and Re-send, in that order. Still
        one enabled primary at a time: `SessionActions` lights Re-send only
        once a detail has been disputed.
      */}
      {live && (
        <div className={styles.action} data-testid={`frontdesksmall-session-actions-${row.patientId}`}>
          <SessionActions desk={desk} session={live} />
        </div>
      )}

      {/* The reason it cannot go, with its own fix in it, and the who-is-signing form. */}
      <AgreementBands desk={desk} row={row} offerPatientPage={false} />

      <CorrectionPanel desk={desk} subject={subject} />
      <CorrectOutcomeNotice desk={desk} subjectKey={subject.key} testId={`frontdesksmall-correct-${row.patientId}`} />

      {/*
        BOTH IDS, AND THIS IS THE QUIET ONE (Carl, 12 September 2026, with
        `/practice/tablet` and `/practice/frontdesk` side by side: *"Patient ID
        is on frontdesk it is diff - see both images"* → *"ok. In that case
        show both ids."*).

        TWO DIFFERENT THINGS WORE ONE LABEL. The PRACTICE'S own number is on
        the row above, prominent, because it is the handle reception reads out
        and types into their own software; this is the id THIS platform minted,
        and it is what goes on a support ticket — a practice's own number is
        not unique across practices, so ours has to stay. On a small screen the
        support-ticket id belongs in the opened detail rather than in the row:
        nobody raises a ticket while scanning the room.

        ONE COMPONENT SO THE ORDER CANNOT DRIFT. `PatientIdentity` is the
        shared pair — the practice's number, then ours with its Copy control —
        and every front-desk surface renders it, so three screens cannot come
        to name one person three ways again.

        NEITHER IS A MEDICARE NUMBER and there is no column for one anywhere
        (hard rule 1, REQ-VER-02).
      */}
      <PatientIdentity
        practiceNumber={row.patientRecordNumber}
        recordId={row.patientId}
        testId={`frontdesksmall-who-${row.patientId}`}
      />
    </>
  );
}

/*
 * `stateWord` AND `detailSentence` ARE THE WIDE DESK'S, IMPORTED (wow.md §10
 * rule 3). This file carried identical copies, so every new checklist state
 * and every new detail key had to be learned twice — and `visitState` was
 * added to the shared computation and missed here within the hour. One
 * renderer, two screens; the two desks cannot describe one row differently.
 */
