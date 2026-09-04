/**
 * `/practice/tablet` — "Send to the tablet", rendered.
 *
 * IT EXISTS BECAUSE THIS PAGE CANNOT BE SEEN WITHOUT A PASSKEY. The console
 * signs in through Keycloak with WebAuthn (hard rule 15 — there is no password
 * path and never will be), so nobody can open a practice screen in a headless
 * check the way `/kiosk` can be opened. Without this, the page's first render
 * would happen in front of a practice, with a patient at the desk.
 *
 * WHAT IT PINS, and none of it is cosmetic:
 *
 *  - A ROW THAT CANNOT BE SENT SAYS SO, ALWAYS, and says which rule is in the
 *    way — in OUR words, from the string table, never the server's sentence
 *    and never with the patient's data in it. This is Carl's own live test
 *    made structural (TODO.md, 4 Sep 2026): the walk-up kiosk let a patient do
 *    all the work and then handed over to a screen that named nobody.
 *  - SEND IS DEAD UNTIL THE ROW CAN GO (CLAUDE.md §6). Blocked states are
 *    unreachable, not merely inert.
 *  - THE WHO-IS-SIGNING GATE REFUSES WHAT THE SERVER REFUSES — practice staff
 *    hard-blocked (REQ-VUL-04), the age declaration required (REQ-AGE-01), a
 *    contact channel required (REQ-REG-08) — with the thresholds imported from
 *    the domain rather than typed here.
 *  - RECEPTION SEES A STATUS, NOT A MIRROR. A name and a state; never the
 *    particulars the tablet is showing.
 *  - THE PAGE NEVER CLAIMS CERTIFICATION (hard rule 12) and never shows a
 *    dollar amount (hard rule 4).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MIN_AGE_ASSIGN_FOR_OTHER, type DeviceRow, type TabletSessionRow } from '@aobplatform/domain';
import { TabletView, blockedMessage, mayPush, serviceFact, signingFact, whoIsBlocked } from './TabletView';
import { strings } from '../../strings';

const PRACTICE = 'practice-1';

const READY = {
  agreementId: 'agreement-ready',
  agreementType: 'episodic_pre',
  status: 'draft',
  patientName: 'Jamie Sampleton',
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
  patientName: 'Casey Walkin',
  serviceDescription: null,
  serviceDescriptionValid: false,
  pushable: false,
  blockedReason: 'service_description_missing' as const,
};

const TABLET: DeviceRow = {
  id: 'device-1',
  label: 'Reception tablet 1',
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
  id: 'session-1',
  deviceId: TABLET.id,
  deviceLabel: TABLET.label,
  agreementId: READY.agreementId,
  agreementType: 'episodic_pre',
  patientName: 'Jamie Sampleton',
  providerName: 'Dr Example Provider',
  state: 'reading',
  pushedBy: 'Mai Frontdesk',
  pushedAt: '2026-09-04T09:05:00.000Z',
  lastStateAt: '2026-09-04T09:06:00.000Z',
  endedAt: null,
};

const calls: Array<{ url: string; method: string; body: unknown }> = [];

function stubFetch(
  opts: {
    rows?: unknown[];
    devices?: DeviceRow[];
    sessions?: TabletSessionRow[];
    staff?: string[];
    onPost?: (url: string) => { ok: boolean; status?: number; payload?: unknown };
  } = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });

      if (method === 'GET') {
        const payload = url.includes('/tablet-sessions/pushable')
          ? (opts.rows ?? [READY, BLOCKED])
          : url.includes('/tablet-sessions')
            ? (opts.sessions ?? [])
            : url.includes('/practice-users')
              ? { users: (opts.staff ?? []).map((name) => ({ name })) }
              : { devices: opts.devices ?? [TABLET] };
        return { ok: true, status: 200, json: async () => payload } as unknown as Response;
      }

      const result = opts.onPost?.(url) ?? { ok: true, payload: {} };
      return {
        ok: result.ok,
        status: result.status ?? (result.ok ? 201 : 409),
        json: async () => result.payload ?? {},
      } as unknown as Response;
    }),
  );
}

/**
 * THE SIGNED-IN SESSION, MOCKED AT THE MODULE — the same seam the
 * reconciliation suite uses.
 *
 * `currentSession()` reads a module-level variable rather than storage (it is
 * deliberately not persisted), so there is nothing a global stub could reach.
 * What matters for these tests is only which AUDIENCES the page derives, and
 * the page derives them from the SESSION's own claim rather than from the
 * `practiceId` prop — which practice a page is ABOUT and what the caller may
 * DO are different questions, and feeding the prop in as a fallback is the
 * exact bug a test caught on the reconciliation screen.
 */
let session: { roles: string[]; practiceId: string | null; practitionerId?: string } | null = null;

vi.mock('../../auth', () => ({
  currentSession: () => session,
  apiHeaders: () => ({ 'x-practice-id': PRACTICE, 'Content-Type': 'application/json' }),
}));

function signedInAtPractice() {
  session = { roles: ['practice_user'], practiceId: PRACTICE };
}

describe('/practice/tablet — send to the tablet', () => {
  beforeEach(() => {
    calls.length = 0;
    session = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows today’s agreements with the patient, the provider, D6a and who is signing', async () => {
    stubFetch();
    render(<TabletView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`pushable-${READY.agreementId}`)).toBeTruthy());
    const row = screen.getByTestId(`pushable-${READY.agreementId}`);
    expect(row.textContent).toContain('Jamie Sampleton');
    expect(row.textContent).toContain('Dr Example Provider');
    expect(row.textContent).toContain('09:00');
    expect(row.textContent).toContain('General practitioner attendance');
    expect(row.textContent).toContain(strings.tablet.signingPatient);
  });

  it('row_renders_facts_in_one_line_each', async () => {
    stubFetch();
    render(<TabletView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`pushable-${READY.agreementId}`)).toBeTruthy());
    const readyRow = within(screen.getByTestId(`pushable-${READY.agreementId}`));
    const blockedRow = within(screen.getByTestId(`pushable-${BLOCKED.agreementId}`));

    // The label and its value, together as ONE string — never split across
    // sibling nodes a narrow column could wrap onto separate lines.
    expect(serviceFact(READY)).toBe(`${strings.tablet.d6aLabel}: ${READY.serviceDescription}`);
    expect(signingFact(READY)).toBe(`${strings.tablet.signingLabel}: ${strings.tablet.signingPatient}`);
    expect(readyRow.getByText(serviceFact(READY))).toBeTruthy();
    expect(readyRow.getByText(signingFact(READY))).toBeTruthy();

    // A draft with no D6a yet reads the same way — "Service: Not set" as one
    // line, not a label stranded above an empty value.
    expect(serviceFact(BLOCKED)).toBe(`${strings.tablet.d6aLabel}: ${strings.tablet.d6aMissing}`);
    expect(blockedRow.getByText(serviceFact(BLOCKED))).toBeTruthy();
  });

  it('blocked_row_disables_send_and_shows_reason_once', async () => {
    signedInAtPractice();
    stubFetch();
    render(<TabletView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`send-${BLOCKED.agreementId}`)).toBeTruthy());
    const send = screen.getByTestId(`send-${BLOCKED.agreementId}`) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    // The reason is the DEAD button's tooltip …
    const reason = strings.tablet.blocked.service_description_missing;
    expect(send.title).toBe(reason);

    // … and appears exactly ONCE on the row: in its own full-width band,
    // never also folded into the button's visible label (which stays the
    // generic "Cannot be sent yet" so the two never say the reason twice,
    // let alone overlap on screen).
    const row = screen.getByTestId(`pushable-${BLOCKED.agreementId}`);
    const text = row.textContent ?? '';
    expect(text.split(reason).length - 1).toBe(1);
    expect(send.textContent).not.toContain(reason);
    expect(send.textContent).toContain(strings.tablet.sendBlocked);
  });

  it('a blocked row says which rule is in the way, before anybody presses anything', async () => {
    stubFetch();
    render(<TabletView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`blocked-${BLOCKED.agreementId}`)).toBeTruthy());
    const blocked = screen.getByTestId(`blocked-${BLOCKED.agreementId}`);
    // OUR words, from the string table.
    expect(blocked.textContent).toContain(strings.tablet.blocked.service_description_missing);
    // A rule, never the patient's data folded into a message.
    expect(blocked.textContent).not.toContain('Casey Walkin');
    // And the row is still LISTED — reception must be able to see who needs
    // fixing (TODO.md, 4 Sep 2026).
    expect(screen.getByTestId(`pushable-${BLOCKED.agreementId}`)).toBeTruthy();
  });

  it('Send is dead on a blocked row and live on a ready one — blocked states are unreachable', async () => {
    signedInAtPractice();
    stubFetch();
    render(<TabletView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`send-${READY.agreementId}`)).toBeTruthy());
    const blockedSend = screen.getByTestId(`send-${BLOCKED.agreementId}`) as HTMLButtonElement;
    expect(blockedSend.disabled).toBe(true);
    expect(blockedSend.textContent).toContain(strings.tablet.sendBlocked);

    // Ready, but no tablet chosen yet: still dead, and for a different reason.
    const readySend = screen.getByTestId(`send-${READY.agreementId}`) as HTMLButtonElement;
    expect(readySend.disabled).toBe(true);

    fireEvent.change(screen.getByTestId(`target-${READY.agreementId}`), { target: { value: TABLET.id } });
    await waitFor(() => expect((screen.getByTestId(`send-${READY.agreementId}`) as HTMLButtonElement).disabled).toBe(false));
  });

  it('sends to the chosen tablet, and shows the server’s reason in our words when it refuses', async () => {
    signedInAtPractice();
    stubFetch({
      onPost: () => ({ ok: false, status: 409, payload: { reason: 'device_busy', message: 'raw server text' } }),
    });
    render(<TabletView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`target-${READY.agreementId}`)).toBeTruthy());
    fireEvent.change(screen.getByTestId(`target-${READY.agreementId}`), { target: { value: TABLET.id } });
    fireEvent.click(screen.getByTestId(`send-${READY.agreementId}`));

    await waitFor(() => expect(screen.getByTestId(`push-outcome-${READY.agreementId}`)).toBeTruthy());
    const outcome = screen.getByTestId(`push-outcome-${READY.agreementId}`);
    expect(outcome.textContent).toContain(strings.tablet.blocked.device_busy);
    // NOT the server's own sentence — the console renders its own words.
    expect(outcome.textContent).not.toContain('raw server text');

    const push = calls.find((c) => c.method === 'POST');
    expect(push!.url).toContain(`/devices/${TABLET.id}/push`);
    expect(push!.body).toEqual({ agreementId: READY.agreementId });
  });

  it('shows what each tablet is doing as a STATE, and never the particulars on its screen', async () => {
    signedInAtPractice();
    stubFetch({ sessions: [SESSION], rows: [{ ...READY, activeSession: { id: SESSION.id, deviceId: TABLET.id, state: 'reading' } }] });
    render(<TabletView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`tablet-state-${TABLET.id}`)).toBeTruthy());
    const state = screen.getByTestId(`tablet-state-${TABLET.id}`);
    expect(state.textContent).toContain('Jamie Sampleton');
    expect(state.textContent).toContain(strings.tablet.states.reading);

    // A status, not a mirror: nothing the tablet is showing appears here.
    const page = document.body.textContent ?? '';
    expect(page).not.toContain('1957-03-14');
    expect(page).not.toContain('12 Example Street');
    // Nor a benefit or dollar amount, anywhere (hard rule 4).
    expect(page).not.toMatch(/\$\s?\d/);
    // Nor a claim of certification (hard rule 12).
    expect(page).not.toMatch(/certified|accredited|government-approved/i);
  });

  it('recalls a session, and the control is offered only while one is live', async () => {
    signedInAtPractice();
    stubFetch({ sessions: [SESSION] });
    render(<TabletView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`recall-${SESSION.id}`)).toBeTruthy());
    fireEvent.click(screen.getByTestId(`recall-${SESSION.id}`));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const recall = calls.find((c) => c.method === 'POST')!;
    expect(recall.url).toContain(`/tablet-sessions/${SESSION.id}/recall`);
  });

  it('offers no controls to a reader without the practice’s own claim', async () => {
    // No session at all: `audiencesOf` gives nothing, so `mayPush` is false.
    stubFetch({ sessions: [SESSION] });
    render(<TabletView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId('tablet-view-only')).toBeTruthy());
    expect((screen.getByTestId(`send-${READY.agreementId}`) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId(`recall-${SESSION.id}`) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId(`who-open-${READY.agreementId}`) as HTMLButtonElement).disabled).toBe(true);
    // The STATE is still readable — the person asked "why has that tablet not
    // got it" is the one person who needs the answer.
    expect(screen.getByTestId(`tablet-state-${TABLET.id}`).textContent).toContain(strings.tablet.states.reading);
  });

  it('sets who is signing at the desk, sending the relationship, the derived basis and the list version', async () => {
    signedInAtPractice();
    stubFetch();
    render(<TabletView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`who-open-${READY.agreementId}`)).toBeTruthy());
    fireEvent.click(screen.getByTestId(`who-open-${READY.agreementId}`));

    // "The patient is signing" is on by default; turn it off for the other branch.
    fireEvent.click(screen.getByRole('checkbox', { name: strings.tablet.whoPatient }));
    fireEvent.change(screen.getByTestId(`who-name-${READY.agreementId}`), {
      target: { value: 'Robin Relative' },
    });
    fireEvent.change(screen.getByTestId(`who-relationship-${READY.agreementId}`), {
      target: { value: 'mother' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: strings.tablet.whoAgeConfirm(MIN_AGE_ASSIGN_FOR_OTHER) }));
    fireEvent.change(screen.getByTestId(`who-mobile-${READY.agreementId}`), {
      target: { value: '0400 000 001' },
    });

    await waitFor(() =>
      expect((screen.getByTestId(`who-save-${READY.agreementId}`) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId(`who-save-${READY.agreementId}`));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const saved = calls.find((c) => c.method === 'POST')!;
    expect(saved.url).toContain(`/agreements/${READY.agreementId}/assignor`);
    expect(saved.body).toMatchObject({
      assignorIsPatient: false,
      name: 'Robin Relative',
      // DERIVED from versioned content, never typed on the screen.
      authorityBasis: 'parent',
      relationship: 'Mother',
      declaresEighteenOrOver: true,
      mobile: '0400 000 001',
    });
    // WHICH LIST THE ANSWER CAME FROM (hard rule 14).
    expect((saved.body as { relationshipsVersion?: string }).relationshipsVersion).toBeTruthy();
    // NO DATE OF BIRTH for the third party (REQ-AGE-04) and no capacity
    // question anywhere (REQ-VUL-05) — the absence is the requirement.
    expect(JSON.stringify(saved.body)).not.toMatch(/dateOfBirth|capacity/i);
  });

  it('ui_never_asks_staff_to_assess_capacity', async () => {
    signedInAtPractice();
    stubFetch();
    render(<TabletView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId(`who-open-${READY.agreementId}`)).toBeTruthy());
    fireEvent.click(screen.getByTestId(`who-open-${READY.agreementId}`));
    fireEvent.click(screen.getByRole('checkbox', { name: strings.tablet.whoPatient }));

    expect(document.body.textContent ?? '').not.toMatch(/capacity|competent|understands/i);
  });
});

describe('the gate on who may sign — the same refusals the server makes', () => {
  const other = {
    isPatient: false,
    name: 'Robin Relative',
    relationship: 'mother',
    describe: '',
    declaredOfAge: true,
    mobile: '0400 000 001',
    email: '',
  };

  it('practice_staff_hard_blocked_as_assignor — and the refusal never names the match', () => {
    const blocked = whoIsBlocked({ ...other, name: 'Mai Frontdesk' }, ['Mai Frontdesk', 'Robin Admin']);
    expect(blocked).toBe(strings.tablet.whoBlockedStaff);
    // It states that a name matched staff. It does not say WHICH name, or how.
    expect(blocked).not.toContain('Robin Admin');
  });

  it('assignor_for_another_must_be_of_full_age — the declaration is required', () => {
    expect(whoIsBlocked({ ...other, declaredOfAge: false }, [])).toBe(strings.tablet.whoBlockedAge);
  });

  it('a contact channel is required, because the copy goes to the ASSIGNOR', () => {
    expect(whoIsBlocked({ ...other, mobile: '', email: '' }, [])).toBe(strings.tablet.whoBlockedContact);
    expect(whoIsBlocked({ ...other, mobile: '', email: 'robin@example.invalid' }, [])).toBeNull();
  });

  it('the free-text option needs its text, and the others do not', () => {
    expect(whoIsBlocked({ ...other, relationship: 'other', describe: '' }, [])).toBe(
      strings.tablet.whoBlockedDescribe,
    );
    expect(whoIsBlocked({ ...other, relationship: 'other', describe: 'Neighbour' }, [])).toBeNull();
  });

  it('the patient signing for themselves is never blocked by any of it', () => {
    expect(whoIsBlocked({ ...other, isPatient: true, name: '', declaredOfAge: false, mobile: '' }, [])).toBeNull();
  });
});

describe('the refusal words', () => {
  it('renders every reason the server can send, and falls back rather than going silent', () => {
    expect(blockedMessage('enduring_not_supported')).toBe(strings.tablet.blocked.enduring_not_supported);
    expect(blockedMessage('who_is_signing_unset')).toBe(strings.tablet.blocked.who_is_signing_unset);
    // A reason this build has not met yet still tells somebody to go and look.
    expect(blockedMessage('a_reason_from_a_newer_server')).toBe(strings.tablet.blocked.other);
    expect(blockedMessage(null)).toBe(strings.tablet.blocked.other);
  });

  it('never_claims_certification_or_approval', () => {
    const words = [
      ...Object.values(strings.tablet.blocked),
      ...Object.values(strings.tablet.states),
      strings.tablet.title,
      strings.tablet.lead,
      strings.tablet.whatItDoes,
      strings.tablet.neverBlocks,
      strings.tablet.enduringGpOnly,
    ].join(' ');
    expect(words).not.toMatch(/certified|accredited|government-approved/i);
    // "Approved" as a claim about our forms. The patient APPROVES on the
    // tablet, but nothing on this page says an agreement was approved.
    expect(words).not.toMatch(/\bapproved\b/i);
    // No benefit and no dollar amount (hard rule 4).
    expect(words).not.toMatch(/\$\s?\d/);
  });

  it('mayPush needs the practice’s own claim, not merely the ability to read the page', () => {
    expect(mayPush(['practice'])).toBe(true);
    // A platform operator who has not opened an acting-as session.
    expect(mayPush(['platform'])).toBe(false);
    expect(mayPush([])).toBe(false);
  });
});
