/**
 * THE PUSHED CEREMONY — reception hands the patient a locked screen
 * (TODO.md "Two front doors", Carl 4 September 2026).
 *
 * "Reception has checked the patient across the desk and pushes the agreement
 * from `/practice/tablet` to the paired tablet beside them. The patient never
 * searches or types: they tick their details as correct, read the agreement,
 * approve/sign, done."
 *
 * WHAT THESE TESTS PROTECT is the SEQUENCE and the WIRE, which is where both
 * of the plausible mistakes live. The sequence: a push must take the tablet
 * over from idle, must never interrupt a walk-up patient mid-ceremony, must
 * skip verification and "who is signing" entirely, and must give the tablet
 * back the moment the session ends. The wire: what leaves the device when the
 * patient ticks their details is five WORDS — `name`, `date_of_birth`,
 * `address`, `mobile`, `email` — and never the values behind them (REQ-VER-04,
 * hard rule 9). A tick that posted a date of birth back would be the whole
 * point of the design undone in one line, and nothing but an assertion on the
 * request body catches it.
 *
 * They run against the real `Ceremony`, with `./api` mocked wholesale, for the
 * reason `walk-up-claim.test.tsx` gives: what matters is which calls the
 * ceremony makes and which screen it lands on.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CONFIRMABLE_DETAIL_TYPES, type TabletSessionPayload } from '@aobplatform/domain';
import { Ceremony } from './Ceremony';
import { strings } from './strings';
import { KioskApiError, type KioskWaitingRow } from './api';

/**
 * The pushed patient. Obviously fake, and carrying no Medicare number —
 * there is no field for one in `TabletSessionPayload` and no column for one
 * behind it (hard rule 1, REQ-VER-02).
 */
const SESSION: TabletSessionPayload = {
  id: '11111111-1111-4111-8111-111111111111',
  state: 'pushed',
  agreementType: 'episodic_pre',
  patient: {
    givenNames: 'Riley',
    familyName: 'Example',
    dateOfBirth: '1988-03-09',
    address: '7 Sample Road, Sampletown NSW 2000',
    mobile: '0400 000 000',
    email: 'riley@example.invalid',
  },
  assignor: { isPatient: true },
  patientId: 'e609b40e-63aa-56e1-8f5b-2e9bc5aa5133',
  detailsCheck: 'required',
  agreementId: 'ag-riley',
  captureRequestId: 'cr-riley-pushed',
};

const AGREEMENT = {
  id: SESSION.agreementId,
  type: 'episodic_pre',
  status: 'awaiting_signature',
  patientId: 'pt-riley',
  assignorId: 'as-1',
  assignorIsPatient: true,
  particulars: { patientName: 'Riley Example', serviceDate: '2026-09-04' },
  particularsLockedAt: '2026-09-04T08:30:00.000Z',
  ruleSetVersion: '2026.07.01',
  mappingVersion: '2026.07.01',
  renderedArtefactHash: 'a'.repeat(64),
};

/** A walk-up row, used only by the test that proves a push does NOT barge in. */
const WALK_UP_ROW: KioskWaitingRow = {
  captureRequestId: 'cr-walkup',
  agreementId: 'ag-walkup',
  patientId: 'pt-walkup',
  patientName: 'Morgan Placeholder',
  providerName: 'Dr Sample Provider',
  appointmentDate: '2026-09-04',
  appointmentTime: '09:00',
  agreementStatus: 'awaiting_signature',
  agreementType: 'episodic_pre',
  waitingSince: '2026-09-04T08:00:00.000Z',
  signable: true,
  blockedReason: null,
};

const {
  claimWaitingRow,
  confirmSessionDetails,
  fetchAgreement,
  fetchKioskMe,
  fetchTabletSession,
  fetchWaitingList,
  startChallenge,
  attemptChallenge,
  setTabletSessionState,
  transitionAgreement,
  changeAssignor,
  lockParticulars,
  signAgreement,
  completeCapture,
} = vi.hoisted(() => ({
  claimWaitingRow: vi.fn(),
  confirmSessionDetails: vi.fn(),
  fetchAgreement: vi.fn(),
  fetchKioskMe: vi.fn(),
  fetchTabletSession: vi.fn(),
  fetchWaitingList: vi.fn(),
  startChallenge: vi.fn(),
  attemptChallenge: vi.fn(),
  setTabletSessionState: vi.fn(),
  transitionAgreement: vi.fn(),
  changeAssignor: vi.fn(),
  lockParticulars: vi.fn(),
  signAgreement: vi.fn(),
  completeCapture: vi.fn(),
}));

vi.mock('./pairing', () => ({
  PAIRING_CREDENTIAL_KEY: 'aob.kiosk.pairing',
  PERSISTABLE_KEYS: ['aob.kiosk.pairing'],
  readPairingCredential: () => 'fake-device-credential',
  writePairingCredential: () => true,
  clearPairingCredential: vi.fn(),
}));

vi.mock('./api', () => ({
  /*
   * THE HEARTBEAT, STUBBED HEALTHY (Carl, 4–5 Sep 2026). `useKioskHeartbeat`
   * runs on every screen of the ceremony, so every suite that drives the real
   * `Ceremony` needs it to answer — two consecutive failures would replace the
   * screen under the test with "Please contact reception", which is
   * `outage.test.tsx`'s subject and nobody else's. No command, no cadence of
   * its own, not out of use: the quiet answer.
   */
  sendKioskHeartbeat: vi.fn(async () => ({
    command: null,
    pollMs: 0,
    outOfUse: false,
    reload: false,
  })),
  KioskApiError: class KioskApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  isUnpaired: () => false,
  fetchKioskMe,
  fetchWaitingList,
  fetchPracticeStaffNames: vi.fn(async () => []),
  fetchTabletSession,
  confirmSessionDetails,
  setTabletSessionState,
  claimWaitingRow,
  fetchAgreement,
  startChallenge,
  attemptChallenge,
  transitionAgreement,
  changeAssignor,
  lockParticulars,
  signAgreement,
  completeCapture,
}));

const IDENTIFIER_TYPES = ['name', 'date_of_birth', 'address'];

/**
 * EVERY CALL THAT COULD CHANGE WHAT THE SERVER HOLDS ABOUT AN AGREEMENT. The
 * pushed path uses none of them until the patient signs — the ticks and the
 * exit touch the SESSION, never the contract.
 */
const AGREEMENT_MUTATORS = [
  startChallenge,
  attemptChallenge,
  claimWaitingRow,
  transitionAgreement,
  changeAssignor,
  lockParticulars,
  signAgreement,
  completeCapture,
] as const;

function asPairedTablet(pollMs = 60_000, rows: readonly KioskWaitingRow[] = []): void {
  fetchKioskMe.mockResolvedValue({
    deviceId: 'device-1',
    deviceLabel: 'Carl browser tablet',
    practiceId: 'practice-1',
    practiceName: 'Sample Practice',
    state: 'NSW',
    identifierTypes: IDENTIFIER_TYPES,
    showsWaitingList: rows.length > 0,
    reload: false,
  });
  fetchWaitingList.mockResolvedValue({
    kind: 'changed' as const,
    etag: '"rev-1"',
    body: {
      practiceId: 'practice-1',
      revision: 'rev-1',
      pollMs,
      identifierTypes: IDENTIFIER_TYPES,
      waiting: rows,
      hidden: rows.length === 0,
      reload: false,
    },
  });
}

/** Tick every row K-P1 drew, in the order the domain lists them. */
function tickEverything(): void {
  for (const type of CONFIRMABLE_DETAIL_TYPES) {
    fireEvent.click(screen.getByTestId(`detail-tick-${type}`));
  }
}

beforeEach(() => {
  for (const mock of [
    claimWaitingRow,
    confirmSessionDetails,
    fetchAgreement,
    fetchKioskMe,
    fetchTabletSession,
    fetchWaitingList,
    startChallenge,
    attemptChallenge,
    setTabletSessionState,
    transitionAgreement,
    changeAssignor,
    lockParticulars,
    signAgreement,
    completeCapture,
  ]) {
    mock.mockReset();
  }
  fetchTabletSession.mockResolvedValue({ session: null });
  setTabletSessionState.mockResolvedValue({ id: SESSION.id, state: 'reading' });
  confirmSessionDetails.mockResolvedValue({ id: SESSION.id, state: 'details_confirmed' });
});

describe('pushed_session_takes_over_idle', () => {
  it('replaces the idle screen with "please check your details", and says it is reading', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });

    render(<Ceremony />);

    // K-P1, without anybody pressing Begin. Reception pushed; the tablet is
    // simply showing it by the time the patient is handed the device.
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
    expect(screen.queryByTestId('start-check-in')).toBeNull();

    /*
     * THE COPY IS A DATA CHECK, NOT AN IDENTITY CHECK, and that is the single
     * sentence on this screen most likely to be "improved" into something
     * false. The verification was the staff check across the desk (REQ-VER-03).
     */
    expect(screen.getByTestId('check-details-lede').textContent).toBe(strings.checkDetails.lede);

    // The five rows, with the values their owner is being asked to confirm —
    // and the date of birth in words rather than in ISO.
    expect(screen.getByTestId('detail-value-name').textContent).toBe('Riley Example');
    expect(screen.getByTestId('detail-value-date_of_birth').textContent).toBe('9 March 1988');
    expect(screen.getByTestId('detail-value-address').textContent).toBe(SESSION.patient.address);
    expect(screen.getByTestId('detail-value-mobile').textContent).toBe(SESSION.patient.mobile);
    expect(screen.getByTestId('detail-value-email').textContent).toBe(SESSION.patient.email);

    // Continue is unreachable until every row on screen has been ticked —
    // disabled with a reason, never live-and-inert (CLAUDE.md §6).
    expect((screen.getByTestId('check-details-continue') as HTMLButtonElement).disabled).toBe(true);

    // `reading` is posted as the screen first renders — that is what
    // reception's status column is watching for.
    await waitFor(() =>
      expect(setTabletSessionState).toHaveBeenCalledWith(SESSION.id, 'reading'),
    );

    // A ROW WE HOLD NOTHING FOR IS NOT DRAWN. Nobody is shown a blank line and
    // asked whether it is correct.
    expect(screen.queryByTestId('detail-row-mobile')).toBeTruthy();
  });

  it('a row with no value is not drawn, and is not required', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({
      session: { ...SESSION, patient: { ...SESSION.patient, email: null, mobile: null } },
    });

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());

    expect(screen.queryByTestId('detail-row-email')).toBeNull();
    expect(screen.queryByTestId('detail-row-mobile')).toBeNull();

    for (const type of ['name', 'date_of_birth', 'address']) {
      fireEvent.click(screen.getByTestId(`detail-tick-${type}`));
    }
    // Three ticks was the whole of it, because three rows was the whole of it.
    await waitFor(() =>
      expect((screen.getByTestId('check-details-continue') as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it('does not barge into a walk-up ceremony already in flight', async () => {
    /*
     * SOMEBODY IS STANDING AT THIS TABLET proving who they are. Replacing their
     * screen with a stranger's date of birth would be both a disclosure and a
     * theft of their session, so the push waits for idle (Carl, 4 Sep 2026).
     */
    asPairedTablet(60_000, [WALK_UP_ROW]);
    fetchTabletSession.mockResolvedValue({ session: null });

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('start-check-in')).toBeTruthy());

    // Into the walk-up flow: a test device's list, then K-2.
    fireEvent.click(screen.getByTestId('start-check-in'));
    await waitFor(() => expect(screen.getByTestId(`pick-${WALK_UP_ROW.captureRequestId}`)).toBeTruthy());

    // NOW a push lands. The poll is not even running on this screen.
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(screen.queryByTestId('check-details-heading')).toBeNull();
    expect(document.body.textContent).not.toContain('Riley Example');
    expect(setTabletSessionState).not.toHaveBeenCalled();
  });
});

/**
 * K-P1's REDESIGN — a tick and a cross per row, to the right of the text
 * (Carl, 4 Sep 2026: "Make the big buttons to the right of the text (in case
 * we are using small tablets). We need a button with a tick and another with a
 * cross. The practice-reception-user ... should be able to see the same screen
 * and be told what the patient did not agree to.").
 *
 * WHAT THESE PIN, and none of it is cosmetic. Two controls, so an unanswered
 * row is distinguishable from a wrong one — which is the whole reason a
 * dispute can be carried at all. The buttons AFTER the text in document order,
 * because "to the right" is a reading order before it is a layout, and a
 * screen reader must hear the detail before the answer. A word under each
 * mark, because roughly one man in twelve cannot tell the green from the red.
 * And a cross that reaches the server with no further tap, because the patient
 * has just been told to see reception and must not also have to press Send.
 */
describe('kp1_tick_and_cross_per_row_right_of_the_text', () => {
  it('draws two large controls per row, after the value, each with a word and not colour alone', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());

    for (const type of CONFIRMABLE_DETAIL_TYPES) {
      const row = screen.getByTestId(`detail-row-${type}`);
      const value = screen.getByTestId(`detail-value-${type}`);
      const tick = screen.getByTestId(`detail-tick-${type}`);
      const cross = screen.getByTestId(`detail-cross-${type}`);

      // BOTH CONTROLS EXIST, on every row.
      expect(row.contains(tick)).toBe(true);
      expect(row.contains(cross)).toBe(true);

      /*
       * AND THEY COME AFTER THE TEXT. `DOCUMENT_POSITION_FOLLOWING` is the
       * reading order, which is the half of "to the right of the text" that
       * survives the layout collapsing to one column on a small tablet —
       * below 600px the pair drops UNDER the value, and it must still be read
       * second.
       */
      const order = value.compareDocumentPosition(tick);
      expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(tick.compareDocumentPosition(cross) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      // A WORD UNDER THE MARK, never colour alone (WCAG 1.4.1) — and the state
      // is announced as well as filled.
      expect(tick.textContent).toContain(strings.checkDetails.right);
      expect(cross.textContent).toContain(strings.checkDetails.wrong);
      expect(tick.getAttribute('aria-pressed')).toBe('false');
      expect(cross.getAttribute('aria-pressed')).toBe('false');
    }

    // STILL NO FIELD ON THE SCREEN. A cross says "that is wrong" and offers
    // nowhere to say what is right (Carl, 3 Sep 2026).
    expect(document.querySelectorAll('main input, main select, main textarea')).toHaveLength(0);
  });

  it('an answer is a choice between two, and pressing the same one twice does not clear it', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());

    fireEvent.click(screen.getByTestId('detail-cross-address'));
    await waitFor(() =>
      expect(screen.getByTestId('detail-cross-address').getAttribute('aria-pressed')).toBe('true'),
    );
    expect(screen.getByTestId('detail-tick-address').getAttribute('aria-pressed')).toBe('false');

    // Changing your mind is pressing the OTHER button.
    fireEvent.click(screen.getByTestId('detail-tick-address'));
    await waitFor(() =>
      expect(screen.getByTestId('detail-tick-address').getAttribute('aria-pressed')).toBe('true'),
    );
    expect(screen.getByTestId('detail-cross-address').getAttribute('aria-pressed')).toBe('false');

    /*
     * AND A SECOND PRESS OF THE SAME BUTTON IS NOT A TOGGLE. A stray
     * double-tap that quietly returned the row to unanswered would disable
     * Continue with no visible cause.
     */
    fireEvent.click(screen.getByTestId('detail-tick-address'));
    await waitFor(() =>
      expect(screen.getByTestId('detail-tick-address').getAttribute('aria-pressed')).toBe('true'),
    );
  });
});

describe('any_cross_removes_continue_and_reports_disputes', () => {
  it('posts the crossed TYPES without a further tap, and gives the patient no Continue to press', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(AGREEMENT);
    confirmSessionDetails.mockResolvedValue({ id: SESSION.id, state: 'details_disputed' });

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());

    // Three right, two wrong — every row answered, which is what makes the
    // answer complete enough to send.
    for (const type of ['name', 'date_of_birth', 'email']) {
      fireEvent.click(screen.getByTestId(`detail-tick-${type}`));
    }
    for (const type of ['address', 'mobile']) {
      fireEvent.click(screen.getByTestId(`detail-cross-${type}`));
    }

    /*
     * IT WENT WITHOUT ANYBODY PRESSING CONTINUE. The patient has just been
     * told reception will fix this; if they also had to press Send, the ones
     * who did not would be standing at a desk explaining something the screen
     * already knew.
     */
    await waitFor(() => expect(confirmSessionDetails).toHaveBeenCalledTimes(1));
    const [sessionId, confirmed, disputed] = confirmSessionDetails.mock.calls[0] as [
      string,
      string[],
      string[],
    ];
    expect(sessionId).toBe(SESSION.id);
    expect(confirmed).toEqual(['name', 'date_of_birth', 'email']);
    expect(disputed).toEqual(['address', 'mobile']);

    /*
     * TYPES, AND NOT ONE VALUE — and in particular no replacement for the
     * crossed rows, because the patient was never asked for one and the screen
     * has no field to take it (REQ-VER-04, hard rule 9).
     */
    const wire = JSON.stringify({ confirmed, disputed });
    for (const value of [
      SESSION.patient.givenNames,
      SESSION.patient.familyName,
      SESSION.patient.dateOfBirth as string,
      SESSION.patient.address as string,
      SESSION.patient.mobile as string,
      SESSION.patient.email as string,
      '9 March 1988',
    ]) {
      expect(wire).not.toContain(value);
    }
    expect(wire).not.toMatch(/medicare|\$\s?\d/i);

    /*
     * THE BAND, IN THE PRESENT TENSE, and it says the appointment is safe.
     * By the time this reads it, the post has already landed, so the screen
     * has moved from `disputeBand` to the LOCKED `waitBand` — see
     * `dispute_locks_the_screen_until_reception_resends`, right below, for
     * everything the lock itself does.
     */
    const band = await screen.findByTestId('check-details-wait');
    expect(band.textContent).toBe(strings.checkDetails.waitBand);

    /*
     * AND CONTINUE IS ABSENT, NOT MERELY DISABLED (Carl, 4 Sep 2026). The
     * band above already says reception is fixing it and the appointment is
     * unaffected; a second, disabled box repeating that — with a press that
     * could not do anything — has no business on a patient screen (CLAUDE.md
     * §6: a control that cannot do anything is not "disabled", it is not
     * offered).
     */
    expect(screen.queryByTestId('check-details-continue')).toBeNull();
    expect(fetchAgreement).not.toHaveBeenCalled();
    expect(screen.queryByTestId('particulars-heading')).toBeNull();

    // The way out is still there, and nothing about the agreement moved.
    expect(screen.getByTestId('leave-for-reception')).toBeTruthy();
    for (const mutator of AGREEMENT_MUTATORS) expect(mutator).not.toHaveBeenCalled();
  });

  /**
   * THE SCREEN LOCKS, once the cross has actually reached reception (Carl's
   * ruling, 4 Sep 2026: "the tablet would be signing against details
   * mid-correction" if a patient could still change an answer after
   * reception has started fixing it). This test used to be the one that
   * proved a patient COULD tick a crossed row back after the post landed —
   * that behaviour is now the bug the lock exists to close. The only ways
   * off are a re-send (proved here), a recall, See reception, or inactivity.
   */
  it('dispute_locks_the_screen_until_reception_resends', async () => {
    asPairedTablet(20);
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(AGREEMENT);

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());

    for (const type of CONFIRMABLE_DETAIL_TYPES) {
      if (type === 'mobile') fireEvent.click(screen.getByTestId('detail-cross-mobile'));
      else fireEvent.click(screen.getByTestId(`detail-tick-${type}`));
    }
    await waitFor(() => expect(confirmSessionDetails).toHaveBeenCalledTimes(1));

    // THE BAND CHANGES TENSE — reception already has the cross and is acting
    // on it, so this is no longer "please see reception", it is "please wait".
    await waitFor(() => expect(screen.getByTestId('check-details-wait')).toBeTruthy());
    expect(screen.getByTestId('check-details-wait').textContent).toBe(strings.checkDetails.waitBand);
    expect(screen.queryByTestId('check-details-dispute')).toBeNull();
    // NO CONTROL THAT CANNOT DO ANYTHING — Continue is absent, not disabled.
    expect(screen.queryByTestId('check-details-continue')).toBeNull();

    /*
     * ONLY THE CHOSEN BUTTON REMAINS ON EACH ROW — NOT DISABLED AND GREYED,
     * NOT RENDERED (Carl, 4 Sep 2026, on seeing the locked screen: "so only
     * the chosen answer remains ... that makes what the patient selected
     * unmistakable"). A real `disabled`, and pressing it anyway moves nothing
     * and sends nothing a second time.
     */
    for (const type of CONFIRMABLE_DETAIL_TYPES) {
      const wasCrossed = type === 'mobile';
      const shown = screen.getByTestId(
        wasCrossed ? `detail-cross-${type}` : `detail-tick-${type}`,
      ) as HTMLButtonElement;
      expect(shown.disabled).toBe(true);
      expect(shown.textContent).toContain(
        wasCrossed ? strings.checkDetails.wrong : strings.checkDetails.right,
      );
      expect(screen.queryByTestId(wasCrossed ? `detail-tick-${type}` : `detail-cross-${type}`)).toBeNull();
    }
    fireEvent.click(screen.getByTestId('detail-cross-mobile'));
    expect(confirmSessionDetails).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('detail-cross-mobile').getAttribute('aria-pressed')).toBe('true');

    // See reception is still there, and nothing about the agreement moved.
    expect(screen.getByTestId('leave-for-reception')).toBeTruthy();
    for (const mutator of AGREEMENT_MUTATORS) expect(mutator).not.toHaveBeenCalled();

    /*
     * ONLY A RE-SEND FREES IT. Reception fixes the mobile number and pushes a
     * new session id — the take-over effect drops the lock along with
     * everything else about the superseded screen (`resend-session.test.tsx`
     * proves the take-over itself; this proves the lock rides along with it).
     * AND BOTH BUTTONS ARE BACK ON EVERY ROW — the hidden one is not merely
     * re-enabled, it exists again.
     */
    fetchTabletSession.mockResolvedValue({ session: { ...SESSION, id: 'resent-session-id' } });
    await waitFor(() => expect(screen.queryByTestId('detail-tick-mobile')).not.toBeNull(), {
      timeout: 3_000,
    });
    for (const type of CONFIRMABLE_DETAIL_TYPES) {
      expect((screen.getByTestId(`detail-tick-${type}`) as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByTestId(`detail-cross-${type}`) as HTMLButtonElement).disabled).toBe(false);
    }
    expect(screen.queryByTestId('check-details-wait')).toBeNull();
  });

  /**
   * THE OTHER WAY IN: A RELOAD OR AN HMR REMOUNT MID-SESSION. This tab's own
   * memory of having sent a dispute is gone, but the server's is not — the
   * very FIRST poll of a session already reading `details_disputed` locks the
   * screen without this device posting anything.
   */
  it('reloaded_tablet_relocks_from_polled_state', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: { ...SESSION, state: 'details_disputed' } });
    fetchAgreement.mockResolvedValue(AGREEMENT);

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-wait')).toBeTruthy());
    expect(screen.getByTestId('check-details-wait').textContent).toBe(strings.checkDetails.waitBand);
    expect(screen.queryByTestId('check-details-continue')).toBeNull();

    /*
     * NEITHER BUTTON REMAINS ON ANY ROW — this tab's own memory of what the
     * patient answered is gone with the reload, so there is no "chosen"
     * button to keep. `answers` is empty and stays empty: nothing here
     * invents an answer the patient did not give on THIS mount.
     */
    for (const type of CONFIRMABLE_DETAIL_TYPES) {
      expect(screen.queryByTestId(`detail-tick-${type}`)).toBeNull();
      expect(screen.queryByTestId(`detail-cross-${type}`)).toBeNull();
    }

    // NOTHING WAS SENT TO GET HERE — the lock came from the poll alone.
    expect(confirmSessionDetails).not.toHaveBeenCalled();
    for (const mutator of AGREEMENT_MUTATORS) expect(mutator).not.toHaveBeenCalled();
  });
});

describe('details_confirmation_sends_types_not_values', () => {
  it('posts the five TYPES and nothing that could identify anybody', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(AGREEMENT);

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());

    tickEverything();
    await waitFor(() =>
      expect((screen.getByTestId('check-details-continue') as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId('check-details-continue'));

    await waitFor(() => expect(confirmSessionDetails).toHaveBeenCalledTimes(1));
    const [sessionId, confirmed] = confirmSessionDetails.mock.calls[0] as [string, string[]];
    expect(sessionId).toBe(SESSION.id);

    // THE LIST IS THE DOMAIN'S FIVE WORDS, in the domain's own order.
    expect(confirmed).toEqual([...CONFIRMABLE_DETAIL_TYPES]);

    /*
     * AND NOT ONE VALUE WENT WITH THEM. Asserted over the SERIALISED body,
     * because that is what leaves the device — a nested object carrying a date
     * of birth would pass an assertion on the array alone (REQ-VER-04).
     */
    const wire = JSON.stringify({ confirmed });
    for (const value of [
      SESSION.patient.givenNames,
      SESSION.patient.familyName,
      SESSION.patient.dateOfBirth as string,
      SESSION.patient.address as string,
      SESSION.patient.mobile as string,
      SESSION.patient.email as string,
      '1988',
      '9 March 1988',
    ]) {
      expect(wire).not.toContain(value);
    }
    // No Medicare number could travel here — there is no field for one anywhere
    // in the payload — and no amount either (hard rules 1 and 4).
    expect(wire).not.toMatch(/medicare|\$\s?\d/i);
  });
});

describe('pushed_flow_skips_verification_and_who_signs', () => {
  it('goes K-P1 → K-3, asking nobody to type and offering nobody a choice', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(AGREEMENT);

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());

    // K-P1 ITSELF ASKS FOR NOTHING TYPED. No input, select or textarea, for the
    // reason K-3 has none: the tablet never presents a field a patient or a
    // passer-by could fill on the practice's behalf (Carl, 3 Sep 2026).
    expect(document.querySelectorAll('main input, main select, main textarea')).toHaveLength(0);
    expect(screen.queryByTestId('identifier-name-given')).toBeNull();

    tickEverything();
    fireEvent.click(screen.getByTestId('check-details-continue'));

    await waitFor(() => expect(screen.getByTestId('particulars-heading')).toBeTruthy());

    // NO VERIFICATION HAPPENED ON THIS DEVICE. The staff check across the desk
    // was the verification, and the push recorded it with the staff identity.
    expect(startChallenge).not.toHaveBeenCalled();
    expect(attemptChallenge).not.toHaveBeenCalled();
    expect(claimWaitingRow).not.toHaveBeenCalled();

    // NO K-5. Who signs was set at the desk before the push and the particulars
    // are locked, so there is nothing to choose — K-3 states it read-only.
    expect(screen.queryByTestId('assignor-self')).toBeNull();
    expect(screen.queryByTestId('assignor-other')).toBeNull();
    expect(screen.getByText(strings.particulars.assignorIsPatient)).toBeTruthy();
    expect(screen.getByTestId('assignor-locked-note').textContent).toBe(
      strings.particulars.assignorLockedNote,
    );
    /*
     * BUT BACK IS THERE (Carl, 4 Sep 2026 — this REVERSES the assertion that
     * stood here, which said Back was withdrawn with K-5). It was withdrawn
     * because on a locked WALK-UP agreement there is nothing behind K-3. On
     * the PUSHED path there is: K-P1, "Please check your details". Withdrawing
     * it there left a patient who wanted to re-read their address with only
     * the way out, which summons a person who is not needed.
     */
    expect(screen.getByTestId('particulars-back')).toBeTruthy();

    // NOTHING WAS RE-LOCKED OR RE-POINTED ON THE WAY PAST. The push validated
    // and locked on the SERVER, which is why a tablet cannot hold a draft.
    expect(lockParticulars).not.toHaveBeenCalled();
    expect(changeAssignor).not.toHaveBeenCalled();
    expect(transitionAgreement).not.toHaveBeenCalled();

    // And the way out is still on the screen (REQ-REC-04).
    expect(screen.getByTestId('leave-for-reception')).toBeTruthy();
  });

  it('signs against the session’s own capture request, through the existing sign call', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(AGREEMENT);
    signAgreement.mockResolvedValue(AGREEMENT);
    completeCapture.mockResolvedValue({});

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
    tickEverything();
    fireEvent.click(screen.getByTestId('check-details-continue'));
    await waitFor(() => expect(screen.getByTestId('continue-to-sign')).toBeTruthy());
    fireEvent.click(screen.getByTestId('continue-to-sign'));

    await waitFor(() => expect(screen.getByTestId('sign-control-tap')).toBeTruthy());
    fireEvent.click(screen.getByTestId('sign-control-tap'));

    await waitFor(() => expect(signAgreement).toHaveBeenCalledTimes(1));
    const [agreementId, body] = signAgreement.mock.calls[0] as [
      string,
      { captureRequestId: string; method: string },
    ];
    expect(agreementId).toBe(SESSION.agreementId);
    expect(body.captureRequestId).toBe(SESSION.captureRequestId);
    expect(body.method).toBe('tap_to_approve');

    // The tablet never declares the session signed — the server does that off
    // the signature event. Only `reading` was ever set from this device.
    for (const call of setTabletSessionState.mock.calls) expect(call[1]).toBe('reading');

    await waitFor(() => expect(screen.getByTestId('complete-heading')).toBeTruthy());
    expect(screen.getByTestId('complete-heading').textContent).toContain('Riley');
  });
});

describe('walked_away_posts_state_and_changes_nothing_else', () => {
  it('ends the session and leaves the agreement exactly where it was', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());

    fireEvent.click(screen.getByTestId('leave-for-reception'));

    await waitFor(() =>
      expect(setTabletSessionState).toHaveBeenCalledWith(SESSION.id, 'walked_away'),
    );

    /*
     * THE ASSERTION THAT MATTERS. `walked_away` ends a SCREEN, never an
     * agreement: nothing is transitioned, locked, re-pointed, signed or
     * completed, and no capture request is closed. The patient is still seen,
     * and reception chooses a private bill or an episodic agreement after the
     * service (hard rule 8, REQ-REC-04). It is not a decline either — `declined`
     * is a status with consequences, and somebody who wanted to ask a question
     * has declined nothing.
     */
    for (const mutator of AGREEMENT_MUTATORS) expect(mutator).not.toHaveBeenCalled();
    expect(confirmSessionDetails).not.toHaveBeenCalled();

    // The hand-over promises nothing and says the appointment is unaffected.
    expect(screen.getByTestId('handover-heading').textContent).toBe(strings.chrome.leaveHeading);
    expect(screen.getByTestId('handover-body').textContent).toBe(strings.chrome.leaveBody);
    // Nothing of the patient survives on the screen they were handed over from.
    expect(document.body.textContent).not.toContain('Riley Example');
    // THE WHOLE DATE, NOT THE BARE YEAR — a footer session id or device id
    // is free to contain the same four digits by chance (same lesson as
    // patients.test.tsx's arrivals suite, flaked on CI for the same reason).
    expect(document.body.textContent).not.toContain(SESSION.patient.dateOfBirth as string);
  });
});

describe('recalled_session_returns_tablet_to_idle', () => {
  it('clears every detail and goes back to idle when the session disappears', async () => {
    // A fast cadence so the second poll — the one that answers `null` — lands
    // inside the test. The number is the SERVER'S in production; here it is a
    // fixture, which is exactly how `pollMs` is meant to work.
    asPairedTablet(20);
    fetchTabletSession.mockResolvedValueOnce({ session: SESSION });
    fetchTabletSession.mockResolvedValue({ session: null });

    render(<Ceremony />);
    // It took the tablet over first — asserted with `findBy` rather than a
    // second synchronous read, because at a 20ms cadence the recall can land
    // between the two, which is the whole behaviour under test.
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());

    /*
     * RECALLED FROM THE CONSOLE — or expired after thirty minutes, or signed
     * elsewhere. All three look identical from here and all three mean the
     * same thing: this is nobody's screen any more.
     */
    await waitFor(() => expect(screen.getByTestId('start-check-in')).toBeTruthy(), { timeout: 3_000 });

    expect(screen.queryByTestId('check-details-heading')).toBeNull();
    expect(document.body.textContent).not.toContain('Riley Example');
    expect(document.body.textContent).not.toContain('7 Sample Road');
    expect(document.body.textContent).not.toContain('riley@example.invalid');

    // And the tablet did NOT report a walk-away it did not witness: a recall is
    // reception's act, not the patient's.
    for (const call of setTabletSessionState.mock.calls) expect(call[1]).toBe('reading');
  });
});

describe('pushed_k3_uses_type_specific_heading', () => {
  it('reads the heading from the session’s agreement type, on K-P1 and on K-3', async () => {
    /*
     * ENDURING IS USED HERE BECAUSE IT IS THE ONE TYPE WHOSE HEADING DIFFERS —
     * "Agree to bulk billing", with no "for today's visit", because a standing
     * agreement is not about today.
     *
     * THE SERVER REFUSES TO PUSH ONE TODAY (`enduring_not_supported`): the
     * s 65C rule set has no enduring path and it is a human-authored zone
     * (CLAUDE.md §7), so filling it in from an agent would be authoring
     * regulation. What this asserts is that the TABLET is already right — it
     * reads the type off the session rather than assuming episodic — so the day
     * Carl writes that branch, no kiosk change is needed and no patient reads a
     * standing agreement under a heading about today.
     */
    const enduring = { ...SESSION, agreementType: 'enduring' as const };
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: enduring });
    fetchAgreement.mockResolvedValue({ ...AGREEMENT, type: 'enduring' });

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
    expect(screen.getByTestId('check-details-heading').textContent).toBe(
      strings.particulars.headingByAgreementType.enduring,
    );

    tickEverything();
    fireEvent.click(screen.getByTestId('check-details-continue'));

    await waitFor(() => expect(screen.getByTestId('particulars-heading')).toBeTruthy());
    expect(screen.getByTestId('particulars-heading').textContent).toBe(
      strings.particulars.headingByAgreementType.enduring,
    );
    // Not the episodic wording, which is the mistake this is guarding.
    expect(screen.getByTestId('particulars-heading').textContent).not.toBe(
      strings.particulars.headingByAgreementType.episodic_pre,
    );
  });
});

/**
 * BACK ON THE PUSHED PATH (Carl, 4 September 2026).
 *
 * > "K-3 → back to K-P1 'Please check your details' (ticks preserved in
 * > memory, so they do not re-tick everything); K-4 → K-3 as now. K-P1 itself
 * > has no Back — before it is idle, and leaving is 'See reception'."
 *
 * THE TICKS ARE THE POINT. Five rows is five taps, and a Back that made
 * somebody do them again would be a control nobody would use twice. They live
 * in `Ceremony`'s own state, so returning costs nothing — and, because they
 * live there and not on the server, going back does not un-confirm anything
 * either: `confirm-details` was posted once and is not re-posted on the way
 * back, which is asserted below.
 */
describe('pushed_k3_back_returns_to_check_details_with_ticks_kept', () => {
  it('returns to K-P1 with every row still ticked, and re-posts nothing', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(AGREEMENT);

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
    tickEverything();
    fireEvent.click(screen.getByTestId('check-details-continue'));
    await waitFor(() => expect(screen.getByTestId('particulars-heading')).toBeTruthy());
    expect(confirmSessionDetails).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('particulars-back'));

    // K-P1 again — the screen behind K-3 on this path.
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());

    /*
     * AND EVERY ROW IS STILL TICKED, which is visible in the state of the
     * control (label AND `aria-pressed`, never colour alone) and in the fact
     * that Continue is live rather than blocked behind five outstanding rows.
     */
    for (const type of CONFIRMABLE_DETAIL_TYPES) {
      const tick = screen.getByTestId(`detail-tick-${type}`);
      expect(tick.getAttribute('aria-pressed')).toBe('true');
      expect(tick.textContent).toContain(strings.checkDetails.right);
    }
    expect((screen.getByTestId('check-details-continue') as HTMLButtonElement).disabled).toBe(false);

    // Nothing was re-confirmed on the way back. One tick, one post.
    expect(confirmSessionDetails).toHaveBeenCalledTimes(1);
  });

  it('back_makes_no_mutating_calls_on_pushed_path', async () => {
    /*
     * THE ASSERTION THAT MATTERS, and the same one `way-out.test.tsx` makes
     * about the exit. Back is navigation. On a path where the agreement is
     * already locked and rendered on the server, a "Back" that quietly
     * re-locked it, re-pointed the assignor or moved the session's state would
     * be a mutation wearing the word — and the only thing that catches it is a
     * count on every call that could change what the server holds.
     */
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(AGREEMENT);

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
    tickEverything();
    fireEvent.click(screen.getByTestId('check-details-continue'));
    await waitFor(() => expect(screen.getByTestId('continue-to-sign')).toBeTruthy());

    // K-3 → K-4 → back to K-3 → back to K-P1: every Back on the path.
    fireEvent.click(screen.getByTestId('continue-to-sign'));
    await waitFor(() => expect(screen.getByTestId('signature-back')).toBeTruthy());
    fireEvent.click(screen.getByTestId('signature-back'));
    await waitFor(() => expect(screen.getByTestId('particulars-back')).toBeTruthy());
    fireEvent.click(screen.getByTestId('particulars-back'));
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());

    for (const mutator of AGREEMENT_MUTATORS) expect(mutator).not.toHaveBeenCalled();
    // The SESSION was not moved either. `reading` was posted once, as K-P1
    // first rendered; no Back reported a walk-away, a recall or anything else.
    for (const call of setTabletSessionState.mock.calls) expect(call[1]).toBe('reading');
    expect(confirmSessionDetails).toHaveBeenCalledTimes(1);
  });

  it('K-P1 itself has no Back — before it is idle, and leaving is the way out', async () => {
    /*
     * Carl's ruling, and the reasoning is the one this codebase already
     * applies to a locked K-3: never draw a control that leads nowhere. What
     * is behind K-P1 is the idle screen, and going there deliberately — rather
     * than walking away — is not a thing a patient does. The way out is, and
     * it is on the screen, and it posts `walked_away`.
     */
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());

    expect(screen.queryByTestId('particulars-back')).toBeNull();
    expect(screen.queryByTestId('verify-back')).toBeNull();
    expect(screen.getByTestId('leave-for-reception')).toBeTruthy();
  });
});


/**
 * K-P1 HAS TO FIT A LANDSCAPE TABLET (Carl, 7 Sep 2026 — "format page so there
 * is no scroll bar", "the footer is too fat", "write to the right side
 * somewhere").
 *
 * K-P1, NOT K-2, AND THE TEST IS NAMED FOR IT. Carl's screenshot said "K-2"
 * and the first version of this test took the word from him; the screen with
 * five ticked rows on it is `CheckDetailsScreen`, which this codebase calls
 * K-P1 everywhere else. K-2 is `VerifyScreen`, where a walk-up patient TYPES
 * three identifiers. A test named after the wrong screen sends the next person
 * to the wrong file (wow.md §2 item 6).
 *
 * WHAT JSDOM CAN AND CANNOT PROVE, said plainly rather than implied. There is
 * no layout engine here: every box is zero pixels tall, so nothing in this file
 * can assert that the screen fits 1024x768 — and a test that claimed to would
 * be worse than no test. What it CAN pin is the STRUCTURE the fit depends on,
 * which is also the structure a later edit is most likely to undo:
 *
 *  - the footer's identifiers are ONE row inside ONE container, not five
 *    stacked lines (the hundred pixels that put the Continue button against
 *    the divider);
 *  - the explanatory copy is in the RIGHT column beside the See reception
 *    card, not in the left column above the rows;
 *  - and the left column carries only the heading, the rows and Continue.
 *
 * THE PIXELS THEMSELVES WERE CHECKED BY HAND, at 1024x768, 1180x820 and
 * 1280x800 in a real browser against `npm run dev -w apps/web`, asserting
 * `document.scrollingElement.scrollHeight <= innerHeight` and that the
 * content column's own `scrollHeight <= clientHeight` at each size (7 Sep
 * 2026). That check belongs to whoever changes this screen's spacing next; it
 * cannot be automated in this runner.
 */
describe('kp1_fits_a_landscape_tablet_without_page_scroll', () => {
  it('lays the footer identifiers on one row, and puts the explanatory copy in the right column', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());

    /*
     * ONE ROW, ONE CONTAINER. Every identifier is a child of the same element,
     * so the footer is one line of text that wraps rather than a stack that
     * cannot. The device identity arrives on its own fetch, so this waits for
     * the last of the five rather than reading the container the moment it
     * appears (wow.md §2.6 — wait for the data, not the element).
     */
    const identityRow = await screen.findByTestId('kiosk-footer-identity');
    await waitFor(() => expect(screen.getByTestId('kiosk-device-identity')).toBeTruthy());

    for (const testId of [
      'kiosk-build',
      'kiosk-device-identity',
      'kiosk-session-identity',
      'kiosk-patient-identity',
    ]) {
      expect(identityRow.contains(screen.getByTestId(testId))).toBe(true);
    }
    // The wordmark leads it, and the patient id — full length, never elided —
    // ends it.
    expect(identityRow.textContent).toContain(strings.appName);
    expect(identityRow.textContent).toContain(SESSION.patientId);

    /*
     * THE COPY MOVED, IT DID NOT CHANGE. Same two strings, same words: the
     * lede that was under the heading and the tagline that was in the footer,
     * now both beside the See reception card. Asserted against the string
     * table so a reworded table moves the test with it.
     */
    const lede = screen.getByTestId('check-details-lede');
    const context = screen.getByTestId('check-details-context');
    expect(lede.textContent).toBe(strings.checkDetails.lede);
    expect(context.textContent).toBe(strings.checkDetails.footer);

    /*
     * AND THE HEADING STILL CARRIES THE LEDE, however far across the screen it
     * has been moved. Moving copy out of the left column moved it in the
     * READING ORDER too: without this wire, somebody hearing the page read out
     * meets five rows before "our staff have already confirmed who you are",
     * which is the one sentence on K-P1 that must not arrive late.
     *
     * The pointer is FOLLOWED, not merely asserted to exist — an
     * `aria-describedby` naming an id nothing carries is silent, and a test
     * that only checked the attribute's value would pass on exactly that bug.
     */
    const describedBy = screen.getByTestId('check-details-heading').getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const description = document.getElementById(describedBy as string);
    expect(description).toBeTruthy();
    expect(description?.textContent).toBe(strings.checkDetails.lede);
    expect(description).toBe(lede);

    // BOTH IN THE RAIL, beside "See reception" — not in the column with the
    // rows in it.
    const rail = screen.getByTestId('check-details-rail');
    expect(rail.contains(screen.getByTestId('check-details-wrong'))).toBe(true);
    expect(rail.contains(lede)).toBe(true);
    expect(rail.contains(context)).toBe(true);
    expect(rail.contains(screen.getByTestId('check-details-heading'))).toBe(false);
    expect(rail.contains(screen.getByTestId('detail-row-name'))).toBe(false);

    // AND THE TAGLINE IS NOT ALSO IN THE FOOTER. It moved; it was not copied,
    // or a patient would read the same sentence twice on one screen.
    const footer = identityRow.parentElement;
    expect(footer?.textContent).not.toContain(strings.checkDetails.footer);
  });
});

/**
 * "ON TOP OF EACH PAGE OF THIS WORKFLOW IT SHOULD SAY 'AGREE TO BULK BILLING';
 * ON THE NEXT LINE IT SHOULD SAY BY WHO — NAME OF PERSON" (Carl, 7 Sep 2026,
 * testing the pushed flow).
 *
 * WHAT WAS WRONG. Each step headed itself, from its own string, so what a
 * patient read at the top changed shape as they moved through ONE act — and
 * none of the steps said whose agreement it was. A tablet handed across a desk
 * raises exactly that question, and the only screen that answered it was the
 * one with the pen on it.
 *
 * THE TWO LINES ARE CONSTANT AND THE PARTY LINE IS ONE FUNCTION. Both go
 * through `signingByLine` (`rules/who-is-signing.ts`), which is the same
 * branch K-4's fuller statement reads, so no page of one ceremony can name a
 * different person from the page before it. That is the property here: the
 * SAME words on every step, from BOTH fixtures.
 */
describe('every_ceremony_step_says_agree_to_bulk_billing_and_by_whom', () => {
  /** Somebody other than the patient, with a stated relationship. */
  const OTHER_SIGNS: TabletSessionPayload = {
    ...SESSION,
    assignor: { isPatient: false, name: 'Alex Fictional', relationship: 'Mother' },
  };
  const OTHER_AGREEMENT = {
    ...AGREEMENT,
    assignorIsPatient: false,
    particulars: {
      ...AGREEMENT.particulars,
      assignorName: 'Alex Fictional',
      assignorRelationship: 'Mother',
    },
  };

  /**
   * Read the heading a patient actually sees — the title line and the party
   * line as one block, which is how it is rendered and how it is read.
   */
  function headingLines(): { title: string; by: string } {
    return {
      title: screen.getByTestId('check-details-heading').textContent ?? '',
      by: screen.getByTestId('ceremony-by').textContent ?? '',
    };
  }

  it('says it on K-P1, K-3, the statements and K-4 when the patient signs', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(AGREEMENT);

    render(<Ceremony />);

    // K-P1.
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
    const expectedBy = strings.chrome.signingBy('Riley Example');
    expect(headingLines()).toEqual({ title: strings.chrome.ceremonyTitle, by: expectedBy });
    // The type's qualifier is still shown — demoted to its own smaller line,
    // not dropped (an episodic agreement IS about today's visit).
    expect(screen.getByTestId('ceremony-sub').textContent).toBe(
      strings.chrome.ceremonySubHeading.episodic_pre,
    );

    // K-3, the reading step, which carries the statements and the document.
    tickEverything();
    fireEvent.click(screen.getByTestId('check-details-continue'));
    await waitFor(() => expect(screen.getByTestId('particulars-heading')).toBeTruthy());
    expect(screen.getByTestId('particulars-heading').textContent).toBe(strings.chrome.ceremonyTitle);
    expect(screen.getByTestId('ceremony-by').textContent).toBe(expectedBy);

    // K-4, the pen.
    fireEvent.click(screen.getByTestId('continue-to-sign'));
    await waitFor(() => expect(screen.getByTestId('signature-heading')).toBeTruthy());
    expect(screen.getByTestId('signature-heading').textContent).toBe(strings.chrome.ceremonyTitle);
    expect(screen.getByTestId('ceremony-by').textContent).toBe(expectedBy);

    // AND THE HEADER'S SHORT FORM AGREES WITH K-4's FULL STATEMENT, which is
    // the whole reason they share a branch. The header says who; the statement
    // above the pad says who, for whom, and on what footing.
    expect(screen.getByTestId('signature-who').textContent).toBe(
      strings.signature.signingByPatient('Riley Example'),
    );
  });

  it('names the assignor AND the patient when someone else signs', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: OTHER_SIGNS });
    fetchAgreement.mockResolvedValue(OTHER_AGREEMENT);
    setTabletSessionState.mockResolvedValue({ id: OTHER_SIGNS.id, state: 'reading' });
    confirmSessionDetails.mockResolvedValue({ id: OTHER_SIGNS.id, state: 'details_confirmed' });

    render(<Ceremony />);

    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
    const expectedBy = strings.chrome.signingByFor('Alex Fictional', 'Riley Example');
    expect(headingLines()).toEqual({ title: strings.chrome.ceremonyTitle, by: expectedBy });

    tickEverything();
    fireEvent.click(screen.getByTestId('check-details-continue'));
    await waitFor(() => expect(screen.getByTestId('particulars-heading')).toBeTruthy());
    expect(screen.getByTestId('ceremony-by').textContent).toBe(expectedBy);

    fireEvent.click(screen.getByTestId('continue-to-sign'));
    await waitFor(() => expect(screen.getByTestId('signature-heading')).toBeTruthy());
    expect(screen.getByTestId('ceremony-by').textContent).toBe(expectedBy);

    /*
     * THE RELATIONSHIP IS ON K-4 AND NOWHERE ELSE. The header answers "whose
     * agreement is this"; the footing belongs where the pen is, and repeating
     * it at the top of five screens turns a heading into a paragraph.
     */
    expect(expectedBy).not.toContain('Mother');
    expect(screen.getByTestId('signature-who').textContent).toBe(
      strings.signature.signingByOther('Alex Fictional', 'Riley Example', 'Mother'),
    );
  });
});

/**
 * "ON PRESSING CONTINUE, THE BUTTONS SELECTED WERE LOCKED IN AND ALL OTHER
 * BUTTONS HIDDEN, THEN THE CHECK WAS DONE IF REQUIRED, THEN THE NEXT PAGE"
 * (Carl, 7 Sep 2026, testing the pushed flow).
 *
 * THE ORDER IS THE REQUIREMENT. The answers are the patient's until they
 * press; from the press they are the record's. Leaving the rows live through
 * the round trip meant a tap during it could change an answer that had already
 * gone to reception, and a second press of Continue could post twice.
 *
 * IT REUSES THE DISPUTE LOCK'S OWN TREATMENT — only the chosen answer drawn,
 * the other column held by a placeholder — rather than inventing a second
 * "you cannot change this" look. Two visual grammars for one rule is how a
 * patient learns that a locked row sometimes is not.
 */
describe('continue_locks_the_chosen_answers_and_hides_the_rest', () => {
  it('leaves each row showing only what was chosen, unpressable, while the post is in flight', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });

    /*
     * HOLD THE POST OPEN so the in-flight state is observable at all. Without
     * this the promise resolves on the next microtask and the screen is
     * already on K-3 by the time anything can look at it — the assertion would
     * pass or fail on the runner's scheduling rather than on the code.
     */
    let releasePost: (() => void) | undefined;
    confirmSessionDetails.mockImplementation(
      () =>
        new Promise((resolve) => {
          releasePost = () => resolve({ id: SESSION.id, state: 'details_confirmed' });
        }),
    );
    fetchAgreement.mockResolvedValue(AGREEMENT);

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());

    // Four ticks and one cross would send a dispute on its own, so this is the
    // all-ticks answer — the one Continue is actually for.
    tickEverything();
    for (const type of CONFIRMABLE_DETAIL_TYPES) {
      expect(screen.getByTestId(`detail-tick-${type}`)).toBeTruthy();
      expect(screen.getByTestId(`detail-cross-${type}`)).toBeTruthy();
    }

    fireEvent.click(screen.getByTestId('check-details-continue'));

    // THE CHOSEN ANSWER SURVIVES; THE OTHER ONE IS NOT RENDERED AT ALL — not
    // drawn-and-greyed, gone (Carl's ruling for the dispute lock, reused here).
    await waitFor(() => expect(screen.queryByTestId('detail-cross-name')).toBeNull());
    for (const type of CONFIRMABLE_DETAIL_TYPES) {
      const tick = screen.getByTestId(`detail-tick-${type}`) as HTMLButtonElement;
      expect(tick.disabled).toBe(true);
      expect(screen.queryByTestId(`detail-cross-${type}`)).toBeNull();
      // WCAG: a locked control keeps its words. It says what it says, it just
      // cannot be pressed.
      expect(tick.textContent).toContain(strings.checkDetails.right);
    }

    /*
     * CONTINUE KEEPS ITS OWN LABEL AND ANNOUNCES THAT IT IS WORKING. It does
     * not become "Sending…": a button changing its name under the finger that
     * just pressed it reads as a different button. `aria-busy` and the
     * disabling are what a screen reader and a second tap actually need.
     */
    const continueButton = screen.getByTestId('check-details-continue') as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);
    expect(continueButton.getAttribute('aria-busy')).toBe('true');
    expect(continueButton.textContent).toContain(strings.checkDetails.continueAction);

    /*
     * THE BELT-AND-BRACES GUARD, ACTUALLY EXERCISED (review, 7 Sep 2026).
     *
     * Clicking a `button[disabled]` is a no-op in jsdom exactly as it is in a
     * browser, so a plain `fireEvent.click` here proves only that the DISABLED
     * ATTRIBUTE is set — which the loop above already asserted — and never
     * reaches `answerDetail`'s own `disputeSent || confirmLocked` refusal. That
     * refusal exists precisely for "anything that reaches this function
     * directly", so a test of it has to be one of those things.
     *
     * SO THE ATTRIBUTE IS STRIPPED AND THE REAL HANDLER IS FIRED. React's
     * `onClick` is still bound to this node; removing `disabled` re-opens the
     * path a mis-fired tap, a stale render or a future refactor would come
     * down, and the guard is what must stop it. Nothing in the component is
     * mocked or stubbed to do this.
     */
    const lockedTick = screen.getByTestId('detail-tick-name') as HTMLButtonElement;
    lockedTick.removeAttribute('disabled');
    lockedTick.disabled = false;
    fireEvent.click(lockedTick);
    // Also try to change the answer to the OTHER one, from the row that is no
    // longer drawn at all — via the tick, since the cross is gone.
    fireEvent.click(lockedTick);

    // The guard refused: the answer is what it was, and nothing more was sent.
    expect(lockedTick.getAttribute('aria-pressed')).toBe('true');
    expect(confirmSessionDetails).toHaveBeenCalledTimes(1);

    // And Continue is still genuinely dead while the round trip runs.
    fireEvent.click(continueButton);
    expect(confirmSessionDetails).toHaveBeenCalledTimes(1);

    // THEN the check, THEN the next page — in that order.
    releasePost?.();
    await waitFor(() => expect(screen.getByTestId('particulars-heading')).toBeTruthy());
    expect(confirmSessionDetails).toHaveBeenCalledTimes(1);
  });

  it('re-opens the step when the patient deliberately goes back to it', async () => {
    /*
     * BACK IS NOT A FAILURE. Somebody who returns from K-3 to look at their
     * address again is entitled to change what they said about it, exactly as
     * they were before the lock existed — and the post is idempotent against
     * the answer SET, so an unchanged set re-posts nothing.
     */
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(AGREEMENT);

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
    tickEverything();
    fireEvent.click(screen.getByTestId('check-details-continue'));

    await waitFor(() => expect(screen.getByTestId('particulars-back')).toBeTruthy());
    fireEvent.click(screen.getByTestId('particulars-back'));

    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
    for (const type of CONFIRMABLE_DETAIL_TYPES) {
      const tick = screen.getByTestId(`detail-tick-${type}`) as HTMLButtonElement;
      // Still ticked — the ticks live in component state and nobody re-ticks
      // five rows to re-read an address — and pressable again.
      expect(tick.getAttribute('aria-pressed')).toBe('true');
      expect(tick.disabled).toBe(false);
      expect(screen.getByTestId(`detail-cross-${type}`)).toBeTruthy();
    }
    expect(confirmSessionDetails).toHaveBeenCalledTimes(1);
  });
});

/**
 * A TRANSIENT FAILURE MUST NOT THROW THE ANSWERS AWAY (Carl, 7 Sep 2026).
 *
 * WHAT HE SAW, AND THE ROOT CAUSE. Core restarted under the dev watcher while
 * K-P1 was posting. The POST failed, `confirmError` went red, the ceremony went
 * to see-reception, the tablet reset itself, and it came back on the same step
 * with every button live and nothing ticked. The platform had been healthy
 * again for about a second and a half; the patient re-did work the device had
 * already collected. That is the impression this product cannot afford at a
 * reception desk.
 *
 * THE DISTINCTION BEING TESTED is between "I could not reach the server" and
 * "the server said no" (`rules/retry.ts`). A blip is ridden out — four retries
 * at 1s/2s/4s/8s — and a refusal is not retried at all, because it will say the
 * same thing next second and two of the refusals are states the ceremony must
 * move to at once.
 *
 * HARD RULE 8 IS UNCHANGED. When the retries run out the tablet still says see
 * reception, exactly as it did; it just stops doing it for a blip.
 */
describe('a_failed_send_keeps_the_answers_and_retries_before_see_reception', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Every tick still ticked, and none of them pressable. */
  function expectAnswersHeld(): void {
    for (const type of CONFIRMABLE_DETAIL_TYPES) {
      const tick = screen.getByTestId(`detail-tick-${type}`) as HTMLButtonElement;
      expect(tick.getAttribute('aria-pressed')).toBe('true');
      expect(tick.disabled).toBe(true);
    }
  }

  it('rides out two dropped connections, keeps every answer, and lands on the next step', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(AGREEMENT);

    /*
     * A NETWORK THROW, NOT A RESPONSE. `fetch` throws a `TypeError` when
     * nothing was reached, and `KioskApiError` is only ever constructed from a
     * real response — so an ordinary Error here is exactly the shape of the
     * failure Carl hit, and is what `isTransientFailure` treats as worth
     * repeating.
     */
    confirmSessionDetails
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ id: SESSION.id, state: 'details_confirmed' });

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
    tickEverything();
    fireEvent.click(screen.getByTestId('check-details-continue'));

    // THE QUIET LINE, NOT THE RED ONE. Nothing has gone wrong that the patient
    // can act on, so this must not wear the error palette or offer the desk.
    const retrying = await screen.findByTestId('check-details-retrying');
    expect(retrying.textContent).toBe(strings.chrome.oneMoment);
    expect(retrying.getAttribute('role')).toBe('status');
    expect(screen.queryByTestId('check-details-error')).toBeNull();
    expectAnswersHeld();

    // The first two waits, and then the attempt that works.
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    await waitFor(() => expect(screen.getByTestId('particulars-heading')).toBeTruthy());
    expect(confirmSessionDetails).toHaveBeenCalledTimes(3);
    // The answers were never cleared and never re-collected — the patient
    // ticked five rows once.
    expect(screen.queryByTestId('check-details-error')).toBeNull();
  });

  it('gives up after five attempts and offers the desk, with the answers still on screen', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(AGREEMENT);
    confirmSessionDetails.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
    tickEverything();
    fireEvent.click(screen.getByTestId('check-details-continue'));

    // One attempt, then a wait, four times over — about fifteen seconds.
    for (const delay of [1000, 2000, 4000, 8000]) {
      await vi.advanceTimersByTimeAsync(delay);
    }

    const error = await screen.findByTestId('check-details-error');
    expect(error.textContent).toBe(strings.checkDetails.saveFailed);
    // Hard rule 8 unchanged: the message offers the desk, and the way out is
    // still on the screen.
    expect(error.textContent).toContain('reception');
    expect(screen.getByTestId('leave-for-reception')).toBeTruthy();
    expect(screen.queryByTestId('check-details-retrying')).toBeNull();
    expect(confirmSessionDetails).toHaveBeenCalledTimes(5);

    /*
     * THE ANSWERS ARE STILL THERE AND STILL LOCKED. The post may well have
     * landed and the fetch after it failed — the device cannot tell — so
     * unlocking would let somebody change an answer reception has already been
     * shown. What DOES come back is Continue, so a patient who wants to try
     * once more can, and the idempotent post makes trying cost nothing.
     */
    expectAnswersHeld();
    expect((screen.getByTestId('check-details-continue') as HTMLButtonElement).disabled).toBe(false);
  });

  it('stops dead when the ceremony unmounts mid-retry, and touches nothing after it', async () => {
    /*
     * THE TIMER HAS TO DIE WITH THE COMPONENT (review, 7 Sep 2026). A backoff
     * can have eight seconds pending, and the ceremony can leave the screen
     * inside those eight seconds — an inactivity reset, a recall from
     * reception, a hot reload. Without the abort the timer wakes into a dead
     * render tree and calls `setAgreement`/`setStep` on it: React warns, and in
     * a ceremony that resets itself on a clock it is a warning nobody can
     * reproduce deliberately.
     */
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(AGREEMENT);
    confirmSessionDetails.mockRejectedValue(new TypeError('Failed to fetch'));

    /*
     * ANY REACT WARNING FAILS THIS TEST. `act(...)` and "state update on an
     * unmounted component" both arrive on `console.error`, and the whole point
     * of the fix is that neither appears — so the assertion is on the console
     * rather than on an absence somebody has to eyeball in the output.
     */
    const consoleErrors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args);
    };

    try {
      const view = render(<Ceremony />);
      await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
      tickEverything();
      fireEvent.click(screen.getByTestId('check-details-continue'));

      // One attempt made, and a wait pending behind it.
      await waitFor(() => expect(screen.getByTestId('check-details-retrying')).toBeTruthy());
      expect(confirmSessionDetails).toHaveBeenCalledTimes(1);

      view.unmount();

      // Run past the WHOLE backoff — every remaining wait, and more.
      await vi.advanceTimersByTimeAsync(30_000);

      // NOT ONE FURTHER ATTEMPT. The chain stopped at the abort rather than
      // waking up four more times against a server nobody is listening to.
      expect(confirmSessionDetails).toHaveBeenCalledTimes(1);
      expect(fetchAgreement).not.toHaveBeenCalled();
      expect(consoleErrors).toEqual([]);
    } finally {
      console.error = originalError;
    }
  });

  it('does not retry a refusal the server means — it is answered once and acted on', async () => {
    /*
     * THE OTHER HALF OF THE RULE, and the half a retry loop would get badly
     * wrong. A 401 says this tablet is not paired; a 409 says the session is
     * disputed. Both will say the same thing in a second, both are states the
     * ceremony must move to AT ONCE, and "no retry loop hammering the server"
     * is the requirement (TODO.md). So a `KioskApiError` under 500 is an
     * ANSWER and gets exactly one attempt.
     *
     * WHAT THIS SUITE CAN OBSERVE is the attempt count and the absence of the
     * waiting line — `isUnpaired` is stubbed to `false` in this file's `./api`
     * mock, deliberately, because the unpaired SCREEN belongs to
     * `pairing.test.tsx`. The refusal branch that matters here is the one in
     * `rules/retry.ts`, and it is the count that proves it.
     */
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(AGREEMENT);
    confirmSessionDetails.mockRejectedValue(new KioskApiError('session disputed', 409));

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
    tickEverything();
    fireEvent.click(screen.getByTestId('check-details-continue'));

    // Straight to the desk, with no "One moment…" in between: there is nothing
    // to wait for when the server has already answered.
    await waitFor(() => expect(screen.getByTestId('check-details-error')).toBeTruthy());
    expect(screen.queryByTestId('check-details-retrying')).toBeNull();
    expect(confirmSessionDetails).toHaveBeenCalledTimes(1);

    // And nothing more happens however long the backoff would have run for.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(confirmSessionDetails).toHaveBeenCalledTimes(1);
  });
});
