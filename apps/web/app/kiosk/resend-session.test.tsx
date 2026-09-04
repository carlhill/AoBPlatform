/**
 * RE-SEND, WHEN IT LANDS INSIDE ONE POLL INTERVAL — a live bug Carl found on
 * 4 Sep 2026: a patient crossed "Mobile number" on K-P1, reception corrected
 * it and pressed Re-send, and the tablet stayed on the old, disputed screen.
 *
 * RE-SEND IS A RECALL AND A NEW PUSH. When both complete before this
 * tablet's next poll, that poll never observes `{ session: null }` in
 * between — it goes straight from the old session's id to a different one.
 * The take-over effect in `Ceremony.tsx` used to require `step === 'idle' ||
 * step === 'list'` before it would look at a session at all, so a poll that
 * arrived mid-K-P1 (or mid-K-3, mid-K-4) with a NEW id was simply ignored:
 * `pushed?.id === session.id` was false, so it was not a no-op, and
 * `step !== 'idle' && step !== 'list'` was true, so it returned anyway. The
 * fix keys the effect on the session id rather than on being idle: any step a
 * pushed ceremony can be showing (`pushedCeremony`) is now eligible too.
 *
 * THESE TESTS DO NOT GO THROUGH `{ session: null }` AT ANY POINT — that is
 * the whole point of the reproduction. `fetchTabletSession` is switched
 * straight from one resolved session to another between polls, exactly as a
 * re-send that completes within the server's own cadence would appear to
 * this device.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { CONFIRMABLE_DETAIL_TYPES, type TabletSessionPayload } from '@aobplatform/domain';
import { Ceremony } from './Ceremony';

const IDENTIFIER_TYPES = ['name', 'date_of_birth', 'address'];
const POLL_MS = 10_000;

const SESSION_A: TabletSessionPayload = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
  agreementId: 'ag-riley-a',
  captureRequestId: 'cr-riley-a',
};

/** Reception's fix: the same agreement, re-sent with the mobile number corrected. */
const SESSION_B_RESENT: TabletSessionPayload = {
  ...SESSION_A,
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  patient: { ...SESSION_A.patient, mobile: '0400 111 222' },
};

/** Reception's fix instead supersedes the agreement itself with a new one. */
const SESSION_C_SUPERSEDING: TabletSessionPayload = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  state: 'pushed',
  agreementType: 'episodic_pre',
  patient: {
    givenNames: 'Riley',
    familyName: 'Example',
    dateOfBirth: '1988-03-09',
    address: '9 New Road, Sampletown NSW 2000',
    mobile: '0400 111 222',
    email: 'riley@example.invalid',
  },
  assignor: { isPatient: true },
  agreementId: 'ag-riley-superseding',
  captureRequestId: 'cr-riley-superseding',
};

const AGREEMENT_C = {
  id: SESSION_C_SUPERSEDING.agreementId,
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

function asPairedTablet(): void {
  fetchKioskMe.mockResolvedValue({
    deviceId: 'device-1',
    deviceLabel: 'Reception tablet 1',
    practiceId: 'practice-1',
    practiceName: 'Sample Practice',
    state: 'NSW',
    identifierTypes: IDENTIFIER_TYPES,
    showsWaitingList: false,
    reload: false,
  });
  fetchWaitingList.mockResolvedValue({
    kind: 'changed' as const,
    etag: '"rev-1"',
    body: {
      practiceId: 'practice-1',
      revision: 'rev-1',
      pollMs: POLL_MS,
      identifierTypes: IDENTIFIER_TYPES,
      waiting: [],
      hidden: true,
      reload: false,
    },
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
  }
}

async function advanceMs(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
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
  setTabletSessionState.mockResolvedValue({ id: SESSION_A.id, state: 'reading' });
  confirmSessionDetails.mockResolvedValue({ id: SESSION_A.id, state: 'details_confirmed' });
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('resent_session_replaces_the_one_on_screen', () => {
  it('a corrected re-send inside one poll interval replaces K-P1, not appends to it', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION_A });
    render(<Ceremony />);
    await settle();
    expect(screen.getByTestId('check-details-heading')).toBeTruthy();
    expect(screen.getByTestId('detail-value-mobile').textContent).toBe(SESSION_A.patient.mobile);

    // The patient crosses "Mobile number" — this is the exact shape of the
    // live bug: a dispute is on screen when reception acts on it.
    fireEvent.click(screen.getByTestId('detail-tick-name'));
    fireEvent.click(screen.getByTestId('detail-tick-date_of_birth'));
    fireEvent.click(screen.getByTestId('detail-tick-address'));
    fireEvent.click(screen.getByTestId('detail-cross-mobile'));
    fireEvent.click(screen.getByTestId('detail-tick-email'));
    await settle();
    expect(confirmSessionDetails).toHaveBeenCalledWith(
      SESSION_A.id,
      expect.arrayContaining(['name', 'date_of_birth', 'address', 'email']),
      ['mobile'],
    );

    /*
     * RECEPTION FIXES IT AND PRESSES RE-SEND. The old session is recalled and
     * a new one pushed before this device's next poll — so the very next
     * answer is a DIFFERENT id, never `null` in between.
     */
    fetchTabletSession.mockResolvedValue({ session: SESSION_B_RESENT });
    await advanceMs(POLL_MS);

    // STILL K-P1, but the NEW session's own screen — corrected value, no
    // dispute band, nothing ticked yet.
    expect(screen.getByTestId('check-details-heading')).toBeTruthy();
    expect(screen.getByTestId('detail-value-mobile').textContent).toBe(SESSION_B_RESENT.patient.mobile);
    expect(document.body.textContent).not.toContain(SESSION_A.patient.mobile);
    expect(screen.queryByTestId('check-details-dispute')).toBeNull();
    expect((screen.getByTestId('check-details-continue') as HTMLButtonElement).disabled).toBe(true);

    // `reading` posted again, for the NEW session id.
    expect(setTabletSessionState).toHaveBeenCalledWith(SESSION_B_RESENT.id, 'reading');
  });
});

describe('superseding_session_shows_the_new_agreement', () => {
  it('a re-send to a different agreement shows that agreement, and that is what gets fetched', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION_A });
    render(<Ceremony />);
    await settle();
    expect(screen.getByTestId('check-details-heading')).toBeTruthy();

    // Superseded before the patient finishes with the old one.
    fetchTabletSession.mockResolvedValue({ session: SESSION_C_SUPERSEDING });
    await advanceMs(POLL_MS);

    expect(screen.getByTestId('detail-value-address').textContent).toBe(SESSION_C_SUPERSEDING.patient.address);
    expect(document.body.textContent).not.toContain(SESSION_A.patient.address);

    fetchAgreement.mockResolvedValueOnce(AGREEMENT_C);
    confirmSessionDetails.mockResolvedValueOnce({ id: SESSION_C_SUPERSEDING.id, state: 'details_confirmed' });

    for (const type of CONFIRMABLE_DETAIL_TYPES) {
      fireEvent.click(screen.getByTestId(`detail-tick-${type}`));
    }
    await settle();
    expect((screen.getByTestId('check-details-continue') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('check-details-continue'));
    await settle();

    // THE NEW AGREEMENT IS WHAT IS FETCHED — never the superseded one.
    expect(fetchAgreement).toHaveBeenCalledWith(SESSION_C_SUPERSEDING.agreementId);
    expect(fetchAgreement).not.toHaveBeenCalledWith(SESSION_A.agreementId);
    expect(confirmSessionDetails).toHaveBeenCalledWith(
      SESSION_C_SUPERSEDING.id,
      expect.arrayContaining(CONFIRMABLE_DETAIL_TYPES as unknown as string[]),
      [],
    );
  });
});
