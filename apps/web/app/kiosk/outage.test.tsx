/**
 * THE OUTAGE SCREEN (TODO.md "Outage screen on the tablet", Carl 4 Sep 2026):
 * "When the server is down, hide everything and say, Please contact
 * reception." Carl watched Begin still showing while core was down — a
 * patient could have pressed it, typed three identifiers into a tablet that
 * could not check them, and been told nothing until the claim failed. These
 * tests protect the fix:
 *
 *   IT REPLACES WHATEVER SCREEN WAS UP, on idle and on every ceremony screen
 *   a patient can be standing at — asserted on the idle screen, K-2, K-3 and
 *   K-P1, because `useWaitingList` and `useTabletSession` are each disabled
 *   on some of those (see their own comments), so a fix that only worked
 *   where they happen to be polling would leave the others showing exactly
 *   the bug Carl found.
 *
 *   IT IGNORES A REFUSAL. A 401 means revoked, not down — the unpaired
 *   screen already owns that story — and any other 4xx is the server
 *   answering, just not with a yes. Neither may count towards "the platform
 *   is unreachable".
 *
 *   RECOVERY CLEARS EVERYTHING AND RETURNS TO IDLE, on the first poll that
 *   succeeds. (A session still live on the server reappearing on its own is
 *   the same non-blocking guard `resend-session.test.tsx` proves; this suite
 *   isolates the clean case — nothing left server-side to reclaim the
 *   screen — so the return to idle is deterministic rather than racing a
 *   second poll.)
 *
 *   AND NOTHING IS EVER POSTED because of an outage — no `walked_away`, no
 *   `timed_out`, nothing on the agreement. The tablet cannot reach the
 *   server, and by the time it can again, either the session is still there
 *   or the server has already decided it is not.
 *
 * Driven against the real `Ceremony`, with `./api` mocked wholesale, for the
 * reason every other ceremony-sequence suite in this directory gives: what
 * matters is which calls are made and which screen is on glass, not what any
 * one endpoint returns over a wire.
 *
 * THE CLOCK IS FAKE FROM BEFORE THE FIRST RENDER (see `inactivity.test.tsx`'s
 * own note on this), and `waitFor` is not used anywhere below for the same
 * reason that file gives: it polls on a timer this file has replaced.
 * Everything is settled explicitly with `settle()` / `advanceMs()` instead.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import type { TabletSessionPayload } from '@aobplatform/domain';
import { Ceremony } from './Ceremony';
import { strings } from './strings';
import { KioskApiError, type KioskWaitingRow } from './api';

const IDENTIFIER_TYPES = ['name', 'date_of_birth', 'address'];
/** Slow enough that a fake-timer run does not flood it; fast enough to advance in one step. */
const POLL_MS = 10_000;

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

const LOCKED_AGREEMENT = {
  id: RILEY.agreementId,
  type: 'episodic_pre',
  status: 'awaiting_signature',
  patientId: RILEY.patientId,
  assignorId: 'as-1',
  assignorIsPatient: true,
  particulars: { patientName: RILEY.patientName, serviceDate: '2026-09-04' },
  particularsLockedAt: '2026-09-04T08:30:00.000Z',
  ruleSetVersion: '2026.07.01',
  mappingVersion: '2026.07.01',
  renderedArtefactHash: 'a'.repeat(64),
};

const SESSION: TabletSessionPayload = {
  id: '33333333-3333-4333-8333-333333333333',
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
  agreementId: 'ag-riley-pushed',
  captureRequestId: 'cr-riley-pushed',
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
  // A REAL 401 CHECK, unlike most sibling suites' `isUnpaired: () => false` —
  // this file is specifically about the boundary between "revoked" and "down".
  KioskApiError: class KioskApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  isUnpaired: (err: unknown) =>
    typeof err === 'object' && err !== null && (err as { status?: number }).status === 401,
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

/** Every call that could change what the server holds about an agreement or a session. */
const MUTATORS = [
  claimWaitingRow,
  startChallenge,
  attemptChallenge,
  transitionAgreement,
  changeAssignor,
  lockParticulars,
  signAgreement,
  completeCapture,
  confirmSessionDetails,
] as const;

function asPairedTablet(rows: readonly KioskWaitingRow[] = []): void {
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
      waiting: rows,
      hidden: rows.length === 0,
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
  fetchTabletSession.mockResolvedValue({ session: null });
  setTabletSessionState.mockResolvedValue({ id: SESSION.id, state: 'reading' });
  confirmSessionDetails.mockResolvedValue({ id: SESSION.id, state: 'details_confirmed' });
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('outage_replaces_every_screen_with_see_reception', () => {
  it('idle: two failed polls hide Begin and show "please contact reception"', async () => {
    asPairedTablet();
    render(<Ceremony />);
    await settle();
    expect(screen.getByTestId('start-check-in')).toBeTruthy();

    fetchKioskMe.mockRejectedValue(new Error('network down'));
    await advanceMs(POLL_MS);
    // ONE FAILURE IS NOT AN OUTAGE. A single dropped request is a network blip.
    expect(screen.queryByTestId('outage-heading')).toBeNull();
    expect(screen.getByTestId('start-check-in')).toBeTruthy();

    await advanceMs(POLL_MS);
    expect(screen.getByTestId('outage-heading').textContent).toBe(strings.outage.heading);
    expect(screen.getByTestId('outage-body').textContent).toBe(strings.outage.body);
    // NOTHING ELSE — Begin, the practice's chrome content, all of it is gone.
    expect(screen.queryByTestId('start-check-in')).toBeNull();
  });

  it('K-2 (verify): the ceremony a patient is filling in is replaced too', async () => {
    asPairedTablet();
    render(<Ceremony />);
    await settle();
    fireEvent.click(screen.getByTestId('start-check-in'));
    await settle();
    expect(screen.getByTestId('identifier-name-given')).toBeTruthy();
    fireEvent.change(screen.getByTestId('identifier-name-given'), { target: { value: 'Riley' } });

    fetchKioskMe.mockRejectedValue(new Error('network down'));
    await advanceMs(POLL_MS);
    await advanceMs(POLL_MS);

    expect(screen.getByTestId('outage-heading')).toBeTruthy();
    expect(screen.queryByTestId('identifier-name-given')).toBeNull();
    // NOTHING TYPED SURVIVES ON SCREEN either.
    expect(document.body.textContent).not.toContain('Riley');
  });

  it('K-3 (particulars): a locked agreement on glass is replaced too', async () => {
    asPairedTablet();
    claimWaitingRow.mockResolvedValueOnce({ outcome: 'passed', verificationEventId: 've-1', row: RILEY });
    fetchAgreement.mockResolvedValueOnce(LOCKED_AGREEMENT);

    render(<Ceremony />);
    await settle();
    fireEvent.click(screen.getByTestId('start-check-in'));
    await settle();
    expect(screen.getByTestId('identifier-name-given')).toBeTruthy();
    fireEvent.change(screen.getByTestId('identifier-name-given'), { target: { value: 'Riley' } });
    fireEvent.change(screen.getByTestId('identifier-name-family'), { target: { value: 'Example' } });
    fireEvent.change(screen.getByTestId('identifier-address'), {
      target: { value: '7 Sample Road Sampletown 2000' },
    });
    fireEvent.change(screen.getByTestId('identifier-dob-day'), { target: { value: '09' } });
    fireEvent.change(screen.getByTestId('identifier-dob-month'), { target: { value: '03' } });
    fireEvent.change(screen.getByTestId('identifier-dob-year'), { target: { value: '1988' } });
    fireEvent.click(screen.getByTestId('verify-continue'));
    await settle();
    expect(screen.getByTestId('particulars-heading')).toBeTruthy();

    fetchKioskMe.mockRejectedValue(new Error('network down'));
    await advanceMs(POLL_MS);
    await advanceMs(POLL_MS);

    expect(screen.getByTestId('outage-heading')).toBeTruthy();
    expect(screen.queryByTestId('particulars-heading')).toBeNull();
    expect(document.body.textContent).not.toContain('Riley Example');
  });

  it('K-P1 (check-details): a pushed session on glass is replaced too', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    render(<Ceremony />);
    await settle();
    expect(screen.getByTestId('check-details-heading')).toBeTruthy();

    fetchKioskMe.mockRejectedValue(new Error('network down'));
    await advanceMs(POLL_MS);
    await advanceMs(POLL_MS);

    expect(screen.getByTestId('outage-heading')).toBeTruthy();
    expect(screen.queryByTestId('check-details-heading')).toBeNull();
    for (const trace of ['Riley Example', '7 Sample Road', 'riley@example.invalid', '1988', '0400 000 000']) {
      expect(document.body.textContent).not.toContain(trace);
    }
  });
});

describe('outage_ignores_401_and_4xx', () => {
  it('a revoked credential never shows the outage screen — the unpaired story owns that', async () => {
    asPairedTablet();
    render(<Ceremony />);
    await settle();
    expect(screen.getByTestId('start-check-in')).toBeTruthy();

    fetchKioskMe.mockRejectedValue(new KioskApiError('revoked', 401));

    await advanceMs(POLL_MS);
    await advanceMs(POLL_MS);
    await advanceMs(POLL_MS);

    expect(screen.queryByTestId('outage-heading')).toBeNull();
    // Nothing else on this device reacted to it either — the outage poll is
    // the only thing that was fed a 401 here.
    expect(screen.getByTestId('start-check-in')).toBeTruthy();
  });

  it('an ordinary 4xx is ignored outright — not counted for, and not against', async () => {
    asPairedTablet();
    render(<Ceremony />);
    await settle();
    expect(screen.getByTestId('start-check-in')).toBeTruthy();

    fetchKioskMe.mockRejectedValue(new KioskApiError('not found', 404));
    await advanceMs(POLL_MS);
    await advanceMs(POLL_MS);
    expect(screen.queryByTestId('outage-heading')).toBeNull();

    // NOW A REAL OUTAGE, and it still takes the full two failures — the 4xx
    // pair above did not quietly advance the counter.
    fetchKioskMe.mockRejectedValue(new Error('network down'));
    await advanceMs(POLL_MS);
    expect(screen.queryByTestId('outage-heading')).toBeNull();
    await advanceMs(POLL_MS);
    expect(screen.getByTestId('outage-heading')).toBeTruthy();
  });
});

describe('recovery_returns_to_idle_and_clears_state', () => {
  it('the first successful poll after an outage clears state and returns to idle', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    render(<Ceremony />);
    await settle();
    expect(screen.getByTestId('check-details-heading')).toBeTruthy();

    fetchKioskMe.mockRejectedValue(new Error('network down'));
    await advanceMs(POLL_MS);
    await advanceMs(POLL_MS);
    expect(screen.getByTestId('outage-heading')).toBeTruthy();

    /*
     * THE SERVER ANSWERS AGAIN, and by then the session has also ended
     * (recalled, expired, or signed elsewhere) — the clean case this test
     * isolates. A session still live on recovery reappearing on its own is
     * the same non-blocking guard `resend-session.test.tsx` proves.
     */
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
    fetchTabletSession.mockResolvedValue({ session: null });
    await advanceMs(POLL_MS);

    expect(screen.queryByTestId('outage-heading')).toBeNull();
    expect(screen.getByTestId('start-check-in')).toBeTruthy();
    for (const trace of ['Riley Example', '7 Sample Road', 'riley@example.invalid', '1988', '0400 000 000']) {
      expect(document.body.textContent).not.toContain(trace);
    }
  });
});

describe('outage_posts_nothing', () => {
  it('no call reaches the server because of the outage or the recovery', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    render(<Ceremony />);
    await settle();
    expect(screen.getByTestId('check-details-heading')).toBeTruthy();
    // `reading` is legitimate — posted the moment K-P1 first renders, before
    // any outage. Everything from here on is what this test protects.
    const callsBeforeOutage = setTabletSessionState.mock.calls.length;

    fetchKioskMe.mockRejectedValue(new Error('network down'));
    await advanceMs(POLL_MS);
    await advanceMs(POLL_MS);
    expect(screen.getByTestId('outage-heading')).toBeTruthy();

    // The session ends server-side while this tablet cannot see it — see
    // the note in `recovery_returns_to_idle_and_clears_state` above.
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
    fetchTabletSession.mockResolvedValue({ session: null });
    await advanceMs(POLL_MS);
    expect(screen.getByTestId('start-check-in')).toBeTruthy();

    // NEITHER `walked_away` NOR `timed_out` — an outage tells the server
    // nothing, because the tablet could not reach it, and by the time it can
    // again the server has either kept the session or already ended it.
    expect(setTabletSessionState.mock.calls.length).toBe(callsBeforeOutage);
    for (const mutator of MUTATORS) {
      expect(mutator).not.toHaveBeenCalled();
    }
  });
});
