/**
 * K-4 SAYS WHO IS SIGNING, AND THE FOOTER SAYS WHICH RECORD (Carl, 7 Sep 2026,
 * from testing the pushed flow: "did not ask who is signing", and "every page
 * must have the patient GUID from AoBPlatform somewhere, so we can see which
 * record has the issue").
 *
 * WHAT THESE PROTECT is a STATEMENT, not a control. D7 is a locked particular
 * by the time K-4 draws (hard rule 2, REQ-REG-06); the fault was that the
 * person holding the pen was never told whose signature they were putting on
 * the glass, not that they were never asked. So the assertions are that the
 * words appear, that they name all three facts on the other-party branch, and
 * that nothing on this screen offers to change any of it.
 *
 * AND THAT THE RECORD ID IS PUSHED-SESSION-ONLY. Before verification a walk-up
 * tablet knows nothing about any person and there is no record to name; the id
 * appearing on an idle tablet in a waiting room would be a fact about somebody
 * on a screen nobody is standing at.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CONFIRMABLE_DETAIL_TYPES, type TabletSessionPayload } from '@aobplatform/domain';
import { Ceremony } from './Ceremony';
import { strings } from './strings';
import { relationshipLabel } from './rules/assignor';

/** Obviously fake, and carrying no Medicare number — there is no field for one. */
const PATIENT_ID = 'e609b40e-63aa-56e1-8f5b-2e9bc5aa5133';

const SESSION: TabletSessionPayload = {
  id: '11111111-1111-4111-8111-111111111111',
  state: 'pushed',
  agreementType: 'episodic_pre',
  patient: {
    givenNames: 'Alex',
    familyName: 'Fictional',
    dateOfBirth: '1988-03-09',
    address: '7 Sample Road, Sampletown NSW 2000',
    mobile: '0400 000 000',
    email: 'alex@example.invalid',
  },
  patientId: PATIENT_ID,
  assignor: { isPatient: true },
  detailsCheck: 'required',
  agreementId: 'ag-alex',
  captureRequestId: 'cr-alex',
};

const AGREEMENT = {
  id: SESSION.agreementId,
  type: 'episodic_pre',
  status: 'awaiting_signature',
  patientId: PATIENT_ID,
  assignorId: 'as-1',
  assignorIsPatient: true,
  particulars: { patientName: 'Alex Fictional', serviceDate: '2026-09-04' },
  particularsLockedAt: '2026-09-04T08:30:00.000Z',
  ruleSetVersion: '2026.07.01',
  mappingVersion: '2026.07.01',
  renderedArtefactHash: 'a'.repeat(64),
};

const {
  fetchAgreement,
  fetchKioskMe,
  fetchTabletSession,
  fetchWaitingList,
  setTabletSessionState,
  confirmSessionDetails,
  changeAssignor,
  lockParticulars,
  signAgreement,
} = vi.hoisted(() => ({
  fetchAgreement: vi.fn(),
  fetchKioskMe: vi.fn(),
  fetchTabletSession: vi.fn(),
  fetchWaitingList: vi.fn(),
  setTabletSessionState: vi.fn(),
  confirmSessionDetails: vi.fn(),
  changeAssignor: vi.fn(),
  lockParticulars: vi.fn(),
  signAgreement: vi.fn(),
}));

vi.mock('./pairing', () => ({
  PAIRING_CREDENTIAL_KEY: 'aob.kiosk.pairing',
  PERSISTABLE_KEYS: ['aob.kiosk.pairing'],
  readPairingCredential: () => 'fake-device-credential',
  writePairingCredential: () => true,
  clearPairingCredential: vi.fn(),
}));

vi.mock('./api', () => ({
  sendKioskHeartbeat: vi.fn(async () => ({ command: null, pollMs: 0, outOfUse: false, reload: false })),
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
  claimWaitingRow: vi.fn(),
  fetchAgreement,
  startChallenge: vi.fn(),
  attemptChallenge: vi.fn(),
  transitionAgreement: vi.fn(),
  changeAssignor,
  lockParticulars,
  signAgreement,
  completeCapture: vi.fn(),
}));

const IDENTIFIER_TYPES = ['name', 'date_of_birth', 'address'];

function asPairedTablet(): void {
  fetchKioskMe.mockResolvedValue({
    deviceId: 'device-1',
    deviceLabel: 'Carl browser tablet',
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

/** Push, tick every row, read, and land on the signature screen. */
async function reachSignatureScreen(): Promise<void> {
  render(<Ceremony />);
  await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
  for (const type of CONFIRMABLE_DETAIL_TYPES) {
    fireEvent.click(screen.getByTestId(`detail-tick-${type}`));
  }
  fireEvent.click(screen.getByTestId('check-details-continue'));
  await waitFor(() => expect(screen.getByTestId('continue-to-sign')).toBeTruthy());
  fireEvent.click(screen.getByTestId('continue-to-sign'));
  await waitFor(() => expect(screen.getByTestId('signature-heading')).toBeTruthy());
}

beforeEach(() => {
  for (const mock of [
    fetchAgreement,
    fetchKioskMe,
    fetchTabletSession,
    fetchWaitingList,
    setTabletSessionState,
    confirmSessionDetails,
    changeAssignor,
    lockParticulars,
    signAgreement,
  ]) {
    mock.mockReset();
  }
  fetchTabletSession.mockResolvedValue({ session: null });
  setTabletSessionState.mockResolvedValue({ id: SESSION.id, state: 'reading' });
  confirmSessionDetails.mockResolvedValue({ id: SESSION.id, state: 'details_confirmed' });
});

describe('signature_screen_names_who_is_signing', () => {
  it('states the patient by name on the screen with the pen on it', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(AGREEMENT);

    await reachSignatureScreen();

    expect(screen.getByTestId('signature-who').textContent).toBe(
      strings.signature.signingByPatient('Alex Fictional'),
    );

    /*
     * AND IT OFFERS NO WAY TO CHANGE IT. D7 is locked; the only thing under the
     * statement is the exit, which calls nothing on the agreement
     * (REQ-REC-04). A control here would be a tablet editing a particular of a
     * contract in a waiting room.
     */
    expect(screen.getByTestId('signature-who-wrong').textContent).toBe(strings.signature.whoNotRight);
    fireEvent.click(screen.getByTestId('signature-who-see-reception'));
    expect(changeAssignor).not.toHaveBeenCalled();
    expect(lockParticulars).not.toHaveBeenCalled();
    expect(signAgreement).not.toHaveBeenCalled();
  });
});

describe('signature_screen_names_the_assignor_and_relationship_when_not_the_patient', () => {
  /*
   * ALL THREE FACTS, because a wrong pairing shows up in exactly one of them:
   * who is signing, who they are signing for, and on what footing.
   */
  it('names the assignor, the patient and the relationship', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({
      session: {
        ...SESSION,
        assignor: { isPatient: false, name: 'Kim Fictional', relationship: 'Mother' },
      },
    });
    fetchAgreement.mockResolvedValue({
      ...AGREEMENT,
      assignorIsPatient: false,
      particulars: {
        ...AGREEMENT.particulars,
        assignorName: 'Kim Fictional',
        assignorRelationship: 'Mother',
      },
    });

    await reachSignatureScreen();

    const line = screen.getByTestId('signature-who').textContent ?? '';
    expect(line).toBe(strings.signature.signingByOther('Kim Fictional', 'Alex Fictional', 'Mother'));
    expect(line).toContain('Kim Fictional');
    expect(line).toContain('Alex Fictional');
    expect(line).toContain('Mother');
  });

  /*
   * A KEY-SHAPED VALUE FROM AN OLDER RECORD STILL READS AS A WORD. The list is
   * versioned content (`assignor-relationships.json`, hard rule 14) and the
   * words are the string table's; `relationshipLabel` is the one lookup.
   */
  it('renders a relationship key through the string table', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({
      session: {
        ...SESSION,
        assignor: { isPatient: false, name: 'Kim Fictional', relationship: 'family_member' },
      },
    });
    fetchAgreement.mockResolvedValue({
      ...AGREEMENT,
      assignorIsPatient: false,
      particulars: {
        ...AGREEMENT.particulars,
        assignorName: 'Kim Fictional',
        assignorRelationship: 'family_member',
      },
    });

    await reachSignatureScreen();

    const line = screen.getByTestId('signature-who').textContent ?? '';
    expect(line).toContain(relationshipLabel('family_member'));
    expect(line).not.toContain('family_member');
  });

  /*
   * A NAME WITH NO RELATIONSHIP ON THE RECORD says the sentence without one,
   * rather than "as their ." or a legal footing nobody declared.
   */
  it('leaves the relationship out when the record carries none', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({
      session: { ...SESSION, assignor: { isPatient: false, name: 'Kim Fictional' } },
    });
    fetchAgreement.mockResolvedValue({
      ...AGREEMENT,
      assignorIsPatient: false,
      particulars: { ...AGREEMENT.particulars, assignorName: 'Kim Fictional' },
    });

    await reachSignatureScreen();

    expect(screen.getByTestId('signature-who').textContent).toBe(
      strings.signature.signingByOtherUnstated('Kim Fictional', 'Alex Fictional'),
    );
  });
});

describe('kiosk_footer_shows_the_patient_id_during_a_pushed_session_only', () => {
  it('names the record in full on every pushed screen', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(AGREEMENT);

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());

    // K-P1. IN FULL — the point is matching a record exactly, not by eye.
    const onCheckDetails = screen.getByTestId('kiosk-patient-identity').textContent ?? '';
    expect(onCheckDetails).toBe(strings.chrome.patientIdentity(PATIENT_ID));
    expect(onCheckDetails).toContain(PATIENT_ID);

    for (const type of CONFIRMABLE_DETAIL_TYPES) {
      fireEvent.click(screen.getByTestId(`detail-tick-${type}`));
    }
    fireEvent.click(screen.getByTestId('check-details-continue'));

    // K-3, and then K-4.
    await waitFor(() => expect(screen.getByTestId('continue-to-sign')).toBeTruthy());
    expect(screen.getByTestId('kiosk-patient-identity').textContent).toContain(PATIENT_ID);
    fireEvent.click(screen.getByTestId('continue-to-sign'));
    await waitFor(() => expect(screen.getByTestId('signature-heading')).toBeTruthy());
    expect(screen.getByTestId('kiosk-patient-identity').textContent).toContain(PATIENT_ID);
  });

  it('says nothing on a tablet with no pushed session', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: null });

    render(<Ceremony />);
    // The build mark proves the footer itself rendered; the record line and the
    // session line are both absent, and for the same reason.
    await waitFor(() => expect(screen.getByTestId('kiosk-build')).toBeTruthy());
    expect(screen.queryByTestId('kiosk-patient-identity')).toBeNull();
    expect(screen.queryByTestId('kiosk-session-identity')).toBeNull();
  });
});
