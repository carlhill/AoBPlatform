/**
 * RECEPTION'S WORK LIST AND ONE PATIENT'S PAGE, RENDERED (TODO.md
 * "Reception-centric: the patient work page", Carl 4 Sep 2026).
 *
 * IT EXISTS BECAUSE THESE PAGES CANNOT BE SEEN WITHOUT A PASSKEY. The console
 * signs in through Keycloak with WebAuthn (hard rule 15 — there is no password
 * path and never will be), so nobody can open a practice screen in a headless
 * check. Without this, their first render would happen in front of a practice,
 * with a patient at the desk.
 *
 * WHAT IT PINS, and none of it is cosmetic:
 *
 *  - THE QUEUE NAMES ONLY PEOPLE WITH SOMETHING OPEN, and its one line says
 *    the thing somebody has to act on rather than the thing that happened last.
 *  - THE WORK PAGE SHOWS THE FIVE DETAILS AND CORRECTS ONE IN PLACE, through
 *    the same endpoint and the same component as `/practice/tablet` — and
 *    records no dispute resolution, because nobody crossed anything.
 *  - THE TABLET CONTROLS ARE THE SAME CONTROLS. Same test ids, same dead
 *    buttons, same refusal band with the same words, for the same fixture.
 *  - NO MEDICARE NUMBER AND NO DOLLAR AMOUNT REACHES EITHER SCREEN (hard rules
 *    1 and 4), and the history carries types, never values (REQ-VER-04).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DeviceRow, PatientQueueRow, TabletSessionRow } from '@aobplatform/domain';
import { TabletView } from '../tablet/TabletView';
import { PatientsQueueView, matchesTerm, queueSummary } from './PatientsQueueView';
import { PatientWorkView, agreementHeading, historyLine } from './PatientWorkView';
import { strings } from '../../strings';

const PRACTICE = 'practice-1';
const PATIENT = '11111111-1111-4000-8000-000000000001';
const OTHER_PATIENT = '22222222-2222-4000-8000-000000000002';

/** A row that can go to a tablet, and one that cannot — the same pair the tablet suite uses. */
const READY = {
  agreementId: 'agreement-ready',
  agreementType: 'episodic_pre',
  status: 'draft',
  patientName: 'Jamie Sampleton',
  patientId: PATIENT,
  providerName: 'Dr Example Provider',
  providerType: 'general_practitioner',
  appointmentDate: '2026-09-04',
  appointmentTime: '09:00',
  serviceDescription: 'General practitioner attendance',
  serviceDescriptionValid: true,
  assignorIsPatient: true,
  assignorName: null,
  assignorRelationship: null,
  particularsLocked: false,
  pushable: true,
  blockedReason: null,
  activeSession: null,
};

const BLOCKED = {
  ...READY,
  agreementId: 'agreement-blocked',
  serviceDescription: null,
  serviceDescriptionValid: false,
  pushable: false,
  blockedReason: 'service_description_missing' as const,
};

const TABLET: DeviceRow = {
  id: 'device-1',
  label: 'Carl browser tablet',
  state: 'paired',
  createdBy: 'Robin Admin',
  createdAt: '2026-09-01T00:00:00.000Z',
  pairedAt: '2026-09-01T01:00:00.000Z',
  lastSeenAt: '2026-09-04T08:00:00.000Z',
  lastKioskBuild: '2026.09.04-1',
  revokedAt: null,
  revokedBy: null,
  pairingExpiresAt: null,
  showsWaitingList: false,
};

const SESSION: TabletSessionRow = {
  id: '8ff09d7b-1111-4000-8000-000000000001',
  deviceId: TABLET.id,
  deviceLabel: TABLET.label,
  agreementId: READY.agreementId,
  agreementType: 'episodic_pre',
  patientName: 'Jamie Sampleton',
  patientId: PATIENT,
  providerName: 'Dr Example Provider',
  state: 'reading',
  disputedDetails: [],
  disputeResolution: null,
  disputeResolvedAt: null,
  pushedBy: 'Mai Frontdesk',
  pushedAt: '2026-09-04T09:05:00.000Z',
  lastStateAt: '2026-09-04T09:06:00.000Z',
  endedAt: null,
};

/** The six correctable details, as the server hands them back. Obviously fake. */
const DETAILS = {
  id: PATIENT,
  givenNames: 'Jamie',
  familyName: 'Sampleton',
  dateOfBirth: '1957-03-14',
  address: '404 Wrongway Parade, Sampletown NSW 2000',
  mobile: '+61400000404',
  email: 'jamie.sampleton@example.invalid',
  detailsCorrectedAt: null,
};

const DESCRIPTIONS = {
  version: '2026-08',
  descriptions: ['General practitioner attendance', 'Specialist attendance'],
};

const TIMELINE = {
  patientId: PATIENT,
  entries: [
    {
      at: '2026-09-04T09:05:00.000Z',
      type: 'session_pushed',
      agreementId: READY.agreementId,
      sessionId: SESSION.id,
    },
    // TYPES AND AN OUTCOME, never a value (REQ-VER-04).
    { at: '2026-09-04T09:04:00.000Z', type: 'verification', detail: 'passed', detailTypes: ['name', 'address'] },
    { at: '2026-09-04T09:00:00.000Z', type: 'agreement_created', agreementId: READY.agreementId },
  ],
};

const TRAIL = {
  subjectType: 'Agreement',
  subjectId: READY.agreementId,
  agreementId: READY.agreementId,
  serviceRecordId: null,
  serviceDate: null,
  daysRemaining: 365,
  band: 'standard',
  policy: { band: 'standard', attempts: 3, attemptWindowHours: 168, escalation: [], handback: '' },
  attemptsMade: 1,
  automatedAttempts: 1,
  humanAttempts: 0,
  attemptAllowed: true,
  nextStep: 'ai',
  attempts: [],
};

const QUEUE: PatientQueueRow[] = [
  {
    patientId: PATIENT,
    patientName: 'Jamie Sampleton',
    dateOfBirth: '1957-03-14',
    items: [
      {
        kind: 'session',
        agreementId: READY.agreementId,
        agreementType: 'episodic_pre',
        sessionId: SESSION.id,
        sessionState: 'reading',
        deviceLabel: TABLET.label,
        endedAt: null,
        disputedDetails: [],
        disputeResolution: null,
      },
    ],
  },
  {
    patientId: OTHER_PATIENT,
    patientName: 'Casey Walkin',
    dateOfBirth: '1988-02-02',
    items: [
      {
        kind: 'awaiting_signature',
        agreementId: BLOCKED.agreementId,
        agreementType: 'episodic_pre',
        pushable: false,
        blockedReason: 'service_description_missing',
      },
    ],
  },
];

const calls: Array<{ url: string; method: string; body: unknown }> = [];

function stubFetch(
  opts: { queue?: PatientQueueRow[]; rows?: unknown[]; sessions?: TabletSessionRow[]; messages?: unknown[] } = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });

      if (method !== 'GET') {
        return { ok: true, status: 201, json: async () => ({}) } as unknown as Response;
      }

      // ORDER MATTERS: the work list's own question is asked of `/patients`
      // itself, so it is matched before the per-patient reads.
      const payload = url.includes('/patients?open=today')
        ? (opts.queue ?? QUEUE)
        : url.includes('/timeline')
          ? TIMELINE
          : url.includes('/patients/')
            ? DETAILS
            : url.includes('/chase-attempts/')
              ? TRAIL
              : url.includes('/correspondence')
                ? (opts.messages ?? [])
                : url.includes('/service-descriptions')
                  ? DESCRIPTIONS
                  : url.includes('/tablet-sessions/pushable')
                    ? (opts.rows ?? [READY, BLOCKED])
                    : url.includes('/tablet-sessions')
                      ? (opts.sessions ?? [SESSION])
                      : url.includes('/practice-users')
                        ? { users: [] }
                        : { devices: [TABLET] };
      return { ok: true, status: 200, json: async () => payload } as unknown as Response;
    }),
  );
}

let session: { roles: string[]; practiceId: string | null } | null = null;

vi.mock('../../auth', () => ({
  currentSession: () => session,
  apiHeaders: () => ({ 'x-practice-id': PRACTICE, 'Content-Type': 'application/json' }),
}));

beforeEach(() => {
  calls.length = 0;
  session = { roles: ['practice_user'], practiceId: PRACTICE };
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

// ---------------------------------------------------------------------------

describe('/practice/patients — who has something open today', () => {
  it('queue_lists_only_patients_with_something_open', async () => {
    stubFetch();
    render(<PatientsQueueView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`patient-${PATIENT}`)).toBeTruthy());
    expect(screen.getByTestId(`patient-${OTHER_PATIENT}`)).toBeTruthy();

    /*
     * THE LIST IS EXACTLY WHAT THE SERVER NAMED. There is no "all patients"
     * question to ask and no way to ask one from here: the page reads
     * `?open=today` and nothing else, which is what stops a work list from
     * becoming a patient directory (REQ-DATA-10).
     */
    expect(screen.getAllByTestId(/^patient-(?!summary)/)).toHaveLength(2);
    const asked = calls.filter((call) => call.url.includes('/patients'));
    expect(asked.length).toBeGreaterThan(0);
    for (const call of asked) expect(call.url).toContain('open=today');

    // A patient with nothing open is not in the payload, so not on the screen.
    cleanup();
    stubFetch({ queue: [] });
    render(<PatientsQueueView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByText(strings.patients.none)).toBeTruthy());
    expect(screen.queryByTestId(`patient-${PATIENT}`)).toBeNull();
  });

  it('queue_rows_show_no_patient_values_but_the_name', async () => {
    /*
     * A FRONT-COUNTER LIST POLLED EVERY THREE SECONDS IS A STATUS, NOT A
     * MIRROR (Carl, 4 Sep 2026). The date of birth disambiguates two people
     * who share a name, but that happens on the work page, read once when it
     * opens — not here, on a screen facing the room all morning.
     */
    stubFetch();
    render(<PatientsQueueView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`patient-${PATIENT}`)).toBeTruthy());
    const row = screen.getByTestId(`patient-${PATIENT}`);

    expect(row.textContent).toContain('Jamie Sampleton');
    expect(row.textContent).not.toContain('1957');
    expect(row.textContent).not.toContain('March');
    expect(row.textContent).not.toMatch(/born/i);
  });

  it('the one line says what somebody has to do, not what happened last', () => {
    /*
     * AN UNANSWERED CROSS OUTRANKS A LIVE TABLET. A row that led with "on a
     * tablet now" while the patient stood at the counter saying their address
     * was wrong would be true and useless.
     */
    const disputed = {
      items: [
        { ...QUEUE[0].items[0], disputedDetails: ['address'], disputeResolution: null },
      ],
    } as Pick<PatientQueueRow, 'items'>;
    expect(queueSummary(disputed)).toContain(strings.kiosk.checkDetails.detailNames.address);

    // Answered, and the line becomes the thing left to do.
    const resolved = {
      items: [{ ...disputed.items[0], disputeResolution: 'corrected' as const }],
    };
    expect(queueSummary(resolved)).toBe(strings.tablet.resolvedTitle);

    // Live: the tablet and the session id both, so the two screens match by eye.
    expect(queueSummary(QUEUE[0])).toContain(TABLET.label);
    expect(queueSummary(QUEUE[0])).toContain('8ff09d7b');

    // Waiting, and whether it can actually go.
    expect(queueSummary(QUEUE[1])).toBe(strings.patients.summaryBlocked);
    expect(
      queueSummary({ items: [{ ...QUEUE[1].items[0], pushable: true }] }),
    ).toBe(strings.patients.summaryAwaiting);
  });

  it('type-to-find narrows what is on screen and asks the server nothing', async () => {
    stubFetch();
    render(<PatientsQueueView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId(`patient-${PATIENT}`)).toBeTruthy());

    const before = calls.length;
    fireEvent.change(screen.getByTestId('patients-find'), { target: { value: 'casey' } });

    await waitFor(() => expect(screen.queryByTestId(`patient-${PATIENT}`)).toBeNull());
    expect(screen.getByTestId(`patient-${OTHER_PATIENT}`)).toBeTruthy();
    // Not one request: the filter is over rows the server already scoped.
    expect(calls.length).toBe(before);

    expect(matchesTerm(QUEUE[0], 'sampleton')).toBe(true);
    expect(matchesTerm(QUEUE[0], 'walkin')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('/practice/patients/<id> — one patient, everything open', () => {
  it('work_page_shows_all_five_details_and_corrects_inline', async () => {
    stubFetch();
    render(<PatientWorkView practiceId={PRACTICE} patientId={PATIENT} />);

    await waitFor(() => expect(screen.getByTestId('identity-list')).toBeTruthy());
    const identity = screen.getByTestId('identity-list');

    // THE FIVE DETAILS THE PATIENT IS ASKED TO CHECK, all of them.
    expect(identity.textContent).toContain('Jamie Sampleton');
    expect(identity.textContent).toContain('14 March 1957');
    expect(identity.textContent).toContain('404 Wrongway Parade');
    expect(identity.textContent).toContain('+61400000404');
    expect(identity.textContent).toContain('jamie.sampleton@example.invalid');

    // Corrected in place, through the same panel the tablet page opens.
    fireEvent.click(screen.getByTestId('identity-correct-open'));
    const panel = await screen.findByTestId(`correct-panel-patient:${PATIENT}`);
    expect(panel).toBeTruthy();

    fireEvent.change(screen.getByTestId(`correct-address-patient:${PATIENT}`), {
      target: { value: '1 Right Street, Sampletown NSW 2000' },
    });
    fireEvent.click(screen.getByTestId(`correct-save-patient:${PATIENT}`));

    await waitFor(() =>
      expect(calls.some((call) => call.method === 'PATCH' && call.url.includes(`/patients/${PATIENT}/details`))).toBe(
        true,
      ),
    );
    const patch = calls.find((call) => call.method === 'PATCH')!;
    // ONLY WHAT CHANGED. An untouched field must never become a correction event.
    expect(patch.body).toEqual({ address: '1 Right Street, Sampletown NSW 2000' });

    /*
     * AND NO DISPUTE RESOLUTION. Nobody crossed anything here — recording one
     * would put an answer in the vault to a question nobody asked.
     */
    expect(calls.some((call) => call.url.includes('/dispute-resolution'))).toBe(false);
  });

  it('work_page_tablet_controls_match_tablet_page', async () => {
    /*
     * THE SAME FIXTURE, THE SAME CONTROLS. Not "similar": the same component,
     * so the same test ids, the same dead buttons and the same refusal band
     * with the same words. A second implementation of "may this be sent" is a
     * second place for a rule to be fixed and one place for it to be forgotten.
     */
    const signature = (root: HTMLElement) => ({
      ids: [...root.querySelectorAll('[data-testid]')]
        .map((node) => node.getAttribute('data-testid'))
        .sort(),
      disabled: [...root.querySelectorAll('button')].map((b) => (b as HTMLButtonElement).disabled),
      blocked: root.querySelector(`[data-testid="blocked-${BLOCKED.agreementId}"]`)?.textContent,
    });

    stubFetch();
    render(<TabletView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId(`pushable-${BLOCKED.agreementId}`)).toBeTruthy());
    const fromTablet = signature(screen.getByTestId(`pushable-${BLOCKED.agreementId}`));
    cleanup();

    stubFetch();
    render(<PatientWorkView practiceId={PRACTICE} patientId={PATIENT} />);
    await waitFor(() => expect(screen.getByTestId(`pushable-${BLOCKED.agreementId}`)).toBeTruthy());
    const fromWork = signature(screen.getByTestId(`pushable-${BLOCKED.agreementId}`));

    // The heading is the one thing the work page adds, because the page is
    // already about this person and their name is at the top of it.
    expect(fromWork.ids).toEqual(
      [...fromTablet.ids, `agreement-heading-${BLOCKED.agreementId}`].sort(),
    );
    expect(fromWork.disabled).toEqual(fromTablet.disabled);
    expect(fromWork.blocked).toBe(fromTablet.blocked);
    expect(fromWork.blocked).toContain(strings.tablet.blocked.service_description_missing);
  });

  it('names an enduring agreement under its provider, never practice-wide', () => {
    /*
     * HARD RULE 6, IN THE ONE PLACE A RECEPTIONIST WOULD BELIEVE IT. Enduring
     * is per practitioner × patient and GP-only (REQ-END-01/-01a); a heading
     * that read "practice-wide" would be the rule broken on screen.
     */
    const heading = agreementHeading({ agreementType: 'enduring', providerName: 'Dr Example Provider' });
    expect(heading).toContain('Dr Example Provider');
    expect(heading.toLowerCase()).not.toContain('practice');
    expect(agreementHeading({ agreementType: 'episodic_pre', providerName: null })).toBe(
      strings.patients.episodicToday,
    );
  });

  it('the history reads as types and times, and an unmapped type shows its code', () => {
    expect(historyLine({ at: '', type: 'session_pushed' })).toBe(
      strings.patients.historyTypes.session_pushed,
    );
    const verification = historyLine({
      at: '',
      type: 'verification',
      detail: 'passed',
      detailTypes: ['name', 'address'],
    });
    expect(verification).toContain(strings.kiosk.checkDetails.detailNames.address);
    expect(verification).toContain('passed');
    // Never swallowed: a type this build has not met shows itself.
    expect(historyLine({ at: '', type: 'something_new' as never })).toBe('something_new');
  });

  it('work_page_never_shows_medicare_or_amounts', async () => {
    stubFetch();
    const { container } = render(<PatientWorkView practiceId={PRACTICE} patientId={PATIENT} />);

    await waitFor(() => expect(screen.getByTestId('identity-list')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('work-history')).toBeTruthy());

    const text = container.textContent ?? '';
    /*
     * THE MEDICARE CARD NUMBER IS NOT AN IDENTITY IDENTIFIER AND IS NOT HELD
     * HERE AT ALL (hard rule 1, REQ-VER-02) — there is no column for one, and
     * this page must never grow a field that asks for one.
     */
    expect(text).not.toMatch(/medicare/i);
    // NO BENEFIT AND NO DOLLAR AMOUNT ON ANY AGREEMENT ARTEFACT (hard rule 4).
    expect(text).not.toMatch(/\$\s?\d/);
    // NOR ANY CLAIM OF CERTIFICATION (hard rule 12, REQ-65C-05).
    expect(text).not.toMatch(/certified|accredited|government-approved/i);
    // The whole markup, not only the words: no hidden attribute carries one.
    expect(container.innerHTML).not.toMatch(/medicare/i);
  });
});
