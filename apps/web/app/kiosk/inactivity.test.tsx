/**
 * RETURN TO THE START WHEN THE TABLET IS UNTOUCHED (Carl, 4 September 2026).
 *
 * > "Return to the start when untouched for N minutes — a per-practice
 * > setting, default 5 minutes. Applies to every kiosk screen except idle: any
 * > pointer/touch/key activity resets the timer; on expiry the tablet clears
 * > ALL in-memory state and returns to idle."
 *
 * WHAT THESE TESTS PROTECT, and each one is a way the feature could look built
 * and not be:
 *
 *   IT ACTUALLY FIRES, and what is left afterwards is the idle screen with
 *   nobody's name, date of birth, address or email anywhere in the document.
 *   A reset that changed the step and kept the state would pass a screenshot
 *   and fail the requirement.
 *
 *   IT TELLS THE SERVER ON THE PUSHED PATH AND ONLY THERE, WITH `timed_out` —
 *   NOT `walked_away` (Carl's ruling, 4 Sep 2026: same effect on the record,
 *   different word, so reception can tell "asked for help" from "the clock
 *   fired"). It releases the tablet so reception can push the next patient and
 *   shows in their status column. A walk-up posts NOTHING — nothing was
 *   started server-side beyond a verification event, and that event stands,
 *   because it records an identity check that genuinely happened.
 *
 *   IT NEVER TOUCHES THE AGREEMENT. Every mutating call is asserted at zero,
 *   for the same reason `way-out.test.tsx` asserts it about the exit: a
 *   timeout that declined, cancelled or completed anything would be the
 *   platform blocking care on a timer (hard rule 8, REQ-REC-04).
 *
 *   THE NUMBER IS THE PRACTICE'S. A hard-coded five minutes would pass every
 *   other test in this file.
 *
 *   AND A TOUCH CANCELS IT. This is the one that decides whether the feature
 *   is usable at all — a clock that a patient reading an agreement cannot
 *   reset by touching the screen would reset it under their hand.
 *
 * FAKE TIMERS THROUGHOUT, because the alternative is a suite that waits five
 * real minutes. `advanceTimersByTime` is wrapped in `act` so the state the
 * timers set is flushed before anything is read.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import {
  CONFIRMABLE_DETAIL_TYPES,
  KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS,
  KIOSK_IDLE_WARNING_SECONDS,
  type TabletSessionPayload,
} from '@aobplatform/domain';
import { Ceremony } from './Ceremony';
import { strings } from './strings';
import type { KioskWaitingRow } from './api';

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
  particulars: { patientName: 'Riley Example', serviceDate: '2026-09-04' },
  particularsLockedAt: '2026-09-04T08:30:00.000Z',
  ruleSetVersion: '2026.07.01',
  mappingVersion: '2026.07.01',
  renderedArtefactHash: 'a'.repeat(64),
};

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

/** Every call that could change what the server holds about an AGREEMENT. */
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

function asPairedTablet(
  idleTimeoutSeconds: number | undefined = KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS,
  rows: readonly KioskWaitingRow[] = [],
): void {
  fetchKioskMe.mockResolvedValue({
    deviceId: 'device-1',
    deviceLabel: 'Carl browser tablet',
    practiceId: 'practice-1',
    practiceName: 'Sample Practice',
    state: 'NSW',
    identifierTypes: IDENTIFIER_TYPES,
    showsWaitingList: rows.length > 0,
    kioskIdleTimeoutSeconds: idleTimeoutSeconds,
    reload: false,
  });
  fetchWaitingList.mockResolvedValue({
    kind: 'changed' as const,
    etag: '"rev-1"',
    body: {
      practiceId: 'practice-1',
      revision: 'rev-1',
      // Slow, so the polls do not flood a fake-timer run.
      pollMs: 600_000,
      identifierTypes: IDENTIFIER_TYPES,
      waiting: rows,
      hidden: rows.length === 0,
      reload: false,
    },
  });
}

/**
 * THE CLOCK IS FAKE FROM BEFORE THE FIRST RENDER, and that is not a detail.
 * Installing it after mounting leaves the hook's own `setTimeout` on the REAL
 * clock, so nothing this file advances ever reaches it and every assertion
 * passes for the wrong reason — the tablet appears never to time out, which is
 * exactly the bug these tests exist to catch.
 *
 * `waitFor` IS NOT USED ANYWHERE BELOW for the same reason: it polls on a
 * timer this file has replaced. Everything is settled explicitly instead, so
 * each assertion reads a screen that has finished rendering rather than one
 * that might.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
  }
}

/** Move the fake clock, flushing whatever the timers set into React. */
async function advance(seconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(seconds * 1_000);
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
  fetchAgreement.mockResolvedValue(AGREEMENT);
  /*
   * Only the clock, and nothing that carries a promise across a tick.
   * `queueMicrotask` and `nextTick` are left real, so an `await` still resolves
   * without somebody having to advance a timer to let a `then` run.
   */
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/** A pushed ceremony, sitting on K-P1 with the patient's details on the glass. */
async function aPushedCeremony(idleTimeoutSeconds?: number): Promise<void> {
  asPairedTablet(idleTimeoutSeconds);
  fetchTabletSession.mockResolvedValue({ session: SESSION });
  render(<Ceremony />);
  await settle();
  expect(screen.getByTestId('check-details-heading')).toBeTruthy();
}

describe('inactivity_reset_returns_to_idle_and_clears_state', () => {
  it('drops every detail off the screen and lands on idle', async () => {
    await aPushedCeremony();

    // Not before it is due. Four minutes into a five-minute setting the
    // patient's details are still on the screen, because they are still there.
    await advance(KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS - KIOSK_IDLE_WARNING_SECONDS - 5);
    expect(screen.getByTestId('check-details-heading')).toBeTruthy();
    expect(screen.queryByTestId('inactivity-warning')).toBeNull();

    // THE WARNING FIRST, thirty seconds out. Quiet, and it asks rather than
    // announces — see `InactivityWarning`.
    await advance(5);
    expect(screen.getByTestId('inactivity-warning')).toBeTruthy();
    expect(screen.getByTestId('inactivity-countdown').textContent).toBe(
      strings.inactivity.countdown(KIOSK_IDLE_WARNING_SECONDS),
    );
    // It does not cover the ceremony or intercept the tap that dismisses it.
    expect(screen.getByTestId('check-details-heading')).toBeTruthy();

    await advance(KIOSK_IDLE_WARNING_SECONDS);

    // IDLE, NOT THE HAND-OVER. There is nobody standing here to be helped, and
    // a tablet left saying "our reception staff can help" is still saying
    // something to a room.
    await settle();
    expect(screen.getByTestId('start-check-in')).toBeTruthy();
    expect(screen.queryByTestId('inactivity-warning')).toBeNull();

    /*
     * AND NOTHING OF THE PATIENT SURVIVED. This is the assertion the whole
     * feature exists for: a reset that moved the step and kept the state would
     * pass a screenshot and fail the requirement.
     */
    for (const trace of ['Riley Example', '7 Sample Road', 'riley@example.invalid', '1988', '0400 000 000']) {
      expect(document.body.textContent).not.toContain(trace);
    }
  });
});

describe('inactivity_reset_posts_timed_out_for_a_pushed_session', () => {
  it('ends the SESSION and leaves the agreement exactly where it was', async () => {
    await aPushedCeremony();

    await advance(KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS);
    await settle();
    expect(screen.getByTestId('start-check-in')).toBeTruthy();

    /*
     * `timed_out` — NOT `walked_away`. Same effect on the record as the exit
     * button (releases the tablet for the next push, shows in reception's
     * status column), but a different word, because this time nobody pressed
     * anything: the tablet's own clock ended it (Carl's ruling, 4 Sep 2026).
     */
    expect(setTabletSessionState).toHaveBeenCalledWith(SESSION.id, 'timed_out');

    /*
     * AND NOTHING ELSE MOVED. Not a transition, not a lock, not a decline, not
     * a completed capture request. The particulars stay locked, the capture
     * request stays open, the patient is still seen, and reception still
     * chooses what to do after the service (hard rule 8, REQ-REC-04).
     */
    for (const mutator of AGREEMENT_MUTATORS) expect(mutator).not.toHaveBeenCalled();
  });
});

describe('inactivity_reset_posts_nothing_for_a_walk_up', () => {
  it('clears the screen and tells the server nothing', async () => {
    // A test device, so the ceremony can be driven from the list without a
    // claim — what is under test is the timeout, not the front door.
    asPairedTablet(KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS, [WALK_UP_ROW]);
    render(<Ceremony />);
    await settle();
    fireEvent.click(screen.getByTestId('start-check-in'));
    await settle();
    expect(screen.getByTestId(`pick-${WALK_UP_ROW.captureRequestId}`)).toBeTruthy();

    await advance(KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS);
    await settle();
    expect(screen.getByTestId('start-check-in')).toBeTruthy();

    // The list is gone with everything else.
    expect(document.body.textContent).not.toContain(WALK_UP_ROW.patientName);

    /*
     * AND NOT ONE CALL WENT OUT. There is no session to end on this path —
     * nothing was started server-side beyond a verification event, and that
     * event STANDS: it records an identity check that genuinely happened, and
     * retracting it because nobody finished the ceremony would be falsifying
     * the record.
     */
    expect(setTabletSessionState).not.toHaveBeenCalled();
    for (const mutator of AGREEMENT_MUTATORS) expect(mutator).not.toHaveBeenCalled();
  });
});

describe('activity_cancels_the_pending_reset', () => {
  it('a touch anywhere puts the clock back to the top, warning and all', async () => {
    await aPushedCeremony();

    // Into the warning.
    await advance(KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS - KIOSK_IDLE_WARNING_SECONDS);
    expect(screen.getByTestId('inactivity-warning')).toBeTruthy();

    /*
     * THE ANSWER TO "STILL THERE?" IS A TOUCH, not a button. The overlay has
     * none and never will: finding and pressing a control is work for somebody
     * who may be unwell and standing up, and touching the screen is what a
     * person at a tablet does anyway.
     */
    await act(async () => {
      fireEvent.pointerDown(window);
    });
    expect(screen.queryByTestId('inactivity-warning')).toBeNull();

    // AND THE WHOLE CLOCK RESTARTED, not just the warning. Past the original
    // deadline, the ceremony is still on screen.
    await advance(KIOSK_IDLE_WARNING_SECONDS + 5);
    expect(screen.getByTestId('check-details-heading')).toBeTruthy();
    expect(setTabletSessionState).not.toHaveBeenCalledWith(SESSION.id, 'timed_out');

    // A KEY COUNTS TOO — K-2 is used with a keyboard and nothing else for
    // whole minutes at a time.
    await advance(KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS - KIOSK_IDLE_WARNING_SECONDS - 10);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'a' });
    });
    await advance(KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS - 10);
    expect(screen.getByTestId('check-details-heading')).toBeTruthy();

    // Left alone from there, it still ends where it always did.
    await advance(20);
    await settle();
    expect(screen.getByTestId('start-check-in')).toBeTruthy();
  });

  it('the idle screen is not on a clock at all', async () => {
    /*
     * "Applies to every kiosk screen EXCEPT idle." It holds nothing about
     * anybody and is already where the reset sends the tablet, so a clock on
     * it would be a timer whose only job is to stay where it is — and a
     * warning overlay on an untouched idle screen would be a tablet asking an
     * empty room whether it is still there.
     */
    asPairedTablet();
    render(<Ceremony />);
    await settle();
    expect(screen.getByTestId('start-check-in')).toBeTruthy();

    await advance(KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS * 2);
    expect(screen.getByTestId('start-check-in')).toBeTruthy();
    expect(screen.queryByTestId('inactivity-warning')).toBeNull();
  });
});

describe('timeout_comes_from_the_practice_setting', () => {
  it('counts down the practice’s own number, not a constant in the tablet', async () => {
    // Two minutes, which is neither the default nor anything this file would
    // arrive at by accident.
    await aPushedCeremony(120);

    // Still there at the five-minute default's warning point, because five
    // minutes is not this practice's setting.
    await advance(89);
    expect(screen.queryByTestId('inactivity-warning')).toBeNull();

    // The warning lands thirty seconds before ITS deadline, at ninety.
    await advance(1);
    expect(screen.getByTestId('inactivity-warning')).toBeTruthy();

    await advance(KIOSK_IDLE_WARNING_SECONDS);
    await settle();
    expect(screen.getByTestId('start-check-in')).toBeTruthy();
    expect(setTabletSessionState).toHaveBeenCalledWith(SESSION.id, 'timed_out');
  });

  it('falls back to the default rather than to no clock when the server says nothing', async () => {
    /*
     * An older core that does not carry the field. FAIL CLOSED: the failure
     * mode of an absent setting must be a screen that clears itself, never one
     * that holds a patient's address until somebody notices.
     */
    await aPushedCeremony(undefined);

    await advance(KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS - 1);
    expect(screen.getByTestId('check-details-heading')).toBeTruthy();
    await advance(1);
    await settle();
    expect(screen.getByTestId('start-check-in')).toBeTruthy();
  });

  it('refuses a number outside the bounds and uses the default instead', async () => {
    // A server answering two seconds would make the ceremony uncompletable —
    // the screen would reset under somebody who is still reading — which is
    // hard rule 8 broken by a settings field. The tablet does not obey it.
    await aPushedCeremony(2);

    await advance(10);
    expect(screen.getByTestId('check-details-heading')).toBeTruthy();
    await advance(KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS);
    await settle();
    expect(screen.getByTestId('start-check-in')).toBeTruthy();
  });
});

describe('the reset clears a ceremony that had already got somewhere', () => {
  it('takes the ticks with it, so the next patient starts at the beginning', async () => {
    await aPushedCeremony();

    // Tick everything and read the agreement — the deepest a pushed ceremony
    // gets before the signature.
    await act(async () => {
      for (const type of CONFIRMABLE_DETAIL_TYPES) {
        fireEvent.click(screen.getByTestId(`detail-tick-${type}`));
      }
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('check-details-continue'));
    });
    await settle();
    expect(screen.getByTestId('particulars-heading')).toBeTruthy();

    await advance(KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS);
    await settle();
    expect(screen.getByTestId('start-check-in')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Riley Example');

    /*
     * AND THE SESSION WAS ENDED WITH `timed_out`, from K-3 exactly as it would
     * have been from K-P1 — the clock covers every screen of the ceremony, not
     * only its first.
     */
    expect(setTabletSessionState).toHaveBeenCalledWith(SESSION.id, 'timed_out');
  });
});
