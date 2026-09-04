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
import {
  TabletView,
  blockedMessage,
  disputedLabels,
  fieldsToCorrect,
  mayPush,
  serviceFact,
  signingFact,
  whoIsBlocked,
} from './TabletView';
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
  patientId: 'patient-1',
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

/**
 * THE SAME SESSION, AFTER THE PATIENT CROSSED TWO ROWS. `disputedDetails`
 * carries TYPES and never values (REQ-VER-04) — reception reads "address,
 * mobile" and the values arrive only when they open the correction control.
 */
const DISPUTED: TabletSessionRow = {
  ...SESSION,
  state: 'details_disputed',
  disputedDetails: ['address', 'mobile'],
};

/**
 * THE SAME SESSION, ONCE RECEPTION HAS ANSWERED THE CROSS (Carl, 4 Sep 2026).
 *
 * THE STATE IS STILL `details_disputed`, deliberately: a resolution is a fact
 * about the dispute, not a new state — the cross happened, and answering it
 * does not unhappen it. The console reads `disputeResolution` rather than
 * inventing a state the server does not have.
 */
const RESOLVED: TabletSessionRow = {
  ...DISPUTED,
  disputeResolution: 'patient_error',
  disputeResolvedAt: '2026-09-04T09:12:00.000Z',
};

/**
 * A DIFFERENT LIVE SESSION ON THE SAME TABLET — the one in the way of a
 * `device_busy` refusal. A different patient name from `SESSION`/`READY` on
 * purpose, so a test can tell the refusal named THIS session rather than
 * merely echoing the row being sent.
 */
const BUSY_SESSION: TabletSessionRow = {
  ...SESSION,
  id: 'session-busy',
  patientName: 'Alex Otherpatient',
};

/**
 * A TABLET WHOSE LAST SESSION ENDED. `timed_out` is the tablet's own
 * inactivity clock — nobody pressed anything — and it leaves the AGREEMENT
 * untouched, which is why the row can simply be sent again.
 *
 * A UUID-SHAPED ID ON PURPOSE: the console shows the first eight characters so
 * reception and the tablet's footer can be matched by eye, and `session-1`
 * would make that assertion prove nothing.
 */
const ENDED: TabletSessionRow = {
  ...SESSION,
  id: '8ff09d7b-2222-4000-8000-000000000002',
  state: 'timed_out',
  endedAt: '2026-09-04T09:20:00.000Z',
};

/**
 * THE PATIENT READ THE ONGOING AGREEMENT AND SAID THEY WOULD RATHER AGREE EACH
 * VISIT (Carl, 4 Sep 2026; GA-PLAN B5). An ENDING like the others -- nothing
 * on the agreement moved -- with its own word, because reception's next act
 * depends on knowing the difference between this and a walk-away.
 */
const DECLINED: TabletSessionRow = {
  ...SESSION,
  id: '8ff09d7b-3333-4000-8000-000000000003',
  agreementId: 'agreement-enduring',
  agreementType: 'enduring',
  state: 'declined_enduring',
  endedAt: '2026-09-04T09:22:00.000Z',
};

/** The enduring row itself, for the heading assertions. */
const ENDURING_ROW = {
  ...READY,
  agreementId: 'agreement-enduring',
  agreementType: 'enduring',
  serviceDescription: null,
  serviceDescriptionValid: false,
};

const TABLET_TWO: DeviceRow = { ...TABLET, id: 'device-2', label: 'Reception tablet 2' };

/** The SERVER giving up after thirty minutes, on a different tablet. */
const EXPIRED: TabletSessionRow = {
  ...ENDED,
  id: '9aa11c2d-3333-4000-8000-000000000003',
  deviceId: TABLET_TWO.id,
  deviceLabel: TABLET_TWO.label,
  state: 'expired',
};

/** A live session with a real-shaped id, for the short-id assertions. */
const LIVE_UUID: TabletSessionRow = {
  ...SESSION,
  id: '8ff09d7b-1111-4000-8000-000000000001',
};

/**
 * D6a, AS THE SERVER SENDS IT — the words and the VERSION of the list they
 * came from (hard rule 14). The console never holds these strings.
 */
const DESCRIPTIONS = {
  version: '2026-08',
  descriptions: ['General practitioner attendance', 'Specialist attendance'],
};

/** What `GET /patients/:id/details` answers — the six correctable fields. */
const DETAILS = {
  id: 'patient-1',
  givenNames: 'Jamie',
  familyName: 'Sampleton',
  dateOfBirth: '1957-03-14',
  address: '404 Wrongway Parade, Sampletown NSW 2000',
  mobile: '+61400000404',
  email: 'jamie.sampleton@example.invalid',
  detailsCorrectedAt: null,
};

const calls: Array<{ url: string; method: string; body: unknown }> = [];

function stubFetch(
  opts: {
    rows?: unknown[];
    devices?: DeviceRow[];
    /**
     * A PLAIN LIST, OR A FUNCTION READ FRESH ON EVERY POLL — the function
     * form is for a test that wants a session to appear BETWEEN two reads
     * (the same race `device_busy` is named for), rather than being present
     * from the very first load.
     */
    sessions?: TabletSessionRow[] | (() => TabletSessionRow[]);
    staff?: string[];
    details?: unknown;
    content?: unknown;
    onPost?: (url: string) => { ok: boolean; status?: number; payload?: unknown };
  } = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });

      if (method === 'GET') {
        const liveSessions = typeof opts.sessions === 'function' ? opts.sessions() : (opts.sessions ?? []);
        const payload = url.includes('/patients/')
          ? (opts.details ?? DETAILS)
          : url.includes('/service-descriptions')
          ? (opts.content ?? DESCRIPTIONS)
          : url.includes('/tablet-sessions/pushable')
          ? (opts.rows ?? [READY, BLOCKED])
          : url.includes('/tablet-sessions')
            ? liveSessions
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
      onPost: (url) =>
        url.includes('/push')
          ? { ok: false, status: 409, payload: { reason: 'device_busy', message: 'raw server text' } }
          : { ok: true, payload: {} },
    });
    render(<TabletView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`target-${READY.agreementId}`)).toBeTruthy());
    fireEvent.change(screen.getByTestId(`target-${READY.agreementId}`), { target: { value: TABLET.id } });
    fireEvent.click(screen.getByTestId(`send-${READY.agreementId}`));

    await waitFor(() => expect(screen.getByTestId(`push-outcome-${READY.agreementId}`)).toBeTruthy());
    const outcome = screen.getByTestId(`push-outcome-${READY.agreementId}`);
    // OUR words, naming the tablet reception just chose — never the server's
    // own sentence, and never "the practice queue" (Carl's live test, 4 Sep
    // 2026 — that fallback sent reception looking for a screen that does not
    // exist).
    expect(outcome.textContent).toContain(
      strings.tablet.blocked.device_busy(TABLET.label, strings.tablet.blocked.device_busySomeone),
    );
    expect(outcome.textContent).not.toContain('raw server text');
    expect(outcome.textContent).not.toMatch(/practice queue/i);

    const push = calls.find((c) => c.method === 'POST' && c.url.includes('/push'));
    expect(push!.url).toContain(`/devices/${TABLET.id}/push`);
    expect(push!.body).toEqual({ agreementId: READY.agreementId });
  });

  /**
   * CARL'S OWN LIVE TEST, THE ONE THIS COMMIT EXISTS FOR (4 Sep 2026): Jamie
   * Sampleton was pushable, Send refused with a 409, and the band read "This
   * one cannot be sent yet. Please see the practice queue" — a sentence with
   * nothing true in it, sending reception to a screen that does not exist.
   * `device_busy` names the tablet AND the patient already on it, and offers
   * Recall right there so Send can be pressed again without reception going
   * to find the tablet themselves.
   */
  it('busy_tablet_refusal_offers_recall_inline', async () => {
    signedInAtPractice();
    /*
     * THE RACE, MADE CONCRETE. `device_busy` fires because the device just
     * became busy on the SERVER since this screen's last poll — so the
     * tablet reads as free here (Send is reachable), and `BUSY_SESSION`
     * exists only from the moment the push is refused, exactly as it would
     * on the real one-session-per-device unique index
     * (`apps/core/src/tablet-sessions/tablet-sessions.service.ts`). The
     * refusal triggers a fresh read, which is what actually finds the name.
     */
    let liveSessions: TabletSessionRow[] = [];
    stubFetch({
      sessions: () => liveSessions,
      onPost: (url) => {
        if (url.includes('/push')) {
          liveSessions = [BUSY_SESSION];
          return { ok: false, status: 409, payload: { reason: 'device_busy', sessionId: BUSY_SESSION.id } };
        }
        return { ok: true, payload: {} };
      },
    });
    render(<TabletView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`target-${READY.agreementId}`)).toBeTruthy());
    fireEvent.change(screen.getByTestId(`target-${READY.agreementId}`), { target: { value: TABLET.id } });
    fireEvent.click(screen.getByTestId(`send-${READY.agreementId}`));

    const outcome = await screen.findByTestId(`push-outcome-${READY.agreementId}`);
    // NAMES THE TABLET AND WHO IS ON IT, found from the sessions this page
    // already polls — never a message with nothing true in it.
    expect(outcome.textContent).toContain(TABLET.label);
    expect(outcome.textContent).toContain(BUSY_SESSION.patientName);
    expect(outcome.textContent).not.toMatch(/practice queue/i);

    // RECALL IS RIGHT THERE — reception need not go and find the tablet.
    const recallButton = screen.getByTestId(`push-outcome-recall-${READY.agreementId}`);
    fireEvent.click(recallButton);

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.includes(`/tablet-sessions/${BUSY_SESSION.id}/recall`))).toBe(
        true,
      ),
    );
  });

  /**
   * A REFUSAL WITH SOMEWHERE REAL TO GO. `service_description_missing` links
   * to the reconciliation screen, which is where D6a is actually set — never
   * a dead end and never a vague "see the practice queue".
   */
  it('d6a_refusal_links_to_the_reconciliation_row', async () => {
    stubFetch();
    render(<TabletView practiceId={PRACTICE} />);

    const band = await screen.findByTestId(`blocked-${BLOCKED.agreementId}`);
    expect(band.textContent).toContain(strings.tablet.blocked.service_description_missing);

    const link = within(band).getByTestId(`blocked-link-${BLOCKED.agreementId}`) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/practice/reconciliation');
    expect(link.textContent).toBe(strings.tablet.toReconciliationForD6a);
  });

  /**
   * A REASON THIS BUILD HAS NOT MET YET STILL SHOWS ITS OWN CODE, rather than
   * a generic sentence that swallows it. Support cannot act on "cannot be
   * sent yet"; they can act on a code.
   */
  it('unmapped_refusal_shows_its_code', async () => {
    signedInAtPractice();
    stubFetch({
      onPost: (url) =>
        url.includes('/push')
          ? { ok: false, status: 409, payload: { reason: 'a_reason_from_a_newer_server' } }
          : { ok: true, payload: {} },
    });
    render(<TabletView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`target-${READY.agreementId}`)).toBeTruthy());
    fireEvent.change(screen.getByTestId(`target-${READY.agreementId}`), { target: { value: TABLET.id } });
    fireEvent.click(screen.getByTestId(`send-${READY.agreementId}`));

    const outcome = await screen.findByTestId(`push-outcome-${READY.agreementId}`);
    // THE RAW CODE, ON SCREEN — never swallowed into a sentence that sends
    // somebody to look for a page that does not exist.
    expect(outcome.textContent).toContain('a_reason_from_a_newer_server');
    expect(outcome.textContent).not.toMatch(/practice queue/i);
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
    // The view-only marker renders before the pushable list has resolved, so
    // wait for each control rather than assume it is already there (flaked once
    // in CI on exactly this ordering).
    expect(((await screen.findByTestId(`send-${READY.agreementId}`)) as HTMLButtonElement).disabled).toBe(true);
    expect(((await screen.findByTestId(`recall-${SESSION.id}`)) as HTMLButtonElement).disabled).toBe(true);
    expect(((await screen.findByTestId(`who-open-${READY.agreementId}`)) as HTMLButtonElement).disabled).toBe(true);
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

/**
 * RECEPTION SEES WHAT THE PATIENT DID NOT AGREE TO, AND CAN FIX IT
 * (Carl, 4 Sep 2026: "The practice-reception-user is sitting behind the desk
 * and should be able to see the same screen and be told what the patient did
 * not agree to. Then the practice-reception-user will correct the incorrect
 * detail and re-push.").
 *
 * WHAT THIS PINS:
 *
 *  - THE DISPUTED TYPES ARE ON THE ROW, IN OUR WORDS, and the VALUES are not —
 *    this page is a status, not a mirror of a tablet, and a date of birth on a
 *    monitor facing the waiting room is a disclosure nobody asked for. The
 *    values arrive only when somebody opens Correct.
 *  - THE CORRECTION CONTROL CARRIES CARL'S CAVEAT VERBATIM. The PMS is the
 *    source of truth (REQ-DATA-10) and until D-01 lands the next sync would
 *    undo this, so the sentence sits in front of the person typing.
 *  - ONLY THE CHANGED FIELDS ARE SENT, so the vault does not fill with events
 *    saying somebody changed something when nobody did.
 *  - RE-SEND IS ONE PRESS, and when the server says a locked agreement was
 *    superseded (HARD-02) reception is told in words rather than watching an
 *    id change under them.
 */
describe('console_shows_disputed_details_and_offers_correct_and_resend', () => {
  /*
   * ITS OWN RESET. `session` and `calls` are module-level, and the last test
   * of the suite above leaves a signed-in practice user behind — which would
   * quietly grant the practice audience to the view-only test below and make
   * it assert nothing.
   */
  beforeEach(() => {
    calls.length = 0;
    session = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names the crossed details as TYPES, never the values, on the live row', async () => {
    signedInAtPractice();
    stubFetch({ sessions: [DISPUTED] });
    render(<TabletView practiceId={PRACTICE} />);

    const banner = await screen.findByTestId(`disputed-${DISPUTED.id}`);
    expect(banner.textContent).toContain(strings.tablet.disputedList('Address, Mobile number'));
    // The state reads as work to do rather than as a failure — the patient did
    // exactly what the screen asked.
    expect(screen.getByTestId(`tablet-state-${TABLET.id}`).textContent).toContain(
      strings.tablet.states.details_disputed,
    );

    /*
     * AND NOT ONE VALUE IS ON THE PAGE BEFORE ANYBODY ASKS FOR IT. Nothing has
     * fetched the patient's details, because reception is watching a status.
     */
    const page = document.body.textContent ?? '';
    expect(page).not.toContain('404 Wrongway Parade');
    expect(page).not.toContain('+61400000404');
    expect(page).not.toContain('1957-03-14');
    expect(calls.some((c) => c.url.includes('/patients/'))).toBe(false);
    // Nor a dollar amount (hard rule 4) or a claim of certification (rule 12).
    expect(page).not.toMatch(/\$\s?\d/);
    expect(page).not.toMatch(/certified|accredited|government-approved/i);
  });

  /**
   * UPDATED 4 SEP 2026, AND THE CHANGE IS THE POINT. This used to assert that
   * ONLY the crossed fields rendered. Carl's ruling from live testing replaced
   * that rule: "just in case the patient says my mobile is also wrong but I
   * ticked yes". All five details open; the crossed ones are MARKED. The half
   * of the old test that still holds — the caveat verbatim, and only the
   * changed field on the wire — is unchanged, because those were never about
   * which fields were drawn.
   */
  it('correct_panel_shows_all_five_details_with_disputed_highlighted', async () => {
    signedInAtPractice();
    stubFetch({ sessions: [DISPUTED] });
    render(<TabletView practiceId={PRACTICE} />);

    fireEvent.click(await screen.findByTestId(`correct-open-${DISPUTED.id}`));

    // ALL FIVE DETAILS — six columns, because a name is two of them and one
    // question. Every one pre-filled with what the platform holds.
    const address = (await screen.findByTestId(`correct-address-${DISPUTED.id}`)) as HTMLInputElement;
    const mobile = screen.getByTestId(`correct-mobile-${DISPUTED.id}`) as HTMLInputElement;
    const email = screen.getByTestId(`correct-email-${DISPUTED.id}`) as HTMLInputElement;
    const dob = screen.getByTestId(`correct-dateOfBirth-${DISPUTED.id}`) as HTMLInputElement;
    const given = screen.getByTestId(`correct-givenNames-${DISPUTED.id}`) as HTMLInputElement;
    const family = screen.getByTestId(`correct-familyName-${DISPUTED.id}`) as HTMLInputElement;
    expect(address.value).toBe(DETAILS.address);
    expect(mobile.value).toBe(DETAILS.mobile);
    expect(email.value).toBe(DETAILS.email);
    expect(dob.value).toBe(DETAILS.dateOfBirth);
    expect(given.value).toBe(DETAILS.givenNames);
    expect(family.value).toBe(DETAILS.familyName);

    // THE CROSSED ONES ARE MARKED, and the rest are not — the panel still says
    // what the tablet reported, it simply does not hide the rest.
    expect(
      screen.getByTestId(`correct-field-address-${DISPUTED.id}`).getAttribute('data-disputed'),
    ).toBe('true');
    expect(
      screen.getByTestId(`correct-field-mobile-${DISPUTED.id}`).getAttribute('data-disputed'),
    ).toBe('true');
    expect(
      screen.getByTestId(`correct-field-email-${DISPUTED.id}`).getAttribute('data-disputed'),
    ).toBe('false');
    // IN WORDS AS WELL AS IN COLOUR — a colour-only distinction is not a
    // distinction (WCAG 2.2 AA).
    expect(screen.getByTestId(`correct-field-address-${DISPUTED.id}`).textContent).toContain(
      strings.tablet.correctDisputedTag,
    );

    // CARL'S CAVEAT, WORD FOR WORD.
    expect(screen.getByTestId(`correct-caveat-${DISPUTED.id}`).textContent).toContain(
      'Also update this in your practice software — the next sync will bring the old value back otherwise.',
    );

    fireEvent.change(address, { target: { value: '1 Corrected Way, Sampletown NSW 2000' } });
    fireEvent.click(screen.getByTestId(`correct-save-${DISPUTED.id}`));

    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toContain(`/patients/${DISPUTED.patientId}/details`);
    // ONLY THE CHANGED FIELD, still — five fields on screen and one on the
    // wire. An unchanged field must never become a correction event, and
    // opening the whole record must not make it one.
    expect(patch.body).toEqual({ address: '1 Corrected Way, Sampletown NSW 2000' });

    // AND WHY IT WAS MADE, ON THE SESSION — the cross and its answer are one
    // story rather than two unconnected facts.
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/dispute-resolution'))).toBe(true),
    );
    const resolved = calls.find((c) => c.url.includes('/dispute-resolution'))!;
    expect(resolved.body).toEqual({ outcome: 'corrected', details: ['address'] });
  });

  it('re-sends in one press and says plainly when a locked agreement was superseded', async () => {
    signedInAtPractice();
    stubFetch({
      sessions: [DISPUTED],
      onPost: (url) =>
        url.includes('/resend')
          ? { ok: true, payload: { supersededAgreementId: 'agreement-ready' } }
          : { ok: true, payload: {} },
    });
    render(<TabletView practiceId={PRACTICE} />);

    fireEvent.click(await screen.findByTestId(`resend-${DISPUTED.id}`));

    await waitFor(() => expect(calls.some((c) => c.url.includes('/resend'))).toBe(true));
    const resend = calls.find((c) => c.url.includes('/resend'))!;
    expect(resend.method).toBe('POST');
    expect(resend.url).toContain(`/tablet-sessions/${DISPUTED.id}/resend`);

    /*
     * HARD-02 IN WORDS AT THE DESK. The agreement's id changes under
     * reception, and a silent replacement is how people stop trusting a
     * screen.
     */
    const outcome = await screen.findByTestId(`recall-outcome-${TABLET.id}`);
    expect(outcome.textContent).toContain(strings.tablet.resendSuperseded);
  });

  it('shows the server’s own rule text when a correction is refused', async () => {
    signedInAtPractice();
    const refusal =
      'The Medicare card number is not an identity identifier and is never held here — the exclusion is ' +
      'not configurable (REQ-VER-02).';
    stubFetch({
      sessions: [DISPUTED],
      onPost: () => ({ ok: false, status: 400, payload: { message: refusal } }),
    });
    render(<TabletView practiceId={PRACTICE} />);

    fireEvent.click(await screen.findByTestId(`correct-open-${DISPUTED.id}`));
    const address = (await screen.findByTestId(`correct-address-${DISPUTED.id}`)) as HTMLInputElement;
    fireEvent.change(address, { target: { value: '2 Anywhere Street' } });
    fireEvent.click(screen.getByTestId(`correct-save-${DISPUTED.id}`));

    // THE SERVER'S SENTENCE, AS IT CAME. A rule has one home, and paraphrasing
    // it here would be a second copy of it.
    const outcome = await screen.findByTestId(`correct-outcome-${TABLET.id}`);
    expect(outcome.textContent).toContain('not an identity identifier');
  });

  it('offers neither control to a reader without the practice’s own claim', async () => {
    // No session at all: `audiencesOf` gives nothing, so `mayPush` is false.
    stubFetch({ sessions: [DISPUTED] });
    render(<TabletView practiceId={PRACTICE} />);

    expect(((await screen.findByTestId(`correct-open-${DISPUTED.id}`)) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(((await screen.findByTestId(`resend-${DISPUTED.id}`)) as HTMLButtonElement).disabled).toBe(true);
    // But they can still SEE what is wrong — the person asked "why has that
    // tablet not finished" is the one person who needs the answer.
    expect(screen.getByTestId(`disputed-${DISPUTED.id}`).textContent).toContain('Address');
  });

  it('maps a crossed type to the columns that answer it — a name is two columns and one row', () => {
    expect(disputedLabels(['address', 'mobile'])).toBe('Address, Mobile number');
    // The patient reads one question; the platform stores two columns.
    expect(fieldsToCorrect(['name'])).toEqual(['givenNames', 'familyName']);
    expect(fieldsToCorrect(['name', 'address'])).toEqual(['givenNames', 'familyName', 'address']);
    // An unknown type contributes nothing rather than throwing — a server that
    // grows a sixth detail must not blank the correction panel.
    expect(fieldsToCorrect(['something_new'])).toEqual([]);
  });
});

/**
 * FOUR RULINGS FROM CARL'S LIVE TESTING OF THE RECEPTION-PUSH LOOP (4 Sep
 * 2026), and one label.
 *
 *  - THE BLOCKED ROW CARRIES ITS OWN FIX. "Shortcuts to the answer, not
 *    directions to a screen" (CLAUDE.md section 7): the description is chosen
 *    on the row that says it is missing, from the SERVER's versioned list, and
 *    the reconciliation link stays as the secondary route.
 *  - A DISPUTE HAS TWO HONEST ENDINGS. The patient may have crossed a detail
 *    that was right; recording that as a "correction" would put an event in
 *    the vault claiming a change nobody made.
 *  - AN ENDED SESSION IS SENT AGAIN FROM THE ROW THAT SAID IT ENDED. Walking
 *    away, timing out, recall and expiry leave the agreement untouched (hard
 *    rule 8, REQ-REC-04), so it is an ordinary push -- with the ordinary
 *    refusal mapping when the agreement has since moved on.
 *  - `timed_out` AND `expired` READ AS DIFFERENT THINGS, because they ARE: the
 *    tablet's own clock, and the server giving up. Reception acts differently
 *    on the two.
 *  - THE SHORT SESSION ID IS ON THE ROW, matching the tablet's footer, so a
 *    screen and a person can be paired by eye.
 */
describe('the reception-push loop -- set, resolve, send again', () => {
  beforeEach(() => {
    calls.length = 0;
    session = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('d6a_can_be_set_inline_on_the_blocked_row', async () => {
    signedInAtPractice();
    stubFetch();
    render(<TabletView practiceId={PRACTICE} />);

    const band = await screen.findByTestId(`blocked-${BLOCKED.agreementId}`);
    expect(band.textContent).toContain(strings.tablet.blocked.service_description_missing);

    // THE CONTROL IS IN THE BAND THAT STATES THE PROBLEM.
    const fix = await screen.findByTestId(`d6a-fix-${BLOCKED.agreementId}`);
    // WHICH LIST IT IS OFFERING (hard rule 14) -- never a version this file
    // decided on.
    expect(fix.textContent).toContain(strings.tablet.d6aListVersion(DESCRIPTIONS.version));
    // AND THE WORDS CAME FROM THE SERVER, in the order it sent them.
    expect(within(fix).getByText(DESCRIPTIONS.descriptions[0])).toBeTruthy();
    expect(within(fix).getByText(DESCRIPTIONS.descriptions[1])).toBeTruthy();

    // Dead until a description is chosen (CLAUDE.md section 6).
    expect((screen.getByTestId(`d6a-set-${BLOCKED.agreementId}`) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByTestId(`d6a-select-${BLOCKED.agreementId}`), {
      target: { value: DESCRIPTIONS.descriptions[1] },
    });
    await waitFor(() =>
      expect((screen.getByTestId(`d6a-set-${BLOCKED.agreementId}`) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByTestId(`d6a-set-${BLOCKED.agreementId}`));

    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/service-descriptions/agreements/'))).toBe(true),
    );
    const posted = calls.find((c) => c.url.includes('/service-descriptions/agreements/'))!;
    expect(posted.method).toBe('POST');
    // THE EXISTING STAFF ENDPOINT, unchanged -- this adds a second place to
    // press it, not a second way of doing it.
    expect(posted.url).toContain(`/service-descriptions/agreements/${BLOCKED.agreementId}`);
    expect(posted.body).toEqual({ description: DESCRIPTIONS.descriptions[1] });

    // AND THE RECONCILIATION LINK IS STILL THERE, as the secondary route.
    const link = within(band).getByTestId(`blocked-link-${BLOCKED.agreementId}`) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/practice/reconciliation');
  });

  it('no_change_needed_records_patient_error_then_resends', async () => {
    signedInAtPractice();
    stubFetch({ sessions: [DISPUTED] });
    render(<TabletView practiceId={PRACTICE} />);

    // THE SCREEN SAYS IT IS RECORDED, AND AGAINST WHOM, BEFORE ANYBODY PRESSES.
    const banner = await screen.findByTestId(`disputed-${DISPUTED.id}`);
    expect(banner.textContent).toContain(strings.tablet.noChangeNote);

    fireEvent.click(await screen.findByTestId(`no-change-${DISPUTED.id}`));

    await waitFor(() => expect(calls.some((c) => c.url.includes('/dispute-resolution'))).toBe(true));
    const resolved = calls.find((c) => c.url.includes('/dispute-resolution'))!;
    expect(resolved.method).toBe('POST');
    expect(resolved.url).toContain(`/tablet-sessions/${DISPUTED.id}/dispute-resolution`);
    // THE TYPES THE PATIENT CROSSED, never a value (REQ-VER-04).
    expect(resolved.body).toEqual({ outcome: 'patient_error', details: ['address', 'mobile'] });
    expect(JSON.stringify(resolved.body)).not.toContain('404 Wrongway Parade');

    // AND NOTHING WAS CHANGED. The whole reason this exists is that the only
    // other way out was a correction event for a change nobody made.
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);

    // RE-SEND IS THE NEXT PRESS, and after `patient_error` it sends the SAME
    // agreement -- nothing was corrected, so nothing supersedes.
    fireEvent.click(screen.getByTestId(`resend-${DISPUTED.id}`));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/resend'))).toBe(true));
    expect(calls.find((c) => c.url.includes('/resend'))!.url).toContain(
      `/tablet-sessions/${DISPUTED.id}/resend`,
    );
  });

  it('ended_session_row_offers_send_again', async () => {
    signedInAtPractice();
    stubFetch({ sessions: [ENDED] });
    render(<TabletView practiceId={PRACTICE} />);

    // The tablet is idle, and says what it last did -- a name and an ending,
    // still a status rather than a mirror.
    const last = await screen.findByTestId(`tablet-last-${TABLET.id}`);
    expect(last.textContent).toContain(ENDED.patientName);
    expect(last.textContent).toContain(strings.tablet.states.timed_out);

    const again = screen.getByTestId(`send-again-${ENDED.id}`) as HTMLButtonElement;
    expect(again.disabled).toBe(false);
    fireEvent.click(again);

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/push'))).toBe(true),
    );
    const push = calls.find((c) => c.method === 'POST' && c.url.includes('/push'))!;
    // THE SAME PUSH, TO THE SAME TABLET, FOR THE SAME AGREEMENT. There is one
    // push in this product.
    expect(push.url).toContain(`/devices/${ENDED.deviceId}/push`);
    expect(push.body).toEqual({ agreementId: ENDED.agreementId });
  });

  it('declining_enduring_offers_episodic_for_the_visit', async () => {
    signedInAtPractice();
    stubFetch({ sessions: [DECLINED], rows: [] });
    render(<TabletView practiceId={PRACTICE} />);

    /*
     * THE ROW SAYS WHAT HAPPENED IN WORDS A RECEPTIONIST CAN ACT ON, and not
     * "declined" on its own -- the patient has refused neither bulk billing
     * nor care, and the next thing to do is beside the sentence.
     */
    const last = await screen.findByTestId(`tablet-last-${TABLET.id}`);
    expect(last.textContent).toContain(strings.tablet.states.declined_enduring);

    /*
     * AND IT IS NOT "SEND AGAIN". Handing the patient back the ongoing
     * agreement they have just answered is the one offer they have already
     * declined; the control on this row is a DIFFERENT agreement.
     */
    expect(screen.queryByTestId(`send-again-${DECLINED.id}`)).toBeNull();

    const offer = (await screen.findByTestId(`offer-episodic-${DECLINED.id}`)) as HTMLButtonElement;
    expect(offer.disabled).toBe(false);
    expect(offer.textContent).toContain(strings.tablet.offerEpisodicAction);

    fireEvent.click(offer);

    /*
     * ONE PRESS, ONE SERVER ACT. The draft, the description of the service and
     * the push are all the server's -- a screen that assembled an agreement
     * would be a screen asserting a contract.
     */
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/offer-episodic'))).toBe(true),
    );
    const offered = calls.find((c) => c.url.includes('/offer-episodic'))!;
    expect(offered.url).toContain(`/tablet-sessions/${DECLINED.id}/offer-episodic`);
    // NOT a push composed here, and not a draft composed here.
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/devices/'))).toBe(false);
    expect(JSON.stringify(offered.body ?? {})).not.toContain('Jamie');
  });

  it('enduring_is_per_provider_and_patient_never_per_practice', async () => {
    signedInAtPractice();
    stubFetch({ rows: [ENDURING_ROW] });
    render(<TabletView practiceId={PRACTICE} />);

    /*
     * THE ROW NAMES THE PROVIDER (hard rule 6, REQ-END-01). This is the one
     * line where a receptionist would otherwise read an ongoing agreement as
     * something the PRACTICE has with the patient, which is the rule broken in
     * the one place somebody would believe it.
     */
    const line = await screen.findByTestId(`row-line-${ENDURING_ROW.agreementId}`);
    expect(line.textContent).toBe(strings.tablet.enduringRow('Dr Example Provider'));
    expect(line.textContent).toContain('Dr Example Provider');
    expect(line.textContent).not.toMatch(/practice|clinic/i);
    // And no appointment time: a standing agreement is not about a booking.
    expect(line.textContent).not.toContain('09:00');
  });

  it('a send-again whose agreement has moved on is dead, and says why', async () => {
    signedInAtPractice();
    // The pushable list no longer holds it -- signed, superseded, or captured
    // another way. That is exactly what `agreement_not_pushable` says.
    stubFetch({ sessions: [ENDED], rows: [BLOCKED] });
    render(<TabletView practiceId={PRACTICE} />);

    const again = (await screen.findByTestId(`send-again-${ENDED.id}`)) as HTMLButtonElement;
    expect(again.disabled).toBe(true);

    const band = screen.getByTestId(`send-again-blocked-${ENDED.id}`);
    expect(band.textContent).toContain(strings.tablet.blocked.agreement_not_pushable);
    // A way forward, never a dead end (CLAUDE.md section 7).
    expect(
      (within(band).getByTestId(`send-again-link-${ENDED.id}`) as HTMLAnchorElement).getAttribute('href'),
    ).toBe('/practice/reconciliation');
    expect(band.textContent).not.toMatch(/practice queue/i);
  });

  it('timed_out_and_expired_have_distinct_labels', async () => {
    // Two different facts, and reception acts differently on each: the
    // tablet's own clock reset a screen nobody was at; the SERVER gave up on a
    // tablet that stopped asking altogether. One word for both is the bug.
    expect(strings.tablet.states.timed_out).toBeTruthy();
    expect(strings.tablet.states.expired).toBeTruthy();
    expect(strings.tablet.states.timed_out).not.toBe(strings.tablet.states.expired);

    signedInAtPractice();
    stubFetch({ devices: [TABLET, TABLET_TWO], sessions: [ENDED, EXPIRED] });
    render(<TabletView practiceId={PRACTICE} />);

    const first = await screen.findByTestId(`tablet-last-${TABLET.id}`);
    const second = await screen.findByTestId(`tablet-last-${TABLET_TWO.id}`);
    expect(first.textContent).toContain(strings.tablet.states.timed_out);
    expect(first.textContent).not.toContain(strings.tablet.states.expired);
    expect(second.textContent).toContain(strings.tablet.states.expired);
    expect(second.textContent).not.toContain(strings.tablet.states.timed_out);
  });

  it('rows_show_the_session_id_short', async () => {
    signedInAtPractice();
    stubFetch({
      sessions: [LIVE_UUID],
      rows: [{ ...READY, activeSession: { id: LIVE_UUID.id, deviceId: TABLET.id, state: 'reading' } }],
    });
    render(<TabletView practiceId={PRACTICE} />);

    const short = strings.tablet.sessionTag('8ff09d7b');

    // ON THE AGREEMENT'S ROW ...
    expect((await screen.findByTestId(`row-session-id-${READY.agreementId}`)).textContent).toBe(short);
    // ... AND ON THE TABLET'S. The tablet's own footer shows the same eight
    // characters, so a screen and a person can be paired by eye.
    expect(screen.getByTestId(`tablet-session-id-${TABLET.id}`).textContent).toBe(short);

    // EIGHT CHARACTERS, NOT THE WHOLE ID -- long enough to be unique among a
    // morning's sessions, short enough to read across a desk.
    expect(document.body.textContent ?? '').not.toContain(LIVE_UUID.id);
  });

  /**
   * ONCE THE CROSS IS ANSWERED, THE ROW SAYS SO (Carl, 4 Sep 2026).
   *
   * The gap this closes is the one between reception fixing a detail and
   * sending it again: the row used to go on saying "a detail is wrong" at the
   * person who had just dealt with it, which is a screen telling somebody
   * something they know and not the thing they need.
   */
  it('resolved_dispute_row_reads_ready_to_resend', async () => {
    signedInAtPractice();
    /*
     * THE RESOLUTION ARRIVES ON THE POLL, as it does in life: reception's
     * screen learns of it from the server, not from having been the tab that
     * pressed the button — a colleague may have answered it at the next desk.
     */
    let live: TabletSessionRow[] = [DISPUTED];
    stubFetch({ sessions: () => live });
    render(<TabletView practiceId={PRACTICE} />);

    // BEFORE: what was crossed, and the two ways to answer it.
    await screen.findByTestId(`disputed-${DISPUTED.id}`);
    expect(screen.getByTestId(`no-change-${DISPUTED.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`resolved-${DISPUTED.id}`)).toBeNull();

    live = [RESOLVED];

    // AFTER: the row reads as answered, and the crossed detail is still named
    // — reception may be a different person from the one who fixed it.
    const resolved = await screen.findByTestId(`resolved-${RESOLVED.id}`, undefined, { timeout: 5000 });
    expect(resolved.textContent).toContain(strings.tablet.resolvedTitle);
    expect(resolved.textContent).toContain(strings.tablet.resolvedPatientError);
    expect(screen.getByTestId(`resolved-was-${RESOLVED.id}`).textContent).toContain(
      strings.tablet.resolvedWas('Address, Mobile number'),
    );
    // The short id, so the row can be matched to the tablet by eye.
    expect(screen.getByTestId(`resolved-session-id-${RESOLVED.id}`).textContent).toBe(
      strings.tablet.sessionTag(RESOLVED.id.slice(0, 8)),
    );

    // THE "a detail is wrong" BANNER IS GONE, and so is "No change needed" —
    // pressing it now would only overwrite one answer with another.
    expect(screen.queryByTestId(`disputed-${RESOLVED.id}`)).toBeNull();
    expect(screen.queryByTestId(`no-change-${RESOLVED.id}`)).toBeNull();

    // RE-SEND IS THE PRIMARY ACTION, and Correct stays available for another go.
    const resend = screen.getByTestId(`resend-${RESOLVED.id}`) as HTMLButtonElement;
    expect(resend.disabled).toBe(false);
    // The CSS module hashes the name, so match the variant rather than the class.
    expect(resend.className).toMatch(/buttonPrimary/);
    expect((screen.getByTestId(`correct-open-${RESOLVED.id}`) as HTMLButtonElement).disabled).toBe(false);

    // AND NOT ONE VALUE, still — the row is a status, not a mirror.
    const page = document.body.textContent ?? '';
    expect(page).not.toContain('404 Wrongway Parade');
    expect(page).not.toContain('+61400000404');

    fireEvent.click(resend);
    await waitFor(() => expect(calls.some((c) => c.url.includes('/resend'))).toBe(true));
    expect(calls.find((c) => c.url.includes('/resend'))!.url).toContain(
      `/tablet-sessions/${RESOLVED.id}/resend`,
    );
  });

  it('an ended session shows its short id too, on the line that says how it ended', async () => {
    signedInAtPractice();
    stubFetch({ sessions: [ENDED] });
    render(<TabletView practiceId={PRACTICE} />);

    const last = await screen.findByTestId(`tablet-last-${TABLET.id}`);
    expect(last.textContent).toContain(strings.tablet.states.timed_out);
    expect(screen.getByTestId(`tablet-last-session-id-${TABLET.id}`).textContent).toBe(
      strings.tablet.sessionTag('8ff09d7b'),
    );
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
    expect(blockedMessage('enduring_rules_not_authored')).toBe(
      strings.tablet.blocked.enduring_rules_not_authored,
    );
    expect(blockedMessage('enduring_not_per_provider')).toBe(
      strings.tablet.blocked.enduring_not_per_provider,
    );
    expect(blockedMessage('who_is_signing_unset')).toBe(strings.tablet.blocked.who_is_signing_unset);
    // A reason this build has not met yet still shows its own CODE — never
    // swallowed into a sentence that sends somebody looking for a screen
    // that does not exist (Carl's live test, 4 Sep 2026).
    expect(blockedMessage('a_reason_from_a_newer_server')).toBe(
      strings.tablet.blocked.other('a_reason_from_a_newer_server'),
    );
    expect(blockedMessage('a_reason_from_a_newer_server')).toContain('a_reason_from_a_newer_server');
    // No code at all (e.g. a 403 that carries no `reason`) still tells
    // somebody to go and look, rather than going silent.
    expect(blockedMessage(null)).toBe(strings.tablet.blocked.otherNoCode);
    expect(blockedMessage(null)).not.toMatch(/practice queue/i);
  });

  it('never_claims_certification_or_approval', () => {
    const words = [
      strings.tablet.blocked.device_unknown,
      strings.tablet.blocked.device_revoked,
      strings.tablet.blocked.device_not_paired,
      strings.tablet.blocked.device_busy('Reception tablet 1', 'Jamie Sampleton'),
      strings.tablet.blocked.device_busySomeone,
      strings.tablet.blocked.agreement_not_found,
      strings.tablet.blocked.agreement_not_pushable,
      strings.tablet.blocked.service_description_missing,
      strings.tablet.blocked.who_is_signing_unset,
      strings.tablet.blocked.patient_confidential,
      strings.tablet.blocked.enduring_rules_not_authored,
      strings.tablet.blocked.enduring_not_gp,
      strings.tablet.blocked.enduring_not_per_provider,
      strings.tablet.offerEpisodicAction,
      strings.tablet.offerEpisodicLead,
      strings.tablet.offerEpisodicDone,
      strings.tablet.enduringRow('Dr Example Provider'),
      strings.tablet.enduringRowNoProvider,
      strings.tablet.blocked.other('some_code'),
      strings.tablet.blocked.otherNoCode,
      strings.tablet.enduringOfferOther,
      strings.tablet.toReconciliationForD6a,
      strings.tablet.toReconciliationRow,
      strings.tablet.toDevices,
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
