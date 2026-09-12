/**
 * PRACTICE FRONTDESK — THE QUEUE RAIL, RENDERED (FRONT-DESK-PAGE.md §12).
 *
 * IT EXISTS BECAUSE THIS PAGE CANNOT BE SEEN WITHOUT A PASSKEY. The console
 * signs in through Keycloak with WebAuthn (hard rule 15 — there is no password
 * path and never will be), so nobody can open a practice screen in a headless
 * check. Without this, the rail's first render would happen in front of a
 * practice, with a patient at the desk.
 *
 * WHAT IT PINS, and every one of these is a rule from §12.3 rather than a
 * cosmetic preference:
 *
 *  - CHOOSING A NAME NEVER ACTS. No request leaves the page but the three
 *    GETs it reads with, whatever anybody clicks.
 *  - THE RAIL DOES NOT RE-SORT UNDER THE HAND between polls, even when the
 *    server hands back the same people in a different order.
 *  - "EXPECTED" SAYS WHY IT IS EMPTY. It is empty in every practice today —
 *    the appointment feed is behind blocker D-01 — and a blank box would read
 *    as broken.
 *  - THE ROWS CARRY A NAME, A TIME AND NOTHING ELSE. No reason code, no
 *    service, no date of birth, no identifier (hard rules 1 and 9), no amount
 *    (hard rule 4).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ExpectedAppointment } from '@aobplatform/contracts';
import type { DeviceRow } from '@aobplatform/domain';
import { FrontDeskView, stableByFirstSeen, timeLabel } from './FrontDeskView';
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
const row = (over: Record<string, unknown> = {}) => ({
  agreementId: 'agreement-here',
  agreementType: 'episodic_pre',
  status: 'draft',
  patientName: 'Jamie Sampleton',
  patientId: '11111111-1111-4000-8000-000000000001',
  providerName: 'Dr Example Provider',
  providerType: 'general_practitioner',
  appointmentDate: '2026-09-12',
  appointmentTime: '09:00',
  serviceDescription: 'General practitioner attendance',
  serviceDescriptionValid: true,
  serviceDate: null,
  mbsItemNumbers: [] as string[],
  assignorIsPatient: true,
  assignorName: null,
  assignorRelationship: null,
  assignorMobile: null,
  assignorEmail: null,
  particularsLocked: false,
  assignorConfirmedAt: '2026-09-12T08:00:00.000Z',
  pushable: true,
  blockedReason: null,
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

const BOOKED: ExpectedAppointment = {
  appointmentId: 'appointment-1',
  patientId: '44444444-4444-4000-8000-000000000004',
  patientName: 'Alex Booked',
  time: '10:30',
};

const calls: Array<{ url: string; method: string }> = [];

function stubFetch(opts: { rows?: unknown[]; expected?: unknown[]; devices?: DeviceRow[] } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      const payload = url.includes('/arrivals/expected')
        ? (opts.expected ?? [])
        : url.includes('/tablet-sessions/pushable')
          ? (opts.rows ?? [HERE, ON_TABLET])
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
}));

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

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
      expect(control.textContent ?? '').not.toMatch(/send|recall|bring it back|confirm|sign|save/i);
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

  it('front_desk_rail_never_uses_a_domain_word_from_the_banned_list', async () => {
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
  });

  it('front_desk_rail_names_the_tablet_a_patient_is_holding', async () => {
    /*
     * §12.2: "Shows the device name, because 'the blue one' is how the desk
     * talks." On the PANEL, not on the row — the row stays a name and a time.
     */
    stubFetch({ rows: [ON_TABLET] });
    render(<FrontDeskView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`frontdesk-row-${ON_TABLET.agreementId}`)).toBeTruthy());
    expect(screen.getByTestId('frontdesk-group-tablet').textContent).not.toContain(TABLET.label);

    fireEvent.click(screen.getByTestId(`frontdesk-row-${ON_TABLET.agreementId}`));
    await waitFor(() =>
      expect(screen.getByTestId('frontdesk-chosen-what').textContent).toBe(
        strings.frontdesk.panel.onATablet(ON_TABLET.patientName, TABLET.label),
      ),
    );

    // And the page says plainly that the buttons are still to come.
    expect(screen.getByTestId('frontdesk-not-yet').textContent).toContain(strings.frontdesk.panel.notYet);
    expect(screen.getByTestId('frontdesk-to-tablet').getAttribute('href')).toBe('/practice/tablet');
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
});

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
