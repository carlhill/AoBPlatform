/**
 * THE PRACTITIONER'S PAGES AT A PRACTICE, RENDERED
 * (PRACTITIONER-QUEUE-PAGE.md §7).
 *
 * IT EXISTS BECAUSE THESE PAGES CANNOT BE SEEN WITHOUT A PASSKEY. The console
 * signs in through Keycloak with WebAuthn (hard rule 15 — there is no password
 * path and never will be), so nobody can open them in a headless check.
 * Without this, a provider's waiting list would first be rendered in front of a
 * practice, mid-surgery.
 *
 * WHAT IT PINS, and every one is a rule from §2, §3 or §4 rather than a
 * cosmetic preference:
 *
 *  - THE PAGE NEVER GATES A CONSULTATION, AND SAYS SO. Hard rule 8 is on the
 *    screen in as many words, not left to be inferred.
 *  - NO CLINICAL DETAIL, EVER. The fixture carries a reason, a note, a triage
 *    category and a duration on the wire; none of them may reach the screen.
 *  - NOTHING ON IT ACTS. No control that sends, recalls, corrects or confirms,
 *    and no request but the GET it reads with.
 *  - THE THREE WORDS ARE THE THREE WORDS, and "Done" is never dressed up as
 *    approved, certified or accredited (hard rule 12).
 *  - RECEPTION SEES EVERY PRACTITIONER'S LIST, GROUPED; a practitioner sees
 *    one list with no heading naming them to themselves.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { WaitingList } from '@aobplatform/domain';
import { WaitingView, arrivedAtLabel, paperworkLabel } from './waiting/WaitingView';
import { PractitionerLandingView, livePractices } from './PractitionerLandingView';
import { strings } from '../../strings';

const PRACTICE = 'practice-1';

const MINE: WaitingList = {
  scope: 'mine',
  groups: [
    {
      affiliationId: 'affiliation-chen',
      practitionerName: 'Dr Sample Chen',
      rows: [
        {
          arrivalId: 'arrival-1',
          patientName: 'Jamie Sampleton',
          waitingSince: '2026-09-12T08:55:00.000Z',
          paperwork: 'done',
          agreementProviderName: null,
        },
        {
          arrivalId: 'arrival-2',
          patientName: 'Casey Walkin',
          waitingSince: '2026-09-12T09:10:00.000Z',
          paperwork: 'not_yet',
          agreementProviderName: null,
        },
      ],
    },
  ],
};

const GROUPED: WaitingList = {
  scope: 'practice',
  groups: [
    MINE.groups[0]!,
    {
      affiliationId: 'affiliation-patel',
      practitionerName: 'Nurse Sample Patel',
      rows: [
        {
          arrivalId: 'arrival-3',
          patientName: 'Alex Nursevisit',
          waitingSince: '2026-09-12T09:20:00.000Z',
          paperwork: 'with_the_patient_now',
          // §6a — the agreement is under the supervising provider.
          agreementProviderName: 'Dr Sample Chen',
        },
      ],
    },
    {
      affiliationId: 'affiliation-ray',
      practitionerName: 'Sample Ray',
      rows: [
        {
          arrivalId: 'arrival-4',
          patientName: 'Sam Bloodsonly',
          waitingSince: '2026-09-12T09:25:00.000Z',
          paperwork: 'nothing_to_sign',
          agreementProviderName: null,
        },
      ],
    },
  ],
};

const calls: Array<{ url: string; method: string }> = [];

function stubFetch(waiting: unknown, me: unknown = null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      const payload = url.includes('/practitioner/me') ? me : waiting;
      return { ok: true, status: 200, json: async () => payload } as unknown as Response;
    }),
  );
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/practice/practitioner/waiting',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../auth', () => ({
  currentSession: () => ({ roles: ['provider'], practitionerId: 'practitioner-1' }),
  apiHeaders: () => ({ 'Content-Type': 'application/json' }),
  silentRestoreUnresolved: () => null,
}));

/*
 * THE PRACTICE QUESTION, ANSWERED IMMEDIATELY. `usePractice` revalidates a
 * stored selection over the network, which is not what any of these tests are
 * about; the page's own rule is that it waits for `checked` before reading, and
 * the mock lets it get on with it.
 */
vi.mock('../usePractice', () => ({
  usePractice: () => ({ practiceId: null, checked: true, scoped: false }),
}));

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

// ---------------------------------------------------------------------------

describe('/practice/practitioner/waiting — who is waiting for me', () => {
  it('the_waiting_list_never_gates_a_consultation', async () => {
    /*
     * §4.1: *"the page should say so in as many words rather than leave it to
     * be inferred (hard rule 8)."* So this asserts the SENTENCE, not merely
     * the absence of a block — an absent statement is exactly what the rule
     * says is not good enough.
     */
    stubFetch(MINE);
    render(<WaitingView />);

    await waitFor(() => expect(screen.getByTestId('waiting-never-blocks')).toBeTruthy());
    const said = screen.getByTestId('waiting-never-blocks').textContent ?? '';
    expect(said).toContain(strings.practitionerQueue.waiting.neverBlocks);
    expect(said).toMatch(/never stops a consultation/i);

    // And nothing on the page phrases the paperwork as a requirement to be met
    // before somebody can be seen.
    const page = document.body.textContent ?? '';
    expect(page).not.toMatch(/cannot be seen|do not see|must not see|before you see them|wait until/i);
  });

  it('the_waiting_list_carries_no_clinical_detail', async () => {
    /*
     * §2: *"it must never carry a reason for the visit, a clinical note, a
     * triage category, a duration, or anything a practice management system
     * would call an appointment status."* The fixture below smuggles all of
     * them onto the wire, so the test is about what the SCREEN does with a
     * server that sends more than it should — not about a type that happens to
     * omit them today.
     */
    const leaky = {
      ...MINE,
      groups: [
        {
          ...MINE.groups[0]!,
          rows: [
            {
              ...MINE.groups[0]!.rows[0]!,
              reasonForVisit: 'Chest pain',
              clinicalNote: 'Reviewed last week',
              triage: 'urgent',
              durationMinutes: 30,
              appointmentStatus: 'in_room',
              // A ten-digit identifier value under a deliberately neutral key:
              // the platform's own lint rule forbids naming the Medicare field
              // even in a fixture (REQ-VER-02), and the point of the row is
              // that the page renders NO identifier value whatever it is called.
              identifierValue: '2123456701',
              dateOfBirth: '1970-01-01',
            },
          ],
        },
      ],
    };
    stubFetch(leaky);
    render(<WaitingView />);

    await waitFor(() => expect(screen.getByTestId('waiting-row-arrival-1')).toBeTruthy());

    const page = document.body.textContent ?? '';
    for (const leak of ['Chest pain', 'Reviewed last week', 'urgent', 'in_room', '30 min']) {
      expect(page).not.toContain(leak);
    }
    // Hard rules 1 and 9: no identifier VALUES, and no date of birth.
    expect(page).not.toContain('2123456701');
    expect(page).not.toMatch(/\d{10}/);
    expect(page).not.toContain('1970-01-01');
  });

  it('the_waiting_list_has_no_control_that_acts_on_an_agreement', async () => {
    /*
     * §3: *"No buttons that act on an agreement... a control they will never
     * legitimately use is a control that will one day be pressed by mistake."*
     * Asserted on the WIRE as well as on the buttons, because the dangerous
     * version of this defect is a link that looks harmless and issues a POST.
     */
    stubFetch(MINE);
    render(<WaitingView />);

    await waitFor(() => expect(screen.getByTestId('waiting-row-arrival-1')).toBeTruthy());

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.method).toBe('GET');

    for (const control of document.querySelectorAll('main button, main a')) {
      expect(control.textContent ?? '').not.toMatch(/send|recall|correct|confirm|sign|save|ask reception/i);
    }
  });

  it('paperwork_reads_done_only_when_it_is_signed_and_stored', async () => {
    stubFetch(MINE);
    render(<WaitingView />);

    await waitFor(() => expect(screen.getByTestId('waiting-paperwork-arrival-1')).toBeTruthy());
    expect(screen.getByTestId('waiting-paperwork-arrival-1').textContent).toBe('Done');
    expect(screen.getByTestId('waiting-paperwork-arrival-2').textContent).toBe('Not yet');

    // Hard rule 12: never approved, certified, accredited or
    // government-approved, anywhere in this page's own words.
    const said = JSON.stringify(strings.practitionerQueue, (_key, value) =>
      typeof value === 'function' ? (value as (...args: never[]) => string)('Name' as never) : value,
    ).toLowerCase();
    for (const banned of ['certified', 'approved', 'accredited', 'government-approved']) {
      expect(said).not.toContain(banned);
    }
    // And the domain words: provider and practitioner, never doctor or GP.
    expect(said).not.toMatch(/\bdoctor\b|\bgp\b/);
  });

  it('a_practitioners_own_list_is_not_headed_with_their_own_name', async () => {
    // Their own list is theirs. Printing their name above it is a screen
    // telling somebody who they are.
    stubFetch(MINE);
    render(<WaitingView />);

    await waitFor(() => expect(screen.getByTestId('waiting-row-arrival-1')).toBeTruthy());
    const groups = screen.getByTestId('waiting-groups');
    expect(within(groups).queryByRole('heading', { name: 'Dr Sample Chen' })).toBeNull();
  });

  it('reception_sees_every_practitioners_list_grouped', async () => {
    /*
     * Carl, 12 Sep 2026, widening §3: knowing who is waiting for whom is the
     * front desk's job, so for them the grouping is the whole point. The MODE
     * comes from the server's own `scope`; the page never chooses it.
     */
    stubFetch(GROUPED);
    render(<WaitingView />);

    await waitFor(() => expect(screen.getByTestId('waiting-group-affiliation-patel')).toBeTruthy());

    for (const name of ['Dr Sample Chen', 'Nurse Sample Patel', 'Sample Ray']) {
      expect(screen.getByRole('heading', { name })).toBeTruthy();
    }
    expect(within(screen.getByTestId('waiting-group-affiliation-patel')).getByText('Alex Nursevisit')).toBeTruthy();
  });

  it('a_nurses_page_names_whose_agreement_it_is', async () => {
    /*
     * §6a: *"'Dr Chen's agreement — done' is honest; 'your agreement' would
     * not be."* And only where it differs — the GP's own rows say nothing,
     * because repeating their own name to them is noise.
     */
    stubFetch(GROUPED);
    render(<WaitingView />);

    await waitFor(() => expect(screen.getByTestId('waiting-under-arrival-3')).toBeTruthy());
    expect(screen.getByTestId('waiting-under-arrival-3').textContent).toBe(
      strings.practitionerQueue.waiting.agreementUnder('Dr Sample Chen'),
    );
    expect(screen.queryByTestId('waiting-under-arrival-1')).toBeNull();
  });

  it('says plainly when nobody is waiting, rather than showing an empty table', async () => {
    stubFetch({ scope: 'mine', groups: [] } satisfies WaitingList);
    render(<WaitingView />);
    await waitFor(() => expect(screen.getByTestId('waiting-nobody')).toBeTruthy());
    expect(screen.getByTestId('waiting-nobody').textContent).toBe(
      strings.practitionerQueue.waiting.nobodyWaiting,
    );
  });
});

describe('the waiting list’s own rules, without a screen', () => {
  it('shows an arrival time and never a countdown', () => {
    // §3: the arrival time, not a countdown and not a target. A page that
    // counts up invites a threshold, then a colour, then an escalation.
    expect(arrivedAtLabel('2026-09-12T08:55:00.000Z')).toMatch(/^\d{2}:\d{2}$/);
    expect(arrivedAtLabel('2026-09-12T08:55:00.000Z')).not.toMatch(/min|ago|waiting for/i);
    // An unparseable value is shown as it came rather than as "Invalid Date".
    expect(arrivedAtLabel('not-a-time')).toBe('not-a-time');
  });

  it('an_unmapped_paperwork_state_shows_its_code', () => {
    /*
     * CLAUDE.md §7, "shortcuts to the answer": a generic fallback is a defect
     * and an unmapped code shows its code. On this page the alternative is a
     * blank cell, which reads as "there is no paperwork" — the most dangerous
     * thing it could say.
     */
    expect(paperworkLabel('done')).toBe('Done');
    expect(paperworkLabel('with_the_patient_now')).toBe('With the patient now');
    expect(paperworkLabel('not_yet')).toBe('Not yet');
    expect(paperworkLabel('something_added_later')).toBe('something_added_later');
  });
});

describe('/practice/practitioner — the landing page', () => {
  it('names who they are and which practice, and offers their waiting list', async () => {
    stubFetch(null, {
      id: 'practitioner-1',
      givenNames: 'Sample',
      familyName: 'Chen',
      affiliations: [
        { id: 'a1', practiceId: PRACTICE, practiceName: 'Sampletown Medical', status: 'active' },
        { id: 'a2', practiceId: 'gone', practiceName: 'Former Practice', status: 'ended' },
      ],
    });
    render(<PractitionerLandingView />);

    await waitFor(() => expect(screen.getByTestId('practitioner-who')).toBeTruthy());
    const who = screen.getByTestId('practitioner-who').textContent ?? '';
    expect(who).toContain('Sample Chen');
    expect(who).toContain('Sampletown Medical');
    // The practice they have left is not one they are working at.
    expect(who).not.toContain('Former Practice');

    // The practice travels on the link, because this page has already resolved
    // it. The server still checks it against their own affiliations.
    expect(screen.getByTestId('practitioner-to-waiting').getAttribute('href')).toBe(
      `/practice/practitioner/waiting?practice=${PRACTICE}`,
    );
    // And their cross-practice page is named rather than hidden (§1).
    expect(screen.getByTestId('practitioner-to-self').getAttribute('href')).toBe('/practitioner');
  });

  it('offers the choice when they work at more than one practice', async () => {
    /*
     * Ordinary, not an error. The choice is offered with the names in front of
     * them — "choose a practice first" in prose with nowhere to choose is the
     * generic fallback CLAUDE.md §7 calls a defect.
     */
    stubFetch(null, {
      id: 'practitioner-1',
      givenNames: 'Sample',
      familyName: 'Chen',
      affiliations: [
        { id: 'a1', practiceId: 'practice-a', practiceName: 'Sampletown Medical', status: 'active' },
        { id: 'a2', practiceId: 'practice-b', practiceName: 'Otherville Clinic', status: 'ending' },
      ],
    });
    render(<PractitionerLandingView />);

    await waitFor(() => expect(screen.getByTestId('practitioner-practices')).toBeTruthy());
    const links = [...screen.getByTestId('practitioner-practices').querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(links).toEqual([
      '/practice/practitioner/waiting?practice=practice-a',
      '/practice/practitioner/waiting?practice=practice-b',
    ]);
  });

  it('says why there is nothing here when they work nowhere yet', async () => {
    stubFetch(null, { id: 'practitioner-1', givenNames: 'Sample', familyName: 'Chen', affiliations: [] });
    render(<PractitionerLandingView />);
    await waitFor(() => expect(screen.getByTestId('practitioner-no-practice')).toBeTruthy());
    expect(screen.getByTestId('practitioner-no-practice').textContent).toContain(
      strings.practitionerQueue.landing.noPracticeWhy,
    );
  });

  it('counts only the practices they currently work at', () => {
    expect(
      livePractices([
        { id: 'a', practiceId: 'p1', practiceName: 'One', status: 'active' },
        { id: 'b', practiceId: 'p1', practiceName: 'One', status: 'ending' },
        { id: 'c', practiceId: 'p2', practiceName: 'Two', status: 'invited' },
        { id: 'd', practiceId: 'p3', practiceName: 'Three', status: 'ended' },
        { id: 'e', practiceId: null, practiceName: 'Nowhere', status: 'active' },
      ]),
    ).toEqual([{ id: 'p1', name: 'One' }]);
  });
});
