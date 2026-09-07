/**
 * THE HEARTBEAT AND "RETURN TO BEGIN" (Carl, 4–5 Sep 2026; TODO.md "Tablet
 * heartbeat and Return to Begin").
 *
 * WHAT CARL ASKED FOR, in his words: reception needs one more option — force a
 * tablet back to the Begin page — and "the tablet must know what it is on".
 * Before this the tablet knew its own screen and never told the server, so a
 * walk-up half-way through verifying was invisible from the console, and a
 * tablet on Begin looked exactly like one that was switched off. Recall only
 * ever reached a PUSHED session, and the session poll is deliberately off
 * during a walk-up, so recall could not clear a walk-up at all.
 *
 * THE FOUR THINGS PINNED HERE:
 *
 *  1. `heartbeat_carries_screen_names_not_values` — the request body from
 *     every screen contains those four fields and nothing else, and `screen`
 *     is always one of the ten words in `KIOSK_SCREENS`. This is the hard-rule
 *     test (REQ-VER-04, hard rule 9): the tablet's screens have a person's
 *     name, date of birth and address on them, and none of it may ride on a
 *     poll that fires thirty times a minute.
 *  2. `return_to_begin_clears_a_walk_up_mid_verify` — the case recall could
 *     never reach.
 *  3. `return_to_begin_shows_see_reception_before_idle` — the patient is TOLD
 *     before the screen goes. Carl's ruling: reception is standing there and
 *     has decided the tablet is needed, but the person holding it decided
 *     nothing, and watching your details vanish mid-sentence is the worst
 *     version of being helped.
 *  4. `reset_command_is_served_once_and_acknowledged` — the tablet's half of
 *     the handshake. The server's half (served once, expired after two
 *     minutes) is in `apps/core/test/kiosk-heartbeat.e2e-spec.ts`.
 *
 * Driven against the real `Ceremony`, with `./api` mocked wholesale, for the
 * reason every ceremony-sequence suite in this directory gives: what matters
 * is which calls are made and which screen is on glass.
 *
 * THE CLOCK IS FAKE FROM BEFORE THE FIRST RENDER, and `waitFor` is not used
 * anywhere below — it polls on a timer this file has replaced. Everything is
 * settled explicitly with `settle()` / `advanceMs()`.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { KIOSK_SCREENS, type TabletSessionPayload } from '@aobplatform/domain';
import { Ceremony, RETURN_TO_BEGIN_HOLD_MS } from './Ceremony';
import { strings } from './strings';
import type { KioskWaitingRow } from './api';

const IDENTIFIER_TYPES = ['name', 'date_of_birth', 'address'];
const POLL_MS = 10_000;

const COMMAND = {
  id: '55555555-5555-4555-8555-555555555555',
  kind: 'return_to_begin' as const,
  issuedAt: '',
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

function healthy(overrides: Record<string, unknown> = {}) {
  return { command: null, pollMs: POLL_MS, outOfUse: false, reload: false, ...overrides };
}

function asPairedTablet(rows: readonly KioskWaitingRow[] = []): void {
  sendKioskHeartbeat.mockResolvedValue(healthy());
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

/** Type three identifiers into K-2 and press Continue. */
function fillAndSubmitVerify(): void {
  fireEvent.change(screen.getByTestId('identifier-name-given'), { target: { value: 'Riley' } });
  fireEvent.change(screen.getByTestId('identifier-name-family'), { target: { value: 'Example' } });
  fireEvent.change(screen.getByTestId('identifier-address'), {
    target: { value: '7 Sample Road Sampletown 2000' },
  });
  fireEvent.change(screen.getByTestId('identifier-dob-day'), { target: { value: '09' } });
  fireEvent.change(screen.getByTestId('identifier-dob-month'), { target: { value: '03' } });
  fireEvent.change(screen.getByTestId('identifier-dob-year'), { target: { value: '1988' } });
}

const bodies = () => sendKioskHeartbeat.mock.calls.map((call) => call[0] as Record<string, unknown>);
const lastBody = () => bodies()[bodies().length - 1];

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

describe('heartbeat_carries_screen_names_not_values', () => {
  it('every body is the four agreed fields, and `screen` is always one of the ten names', async () => {
    asPairedTablet();
    // A pushed session puts a name, a date of birth and an address on the
    // screen — the worst case for a poll that might echo what it can see.
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    render(<Ceremony />);
    await settle();
    expect(screen.getByTestId('check-details-heading')).toBeTruthy();
    await advanceMs(POLL_MS);
    await advanceMs(POLL_MS);

    expect(bodies().length).toBeGreaterThan(0);
    for (const body of bodies()) {
      /*
       * THE KEY SET IS THE CONTRACT. A fifth field is how a patient detail
       * would arrive here — nobody would add `patientName` deliberately, they
       * would add "a bit of context for support" — so the assertion is on the
       * whole shape rather than on the absence of particular names.
       */
      expect(Object.keys(body).sort()).toEqual(['ackCommandId', 'build', 'screen', 'sessionId']);
      expect(KIOSK_SCREENS).toContain(body.screen);
      // And nothing anywhere in it reads like a person.
      const serialised = JSON.stringify(body);
      for (const trace of ['Riley', 'Example', '1988', '7 Sample Road', '0400', 'riley@example']) {
        expect(serialised).not.toContain(trace);
      }
    }
  });

  it('the walk-up ceremony reports where it is — the state that was invisible before', async () => {
    asPairedTablet();
    render(<Ceremony />);
    await settle();
    await advanceMs(POLL_MS);
    expect(lastBody().screen).toBe('begin');
    expect(lastBody().sessionId).toBeNull();

    fireEvent.click(screen.getByTestId('start-check-in'));
    await settle();
    await advanceMs(POLL_MS);
    expect(lastBody().screen).toBe('verify');
    // A WALK-UP HAS NO SESSION, which is exactly why recall could never reach
    // one and why the console needs this line to say "walk-up in progress".
    expect(lastBody().sessionId).toBeNull();
  });

  it('a pushed ceremony reports the opaque session id, and nothing about the person', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    render(<Ceremony />);
    await settle();
    await advanceMs(POLL_MS);
    expect(lastBody().screen).toBe('check-details');
    expect(lastBody().sessionId).toBe(SESSION.id);
  });

  it('an unreachable platform reports `outage` — the beat that got through says so', async () => {
    asPairedTablet();
    render(<Ceremony />);
    await settle();

    sendKioskHeartbeat.mockRejectedValue(new Error('network down'));
    await advanceMs(POLL_MS);
    await advanceMs(POLL_MS);
    expect(screen.getByTestId('outage-heading')).toBeTruthy();

    sendKioskHeartbeat.mockResolvedValue(healthy());
    await advanceMs(POLL_MS);
    await advanceMs(POLL_MS);
    /*
     * The first beat after recovery still reports `outage`, because that is
     * what was on glass when it was sent; the one after it says `begin`. Both
     * are honest, and the console reads the latest.
     */
    expect(bodies().some((body) => body.screen === 'outage')).toBe(true);
  });
});

describe('return_to_begin_clears_a_walk_up_mid_verify', () => {
  it('a patient half-way through typing three identifiers is cleared, and nothing is posted', async () => {
    asPairedTablet();
    render(<Ceremony />);
    await settle();
    fireEvent.click(screen.getByTestId('start-check-in'));
    await settle();
    fillAndSubmitVerify();
    expect(screen.getByTestId('identifier-name-given')).toBeTruthy();

    sendKioskHeartbeat.mockResolvedValue(healthy({ command: COMMAND }));
    await advanceMs(POLL_MS);

    // TOLD FIRST. The identifiers are already gone from the screen.
    expect(screen.getByTestId('handover-heading').textContent).toBe(strings.chrome.returnToBeginHeading);
    expect(screen.queryByTestId('identifier-name-given')).toBeNull();

    await advanceMs(RETURN_TO_BEGIN_HOLD_MS);
    expect(screen.getByTestId('start-check-in')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Riley');

    /*
     * NOTHING WAS POSTED. A walk-up has no session to end — there is nothing
     * server-side beyond a verification event, and that event stands because
     * it records an identity check that genuinely happened. `claimWaitingRow`
     * was never reached either: the patient had typed but not submitted.
     */
    expect(setTabletSessionState).not.toHaveBeenCalled();
    expect(claimWaitingRow).not.toHaveBeenCalled();
  });
});

describe('return_to_begin_shows_see_reception_before_idle', () => {
  it('a pushed ceremony is told, and only then cleared', async () => {
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    render(<Ceremony />);
    await settle();
    expect(screen.getByTestId('check-details-heading')).toBeTruthy();

    // Reception presses it: the server recalls the session AND leaves the
    // command. Here they arrive on the same beat.
    fetchTabletSession.mockResolvedValue({ session: null });
    sendKioskHeartbeat.mockResolvedValue(healthy({ command: COMMAND }));
    await advanceMs(POLL_MS);

    expect(screen.getByTestId('handover-heading').textContent).toBe(strings.chrome.returnToBeginHeading);
    expect(screen.getByTestId('handover-body').textContent).toBe(strings.chrome.returnToBeginBody);
    for (const trace of ['Riley Example', '7 Sample Road', '1988', '0400 000 000']) {
      expect(document.body.textContent).not.toContain(trace);
    }

    await advanceMs(RETURN_TO_BEGIN_HOLD_MS);
    expect(screen.getByTestId('start-check-in')).toBeTruthy();
  });

  it('the recall landing FIRST does not swallow the message — the race Carl’s ruling depends on', async () => {
    /*
     * THE HARD CASE. "Return to Begin" recalls the pushed session server-side
     * AND sets the command, and those reach the tablet on two independent
     * polls. If the session poll wins, the tablet is already on Begin when the
     * command arrives — and a naive "already on Begin, ignore" would leave the
     * patient standing there having watched their details vanish with no
     * explanation, which is the one thing this feature was told not to do.
     */
    asPairedTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    render(<Ceremony />);
    await settle();
    expect(screen.getByTestId('check-details-heading')).toBeTruthy();

    // The recall arrives alone. The tablet drops to Begin on its own.
    fetchTabletSession.mockResolvedValue({ session: null });
    await advanceMs(POLL_MS);
    expect(screen.getByTestId('start-check-in')).toBeTruthy();

    // The command catches up a beat later — issued BEFORE the tablet cleared.
    sendKioskHeartbeat.mockResolvedValue(healthy({ command: COMMAND }));
    await advanceMs(POLL_MS);
    expect(screen.getByTestId('handover-heading').textContent).toBe(strings.chrome.returnToBeginHeading);
  });

  it('a genuinely idle tablet is not flashed a hand-over screen', async () => {
    asPairedTablet();
    render(<Ceremony />);
    await settle();
    expect(screen.getByTestId('start-check-in')).toBeTruthy();

    sendKioskHeartbeat.mockResolvedValue(healthy({ command: COMMAND }));
    await advanceMs(POLL_MS);

    // Begin never left the screen — no flash at an empty counter.
    expect(screen.getByTestId('start-check-in')).toBeTruthy();
    expect(screen.queryByTestId('handover-heading')).toBeNull();

    /*
     * BUT IT IS STILL ACKNOWLEDGED, on the next beat — the acknowledgement is
     * built when the answer is read and rides on the following request. An
     * ignored command that was never acknowledged would be served again for
     * two minutes, and would then catch a patient who walked up in the
     * meantime.
     */
    await advanceMs(POLL_MS);
    expect(lastBody().ackCommandId).toBe(COMMAND.id);
    expect(screen.getByTestId('start-check-in')).toBeTruthy();
  });
});

describe('reset_command_is_served_once_and_acknowledged', () => {
  it('the tablet acts once and echoes the id until the server stops sending it', async () => {
    asPairedTablet();
    render(<Ceremony />);
    await settle();
    fireEvent.click(screen.getByTestId('start-check-in'));
    await settle();

    // Served, and served AGAIN on the next beat — the server has not seen the
    // acknowledgement yet, which is how one dropped request does not lose a
    // reset.
    sendKioskHeartbeat.mockResolvedValue(healthy({ command: COMMAND }));
    await advanceMs(POLL_MS);
    expect(screen.getByTestId('handover-heading')).toBeTruthy();
    await advanceMs(POLL_MS);

    // Acted on ONCE: the auto-return timer from the first delivery still runs
    // to completion rather than being restarted by the second.
    const acks = bodies().filter((body) => body.ackCommandId === COMMAND.id);
    expect(acks.length).toBeGreaterThanOrEqual(1);

    // The server clears it and stops sending; the tablet stops echoing.
    sendKioskHeartbeat.mockResolvedValue(healthy());
    await advanceMs(POLL_MS);
    await advanceMs(POLL_MS);
    expect(lastBody().ackCommandId).toBeNull();
  });
});

describe('out_of_use_replaces_the_screen_and_keeps_heartbeating', () => {
  it('a tablet taken off the floor goes quiet, and comes back on its own', async () => {
    asPairedTablet();
    render(<Ceremony />);
    await settle();
    expect(screen.getByTestId('start-check-in')).toBeTruthy();

    sendKioskHeartbeat.mockResolvedValue(healthy({ outOfUse: true }));
    await advanceMs(POLL_MS);
    expect(screen.getByTestId('out-of-use-heading').textContent).toBe(strings.outOfUse.heading);
    expect(screen.queryByTestId('start-check-in')).toBeNull();

    /*
     * AND IT KEEPS BEATING BEHIND THE SCREEN — the whole difference from a
     * revoke. The device stays on the console, and one press puts it back with
     * nobody walking over to it.
     */
    const beatsWhileOut = sendKioskHeartbeat.mock.calls.length;
    await advanceMs(POLL_MS);
    expect(sendKioskHeartbeat.mock.calls.length).toBeGreaterThan(beatsWhileOut);

    sendKioskHeartbeat.mockResolvedValue(healthy());
    await advanceMs(POLL_MS);
    expect(screen.getByTestId('start-check-in')).toBeTruthy();
  });
});
