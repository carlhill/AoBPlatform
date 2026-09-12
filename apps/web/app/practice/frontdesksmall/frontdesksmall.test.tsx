/**
 * THE FRONT DESK ON A SMALL SCREEN — one list, one strip of chips, and the
 * detail opening in place (SESSION-HANDOVER.md, "A proposal for the
 * small-screen version").
 *
 * THE TEST THAT MATTERS MOST IS THE FIRST ONE.
 * `frontdesk_small_chips_add_up_to_the_day_register` is the deliverable; the
 * layout is how it is satisfied. The wide desk proves its five rails partition
 * the register, and this proves the five chips do — so two views of one
 * morning cannot drift apart, which is precisely what happened on 12 September
 * when the waiting page said fifteen, the desk said three and twelve people
 * were on no screen at all.
 *
 * IT EXISTS AT ALL BECAUSE THIS PAGE CANNOT BE SEEN WITHOUT A PASSKEY. The
 * console signs in through Keycloak with WebAuthn (hard rule 15 — there is no
 * password path and never will be), so nobody can open a practice screen in a
 * headless check. Without this, the page's first render would happen in front
 * of a practice, with a patient at the desk.
 *
 * WHAT ELSE IT PINS, each a rule rather than a preference:
 *
 *  - ARRIVAL ORDER IS THE ONE ORDERING RULE, and the states interleave inside
 *    it. A receptionist thinks about who is next, not about which box somebody
 *    is in.
 *  - A CHIP FILTERS AND FILTERS BACK. Pressing it again clears it; there is no
 *    state somebody can get stuck in.
 *  - THE DETAIL OPENS IN PLACE and the list is still on screen (§13, Carl:
 *    *"everything to do with the patient must be on this page"*).
 *  - NO MEDICARE-SHAPED NUMBER, no date of birth, no reason code, no amount
 *    (hard rules 1, 4 and 9). The practice's own patient number IS on the row,
 *    because it is approved and it is what reception reads out.
 *  - LOOKING NEVER ACTS. Nothing but the GETs the page reads with leaves it,
 *    whatever is pressed in the list.
 *  - NOTHING BLOCKS CARE, and the page says so — in one line on an ordinary
 *    morning and in a notice when the platform itself cannot be reached.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DayRegister, DayRegisterRow, ExpectedAppointment } from '@aobplatform/contracts';
import type { DeviceRow, TabletSessionRow } from '@aobplatform/domain';
import { SmallDeskView } from './SmallDeskView';
import { ARRIVED_STATES, deskCounts, deskLines } from './deskLines';
import type { PushableRow } from '../tablet/pushDesk';
import { strings } from '../../strings';

const PRACTICE = 'practice-1';

const TABLET: DeviceRow = {
  id: 'device-1',
  label: 'Blue tablet',
  state: 'paired',
  createdBy: 'Robin Admin',
  createdAt: '2026-09-01T00:00:00.000Z',
  pairedAt: '2026-09-01T01:00:00.000Z',
  lastSeenAt: '2026-09-12T08:00:00.000Z',
  lastKioskBuild: '2026.09.12-1',
  revokedAt: null,
  revokedBy: null,
  pairingExpiresAt: null,
  showsWaitingList: false,
};

/**
 * A QUEUE ROW AS THE SERVER HANDS IT BACK — obviously fake identities, and no
 * Medicare-format number anywhere (there is no column for one; hard rule 1).
 *
 * The row carries far MORE than the list shows, deliberately: it is the same
 * `pushable` payload the tablet desk reads, and the no-clinical-detail test is
 * only worth anything because the fields it must not render are present.
 */
const row = (over: Partial<PushableRow> = {}): PushableRow => ({
  agreementId: 'agreement-here',
  agreementType: 'episodic_pre',
  status: 'draft',
  patientName: 'Jamie Sampleton',
  patientId: '11111111-1111-4000-8000-000000000001',
  patientRecordNumber: 'DEV-JAMIE-SAMPLETON',
  providerName: 'Dr Example Provider',
  providerType: 'general_practitioner',
  appointmentDate: '2026-09-12',
  appointmentTime: '09:00',
  serviceDescription: 'General practitioner attendance',
  serviceDescriptionValid: true,
  serviceDate: null,
  mbsItemNumbers: [],
  assignorIsPatient: true,
  assignorName: null,
  assignorRelationship: null,
  assignorMobile: null,
  assignorEmail: null,
  particularsLocked: true,
  assignorConfirmedAt: '2026-09-12T08:00:00.000Z',
  pushable: true,
  blockedReason: null,
  activeSession: null,
  queueTicket: null,
  ...over,
});

const HERE = row();
const ON_TABLET = row({
  agreementId: 'agreement-tablet',
  patientName: 'Robin Reader',
  patientId: '33333333-3333-4000-8000-000000000003',
  patientRecordNumber: 'DEV-ROBIN-READER',
  appointmentTime: '09:10',
  activeSession: { id: 'session-1', deviceId: TABLET.id, state: 'reading' },
});
const CORRECTED_ROW = row({
  agreementId: 'agreement-successor',
  patientName: 'Kit Corrected',
  patientId: '88888888-8888-4000-8000-000000000008',
  patientRecordNumber: 'DEV-KIT-CORRECTED',
  appointmentTime: '09:30',
});

const session = (over: Partial<TabletSessionRow> = {}): TabletSessionRow =>
  ({
    id: 'session-1',
    agreementId: ON_TABLET.agreementId,
    deviceId: TABLET.id,
    deviceLabel: TABLET.label,
    patientId: ON_TABLET.patientId,
    patientName: ON_TABLET.patientName,
    state: 'reading',
    pushedBy: 'Robin Admin',
    pushedAt: '2026-09-12T08:05:00.000Z',
    endedAt: null,
    disputedDetails: [],
    disputeResolution: null,
    disputeResolvedAt: null,
    signatureFailureReason: null,
    ...over,
  }) as unknown as TabletSessionRow;

const BOOKED: ExpectedAppointment = {
  appointmentId: 'appointment-1',
  patientId: '44444444-4444-4000-8000-000000000004',
  patientName: 'Alex Booked',
  time: '10:30',
};

/**
 * A ROW OF THE DAY REGISTER, as `GET /arrivals/day` hands it back. Obviously
 * fake identities, an approved identifier only (the practice's own number —
 * hard rule 1, REQ-VER-02), and no Medicare-format number anywhere, because
 * there is no field for one.
 */
const arrival = (over: Partial<DayRegisterRow> = {}): DayRegisterRow => ({
  arrivalId: 'arrival-1',
  patientId: HERE.patientId,
  patientName: HERE.patientName,
  patientRecordNumber: 'DEV-JAMIE-SAMPLETON',
  arrivedAt: '2026-09-12T09:00:00.000Z',
  seenByName: 'Dr Example Provider',
  agreementProviderName: null,
  agreementId: HERE.agreementId,
  agreementStatus: 'draft',
  agreementSigned: false,
  visitState: null,
  ...over,
});

const register = (rows: readonly DayRegisterRow[]): DayRegister => ({
  date: '2026-09-12',
  timezone: 'Australia/Sydney',
  rows,
});

/**
 * THE SAME MORNING THE WIDE DESK IS TESTED ON, so the two pages are proved
 * against one fixture and a divergence has somewhere to show up. Six arrivals
 * and every shape that went missing on 12 September:
 *
 *  - Morgan, unsigned with nothing open for them          → NEEDS A LOOK
 *  - Dana, signed and gone from the queue                 → Finished
 *  - Frankie, in for a blood test and signs nothing       → Finished
 *  - Kit, corrected — the register already walked forward → Here now
 *  - Jamie, on the queue with nothing on a tablet         → Here now
 *  - Robin, reading on a tablet                           → On a tablet
 */
const UNACCOUNTED = arrival({
  arrivalId: 'arrival-unaccounted',
  patientId: '99999999-9999-4000-8000-000000000009',
  patientName: 'Morgan Overlooked',
  patientRecordNumber: 'DEV-MORGAN-OVERLOOKED',
  agreementId: 'agreement-abandoned',
  agreementStatus: 'awaiting_signature',
  agreementSigned: false,
  arrivedAt: '2026-09-12T08:20:00.000Z',
});
const SIGNED = arrival({
  arrivalId: 'arrival-signed',
  patientId: '66666666-6666-4000-8000-000000000006',
  patientName: 'Dana Signed',
  patientRecordNumber: 'DEV-DANA-SIGNED',
  agreementId: 'agreement-signed',
  agreementStatus: 'stored',
  agreementSigned: true,
  arrivedAt: '2026-09-12T08:30:00.000Z',
});
const NOTHING_TO_SIGN = arrival({
  arrivalId: 'arrival-bloods',
  patientId: '77777777-7777-4000-8000-000000000007',
  patientName: 'Frankie Bloods',
  patientRecordNumber: 'DEV-FRANKIE-BLOODS',
  agreementId: null,
  agreementStatus: null,
  agreementSigned: false,
  arrivedAt: '2026-09-12T08:40:00.000Z',
});
const CORRECTED = arrival({
  arrivalId: 'arrival-corrected',
  patientId: CORRECTED_ROW.patientId,
  patientName: CORRECTED_ROW.patientName,
  patientRecordNumber: CORRECTED_ROW.patientRecordNumber,
  agreementId: CORRECTED_ROW.agreementId,
  arrivedAt: '2026-09-12T08:50:00.000Z',
});
const HERE_ARRIVAL = arrival({ arrivalId: 'arrival-here' });
const TABLET_ARRIVAL = arrival({
  arrivalId: 'arrival-tablet',
  patientId: ON_TABLET.patientId,
  patientName: ON_TABLET.patientName,
  patientRecordNumber: ON_TABLET.patientRecordNumber,
  agreementId: ON_TABLET.agreementId,
  arrivedAt: '2026-09-12T09:10:00.000Z',
});

/** In the order people walked in, which is the register's own order. */
const MORNING = [UNACCOUNTED, SIGNED, NOTHING_TO_SIGN, CORRECTED, HERE_ARRIVAL, TABLET_ARRIVAL];
const MORNING_QUEUE = [HERE, ON_TABLET, CORRECTED_ROW];

const calls: Array<{ url: string; method: string }> = [];

function stubFetch(
  opts: {
    rows?: unknown[];
    expected?: unknown[];
    devices?: DeviceRow[];
    sessions?: TabletSessionRow[];
    covered?: unknown[];
    /** Left undefined, `/arrivals/day` answers with something that is not a
     *  register — which is the "it never landed" case. */
    day?: DayRegister;
    status?: number;
  } = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (opts.status && opts.status !== 200) {
        return { ok: false, status: opts.status, json: async () => ({}) } as unknown as Response;
      }
      /*
       * THE ORDER OF THESE BRANCHES IS LOAD-BEARING. `/tablet-sessions/covered`
       * contains `/tablet-sessions`, so the specific paths are matched before
       * the general one.
       */
      const payload = url.includes('/arrivals/day')
        ? (opts.day ?? { notARegister: true })
        : url.includes('/arrivals/expected')
          ? (opts.expected ?? [])
          : url.includes('/tablet-sessions/pushable')
            ? (opts.rows ?? MORNING_QUEUE)
            : url.includes('/tablet-sessions/covered')
              ? (opts.covered ?? [])
              : url.includes('/tablet-sessions')
                ? (opts.sessions ?? [])
                : url.includes('/practice-users')
                  ? { users: [] }
                  : url.includes('/service-descriptions')
                    ? { version: 'bsd-2026-09-1', descriptions: ['General practitioner attendance'] }
                    : { devices: opts.devices ?? [TABLET] };
      return { ok: true, status: 200, json: async () => payload } as unknown as Response;
    }),
  );
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/practice/frontdesksmall',
}));

vi.mock('../../auth', () => ({
  currentSession: () => ({ roles: ['practice_user'], practiceId: PRACTICE }),
  apiHeaders: () => ({ 'x-practice-id': PRACTICE, 'Content-Type': 'application/json' }),
  silentRestoreInFlight: () => false,
  restoreRefusalReason: () => null,
}));

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

/** How many rows on screen are in one state. */
function rowsIn(state: string): number {
  return document.querySelectorAll(`[data-testid^="frontdesksmall-row-"][data-state="${state}"]`).length;
}

/** The number a chip is showing. */
function chip(state: string): number {
  return Number(screen.getByTestId(`frontdesksmall-count-${state}`).textContent);
}

/** The morning, rendered and settled. */
async function openTheDesk() {
  stubFetch({ rows: MORNING_QUEUE, day: register(MORNING), sessions: [session()], expected: [BOOKED] });
  render(<SmallDeskView practiceId={PRACTICE} />);
  /*
   * WAIT FOR THE DATA, NOT THE ELEMENT (wow.md §2 item 6). The list renders as
   * soon as the queue read lands; the finished rows need the register, which
   * is a second, independently-resolving fetch. Waiting for the list alone
   * catches the page mid-way on a slower runner.
   */
  await waitFor(() => expect(rowsIn('finished')).toBe(2));
}

describe('/practice/frontdesksmall — the chips add up to the day', () => {
  it('frontdesk_small_chips_add_up_to_the_day_register', async () => {
    /*
     * THE ONE THAT MATTERS, and it is the same claim the wide desk's five
     * rails make: `Here now + On a tablet + Needs a look + Finished` IS the
     * number `/practice/day` prints for the same day. Expected sits outside
     * it, because somebody who has not come in is not part of the day the
     * register is counting.
     *
     * ASSERTED ON THE RENDERED PAGE, and against the ROWS as well as the
     * chips, because the drift this guards against is a SCREEN quietly showing
     * fewer people than the day holds — which a component can do all by itself
     * with a filter no helper ever sees.
     */
    await openTheDesk();

    const total = screen.getByTestId('frontdesksmall-day-total-number');
    expect(total.textContent).toBe(String(MORNING.length));

    const chipSum = ARRIVED_STATES.reduce((sum, state) => sum + chip(state), 0);
    expect(chipSum).toBe(MORNING.length);
    expect(String(chipSum)).toBe(total.textContent);

    // And the chips are not merely arithmetic: the list under them holds the
    // same people, in the same states.
    const rowSum = ARRIVED_STATES.reduce((sum, state) => sum + rowsIn(state), 0);
    expect(rowSum).toBe(MORNING.length);
    for (const state of ARRIVED_STATES) expect(rowsIn(state)).toBe(chip(state));

    // The booking that has not walked in is counted, shown, and OUTSIDE the sum.
    expect(chip('expected')).toBe(1);
    expect(rowsIn('expected')).toBe(1);
  });

  it('frontdesk_small_every_arrival_is_on_exactly_one_line', () => {
    /*
     * THE SAME CLAIM, MADE STRUCTURALLY. The rendered test proves the numbers
     * agree on one morning; this proves the mechanism cannot do anything else.
     * Every arrival appears once across the four arrived states, and no line
     * appears twice.
     */
    const { lines, arrivedToday } = deskLines({
      queue: MORNING_QUEUE,
      day: MORNING,
      expected: [BOOKED],
    });
    const counts = deskCounts(lines);
    const arrived = lines.filter((line) => (ARRIVED_STATES as readonly string[]).includes(line.state));

    expect(arrivedToday).toBe(MORNING.length);
    expect(arrived).toHaveLength(MORNING.length);
    expect(new Set(arrived.map((line) => line.key)).size).toBe(MORNING.length);
    expect(ARRIVED_STATES.reduce((sum, state) => sum + counts[state], 0)).toBe(MORNING.length);
    // Nobody on the queue is left over on a morning where everybody came in.
    expect(counts.notArrived).toBe(0);
  });

  it('frontdesk_small_lists_everybody_in_arrival_order_whatever_state_they_are_in', async () => {
    /*
     * ARRIVAL ORDER IS THE ONE ORDERING RULE ON THIS PAGE, and it is the whole
     * argument for one list: a receptionist thinks about who is next, not
     * about which of five boxes somebody is in — so the states INTERLEAVE
     * rather than clumping. Morgan (needs a look) is first because they walked
     * in first, and Robin (on a tablet) is last for the same reason.
     */
    await openTheDesk();

    const names = [...document.querySelectorAll('[data-testid^="frontdesksmall-row-"]')].map((node) =>
      (node.textContent ?? '').trim(),
    );
    const order = names.map((text) => text.replace(/\s+/g, ' '));

    const at = (name: string) => order.findIndex((text) => text.includes(name));
    expect(at('Morgan Overlooked')).toBe(0);
    expect(at('Dana Signed')).toBe(1);
    expect(at('Frankie Bloods')).toBe(2);
    expect(at('Kit Corrected')).toBe(3);
    expect(at('Jamie Sampleton')).toBe(4);
    expect(at('Robin Reader')).toBe(5);
    // The booking that has not arrived is last: they are not part of the day yet.
    expect(at('Alex Booked')).toBe(6);
  });

  it('frontdesk_small_marks_exactly_one_row_do_this_next', async () => {
    /*
     * EXACTLY ONE, AND IT IS THE FIRST PERSON STILL HERE — whoever has waited
     * longest, because the list is in arrival order and nothing on this page
     * re-sorts it. Not a priority scheme: the list said out loud, so there is
     * no decision to make on a first shift.
     *
     * THE FIXTURE MAKES IT FALSIFIABLE. Two people are in "Here now" — Kit
     * (arrived 08:50) and Jamie (09:00) — and three earlier arrivals sit above
     * both of them in other states. A mark that landed on the top of the LIST
     * rather than on the first person still HERE would go to Morgan, and a
     * mark that ignored arrival order would go to Jamie.
     */
    await openTheDesk();

    expect(screen.getByTestId(`frontdesksmall-next-${CORRECTED_ROW.agreementId}`)).toBeTruthy();
    expect(document.querySelectorAll('[data-testid^="frontdesksmall-next-"]')).toHaveLength(1);
    // Not on the person who arrived after them, and not on the row above them.
    expect(screen.queryByTestId(`frontdesksmall-next-${HERE.agreementId}`)).toBeNull();
    expect(screen.queryByTestId(`frontdesksmall-next-${UNACCOUNTED.arrivalId}`)).toBeNull();
  });

  it('frontdesk_small_puts_a_replacement_agreement_beside_the_arrival_it_belongs_to', async () => {
    /*
     * THE ORDERING FALLBACK THAT HAS NOTHING TO MATCH ON.
     * `offerEpisodicInstead` creates an agreement that does NOT supersede the
     * one it replaces — they are different instruments with different evidence
     * — so that person's register row and their queue row share no agreement
     * id at all. `dayRails` reunites them by patient; `positions()` has to do
     * the same or the line would fall to the bottom of the list, out of
     * arrival order, which is the one ordering rule this page has.
     *
     * WITHOUT THE PATIENT TIER this returns Sam last instead of first, so the
     * assertion fails rather than the fallback rotting unnoticed.
     */
    const EARLY = arrival({
      arrivalId: 'arrival-swapped',
      patientId: '12121212-1212-4000-8000-000000000012',
      patientName: 'Sam Swapped',
      patientRecordNumber: 'DEV-SAM-SWAPPED',
      // The draft they walked in with. The queue row below is its replacement,
      // and it is a DIFFERENT agreement, not a successor.
      agreementId: 'agreement-declined-ongoing',
      agreementSigned: false,
      arrivedAt: '2026-09-12T07:50:00.000Z',
    });
    const REPLACEMENT = row({
      agreementId: 'agreement-for-todays-visit',
      patientId: EARLY.patientId as string,
      patientName: EARLY.patientName as string,
      patientRecordNumber: EARLY.patientRecordNumber as string,
      appointmentTime: '07:50',
    });

    const { lines } = deskLines({
      queue: [HERE, REPLACEMENT],
      day: [EARLY, HERE_ARRIVAL],
      expected: [],
    });
    expect(lines.map((line) => line.name)).toEqual(['Sam Swapped', HERE.patientName]);
    expect(lines[0].state).toBe('here');
    // And they are counted once, under their own arrival, not as an anomaly.
    expect(deskCounts(lines).needsALook).toBe(0);
    expect(deskCounts(lines).notArrived).toBe(0);
  });

  it('frontdesk_small_a_chip_filters_the_list_and_pressing_it_again_clears_it', async () => {
    await openTheDesk();

    fireEvent.click(screen.getByTestId('frontdesksmall-chip-finished'));
    await waitFor(() => expect(rowsIn('here')).toBe(0));
    expect(rowsIn('finished')).toBe(2);
    // The chip still says two: filtering the LIST never changes the counts, or
    // the reconciliation would disappear the moment somebody used it.
    expect(chip('finished')).toBe(2);
    expect(chip('here')).toBe(2);
    expect(screen.getByTestId('frontdesksmall-chip-finished').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('frontdesksmall-chip-finished'));
    await waitFor(() => expect(rowsIn('here')).toBe(2));
    expect(screen.getByTestId('frontdesksmall-chip-finished').getAttribute('aria-pressed')).toBe('false');
  });

  it('frontdesk_small_a_filter_with_nobody_in_it_says_so_and_offers_the_way_back', async () => {
    /*
     * NO DEAD END. An empty filter is the one place somebody on a first shift
     * can conclude the page has broken, so it names what is empty and carries
     * the control that undoes it — never a blank list.
     */
    stubFetch({ rows: [HERE], day: register([HERE_ARRIVAL]) });
    render(<SmallDeskView practiceId={PRACTICE} />);
    await waitFor(() => expect(rowsIn('here')).toBe(1));

    fireEvent.click(screen.getByTestId('frontdesksmall-chip-onTablet'));
    await waitFor(() => expect(screen.getByTestId('frontdesksmall-empty')).toBeTruthy());
    expect(screen.getByTestId('frontdesksmall-empty').textContent).toBe(
      strings.frontdeskSmall.noneOfThose(strings.frontdesk.rail.onATablet),
    );

    fireEvent.click(screen.getByTestId('frontdesksmall-show-all'));
    await waitFor(() => expect(rowsIn('here')).toBe(1));
  });
});

describe('/practice/frontdesksmall — the detail opens in place', () => {
  it('frontdesk_small_opens_the_patient_under_their_own_row_and_never_leaves_the_list', async () => {
    /*
     * CARL, §13: *"Everything to do with the patient must be on this page — no
     * going to another page."* On a small screen the strongest form of that is
     * that there is nowhere to be sent: the work opens UNDER the name, the
     * list is still on screen around it, and nothing in the detail is a link.
     */
    await openTheDesk();

    fireEvent.click(screen.getByTestId(`frontdesksmall-row-${HERE.agreementId}`));
    const detail = await screen.findByTestId(`frontdesksmall-detail-${HERE.agreementId}`);

    // The whole list is still there, with the opened row inside it.
    expect(rowsIn('here')).toBe(2);
    expect(rowsIn('finished')).toBe(2);
    expect(screen.getByTestId('frontdesksmall-list').contains(detail)).toBe(true);

    // Their work, and the sentence that says what is true for them right now.
    expect(screen.getByTestId(`frontdesksmall-what-${HERE.patientId}`).textContent).toContain(
      HERE.patientName,
    );
    expect(screen.getByTestId(`frontdesksmall-checklist-${HERE.patientId}`)).toBeTruthy();

    // NOTHING IN THE DETAIL NAVIGATES.
    expect(detail.querySelector('a')).toBeNull();

    /*
     * BOTH IDS, AND EACH WHERE IT BELONGS (Carl, 12 September 2026: *"ok. In
     * that case show both ids."*). The PRACTICE'S number is on the collapsed
     * row, prominent, because it is what reception reads out; the platform's
     * own record id is in the opened detail with its Copy control, because it
     * is for a support ticket and nobody raises one while scanning the room.
     * Neither is a Medicare number and there is no column for one anywhere
     * (hard rule 1).
     */
    expect(screen.getByTestId(`frontdesksmall-row-${HERE.agreementId}`).textContent).toContain(
      strings.recordId.practiceNumber(HERE.patientRecordNumber as string),
    );
    /*
     * AND IT IS THE SHARED COMPONENT, NOT A THIRD SET OF WORDS. `PatientIdentity`
     * is what `/practice/tablet` and `/practice/frontdesk` render, so the order
     * and the wording cannot drift between the three surfaces — asserted
     * through its own test ids rather than by matching text (wow.md §10 rule 4).
     */
    const who = screen.getByTestId(`frontdesksmall-who-${HERE.patientId}`);
    expect(screen.getByTestId(`frontdesksmall-who-${HERE.patientId}-practice`).textContent).toBe(
      strings.recordId.practiceNumber(HERE.patientRecordNumber as string),
    );
    expect(who.textContent).toContain(strings.recordId.patient);
    expect(who.textContent).toContain(HERE.patientId);
    expect(screen.getByTestId(`frontdesksmall-who-${HERE.patientId}-record-copy`)).toBeTruthy();

    fireEvent.click(screen.getByTestId(`frontdesksmall-row-${HERE.agreementId}`));
    await waitFor(() =>
      expect(screen.queryByTestId(`frontdesksmall-detail-${HERE.agreementId}`)).toBeNull(),
    );
  });

  it('frontdesk_small_a_row_with_nothing_behind_it_is_not_a_control', async () => {
    /*
     * A finished visit and an arrival with nothing open have no queue row, so
     * there is nothing for a detail to be about. They are drawn as text, with
     * no focus stop that leads somewhere empty — the same decision the wide
     * desk makes, for the same reason: a button that opens nothing is a dead
     * end a first-day starter cannot get out of.
     *
     * AND "NEEDS A LOOK" STILL SAYS WHAT IT MEANS. There is nothing to press,
     * so the sentence has to do the work — and it says nobody was held up
     * (hard rule 8).
     */
    await openTheDesk();

    const finished = screen.getByTestId(`frontdesksmall-row-${SIGNED.arrivalId}`);
    expect(finished.tagName).toBe('SPAN');
    const look = screen.getByTestId(`frontdesksmall-row-${UNACCOUNTED.arrivalId}`);
    expect(look.tagName).toBe('SPAN');
    expect(screen.getByTestId(`frontdesksmall-why-${UNACCOUNTED.arrivalId}`).textContent).toBe(
      strings.frontdesk.rail.needsALookWhy,
    );

    // And the ones with work behind them ARE controls.
    expect(screen.getByTestId(`frontdesksmall-row-${HERE.agreementId}`).tagName).toBe('BUTTON');
  });

  it('frontdesk_small_looking_never_acts', async () => {
    /*
     * Nothing but the GETs the page reads with leaves it, whatever is pressed
     * in the list. Opening a person, filtering, clearing the filter: all of it
     * is looking.
     */
    await openTheDesk();

    fireEvent.click(screen.getByTestId(`frontdesksmall-row-${ON_TABLET.agreementId}`));
    await screen.findByTestId(`frontdesksmall-detail-${ON_TABLET.agreementId}`);
    fireEvent.click(screen.getByTestId('frontdesksmall-chip-here'));
    fireEvent.click(screen.getByTestId('frontdesksmall-chip-here'));

    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
});

describe('/practice/frontdesksmall — what it may and may not say', () => {
  it('frontdesk_small_shows_the_practice_number_and_no_medicare_number_or_clinical_detail', async () => {
    /*
     * HARD RULE 1 (REQ-VER-02): the Medicare card number is not an identifier
     * in this regime and there is no field for it. The PRACTICE'S own number
     * is approved and is on the row, labelled — a bare run of digits beside a
     * name could be read as anything, and what it must never be read as is a
     * card number.
     *
     * AND THE LIST FACES A WAITING ROOM. No condition, no provider, no reason
     * code, no service, no date of birth, no internal id (hard rule 9) and no
     * amount (hard rule 4). The fixture carries every one of them, which is
     * the only reason this assertion is worth anything.
     */
    const BLOCKED = row({
      agreementId: 'agreement-blocked',
      patientName: 'Blocked Person',
      patientId: '55555555-5555-4000-8000-000000000005',
      patientRecordNumber: 'DEV-BLOCKED-PERSON',
      serviceDescription: 'Specialist attendance',
      serviceDescriptionValid: false,
      mbsItemNumbers: ['23'],
      pushable: false,
      blockedReason: 'service_description_missing',
    });
    stubFetch({ rows: [BLOCKED], expected: [BOOKED] });
    render(<SmallDeskView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId(`frontdesksmall-row-${BLOCKED.agreementId}`)).toBeTruthy());

    const list = screen.getByTestId('frontdesksmall-list').textContent ?? '';
    expect(list).toContain('Blocked Person');
    expect(list).toContain(strings.recordId.practiceNumber('DEV-BLOCKED-PERSON'));
    for (const leak of [
      'service_description_missing',
      'Specialist attendance',
      'Dr Example Provider',
      'episodic_pre',
      BLOCKED.patientId,
      BLOCKED.agreementId,
    ]) {
      expect(list).not.toContain(leak);
    }
    // No date of birth anywhere on it, and nothing Medicare-shaped.
    expect(list).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(list).not.toMatch(/\d{10}/);
  });

  it('frontdesk_small_never_uses_a_domain_word_from_the_banned_list', async () => {
    /*
     * FRONT-DESK-PAGE.md §5 plus hard rule 12, and the same list the wide desk
     * is held to — this is the same job on a smaller screen, read by the same
     * person on the same first shift. Every string the page owns is read here,
     * not only the ones a fixture happens to render, so a word added later
     * fails the test rather than reaching a practice. `check-strings.mjs`
     * catches it earlier still, and names the line.
     */
    const banned = [
      'assignor',
      'episodic',
      'enduring',
      'supersede',
      'particulars',
      'capture request',
      'affiliation',
      'artefact',
      'attestation',
      'certified',
      'approved',
      'accredited',
      'government-approved',
    ];
    const said = JSON.stringify(strings.frontdeskSmall, (_key, value) =>
      typeof value === 'function' ? (value as (...args: string[]) => string)('Here now') : value,
    ).toLowerCase();
    for (const word of banned) expect(said).not.toContain(word);
  });

  it('frontdesk_small_says_nothing_holds_anybody_up_without_spending_the_top_of_the_screen', async () => {
    /*
     * HARD RULE 8 (REQ-REC-04), kept in ONE line. Carl's note on the wide desk
     * is that three stacked notices push the work a third of the way down the
     * screen; on a small screen that is the whole screen. So the promise is a
     * sentence on an ordinary morning — and it is NOT a `role="alert"` notice,
     * which is the thing that was costing the room.
     */
    await openTheDesk();

    const promise = screen.getByTestId('frontdesksmall-never-blocks');
    expect(promise.textContent).toBe(strings.frontdeskSmall.neverBlocks);
    expect(promise.closest('[role="alert"]')).toBeNull();
    // The list starts inside the first screenful — nothing above it is a banner.
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('frontdesk_small_an_outage_says_see_the_patient_anyway', async () => {
    /*
     * AND LOUD IN THE ONE MOMENT IT MATTERS. A page that cannot load is
     * exactly where somebody decides a patient has to wait, so here the
     * promise takes the room a notice takes. The words are the wide desk's,
     * unchanged: two screens must not reassure a practice differently about
     * the same outage.
     */
    stubFetch({ status: 500 });
    render(<SmallDeskView practiceId={PRACTICE} />);

    const anyway = await screen.findByTestId('frontdesksmall-see-them-anyway');
    expect(anyway.textContent).toBe(strings.frontdesk.seeThemAnyway);
  });

  it('frontdesk_small_without_the_register_it_shows_the_queue_and_no_total', async () => {
    /*
     * NULL MEANS "NOT READ", NOT "NOBODY CAME IN" (hard rule 8). Until the
     * register lands, and for as long as it fails, the page is the queue split
     * into here and on a tablet with NO total — a number nobody can stand
     * behind is worse than no number. The desk keeps working on what it has.
     */
    stubFetch({ rows: [HERE, ON_TABLET], sessions: [session()] });
    render(<SmallDeskView practiceId={PRACTICE} />);
    await waitFor(() => expect(rowsIn('onTablet')).toBe(1));

    expect(rowsIn('here')).toBe(1);
    expect(rowsIn('finished')).toBe(0);
    expect(screen.queryByTestId('frontdesksmall-day-total')).toBeNull();
    // The chips are still there, still honest, and still filter.
    expect(chip('here')).toBe(1);
    expect(chip('finished')).toBe(0);
  });

  it('the_service_list_puts_the_tag_in_one_column_and_the_words_in_the_other', async () => {
    /*
     * Carl, 12 September 2026: *"Put tags in col 1 - left aligned. Put text in
     * col 2 left aligned."* Said of THIS page, and applied to both desks so the
     * list reads the same on either (FRONT-DESK-PAGE.md §17.1).
     *
     * WHY IT IS ASSERTED HERE AS WELL AS ON THE WIDE DESK. The two lists are
     * laid out by two stylesheets, so a change that re-added row-level layout
     * to one of them would leave the other's test green — and the whole point
     * of the pairing is that a receptionist moving between them reads one list.
     *
     * ON THE STRUCTURE, NOT ON A WIDTH: jsdom does not lay out, so what is
     * worth pinning is that every row contributes exactly two cells to ONE
     * grid. That is what makes the tag column follow the longest tag rather
     * than a magic number that breaks the day a fifth state word is added.
     */
    await openTheDesk();
    fireEvent.click(screen.getByTestId(`frontdesksmall-row-${HERE.agreementId}`));

    const list = await screen.findByTestId(`frontdesksmall-checklist-${HERE.patientId}`);
    expect(list.children.length).toBeGreaterThan(0);
    for (const item of [...list.children]) {
      expect(item.tagName).toBe('LI');
      expect(item.children).toHaveLength(2);
      expect((item.children[0] as HTMLElement).className).toMatch(/checkTag/);
      expect((item.children[1] as HTMLElement).className).toMatch(/checkBody/);
    }
  });
});
