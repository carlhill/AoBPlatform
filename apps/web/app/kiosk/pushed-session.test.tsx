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
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CONFIRMABLE_DETAIL_TYPES, type TabletSessionPayload } from '@aobplatform/domain';
import { Ceremony } from './Ceremony';
import { strings } from './strings';
import type { KioskWaitingRow } from './api';

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
    // are locked, so there is nothing to choose — K-3 states it read-only and
    // Back is withdrawn with it.
    expect(screen.queryByTestId('assignor-self')).toBeNull();
    expect(screen.queryByTestId('assignor-other')).toBeNull();
    expect(screen.getByText(strings.particulars.assignorIsPatient)).toBeTruthy();
    expect(screen.getByTestId('assignor-locked-note').textContent).toBe(
      strings.particulars.assignorLockedNote,
    );
    expect(screen.queryByTestId('particulars-back')).toBeNull();

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
    expect(document.body.textContent).not.toContain('1988');
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
