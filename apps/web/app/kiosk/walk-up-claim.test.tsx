/**
 * THE WALK-UP FRONT DOOR, AND THE K-5 SKIP (Carl, 4 September 2026).
 *
 * TWO RULINGS, ONE MORNING, and both are about a screen showing something it
 * had no business showing.
 *
 *  1. "Remove the 'x people ready to sign' text — this is a security feature.
 *     Then on the next page do not show the list. Go straight to 'Confirm your
 *     details', match these details to the list on AoBPlatform and then go to
 *     the next page. The list page is only for testing purposes."
 *
 *     So Begin opens K-2, not a list of names. The patient types three details
 *     and `POST /kiosk/claim` finds the one waiting row that matches. The list
 *     survives only on a device the CONSOLE flagged, under a permanent banner.
 *
 *  2. K-5 on a locked agreement drew the self option, then an explanation box
 *     where "Someone else is signing for …" belongs, then a Continue. Carl
 *     read the box as the second option — the only sensible reading of a panel
 *     in an option's slot. When the particulars are locked there is nothing to
 *     choose, so K-5 is SKIPPED and K-3's "Signing" line carries a one-line
 *     note instead.
 *
 * These are asserted against the real `Ceremony` component rather than against
 * screens in isolation, because both defects were in the SEQUENCE. `./api` is
 * mocked wholesale: what matters is which calls the ceremony makes and which
 * screen it lands on, not what any one endpoint returns over a wire.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Ceremony } from './Ceremony';
import { strings } from './strings';
import type { KioskWaitingRow } from './api';

const RILEY: KioskWaitingRow = {
  captureRequestId: 'cr-riley',
  agreementId: 'ag-riley',
  patientId: 'pt-riley',
  patientName: 'Riley Example',
  providerName: 'Dr Sample Provider',
  appointmentDate: '2026-09-04',
  appointmentTime: '09:00',
  agreementStatus: 'awaiting_signature',
  agreementType: 'episodic_pre',
  waitingSince: '2026-09-04T08:00:00.000Z',
  signable: true,
  blockedReason: null,
};

const AGREEMENT = {
  id: RILEY.agreementId,
  type: 'episodic_pre',
  patientId: RILEY.patientId,
  assignorId: 'as-1',
  assignorIsPatient: true,
  particulars: { patientName: RILEY.patientName, serviceDate: '2026-09-04' },
  ruleSetVersion: '2026.07.01',
  mappingVersion: '2026.07.01',
  renderedArtefactHash: 'a'.repeat(64),
};

const LOCKED = { ...AGREEMENT, status: 'awaiting_signature', particularsLockedAt: '2026-09-04T08:30:00.000Z' };
const UNLOCKED = { ...AGREEMENT, status: 'awaiting_signature', particularsLockedAt: null };

const {
  claimWaitingRow,
  fetchAgreement,
  fetchKioskMe,
  fetchWaitingList,
  startChallenge,
  attemptChallenge,
  transitionAgreement,
  changeAssignor,
  lockParticulars,
  signAgreement,
  completeCapture,
} = vi.hoisted(() => ({
  claimWaitingRow: vi.fn(),
  fetchAgreement: vi.fn(),
  fetchKioskMe: vi.fn(),
  fetchWaitingList: vi.fn(),
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
  fetchKioskMe,
  fetchWaitingList,
  fetchPracticeStaffNames: vi.fn(async () => []),
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

/** What an ordinary tablet is told about itself, and what its poll answers. */
function asWalkUpTablet(): void {
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
      pollMs: 60_000,
      identifierTypes: IDENTIFIER_TYPES,
      // NO ROWS AND NO COUNT — what the server actually sends a walk-up tablet.
      waiting: [],
      hidden: true,
      reload: false,
    },
  });
}

/** A device the console has flagged. The list is back, and so is the banner. */
function asTestDevice(): void {
  fetchKioskMe.mockResolvedValue({
    deviceId: 'device-2',
    deviceLabel: 'Test tablet',
    practiceId: 'practice-1',
    practiceName: 'Sample Practice',
    state: 'NSW',
    identifierTypes: IDENTIFIER_TYPES,
    showsWaitingList: true,
    reload: false,
  });
  fetchWaitingList.mockResolvedValue({
    kind: 'changed' as const,
    etag: '"rev-2"',
    body: {
      practiceId: 'practice-1',
      revision: 'rev-2',
      pollMs: 60_000,
      identifierTypes: IDENTIFIER_TYPES,
      waiting: [RILEY],
      hidden: false,
      reload: false,
    },
  });
}

/** K-2, filled in with Riley's details and submitted. */
function fillAndSubmitVerify(): void {
  fireEvent.change(screen.getByTestId('identifier-name-given'), { target: { value: 'Riley' } });
  fireEvent.change(screen.getByTestId('identifier-name-family'), { target: { value: 'Example' } });
  fireEvent.change(screen.getByTestId('identifier-address'), {
    target: { value: '7 Sample Road Sampletown 2000' },
  });
  fireEvent.change(screen.getByTestId('identifier-dob-day'), { target: { value: '09' } });
  fireEvent.change(screen.getByTestId('identifier-dob-month'), { target: { value: '03' } });
  fireEvent.change(screen.getByTestId('identifier-dob-year'), { target: { value: '1988' } });
  fireEvent.click(screen.getByTestId('verify-continue'));
}

beforeEach(() => {
  for (const mock of [
    claimWaitingRow,
    fetchAgreement,
    fetchKioskMe,
    fetchWaitingList,
    startChallenge,
    attemptChallenge,
    transitionAgreement,
    changeAssignor,
    lockParticulars,
    signAgreement,
    completeCapture,
  ]) {
    mock.mockReset();
  }
});

describe('begin_goes_to_verify_not_the_list', () => {
  it('opens K-2 on an ordinary tablet, and reads no list to get there', async () => {
    asWalkUpTablet();
    render(<Ceremony />);

    await waitFor(() => expect(screen.getByTestId('start-check-in')).toBeTruthy());
    // Nothing on the idle screen describes the room to the room.
    expect(screen.queryByTestId('waiting-count')).toBeNull();
    expect(screen.queryByTestId('test-device-banner')).toBeNull();

    fireEvent.click(screen.getByTestId('start-check-in'));

    // K-2, immediately. Not a list, and not a name.
    await waitFor(() => expect(screen.getByTestId('identifier-name-given')).toBeTruthy());
    expect(screen.getByText(strings.verify.heading)).toBeTruthy();
    expect(screen.queryByTestId(`pick-${RILEY.captureRequestId}`)).toBeNull();
    expect(document.body.textContent).not.toContain('Riley Example');

    /*
     * AND NO CHALLENGE WAS OPENED. There is no patient to open one against —
     * finding the patient IS the attempt — so `POST /verification/challenges`
     * is not called at all on this path. If it ever is, somebody has chosen a
     * patient before the patient proved anything.
     */
    expect(startChallenge).not.toHaveBeenCalled();
  });

  it('a test device gets the list instead, under its banner', async () => {
    asTestDevice();
    render(<Ceremony />);

    await waitFor(() => expect(screen.getByTestId('start-check-in')).toBeTruthy());
    fireEvent.click(screen.getByTestId('start-check-in'));

    await waitFor(() => expect(screen.getByTestId(`pick-${RILEY.captureRequestId}`)).toBeTruthy());
    expect(screen.getByTestId('test-device-banner').textContent).toBe(strings.idle.testDeviceBanner);
  });
});

describe('the claim finds one row, and says nothing about any other', () => {
  it('verifies and continues on the row the server matched', async () => {
    asWalkUpTablet();
    claimWaitingRow.mockResolvedValueOnce({ outcome: 'passed', verificationEventId: 've-1', row: RILEY });
    fetchAgreement.mockResolvedValueOnce(LOCKED);

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('start-check-in')).toBeTruthy());
    fireEvent.click(screen.getByTestId('start-check-in'));
    await waitFor(() => expect(screen.getByTestId('identifier-name-given')).toBeTruthy());
    fillAndSubmitVerify();

    await waitFor(() => expect(screen.getByTestId('particulars-heading')).toBeTruthy());
    // ONE call, and it carried the three stated values — no challenge first.
    expect(claimWaitingRow).toHaveBeenCalledTimes(1);
    expect(Object.keys(claimWaitingRow.mock.calls[0][0]).sort()).toEqual([
      'address',
      'date_of_birth',
      'name',
    ]);
    expect(startChallenge).not.toHaveBeenCalled();
    expect(attemptChallenge).not.toHaveBeenCalled();
  });

  it('a refusal keeps the patient on K-2 with what they typed, and names nothing', async () => {
    asWalkUpTablet();
    claimWaitingRow.mockResolvedValueOnce({
      outcome: 'failed',
      message: 'Some of those details do not match our records.',
    });

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('start-check-in')).toBeTruthy());
    fireEvent.click(screen.getByTestId('start-check-in'));
    await waitFor(() => expect(screen.getByTestId('identifier-name-given')).toBeTruthy());
    fillAndSubmitVerify();

    await waitFor(() => expect(screen.getByTestId('mismatch-heading')).toBeTruthy());
    // The screen did not move and the values are still on it — one mistyped
    // letter must not cost all three identifiers (Carl, 3 Sep 2026).
    expect((screen.getByTestId('identifier-name-given') as HTMLInputElement).value).toBe('Riley');
    expect((screen.getByTestId('identifier-address') as HTMLInputElement).value).toBe(
      '7 Sample Road Sampletown 2000',
    );
    // It never says WHICH detail, and it never says whether anybody by that
    // name is here at all (REQ-SEC-07).
    expect(screen.getByTestId('mismatch-heading').textContent).toBe(strings.verify.mismatchHeading);
    expect(document.body.textContent).not.toMatch(/date of birth is|address is|no such|not waiting|two/i);
  });
});

describe('k5_is_skipped_when_particulars_are_locked', () => {
  it('goes from verification straight to K-3, which states who signs and says where it was set', async () => {
    asWalkUpTablet();
    claimWaitingRow.mockResolvedValueOnce({ outcome: 'passed', verificationEventId: 've-1', row: RILEY });
    fetchAgreement.mockResolvedValueOnce(LOCKED);

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('start-check-in')).toBeTruthy());
    fireEvent.click(screen.getByTestId('start-check-in'));
    await waitFor(() => expect(screen.getByTestId('identifier-name-given')).toBeTruthy());
    fillAndSubmitVerify();

    await waitFor(() => expect(screen.getByTestId('particulars-heading')).toBeTruthy());

    // K-5 WAS NEVER DRAWN. Not disabled, not explained — absent. There is
    // nothing to choose, so there is no screen offering a choice.
    expect(screen.queryByTestId('assignor-self')).toBeNull();
    expect(screen.queryByTestId('assignor-other')).toBeNull();
    expect(screen.queryByTestId('assignor-continue')).toBeNull();
    // And the box that used to sit in the second option's slot is gone with it.
    expect(screen.queryByTestId('assignor-locked')).toBeNull();

    // THE FACT SURVIVED, as one line under a statement already being made.
    expect(screen.getByText(strings.particulars.assignorIsPatient)).toBeTruthy();
    expect(screen.getByTestId('assignor-locked-note').textContent).toBe(
      strings.particulars.assignorLockedNote,
    );

    // BACK IS WITHDRAWN TOO — there is nothing behind it, and a Back leading
    // to a choice the server would refuse is worse than none.
    expect(screen.queryByTestId('particulars-back')).toBeNull();
    // The way out is untouched: every ceremony screen keeps one (REQ-REC-04).
    expect(screen.getByTestId('leave-for-reception')).toBeTruthy();

    // Nothing was re-pointed and nothing was re-locked on the way past.
    expect(changeAssignor).not.toHaveBeenCalled();
    expect(lockParticulars).not.toHaveBeenCalled();
  });
});

describe('k5_shows_both_options_when_unlocked', () => {
  it('renders two real options, with no Continue under the self choice', async () => {
    asWalkUpTablet();
    claimWaitingRow.mockResolvedValueOnce({ outcome: 'passed', verificationEventId: 've-1', row: RILEY });
    fetchAgreement.mockResolvedValueOnce(UNLOCKED);

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('start-check-in')).toBeTruthy());
    fireEvent.click(screen.getByTestId('start-check-in'));
    await waitFor(() => expect(screen.getByTestId('identifier-name-given')).toBeTruthy());
    fillAndSubmitVerify();

    await waitFor(() => expect(screen.getByTestId('assignor-self')).toBeTruthy());

    // BOTH OPTIONS, BOTH REAL. Never an option-shaped box that is not an
    // option (Carl, 4 Sep 2026).
    const other = screen.getByTestId('assignor-other');
    expect(other.textContent).toBe(strings.assignor.other(RILEY.patientName));
    expect(screen.queryByTestId('assignor-locked')).toBeNull();
    // Self needs no Continue — nothing about it can fail on this device.
    expect(screen.queryByTestId('assignor-continue')).toBeNull();

    // "Someone else" reveals its form, and the Continue that submits it.
    fireEvent.click(other);
    await waitFor(() => expect(screen.getByTestId('assignor-other-name')).toBeTruthy());
    expect(screen.getByTestId('assignor-continue')).toBeTruthy();
  });
});
