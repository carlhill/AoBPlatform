/**
 * THE PAIRING-DAY RULING, END TO END (TODO.md, "Two rulings from pairing
 * day", 4 Sep 2026).
 *
 * Carl chose Jamie on the waiting list, passed all three identifiers on K-2,
 * and only then reached "One more detail is needed from reception" — on a
 * screen with no name on it. Twice wrong: the patient did work for nothing,
 * and reception had no way to tell who needed fixing. The fix has two halves,
 * both asserted here against the real `Ceremony` component rather than a
 * screen in isolation, because the defect was in the SEQUENCE, not in any one
 * screen's own rendering:
 *
 *   - `unsignable_row_hands_over_before_verification` — tapping a row the
 *     server has already marked `signable: false` goes straight to the
 *     hand-over. No verification challenge, no transition, no lock, no sign,
 *     no assignor change: the agreement is exactly as untouched as `leave`
 *     leaves it.
 *   - `hand_over_names_the_patient` — that hand-over's heading says who it is
 *     about, so reception can act on it without asking the room.
 *
 * `./api` is mocked wholesale: this is a component test, not a network one,
 * and the point is what `Ceremony.tsx` calls (or, for the unsignable row,
 * does not) rather than what any one endpoint returns.
 *
 * A THIRD TEST BELOW covers item 3 of the ruling: K-3's own rules-engine
 * check (a real refusal at lock time, not this precheck) also names the
 * patient when it fires — the precheck narrows how often anybody sees this
 * screen, it does not replace K-3 as the last line of defence.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Ceremony } from './Ceremony';
import { strings } from './strings';
import { KioskApiError, type KioskWaitingRow } from './api';

const UNSIGNABLE_ROW: KioskWaitingRow = {
  captureRequestId: 'cr-unsignable',
  agreementId: 'ag-unsignable',
  patientId: 'pt-unsignable',
  patientName: 'Jamie Sampleton',
  providerName: 'Dr Sample Provider',
  appointmentDate: '2026-09-04',
  appointmentTime: '09:00',
  agreementStatus: 'draft',
  agreementType: 'episodic_pre',
  waitingSince: '2026-09-04T08:00:00.000Z',
  signable: false,
  blockedReason: 'service_description_missing',
};

/** Passes the cheap precheck, but K-3's real lock call is made to refuse anyway. */
const SIGNABLE_ROW: KioskWaitingRow = {
  captureRequestId: 'cr-signable',
  agreementId: 'ag-signable',
  patientId: 'pt-signable',
  patientName: 'Riley Testable',
  providerName: 'Dr Sample Provider',
  appointmentDate: '2026-09-04',
  appointmentTime: '09:30',
  agreementStatus: 'verification_pending',
  agreementType: 'episodic_pre',
  waitingSince: '2026-09-04T08:05:00.000Z',
  signable: true,
  blockedReason: null,
};

// `vi.hoisted` because `vi.mock` factories are hoisted above ordinary `const`
// declarations — a plain top-level `const` here throws
// "Cannot access before initialization" the moment the factory below runs.
const { fetchAgreement, startChallenge, attemptChallenge, transitionAgreement, changeAssignor, lockParticulars, signAgreement, completeCapture } =
  vi.hoisted(() => ({
    fetchAgreement: vi.fn(),
    startChallenge: vi.fn(),
    attemptChallenge: vi.fn(),
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
  fetchKioskMe: vi.fn(async () => ({
    deviceId: 'device-1',
    deviceLabel: 'Test tablet',
    practiceId: 'practice-1',
    practiceName: 'Sample Practice',
    state: 'NSW',
    identifierTypes: ['name', 'date_of_birth', 'address'],
    reload: false,
  })),
  fetchWaitingList: vi.fn(async () => ({
    kind: 'changed' as const,
    etag: '"rev-1"',
    body: {
      practiceId: 'practice-1',
      revision: 'rev-1',
      pollMs: 60_000,
      identifierTypes: ['name', 'date_of_birth', 'address'],
      waiting: [UNSIGNABLE_ROW, SIGNABLE_ROW],
      reload: false,
    },
  })),
  fetchPracticeStaffNames: vi.fn(async () => []),
  fetchAgreement,
  startChallenge,
  attemptChallenge,
  transitionAgreement,
  changeAssignor,
  lockParticulars,
  signAgreement,
  completeCapture,
}));

async function pickUnsignableRow() {
  render(<Ceremony />);

  // Booting → idle: the identity and staff-name reads resolve first.
  await waitFor(() => expect(screen.getByTestId('start-check-in')).toBeTruthy());
  fireEvent.click(screen.getByTestId('start-check-in'));

  // idle → list: the poll answers with the one unsignable row.
  await waitFor(() => expect(screen.getByTestId(`pick-${UNSIGNABLE_ROW.captureRequestId}`)).toBeTruthy());
  fireEvent.click(screen.getByTestId(`pick-${UNSIGNABLE_ROW.captureRequestId}`));

  await waitFor(() => expect(screen.getByTestId('handover-heading')).toBeTruthy());
}

describe('the pairing-day ruling: an unsignable row hands over immediately, naming the patient', () => {
  beforeEach(() => {
    fetchAgreement.mockClear();
    startChallenge.mockClear();
    attemptChallenge.mockClear();
    transitionAgreement.mockClear();
    changeAssignor.mockClear();
    lockParticulars.mockClear();
    signAgreement.mockClear();
    completeCapture.mockClear();
  });

  it('unsignable_row_hands_over_before_verification', async () => {
    await pickUnsignableRow();

    // The hand-over is reached directly from the list — no K-2 was ever
    // shown, so none of the calls a real ceremony would have made appear.
    expect(startChallenge).not.toHaveBeenCalled();
    expect(attemptChallenge).not.toHaveBeenCalled();
    expect(transitionAgreement).not.toHaveBeenCalled();
    expect(changeAssignor).not.toHaveBeenCalled();
    expect(lockParticulars).not.toHaveBeenCalled();
    expect(signAgreement).not.toHaveBeenCalled();
    expect(completeCapture).not.toHaveBeenCalled();
    // Nothing about the agreement was even re-read: the row already carried
    // everything this hand-over needed to say.
    expect(fetchAgreement).not.toHaveBeenCalled();
  });

  it('hand_over_names_the_patient', async () => {
    await pickUnsignableRow();

    expect(screen.getByTestId('handover-heading').textContent).toBe(
      strings.particulars.needsReceptionHeading(UNSIGNABLE_ROW.patientName),
    );
    expect(screen.getByTestId('handover-heading').textContent).toContain('Jamie Sampleton');
    expect(screen.getByTestId('handover-body').textContent).toBe(strings.particulars.needsReceptionBody);
  });
});

describe("item 3 of the ruling: K-3's own rules-engine refusal also names the patient", () => {
  beforeEach(() => {
    fetchAgreement.mockClear();
    startChallenge.mockClear();
    attemptChallenge.mockClear();
    transitionAgreement.mockClear();
    changeAssignor.mockClear();
    lockParticulars.mockClear();
    signAgreement.mockClear();
    completeCapture.mockClear();
  });

  it('lock_refusal_also_names_the_patient', async () => {
    /*
     * SIGNABLE_ROW passes the cheap precheck (`computeSignability`), so the
     * ceremony runs the full verify → assignor → particulars sequence — and
     * the real lock call at K-3 refuses anyway (a race, a stale precheck, or
     * simply the rules engine finding something the precheck cannot see).
     * That hand-over must ALSO name the patient — the precheck narrows how
     * often anybody reaches this screen, it does not replace it.
     */
    const agreementBase = {
      id: SIGNABLE_ROW.agreementId,
      type: 'episodic_pre',
      patientId: SIGNABLE_ROW.patientId,
      assignorId: 'as-1',
      assignorIsPatient: true,
      particulars: null,
      particularsLockedAt: null,
      ruleSetVersion: null,
      mappingVersion: null,
      renderedArtefactHash: null,
    };
    startChallenge.mockResolvedValueOnce({
      challengeId: 'chal-1',
      identifierTypes: ['name', 'date_of_birth', 'address'],
    });
    attemptChallenge.mockResolvedValueOnce({ outcome: 'passed', verificationEventId: 've-1' });
    fetchAgreement.mockResolvedValueOnce({ ...agreementBase, status: 'verification_pending' });
    transitionAgreement.mockResolvedValueOnce({ ...agreementBase, status: 'awaiting_signature' });
    lockParticulars.mockRejectedValueOnce(
      new KioskApiError(
        JSON.stringify({ message: 's 65C validation failed', failures: ['C6: D6a: a pre-agreement requires a Basic Service Description'] }),
        400,
      ),
    );

    render(<Ceremony />);

    await waitFor(() => expect(screen.getByTestId('start-check-in')).toBeTruthy());
    fireEvent.click(screen.getByTestId('start-check-in'));

    await waitFor(() => expect(screen.getByTestId(`pick-${SIGNABLE_ROW.captureRequestId}`)).toBeTruthy());
    fireEvent.click(screen.getByTestId(`pick-${SIGNABLE_ROW.captureRequestId}`));

    await waitFor(() => expect(screen.getByTestId('identifier-name-given')).toBeTruthy());
    fireEvent.change(screen.getByTestId('identifier-name-given'), { target: { value: 'Riley' } });
    fireEvent.change(screen.getByTestId('identifier-name-family'), { target: { value: 'Testable' } });
    fireEvent.change(screen.getByTestId('identifier-address'), {
      target: { value: '2 Example St Sampletown 2000' },
    });
    fireEvent.change(screen.getByTestId('identifier-dob-day'), { target: { value: '04' } });
    fireEvent.change(screen.getByTestId('identifier-dob-month'), { target: { value: '08' } });
    fireEvent.change(screen.getByTestId('identifier-dob-year'), { target: { value: '1962' } });
    fireEvent.click(screen.getByTestId('verify-continue'));

    await waitFor(() => expect(screen.getByTestId('assignor-self')).toBeTruthy());
    fireEvent.click(screen.getByTestId('assignor-self'));

    // K-3's automatic lock fires, and the mock refuses it — the hand-over
    // must name Riley, exactly as the list-tap hand-over names Jamie above.
    await waitFor(() => expect(screen.getByTestId('handover-heading')).toBeTruthy());
    expect(screen.getByTestId('handover-heading').textContent).toBe(
      strings.particulars.needsReceptionHeading(SIGNABLE_ROW.patientName),
    );
    expect(screen.getByTestId('handover-heading').textContent).toContain('Riley Testable');
    expect(screen.getByTestId('handover-body').textContent).toBe(strings.particulars.needsReceptionBody);
  });
});
