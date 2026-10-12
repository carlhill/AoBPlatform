/**
 * THE SECOND PUSH OF THE DAY — the post-service ceremony (Carl, 11 Sep 2026;
 * TODO.md "Two front doors" decision (b), "Still to build: Post-service push").
 *
 * ONE MECHANISM, TWO MOMENTS. Reception hands the patient the same tablet on
 * the way out, with an agreement for the service they have just had. What these
 * tests protect:
 *
 *  - THE DETAILS CHECK IS SKIPPED when the SERVER says this person ticked their
 *    details in a pushed session at this practice today, and RUNS when it does
 *    not. The server decides it (REQ-DATA-11); a tablet that decided for itself
 *    to skip a step of the ceremony would be a tablet deciding what the record
 *    says happened.
 *  - THE PARTICULARS SCREEN STATES D5 AND D6b — the day the service was
 *    rendered and the MBS item numbers (REQ-REG-01; s 65C(4) table item 6) —
 *    and NO AMOUNT (hard rule 4).
 *  - NOTHING ELSE IS SKIPPED. The affirmations and the signature run exactly as
 *    they do on a first push: this is a NEW agreement and the tap is a
 *    SIGNATURE in its own right (REQ-REG-07), never a confirmation of the
 *    earlier one.
 *
 * Against the real `Ceremony`, with `./api` mocked wholesale, for the reason
 * `pushed-session.test.tsx` gives: what matters is which calls the ceremony
 * makes and which screen it lands on.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { TabletSessionPayload } from '@aobplatform/domain';
import { Ceremony } from './Ceremony';
import { strings } from './strings';
import type { KioskWaitingRow } from './api';

/**
 * THE POST-SERVICE SESSION. Obviously fake, carrying no Medicare number —
 * there is no field for one in `TabletSessionPayload` and no column for one
 * behind it (hard rule 1, REQ-VER-02) — and no amount anywhere.
 */
const POST_SESSION: TabletSessionPayload = {
  id: '22222222-2222-4222-8222-222222222222',
  state: 'pushed',
  agreementType: 'episodic_post',
  patient: {
    givenNames: 'Jo',
    familyName: 'Postvisit',
    dateOfBirth: '1979-02-03',
    address: '9 Example Street, Sampletown NSW 2000',
    mobile: '0400 000 902',
    email: 'jo@example.invalid',
  },
  assignor: { isPatient: true },
  patientId: 'aa11bb22-cc33-4d44-8e55-ff6677889900',
  detailsCheck: 'confirmed_today',
  agreementId: 'ag-jo-post',
  captureRequestId: 'cr-jo-post',
};

/**
 * The locked post-agreement. D5 and D6b, and NO `basicServiceDescription` —
 * that is a pre-agreement particular (REQ-REG-01 D6a, "pre-agreements only").
 */
const POST_AGREEMENT = {
  id: POST_SESSION.agreementId,
  type: 'episodic_post',
  status: 'awaiting_signature',
  patientId: 'pt-jo',
  assignorId: 'as-jo',
  assignorIsPatient: true,
  particulars: {
    patientName: 'Jo Postvisit',
    providerName: 'Dr Sample GP',
    serviceDate: '2026-09-11',
    agreementDate: '2026-09-11',
    mbsItemNumbers: ['23', '10990'],
  },
  particularsLockedAt: '2026-09-11T03:30:00.000Z',
  ruleSetVersion: '2026.07.01',
  mappingVersion: '2026.07.01',
  renderedArtefactHash: 'b'.repeat(64),
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

function asPairedTablet(rows: readonly KioskWaitingRow[] = []): void {
  fetchKioskMe.mockResolvedValue({
    deviceId: 'device-1',
    deviceLabel: 'Front desk tablet',
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
      pollMs: 60_000,
      identifierTypes: IDENTIFIER_TYPES,
      waiting: rows,
      hidden: rows.length === 0,
      reload: false,
    },
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
  fetchTabletSession.mockResolvedValue({ session: null });
  setTabletSessionState.mockResolvedValue({ id: POST_SESSION.id, state: 'reading' });
  confirmSessionDetails.mockResolvedValue({ id: POST_SESSION.id, state: 'details_confirmed' });
  fetchAgreement.mockResolvedValue(POST_AGREEMENT);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('the post-service second push, at the tablet', () => {
  it('tablet_skips_the_details_check_after_a_same_day_verified_session', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: POST_SESSION });

    render(<Ceremony />);

    // STRAIGHT TO K-3. The same person ticked these five details at this
    // practice this morning; asking again is ceremony for its own sake.
    await waitFor(() => expect(screen.getByTestId('particulars-heading')).toBeTruthy());
    expect(screen.queryByTestId('check-details-heading')).toBeNull();

    // AND NOTHING WAS CONFIRMED ON THE PATIENT'S BEHALF. The ticks are a
    // record of what somebody did; skipping the step must not post one.
    expect(confirmSessionDetails).not.toHaveBeenCalled();

    // `reading` is still posted as the screen first renders — reception's
    // status column is watching for it either way.
    await waitFor(() =>
      expect(setTabletSessionState).toHaveBeenCalledWith(POST_SESSION.id, 'reading'),
    );
  });

  it('tablet_runs_the_details_check_when_nothing_was_verified_today', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({
      session: { ...POST_SESSION, detailsCheck: 'required' },
    });

    render(<Ceremony />);

    // K-P1, exactly as on a first push. A post-service agreement for a patient
    // nobody checked in today is a patient who has not been asked.
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
    expect(screen.queryByTestId('particulars-heading')).toBeNull();
    expect(screen.getByTestId('detail-value-name').textContent).toBe('Jo Postvisit');
  });

  it('post_agreement_shows_the_service_date_and_the_item_numbers_and_no_amount', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: POST_SESSION });

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('particulars-heading')).toBeTruthy());

    // D5 — the day the service WAS rendered. `getAllByText` because the
    // agreement DATE is the same day here, which is exactly what a
    // post-agreement made at the desk looks like (C5: post ⇒ D5 on or before
    // D2) — two rows, one value, and asserting on one of them would be
    // asserting on whichever came first.
    expect(screen.getByText(strings.particulars.serviceDate)).toBeTruthy();
    expect(screen.getAllByText('2026-09-11').length).toBeGreaterThan(0);

    // D6b — the item numbers, said in the plural because there are two.
    expect(screen.getByText(strings.particulars.items)).toBeTruthy();
    expect(screen.getByText('23, 10990')).toBeTruthy();

    /*
     * HARD RULE 4 — NO BENEFIT AND NO DOLLAR AMOUNT ON THE ARTEFACT OR ON THE
     * SCREEN THAT SHOWS IT. An invoice has a figure on it; an assignment of
     * benefit does not, and the patient is being asked to assign the benefit
     * rather than to approve a price.
     */
    const shown = document.body.textContent ?? '';
    expect(shown).not.toMatch(/\$\s?\d/);
    expect(shown).not.toMatch(/benefit amount|rebate|fee/i);

    // HARD RULE 12 — and nothing here calls our form approved.
    expect(shown).not.toMatch(/certified|accredited|government-approved/i);
  });

  it('a single item number is labelled in the singular', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: POST_SESSION });
    fetchAgreement.mockResolvedValue({
      ...POST_AGREEMENT,
      particulars: { ...POST_AGREEMENT.particulars, mbsItemNumbers: ['23'] },
    });

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('particulars-heading')).toBeTruthy());

    expect(screen.getByText(strings.particulars.item)).toBeTruthy();
    expect(screen.queryByText(strings.particulars.items)).toBeNull();
  });

  it('a pre-agreement draws no item-number row at all', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({
      session: { ...POST_SESSION, agreementType: 'episodic_pre' },
    });
    fetchAgreement.mockResolvedValue({
      ...POST_AGREEMENT,
      type: 'episodic_pre',
      particulars: {
        patientName: 'Jo Postvisit',
        serviceDate: '2026-09-11',
        // D6a is "pre-agreements only" and D6b is "post-agreements only"
        // (REQ-REG-01) — the two rows are never both drawn.
        basicServiceDescription: 'General practitioner attendance',
      },
    });

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('particulars-heading')).toBeTruthy());

    expect(screen.queryByText(strings.particulars.items)).toBeNull();
    expect(screen.queryByText(strings.particulars.item)).toBeNull();
    expect(screen.getByText('General practitioner attendance')).toBeTruthy();
  });

  it('the tap is a signature on THIS agreement — the ceremony still reaches the signing step', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: POST_SESSION });

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('particulars-heading')).toBeTruthy());

    /*
     * NOTHING BUT K-P1 WAS SKIPPED (REQ-REG-07). The agreement is locked, so
     * the ceremony does not re-lock it — but the reading step, its
     * affirmations and the signature that follows are the first push's
     * unchanged. The pre-step's signature covers only what its description
     * covered; this is a new contract and it is signed in its own right.
     */
    expect(lockParticulars).not.toHaveBeenCalled();
    expect(changeAssignor).not.toHaveBeenCalled();
    expect(signAgreement).not.toHaveBeenCalled();
    // The reading step's own primary — "Continue to sign". Reading is a step;
    // signing is the next one, and both are the first push's unchanged.
    expect(screen.getByText(strings.particulars.continueToSign)).toBeTruthy();
  });
});
