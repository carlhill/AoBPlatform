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
  itemsFact,
  sendSteps,
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
  // An opaque id we minted, which the row now names so a support call can say
  // which record it is looking at. Never a Medicare number (hard rule 1).
  patientId: 'patient-1',
  providerName: 'Dr Example Provider',
  providerType: 'general_practitioner',
  appointmentDate: '2026-09-04',
  appointmentTime: '09:00',
  serviceDescription: 'General practitioner attendance',
  serviceDescriptionValid: true,
  // D5 AND D6b ARE A POST-AGREEMENT'S PARTICULARS, so a pre-agreement row
  // carries neither (REQ-REG-01: D6b is "post-agreements only").
  serviceDate: null,
  mbsItemNumbers: [] as string[],
  assignorIsPatient: true,
  assignorName: null,
  assignorRelationship: null,
  // NULL WHEREVER THE PATIENT SIGNS — there is no third party to reach.
  assignorMobile: null,
  assignorEmail: null,
  particularsLocked: false,
  // SOMEBODY HAS BEEN ASKED WHO IS SIGNING. The push waits for this, so a row
  // that is meant to be sendable carries it (Carl, 7 Sep 2026).
  assignorConfirmedAt: '2026-09-07T08:00:00.000Z',
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
  // The agreement behind it can still go to a tablet — so this session's
  // ending, when it gets one, is still work rather than history.
  agreementOutcome: null,
  disputedDetails: [],
  disputeResolution: null,
  disputeResolvedAt: null,
  signatureFailureReason: null,
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
 * THE SIGNATURE THE PLATFORM DID NOT RECORD (Carl, 7 Sep 2026).
 *
 * The person signed, the request reached the server, and the server refused
 * it -- here for the reason Carl actually hit: a tablet running a bundle from
 * before the statements existed, signing without them. An ENDING like the
 * others, changing NOTHING on the agreement, so the row offers the ordinary
 * send-again beneath a sentence that names the fix.
 */
const SIGNATURE_FAILED: TabletSessionRow = {
  ...SESSION,
  id: '8ff09d7b-4444-4000-8000-000000000004',
  state: 'signature_failed',
  signatureFailureReason: 'affirmations_missing',
  endedAt: '2026-09-07T09:24:00.000Z',
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

/**
 * THE SAME ONGOING AGREEMENT, REFUSED BECAUSE THE RULE SET IS NOT WRITTEN YET
 * (Carl, 5 Sep 2026; GA-PLAN B5). This is the ordinary state of every arrival
 * at a GP practice that offers ongoing agreements first, so it is the row a
 * receptionist meets most often -- and until today it carried no way out.
 */
const ENDURING_BLOCKED = {
  ...ENDURING_ROW,
  pushable: false,
  blockedReason: 'enduring_rules_not_authored' as const,
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
    /** Today's visits that needed no second signature — the history lines. */
    covered?: unknown[];
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
          // BEFORE the bare `/tablet-sessions` branch, because `covered`
          // contains it and Nest-style prefix matching here is just
          // `includes` — the same declaration-order trap the server's routes
          // have (wow.md section 1).
          : url.includes('/tablet-sessions/covered')
          ? (opts.covered ?? [])
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
  /*
   * THE TOP BAR ASKS WHETHER A SILENT RESTORE IS IN FLIGHT (auth.ts, 7 Sep
   * 2026). This suite is about the tablet page, not about a reload, so the
   * honest answer here is "no" — and a mock that simply omits the export makes
   * every render throw rather than fall through.
   */
  silentRestoreInFlight: () => false,
  // Nor was one refused: this suite is not about a reload, so the bar shows
  // its ordinary signed-in state.
  restoreRefusalReason: () => null,
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

  /**
   * WHICH RECORD EACH ROW IS ABOUT (Carl, 7 Sep 2026) — "every page must have
   * the patient GUID from AoBPlatform somewhere, so we can see which record has
   * the issue. Also helps with testing."
   *
   * IN FULL, AND ON BOTH LISTS. The agreement rows on the left and the tablet
   * showing a session on the right name the same id, which is how a support
   * call matches a device to a record exactly rather than by eye — the tablet's
   * own footer carries it too.
   */
  it('tablet_rows_show_the_patient_id', async () => {
    stubFetch({ sessions: [SESSION] });
    render(<TabletView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`pushable-${READY.agreementId}`)).toBeTruthy());
    const onRow = screen.getByTestId(`row-patient-id-${READY.agreementId}`);
    expect(onRow.textContent).toContain(READY.patientId);
    expect(onRow.textContent).toContain(strings.recordId.patient);

    // And on the device row that is showing that patient's session.
    const onDevice = await screen.findByTestId(`tablet-patient-id-${TABLET.id}`);
    expect(onDevice.textContent).toContain(SESSION.patientId);

    // IT IS AN ID WE MINTED, AND NOTHING ELSE ARRIVED WITH IT (hard rule 1).
    expect(document.body.textContent).not.toMatch(/medicare/i);
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

  /**
   * PREPARED IS NOT FINISHED (Carl, 7 Sep 2026: "go — fix who is signing on
   * locked rows").
   *
   * An arrival locks its particulars as reception posts it, so every row on
   * this list is prepared and the control died on all of them — the mother who
   * brought her son met a dead button. Who signs is still a locked particular:
   * the server supersedes rather than editing (HARD-02), and this pins that
   * the screen SAYS so before anybody types, and that the band lands on the
   * agreement that comes back rather than the one that is about to leave.
   */
  it('who_is_signing_enabled_on_locked_rows_and_explains_supersession', async () => {
    signedInAtPractice();
    const LOCKED = { ...READY, particularsLocked: true, status: 'awaiting_signature' };
    const REPLACEMENT = { ...LOCKED, agreementId: 'agreement-superseding' };
    /*
     * THE LIST THE SERVER WOULD RETURN AFTERWARDS. The superseding agreement
     * takes the old one's place — the old row's capture request is closed, so
     * `pushable` stops offering it — and the console re-reads rather than
     * patching, which is what makes the band land on a row that exists.
     */
    const rows: unknown[] = [LOCKED];
    stubFetch({
      rows,
      onPost: () => {
        rows.splice(0, rows.length, REPLACEMENT);
        return { ok: true, payload: { id: REPLACEMENT.agreementId } };
      },
    });
    render(<TabletView practiceId={PRACTICE} />);

    const open = (await screen.findByTestId(`who-open-${LOCKED.agreementId}`)) as HTMLButtonElement;
    expect(open.disabled).toBe(false);
    fireEvent.click(open);

    // WHAT SAVE WILL DO, said before anybody types.
    expect((await screen.findByTestId(`who-locked-${LOCKED.agreementId}`)).textContent).toBe(
      strings.tablet.whoLockedLead,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: strings.tablet.whoPatient }));
    fireEvent.change(screen.getByTestId(`who-name-${LOCKED.agreementId}`), {
      target: { value: 'Robin Relative' },
    });
    fireEvent.change(screen.getByTestId(`who-relationship-${LOCKED.agreementId}`), {
      target: { value: 'mother' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: strings.tablet.whoAgeConfirm(MIN_AGE_ASSIGN_FOR_OTHER) }));
    fireEvent.change(screen.getByTestId(`who-mobile-${LOCKED.agreementId}`), {
      target: { value: '0400 000 001' },
    });

    await waitFor(() =>
      expect((screen.getByTestId(`who-save-${LOCKED.agreementId}`) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId(`who-save-${LOCKED.agreementId}`));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const saved = calls.find((c) => c.method === 'POST')!;
    // THE SAME ENDPOINT as an unlocked row — the console does not decide which
    // of the two acts this is, and could not: the server owns HARD-02.
    expect(saved.url).toContain(`/agreements/${LOCKED.agreementId}/assignor`);

    // AND THE BAND LANDS ON THE AGREEMENT THAT CAME BACK, which is the row
    // that is about to appear rather than the one leaving the list.
    const band = await screen.findByTestId(`who-outcome-${REPLACEMENT.agreementId}`);
    expect(band.textContent).toContain(strings.tablet.whoSavedSuperseded);
  });

  /**
   * CARL'S REPRODUCTION, FROM THE CONSOLE END (10 September 2026): open "Who
   * is signing", change the carer's mobile, Save, reopen — and the OLD mobile
   * was still there.
   *
   * THE BUG WAS THE SERVER'S. A locked row's Save supersedes, and the second
   * Save on a row that had already been superseded was treated as a REPEAT of
   * the first if the NAME matched, so a corrected contact was answered with
   * the existing successor and nothing was written. The list also kept
   * offering the replaced row, so reception went on editing the agreement the
   * chain had left behind.
   *
   * WHAT THE CONSOLE HAS TO GET RIGHT, and what this pins. The panel is not
   * patched from the response: the save forgets its draft and RE-READS, so the
   * row on screen afterwards is the successor and reopening it seeds the boxes
   * from that row (`whoDraftFromRow`). The number shown is therefore the one
   * just saved rather than the one it replaced — with no console change
   * needed, which is the point of checking it.
   */
  it('reopening_after_a_superseding_save_shows_the_new_contact', async () => {
    signedInAtPractice();
    // Obviously fake, and different from each other in the digits that matter.
    const OLD_MOBILE = '0400 000 001';
    const NEW_MOBILE = '0400 000 002';

    const CARER = {
      ...READY,
      particularsLocked: true,
      status: 'awaiting_signature',
      assignorIsPatient: false,
      assignorName: 'Robin Relative',
      assignorRelationship: 'Mother',
      assignorMobile: OLD_MOBILE,
      assignorEmail: null,
    };
    const SUCCESSOR = { ...CARER, agreementId: 'agreement-superseding', assignorMobile: NEW_MOBILE };

    const rows: unknown[] = [CARER];
    stubFetch({
      rows,
      onPost: () => {
        // WHAT THE SERVER DOES NOW: it writes, and the replaced row leaves the
        // desk so the next edit lands on the agreement that is live.
        rows.splice(0, rows.length, SUCCESSOR);
        return { ok: true, payload: { id: SUCCESSOR.agreementId, assignorIsPatient: false } };
      },
    });
    render(<TabletView practiceId={PRACTICE} />);

    fireEvent.click(await screen.findByTestId(`who-open-${CARER.agreementId}`));
    const mobile = (await screen.findByTestId(`who-mobile-${CARER.agreementId}`)) as HTMLInputElement;
    // The box exists before it is seeded from the row — wait for the value,
    // not the element, or the seed lands on top of the change (wow.md §2.6).
    await waitFor(() => expect(mobile.value).toBe(OLD_MOBILE));
    fireEvent.change(mobile, { target: { value: NEW_MOBILE } });

    await waitFor(() =>
      expect((screen.getByTestId(`who-save-${CARER.agreementId}`) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId(`who-save-${CARER.agreementId}`));

    // THE ROW THAT COMES BACK IS THE SUCCESSOR, and reopening ITS panel shows
    // the number that was just saved rather than the one it replaced.
    fireEvent.click(await screen.findByTestId(`who-open-${SUCCESSOR.agreementId}`));
    const reopened = (await screen.findByTestId(
      `who-mobile-${SUCCESSOR.agreementId}`,
    )) as HTMLInputElement;
    await waitFor(() => expect(reopened.value).toBe(NEW_MOBILE));
  });

  /**
   * A CORRECTED MOBILE IS NOT A NEW AGREEMENT (Carl, 11 Sep 2026 —
   * D-2026-09-11-01).
   *
   * How the signer is REACHED is a delivery detail: the s 65C particulars
   * carry the signer's name and relationship, and no signer contact is printed
   * on the artefact. So the server now writes it in place — the same agreement
   * comes back, its hash and particulars untouched — and the band has to SAY
   * so. "Saved." was the same word this screen used for an edit that
   * superseded, which left reception unsure which of the two had happened and
   * whether the number had taken.
   *
   * THE SCREEN DOES NOT DECIDE THE ACT; it asks the domain's own
   * `classifyAssignorChange` which of the three this was, so the words on
   * screen cannot disagree with what the server did.
   */
  it('saving_only_a_new_mobile_says_contact_updated_not_superseded', async () => {
    signedInAtPractice();
    // Obviously fake, and different in the digits that matter.
    const OLD_MOBILE = '0400 000 001';
    const NEW_MOBILE = '0400 000 002';

    const CARER = {
      ...READY,
      particularsLocked: true,
      status: 'awaiting_signature',
      assignorIsPatient: false,
      assignorName: 'Robin Relative',
      assignorRelationship: 'Mother',
      assignorMobile: OLD_MOBILE,
      assignorEmail: null,
    };
    // WHAT THE SERVER RETURNS NOW: the SAME agreement, with the signer's row
    // updated underneath it. No successor, nothing to move to.
    const UPDATED = { ...CARER, assignorMobile: NEW_MOBILE };

    const rows: unknown[] = [CARER];
    stubFetch({
      rows,
      onPost: () => {
        rows.splice(0, rows.length, UPDATED);
        return { ok: true, payload: { id: CARER.agreementId, assignorIsPatient: false } };
      },
    });
    render(<TabletView practiceId={PRACTICE} />);

    fireEvent.click(await screen.findByTestId(`who-open-${CARER.agreementId}`));
    const mobile = (await screen.findByTestId(`who-mobile-${CARER.agreementId}`)) as HTMLInputElement;
    // The box exists before it is seeded from the row — wait for the value,
    // not the element, or the seed lands on top of the change (wow.md §2.6).
    await waitFor(() => expect(mobile.value).toBe(OLD_MOBILE));
    fireEvent.change(mobile, { target: { value: NEW_MOBILE } });

    await waitFor(() =>
      expect((screen.getByTestId(`who-save-${CARER.agreementId}`) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId(`who-save-${CARER.agreementId}`));

    // IT LANDS ON THE ROW THAT IS STILL THERE, and says what it did.
    const band = await screen.findByTestId(`who-outcome-${CARER.agreementId}`);
    await waitFor(() => expect(band.textContent).toContain(strings.tablet.whoSavedContact));
    expect(band.textContent).not.toContain(strings.tablet.whoSavedSuperseded);

    // AND REOPENING SHOWS THE NUMBER THAT WAS JUST SAVED — the panel re-reads
    // rather than being patched, so this is the row the server now holds.
    fireEvent.click(await screen.findByTestId(`who-open-${CARER.agreementId}`));
    const reopened = (await screen.findByTestId(`who-mobile-${CARER.agreementId}`)) as HTMLInputElement;
    await waitFor(() => expect(reopened.value).toBe(NEW_MOBILE));
  });

  it('a refusal on a row that has moved on reads in reception’s words, not the server’s', async () => {
    signedInAtPractice();
    const LOCKED = { ...READY, particularsLocked: true, status: 'awaiting_signature' };
    stubFetch({
      rows: [LOCKED],
      onPost: () => ({
        ok: false,
        status: 409,
        payload: { statusCode: 409, message: 'raw server sentence', reason: 'agreement_moved_on' },
      }),
    });
    render(<TabletView practiceId={PRACTICE} />);

    fireEvent.click(await screen.findByTestId(`who-open-${LOCKED.agreementId}`));
    fireEvent.click(screen.getByTestId(`who-save-${LOCKED.agreementId}`));

    const band = await screen.findByTestId(`who-outcome-${LOCKED.agreementId}`);
    expect(band.textContent).toContain(strings.tablet.whoRefusals.agreement_moved_on);
    expect(band.textContent).not.toContain('raw server sentence');
  });

  /**
   * THE ROW SAYS WHO IS SIGNING (Carl, 7 Sep 2026, after pushing Kim to a
   * tablet: "no who is signing", "it does not ask me who is approving").
   *
   * The line existed and read "Signing: The patient" — a category, not an
   * answer. It named nobody, so a receptionist looking at Kim's row before
   * pressing anything could not tell who would be asked to sign, and on the
   * morning somebody else is signing the fact that matters ("Alex, for Kim")
   * was not on the row at all.
   */
  it('row_states_who_is_signing', async () => {
    signedInAtPractice();
    const FOR_ANOTHER = {
      ...READY,
      agreementId: 'agreement-for-another',
      patientName: 'Kim Specimen',
      assignorIsPatient: false,
      assignorName: 'Alex Fictional',
      assignorRelationship: 'mother',
    };
    stubFetch({ rows: [READY, FOR_ANOTHER] });
    render(<TabletView practiceId={PRACTICE} />);

    // THE PATIENT SIGNING FOR THEMSELVES.
    const own = await screen.findByTestId(`who-fact-${READY.agreementId}`);
    expect(own.textContent).toBe(`${strings.tablet.signingLabel}: ${strings.tablet.signingPatient}`);

    // AND SOMEBODY ELSE SIGNING FOR THEM — both people named, and the
    // relationship, in the order a receptionist would say them.
    const other = await screen.findByTestId(`who-fact-${FOR_ANOTHER.agreementId}`);
    expect(other.textContent).toBe(
      `${strings.tablet.signingLabel}: ${strings.tablet.signingOther('Alex Fictional', 'Kim Specimen', 'mother')}`,
    );
    expect(other.textContent).toContain('Alex Fictional');
    expect(other.textContent).toContain('Kim Specimen');

    // NO CAPACITY QUESTION ANYWHERE NEAR IT (REQ-VUL-05) — the row says WHO,
    // and never asks anybody to judge whether they may.
    expect(document.body.textContent ?? '').not.toMatch(/capacity|competent|understands/i);
  });

  /**
   * WHO IS SIGNING FIRST, THEN THE TABLET (Carl, 7 Sep 2026: "change the
   * workflow to 'who is signing' only -- after that is actioned, enable the
   * select tablet and send button").
   *
   * Carl pushed Kim to a tablet and said, twice, that the desk never asked.
   * It never had: every agreement is drafted with the patient as its own
   * assignor, so "the patient is signing" was a default nobody had confirmed,
   * and Send went straight away past a question that had not been put.
   */
  it('send_and_tablet_select_are_dead_until_who_is_signing_is_saved', async () => {
    signedInAtPractice();
    const UNCONFIRMED = {
      ...READY,
      assignorConfirmedAt: null,
      pushable: false,
      blockedReason: 'assignor_not_confirmed' as const,
    };
    stubFetch({ rows: [UNCONFIRMED] });
    render(<TabletView practiceId={PRACTICE} />);

    // BOTH HALVES OF "SEND" ARE DEAD: there is nowhere to choose and nothing
    // to press.
    const select = (await screen.findByTestId(`target-${UNCONFIRMED.agreementId}`)) as HTMLSelectElement;
    const send = (await screen.findByTestId(`send-${UNCONFIRMED.agreementId}`)) as HTMLButtonElement;
    expect(select.disabled).toBe(true);
    expect(send.disabled).toBe(true);

    // THE ROW SAYS WHY, IN RECEPTION'S WORDS...
    const band = await screen.findByTestId(`blocked-${UNCONFIRMED.agreementId}`);
    expect(band.textContent).toContain(strings.tablet.blocked.assignor_not_confirmed);
    /*
     * ...AND THE BAND IS WORDS ONLY (Carl, 10 Sep 2026: "one close only"). The
     * control that fixes this is step ① one line above, on the same row — so
     * the band carries no button of its own, and it still points nowhere else.
     */
    expect(band.querySelector('button')).toBeNull();

    // AND "Who is signing?" IS THE ROW'S PRIMARY ACTION while it waits — the
    // only thing on the row that can be pressed.
    const ask = (await screen.findByTestId(`who-open-${UNCONFIRMED.agreementId}`)) as HTMLButtonElement;
    expect(ask.disabled).toBe(false);
    expect(ask.className).not.toBe('');
  });

  it('saving_who_is_signing_enables_send_without_reload', async () => {
    signedInAtPractice();
    const UNCONFIRMED = {
      ...READY,
      assignorConfirmedAt: null,
      pushable: false,
      blockedReason: 'assignor_not_confirmed' as const,
    };
    /*
     * THE LIST STAYS UNCONFIRMED BEHIND THE SCREEN on purpose: if the enabling
     * came from the poll rather than from the answer the server just returned,
     * this test would fail — which is exactly the beat of dead controls Carl
     * would feel between the press and the refresh.
     */
    stubFetch({
      rows: [UNCONFIRMED],
      onPost: () => ({
        ok: true,
        payload: {
          id: UNCONFIRMED.agreementId,
          assignorIsPatient: true,
          assignorConfirmedAt: '2026-09-07T09:15:00.000Z',
        },
      }),
    });
    render(<TabletView practiceId={PRACTICE} />);

    fireEvent.click(await screen.findByTestId(`who-open-${UNCONFIRMED.agreementId}`));
    // "The patient is signing" is ticked when the panel opens, so the common
    // answer is open then Save.
    const patientTick = screen.getByRole('checkbox', { name: strings.tablet.whoPatient }) as HTMLInputElement;
    expect(patientTick.getAttribute('data-state') ?? String(patientTick.checked)).not.toBe('unchecked');

    fireEvent.click(screen.getByTestId(`who-save-${UNCONFIRMED.agreementId}`));

    // THE POST WENT TO THE ONE ENDPOINT THAT RECORDS THE ANSWER.
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const saved = calls.find((c) => c.method === 'POST')!;
    expect(saved.url).toContain(`/agreements/${UNCONFIRMED.agreementId}/assignor`);
    expect(saved.body).toMatchObject({ assignorIsPatient: true });

    // AND THE PAIR CAME ALIVE UNDER RECEPTION'S HAND — from the answer the
    // server returned, not from a later poll.
    await waitFor(() =>
      expect((screen.getByTestId(`target-${UNCONFIRMED.agreementId}`) as HTMLSelectElement).disabled).toBe(
        false,
      ),
    );
    // Send is the step AFTER choosing a tablet, and it comes alive the moment
    // one is chosen — no reload, no second press on the panel.
    fireEvent.change(screen.getByTestId(`target-${UNCONFIRMED.agreementId}`), {
      target: { value: TABLET.id },
    });
    await waitFor(() =>
      expect((screen.getByTestId(`send-${UNCONFIRMED.agreementId}`) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );

    // And the row has stopped saying it is waiting to be asked.
    expect(screen.queryByTestId(`blocked-${UNCONFIRMED.agreementId}`)).toBeNull();
    expect(screen.getByTestId(`step-who-${UNCONFIRMED.agreementId}`).getAttribute('data-state')).toBe(
      'done',
    );
  });

  /**
   * THE ROW SAYS WHICH ORDER TO DO THINGS IN (Carl, 7 Sep 2026: "change the
   * workflow to 'who is signing' only -- after that is actioned, enable the
   * select tablet and send button").
   *
   * Every control was live at once, so nothing on the row said which came
   * first — and the one that mattered looked optional beside a Send that went
   * straight away. Exactly one step is ever "now", which is what makes the
   * strip readable at a glance rather than a row of equally-lit chips.
   */
  it('row_shows_the_numbered_workflow', async () => {
    signedInAtPractice();
    const UNCONFIRMED = {
      ...READY,
      assignorConfirmedAt: null,
      pushable: false,
      blockedReason: 'assignor_not_confirmed' as const,
    };
    stubFetch({ rows: [UNCONFIRMED] });
    render(<TabletView practiceId={PRACTICE} />);

    // THE ORDER IS ON THE ROW, in words, numbered.
    const strip = await screen.findByTestId(`steps-${UNCONFIRMED.agreementId}`);
    expect(strip.textContent).toContain(strings.tablet.stepWhoIsSigning);
    expect(strip.textContent).toContain(strings.tablet.stepChooseTablet);
    expect(strip.textContent).toContain(strings.tablet.stepSend);
    // An ordered list, named — not three chips a screen reader reads as prose.
    expect(strip.tagName).toBe('OL');
    expect(strip.getAttribute('aria-label')).toBe(strings.tablet.stepsLabel);

    // NOBODY HAS BEEN ASKED YET: step one is where the row is, and it is the
    // ONLY step that is.
    const who = screen.getByTestId(`step-who-${UNCONFIRMED.agreementId}`);
    const tablet = screen.getByTestId(`step-tablet-${UNCONFIRMED.agreementId}`);
    const send = screen.getByTestId(`step-send-${UNCONFIRMED.agreementId}`);
    expect(who.getAttribute('data-state')).toBe('now');
    expect(who.getAttribute('aria-current')).toBe('step');
    expect(tablet.getAttribute('data-state')).toBe('next');
    expect(send.getAttribute('data-state')).toBe('next');
    expect(tablet.getAttribute('aria-current')).toBeNull();
    expect(send.getAttribute('aria-current')).toBeNull();
    // The state is SPOKEN as well as shown, so weight is never the only
    // carrier (WCAG 2.2).
    expect(who.textContent).toContain(strings.tablet.stepNow);
    // AND EACH STEP CARRIES THE CONTROL IT NAMES (Carl, 10 Sep 2026) — the
    // three controls are inside the three steps, not laid out beneath them.
    expect(who.contains(screen.getByTestId(`who-open-${UNCONFIRMED.agreementId}`))).toBe(true);
    expect(tablet.contains(screen.getByTestId(`target-${UNCONFIRMED.agreementId}`))).toBe(true);
    expect(send.contains(screen.getByTestId(`send-${UNCONFIRMED.agreementId}`))).toBe(true);
  });

  /**
   * THE LABEL IS OVER THE THING IT NAMES (Carl, 10 Sep 2026, from a mock-up:
   * three aligned columns, "Who is signing" over the Who is signing button,
   * "Choose a tablet" over the select, "Send" over Send, an arrow between).
   *
   * WHY A STRUCTURAL TEST RATHER THAN A VISUAL ONE. The first cut laid the
   * numbered strip out above the row and the controls out below it — two
   * independent layouts, so a number sat over whatever happened to be under it
   * at that width. jsdom cannot measure a grid column, so what this pins is the
   * thing the grid is built on: one list item per step, holding that step's
   * label and that step's control and NOTHING of any other step's. Two elements
   * in one list item cannot be pulled into different columns; two elements in
   * two layouts can.
   */
  it('each_step_label_sits_in_the_same_column_as_its_control', async () => {
    signedInAtPractice();
    const id = READY.agreementId;
    stubFetch({ rows: [READY] });
    render(<TabletView practiceId={PRACTICE} />);

    /*
     * WAIT FOR THE DATA, NOT THE ELEMENT (wow.md §2.6). The select is drawn
     * with the rows; its options arrive on the devices fetch, which lands
     * separately. Waiting for an option proves the row is fully rendered.
     */
    const target = (await screen.findByTestId(`target-${id}`)) as HTMLSelectElement;
    await waitFor(() => expect(target.options.length).toBeGreaterThan(1));

    const steps = [
      {
        key: 'who',
        label: strings.tablet.stepWhoIsSigning,
        control: screen.getByTestId(`who-open-${id}`),
      },
      { key: 'tablet', label: strings.tablet.stepChooseTablet, control: target },
      { key: 'send', label: strings.tablet.stepSend, control: screen.getByTestId(`send-${id}`) },
    ];

    steps.forEach((step, index) => {
      const item = screen.getByTestId(`step-${step.key}-${id}`);

      // THE LABEL IS THE FIRST THING IN THE STEP, AND THE CONTROL COMES AFTER
      // IT — which is what the grid draws as one column, label above control.
      const label = item.firstElementChild!;
      expect(label.textContent).toContain(step.label);
      expect(item.contains(step.control)).toBe(true);
      expect(
        label.compareDocumentPosition(step.control) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      // AND NOTHING OF ANY OTHER STEP IS IN THIS COLUMN.
      steps
        .filter((other) => other.key !== step.key)
        .forEach((other) => expect(item.contains(other.control)).toBe(false));

      /*
       * THE ARROW IS INSIDE THE STEP IT POINTS OUT OF, and there is no fourth
       * one hanging off the end: label, control and (for the first two) an
       * arrow, drawn and hidden from assistive technology.
       */
      expect(item.childElementCount).toBe(index < steps.length - 1 ? 3 : 2);
      if (index < steps.length - 1) {
        expect(item.lastElementChild!.getAttribute('aria-hidden')).toBe('true');
      }
    });
  });

  it('the numbered workflow moves on as each step is answered', async () => {
    signedInAtPractice();
    const CONFIRMED = { ...READY };
    stubFetch({ rows: [CONFIRMED] });
    render(<TabletView practiceId={PRACTICE} />);

    // ASKED AND ANSWERED — step one is done, and step two is where the row is.
    await waitFor(() =>
      expect(screen.getByTestId(`step-who-${CONFIRMED.agreementId}`).getAttribute('data-state')).toBe(
        'done',
      ),
    );
    expect(screen.getByTestId(`step-who-${CONFIRMED.agreementId}`).textContent).toContain(
      strings.tablet.stepDone,
    );
    expect(screen.getByTestId(`step-tablet-${CONFIRMED.agreementId}`).getAttribute('data-state')).toBe(
      'now',
    );
    expect(screen.getByTestId(`step-send-${CONFIRMED.agreementId}`).getAttribute('data-state')).toBe(
      'next',
    );

    // A TABLET CHOSEN — and Send is the only thing left. The select is inside
    // the step it belongs to now, which is where this reaches for it.
    fireEvent.change(screen.getByTestId(`target-${CONFIRMED.agreementId}`), {
      target: { value: TABLET.id },
    });
    await waitFor(() =>
      expect(
        screen.getByTestId(`step-tablet-${CONFIRMED.agreementId}`).getAttribute('data-state'),
      ).toBe('done'),
    );
    expect(screen.getByTestId(`step-send-${CONFIRMED.agreementId}`).getAttribute('data-state')).toBe(
      'now',
    );
    /*
     * SEND IS NEVER "done". Pressing it makes a session and the row leaves this
     * list — a ticked third step would be describing something no longer here.
     */
    expect(sendSteps(CONFIRMED, TABLET.id).map((s) => s.state)).toEqual(['done', 'done', 'now']);
  });

  it('who_fact_line_opens_the_panel', async () => {
    signedInAtPractice();
    stubFetch();
    render(<TabletView practiceId={PRACTICE} />);

    const fact = (await screen.findByTestId(`who-fact-${READY.agreementId}`)) as HTMLButtonElement;
    expect(fact.disabled).toBe(false);
    // The answer and the way to change it are the same thing to press.
    expect(fact.getAttribute('aria-label')).toContain(strings.tablet.signingChange);
    expect(screen.queryByTestId(`who-panel-${READY.agreementId}`)).toBeNull();

    fireEvent.click(fact);
    // THE SAME PANEL the "Who is signing?" button opens — one panel, not a
    // second copy of the question.
    expect(await screen.findByTestId(`who-panel-${READY.agreementId}`)).toBeTruthy();

    // And pressing it again closes it, exactly as the button does.
    fireEvent.click(screen.getByTestId(`who-fact-${READY.agreementId}`));
    await waitFor(() => expect(screen.queryByTestId(`who-panel-${READY.agreementId}`)).toBeNull());
  });

  /**
   * ONE PANEL, ONE CLOSE (Carl, 10 Sep 2026, drawn on a screenshot of an open
   * "Who is signing" panel: "one close only").
   *
   * There were three. The step ① button toggled to "Close"; the standing
   * "Cannot be sent yet · Confirm who is signing first" band carried a second
   * copy of the same toggle, so it read "Close" too; and the band a refused
   * press leaves behind carried a third, stacked directly above the panel's
   * own Save — which is why the panel looked as though it had Save and Close.
   * Three identical buttons for one act is a reader working out which one is
   * theirs.
   *
   * WHAT THIS PINS: exactly ONE control on the whole screen says "Close" while
   * the panel is open, it is the step ① button, and pressing it shuts the
   * panel. The panel itself keeps Save and nothing else.
   */
  it('the_who_panel_has_one_close_and_it_is_the_step_one_button', async () => {
    signedInAtPractice();
    const UNCONFIRMED = {
      ...READY,
      assignorConfirmedAt: null,
      pushable: false,
      blockedReason: 'assignor_not_confirmed' as const,
    };
    stubFetch({ rows: [UNCONFIRMED] });
    render(<TabletView practiceId={PRACTICE} />);

    const step = (await screen.findByTestId(`who-open-${UNCONFIRMED.agreementId}`)) as HTMLButtonElement;
    expect(step.textContent).toContain(strings.tablet.whoOpen);
    fireEvent.click(step);

    const panel = await screen.findByTestId(`who-panel-${UNCONFIRMED.agreementId}`);

    // ONE "Close" ON THE PAGE, AND IT IS STEP ①'s BUTTON.
    const closers = [...document.querySelectorAll('button')].filter(
      (b) => (b.textContent ?? '').trim() === strings.tablet.whoClose,
    );
    expect(closers).toEqual([step]);

    // THE PANEL KEEPS SAVE, AND NOTHING THAT SHUTS IT.
    const inPanel = [...panel.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
    expect(inPanel).toContain(strings.tablet.whoSave);
    expect(inPanel).not.toContain(strings.tablet.whoClose);

    // AND THE ONE CLOSE CLOSES.
    fireEvent.click(step);
    await waitFor(() => expect(screen.queryByTestId(`who-panel-${UNCONFIRMED.agreementId}`)).toBeNull());
  });

  /**
   * WHAT WAS TYPED SURVIVES A CLOSE (Carl, 10 Sep 2026).
   *
   * He unticked "the patient is signing", typed a carer's full name, chose the
   * relationship, filled in a mobile and an email, pressed a Save that was
   * dead, pressed Close, reopened — and every one of those answers had gone,
   * with the panel back to the patient ticked. A front desk is interrupted
   * constantly; a form that empties itself when somebody looks away is a form
   * that gets typed twice, and the second typing is where a name goes wrong.
   *
   * IN MEMORY, FOR THE LIFE OF THE PAGE, AND NOWHERE ELSE — React state on a
   * console screen. Nothing is written to the browser.
   */
  it('closing_the_who_panel_keeps_what_was_typed', async () => {
    signedInAtPractice();
    stubFetch();
    render(<TabletView practiceId={PRACTICE} />);

    fireEvent.click(await screen.findByTestId(`who-open-${READY.agreementId}`));
    fireEvent.click(screen.getByRole('checkbox', { name: strings.tablet.whoPatient }));

    /*
     * WAIT FOR THE FIELD TO BE SEEDED BEFORE TYPING (wow.md §2 item 6). The
     * panel seeds itself from the row, which arrived on its own fetch; typing
     * into a box whose seed has not landed lets the seed overwrite the typing.
     */
    const name = (await screen.findByTestId(`who-name-${READY.agreementId}`)) as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe(''));

    fireEvent.change(name, { target: { value: 'Robin Relative' } });
    fireEvent.change(screen.getByTestId(`who-relationship-${READY.agreementId}`), {
      target: { value: 'carer' },
    });
    fireEvent.change(screen.getByTestId(`who-mobile-${READY.agreementId}`), {
      target: { value: '0400 000 001' },
    });
    fireEvent.change(screen.getByTestId(`who-email-${READY.agreementId}`), {
      target: { value: 'robin@example.invalid' },
    });

    // ESCAPE CLOSES IT, exactly as the one Close button does.
    fireEvent.keyDown(screen.getByTestId(`who-panel-${READY.agreementId}`), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId(`who-panel-${READY.agreementId}`)).toBeNull());

    // AND SO DOES THE ONE CLOSE THERE IS, the step ① button.
    fireEvent.click(screen.getByTestId(`who-open-${READY.agreementId}`));
    expect(await screen.findByTestId(`who-panel-${READY.agreementId}`)).toBeTruthy();
    fireEvent.click(screen.getByTestId(`who-open-${READY.agreementId}`));
    await waitFor(() => expect(screen.queryByTestId(`who-panel-${READY.agreementId}`)).toBeNull());

    // AND REOPEN: every answer is still there, and the patient is NOT ticked
    // back on over the top of them.
    fireEvent.click(screen.getByTestId(`who-open-${READY.agreementId}`));
    const reopened = (await screen.findByTestId(`who-name-${READY.agreementId}`)) as HTMLInputElement;
    await waitFor(() => expect(reopened.value).toBe('Robin Relative'));
    expect(
      (screen.getByTestId(`who-relationship-${READY.agreementId}`) as HTMLSelectElement).value,
    ).toBe('carer');
    expect((screen.getByTestId(`who-mobile-${READY.agreementId}`) as HTMLInputElement).value).toBe(
      '0400 000 001',
    );
    expect((screen.getByTestId(`who-email-${READY.agreementId}`) as HTMLInputElement).value).toBe(
      'robin@example.invalid',
    );
    expect(
      screen.getByRole('checkbox', { name: strings.tablet.whoPatient }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  /**
   * A ROW WHOSE ASSIGNOR IS ALREADY SOMEBODY ELSE OPENS SHOWING THEM (Carl,
   * 10 Sep 2026).
   *
   * "The patient is signing, ticked" is the right default for a row whose
   * saved assignor IS the patient, and for no other row. Reopening Kim's row
   * — which says one line above that Alex is signing for her — used to show
   * the default and contradict it, and a Save from that state would have
   * quietly re-pointed the agreement back at the patient.
   *
   * THE AGE DECLARATION IS SHOWN, NOT ASKED AGAIN. It was declared at Save and
   * it is on the record (REQ-AGE-01) — and it is an AGE attestation, so the
   * line states it in the past tense and nothing anywhere asks anybody to
   * judge the person (REQ-VUL-05).
   *
   * MOBILE AND EMAIL COME BACK BLANK, honestly: they are not on this row's
   * DTO, and inventing a field to carry them is not this change's to make.
   */
  it('reopening_shows_the_saved_someone_else_not_the_default', async () => {
    signedInAtPractice();
    const FOR_ANOTHER = {
      ...READY,
      agreementId: 'agreement-for-another',
      patientName: 'Kim Specimen',
      assignorIsPatient: false,
      assignorName: 'Alex Fictional',
      // THE WORD THAT IS PRINTED ON THE AGREEMENT, which is what the DTO
      // carries; the select is keyed by the content file's key.
      assignorRelationship: 'Mother',
      // A ROW SAVED WITH NEITHER — see `reopening_prefills_mobile_and_email_from_the_row`
      // for the ordinary case, where both are on the row and both come back.
      assignorMobile: null,
      assignorEmail: null,
    };
    stubFetch({ rows: [FOR_ANOTHER] });
    render(<TabletView practiceId={PRACTICE} />);

    fireEvent.click(await screen.findByTestId(`who-open-${FOR_ANOTHER.agreementId}`));

    // WAIT FOR THE PRE-FILL, not for the box (wow.md §2 item 6).
    const name = (await screen.findByTestId(`who-name-${FOR_ANOTHER.agreementId}`)) as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe('Alex Fictional'));

    expect(
      screen.getByRole('checkbox', { name: strings.tablet.whoPatient }).getAttribute('aria-checked'),
    ).toBe('false');
    // THE WORD CROSSED BACK ONTO THE VERSIONED LIST IT CAME FROM.
    expect(
      (screen.getByTestId(`who-relationship-${FOR_ANOTHER.agreementId}`) as HTMLSelectElement).value,
    ).toBe('mother');
    // NULL ON THE ROW, SO BLANK ON THE SCREEN — nothing is invented to fill a
    // box the record has no answer for.
    expect(
      (screen.getByTestId(`who-mobile-${FOR_ANOTHER.agreementId}`) as HTMLInputElement).value,
    ).toBe('');
    expect(
      (screen.getByTestId(`who-email-${FOR_ANOTHER.agreementId}`) as HTMLInputElement).value,
    ).toBe('');

    // ASKED ONCE. The tick is gone and the fact is stated in its place.
    expect(
      screen.queryByRole('checkbox', { name: strings.tablet.whoAgeConfirm(MIN_AGE_ASSIGN_FOR_OTHER) }),
    ).toBeNull();
    expect(screen.getByTestId(`who-age-on-record-${FOR_ANOTHER.agreementId}`).textContent).toContain(
      strings.tablet.whoAgeOnRecord(MIN_AGE_ASSIGN_FOR_OTHER),
    );

    // AND NOTHING HERE ASKS ANYBODY TO JUDGE THE PERSON (REQ-VUL-05).
    expect(document.body.textContent ?? '').not.toMatch(/capacity|competent|understands/i);
  });

  /**
   * AND THE CONTACT COMES BACK WITH THE REST OF IT (Carl, 10 Sep 2026).
   *
   * Saving a someone-else takes a mobile and/or an email — `whoFault` refuses
   * the branch with neither, because the copy of the agreement goes to the
   * SIGNER (REQ-REG-08). Reopening the panel showed the name and the
   * relationship and two empty boxes, so a second Save meant retyping details
   * the practice already holds. The row DTO carries them now.
   */
  it('reopening_prefills_mobile_and_email_from_the_row', async () => {
    signedInAtPractice();
    const FOR_ANOTHER = {
      ...READY,
      agreementId: 'agreement-with-contact',
      patientName: 'Kim Specimen',
      assignorIsPatient: false,
      assignorName: 'Alex Fictional',
      assignorRelationship: 'Mother',
      // Obviously fake, and reserved-for-testing domains at that.
      assignorMobile: '+61400000999',
      assignorEmail: 'someone@example.invalid',
    };
    stubFetch({ rows: [FOR_ANOTHER] });
    render(<TabletView practiceId={PRACTICE} />);

    fireEvent.click(await screen.findByTestId(`who-open-${FOR_ANOTHER.agreementId}`));

    // WAIT FOR THE PRE-FILL, not for the box (wow.md §2 item 6) — the panel
    // renders its inputs before the row's values are seeded into them.
    const mobile = (await screen.findByTestId(
      `who-mobile-${FOR_ANOTHER.agreementId}`,
    )) as HTMLInputElement;
    await waitFor(() => expect(mobile.value).toBe('+61400000999'));

    // Read synchronously ON PURPOSE: both boxes are seeded from the one draft
    // in the one state update, so the wait above has already landed this too.
    const email = screen.getByTestId(`who-email-${FOR_ANOTHER.agreementId}`) as HTMLInputElement;
    expect(email.value).toBe('someone@example.invalid');

    // AND THE REST OF THE ANSWER IS STILL THERE, so Save needs no retyping at
    // all: the contact was the last thing missing.
    expect((screen.getByTestId(`who-name-${FOR_ANOTHER.agreementId}`) as HTMLInputElement).value).toBe(
      'Alex Fictional',
    );
    expect(
      (screen.getByTestId(`who-relationship-${FOR_ANOTHER.agreementId}`) as HTMLSelectElement).value,
    ).toBe('mother');
  });

  /**
   * SAVE SAYS WHAT IS MISSING, WHERE IT IS MISSING (Carl, 10 Sep 2026).
   *
   * The button was dead and the reason sat beside it in small grey text,
   * describing a checkbox six rows up — "easy to miss", and he missed it. Save
   * is alive now: pressing it with the age declaration unticked sends nothing,
   * marks that control, puts the sentence directly under it and moves the
   * cursor into it.
   *
   * HARD RULE 10 IS STILL THE SERVER'S. `buildAssignorForAnother` runs the
   * identical refusal; this is only the screen telling somebody which box.
   */
  it('save_with_no_18_plus_tick_marks_the_box_and_focuses_it', async () => {
    signedInAtPractice();
    stubFetch();
    render(<TabletView practiceId={PRACTICE} />);

    fireEvent.click(await screen.findByTestId(`who-open-${READY.agreementId}`));
    fireEvent.click(screen.getByRole('checkbox', { name: strings.tablet.whoPatient }));

    const name = (await screen.findByTestId(`who-name-${READY.agreementId}`)) as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe(''));
    fireEvent.change(name, { target: { value: 'Robin Relative' } });
    fireEvent.change(screen.getByTestId(`who-relationship-${READY.agreementId}`), {
      target: { value: 'carer' },
    });
    fireEvent.change(screen.getByTestId(`who-mobile-${READY.agreementId}`), {
      target: { value: '0400 000 001' },
    });

    // EVERYTHING BUT THE AGE DECLARATION. Save is ALIVE.
    const save = screen.getByTestId(`who-save-${READY.agreementId}`) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    // NOTHING WAS SENT.
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    // THE REASON IS UNDER THE BOX IT IS ABOUT, AND IT IS SPOKEN.
    const message = await screen.findByTestId(`who-error-${READY.agreementId}`);
    expect(message.textContent).toBe(strings.tablet.whoBlockedAge);
    expect(message.getAttribute('role')).toBe('alert');
    const age = screen.getByTestId(`who-age-${READY.agreementId}`);
    expect(age.contains(message)).toBe(true);

    // AND THE CURSOR IS IN IT.
    const box = screen.getByRole('checkbox', {
      name: strings.tablet.whoAgeConfirm(MIN_AGE_ASSIGN_FOR_OTHER),
    });
    expect(document.activeElement).toBe(box);

    // TICK IT AND THE REFUSAL GOES, AND THE SAVE GOES THROUGH.
    fireEvent.click(box);
    await waitFor(() => expect(screen.queryByTestId(`who-error-${READY.agreementId}`)).toBeNull());
    fireEvent.click(screen.getByTestId(`who-save-${READY.agreementId}`));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      assignorIsPatient: false,
      declaresEighteenOrOver: true,
    });
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
    // The five values are seeded from the details fetch after the inputs exist
    // -- wait for the pre-fill, not the field (wow.md §2 item 6; flaked on CI 7 Sep 2026).
    await waitFor(() => expect(address.value).toBe(DETAILS.address));
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
    // WAIT FOR THE PRE-FILL, not the field: the draft is seeded from the details
    // fetch after the input exists; changing it before the seed lands lets the
    // seed overwrite the change and the save reports "Nothing was changed"
    // (flaked on CI, 7 Sep 2026 -- wow.md §2 item 6).
    await waitFor(() => expect(address.value).not.toBe(''));
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
    /*
     * THE BAND IS THE PUSHABLE ROWS' OWN FETCH; THE LIST IS ITS OWN, SEPARATE
     * `/service-descriptions` CALL — `D6aFix` renders unconditionally the
     * moment the row is blocked, and only fills in the version chip and the
     * select's options once that second fetch answers. Wait for the version
     * text rather than reading it the instant the band exists (flaked on a
     * slow CI runner).
     */
    await waitFor(() =>
      expect(fix.textContent).toContain(strings.tablet.d6aListVersion(DESCRIPTIONS.version)),
    );
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

  it('signature_failed_row_names_the_reason_and_offers_send_again', async () => {
    signedInAtPractice();
    stubFetch({ sessions: [SIGNATURE_FAILED] });
    render(<TabletView practiceId={PRACTICE} />);

    // THE ROW SAYS THE SIGNATURE WAS NOT RECORDED -- not that it "failed",
    // which reads as something the patient did.
    const last = await screen.findByTestId(`tablet-last-${TABLET.id}`);
    expect(last.textContent).toContain(strings.tablet.states.signature_failed);

    /*
     * AND IT SAYS WHY, IN WORDS WITH THE NEXT ACT IN THEM. The server sent a
     * CODE; this screen owns the sentence, and the sentence names the fix
     * ("Reload the tablet and send again").
     */
    const why = await screen.findByTestId(`signature-failed-reason-${SIGNATURE_FAILED.id}`);
    expect(why.textContent).toBe(strings.tablet.signatureFailedReasons.affirmations_missing);

    // A refused signature changed nothing on the agreement, so the ordinary
    // next thing is the ordinary push -- the SAME control every other ending
    // gets (hard rule 8, REQ-REC-04).
    const again = (await screen.findByTestId(`send-again-${SIGNATURE_FAILED.id}`)) as HTMLButtonElement;
    expect(again.disabled).toBe(false);
    fireEvent.click(again);
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/push'))).toBe(true),
    );
  });

  it('an_unmapped_signature_reason_shows_the_code_rather_than_a_generic_sentence', async () => {
    signedInAtPractice();
    stubFetch({
      sessions: [{ ...SIGNATURE_FAILED, signatureFailureReason: 'some_new_server_code' }],
    });
    render(<TabletView practiceId={PRACTICE} />);

    /*
     * THE DESIGN PRINCIPLE, PINNED (CLAUDE.md section 7). A generic fallback
     * message is a defect: it destroys the one string somebody could diagnose
     * an unknown refusal from. So the code is shown.
     */
    const why = await screen.findByTestId(`signature-failed-reason-${SIGNATURE_FAILED.id}`);
    expect(why.textContent).toContain('some_new_server_code');
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

  /**
   * THE BAND THAT STATED A PROBLEM NOBODY READING IT COULD SOLVE (Carl, 5 Sep
   * 2026; CLAUDE.md section 7, second instance).
   *
   * `enduring_rules_not_authored` is the commonest refusal at a GP practice
   * that offers ongoing agreements first, and it used to carry no control and
   * no link -- a receptionist with a patient at the desk, told that a rule set
   * they cannot write is awaiting authoring. Both things they CAN do are now
   * in the band: get THIS patient an agreement for today's visit, and change
   * what the tablet offers first so the next arrival is not blocked the same
   * way.
   */
  it('enduring_refusal_offers_episodic_inline_and_links_to_the_setting', async () => {
    signedInAtPractice();
    stubFetch({ rows: [ENDURING_BLOCKED] });
    render(<TabletView practiceId={PRACTICE} />);

    const band = await screen.findByTestId(`blocked-${ENDURING_BLOCKED.agreementId}`);
    expect(band.textContent).toContain(strings.tablet.blocked.enduring_rules_not_authored);
    // Never "see the practice queue", and never a claim about our forms.
    expect(band.textContent).not.toMatch(/practice queue/i);
    expect(band.textContent).not.toMatch(/certified|accredited|\bapproved\b/i);

    /*
     * THE LINK LANDS ON THE SETTING, not at the top of a page with four cards
     * on it -- the anchor is part of the destination.
     */
    const link = within(band).getByTestId(`blocked-link-${ENDURING_BLOCKED.agreementId}`) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/practice/channels#kiosk');
    expect(link.textContent).toBe(strings.tablet.toChannelsForOffer);

    const offer = within(band).getByTestId(
      `offer-episodic-instead-${ENDURING_BLOCKED.agreementId}`,
    ) as HTMLButtonElement;
    expect(offer.disabled).toBe(false);
    expect(offer.textContent).toContain(strings.tablet.offerEpisodicInsteadAction);

    const readsBefore = calls.filter((c) => c.url.includes('/tablet-sessions/pushable')).length;
    fireEvent.click(offer);

    /*
     * ONE PRESS, ONE SERVER ACT. The draft, the description of the service,
     * the lock and the capture request are all the server's -- a screen that
     * assembled an agreement would be a screen asserting a contract.
     */
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/offer-episodic'))).toBe(true),
    );
    const posted = calls.find((c) => c.url.includes('/offer-episodic'))!;
    expect(posted.url).toContain(`/agreements/${ENDURING_BLOCKED.agreementId}/offer-episodic`);
    // Not a push composed here, and nothing about the patient on the wire.
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/devices/'))).toBe(false);
    expect(JSON.stringify(posted.body ?? {})).not.toContain('Jamie');

    /*
     * AND THE LIST IS RE-READ, which is the only honest way to show that both
     * halves happened: the new episodic row appears and the ongoing one leaves
     * "Waiting to be signed today" because its capture request is closed.
     */
    await waitFor(() =>
      expect(calls.filter((c) => c.url.includes('/tablet-sessions/pushable')).length).toBeGreaterThan(
        readsBefore,
      ),
    );
    const said = await screen.findByTestId(`push-outcome-${ENDURING_BLOCKED.agreementId}`);
    expect(said.textContent).toContain(strings.tablet.offerEpisodicInsteadDone);
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
   * AFTER SEND, THE ROW ANSWERS "WHERE IS IT" INSTEAD OF "WHAT NEXT"
   * (Carl, 10 Sep 2026, drawn on a screenshot of a row with a live session).
   *
   * WHY. While an agreement is on a tablet in front of somebody there is
   * nothing on the row to press — a numbered ①→②→③ over three dead controls
   * describes work that is already happening. So the action area drops the
   * strip and holds the session instead: the chip naming the tablet and the
   * session id, with the record id under it, in the place the steps were.
   *
   * AND IT IS ONLY WHILE THE SESSION IS LIVE. A row with nothing on a tablet
   * still shows the strip, and the ended-session logic (`canSendAgain`) is
   * untouched — this test pins both directions so the swap cannot quietly
   * become permanent.
   */
  it('after_send_the_row_shows_the_live_session_where_the_steps_were', async () => {
    signedInAtPractice();
    const ON_TABLET = {
      ...READY,
      activeSession: { id: LIVE_UUID.id, deviceId: TABLET.id, state: 'reading' },
    };
    stubFetch({ rows: [ON_TABLET, BLOCKED], sessions: [LIVE_UUID] });
    render(<TabletView practiceId={PRACTICE} />);

    /*
     * WAIT FOR THE DATA, NOT THE ELEMENT (wow.md §2.6). The row is drawn from
     * the pushable fetch; the session behind its chip arrives on the sessions
     * fetch, which lands separately — so wait for the chip's own id.
     */
    const onTablet = await screen.findByTestId(`row-actions-${ON_TABLET.agreementId}`);
    await waitFor(() =>
      expect(screen.getByTestId(`row-live-${ON_TABLET.agreementId}`)).toBeTruthy(),
    );

    // THE SESSION IS WHERE THE STEPS WERE: the chip, and the record id beneath.
    expect(onTablet.textContent).toContain(strings.tablet.onTabletNow(TABLET.label));
    expect(onTablet.contains(screen.getByTestId(`row-session-id-${ON_TABLET.agreementId}`))).toBe(true);
    expect(onTablet.contains(screen.getByTestId(`row-patient-id-${ON_TABLET.agreementId}`))).toBe(true);
    // THE ID IS STILL THE WHOLE ID, still selectable, still copyable.
    expect(screen.getByTestId(`row-patient-id-${ON_TABLET.agreementId}`).textContent).toContain(
      ON_TABLET.patientId,
    );

    // AND THE STRIP AND ITS THREE CONTROLS ARE GONE FROM THIS ROW.
    expect(screen.queryByTestId(`steps-${ON_TABLET.agreementId}`)).toBeNull();
    expect(screen.queryByTestId(`who-open-${ON_TABLET.agreementId}`)).toBeNull();
    expect(screen.queryByTestId(`target-${ON_TABLET.agreementId}`)).toBeNull();
    expect(screen.queryByTestId(`send-${ON_TABLET.agreementId}`)).toBeNull();

    // THE REVERSE, ON A ROW WITH NOTHING ON A TABLET: the strip is in the
    // action area, and no session chip or record id is.
    const pushable = screen.getByTestId(`row-actions-${BLOCKED.agreementId}`);
    expect(pushable.contains(screen.getByTestId(`steps-${BLOCKED.agreementId}`))).toBe(true);
    expect(screen.queryByTestId(`row-live-${BLOCKED.agreementId}`)).toBeNull();
    expect(pushable.contains(screen.getByTestId(`row-patient-id-${BLOCKED.agreementId}`))).toBe(false);
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
    // Nothing on the record yet — this is the draft as somebody typing it has
    // it, which is what the gate is asked about.
    ageConfirmedFor: null,
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
      strings.tablet.offerEpisodicInsteadAction,
      strings.tablet.offerEpisodicInsteadBusy,
      strings.tablet.offerEpisodicInsteadDone,
      strings.tablet.toChannelsForOffer,
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

  // ---------------------------------------------------------------------------
  // THE SECOND MOMENT — post-service rows and the visits that need nothing
  // (Carl, 11 Sep 2026; TODO.md "Two front doors" (b)).
  // ---------------------------------------------------------------------------

  /**
   * A POST-AGREEMENT ON THE DESK. Same row, same ①→②→③ strip, same Send — one
   * mechanism, two moments. What differs is the particulars it states: D5 and
   * D6b, because D6a is "pre-agreements only" and D6b is "post-agreements
   * only" (REQ-REG-01; s 65C(4) table item 6).
   */
  const POST_ROW = {
    ...READY,
    agreementId: 'agreement-post',
    agreementType: 'episodic_post',
    patientName: 'Jo Postvisit',
    patientId: 'patient-post',
    appointmentDate: null,
    appointmentTime: null,
    // A post-agreement carries no Basic Service Description, and the row must
    // not report that as something missing.
    serviceDescription: null,
    serviceDescriptionValid: false,
    serviceDate: '2026-09-11',
    mbsItemNumbers: ['23', '10990'],
  };

  it('desk_shows_post_service_rows_with_the_numbered_strip', async () => {
    signedInAtPractice();
    stubFetch({ rows: [POST_ROW] });
    render(<TabletView practiceId={PRACTICE} />);

    const row = within(await screen.findByTestId(`pushable-${POST_ROW.agreementId}`));

    // THE FACT LINE SAYS WHAT THE AGREEMENT ACTUALLY CARRIES — the day and the
    // items — rather than "Service: Not set".
    const fact = serviceFact(POST_ROW);
    expect(fact).toContain(strings.tablet.postServiceLabel);
    expect(fact).toContain('23, 10990');
    expect(fact).not.toContain(strings.tablet.d6aMissing);
    expect(row.getByText(fact)).toBeTruthy();

    // ONE MECHANISM, TWO MOMENTS: the same numbered strip, in the same order.
    expect(
      row.getByTestId(`step-who-${POST_ROW.agreementId}`).getAttribute('data-state'),
    ).toBe('done');
    expect(row.getByTestId(`step-tablet-${POST_ROW.agreementId}`)).toBeTruthy();
    expect(row.getByTestId(`step-send-${POST_ROW.agreementId}`)).toBeTruthy();

    // NO APPOINTMENT TIME on a visit that is already over — "No appointment
    // time" would be an odd thing to say about a service that happened.
    expect(
      row.getByTestId(`row-line-${POST_ROW.agreementId}`).textContent,
    ).toContain(strings.tablet.postServiceLabel);
    expect(
      row.getByTestId(`row-line-${POST_ROW.agreementId}`).textContent,
    ).not.toContain(strings.tablet.unbooked);

    // HARD RULE 4 — nothing on this row is money.
    expect(document.body.textContent).not.toMatch(/\$|benefit amount|rebate/i);
    // HARD RULE 12 — and nothing calls our forms approved.
    expect(document.body.textContent).not.toMatch(/certified|accredited|government-approved/i);
  });

  it('a single item number is said in the singular', () => {
    expect(itemsFact(['23'])).toBe(strings.tablet.postServiceItem('23'));
    expect(itemsFact(['23', '36'])).toBe(strings.tablet.postServiceItems('23, 36'));
    // An empty list is said out loud rather than rendered as a gap.
    expect(itemsFact([])).toBe(strings.tablet.postServiceNoItems);
  });

  it('a covered visit is a history line and never a Send', async () => {
    signedInAtPractice();
    const COVERED = {
      serviceRecordId: 'svc-1',
      patientId: 'patient-covered',
      patientName: 'Kim Specimen',
      providerName: 'Dr Example Provider',
      serviceDate: '2026-09-11',
      mbsItemNumbers: ['23'],
      decision: 'covered',
      reason: 'covered_by_todays_agreement',
      policyVersion: 'visit-policy-2',
      coveringAgreementId: 'agreement-covering',
    };
    stubFetch({ rows: [], covered: [COVERED] });
    render(<TabletView practiceId={PRACTICE} />);

    const line = await screen.findByTestId(`covered-${COVERED.serviceRecordId}`);
    // THE REASON, IN OUR WORDS (REQ-LANG-01), not the server's code.
    expect(line.textContent).toContain(strings.tablet.coveredReason.covered_by_todays_agreement);
    expect(line.textContent).toContain('Kim Specimen');
    // D5 and D6b, as on any post row.
    expect(line.textContent).toContain('2026-09-11');
    expect(line.textContent).toContain('23');

    // NOTHING TO PRESS ON IT — it is finished work, not blocked work.
    expect(within(line).queryByRole('button')).toBeNull();
    expect(screen.queryByTestId(`pushable-${COVERED.serviceRecordId}`)).toBeNull();

    // AND IT LINKS TO THE ANSWER rather than describing where to find it.
    const link = screen.getByTestId(`covered-link-${COVERED.serviceRecordId}`);
    expect(link.getAttribute('href')).toBe(`/practice/patients/${COVERED.patientId}`);

    // HARD RULE 4 again: a covered visit was billed, and no figure reaches here.
    expect(document.body.textContent).not.toMatch(/\$|benefit amount|rebate/i);
  });

  it('an unmapped covered reason shows its own code rather than a generic sentence', async () => {
    signedInAtPractice();
    stubFetch({
      rows: [],
      covered: [
        {
          serviceRecordId: 'svc-2',
          patientId: 'patient-2',
          patientName: 'Alex Fictional',
          providerName: null,
          serviceDate: '2026-09-11',
          mbsItemNumbers: ['36'],
          decision: 'covered',
          // A reason a NEWER server decided for, which this bundle has never
          // met. It must reach reception as something they can quote down the
          // phone (CLAUDE.md section 7), never be swallowed.
          reason: 'covered_by_something_new',
          policyVersion: 'visit-policy-9',
          coveringAgreementId: 'agreement-x',
        },
      ],
    });
    render(<TabletView practiceId={PRACTICE} />);

    const line = await screen.findByTestId('covered-svc-2');
    expect(line.textContent).toContain('covered_by_something_new');
  });

  it('nothing covered today draws no panel at all', async () => {
    signedInAtPractice();
    stubFetch({ covered: [] });
    render(<TabletView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`pushable-${READY.agreementId}`)).toBeTruthy());
    expect(screen.queryByTestId('covered-list')).toBeNull();
    expect(screen.queryByTestId('covered-summary')).toBeNull();
  });

});

/**
 * THE QUEUE LINE CARRIES YOU TO THE FAULT (Carl, 11 Sep 2026, on a screenshot
 * of his own desk: "Have a link here to go to the error so a better solution").
 *
 * WHAT HE WAS LOOKING AT. The top of the page said the patient was on a tablet
 * now and nothing else; the panel that FIXES a crossed detail sat far below,
 * under the device it belonged to. The page knew what was wrong and made
 * reception go and find it — the exact shape CLAUDE.md §7 forbids ("shortcuts
 * to the answer, not directions to a screen").
 */
describe('a_live_fault_links_from_the_queue_row_to_the_card_that_fixes_it', () => {
  const onTablet = {
    ...READY,
    activeSession: { id: SESSION.id, deviceId: TABLET.id, state: 'details_disputed' as const },
  };

  it('names the fault on the row and links to the tablet card', async () => {
    stubFetch({ sessions: [DISPUTED], rows: [onTablet] });
    render(<TabletView practiceId={PRACTICE} />);

    const link = await screen.findByTestId(`row-fault-link-${READY.agreementId}`);
    // THE DESTINATION IS THE CARD ITSELF, not the list it lives in.
    expect(link.getAttribute('href')).toBe(`#tablet-${TABLET.id}`);
    expect(screen.getByTestId(`row-fault-${READY.agreementId}`).textContent).toContain(
      strings.tablet.liveFaultDetail,
    );
    // AND THE TARGET EXISTS, so the link is never a dead hash.
    expect(document.getElementById(`tablet-${TABLET.id}`)).toBeTruthy();
  });

  /**
   * WHICH DETAIL WAS CROSSED IS NOT ON THE QUEUE LINE (REQ-VER-04, hard rule 9).
   * The row says THAT something is disputed; the card says which TYPES. Values
   * never appear on either.
   */
  it('says a detail is wrong without naming the value', async () => {
    stubFetch({ sessions: [DISPUTED], rows: [onTablet] });
    render(<TabletView practiceId={PRACTICE} />);

    const fault = await screen.findByTestId(`row-fault-${READY.agreementId}`);
    expect(fault.textContent).not.toContain('@');
    expect(fault.textContent).not.toMatch(/\d{4}/);
  });

  /**
   * AND IT STOPS ONCE RECEPTION HAS ANSWERED. The same rule
   * `SessionDisputeNotices` was fixed for on 4 Sep: a resolved cross is not a
   * job, and a row that keeps shouting about it at the person who just dealt
   * with it is the defect, not the feature.
   */
  it('goes away once the dispute is resolved', async () => {
    stubFetch({ sessions: [RESOLVED], rows: [onTablet] });
    render(<TabletView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`pushable-${READY.agreementId}`)).toBeTruthy());
    expect(screen.queryByTestId(`row-fault-${READY.agreementId}`)).toBeNull();
  });

  /** A session with nothing wrong shows the chip alone, as it always did. */
  it('says nothing on a healthy session', async () => {
    stubFetch({
      sessions: [SESSION],
      rows: [{ ...READY, activeSession: { id: SESSION.id, deviceId: TABLET.id, state: 'reading' as const } }],
    });
    render(<TabletView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`pushable-${READY.agreementId}`)).toBeTruthy());
    expect(screen.queryByTestId(`row-fault-${READY.agreementId}`)).toBeNull();
  });
});
