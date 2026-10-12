/**
 * PRACTICE FRONTDESK — THE QUEUE RAIL AND THE PATIENT PANEL, RENDERED
 * (FRONT-DESK-PAGE.md §4, §5, §12, §13; VISIT-CHECKLIST.md §9 phases 1 and 2).
 *
 * IT EXISTS BECAUSE THIS PAGE CANNOT BE SEEN WITHOUT A PASSKEY. The console
 * signs in through Keycloak with WebAuthn (hard rule 15 — there is no password
 * path and never will be), so nobody can open a practice screen in a headless
 * check. Without this, the panel's first render would happen in front of a
 * practice, with a patient at the desk.
 *
 * WHAT IT PINS, and every one of these is a rule from the plan rather than a
 * cosmetic preference:
 *
 *  - CHOOSING A NAME NEVER ACTS (§12.3). No request leaves the page but the
 *    GETs it reads with, whatever anybody clicks in the rail.
 *  - THE RAIL DOES NOT RE-SORT UNDER THE HAND between polls (§12.3), and
 *    exactly one row is marked as next (§4).
 *  - "EXPECTED" SAYS WHY IT IS EMPTY (§12.5) — the appointment feed is behind
 *    blocker D-01 and a blank box would read as broken.
 *  - THE ROWS CARRY A NAME, A TIME AND NOTHING ELSE (§12.3). No reason code,
 *    no service, no date of birth, no identifier (hard rules 1 and 9), no
 *    amount (hard rule 4).
 *  - EVERYTHING ABOUT THE PATIENT IS ON THIS PAGE (§13) — the checklist, the
 *    numbered send card, who is signing, bringing it back, fixing a detail —
 *    and nothing about them links away from it.
 *  - ONE PRIMARY ACTION (§4), and nothing irreversible without a plain
 *    sentence first (§6 rule 1).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DayRegister, DayRegisterRow, ExpectedAppointment } from '@aobplatform/contracts';
import {
  PUSH_BLOCKED_REASONS,
  VISIT_STATE_OPTIONS,
  type DeviceRow,
  type TabletSessionRow,
} from '@aobplatform/domain';
import {
  FrontDeskView,
  detailSentence,
  devAgreementType,
  stableByFirstSeen,
  timeLabel,
} from './FrontDeskView';
import { TabletView } from '../tablet/TabletView';
import { dayRails } from './dayRails';
import { everyServiceResolved } from './visitChecklist';
import { situationFor, visitChecklist } from './visitChecklist';
import { describeRefusal, type PushableRow, type CoveredServiceRow } from '../tablet/pushDesk';
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
 * The row carries far MORE than the rail shows, deliberately: it is the same
 * `pushable` payload the tablet desk reads, and
 * `front_desk_rail_shows_no_clinical_detail` is only worth anything because
 * the fields it must not render are actually present in the fixture.
 */
const row = (over: Partial<PushableRow> = {}): PushableRow => ({
  agreementId: 'agreement-here',
  agreementType: 'episodic_pre',
  status: 'draft',
  patientName: 'Jamie Sampleton',
  patientId: '11111111-1111-4000-8000-000000000001',
  // The practice's own handle. Not a Medicare-format number and not derivable
  // into one — the shape is the practice's, and this one is obviously fake.
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
  /*
   * NO CARD BOX AT THIS PRACTICE, which is the default
   * (`Practice.usesQueueTickets`) and is what keeps the number off every row
   * that does not ask for one. The ticket tests override it.
   */
  queueTicket: null,
  activeSession: null,
  ...over,
});

const HERE = row();
const SECOND = row({
  agreementId: 'agreement-second',
  patientName: 'Casey Walkin',
  patientId: '22222222-2222-4000-8000-000000000002',
  appointmentTime: '09:20',
});
const ON_TABLET = row({
  agreementId: 'agreement-tablet',
  patientName: 'Robin Reader',
  patientId: '33333333-3333-4000-8000-000000000003',
  appointmentTime: '09:10',
  activeSession: { id: 'session-1', deviceId: TABLET.id, state: 'reading' },
});

/**
 * THE SAME PERSON, WITH A DETAIL CROSSED. Used by the live-session tests,
 * which need the row and the session to agree about the session id — exactly
 * as the server's own two reads do.
 */
const DISPUTED_ROW = ON_TABLET;
const SESSION_ID = 'session-1';

/** The live session behind `ON_TABLET`, as `GET /tablet-sessions` returns it. */
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
 * hard rule 1, REQ-VER-02) and no Medicare-format number anywhere, because
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
 * ONE MORNING THAT REPRODUCES CARL'S, IN MINIATURE (12 September 2026: the
 * waiting page said fifteen, the desk said three, and twelve people were
 * invisible).
 *
 * SIX ARRIVALS AND EVERY SHAPE THAT WENT MISSING:
 *  - Jamie, on the queue with nothing on a tablet          → Here now
 *  - Robin, reading on a tablet                            → On a tablet
 *  - Dana, signed and gone from the queue                  → Finished
 *  - Frankie, came in for a blood test and signs nothing   → Finished
 *  - Kit, corrected — the arrival names the OLD agreement,
 *    the queue names its successor                         → Here now
 *  - Morgan, unsigned with nothing open for them           → NEEDS A LOOK
 */
const SIGNED = arrival({
  arrivalId: 'arrival-signed',
  patientId: '66666666-6666-4000-8000-000000000006',
  patientName: 'Dana Signed',
  agreementId: 'agreement-signed',
  agreementStatus: 'stored',
  agreementSigned: true,
  arrivedAt: '2026-09-12T08:30:00.000Z',
});
const NOTHING_TO_SIGN = arrival({
  arrivalId: 'arrival-bloods',
  patientId: '77777777-7777-4000-8000-000000000007',
  patientName: 'Frankie Bloods',
  agreementId: null,
  agreementStatus: null,
  agreementSigned: false,
  arrivedAt: '2026-09-12T08:40:00.000Z',
});
/** The successor the register already walked forward to (`newestAgreementInChain`). */
const CORRECTED_ROW = row({
  agreementId: 'agreement-successor',
  patientName: 'Kit Corrected',
  patientId: '88888888-8888-4000-8000-000000000008',
  appointmentTime: '09:30',
});
const CORRECTED = arrival({
  arrivalId: 'arrival-corrected',
  patientId: CORRECTED_ROW.patientId,
  patientName: CORRECTED_ROW.patientName,
  agreementId: CORRECTED_ROW.agreementId,
  arrivedAt: '2026-09-12T08:50:00.000Z',
});
const UNACCOUNTED = arrival({
  arrivalId: 'arrival-unaccounted',
  patientId: '99999999-9999-4000-8000-000000000009',
  patientName: 'Morgan Overlooked',
  agreementId: 'agreement-abandoned',
  agreementStatus: 'awaiting_signature',
  agreementSigned: false,
  arrivedAt: '2026-09-12T08:20:00.000Z',
});
const HERE_ARRIVAL = arrival({ arrivalId: 'arrival-here' });
const TABLET_ARRIVAL = arrival({
  arrivalId: 'arrival-tablet',
  patientId: ON_TABLET.patientId,
  patientName: ON_TABLET.patientName,
  agreementId: ON_TABLET.agreementId,
  arrivedAt: '2026-09-12T09:10:00.000Z',
});

/** The whole morning, in the order people walked in — which is the register's order. */
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
    /**
     * TODAY'S REGISTER. Left UNDEFINED by every test written before the rails
     * had to add up, and the endpoint then answers with something that is not
     * a register — which is exactly the "it never landed" case, and those
     * tests go on asserting the queue-only rail they were written for.
     */
    day?: DayRegister;
    /** A read that refuses — the cross-practice case, and the outage case. */
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
       * the general one — the same declaration-order trap the server's routes
       * have (wow.md §2 item 2).
       */
      const payload = url.includes('/arrivals/day')
        ? (opts.day ?? { notARegister: true })
        : url.includes('/arrivals/expected')
        ? (opts.expected ?? [])
        : url.includes('/tablet-sessions/pushable')
          ? (opts.rows ?? [HERE, ON_TABLET])
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

/**
 * A SECOND POLL, DRIVEN BY THE CLOCK RATHER THAN BY A RE-RENDER. The page
 * polls on an interval, and the order rule is a claim about what the SECOND
 * answer does to a list somebody is already looking at.
 */
async function poll() {
  await act(async () => {
    vi.advanceTimersByTime(3000);
  });
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/practice/frontdesk',
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

/** Choose a name on the rail and wait for the panel to be about them. */
async function choose(key: string, name: string) {
  await waitFor(() => expect(screen.getByTestId(`frontdesk-row-${key}`)).toBeTruthy());
  fireEvent.click(screen.getByTestId(`frontdesk-row-${key}`));
  await waitFor(() => expect(screen.getByTestId('frontdesk-chosen-name').textContent).toBe(name));
}

/**
 * WHAT LOOKS LIKE THE ANSWER, COUNTED. A DISABLED control does not look like
 * the answer — it is visibly not pressable — so §4's rule is about the ENABLED
 * primaries, which is also what makes it assertable on the numbered card,
 * where step ③ is styled as the eventual primary from the moment the card is
 * drawn and comes alive only when the two steps before it are done.
 */
function livePrimaries(node: HTMLElement): HTMLButtonElement[] {
  return [...node.querySelectorAll('button')].filter(
    (b) => /buttonPrimary/.test(b.className) && !(b as HTMLButtonElement).disabled,
  ) as HTMLButtonElement[];
}

// ---------------------------------------------------------------------------

describe('/practice/frontdesk — the queue rail', () => {
  it('front_desk_rail_never_acts_on_selection', async () => {
    /*
     * §12.3: "Clicking a name fills the panel. Nothing is sent, recalled or
     * confirmed from the rail, ever." A beginner scanning the list must not be
     * able to change anything by accident, so the assertion is about the WIRE
     * and not about which buttons happen to be on screen: whatever is clicked,
     * every request the page makes is still a GET.
     */
    stubFetch({ expected: [BOOKED] });
    render(<FrontDeskView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`frontdesk-row-${HERE.agreementId}`)).toBeTruthy());

    for (const key of [HERE.agreementId, ON_TABLET.agreementId, BOOKED.appointmentId]) {
      fireEvent.click(screen.getByTestId(`frontdesk-row-${key}`));
    }

    // The choice landed — this is not a test that passes because nothing happened.
    await waitFor(() => expect(screen.getByTestId('frontdesk-chosen-name').textContent).toBe(BOOKED.patientName));

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.method).toBe('GET');

    /*
     * AND THE RAIL OFFERS NO ACT TO REACH FOR. Every control inside it is a
     * name; there is nothing that sends, recalls or confirms.
     */
    const rail = screen.getByTestId('frontdesk-rail');
    for (const control of rail.querySelectorAll('button')) {
      expect(control.textContent ?? '').not.toMatch(/send|recall|bring it back|confirm|save/i);
    }
  });

  it('front_desk_rail_keeps_its_order_between_polls', async () => {
    /*
     * §12.3: "New arrivals appear; existing rows hold their place." The desk
     * polls every three seconds and a list that reorders while somebody is
     * reaching for it is how the wrong patient gets handed a tablet.
     */
    /*
     * `shouldAdvanceTime` SO BOTH CLOCKS WORK AT ONCE. The poll has to be
     * driven by hand, and `waitFor` needs the real one to keep ticking —
     * without it the two deadlock and the test simply times out.
     */
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch({ rows: [HERE, SECOND] });
    render(<FrontDeskView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`frontdesk-row-${SECOND.agreementId}`)).toBeTruthy());
    const first = () =>
      [...screen.getByTestId('frontdesk-group-here').querySelectorAll('[data-testid^="frontdesk-row-"]')].map(
        (node) => node.getAttribute('data-testid'),
      );
    expect(first()).toEqual([`frontdesk-row-${HERE.agreementId}`, `frontdesk-row-${SECOND.agreementId}`]);

    // The same two people come back in the opposite order, with a third behind them.
    const THIRD = row({
      agreementId: 'agreement-third',
      patientName: 'Sam Latecomer',
      patientId: '55555555-5555-4000-8000-000000000005',
    });
    stubFetch({ rows: [SECOND, HERE, THIRD] });
    await poll();

    await waitFor(() => expect(screen.getByTestId(`frontdesk-row-${THIRD.agreementId}`)).toBeTruthy());
    expect(first()).toEqual([
      `frontdesk-row-${HERE.agreementId}`,
      `frontdesk-row-${SECOND.agreementId}`,
      `frontdesk-row-${THIRD.agreementId}`,
    ]);
  });

  it('front_desk_orders_by_who_has_waited_longest', async () => {
    /*
     * §4: the queue orders itself by who has waited longest — which the SERVER
     * does, through the supersession chain, and this page must not
     * second-guess — "and marks exactly one row 'do this next'. Not a priority
     * scheme — the top of the list, said out loud, so there is no decision to
     * make."
     *
     * ONLY IN "HERE NOW". Somebody already reading on a tablet, or not yet
     * through the door, is not a thing to do next.
     */
    stubFetch({
      rows: [HERE, SECOND, ON_TABLET],
      sessions: [session()],
      expected: [BOOKED],
    });
    render(<FrontDeskView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`frontdesk-row-${SECOND.agreementId}`)).toBeTruthy());

    // Server order preserved, top first.
    const names = [...screen.getByTestId('frontdesk-group-here').querySelectorAll('[data-testid^="frontdesk-row-"]')]
      .map((node) => node.getAttribute('data-testid'));
    expect(names).toEqual([`frontdesk-row-${HERE.agreementId}`, `frontdesk-row-${SECOND.agreementId}`]);

    // EXACTLY one row is marked, and it is that top one.
    const marks = screen.getAllByText(strings.frontdesk.rail.next);
    expect(marks.length).toBe(1);
    expect(screen.getByTestId(`frontdesk-next-${HERE.agreementId}`)).toBeTruthy();
    expect(screen.queryByTestId(`frontdesk-next-${SECOND.agreementId}`)).toBeNull();
    expect(screen.queryByTestId(`frontdesk-next-${ON_TABLET.agreementId}`)).toBeNull();
  });

  it('front_desk_expected_group_says_why_it_is_empty', async () => {
    /*
     * §12.1: the appointment book reaches us only when the practice's software
     * pushes it, which is behind blocker D-01, and the dev database holds no
     * appointments at all. So this group is empty everywhere today — and
     * §12.5's answer is that it stays VISIBLE with its reason, so the absence
     * is a visible gap rather than a silent one.
     */
    stubFetch({ expected: [] });
    render(<FrontDeskView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId('frontdesk-group-expected')).toBeTruthy());

    expect(screen.getByTestId('frontdesk-empty-expected').textContent).toBe(
      strings.frontdesk.rail.expectedNoneYet,
    );
    expect(screen.getByTestId('frontdesk-why-expected').textContent).toBe(strings.frontdesk.rail.expectedWhy);
    // It names the practice's software as the reason, not us and not the user.
    expect(strings.frontdesk.rail.expectedNoneYet).toMatch(/practice software/i);
    expect(screen.getByTestId('frontdesk-count-expected').textContent).toBe(strings.frontdesk.rail.count(0));
  });

  it('front_desk_rail_shows_no_clinical_detail', async () => {
    /*
     * §12.3: "It never shows more than a name, a time and a group." A rail at
     * a front desk faces the room — the same reasoning that hides the waiting
     * list on the tablet. The fixture carries the provider, the service, the
     * blocked reason and the item numbers; none of them may reach the rail.
     */
    const BLOCKED = row({
      agreementId: 'agreement-blocked',
      patientName: 'Blocked Person',
      patientId: '66666666-6666-4000-8000-000000000006',
      serviceDescription: 'Specialist attendance',
      serviceDescriptionValid: false,
      mbsItemNumbers: ['23'],
      pushable: false,
      blockedReason: 'service_description_missing',
    });
    stubFetch({ rows: [BLOCKED], expected: [BOOKED] });
    render(<FrontDeskView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`frontdesk-row-${BLOCKED.agreementId}`)).toBeTruthy());

    const rail = screen.getByTestId('frontdesk-rail').textContent ?? '';
    expect(rail).toContain('Blocked Person');
    expect(rail).toContain('09:00');
    for (const leak of [
      'service_description_missing',
      'Specialist attendance',
      'Dr Example Provider',
      'episodic_pre',
      '23',
      BLOCKED.patientId,
      BLOCKED.agreementId,
    ]) {
      expect(rail).not.toContain(leak);
    }
    // And no date of birth or Medicare-shaped digits anywhere on it (hard rule 1).
    expect(rail).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(rail).not.toMatch(/\d{10}/);
  });

  it('front_desk_never_uses_a_domain_word_from_the_banned_list', async () => {
    /*
     * FRONT-DESK-PAGE.md §5 plus hard rule 12. Every string this page owns is
     * read here, not only the ones a given fixture happens to render, so a word
     * added to the table later fails the test rather than reaching a practice.
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
    const said = JSON.stringify(strings.frontdesk, (_key, value) =>
      typeof value === 'function' ? (value as (...args: string[]) => string)('Name', 'Tablet') : value,
    ).toLowerCase();
    for (const word of banned) expect(said).not.toContain(word);

    /*
     * AND THE RENDERED SENTENCE FOR THE ONE ROW THAT IS ABOUT A KIND OF
     * AGREEMENT (Carl, 12 September 2026: *"Should say (enduring / episodic) at
     * least while we are testing."*).
     *
     * WHAT A PRACTICE SEES IS THE PLAIN WORDS — "an ongoing agreement", "a
     * one-off agreement for today's visit" — and the domain terms are a
     * DEVELOPMENT AFFORDANCE behind `NODE_ENV`. This half proves the production
     * path is clean; `the_agreement_type_is_named_in_brackets_only_outside_production`
     * proves the affordance still exists, so it can neither leak nor rot.
     */
    // `vi.stubEnv` rather than an assignment: `process.env.NODE_ENV` is typed
    // readonly, and `afterEach`'s `unstubAllEnvs` is not needed because this
    // restores it in the same breath.
    vi.stubEnv('NODE_ENV', 'production');
    try {
      for (const type of ['enduring', 'episodic_pre', 'episodic_post']) {
        const rows = visitChecklist([row({ agreementType: type })], [], () => null);
        const line = detailSentence(rows.find((r) => r.key === 'needed')!).toLowerCase();
        for (const word of banned) expect(line).not.toContain(word);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('the_agreement_type_is_named_in_brackets_only_outside_production', () => {
    /*
     * CARL'S "AT LEAST WHILE WE ARE TESTING", BUILT AS A GATE RATHER THAN AS A
     * COPY CHANGE. `enduring` and `episodic` are banned on this surface because
     * it must be learnable on a first shift by somebody who has never heard
     * them — so the plain words always ship, and the domain's own term is
     * appended in brackets for whoever is testing.
     *
     * `NODE_ENV !== 'production'` IS THE HOUSE GATE, the same one the
     * renderer's draft marker uses.
     *
     * ASSERTED BOTH WAYS, so the affordance cannot rot into a leak or a dead
     * branch — which is the whole reason it is safe to have at all.
     */
    try {
      vi.stubEnv('NODE_ENV', 'development');
      expect(devAgreementType('enduring')).toBe(' (enduring)');
      expect(devAgreementType('episodic_pre')).toBe(' (episodic_pre)');
      // Nothing to say where there is no agreement to name.
      expect(devAgreementType(null)).toBe('');

      const ongoing = visitChecklist([row({ agreementType: 'enduring' })], [], () => null);
      const named = detailSentence(ongoing.find((r) => r.key === 'needed')!);
      // The plain words are still the sentence; the term is an appendix.
      expect(named).toContain('ongoing agreement');
      expect(named).toContain('(enduring)');

      vi.stubEnv('NODE_ENV', 'production');
      expect(devAgreementType('enduring')).toBe('');
      const shipped = detailSentence(
        visitChecklist([row({ agreementType: 'enduring' })], [], () => null)
          .find((r) => r.key === 'needed')!,
      );
      expect(shipped).toContain('ongoing agreement');
      expect(shipped).not.toContain('(');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('the_service_list_puts_the_tag_in_one_column_and_the_words_in_the_other', async () => {
    /*
     * Carl, 12 September 2026: *"Put tags in col 1 - left aligned. Put text in
     * col 2 left aligned."* The three tag words are different widths, so inline
     * they started every sentence at a different x and the eye could not run
     * down the list.
     *
     * ASSERTED ON THE STRUCTURE, not on a computed width: jsdom does not lay
     * out, so what is worth pinning is that every row contributes exactly two
     * cells to ONE grid — which is what makes the tag column follow the longest
     * word rather than a magic number.
     */
    stubFetch({ rows: [HERE] });
    render(<FrontDeskView practiceId={PRACTICE} />);
    await choose(HERE.agreementId, HERE.patientName);

    const list = screen.getByTestId('frontdesk-checklist').querySelector('ol');
    expect(list).toBeTruthy();
    for (const item of [...list!.children]) {
      expect(item.tagName).toBe('LI');
      // Two children exactly: the tag cell, then the words cell.
      expect(item.children).toHaveLength(2);
      expect((item.children[0] as HTMLElement).className).toMatch(/checkTag/);
      expect((item.children[1] as HTMLElement).className).toMatch(/checkBody/);
    }
  });

  it('front_desk_expected_never_names_somebody_already_on_the_queue', async () => {
    /*
     * A booking can carry a draft before the patient walks in, so the same
     * person could be named twice — once with work to do and once as "yet to
     * arrive". The queue wins: a screen arguing with itself is worse than a
     * shorter list, and nobody is hidden who has something to do.
     */
    const SAME_PERSON: ExpectedAppointment = {
      appointmentId: 'appointment-dup',
      patientId: HERE.patientId,
      patientName: HERE.patientName,
      time: '09:00',
    };
    stubFetch({ rows: [HERE], expected: [SAME_PERSON, BOOKED] });
    render(<FrontDeskView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`frontdesk-row-${BOOKED.appointmentId}`)).toBeTruthy());
    expect(screen.queryByTestId(`frontdesk-row-${SAME_PERSON.appointmentId}`)).toBeNull();
    expect(screen.getByTestId('frontdesk-count-expected').textContent).toBe(strings.frontdesk.rail.count(1));
  });

  it('front_desk_says_nothing_holds_anybody_up', async () => {
    /* Hard rule 8, on the screen, for the person most likely to doubt it. */
    stubFetch();
    render(<FrontDeskView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId('frontdesk-never-blocks')).toBeTruthy());
    expect(screen.getByTestId('frontdesk-never-blocks').textContent).toContain(strings.frontdesk.neverBlocks);
  });

  it('front_desk_says_see_the_patient_anyway_when_the_platform_is_unreachable', async () => {
    /*
     * §6 rule 5 and hard rule 8. A page that cannot load is exactly where a
     * first-day starter decides a patient has to wait, so the outage says the
     * opposite in as many words rather than leaving it to be inferred.
     */
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    render(<FrontDeskView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId('frontdesk-see-them-anyway')).toBeTruthy());
    expect(screen.getByTestId('frontdesk-see-them-anyway').textContent).toContain(
      strings.frontdesk.seeThemAnyway,
    );
    expect(strings.frontdesk.seeThemAnyway).toMatch(/see the patient anyway/i);
  });

  it('front_desk_across_a_practice_boundary_shows_nothing', async () => {
    /*
     * RLS is the enforcement and it is on the server; what this pins is that a
     * refusal shows NOBODY rather than a stale or partial list. The page names
     * no patient, offers no control, and still says care carries on.
     */
    stubFetch({ status: 403 });
    render(<FrontDeskView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId('frontdesk-see-them-anyway')).toBeTruthy());
    expect(screen.queryByTestId('frontdesk-chosen-name')).toBeNull();
    expect(document.body.textContent).not.toContain(HERE.patientName);
    expect(document.body.textContent).not.toContain(ON_TABLET.patientName);
  });
});

// ---------------------------------------------------------------------------

describe('the patient panel — everything about them, on this page', () => {
  it('front_desk_shows_the_visit_checklist_for_the_chosen_patient', async () => {
    /*
     * VISIT-CHECKLIST.md §9 phase 1: the four paperwork rows that already
     * exist, computed. Nothing here is marked by hand, and there is no control
     * on any row but the send card that row 3 owns.
     */
    stubFetch({ rows: [HERE] });
    render(<FrontDeskView practiceId={PRACTICE} />);
    await choose(HERE.agreementId, HERE.patientName);

    const list = screen.getByTestId('frontdesk-checklist');
    for (const key of ['needed', 'made', 'signed', 'after'] as const) {
      expect(within(list).getByTestId(`frontdesk-check-${key}`)).toBeTruthy();
      expect(within(list).getByTestId(`frontdesk-check-${key}`).textContent).toContain(
        strings.frontdesk.checklist.rows[key],
      );
    }

    // The policy already said yes, and named the kind and the provider.
    expect(screen.getByTestId('frontdesk-check-state-needed').textContent).toBe(
      strings.frontdesk.checklist.state.done,
    );
    /*
     * `toContain`, BECAUSE OUTSIDE PRODUCTION THE LINE ALSO CARRIES THE
     * DOMAIN'S OWN TERM IN BRACKETS (Carl, 12 September 2026: *"Should say
     * (enduring / episodic) at least while we are testing."*). The plain
     * sentence is the part a practice sees and the part this pins;
     * `the_agreement_type_is_named_in_brackets_only_outside_production` owns
     * the appendix.
     */
    expect(screen.getByTestId('frontdesk-check-detail-needed').textContent).toContain(
      strings.frontdesk.checklist.detail.todaysVisit(HERE.providerName),
    );
    // Drafted, checked and locked — nobody can be asked to sign a draft.
    expect(screen.getByTestId('frontdesk-check-state-made').textContent).toBe(
      strings.frontdesk.checklist.state.done,
    );
    // Not signed yet, and nothing has been billed afterwards.
    expect(screen.getByTestId('frontdesk-check-state-signed').textContent).toBe(
      strings.frontdesk.checklist.state.outstanding,
    );
    expect(screen.getByTestId('frontdesk-check-state-after').textContent).toBe(
      strings.frontdesk.checklist.state.notNeeded,
    );
  });

  it('no_amount_appears_anywhere_on_the_checklist', async () => {
    /*
     * VISIT-CHECKLIST.md §8, and hard rule 4. Bulk billing means the patient
     * pays nothing; there is no benefit or dollar figure on any agreement
     * artefact and none on the panel that describes one.
     */
    stubFetch({ rows: [row({ mbsItemNumbers: ['23'], serviceDate: '2026-09-12' })] });
    render(<FrontDeskView practiceId={PRACTICE} />);
    await choose(HERE.agreementId, HERE.patientName);

    const panel = screen.getByTestId('frontdesk-panel').textContent ?? '';
    expect(panel).not.toMatch(/\$/);
    expect(panel).not.toMatch(/\bA\$?\d/);
    expect(panel).not.toMatch(/benefit/i);
  });

  it('front_desk_send_strip_appears_for_an_outstanding_agreement', async () => {
    /*
     * VISIT-CHECKLIST.md §9 phase 2, and Carl's second note on the annotated
     * screenshot: the send card belongs to step 3 — get the patient to sign on
     * a tablet — so it is drawn as that row's own body, in place, and not on
     * another page.
     *
     * IT IS THE TABLET DESK'S OWN STRIP, not a copy: the test ids it renders
     * are `pushDesk.tsx`'s.
     */
    stubFetch({ rows: [HERE] });
    render(<FrontDeskView practiceId={PRACTICE} />);
    await choose(HERE.agreementId, HERE.patientName);

    const stepThree = screen.getByTestId('frontdesk-check-signed');
    expect(within(stepThree).getByTestId(`steps-${HERE.agreementId}`)).toBeTruthy();
    expect(within(stepThree).getByTestId(`who-open-${HERE.agreementId}`)).toBeTruthy();
    expect(within(stepThree).getByTestId(`target-${HERE.agreementId}`)).toBeTruthy();
    expect(within(stepThree).getByTestId(`send-${HERE.agreementId}`)).toBeTruthy();

    // And a tablet can be chosen and sent from right here.
    const target = screen.getByTestId(`target-${HERE.agreementId}`) as HTMLSelectElement;
    expect(target.disabled).toBe(false);
    await waitFor(() => expect(target.options.length).toBeGreaterThan(1));
  });

  it('front_desk_asks_who_is_signing_before_it_offers_a_tablet', async () => {
    /*
     * §6 rule 2: "the question simply comes first". The gate is a SEQUENCE and
     * not a scolding — the select and Send are dead until who is signing has
     * been answered, and step ① is the only thing on the card that can be
     * pressed.
     */
    const UNCONFIRMED = row({
      agreementId: 'agreement-unconfirmed',
      patientName: 'Kim Unconfirmed',
      patientId: '77777777-7777-4000-8000-000000000007',
      assignorConfirmedAt: null,
      pushable: false,
      blockedReason: 'assignor_not_confirmed',
    });
    stubFetch({ rows: [UNCONFIRMED] });
    render(<FrontDeskView practiceId={PRACTICE} />);
    await choose(UNCONFIRMED.agreementId, UNCONFIRMED.patientName);

    // The sentence asks the question before anything else does.
    expect(screen.getByTestId('frontdesk-chosen-what').textContent).toBe(
      strings.frontdesk.panel.whoIsSigning(UNCONFIRMED.patientName),
    );

    const who = screen.getByTestId(`who-open-${UNCONFIRMED.agreementId}`) as HTMLButtonElement;
    const target = screen.getByTestId(`target-${UNCONFIRMED.agreementId}`) as HTMLSelectElement;
    const send = screen.getByTestId(`send-${UNCONFIRMED.agreementId}`) as HTMLButtonElement;
    expect(who.disabled).toBe(false);
    expect(target.disabled).toBe(true);
    expect(send.disabled).toBe(true);

    // And the one live primary in the action area is that question.
    const live = livePrimaries(screen.getByTestId('frontdesk-action'));
    expect(live.length).toBe(1);
    expect(live[0]).toBe(who);

    // Pressing it opens the form here, not somewhere else.
    fireEvent.click(who);
    await waitFor(() =>
      expect(screen.getByTestId(`who-panel-${UNCONFIRMED.agreementId}`)).toBeTruthy(),
    );
  });

  it('front_desk_shows_one_primary_action_per_patient', async () => {
    /*
     * §4: "A first-day user should not be choosing between two buttons that
     * both look like the answer." The panel's action area holds exactly one
     * ENABLED primary at a time — a disabled control is visibly not the thing
     * to press, which is what lets the numbered card style step ③ as the
     * eventual answer from the moment it is drawn.
     */
    stubFetch({ rows: [HERE, ON_TABLET], sessions: [session()] });
    render(<FrontDeskView practiceId={PRACTICE} />);

    /*
     * ON THE NUMBERED CARD the single next thing is a STEP rather than always
     * a button — step ② is a tablet select, and there is nothing primary to
     * press until one is chosen. So the claim is the one the card actually
     * makes: exactly one step is marked as now, and never more than one
     * enabled primary sits beside it.
     */
    await choose(HERE.agreementId, HERE.patientName);
    const card = screen.getByTestId('frontdesk-action');
    expect(card.querySelectorAll('[aria-current="step"]').length).toBe(1);
    expect(livePrimaries(card).length).toBeLessThanOrEqual(1);

    /*
     * AND ON A LIVE TABLET the action area is the tablet desk's own
     * `SessionActions`, which lights exactly one primary — Re-send — and only
     * once a detail has been crossed. A session nobody has disputed offers
     * Recall alone, which is one answer with no primary to compete with it.
     */
    await choose(ON_TABLET.agreementId, ON_TABLET.patientName);
    expect(livePrimaries(screen.getByTestId('frontdesk-action')).length).toBe(0);
    expect(screen.getByTestId(`recall-${SESSION_ID}`)).toBeTruthy();
  });

  it('front_desk_confirms_in_words_before_anything_irreversible', async () => {
    /*
     * §6 rule 1: "Recall, replace and 'no change needed' all confirm in words,
     * naming what will happen and to whom."
     *
     * WHAT CHANGED, AND WHY (Carl, 12 Sep 2026: *"Why are you not just copying
     * the existing logic."*). This page briefly had a "Bring it back" of its
     * own with a yes/no question in front of it. That hid the other three
     * controls and said a different thing about the same act, so it went and
     * the tablet desk's `SessionActions` took its place, word for word.
     *
     * THE SENTENCE THAT REMAINS IS THE ONE THAT MATTERS. "No change needed" is
     * a claim somebody may be asked about later — it records, against their
     * name, that the patient was wrong — and the note stating exactly that
     * stands beside the button before anybody presses it. Recall and Re-send
     * change nothing about the agreement (hard rule 8, REQ-REC-04), which is
     * why they are one press on both pages.
     */
    stubFetch({
      rows: [DISPUTED_ROW],
      sessions: [session({ state: 'details_disputed', disputedDetails: ['address'] })],
    });
    render(<FrontDeskView practiceId={PRACTICE} />);
    await choose(DISPUTED_ROW.agreementId, DISPUTED_ROW.patientName);

    const note = await screen.findByTestId(`no-change-note-${SESSION_ID}`);
    expect(note.textContent).toBe(strings.tablet.noChangeNote);
    expect(note.textContent).toMatch(/recorded against your name/i);
    // The claim and the sentence about it are on screen together.
    expect(screen.getByTestId(`no-change-${SESSION_ID}`)).toBeTruthy();
    // And nothing has gone to the server from merely looking.
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('front_desk_shows_the_live_session_the_way_the_tablet_desk_does', async () => {
    /*
     * Carl, 12 Sep 2026, testing: a patient pushed from `/practice/tablet`
     * showed on this page as "Signed on a tablet · Still to do" and nothing
     * else — no chip saying where the agreement was, no dispute notice, and
     * none of the four controls. Those are the tablet desk's own renderings
     * and this page now uses them rather than a subset of its own.
     *
     * WHERE IT IS is a different fact from WHETHER THE PAPERWORK IS DONE, and
     * both are shown: the checklist row still reads "Still to do", and the
     * chip beside it says which tablet and which session.
     */
    stubFetch({
      rows: [DISPUTED_ROW],
      sessions: [session({ state: 'details_disputed', disputedDetails: ['address'] })],
    });
    render(<FrontDeskView practiceId={PRACTICE} />);
    await choose(DISPUTED_ROW.agreementId, DISPUTED_ROW.patientName);

    // The chip, in the tablet desk's own words, with the same session tag.
    const live = screen.getByTestId('frontdesk-live');
    expect(live.textContent).toContain(strings.tablet.onTabletNow(TABLET.label));
    expect(live.textContent).toContain(strings.tablet.liveFaultDetail);
    expect(screen.getByTestId('frontdesk-session-id-panel')).toBeTruthy();
    // And beside checklist row 3, which still reports the paperwork state.
    expect(screen.getByTestId('frontdesk-check-live')).toBeTruthy();
    expect(screen.getByTestId('frontdesk-check-state-signed').textContent).toBe(
      strings.frontdesk.checklist.state.outstanding,
    );

    // The dispute notice, and all four controls, in the panel.
    expect(screen.getByTestId(`disputed-${SESSION_ID}`)).toBeTruthy();
    for (const id of [`recall-${SESSION_ID}`, `correct-open-${SESSION_ID}`, `no-change-${SESSION_ID}`, `resend-${SESSION_ID}`]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    // And the device name is printed as the practice wrote it — once.
    expect(screen.getByTestId('frontdesk-chosen-what').textContent).not.toContain('tablet tablet');
  });

  it('front_desk_keeps_the_patient_when_answering_who_is_signing_replaces_the_agreement', async () => {
    /*
     * Carl, 12 Sep 2026, testing: the panel dropped back to "Choose a name on
     * the left" after saving who is signing.
     *
     * WHY IT HAD TO. A party change on a prepared row SUPERSEDES — the
     * agreement leaves the desk and a NEW id takes its place — so a selection
     * keyed on the agreement id was guaranteed to be lost on every successful
     * save, not merely on an error. It is keyed on the PATIENT, who does not
     * change, and the panel follows them onto the successor.
     */
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch({ rows: [HERE] });
    render(<FrontDeskView practiceId={PRACTICE} />);
    await choose(HERE.agreementId, HERE.patientName);

    // The save supersedes: same person, a brand new agreement id.
    const SUCCESSOR = row({ agreementId: 'agreement-successor' });
    stubFetch({ rows: [SUCCESSOR] });
    await poll();

    await waitFor(() =>
      expect(screen.getByTestId(`frontdesk-row-${SUCCESSOR.agreementId}`)).toBeTruthy(),
    );
    // Still the same patient, still on the panel, now on the newer row.
    expect(screen.getByTestId('frontdesk-chosen-name').textContent).toBe(HERE.patientName);
    expect(screen.getByTestId(`steps-${SUCCESSOR.agreementId}`)).toBeTruthy();
  });

  /*
   * Carl, 12 September 2026: "patientid missing under patient name". It is the
   * handle reception reads out and types into the practice's own software, so
   * the panel must carry it beside the name rather than making somebody
   * cross-check by name and date of birth.
   */
  it('front_desk_panel_shows_the_practice_patient_id_under_the_name', async () => {
    const HERE = row({ patientRecordNumber: 'XL-004821' });
    stubFetch({ rows: [HERE] });
    render(<FrontDeskView practiceId={PRACTICE} />);
    await choose(HERE.agreementId, HERE.patientName);

    expect(screen.getByTestId('frontdesk-chosen-record-number-practice').textContent)
      .toBe('PMS patient ID XL-004821');

    /*
     * AND OUR OWN RECORD ID UNDERNEATH (Carl, 12 September 2026: *"ok. In that
     * case show both ids."*). Both, in one order, on every surface — see
     * `the_tablet_desk_and_the_front_desk_name_a_patient_the_same_way`.
     */
    expect(screen.getByTestId('frontdesk-chosen-record-number-record').textContent)
      .toContain(HERE.patientId);
  });

  it('front_desk_panel_says_so_when_there_is_no_patient_id', async () => {
    const HERE = row({ patientRecordNumber: null });
    stubFetch({ rows: [HERE] });
    render(<FrontDeskView practiceId={PRACTICE} />);
    await choose(HERE.agreementId, HERE.patientName);

    // Said, not blank: an empty line under a name reads as a failed load.
    expect(screen.getByTestId('frontdesk-chosen-record-number-practice').textContent).toBe(
      'No PMS patient ID on this record',
    );
    // Ours always exists, so it needs no such twin and is still there.
    expect(screen.getByTestId('frontdesk-chosen-record-number-record').textContent)
      .toContain(HERE.patientId);
  });

  it('front_desk_every_patient_action_is_on_the_page', async () => {
    /*
     * §13, Carl 12 Sep 2026: "Everything to do with the patient must be on this
     * page - no going to another page." The placeholder's "Open Send to the
     * tablet" link is gone, and nothing in the panel routes to the tablet desk
     * or to a patient's own page — including the one refusal whose shortcut is
     * a per-patient screen, which keeps its SENTENCE and loses its hop.
     *
     * WHAT MAY STILL LEAVE. Practice CONFIGURATION is not patient work (§13),
     * so a refusal that lands on the devices page or the kiosk setting is
     * left alone.
     */
    const CONFIDENTIAL = row({
      agreementId: 'agreement-confidential',
      patientName: 'Private Person',
      patientId: '88888888-8888-4000-8000-000000000008',
      pushable: false,
      blockedReason: 'patient_confidential',
    });
    stubFetch({ rows: [HERE, CONFIDENTIAL] });
    render(<FrontDeskView practiceId={PRACTICE} />);

    for (const chosen of [HERE, CONFIDENTIAL]) {
      await choose(chosen.agreementId, chosen.patientName);
      const panel = screen.getByTestId('frontdesk-panel');
      for (const anchor of panel.querySelectorAll('a[href]')) {
        const href = anchor.getAttribute('href') ?? '';
        expect(href.startsWith('/practice/patients')).toBe(false);
        expect(href.startsWith('/practice/tablet')).toBe(false);
      }
    }

    // The reason is still stated in full, so nothing was hidden with the link.
    expect(screen.getByTestId(`blocked-${CONFIDENTIAL.agreementId}`).textContent).toContain(
      strings.tablet.blocked.patient_confidential,
    );
    // And the placeholder's link is gone from the page entirely.
    expect(screen.queryByTestId('frontdesk-to-tablet')).toBeNull();
  });

  it('front_desk_get_help_reveals_the_expert_controls_without_leaving_the_page', async () => {
    /*
     * §13 SUPERSEDES §8's `front_desk_get_help_carries_the_patient_to_the_admin_page`.
     * Carl's constraint is that a beginner is never sent to another screen
     * mid-task, so "Get help" now REVEALS the same controls the tablet desk
     * has, here, under the same patient. The disclosure is named "Get help" in
     * the one situation §4's table calls *cannot proceed*, and "More"
     * everywhere else — one control, named for what the reader is after.
     */
    const STUCK = row({
      agreementId: 'agreement-stuck',
      patientName: 'Stuck Person',
      patientId: '99999999-9999-4000-8000-000000000009',
      providerType: 'specialist',
      agreementType: 'enduring',
      pushable: false,
      blockedReason: 'enduring_not_gp',
    });
    stubFetch({ rows: [STUCK] });
    render(<FrontDeskView practiceId={PRACTICE} />);
    await choose(STUCK.agreementId, STUCK.patientName);

    const disclose = screen.getByTestId('frontdesk-disclose');
    expect(disclose.textContent).toContain(strings.frontdesk.panel.getHelp);
    expect(screen.queryByTestId('frontdesk-expert')).toBeNull();

    fireEvent.click(disclose);
    const expert = await screen.findByTestId('frontdesk-expert');
    expect(expert.textContent).toContain(strings.frontdesk.panel.expertLead);
    // It reveals, it does not navigate.
    expect(window.location.pathname).not.toContain('/practice/tablet');
    for (const anchor of expert.querySelectorAll('a[href]')) {
      expect((anchor.getAttribute('href') ?? '').startsWith('/practice/patients')).toBe(false);
    }
  });

  it('front_desk_never_offers_an_enduring_agreement_for_a_non_gp', async () => {
    /*
     * Hard rule 6, REQ-END-01/-01a — and §8 names it as the one regulatory
     * mistake a simplified page is most likely to make. An ongoing agreement
     * is per practitioner AND general-practitioner-only; the panel says what to
     * offer instead rather than leaving somebody to discover it, and it offers
     * no control that would create one.
     */
    const SPECIALIST = row({
      agreementId: 'agreement-specialist',
      patientName: 'Sandy Specialist',
      patientId: '10101010-1010-4000-8000-000000000010',
      agreementType: 'enduring',
      providerType: 'specialist',
      pushable: false,
      blockedReason: 'enduring_not_gp',
    });
    stubFetch({ rows: [SPECIALIST] });
    render(<FrontDeskView practiceId={PRACTICE} />);
    await choose(SPECIALIST.agreementId, SPECIALIST.patientName);

    const band = screen.getByTestId(`blocked-${SPECIALIST.agreementId}`);
    expect(band.textContent).toContain(strings.tablet.blocked.enduring_not_gp);
    expect(band.textContent).toContain(strings.tablet.enduringOfferOther);
    // No numbered card at all: this one can never go, and a strip of three
    // steps over it would teach a beginner the page is broken.
    expect(screen.queryByTestId(`steps-${SPECIALIST.agreementId}`)).toBeNull();
    expect(screen.queryByTestId(`send-${SPECIALIST.agreementId}`)).toBeNull();
  });

  it('front_desk_maps_every_server_reason_to_a_sentence_and_a_destination', async () => {
    /*
     * CLAUDE.md §7. Driven off the domain's own list, so a reason added to the
     * server fails this test rather than showing a code to a beginner — and an
     * UNMAPPED code shows itself, because a generic sentence would destroy the
     * one string somebody could diagnose it from.
     */
    for (const reason of PUSH_BLOCKED_REASONS) {
      const said = describeRefusal(reason, { providerType: 'general_practitioner' });
      expect(said.text.length).toBeGreaterThan(0);
      /*
       * `other` IS THE DOMAIN'S OWN NAME FOR "a reason with no name", so it is
       * the one member of the list that is expected to fall through — and when
       * it does the sentence must still carry the code. Every other reason is
       * mapped, and a new one added to the domain lands here as a failure
       * rather than as a code shown to a beginner.
       */
      if (reason === 'other') {
        expect(said.code).toBe('other');
        expect(said.text).toContain('other');
      } else {
        expect(said.code).toBeUndefined();
      }
    }
    const unknown = describeRefusal('a_reason_from_a_newer_server');
    expect(unknown.code).toBe('a_reason_from_a_newer_server');
    expect(unknown.text).toContain('a_reason_from_a_newer_server');

    // And the sentence reaches the panel rather than staying in the mapping.
    const BLOCKED = row({
      agreementId: 'agreement-nod6a',
      patientName: 'Nod Sixa',
      patientId: '11121112-1112-4000-8000-000000000011',
      pushable: false,
      blockedReason: 'service_description_missing',
    });
    stubFetch({ rows: [BLOCKED] });
    render(<FrontDeskView practiceId={PRACTICE} />);
    await choose(BLOCKED.agreementId, BLOCKED.patientName);
    const band = screen.getByTestId(`blocked-${BLOCKED.agreementId}`);
    expect(band.textContent).toContain(strings.tablet.blocked.service_description_missing);
    // The fix is IN the band, on this row — not directions to a screen.
    expect(within(band).getByTestId(`d6a-fix-${BLOCKED.agreementId}`)).toBeTruthy();
  });

  it('front_desk_says_when_a_patient_is_finished_rather_than_going_blank', async () => {
    /*
     * §4's last row — "Done. Jamie signed at 9:42." / "Next patient". A signed
     * agreement leaves the queue at once, so the panel used to empty itself
     * under somebody's hand at the one moment the page should be clearest.
     *
     * IT SAYS "NOTHING LEFT TO DO" AND NOT "SIGNED", because a row can also
     * leave because the visit was cancelled or another desk dealt with it, and
     * the queue alone cannot tell those apart. Claiming a signature we have
     * not read would be worse than the honest sentence.
     */
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch({ rows: [HERE, SECOND] });
    render(<FrontDeskView practiceId={PRACTICE} />);
    await choose(HERE.agreementId, HERE.patientName);

    // They sign; their row leaves the desk.
    stubFetch({ rows: [SECOND] });
    await poll();

    const said = await screen.findByTestId('frontdesk-finished');
    expect(said.textContent).toBe(strings.frontdesk.panel.finished(HERE.patientName));
    expect(screen.queryByTestId('frontdesk-chosen-name')).toBeNull();

    // One press moves on, and choosing somebody else clears it too.
    fireEvent.click(screen.getByTestId('frontdesk-next-patient'));
    await waitFor(() => expect(screen.queryByTestId('frontdesk-finished')).toBeNull());
  });

  it('the_checklist_never_gates_a_consultation_or_a_bill', async () => {
    /*
     * VISIT-CHECKLIST.md §7 rule 1 and hard rule 8. Nothing on the list gates
     * care, and the panel says so rather than leaving a first-day starter to
     * infer it from a row that says "Still to do".
     */
    stubFetch({ rows: [row({ pushable: false, blockedReason: 'device_not_paired' })] });
    render(<FrontDeskView practiceId={PRACTICE} />);
    await choose(HERE.agreementId, HERE.patientName);

    expect(screen.getByTestId('frontdesk-never-blocks').textContent).toContain(strings.frontdesk.neverBlocks);
    const panel = screen.getByTestId('frontdesk-panel').textContent ?? '';
    // No word on the panel is phrased as a permission or a hold.
    expect(panel).not.toMatch(/cannot be seen|must not be seen|do not see|wait to be seen/i);
  });
});

// ---------------------------------------------------------------------------

describe('the rail’s own rules, without a screen', () => {
  it('stable_order_keeps_first_seen_places_and_appends_newcomers', () => {
    const memory = new Map<string, number>();
    const key = (s: string) => s;

    expect(stableByFirstSeen(['a', 'b', 'c'], key, memory)).toEqual(['a', 'b', 'c']);
    // Re-ordered by the server, plus a newcomer: the three hold, 'd' joins the end.
    expect(stableByFirstSeen(['c', 'd', 'a', 'b'], key, memory)).toEqual(['a', 'b', 'c', 'd']);
    // 'a' leaves and comes back — it is new to the list again, so it goes last.
    expect(stableByFirstSeen(['b', 'c', 'd'], key, memory)).toEqual(['b', 'c', 'd']);
    expect(stableByFirstSeen(['a', 'b', 'c', 'd'], key, memory)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('a_booking_with_no_time_says_so_rather_than_showing_nothing', () => {
    expect(timeLabel('09:00')).toBe('09:00');
    expect(timeLabel(null)).toBe(strings.frontdesk.rail.noTime);
    expect(timeLabel('   ')).toBe(strings.frontdesk.rail.noTime);
  });
});

// ---------------------------------------------------------------------------

describe('the checklist, computed', () => {
  const noDevice = () => null;

  it('a_blood_test_with_no_claim_closes_with_nothing_to_sign', () => {
    /*
     * VISIT-CHECKLIST.md §6 and §8. A visit whose billed item needed no second
     * signature has no agreement on the queue at all — it has a covered line —
     * and every row that would otherwise ask for a signature says "Nothing to
     * sign", the same fourth word the practitioner's waiting list uses.
     */
    const line: CoveredServiceRow = {
      serviceRecordId: 'service-1',
      patientId: HERE.patientId,
      patientName: HERE.patientName,
      providerName: 'Pat Phlebotomist',
      serviceDate: '2026-09-12',
      mbsItemNumbers: ['73806'],
      decision: 'covered_by_enduring',
      reason: 'covered_by_an_ongoing_agreement',
      policyVersion: 'post-service-2026-09-1',
      coveringAgreementId: null,
    };
    const list = visitChecklist([], [line], noDevice);
    // Five rows since D-2026-09-12-20: the visit itself sits between "signed"
    // and "signed after the visit", and here there is no visit to report on.
    expect(list.map((r) => r.state)).toEqual([
      'not_needed',
      'not_needed',
      'not_needed',
      'not_needed',
      'not_needed',
    ]);
    expect(list[0].ruleKey).toBe('covered_by_an_ongoing_agreement');
    // The word itself, from the table, and the same one the queue page uses.
    expect(strings.frontdesk.checklist.state.notNeeded).toBe(
      strings.practitionerQueue.waiting.paperwork.nothing_to_sign,
    );
  });

  it('a_signature_today_reads_as_done_and_an_ongoing_agreement_does_not', () => {
    /*
     * THE DISTINCTION THAT MAKES ROW 3 HONEST. `covered` means the item was
     * covered by the agreement the patient signed on the way in — so they DID
     * sign, and the row is Done. `covered_by_enduring` means an ongoing
     * agreement stood already and nobody signed anything today, which is
     * "nothing to sign" and never "done".
     */
    const base = {
      serviceRecordId: 'service-2',
      patientId: HERE.patientId,
      patientName: HERE.patientName,
      providerName: 'Dr Example Provider',
      serviceDate: '2026-09-12',
      mbsItemNumbers: ['23'],
      policyVersion: 'post-service-2026-09-1',
      coveringAgreementId: 'agreement-signed',
    };
    const signedToday = visitChecklist(
      [],
      [{ ...base, decision: 'covered', reason: 'covered_by_todays_agreement' } as CoveredServiceRow],
      noDevice,
    );
    expect(signedToday.find((r) => r.key === 'signed')?.state).toBe('done');

    const standing = visitChecklist(
      [],
      [{ ...base, decision: 'covered_by_enduring', reason: 'covered_by_an_ongoing_agreement' } as CoveredServiceRow],
      noDevice,
    );
    expect(standing.find((r) => r.key === 'signed')?.state).toBe('not_needed');
  });

  it('a_post_service_agreement_is_the_fourth_row_and_not_the_third', () => {
    /*
     * VISIT-CHECKLIST.md §2 rows 3 and 7 are different steps. A visit billed
     * after the fact raises row 4; it does not make row 3 outstanding a second
     * time, and it never carries an amount (hard rule 4 — there is no field).
     */
    const post = row({
      agreementId: 'agreement-post',
      agreementType: 'episodic_post',
      serviceDate: '2026-09-12',
      mbsItemNumbers: ['23'],
    });
    const list = visitChecklist([post], [], noDevice);
    expect(list.find((r) => r.key === 'needed')?.detail).toBe('afterService');
    expect(list.find((r) => r.key === 'after')?.state).toBe('outstanding');
    expect(list.find((r) => r.key === 'signed')?.state).toBe('not_needed');
  });

  it('an_ongoing_agreement_is_named_under_its_provider', () => {
    /* Hard rule 6: never practice-wide, always this practitioner. */
    const list = visitChecklist([row({ agreementType: 'enduring' })], [], noDevice);
    const needed = list.find((r) => r.key === 'needed');
    expect(needed?.detail).toBe('ongoing');
    expect(strings.frontdesk.checklist.detail.ongoing(needed?.provider ?? null)).toContain(
      'Dr Example Provider',
    );
  });

  it('one_situation_at_a_time_and_a_live_tablet_wins', () => {
    /*
     * §4 asks the panel for ONE next thing, so the computation returns one
     * word. A row on a tablet is on a tablet whatever else is true of it, and
     * a refusal the numbered card cannot itself clear is "waiting" rather than
     * a card over a row that can never go.
     */
    expect(situationFor(row(), null)).toBe('ready_to_send');
    expect(situationFor(row({ assignorConfirmedAt: null, pushable: false, blockedReason: 'assignor_not_confirmed' }), null))
      .toBe('who_is_signing');
    expect(situationFor(row({ pushable: false, blockedReason: 'enduring_not_gp' }), null)).toBe('waiting');
    expect(situationFor(ON_TABLET, null)).toBe('on_a_tablet');
    expect(
      situationFor(ON_TABLET, { disputedDetails: ['address'], disputeResolution: null }),
    ).toBe('detail_wrong');
    // A dispute somebody has already answered is not still a dispute.
    expect(
      situationFor(ON_TABLET, { disputedDetails: ['address'], disputeResolution: 'corrected' }),
    ).toBe('on_a_tablet');
  });
});

// ---------------------------------------------------------------------------

/**
 * THE TWO PAGES RECONCILE, AND THE TEST IS THE DELIVERABLE (Carl, 12 September
 * 2026, with `/practice/frontdesk` open beside
 * `/practice/practitioner/waiting`: *"Both pages have to reconcile. Have
 * another list if you have to on frontdesk as every patient has to be seen."*).
 *
 * WHAT WENT WRONG. The day held fifteen arrivals and the desk showed three.
 * Eight had signed and finished, four had been replaced by a corrected
 * agreement and appeared only as somebody else's successor, and two had come
 * in, not signed, had nothing open for them and were on no screen anywhere.
 * Both numbers were right. Neither page said so, so the desk looked broken and
 * the two people who owed a signature were invisible.
 *
 * THE SHAPE OF THE FIX, AND WHY IT IS A PARTITION RATHER THAN A FOURTH LIST.
 * A list that is merely ADDED can go missing again the next time a filter is
 * tightened. A partition cannot: every row of the register lands in exactly
 * one rail, so the four rails sum to the register's own count by construction
 * and `front_desk_rails_add_up_to_the_day_register` fails the moment anything
 * starts dropping people again.
 */
describe('/practice/frontdesk — the rails add up to the day', () => {
  it('front_desk_rails_add_up_to_the_day_register', async () => {
    /*
     * THE ONE THAT MATTERS. `Here now + On a tablet + Finished + Needs a look`
     * IS the number `/practice/day` prints for the same day. Expected sits
     * outside it, because a person who has not come in is not part of the day
     * the register is counting.
     *
     * ASSERTED ON THE RENDERED PAGE and not only on the pure function, because
     * the drift this guards against is a SCREEN quietly showing fewer people
     * than the day holds — which is a thing a component can do all by itself
     * with a filter the helper never sees.
     */
    stubFetch({
      rows: MORNING_QUEUE,
      day: register(MORNING),
      sessions: [session()],
      expected: [BOOKED],
    });
    render(<FrontDeskView practiceId={PRACTICE} />);

    const total = await screen.findByTestId('frontdesk-day-total-number');
    expect(total.textContent).toBe(String(MORNING.length));

    const counted = (group: string) =>
      screen.getByTestId(`frontdesk-group-${group}`).querySelectorAll('[data-testid^="frontdesk-row-"]')
        .length;

    await waitFor(() => expect(counted('finished')).toBe(2));
    const sum = counted('here') + counted('tablet') + counted('needs-a-look')
      + counted('waiting-to-be-seen') + counted('finished');
    expect(sum).toBe(MORNING.length);
    expect(String(sum)).toBe(total.textContent);

    // And the booking that has not walked in is NOT in that sum. Awaited on
    // its own, because `/arrivals/expected` is a THIRD fetch and the finished
    // count above only proves the register landed (wow.md §2 item 6).
    await waitFor(() => expect(counted('expected')).toBe(1));
  });

  it('front_desk_every_arrival_is_in_exactly_one_rail', () => {
    /*
     * THE SAME CLAIM, MADE STRUCTURALLY. The rendered test above proves the
     * numbers agree on one morning; this proves the mechanism cannot do
     * anything else — every arrival appears once across the arrived rails, and
     * no row appears twice.
     *
     * ALL FIVE OF THEM, and the list is spread out rather than summed off
     * `arrivedToday`, so a rail that started dropping people into nowhere
     * fails here rather than being hidden by a total computed from the same
     * arrays.
     */
    const rails = dayRails({ queue: MORNING_QUEUE, day: MORNING });
    const arrived = [
      ...rails.here,
      ...rails.onTablet,
      ...rails.needsALook,
      ...rails.waitingToBeSeen,
      ...rails.finished,
    ];
    expect(arrived).toHaveLength(MORNING.length);
    expect(rails.arrivedToday).toBe(MORNING.length);
    expect(new Set(arrived.map((r) => r.key)).size).toBe(MORNING.length);
    // Nobody on the queue is left over on a morning where everybody came in.
    expect(rails.notArrived).toHaveLength(0);
  });

  it('front_desk_a_corrected_patient_is_counted_once_not_twice', () => {
    /*
     * THE FOUR "SUPERSEDED" ROWS OF CARL'S TABLE. The arrival names the
     * agreement drafted when the patient walked in; a correction replaced it,
     * and the register already walked the chain forward
     * (`newestAgreementInChain`) while the queue only ever carries the newest
     * (`readPushableRows` excludes anything replaced). So the two meet on ONE
     * id and Kit is one person here, under their own name, rather than an
     * anomaly plus a stranger's queue row.
     */
    const rails = dayRails({ queue: [CORRECTED_ROW], day: [CORRECTED] });
    expect(rails.here.map((r) => r.name)).toEqual(['Kit Corrected']);
    expect(rails.needsALook).toHaveLength(0);
    expect(rails.notArrived).toHaveLength(0);
    expect(rails.arrivedToday).toBe(1);
  });

  it('front_desk_needs_a_look_names_whoever_owes_a_signature_and_has_nothing_open', async () => {
    /*
     * THE WORST STATE THIS DESK CAN HOLD, MADE VISIBLE. Morgan came in, has not
     * signed, and every attempt to capture their signature has been cancelled
     * or has run out — so the queue drops them and, before this, no screen
     * named them at all.
     *
     * AND THE RAIL SAYS WHAT IT MEANS. Hard rule 8: nobody was held up, they
     * were seen as usual, and it is the PAPERWORK that has to be caught up.
     */
    stubFetch({ rows: MORNING_QUEUE, day: register(MORNING), sessions: [session()] });
    render(<FrontDeskView practiceId={PRACTICE} />);

    const group = await screen.findByTestId('frontdesk-group-needs-a-look');
    await waitFor(() =>
      expect(within(group).getByTestId(`frontdesk-row-${UNACCOUNTED.arrivalId}`).textContent).toContain(
        'Morgan Overlooked',
      ),
    );
    expect(screen.getByTestId('frontdesk-why-needs-a-look').textContent).toBe(
      strings.frontdesk.rail.needsALookWhy,
    );

    /*
     * AND IT IS NOT A CONTROL. There is no queue row behind it, so there is
     * nothing for the panel to be about; a button here would be a dead end a
     * first-day starter could not get back out of. The rail is a place to look
     * (§12.2).
     */
    expect(within(group).queryAllByRole('button')).toHaveLength(0);
  });

  it('front_desk_a_visit_with_nothing_to_sign_is_finished_and_never_an_anomaly', () => {
    /*
     * "Not yet" about a patient who came in for a blood test would be a
     * PERMANENT false alarm, and a rail people learn to ignore is the same as
     * no rail. The same reasoning `signedLabel` applies on `/practice/day`.
     */
    const rails = dayRails({ queue: [], day: [NOTHING_TO_SIGN, SIGNED, UNACCOUNTED] });
    expect(rails.finished.map((r) => r.name)).toEqual(['Frankie Bloods', 'Dana Signed']);
    expect(rails.needsALook.map((r) => r.name)).toEqual(['Morgan Overlooked']);
  });

  it('front_desk_work_with_no_arrival_recorded_today_is_shown_and_left_out_of_the_total', () => {
    /*
     * A CORRECTION MADE AFTER MIDNIGHT ON YESTERDAY'S VISIT is on today's desk
     * and in no register for today. It must not vanish — it is work, and every
     * patient has to be seen — and it must not be counted, or the total would
     * stop being the register's own number and the proof would be a
     * coincidence.
     */
    const rails = dayRails({ queue: [HERE, CORRECTED_ROW], day: [HERE_ARRIVAL] });
    expect(rails.here.map((r) => r.name)).toEqual(['Jamie Sampleton']);
    expect(rails.notArrived.map((r) => r.name)).toEqual(['Kit Corrected']);
    expect(rails.arrivedToday).toBe(1);
  });

  it('front_desk_an_agreement_offered_instead_still_belongs_to_its_arrival', () => {
    /*
     * `offerEpisodicInstead` creates a NEW agreement that does NOT replace the
     * one it stands in for — it could not, they are different instruments with
     * different evidence — so the arrival and the queue row share no agreement
     * id. Matching what is left over BY PERSON puts them back together;
     * without it this one visit would be counted twice, once as an anomaly and
     * once as work.
     */
    const offered = row({
      agreementId: 'agreement-offered-instead',
      patientId: UNACCOUNTED.patientId as string,
      patientName: UNACCOUNTED.patientName as string,
    });
    const rails = dayRails({ queue: [offered], day: [UNACCOUNTED] });
    expect(rails.here.map((r) => r.name)).toEqual(['Morgan Overlooked']);
    expect(rails.needsALook).toHaveLength(0);
    expect(rails.notArrived).toHaveLength(0);
    expect(rails.arrivedToday).toBe(1);
  });

  it('front_desk_without_the_day_register_still_shows_everybody_on_the_queue', async () => {
    /*
     * HARD RULE 8 (REQ-REC-04). A read that failed slows the evidence and never
     * the service: the register is what the four arrived rails are made of, so
     * without it there are two rails and no total — and every person with work
     * open is still on screen and still actionable. An empty desk because one
     * GET did not answer would be the platform holding up the room.
     */
    stubFetch({ rows: [HERE, ON_TABLET], sessions: [session()] });
    render(<FrontDeskView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`frontdesk-row-${HERE.agreementId}`)).toBeTruthy());
    expect(screen.getByTestId(`frontdesk-row-${ON_TABLET.agreementId}`)).toBeTruthy();
    expect(screen.queryByTestId('frontdesk-day-total')).toBeNull();
    expect(screen.queryByTestId('frontdesk-group-needs-a-look')).toBeNull();
  });

  it('front_desk_the_count_draws_the_number_apart_from_the_word', async () => {
    /*
     * CARL, ON THE GROUP HEADINGS: *"Make the font bold and a diff colour for
     * the number - so it stands out"*. The digit is its own element so it can
     * carry the weight and the accent; the whole count still reads as one
     * sentence, and the spoken version beside it still names its group, because
     * "3" announced on its own tells nobody anything.
     *
     * COLOUR IS NEVER THE ONLY SIGNAL (WCAG 2.2 AA 1.4.1) — the number is bold
     * and a size larger too, and `--accent` on `--surface` is 8.6:1.
     */
    stubFetch({ rows: MORNING_QUEUE, day: register(MORNING), sessions: [session()] });
    render(<FrontDeskView practiceId={PRACTICE} />);

    const count = await screen.findByTestId('frontdesk-count-here');
    await waitFor(() => expect(count.textContent).toBe(strings.frontdesk.rail.count(2)));
    const number = count.querySelector('span');
    expect(number?.textContent).toBe('2');
    expect(number?.className).toMatch(/countNumber/);
  });
});

// ---------------------------------------------------------------------------

/**
 * WHAT THE RAIL SAYS ABOUT EACH PERSON, AND IN WHAT ORDER (Carl, 12 September
 * 2026, on the rails once they were live).
 *
 * Five notes, all about the same column: sort "Here now" the way people will
 * be seen; show the number on the card in their hand; give a way to see
 * everybody at once; name the tablet somebody has; and put "Finished" last,
 * because it is the one rail nobody has to act on.
 */
describe('/practice/frontdesk — what the rail says, and in what order', () => {
  it('front_desk_here_now_is_in_the_order_people_will_be_seen', async () => {
    /*
     * Carl: *"always sort Here Now in seq of being seen."*
     *
     * WHICH IS ARRIVAL ORDER, AND IT IS THE SERVER'S ANSWER. `readPushableRows`
     * walks each agreement back through `supersedesAgreementId` to the arrival
     * that started it and sorts on that, so a corrected card keeps its place
     * (the fix of 11 September 2026); the day register is `arrivedAt asc` for
     * the same reason. NOTHING ON THIS PAGE MAY RE-SORT IT — which is what
     * this asserts, by handing it a register and a queue whose orders differ
     * and requiring the register's.
     *
     * THE REGISTER WINS BECAUSE IT IS ARRIVAL ORDER OUTRIGHT, where the queue
     * is arrival order through a chain; on a well-behaved day the two agree,
     * and where they cannot the earlier arrival is the person who has waited
     * longest.
     */
    stubFetch({
      // Deliberately NOT the register's order — the page must ignore this one.
      rows: [CORRECTED_ROW, HERE],
      day: register([HERE_ARRIVAL, CORRECTED]),
    });
    render(<FrontDeskView practiceId={PRACTICE} />);

    const group = await screen.findByTestId('frontdesk-group-here');
    await waitFor(() =>
      expect(group.querySelectorAll('[data-testid^="frontdesk-row-"]')).toHaveLength(2),
    );
    expect(
      [...group.querySelectorAll('[data-testid^="frontdesk-row-"]')].map((n) =>
        n.getAttribute('data-testid'),
      ),
    ).toEqual([`frontdesk-row-${HERE.agreementId}`, `frontdesk-row-${CORRECTED_ROW.agreementId}`]);

    // And exactly one row is marked next: the top of the list, said out loud.
    expect(group.querySelectorAll('[data-testid^="frontdesk-next-"]')).toHaveLength(1);
    expect(screen.getByTestId(`frontdesk-next-${HERE.agreementId}`)).toBeTruthy();
  });

  it('front_desk_shows_the_number_on_the_card_in_the_patients_hand', async () => {
    /*
     * Carl: *"Show the practice-queueid - the card with the number or from the
     * PMS or the Q-id AoB allocated."* QUEUE-TICKETS.md §4.2 puts it as the
     * LEADING element of the row, because "call number twelve" is the job.
     *
     * IT IS NOT AN IDENTITY IDENTIFIER (hard rule 1, REQ-VER-02) and nothing on
     * this page treats it as one: it is not searched on, not typed into a
     * verification, and it is not the running order either (§5a) — number 14
     * called before number 9 is an ordinary morning, and nothing here sorts on
     * it.
     */
    const ticketed = row({ queueTicket: 'A12' });
    stubFetch({ rows: [ticketed], day: register([HERE_ARRIVAL]) });
    render(<FrontDeskView practiceId={PRACTICE} />);

    const badge = await screen.findByTestId(`frontdesk-ticket-${ticketed.agreementId}`);
    expect(badge.textContent).toContain('A12');
    // Spoken with its word, because a stray digit beside a name says nothing.
    expect(badge.textContent).toContain(strings.frontdesk.rail.ticket('A12'));

    // And it leads the row, before the name.
    const rowNode = screen.getByTestId(`frontdesk-row-${ticketed.agreementId}`);
    const order = [...rowNode.querySelectorAll('span')].map((n) => n.className);
    expect(order.findIndex((c) => /ticket/.test(c))).toBeLessThan(
      order.findIndex((c) => /name/.test(c)),
    );
  });

  it('queue_tickets_are_invisible_when_the_practice_does_not_use_them', async () => {
    /*
     * QUEUE-TICKETS.md §4: a practice setting, default OFF, and *"when off, no
     * field appears anywhere"*. No ticket is allocated at such a practice, so
     * the row carries null and the rail draws nothing — the absence of the
     * number IS the switch, rather than a second flag the page has to read.
     */
    stubFetch({ rows: [HERE], day: register([HERE_ARRIVAL]) });
    render(<FrontDeskView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`frontdesk-row-${HERE.agreementId}`)).toBeTruthy());
    expect(screen.queryByTestId(`frontdesk-ticket-${HERE.agreementId}`)).toBeNull();
  });

  it('front_desk_offers_a_way_to_see_everyone_here_at_once', async () => {
    /*
     * Carl: *"provide a button to go look at all patients here now (like we
     * have in section [1] of /tablet page)."* That section is the tablet
     * desk's whole list of everybody waiting today, so this points at it
     * rather than growing a second everybody-at-once list of its own (§7).
     *
     * IT NAVIGATES AND IT DOES NOT ACT, which is the rail's own rule (§12.3),
     * and it is not about a patient, so §13 is untouched.
     */
    stubFetch({ rows: [HERE] });
    render(<FrontDeskView practiceId={PRACTICE} />);

    const link = await screen.findByTestId('frontdesk-see-everyone');
    expect(link.getAttribute('href')).toBe('/practice/tablet');
    expect(link.textContent).toBe(strings.frontdesk.rail.seeEveryone);
    // It lives inside "Here now", the group it is about.
    expect(within(screen.getByTestId('frontdesk-group-here')).getByTestId('frontdesk-see-everyone'))
      .toBeTruthy();
  });

  it('front_desk_names_the_tablet_a_patient_has', async () => {
    /*
     * Carl: the tablet's name on the "On a tablet" rows, in a small font. The
     * practice names its own devices and the label is already on the row data,
     * so it is printed EXACTLY as they wrote it with nothing added around it —
     * a sentence built around the label produces "has the Blue tablet tablet".
     */
    stubFetch({
      rows: [ON_TABLET],
      day: register([TABLET_ARRIVAL]),
      sessions: [session()],
      devices: [TABLET],
    });
    render(<FrontDeskView practiceId={PRACTICE} />);

    const note = await screen.findByTestId(`frontdesk-device-${ON_TABLET.agreementId}`);
    expect(note.textContent).toBe(TABLET.label);
  });

  it('front_desk_puts_finished_below_needs_a_look', async () => {
    /*
     * Carl: *"Move Finished below Needs a look."* Finished is the one arrived
     * rail nobody has to act on, so it goes last of them; the anomaly sits
     * directly under the work, where somebody scanning the column reaches it
     * before the people they have nothing left to do for.
     *
     * ASSERTED ON DOCUMENT ORDER, not on a style, because that is what a
     * screen reader and a keyboard follow too.
     */
    stubFetch({ rows: MORNING_QUEUE, day: register(MORNING), sessions: [session()] });
    render(<FrontDeskView practiceId={PRACTICE} />);

    await screen.findByTestId('frontdesk-group-finished');
    const groups = [...screen.getByTestId('frontdesk-rail').querySelectorAll('[data-testid^="frontdesk-group-"]')]
      .map((node) => node.getAttribute('data-testid'));
    /*
     * AND "WAITING TO BE SEEN" BETWEEN THEM (D-2026-09-12-20): nothing is
     * wrong with anybody on it and there is nothing for the desk to do, so it
     * is neither the anomaly above it nor the finished below.
     */
    expect(groups).toEqual([
      'frontdesk-group-here',
      'frontdesk-group-tablet',
      'frontdesk-group-needs-a-look',
      'frontdesk-group-waiting-to-be-seen',
      'frontdesk-group-finished',
      'frontdesk-group-expected',
    ]);
  });

  it('front_desk_gives_each_rail_its_own_colour', async () => {
    /*
     * Carl: *"Put colour on the list heading and the number. Reason: I want my
     * eye to be drawn to each list."*
     *
     * A PLACE, NOT A SEVERITY. The reason decides the design: he is LOCATING
     * the lists, not ranking them, so each rail carries its own tone and
     * "Here now" carries none — uncoloured `--ink` is the strongest treatment
     * on the column, because it is the work.
     *
     * COLOUR IS NEVER THE ONLY CARRIER (WCAG 2.2 AA 1.4.1), which is the half
     * of this worth asserting: every heading still says in words what its rail
     * is, and the count is still spoken as a whole sentence beside it.
     */
    stubFetch({ rows: MORNING_QUEUE, day: register(MORNING), sessions: [session()] });
    render(<FrontDeskView practiceId={PRACTICE} />);

    await screen.findByTestId('frontdesk-group-finished');
    const toneOf = (group: string) => screen.getByTestId(`frontdesk-group-${group}`).className;
    expect(toneOf('here')).not.toMatch(/tone/);
    expect(toneOf('tablet')).toMatch(/toneOk/);
    expect(toneOf('needs-a-look')).toMatch(/toneWarn/);
    expect(toneOf('finished')).toMatch(/toneInfo/);
    expect(toneOf('expected')).toMatch(/toneQuiet/);

    // The words still carry it, so nothing here depends on seeing a colour.
    for (const [group, title] of [
      ['here', strings.frontdesk.rail.hereNow],
      ['tablet', strings.frontdesk.rail.onATablet],
      ['needs-a-look', strings.frontdesk.rail.needsALook],
      ['finished', strings.frontdesk.rail.finished],
      ['expected', strings.frontdesk.rail.expected],
    ] as const) {
      expect(within(screen.getByTestId(`frontdesk-group-${group}`)).getByRole('heading').textContent)
        .toBe(title);
    }
  });

  it('front_desk_shows_work_with_no_arrival_recorded_today', async () => {
    /*
     * A CORRECTION MADE AFTER MIDNIGHT ON YESTERDAY'S VISIT is on today's desk
     * and in no register for today. Every patient has to be seen, so it is
     * drawn — with the sentence saying why it is there and that it is not part
     * of the number above — and the group is absent altogether on a day where
     * everybody came in, because a permanently empty box saying so would be
     * noise on a first shift.
     */
    stubFetch({ rows: [HERE, CORRECTED_ROW], day: register([HERE_ARRIVAL]) });
    render(<FrontDeskView practiceId={PRACTICE} />);

    const group = await screen.findByTestId('frontdesk-group-not-arrived');
    expect(within(group).getByTestId(`frontdesk-row-${CORRECTED_ROW.agreementId}`).textContent)
      .toContain('Kit Corrected');
    expect(screen.getByTestId('frontdesk-why-not-arrived').textContent)
      .toBe(strings.frontdesk.rail.notArrivedWhy);
    // It is still work, so it can still be chosen.
    expect(within(group).queryAllByRole('button')).toHaveLength(1);
    // And it is outside the total, which counts only the register's own rows.
    expect(screen.getByTestId('frontdesk-day-total-number').textContent).toBe('1');
  });

  it('front_desk_a_visit_with_nothing_to_sign_never_takes_another_visits_work', () => {
    /*
     * CAUGHT IN REVIEW, 12 September 2026, before it could happen to anybody.
     *
     * The by-person fallback exists for `offerEpisodicInstead`, whose new
     * agreement does not replace the one it stands in for. But a patient can
     * hold TWO arrivals on one day, and if the first of them needed no
     * agreement at all — a blood test — an unguarded fallback would let that
     * finished visit claim the open queue row belonging to the second. The two
     * would then be reported the wrong way round: the blood test as work, and
     * the visit that really owes a signature as an anomaly.
     */
    const bloods = arrival({
      arrivalId: 'arrival-bloods-first',
      patientId: HERE.patientId,
      patientName: HERE.patientName,
      agreementId: null,
      agreementStatus: null,
      arrivedAt: '2026-09-12T08:00:00.000Z',
    });
    const later = arrival({
      arrivalId: 'arrival-second-visit',
      patientId: HERE.patientId,
      patientName: HERE.patientName,
      // A different agreement id: the queue row is the one offered instead.
      agreementId: 'agreement-first-attempt',
      arrivedAt: '2026-09-12T11:00:00.000Z',
    });
    const rails = dayRails({ queue: [HERE], day: [bloods, later] });

    expect(rails.finished.map((r) => r.key)).toEqual(['arrival-bloods-first']);
    expect(rails.here.map((r) => r.key)).toEqual([HERE.agreementId]);
    expect(rails.needsALook).toHaveLength(0);
    expect(rails.arrivedToday).toBe(2);
  });
});

// ---------------------------------------------------------------------------

/**
 * ONE PERSON, THE SAME TWO IDS, ON BOTH DESKS (Carl, 12 September 2026:
 * *"patientid is diff on /tablet and /frontdesk"*, then *"ok. In that case
 * show both ids."*).
 *
 * NEITHER PAGE WAS WRONG, WHICH IS WHY IT LOOKED LIKE A BUG. The front desk
 * printed the PRACTICE's own number for the person — the handle reception
 * reads out and types into their own software. The tablet desk printed the id
 * this platform minted, which is what a support ticket needs because a
 * practice number is not unique across practices. A receptionist moving
 * between the two in the same minute saw two identifiers for one patient.
 *
 * SO BOTH, IN ONE ORDER, FROM ONE COMPONENT. This is wow.md §10 rule 4 —
 * *"reuse is proved by a test where it matters"* — rendered for real on both
 * pages rather than asserted about a helper neither of them has to use.
 */
describe('the two desks name a patient the same way', () => {
  it('the_tablet_desk_and_the_front_desk_name_a_patient_the_same_way', async () => {
    const NAMED = row({ patientRecordNumber: 'XL-004821' });

    stubFetch({ rows: [NAMED] });
    const desk = render(<FrontDeskView practiceId={PRACTICE} />);
    await choose(NAMED.agreementId, NAMED.patientName);
    const onFrontDesk = screen.getByTestId('frontdesk-chosen-record-number');
    const frontDeskText = onFrontDesk.textContent ?? '';
    desk.unmount();

    stubFetch({ rows: [NAMED] });
    render(<TabletView practiceId={PRACTICE} />);
    const onTabletDesk = await screen.findByTestId(`row-patient-id-${NAMED.agreementId}`);

    /*
     * THE SAME TWO FACTS, IN THE SAME ORDER, IN THE SAME WORDS. Compared as
     * text rather than by counting elements, because what Carl saw was the
     * text.
     */
    expect(frontDeskText).toBe(onTabletDesk.textContent);
    expect(frontDeskText).toContain(strings.recordId.practiceNumber('XL-004821'));
    expect(frontDeskText).toContain(strings.recordId.patient);
    expect(frontDeskText).toContain(NAMED.patientId);
    // The practice's number comes first: it is the one a person says out loud.
    expect(frontDeskText.indexOf('XL-004821')).toBeLessThan(frontDeskText.indexOf(NAMED.patientId));

    // AND NEITHER IS A MEDICARE NUMBER. There is no column for one anywhere.
    expect(document.body.textContent).not.toMatch(/medicare/i);
  });

  it('a_patient_with_no_practice_number_says_so_on_both_desks', async () => {
    /*
     * NULL IS ORDINARY, NOT A FAULT. A patient can reach the platform by a
     * route that never carried the practice's number, and a blank line under a
     * name reads as a page that failed to load. Our own id always exists, so
     * it needs no twin — which is the asymmetry worth pinning.
     */
    const UNNUMBERED = row({ patientRecordNumber: null });

    stubFetch({ rows: [UNNUMBERED] });
    const desk = render(<FrontDeskView practiceId={PRACTICE} />);
    await choose(UNNUMBERED.agreementId, UNNUMBERED.patientName);
    const frontDeskText = screen.getByTestId('frontdesk-chosen-record-number').textContent ?? '';
    desk.unmount();

    stubFetch({ rows: [UNNUMBERED] });
    render(<TabletView practiceId={PRACTICE} />);
    const onTabletDesk = await screen.findByTestId(`row-patient-id-${UNNUMBERED.agreementId}`);

    expect(frontDeskText).toContain(strings.recordId.practiceNumberUnknown);
    expect(frontDeskText).toBe(onTabletDesk.textContent);
    expect(frontDeskText).toContain(UNNUMBERED.patientId);
  });
});

// ---------------------------------------------------------------------------

/**
 * "FINISHED" MEANS THE VISIT IS OVER, NOT THAT THE PAPERWORK IS DONE
 * (D-2026-09-12-20; `VISIT-CHECKLIST.md` §3a; Carl, 12 September 2026, with
 * the two pages side by side: *"on /frontdesk the patient goes to 'Finished
 * list' yet on /waiting the dr has not seen the patient as yet. Hence, we need
 * a step 'Consultation completed'."*).
 *
 * THE WORD WAS DOING THE LYING. Signing happens in the waiting room, BEFORE
 * the service, so the desk announced that a patient was finished while the
 * practitioner had not yet called them in.
 *
 * AND THE RULE IS CARL'S GENERAL ONE, not a two-clause boolean: *"Only when
 * all services are completed or some are cancelled does the client go to
 * Finished."* Today the list is the signature and the visit, so it reduces to
 * the narrow rule — but it is written over the list, so a practice's own items
 * change what Finished means without this condition being edited.
 */
describe('/practice/frontdesk — a patient is finished when their service list is', () => {
  /** No devices read in these: the checklist's device label is not what is under test. */
  const noDevice = () => null;

  /** The register row for somebody who signed on the way in. */
  const signedNotSeen = arrival({
    arrivalId: 'arrival-signed-waiting',
    patientId: '66666666-6666-4000-8000-00000000000a',
    patientName: 'Rowan Waiting',
    agreementId: 'agreement-signed-waiting',
    agreementStatus: 'stored',
    agreementSigned: true,
    visitState: 'pending',
  });

  it('a_signed_agreement_alone_does_not_finish_a_visit', () => {
    /*
     * THE BUG, PINNED. Rowan signed and the practitioner has not called them
     * in. Before this they were reported as Finished; now they are waiting to
     * be seen — which is neither an anomaly (nothing is wrong) nor the desk's
     * work (there is nothing for reception to do).
     */
    const rails = dayRails({ queue: [], day: [signedNotSeen] });
    expect(rails.finished).toHaveLength(0);
    expect(rails.waitingToBeSeen.map((r) => r.name)).toEqual(['Rowan Waiting']);
    expect(rails.needsALook).toHaveLength(0);
    // And the day still adds up, which is what §14 exists for.
    expect(rails.arrivedToday).toBe(1);
  });

  it('finished_needs_the_paperwork_done_and_the_visit_complete', () => {
    /*
     * BOTH HALVES, AND EACH ALONE. The fourth case — nothing to sign and the
     * visit complete — is the phlebotomist's patient, who signs nothing and is
     * finished the moment they have been seen.
     */
    const seen = { ...signedNotSeen, visitState: 'completed' };
    const notSignedNotSeen = { ...signedNotSeen, agreementSigned: false, agreementStatus: 'awaiting_signature' };
    const notSignedButSeen = { ...notSignedNotSeen, visitState: 'completed' };
    const nothingToSignAndSeen = {
      ...signedNotSeen,
      agreementId: null,
      agreementStatus: null,
      agreementSigned: false,
      visitState: 'completed',
    };

    expect(dayRails({ queue: [], day: [seen] }).finished).toHaveLength(1);
    expect(dayRails({ queue: [], day: [notSignedNotSeen] }).finished).toHaveLength(0);
    expect(dayRails({ queue: [], day: [notSignedButSeen] }).finished).toHaveLength(0);
    expect(dayRails({ queue: [], day: [nothingToSignAndSeen] }).finished).toHaveLength(1);

    /*
     * AN UNSIGNED AGREEMENT WITH NOTHING OPEN IS STILL THE ANOMALY, whether or
     * not the patient has been seen — they owe a signature and no screen but
     * this one names them.
     */
    expect(dayRails({ queue: [], day: [notSignedButSeen] }).needsALook).toHaveLength(1);
  });

  it('finished_is_every_service_resolved_and_not_a_pair_of_booleans', () => {
    /*
     * `VISIT-CHECKLIST.md` §3a, written as the general rule so a practice's own
     * items change what Finished means without this being edited. `cancelled`
     * resolves an item exactly as `done` and `not_needed` do — three different
     * facts, one consequence — and it is in the type now precisely so nobody
     * has to guess later what "resolved" was supposed to include.
     */
    expect(everyServiceResolved([])).toBe(true);
    expect(everyServiceResolved([{ state: 'done' }, { state: 'not_needed' }])).toBe(true);
    expect(everyServiceResolved([{ state: 'done' }, { state: 'cancelled' }])).toBe(true);
    expect(everyServiceResolved([{ state: 'done' }, { state: 'outstanding' }])).toBe(false);
  });

  it('the_visit_checklist_carries_the_consultation_between_signing_and_afterwards', () => {
    /*
     * WHERE CARL DREW IT on his screenshot: after "signed on a tablet" and
     * before anything about billing afterwards. The order is the morning's.
     *
     * AND IT READS THE STATE RATHER THAN MINTING ONE. `completed` is the
     * domain's service-rendered signal, so the row is `done` for it and
     * outstanding for everything before it.
     */
    const waiting = visitChecklist([row({ visitState: 'pending' })], [], noDevice);
    expect(waiting.map((r) => r.key)).toEqual(['needed', 'made', 'signed', 'consultation', 'after']);
    const step = waiting.find((r) => r.key === 'consultation');
    expect(step?.state).toBe('outstanding');
    expect(step?.visitState).toBe('pending');

    const withThem = visitChecklist([row({ visitState: 'with_patient_now' })], [], noDevice);
    expect(withThem.find((r) => r.key === 'consultation')?.state).toBe('outstanding');

    const done = visitChecklist([row({ visitState: 'completed' })], [], noDevice);
    expect(done.find((r) => r.key === 'consultation')?.state).toBe('done');

    // No arrival behind the chain: there is no visit for this to be about.
    const noVisit = visitChecklist([row({ visitState: null })], [], noDevice);
    expect(noVisit.find((r) => r.key === 'consultation')?.state).toBe('not_needed');
  });

  it('the_front_desk_and_the_practitioner_queue_never_disagree_about_who_has_been_seen', async () => {
    /*
     * ONE STATE, ONE WORD, TWO SCREENS. The front desk does not compute
     * whether somebody has been seen — it reads the state the practitioner set
     * — and it prints it with the practitioner queue's OWN label function over
     * the versioned content's OWN keys. Two places disagreeing about whether a
     * patient has been seen would be worse than the bug this fixes.
     *
     * ASSERTED OVER EVERY KEY IN THE CONTENT FILE, not over the three this
     * build happened to think of: a fifth state added to `visit-states.json`
     * fails this test rather than quietly rendering its key on one page and a
     * word on the other.
     */
    for (const option of VISIT_STATE_OPTIONS) {
      const step = visitChecklist([row({ visitState: option.key })], [], noDevice)
        .find((r) => r.key === 'consultation');
      expect(step?.visitState).toBe(option.key);
      expect(strings.practitionerQueue.waiting.visitState[option.key]).toBeTruthy();
      // Done exactly for the one option the domain calls the service-rendered
      // signal — never for a literal this file chose.
      expect(step?.state).toBe(option.isTheServiceRenderedSignal ? 'done' : 'outstanding');
    }

    // And on the page, in the practitioner's words.
    stubFetch({ rows: [row({ visitState: 'with_patient_now' })] });
    render(<FrontDeskView practiceId={PRACTICE} />);
    await choose(HERE.agreementId, HERE.patientName);
    expect(screen.getByTestId('frontdesk-checklist').textContent)
      .toContain(strings.practitionerQueue.waiting.visitState.with_patient_now);
  });
});
