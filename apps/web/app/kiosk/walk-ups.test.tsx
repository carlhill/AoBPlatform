/**
 * DOES THIS TABLET ACCEPT WALK-UPS? (Carl, 12 Sep 2026, looking at the kiosk
 * idle screen.)
 *
 * HIS WORDS: "this page, if the reception is pushing to the tablet (not kiosk
 * mode where the patient enters all their details) then it should not say
 * Begin (it will confuse the user/patient) as the user will press begin and it
 * will go to kiosk mode. It should say 'Please wait. Loading your details'".
 *
 * THE BUG IS NOT COSMETIC. Begin starts the WALK-UP path: three identifiers
 * typed by the patient, matched by the server. That is right for a tablet
 * sitting on a counter for anyone to pick up. On a tablet reception HANDS to a
 * named patient after pushing their agreement to it, the patient's details are
 * already known and already locked — so Begin asks them to type in what the
 * practice is holding, and the person who presses it ends up in the wrong flow
 * with the wrong screen in front of them.
 *
 * WHAT IS PINNED HERE:
 *
 *  1. `walk_up_tablet_off_never_renders_a_start_control` — the hard one. A
 *     tablet with the setting off has NOTHING on K-1 that starts the walk-up
 *     path: no Begin, no waiting-list row, nothing tappable at all. Asserted
 *     structurally (no button anywhere on the screen) rather than by naming
 *     the one testid we happen to know about today.
 *  2. `walk_ups_default_on_so_no_existing_tablet_changes` — absent from
 *     `/kiosk/me`, absent from the heartbeat, or a server too old to send
 *     either: the tablet still offers Begin. Turning walk-ups off is an act
 *     somebody performs, never a value a rollout leaves behind.
 *  3. `walk_ups_toggle_reaches_a_tablet_on_its_idle_screen` — Carl flips it on
 *     `/practice/devices` and the tablet already sitting on Begin changes on
 *     its next poll, both directions, with no re-pairing and no reload.
 *  4. `walk_ups_off_tablet_is_still_recoverable_by_reception` — hard rule 8.
 *     A tablet waiting for a push that never comes is not a dead end: the
 *     heartbeat keeps running, reception can still push to it, and Return to
 *     Begin lands it back on the waiting message rather than on nothing.
 *
 * Driven against the real `Ceremony` with `./api` mocked wholesale, and on the
 * fake clock from before the first render — the same shape as
 * `heartbeat.test.tsx`, for the same reasons its header gives.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { TabletSessionPayload } from '@aobplatform/domain';
import { Ceremony, RETURN_TO_BEGIN_HOLD_MS } from './Ceremony';
import { strings } from './strings';

const IDENTIFIER_TYPES = ['name', 'date_of_birth', 'address'];
const POLL_MS = 10_000;

const COMMAND = {
  id: '66666666-6666-4666-8666-666666666666',
  kind: 'return_to_begin' as const,
  issuedAt: '',
};

/** A push to the very tablet that does not accept walk-ups — the whole point of it. */
const SESSION: TabletSessionPayload = {
  id: '44444444-4444-4444-8444-444444444444',
  state: 'pushed',
  agreementType: 'episodic_pre',
  patient: {
    givenNames: 'Sam',
    familyName: 'Sampleton',
    dateOfBirth: '1979-11-02',
    address: '3 Example Street, Sampletown NSW 2000',
    mobile: '0400 111 111',
    email: 'sam@example.invalid',
  },
  assignor: { isPatient: true },
  patientId: 'b1f1f0a4-5f2d-4a4e-9b1a-2b6a7c8d9e01',
  detailsCheck: 'required',
  agreementId: 'ag-sam-pushed',
  captureRequestId: 'cr-sam-pushed',
};

const {
  sendKioskHeartbeat,
  fetchKioskMe,
  fetchWaitingList,
  fetchTabletSession,
  claimWaitingRow,
  setTabletSessionState,
} = vi.hoisted(() => ({
  sendKioskHeartbeat: vi.fn(),
  fetchKioskMe: vi.fn(),
  fetchWaitingList: vi.fn(),
  fetchTabletSession: vi.fn(),
  claimWaitingRow: vi.fn(),
  setTabletSessionState: vi.fn(),
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
  sendKioskHeartbeat,
  fetchKioskMe,
  fetchWaitingList,
  fetchPracticeStaffNames: vi.fn(async () => []),
  fetchTabletSession,
  claimWaitingRow,
  setTabletSessionState,
  confirmSessionDetails: vi.fn(),
  fetchAgreement: vi.fn(),
  startChallenge: vi.fn(),
  attemptChallenge: vi.fn(),
  transitionAgreement: vi.fn(),
  changeAssignor: vi.fn(),
  lockParticulars: vi.fn(),
  signAgreement: vi.fn(),
  completeCapture: vi.fn(),
}));

/**
 * A HEARTBEAT ANSWER. `acceptsWalkUps` is left OUT by default on purpose: that
 * is what a core too old to carry the field sends, and every test that does
 * not name the flag is therefore also a test that the old shape still works.
 */
function healthy(overrides: Record<string, unknown> = {}) {
  return { command: null, pollMs: POLL_MS, outOfUse: false, reload: false, ...overrides };
}

/**
 * A paired tablet. `me` takes the same treatment as `healthy` — pass
 * `acceptsWalkUps` to state it, leave it out to be an older server.
 */
function asPairedTablet(me: Record<string, unknown> = {}, beat: Record<string, unknown> = {}): void {
  sendKioskHeartbeat.mockResolvedValue(healthy(beat));
  fetchKioskMe.mockResolvedValue({
    deviceId: 'device-1',
    deviceLabel: 'Handed-over tablet',
    practiceId: 'practice-1',
    practiceName: 'Sample Practice',
    state: 'NSW',
    identifierTypes: IDENTIFIER_TYPES,
    showsWaitingList: false,
    reload: false,
    ...me,
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
      anyoneWaiting: true,
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
    sendKioskHeartbeat,
    fetchKioskMe,
    fetchWaitingList,
    fetchTabletSession,
    claimWaitingRow,
    setTabletSessionState,
  ]) {
    mock.mockReset();
  }
  fetchTabletSession.mockResolvedValue({ session: null });
  setTabletSessionState.mockResolvedValue({ id: SESSION.id, state: 'reading' });
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  COMMAND.issuedAt = new Date().toISOString();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('walk_up_tablet_off_never_renders_a_start_control', () => {
  it('shows Carl’s sentence and nothing that can be pressed', async () => {
    asPairedTablet({ acceptsWalkUps: false });
    render(<Ceremony />);
    await settle();

    expect(screen.getByTestId('idle-waiting-for-details').textContent).toBe(
      strings.idle.waitingForDetails,
    );
    expect(screen.queryByTestId('start-check-in')).toBeNull();
    // The heading Begin used to sit under is gone with it — a title promising
    // an agreement, over a screen that offers no way to reach one, is worse
    // than the button was.
    expect(document.body.textContent).not.toContain(strings.idle.heading);

    /*
     * STRUCTURAL, NOT BY TESTID. `start-check-in` is the control we know about
     * today; the rule is that there is no control at all, so the assertion is
     * on every button and link the screen renders. A future addition to K-1
     * fails here rather than quietly reopening the flow Carl closed.
     */
    expect(document.querySelectorAll('button, a[href], [role="button"]').length).toBe(0);
  });

  it('keeps the practice chrome — this is the same tablet, not a broken one', async () => {
    asPairedTablet({ acceptsWalkUps: false });
    render(<Ceremony />);
    await settle();

    expect(document.body.textContent).toContain('Sample Practice');
    expect(document.body.textContent).toContain('NSW');
  });

  it('says why when the platform cannot be reached, rather than waiting forever in silence', async () => {
    /*
     * A GENERIC WAITING MESSAGE OVER A DEAD SERVER IS A DEFECT (wow.md §2
     * item 5). "Loading your details" is true while the platform is answering;
     * while it is not, the reason belongs on the screen where somebody walking
     * past can read it. The waiting message stays — there is still nothing for
     * the patient to do — and the failure sits under it.
     */
    asPairedTablet({ acceptsWalkUps: false });
    fetchWaitingList.mockRejectedValue(new Error('network down'));
    render(<Ceremony />);
    await settle();

    expect(screen.getByTestId('idle-waiting-for-details')).toBeTruthy();
    expect(screen.getByTestId('idle-load-failed').textContent).toBe(strings.idle.loadFailed);
    expect(screen.queryByTestId('start-check-in')).toBeNull();
  });
});

describe('walk_ups_default_on_so_no_existing_tablet_changes', () => {
  it('a server that says nothing about walk-ups leaves Begin exactly where it was', async () => {
    // Neither `/kiosk/me` nor the heartbeat carries the field — the shape
    // every tablet in service saw before 12 Sep 2026.
    asPairedTablet();
    render(<Ceremony />);
    await settle();
    await advanceMs(POLL_MS);

    expect(screen.getByTestId('start-check-in')).toBeTruthy();
    expect(screen.queryByTestId('idle-waiting-for-details')).toBeNull();
  });

  it('an explicit true is the same as saying nothing', async () => {
    asPairedTablet({ acceptsWalkUps: true }, { acceptsWalkUps: true });
    render(<Ceremony />);
    await settle();

    expect(screen.getByTestId('start-check-in')).toBeTruthy();
  });
});

describe('walk_ups_toggle_reaches_a_tablet_on_its_idle_screen', () => {
  it('turns Begin off on the next poll, with no re-pairing and no reload', async () => {
    asPairedTablet({ acceptsWalkUps: true }, { acceptsWalkUps: true });
    render(<Ceremony />);
    await settle();
    expect(screen.getByTestId('start-check-in')).toBeTruthy();
    const identityReads = fetchKioskMe.mock.calls.length;

    // Carl unticks it on /practice/devices. The next heartbeat says so.
    sendKioskHeartbeat.mockResolvedValue(healthy({ acceptsWalkUps: false }));
    await advanceMs(POLL_MS);

    expect(screen.queryByTestId('start-check-in')).toBeNull();
    expect(screen.getByTestId('idle-waiting-for-details').textContent).toBe(
      strings.idle.waitingForDetails,
    );
    // `/kiosk/me` is a BOOT call and it was not made again: the change rode the
    // poll the tablet was already making. Nothing here re-paired or reloaded.
    expect(fetchKioskMe.mock.calls.length).toBe(identityReads);
  });

  it('turns Begin back on the same way', async () => {
    asPairedTablet({ acceptsWalkUps: false }, { acceptsWalkUps: false });
    render(<Ceremony />);
    await settle();
    expect(screen.getByTestId('idle-waiting-for-details')).toBeTruthy();

    sendKioskHeartbeat.mockResolvedValue(healthy({ acceptsWalkUps: true }));
    await advanceMs(POLL_MS);

    expect(screen.getByTestId('start-check-in')).toBeTruthy();
    expect(screen.queryByTestId('idle-waiting-for-details')).toBeNull();
  });

  it('a beat that does not carry the field leaves the boot answer standing', async () => {
    /*
     * "NOT TOLD" IS NOT "ON". A core too old to send the field must not flip a
     * tablet the console has deliberately quietened — that would be the tablet
     * inventing a setting from an absence.
     */
    asPairedTablet({ acceptsWalkUps: false });
    render(<Ceremony />);
    await settle();
    await advanceMs(POLL_MS);
    await advanceMs(POLL_MS);

    expect(screen.getByTestId('idle-waiting-for-details')).toBeTruthy();
    expect(screen.queryByTestId('start-check-in')).toBeNull();
  });
});

describe('walk_ups_off_tablet_is_still_recoverable_by_reception', () => {
  it('a push still takes the tablet over — the waiting message is what it is waiting FOR', async () => {
    asPairedTablet({ acceptsWalkUps: false }, { acceptsWalkUps: false });
    render(<Ceremony />);
    await settle();
    expect(screen.getByTestId('idle-waiting-for-details')).toBeTruthy();

    fetchTabletSession.mockResolvedValue({ session: SESSION });
    await advanceMs(POLL_MS);

    expect(screen.getByTestId('check-details-heading')).toBeTruthy();
    expect(screen.queryByTestId('idle-waiting-for-details')).toBeNull();
  });

  it('Return to Begin lands it back on the waiting message, not on nothing (hard rule 8)', async () => {
    asPairedTablet({ acceptsWalkUps: false }, { acceptsWalkUps: false });
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    render(<Ceremony />);
    await settle();
    expect(screen.getByTestId('check-details-heading')).toBeTruthy();

    // Reception presses Return to Begin: the session is recalled and the
    // command rides the same beat.
    fetchTabletSession.mockResolvedValue({ session: null });
    sendKioskHeartbeat.mockResolvedValue(healthy({ acceptsWalkUps: false, command: COMMAND }));
    await advanceMs(POLL_MS);
    expect(screen.getByTestId('handover-heading').textContent).toBe(strings.chrome.returnToBeginHeading);

    await advanceMs(RETURN_TO_BEGIN_HOLD_MS);
    expect(screen.getByTestId('idle-waiting-for-details')).toBeTruthy();
    // And the patient who was on it is not left on the screen behind.
    for (const trace of ['Sam Sampleton', '3 Example Street', '1979', '0400 111 111']) {
      expect(document.body.textContent).not.toContain(trace);
    }
  });

  it('the heartbeat keeps running, so the console can still see and reach this tablet', async () => {
    asPairedTablet({ acceptsWalkUps: false }, { acceptsWalkUps: false });
    render(<Ceremony />);
    await settle();
    const before = sendKioskHeartbeat.mock.calls.length;
    expect(before).toBeGreaterThan(0);

    await advanceMs(POLL_MS);
    await advanceMs(POLL_MS);
    expect(sendKioskHeartbeat.mock.calls.length).toBeGreaterThan(before);
    // A tablet that shows no controls is still telling the console where it is.
    const last = sendKioskHeartbeat.mock.calls[sendKioskHeartbeat.mock.calls.length - 1][0] as {
      screen: string;
    };
    expect(last.screen).toBe('begin');
  });
});
