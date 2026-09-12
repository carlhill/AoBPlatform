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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { VISIT_STATE_OPTIONS, type WaitingList } from '@aobplatform/domain';
import { WaitingView, arrivedAtLabel, paperworkLabel, visitStateLabel } from './waiting/WaitingView';
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
          visitState: 'pending',
        },
        {
          arrivalId: 'arrival-2',
          patientName: 'Casey Walkin',
          waitingSince: '2026-09-12T09:10:00.000Z',
          paperwork: 'not_yet',
          agreementProviderName: null,
          visitState: 'pending',
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
          visitState: 'with_patient_now',
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
          visitState: 'pending',
        },
      ],
    },
  ],
};

const calls: Array<{ url: string; method: string; body?: string }> = [];

/**
 * WHAT THE SERVER SAYS BACK TO ONE PRESS OF THE STATUS CONTROL, and whether it
 * refuses. Set per test; `null` means the default receipt.
 */
let stateReply: { ok?: boolean; body?: unknown } | null = null;

function stubFetch(waiting: unknown, me: unknown = null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? String(init.body) : undefined });
      if (url.includes('/state')) {
        const reply = stateReply ?? {};
        return {
          ok: reply.ok ?? true,
          status: reply.ok === false ? 403 : 200,
          json: async () => reply.body ?? { renderedOutcome: null, reviewTaskId: null },
        } as unknown as Response;
      }
      const payload = url.includes('/practitioner/me') ? me : waiting;
      return { ok: true, status: 200, json: async () => payload } as unknown as Response;
    }),
  );
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/practice/practitioner/waiting',
  useSearchParams: () => new URLSearchParams(),
}));

/*
 * WHO IS READING, AND IT CHANGES BETWEEN TESTS.
 *
 * This page has two audiences and the SHELL's back link now differs between
 * them, so the session cannot be a constant any more. `vi.hoisted` because
 * `vi.mock` is lifted above everything else in the file: the holder has to
 * exist before the factory runs, and the factory only closes over it.
 */
const signedIn = vi.hoisted(() => ({
  session: {
    roles: ['provider'],
    practitionerId: 'practitioner-1',
  } as { roles: string[]; practitionerId?: string; practiceId?: string; consoleRole?: string },
}));

/** A practitioner: a practitioner claim and, deliberately, no practice claim. */
const PRACTITIONER_SESSION = { roles: ['provider'], practitionerId: 'practitioner-1' };
/** Reception, a manager or an administrator: the practice claim is what makes them one. */
const PRACTICE_SESSION = { roles: ['practice_user'], practiceId: PRACTICE, consoleRole: 'admin' };

vi.mock('../../auth', () => ({
  currentSession: () => signedIn.session,
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
  stateReply = null;
  // The practitioner is the default reader; the two header tests say otherwise.
  signedIn.session = { ...PRACTITIONER_SESSION };
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

    // NOTHING IS SENT BY MERELY LOOKING. The status control is the one write on
    // this page and it happens only when somebody chooses; loading the list
    // issues GETs and nothing else.
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.method).toBe('GET');

    for (const control of document.querySelectorAll('main button, main a')) {
      expect(control.textContent ?? '').not.toMatch(/send|recall|correct|confirm|sign|ask reception/i);
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

  it('back_to_today_is_in_the_header_for_practice_staff', async () => {
    /*
     * Carl, 12 Sep 2026, reading this page as reception: *"needs a link back
     * to today"*, and then, when it appeared in the body, *"no back to today
     * link in header"*. IN THE HEADER means the shell's own back control,
     * where "← Back to Your practices" sits on every other page — not a
     * second, page-shaped way back a few pixels below it.
     *
     * The BODY link is gone with it: two ways back is one too many, and the
     * one in the body is the one nobody can find twice.
     */
    signedIn.session = { ...PRACTICE_SESSION };
    stubFetch(GROUPED);
    render(<WaitingView />);

    await waitFor(() => expect(screen.getByTestId('waiting-group-affiliation-patel')).toBeTruthy());

    const back = screen.getByTestId('shell-back');
    expect(back.getAttribute('href')).toBe('/practice/today');
    // Named for where it goes, in the shell's own words rather than this
    // page's, so it cannot drift out of step with what `today` is called.
    expect(back.textContent).toContain(strings.nav.backTo.replace('{page}', strings.today.title));
    // A link, so it is reachable by keyboard without anything else being done.
    expect(back.tagName).toBe('A');

    // And nothing in the body says it a second time.
    expect(screen.queryByTestId('waiting-to-today')).toBeNull();
    const body = document.querySelector('main');
    expect([...(body?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'))).not.toContain(
      '/practice/today',
    );
  });

  it('a_practitioner_is_never_offered_a_door_that_does_not_open', async () => {
    /*
     * `/practice/today` is a `practice` page and a practitioner's token
     * carries NO practice claim (`page-access.ts`: the claim is what makes
     * somebody a practice user, not a realm role). A back link shown to
     * everybody would therefore be a dead end for exactly the people whose own
     * page this is — so theirs goes to their own landing page instead, and
     * `mayReach` refuses the other one even if the parent map ever said
     * otherwise.
     */
    signedIn.session = { ...PRACTITIONER_SESSION };
    stubFetch(MINE);
    render(<WaitingView />);

    await waitFor(() => expect(screen.getByTestId('waiting-row-arrival-1')).toBeTruthy());

    expect(screen.getByTestId('shell-back').getAttribute('href')).toBe('/practice/practitioner');
    // Nowhere on the page — header, body or menu — is `/practice/today` offered.
    const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).not.toContain('/practice/today');
  });

  it('a_state_can_be_set_from_one_labelled_control_per_row', async () => {
    /*
     * §3a rule 7: *"One control, not four buttons. A single labelled select per
     * row — four buttons across fifteen rows is sixty targets on a screen a
     * doctor glances at."* And WCAG 2.2 AA 4.1.2: fifteen controls all called
     * "Status" are fifteen indistinguishable combo boxes to a screen reader, so
     * each is named for the patient it is about.
     */
    stubFetch(MINE);
    render(<WaitingView />);

    await waitFor(() => expect(screen.getByTestId('waiting-state-arrival-1')).toBeTruthy());

    // ONE control per row, and it is a select rather than a row of buttons.
    const control = screen.getByTestId('waiting-state-arrival-1') as HTMLSelectElement;
    expect(control.tagName).toBe('SELECT');
    expect(screen.getAllByRole('combobox').length).toBe(MINE.groups[0]!.rows.length);
    for (const row of MINE.groups[0]!.rows) {
      expect(
        screen.getByRole('combobox', { name: strings.practitionerQueue.waiting.statusFor(row.patientName) }),
      ).toBeTruthy();
    }

    /*
     * THE OPTIONS ARE THE CONTENT FILE'S, IN ITS ORDER (CLAUDE.md §7). Compared
     * against `VISIT_STATE_OPTIONS` rather than a literal list here, so a
     * component that grew its own copy would fail this even if the words
     * matched.
     */
    expect([...control.options].map((o) => o.value)).toEqual(VISIT_STATE_OPTIONS.map((o) => o.key));

    // Pending is shown as the current answer and cannot be chosen: §3a's table
    // gives the starting state no setter.
    expect(control.value).toBe('pending');
    expect([...control.options].find((o) => o.value === 'pending')!.disabled).toBe(true);
    expect([...control.options].find((o) => o.value === 'completed')!.disabled).toBe(false);

    fireEvent.change(control, { target: { value: 'with_patient_now' } });

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toContain('/practitioner-queue/visits/arrival-1/state');
    // §3a rule 1: NO FREE TEXT ANYWHERE. The body is one key and nothing else,
    // and there is no name on it — who set it comes off the token.
    expect(JSON.parse(post.body ?? '{}')).toEqual({ state: 'with_patient_now' });
  });

  it('a_state_change_records_who_and_when_and_no_text', async () => {
    /*
     * The SCREEN half of §3a rule 1: *"Who, what state, when — from the token.
     * No free text anywhere. A note box here becomes a clinical record within a
     * week."* So the control offers nowhere to type, and the request carries
     * nothing but the key. (The server half — the principal off the token and
     * the timestamp — is asserted in the core e2e suite.)
     */
    stubFetch(MINE);
    render(<WaitingView />);
    await waitFor(() => expect(screen.getByTestId('waiting-state-arrival-1')).toBeTruthy());

    // Not one text box, textarea or contenteditable anywhere on the page.
    expect(document.querySelectorAll('main textarea').length).toBe(0);
    expect(document.querySelectorAll('main [contenteditable]').length).toBe(0);
    for (const input of document.querySelectorAll('main input')) {
      expect((input as HTMLInputElement).type).not.toMatch(/^(text|search)$/);
    }

    fireEvent.change(screen.getByTestId('waiting-state-arrival-1'), { target: { value: 'completed' } });
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const sent = JSON.parse(calls.find((c) => c.method === 'POST')!.body ?? '{}') as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual(['state']);
    for (const forbidden of ['note', 'reason', 'comment', 'by', 'name', 'setBy']) {
      expect(sent[forbidden]).toBeUndefined();
    }
  });

  it('completed_says_what_it_came_to_and_never_claims_a_signature', async () => {
    /*
     * §3a rule 3 — Completed IS the service-rendered signal, and what that came
     * to is the SERVER's answer, said on the row. "Shortcuts to the answer, not
     * directions to a screen" (CLAUDE.md §7): the message names the reason,
     * and an unmapped code shows its code rather than a generic line.
     */
    stateReply = { body: { renderedOutcome: 'awaiting_item_numbers', reviewTaskId: null } };
    stubFetch(MINE);
    render(<WaitingView />);
    await waitFor(() => expect(screen.getByTestId('waiting-state-arrival-2')).toBeTruthy());

    fireEvent.change(screen.getByTestId('waiting-state-arrival-2'), { target: { value: 'completed' } });

    await waitFor(() => expect(screen.getByTestId('waiting-state-said-arrival-2')).toBeTruthy());
    const said = screen.getByTestId('waiting-state-said-arrival-2').textContent ?? '';
    expect(said).toBe(strings.practitionerQueue.waiting.renderedOutcome.awaiting_item_numbers);
    // Hard rule 12: it never says the paperwork was approved, certified or
    // accredited — and it never claims a signature that does not exist.
    expect(said.toLowerCase()).not.toMatch(/certified|approved|accredited|signed/);
  });

  it('reassign_says_that_nobody_has_been_moved', async () => {
    /*
     * §3a rule 4: *"Reassign never reassigns."* A control that sounds as though
     * it moves somebody and does not is worse than no control, so the page says
     * plainly what happened — a task for the desk, and nobody moved.
     */
    stateReply = { body: { renderedOutcome: null, reviewTaskId: 'task-1' } };
    stubFetch(MINE);
    render(<WaitingView />);
    await waitFor(() => expect(screen.getByTestId('waiting-state-arrival-1')).toBeTruthy());

    fireEvent.change(screen.getByTestId('waiting-state-arrival-1'), { target: { value: 'reassign' } });

    await waitFor(() => expect(screen.getByTestId('waiting-state-said-arrival-1')).toBeTruthy());
    expect(screen.getByTestId('waiting-state-said-arrival-1').textContent).toBe(
      strings.practitionerQueue.waiting.reassignRaised,
    );
    expect(screen.getByTestId('waiting-state-said-arrival-1').textContent).toMatch(/nobody has been moved/i);

    // And the page's own key says it too, for somebody who has not pressed it yet.
    expect(screen.getByTestId('waiting-state-key').textContent).toMatch(/moves nobody by itself/i);
  });

  it('an_unset_state_never_gates_a_consultation_or_a_bill', async () => {
    /*
     * §3a rule 5 and hard rule 8. Every row starts on Pending and the page
     * must never dress that up as an outstanding task, a warning or a
     * precondition — it says the opposite, in as many words.
     */
    stubFetch(MINE);
    render(<WaitingView />);
    await waitFor(() => expect(screen.getByTestId('waiting-state-arrival-1')).toBeTruthy());

    expect(screen.getByTestId('waiting-state-never-blocks').textContent).toBe(
      strings.practitionerQueue.waiting.visitStateNeverBlocks,
    );
    const page = document.body.textContent ?? '';
    expect(page).not.toMatch(/set a status before|must be marked|required before|cannot bill until/i);
    // Nothing about an untouched row is disabled, hidden or struck through.
    expect((screen.getByTestId('waiting-state-arrival-1') as HTMLSelectElement).disabled).toBe(false);
  });

  it('a_refused_state_change_says_why_on_the_row_and_changes_nothing', async () => {
    /*
     * A refusal is a message, not a broken page (hard rule 8). It lands on the
     * ROW it was about — a page-wide banner on a fifteen-row list is a message
     * about nothing in particular — and the list is still there afterwards.
     */
    stateReply = { ok: false, body: { message: 'This patient did not come to see you.' } };
    stubFetch(MINE);
    render(<WaitingView />);
    await waitFor(() => expect(screen.getByTestId('waiting-state-arrival-1')).toBeTruthy());

    fireEvent.change(screen.getByTestId('waiting-state-arrival-1'), { target: { value: 'completed' } });

    await waitFor(() => expect(screen.getByTestId('waiting-state-refused-arrival-1')).toBeTruthy());
    expect(screen.getByTestId('waiting-state-refused-arrival-1').textContent).toBe(
      strings.practitionerQueue.waiting.visitStateFailed('This patient did not come to see you.'),
    );
    // The other row is untouched, and the list is still readable.
    expect(screen.queryByTestId('waiting-state-refused-arrival-2')).toBeNull();
    expect(screen.getByTestId('waiting-row-arrival-2')).toBeTruthy();
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

  it('an_unmapped_visit_state_shows_its_code', () => {
    // Same rule, and it matters more here: the option list is versioned content
    // and can gain a key before the string table does.
    expect(visitStateLabel('pending')).toBe('Pending');
    expect(visitStateLabel('with_patient_now')).toBe('With patient now');
    expect(visitStateLabel('completed')).toBe('Completed');
    expect(visitStateLabel('reassign')).toBe('Reassign');
    expect(visitStateLabel('added_next_quarter')).toBe('added_next_quarter');
  });

  it('has a word for every state the content file offers, and no orphans', () => {
    /*
     * Hard rule 14 in the console: the screen renders the FILE, so a key with
     * no string would render as a raw key in front of a practitioner. Checked
     * both ways — a string with no key is a word nobody can ever see, which is
     * how a stale label survives a rename.
     */
    const words = strings.practitionerQueue.waiting.visitState;
    for (const option of VISIT_STATE_OPTIONS) expect(words[option.key]).toBeTruthy();
    expect(Object.keys(words).sort()).toEqual(VISIT_STATE_OPTIONS.map((o) => o.key).sort());
  });
});

describe('/practice/practitioner — the landing page', () => {
  it('names who they are and which practice, and offers their waiting list', async () => {
    stubFetch(null, {
      id: 'practitioner-1',
      givenNames: 'Sample',
      familyName: 'Chen',
      affiliations: [
        { id: 'a1', practiceId: PRACTICE, practiceName: 'Sampletown Medical', locationAddress: '1 Sample St, Sampletown NSW 2000', status: 'active' },
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
    ).toEqual([{ id: 'p1', name: 'One', address: null }]);
  });
});

/**
 * THE TITLE NAMES THE PRACTICE AND ITS ADDRESS (Carl, 12 Sep 2026, signed in
 * as Dr Huang: change "Your page at this practice" to "Your page at Practice:"
 * plus the practice name and address).
 */
describe('landing_title_names_the_practice_and_its_address', () => {
  it('builds the title from the name and the single-line address', async () => {
    const { livePractices } = await import('./PractitionerLandingView');
    const { strings } = await import('../../strings');
    const practices = livePractices([
      { id: 'a1', practiceId: 'p1', practiceName: 'XLEVELUP Medical', locationAddress: '80 Tambourine Bay Rd, Riverview NSW 2066', status: 'active' },
      { id: 'a2', practiceId: 'p1', practiceName: 'XLEVELUP Medical', locationAddress: '50 Powell St, Yagoona NSW 2050', status: 'active' },
      { id: 'a3', practiceId: 'gone', practiceName: 'Former Practice', locationAddress: 'x', status: 'ended' },
    ]);
    // Two live sites of ONE practice collapse to one row carrying the first address.
    expect(practices).toHaveLength(1);
    expect(strings.practitionerQueue.landing.titleAt(practices[0].name, practices[0].address)).toBe(
      'Your page at Practice: XLEVELUP Medical, 80 Tambourine Bay Rd, Riverview NSW 2066',
    );
  });

  it('stops at the name when no address is known, rather than showing a blank', async () => {
    const { strings } = await import('../../strings');
    expect(strings.practitionerQueue.landing.titleAt('XLEVELUP Medical', null)).toBe('Your page at Practice: XLEVELUP Medical');
  });
});
