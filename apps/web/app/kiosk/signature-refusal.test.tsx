/**
 * WHEN THE SERVER REFUSES THE SIGNATURE (Carl, 7 September 2026).
 *
 * WHAT HAPPENED. Carl's kiosk tab was running a bundle from before Saturday's
 * build, so it showed the old particulars screen — no statements — and signed
 * without any affirmations. The server was right to refuse it
 * (`signature_requires_every_statement_affirmed`). What the tablet then did
 * was the defect: it printed "your signature was not recorded, please see
 * reception" and STAYED on the signature page, holding the same payload behind
 * the same button, so the next press produced the same refusal.
 *
 * CARL'S RULING: "If the message is to see reception then close this page and
 * go back to Begin."
 *
 * SO THREE THINGS ARE PINNED HERE.
 *
 *  1. The screen hands over and clears. A refused signature is an ENDING, not
 *     an error message on a live screen.
 *  2. The SESSION ends as `signature_failed`, carrying the server's own reason
 *     CODE and nothing else — so reception's row can say what to do about it,
 *     and so the tablet is released and the poll does not re-enter the session.
 *  3. A tab refused for `affirmations_missing` hard-reloads itself ONCE, on the
 *     next Begin. That is the stale bundle healing without anybody walking to
 *     the device — and once, never in a loop, through the same `reloadedRef`
 *     gate the build floor uses.
 *
 * AND ONE NON-BEHAVIOUR, which is the boundary of all of the above: a request
 * that never REACHED the server ends nothing. The tablet cannot know whether
 * the signature was recorded, so it must not tell the server the session is
 * over, and the outage heartbeat owns the screen.
 *
 * NOTHING HERE TOUCHES THE AGREEMENT. Hard rule 8 (REQ-REC-04): a refusal
 * stops the evidence, never the visit.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CONFIRMABLE_DETAIL_TYPES, type TabletSessionPayload } from '@aobplatform/domain';
import { Ceremony } from './Ceremony';
import { strings } from './strings';

const SESSION: TabletSessionPayload = {
  id: '22222222-2222-4222-8222-222222222222',
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
  particulars: { patientName: 'Riley Example', serviceDate: '2026-09-07' },
  particularsLockedAt: '2026-09-07T08:30:00.000Z',
  ruleSetVersion: '2026.07.01',
  mappingVersion: '2026.07.01',
  renderedArtefactHash: 'a'.repeat(64),
};

/**
 * THE MOCK ERROR CARRIES `reason`, because that is the whole subject here. The
 * real class parses it out of the refusal body; this stands in for it with the
 * same three fields the ceremony reads.
 *
 * INSIDE `vi.hoisted` because `vi.mock`'s factory is hoisted above every
 * top-level declaration in this file, and a class declared normally would not
 * exist yet when the factory runs.
 */
const { FakeKioskApiError } = vi.hoisted(() => ({
  FakeKioskApiError: class KioskApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly reason?: string,
    ) {
      super(message);
      this.name = 'KioskApiError';
    }
  },
}));

const {
  fetchAgreement,
  fetchKioskMe,
  fetchTabletSession,
  fetchWaitingList,
  setTabletSessionState,
  signAgreement,
  completeCapture,
  lockParticulars,
  transitionAgreement,
  changeAssignor,
} = vi.hoisted(() => ({
  fetchAgreement: vi.fn(),
  fetchKioskMe: vi.fn(),
  fetchTabletSession: vi.fn(),
  fetchWaitingList: vi.fn(),
  setTabletSessionState: vi.fn(),
  signAgreement: vi.fn(),
  completeCapture: vi.fn(),
  lockParticulars: vi.fn(),
  transitionAgreement: vi.fn(),
  changeAssignor: vi.fn(),
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
  KioskApiError: FakeKioskApiError,
  isUnpaired: () => false,
  fetchKioskMe,
  fetchWaitingList,
  fetchPracticeStaffNames: vi.fn(async () => []),
  fetchTabletSession,
  confirmSessionDetails: vi.fn(),
  setTabletSessionState,
  claimWaitingRow: vi.fn(),
  fetchAgreement,
  startChallenge: vi.fn(),
  attemptChallenge: vi.fn(),
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

/** Drive the pushed ceremony from the push to the moment the signature is refused. */
async function signAndBeRefused(): Promise<void> {
  render(<Ceremony />);
  await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
  for (const type of CONFIRMABLE_DETAIL_TYPES) {
    fireEvent.click(screen.getByTestId(`detail-tick-${type}`));
  }
  fireEvent.click(screen.getByTestId('check-details-continue'));
  await waitFor(() => expect(screen.getByTestId('continue-to-sign')).toBeTruthy());
  fireEvent.click(screen.getByTestId('continue-to-sign'));
  await waitFor(() => expect(screen.getByTestId('sign-control-tap')).toBeTruthy());
  fireEvent.click(screen.getByTestId('sign-control-tap'));
}

let reload: ReturnType<typeof vi.fn>;
let realLocation: Location;

beforeEach(() => {
  for (const mock of [
    fetchAgreement,
    fetchKioskMe,
    fetchTabletSession,
    fetchWaitingList,
    setTabletSessionState,
    signAgreement,
    completeCapture,
    lockParticulars,
    transitionAgreement,
    changeAssignor,
  ]) {
    mock.mockReset();
  }
  asPairedTablet();
  fetchTabletSession.mockResolvedValue({ session: SESSION });
  fetchAgreement.mockResolvedValue(AGREEMENT);
  setTabletSessionState.mockResolvedValue({ id: SESSION.id, state: 'reading' });

  realLocation = window.location;
  reload = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, reload },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: realLocation });
});

describe('refused_signature_says_see_reception_then_returns_to_begin', () => {
  it('leaves the signature screen for the hand-over, and clears to Begin', async () => {
    signAgreement.mockRejectedValue(new FakeKioskApiError('refused', 400, 'not_locked'));

    await signAndBeRefused();

    // THE SIGNATURE PAGE IS CLOSED, not merely annotated. The old behaviour
    // was to stay here with the same payload behind the same button.
    await waitFor(() => expect(screen.getByTestId('handover-heading')).toBeTruthy());
    expect(screen.queryByTestId('sign-control-tap')).toBeNull();
    expect(screen.queryByTestId('signature-heading')).toBeNull();

    // THE COPY IS THE STRING TABLE'S, and it says the two things that are
    // true for every reason code: see reception, and the visit is unaffected
    // (hard rule 8, REQ-REC-04).
    expect(screen.getByTestId('handover-heading').textContent).toBe(strings.signature.notRecordedHeading);
    expect(screen.getByTestId('handover-body').textContent).toBe(strings.signature.notRecordedBody);

    // AND IT CLEARS. The hold auto-returns, and a tap gets there sooner.
    fireEvent.click(screen.getByTestId('handover-done'));
    await waitFor(() => expect(screen.getByTestId('start-check-in')).toBeTruthy());
  });

  it('the refusal never says why to the patient, and never quotes the server', async () => {
    signAgreement.mockRejectedValue(
      new FakeKioskApiError('The person signing has not agreed to every statement', 400, 'affirmations_missing'),
    );

    await signAndBeRefused();
    await waitFor(() => expect(screen.getByTestId('handover-heading')).toBeTruthy());

    /*
     * THE CODE AND THE SENTENCE BOTH BELONG TO RECEPTION, not to the person
     * holding the tablet. A patient can do nothing with either, and the
     * server's prose is written for a developer.
     */
    expect(document.body.textContent).not.toContain('affirmations_missing');
    expect(document.body.textContent).not.toContain('has not agreed to every statement');
  });

  it('a request that never reached the server ends nothing — that is the outage screen’s job', async () => {
    // Not a `KioskApiError`: this is what `fetch` throws when nothing lands.
    signAgreement.mockRejectedValue(new TypeError('Failed to fetch'));

    await signAndBeRefused();

    await waitFor(() => expect(signAgreement).toHaveBeenCalledTimes(1));
    // Still on the signature screen, still able to try again, and the session
    // is NOT ended: the tablet does not know what happened to the signature.
    expect(screen.getByTestId('sign-control-tap')).toBeTruthy();
    for (const call of setTabletSessionState.mock.calls) expect(call[1]).toBe('reading');
  });
});

describe('refused_signature_ends_the_session_as_signature_failed', () => {
  it('posts the ending with the server’s own reason code, and touches no agreement', async () => {
    signAgreement.mockRejectedValue(new FakeKioskApiError('refused', 400, 'affirmations_missing'));

    await signAndBeRefused();

    await waitFor(() =>
      expect(setTabletSessionState).toHaveBeenCalledWith(SESSION.id, 'signature_failed', 'affirmations_missing'),
    );

    /*
     * THE ASSERTION THAT MATTERS. Ending a session is not an act on the
     * contract: nothing is transitioned, re-locked, re-pointed or completed,
     * so the agreement reception re-sends is the one they sent (hard rule 8).
     */
    expect(transitionAgreement).not.toHaveBeenCalled();
    expect(lockParticulars).not.toHaveBeenCalled();
    expect(changeAssignor).not.toHaveBeenCalled();
    expect(completeCapture).not.toHaveBeenCalled();
  });

  it('a refusal with no code still ends the session, as `other`', async () => {
    // An older core, or a refusal this list has not met. The session must
    // still end and the tablet must still be released; the console shows the
    // code it was given rather than a generic sentence.
    signAgreement.mockRejectedValue(new FakeKioskApiError('refused', 400));

    await signAndBeRefused();

    await waitFor(() =>
      expect(setTabletSessionState).toHaveBeenCalledWith(SESSION.id, 'signature_failed', 'other'),
    );
  });
});

describe('stale_bundle_reloads_once_after_affirmations_missing', () => {
  it('hard-reloads on the next Begin, and only once', async () => {
    signAgreement.mockRejectedValue(new FakeKioskApiError('refused', 400, 'affirmations_missing'));

    await signAndBeRefused();
    await waitFor(() => expect(screen.getByTestId('handover-heading')).toBeTruthy());

    /*
     * NOT WHILE SOMEBODY IS STANDING AT IT. Reloading the tab mid-hand-over
     * would take the screen away from the person reading it; the reload waits
     * for the tablet to be between patients, exactly as the build floor does.
     */
    expect(reload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('handover-done'));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

    /*
     * ONE ATTEMPT, NEVER A LOOP. If the reload does not change the bundle —
     * a cached build, a CDN behind — a second refusal must not start the
     * tablet reloading every few seconds, which is the one failure mode that
     * requires somebody to physically visit the device.
     */
    await waitFor(() => expect(screen.getByTestId('start-check-in')).toBeTruthy());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('every other reason leaves the bundle alone', async () => {
    // `not_locked` says something about the AGREEMENT, not about this tab.
    // Reloading on it would be a tablet restarting itself for no reason.
    signAgreement.mockRejectedValue(new FakeKioskApiError('refused', 400, 'not_locked'));

    await signAndBeRefused();
    await waitFor(() => expect(screen.getByTestId('handover-heading')).toBeTruthy());
    fireEvent.click(screen.getByTestId('handover-done'));

    await waitFor(() => expect(screen.getByTestId('start-check-in')).toBeTruthy());
    expect(reload).not.toHaveBeenCalled();
  });
});
