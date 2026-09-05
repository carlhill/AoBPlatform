/**
 * ENDURING AT THE KIOSK — the ceremony for a STANDING agreement (Carl, 4 Sep
 * 2026; GA-PLAN B5).
 *
 * WHAT IS DIFFERENT, AND IT IS ONLY THREE THINGS. The heading says "Agree to
 * bulk billing" rather than "…for today's visit"; the document explains what
 * the patient is actually committing to and carries NO service date and NO
 * description of one service, because reg 65CB's content set has neither
 * (REQ-END-02, and D5/D6a are pre-agreement elements — REQ-REG-01); and there
 * is a second, quiet option for a patient who would rather be asked each time.
 * The signature step is untouched: tap-to-approve and a drawn signature are
 * both signatures (REQ-REG-07) and neither cares what kind of agreement it is.
 *
 * WHAT MUST NEVER BE DIFFERENT is any of the hard rules. No benefit and no
 * dollar amount appears anywhere on the coverage explanation (rule 4), the
 * screen never says certified or approved about our form (rule 12), and the
 * "you will not be asked again" line names the PROVIDER rather than the
 * practice, because an ongoing agreement is per practitioner × patient and
 * never practice-wide (rule 6, REQ-END-01).
 *
 * The harness is `pushed-session.test.tsx`'s, for the same reason: `./api` is
 * mocked wholesale and what is asserted is which calls the ceremony makes and
 * which screen it lands on.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CONFIRMABLE_DETAIL_TYPES, type TabletSessionPayload } from '@aobplatform/domain';
import { Ceremony } from './Ceremony';
import { strings } from './strings';

/**
 * A pushed ENDURING session. Obviously fake, and with no Medicare number —
 * there is no field for one in the payload and no column behind it (hard
 * rule 1, REQ-VER-02).
 */
const SESSION: TabletSessionPayload = {
  id: '22222222-2222-4222-8222-222222222222',
  state: 'pushed',
  agreementType: 'enduring',
  patient: {
    givenNames: 'Riley',
    familyName: 'Example',
    dateOfBirth: '1988-03-09',
    address: '7 Sample Road, Sampletown NSW 2000',
    mobile: '0400 000 000',
    email: 'riley@example.invalid',
  },
  assignor: { isPatient: true },
  agreementId: 'ag-riley-enduring',
  captureRequestId: 'cr-riley-enduring',
};

/**
 * THE PARTICULARS AS THE SERVER ASSEMBLES THEM FOR AN ENDURING AGREEMENT —
 * note the absences. No `serviceDate` and no `basicServiceDescription`: a
 * standing agreement has no single service date to state and no one
 * description (REQ-REG-01 makes both episodic elements; `prepareLock` omits
 * them for this type). The rows are drawn from what the server sent, so an
 * absent particular is simply not on the screen.
 */
const ENDURING_AGREEMENT = {
  id: SESSION.agreementId,
  type: 'enduring',
  status: 'awaiting_signature',
  patientId: 'pt-riley',
  assignorId: 'as-1',
  assignorIsPatient: true,
  particulars: {
    patientName: 'Riley Example',
    agreementType: 'enduring',
    agreementDate: '2026-09-04',
    providerName: 'Dr Example Provider',
    providerAddress: '1 Example Street, Sampletown NSW 2000',
    enduringPathway: 'mymedicare',
  },
  particularsLockedAt: '2026-09-04T08:30:00.000Z',
  ruleSetVersion: '2026.07.01',
  mappingVersion: '2026.07.01',
  renderedArtefactHash: 'b'.repeat(64),
};

const EPISODIC_SESSION: TabletSessionPayload = {
  ...SESSION,
  id: '33333333-3333-4333-8333-333333333333',
  agreementType: 'episodic_pre',
  agreementId: 'ag-riley-episodic',
};

const EPISODIC_AGREEMENT = {
  ...ENDURING_AGREEMENT,
  id: EPISODIC_SESSION.agreementId,
  type: 'episodic_pre',
  particulars: {
    ...ENDURING_AGREEMENT.particulars,
    agreementType: 'episodic_pre',
    serviceDate: '2026-09-04',
    basicServiceDescription: 'General practitioner attendance',
  },
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
      pollMs: 60_000,
      identifierTypes: IDENTIFIER_TYPES,
      waiting: [],
      hidden: true,
      reload: false,
    },
  });
}

/** Tick every row K-P1 drew, then continue to the document. */
async function readThroughToTheDocument(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
  for (const type of CONFIRMABLE_DETAIL_TYPES) {
    fireEvent.click(screen.getByTestId(`detail-tick-${type}`));
  }
  await waitFor(() =>
    expect((screen.getByTestId('check-details-continue') as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByTestId('check-details-continue'));
  await waitFor(() => expect(screen.getByTestId('particulars-heading')).toBeTruthy());
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

describe('enduring_heading_differs_from_episodic', () => {
  it('an ongoing agreement is not headed "for today’s visit", and an episodic one is', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(ENDURING_AGREEMENT);

    const enduring = render(<Ceremony />);
    await readThroughToTheDocument();

    expect(screen.getByTestId('particulars-heading').textContent).toBe(
      strings.particulars.headingByAgreementType.enduring,
    );
    expect(screen.getByTestId('particulars-heading').textContent).not.toMatch(/visit/i);
    enduring.unmount();

    // The same ceremony, the same screen, the other type.
    fetchTabletSession.mockResolvedValue({ session: EPISODIC_SESSION });
    fetchAgreement.mockResolvedValue(EPISODIC_AGREEMENT);
    setTabletSessionState.mockResolvedValue({ id: EPISODIC_SESSION.id, state: 'reading' });
    confirmSessionDetails.mockResolvedValue({ id: EPISODIC_SESSION.id, state: 'details_confirmed' });

    render(<Ceremony />);
    await readThroughToTheDocument();

    expect(screen.getByTestId('particulars-heading').textContent).toBe(
      strings.particulars.headingByAgreementType.episodic_pre,
    );
    expect(screen.getByTestId('particulars-heading').textContent).toMatch(/visit/i);
  });
});

describe('enduring_ceremony_shows_coverage_and_no_amount', () => {
  it('explains the scope, how it ends and that it is one provider — with no amount anywhere', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(ENDURING_AGREEMENT);

    render(<Ceremony />);
    await readThroughToTheDocument();

    const coverage = screen.getByTestId('enduring-coverage');
    for (const line of strings.particulars.enduringCoverage) {
      expect(coverage.textContent).toContain(line);
    }

    /*
     * HARD RULE 4, ASSERTED ON THE WHOLE DOCUMENT rather than on the copy
     * alone: no benefit, no dollar amount, no fee anywhere on the screen a
     * patient is being asked to sign. The one number that may legitimately
     * appear here is "two business days", which is a period and not a price.
     */
    const document = screen.getByTestId('particulars-heading').closest('div')?.parentElement;
    expect(document?.textContent ?? '').not.toMatch(/\$|\bAUD\b|benefit amount|rebate/i);

    // Hard rule 12: never about OUR form.
    expect(coverage.textContent).not.toMatch(/certified|accredited|approved/i);

    /*
     * AND THE TWO EPISODIC ROWS ARE ABSENT, which is the regulatory half of
     * this test. A standing agreement has no single service date and no one
     * basic description (REQ-REG-01 makes both pre-agreement elements), so
     * the server sends neither and the screen draws neither. A service date
     * here would be a particular the platform invented, rendered at a patient
     * and hashed into the artefact.
     */
    const rows = screen.getByTestId('enduring-coverage').parentElement?.textContent ?? '';
    expect(rows).not.toContain(strings.particulars.serviceDate);
    expect(rows).toContain(strings.particulars.provider);
  });

  it('offers the quiet second option, and taking it ends the session as a decline', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(ENDURING_AGREEMENT);

    render(<Ceremony />);
    await readThroughToTheDocument();

    const decline = screen.getByTestId('decline-enduring');
    expect(decline.textContent).toContain(strings.particulars.enduringDeclineAction);

    fireEvent.click(decline);

    /*
     * ITS OWN STATE, NOT `walked_away` (Carl, 4 Sep 2026). The patient did not
     * leave — they answered — and reception's next act depends on knowing the
     * difference: one press offers them an agreement for today's visit.
     */
    await waitFor(() =>
      expect(setTabletSessionState).toHaveBeenCalledWith(SESSION.id, 'declined_enduring'),
    );

    // NOTHING ON THE AGREEMENT MOVED. Declining an ongoing agreement declines
    // neither bulk billing nor care (hard rule 8, REQ-REC-04).
    for (const mutator of [transitionAgreement, changeAssignor, lockParticulars, signAgreement]) {
      expect(mutator).not.toHaveBeenCalled();
    }

    // And the patient is told so, in those words.
    await waitFor(() =>
      expect(screen.getByText(strings.particulars.enduringDeclinedHeading)).toBeTruthy(),
    );
    expect(screen.getByText(strings.particulars.enduringDeclinedBody)).toBeTruthy();
  });

  it('does not offer the decline on an episodic agreement — "See reception" already is it', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: EPISODIC_SESSION });
    fetchAgreement.mockResolvedValue(EPISODIC_AGREEMENT);
    setTabletSessionState.mockResolvedValue({ id: EPISODIC_SESSION.id, state: 'reading' });
    confirmSessionDetails.mockResolvedValue({ id: EPISODIC_SESSION.id, state: 'details_confirmed' });

    render(<Ceremony />);
    await readThroughToTheDocument();

    expect(screen.queryByTestId('decline-enduring')).toBeNull();
    expect(screen.queryByTestId('enduring-coverage')).toBeNull();
  });
});
