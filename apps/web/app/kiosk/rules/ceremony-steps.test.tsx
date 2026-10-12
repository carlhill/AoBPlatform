/**
 * THE STEP CHIP TELLS THE TRUTH ABOUT THE ROUTE THE PATIENT IS ACTUALLY ON
 * (Carl, 27 September 2026, from a live tablet).
 *
 * THE DEFECT, IN HIS WORDS: "Currently the kiosk starts at step3 and not step1.
 * The back button on step3 takes me to step1. Completing step1 and takes me to
 * step3. There is no step2."
 *
 * NOTHING WAS BEING SKIPPED. He was on the pushed ceremony — K-P1, K-3, K-4,
 * three screens — and every screen was hardcoding its own numbers, written for
 * the one route that has four. K-P1 said "Step 1 of 3", K-3 said "Step 3 of 4"
 * and K-4 said "Step 4 of 4", so a three-step ceremony announced a total that
 * changed under the patient, skipped a number, and invited exactly the reading
 * Carl gave it: that the device had dropped him into the middle of something.
 *
 * WHY IT IS WORTH A TEST FILE RATHER THAN FIVE CORRECTED LITERALS. A literal is
 * right for one route and silently wrong for the other two, and the routes are
 * decided in `Ceremony.tsx`, not on the screens. So the sequence is derived
 * once, from the two facts that decide it, and these are the three routes as a
 * table. A fourth route added later without a line here will show a chip that
 * lies again, which is what the module's doc comment says to do about it.
 *
 * THE UNIT TESTS ARE THE TABLE; THE CEREMONY TESTS ARE THE PROOF. The pure
 * functions cannot tell you that `Ceremony.tsx` passes the numbers to all five
 * screens, and the defect Carl saw was on a screen. So each route is also
 * driven through the real component and the chip is read off the header, which
 * is the only assertion that would have failed before this change.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CONFIRMABLE_DETAIL_TYPES, type TabletSessionPayload } from '@aobplatform/domain';
import { Ceremony } from '../Ceremony';
import { strings } from '../strings';
import type { KioskWaitingRow } from '../api';
import { ceremonySequence, stepNumber } from './ceremony-steps';

describe('ceremony_sequence — the steps a route will actually run', () => {
  it('walk_up_with_open_particulars_runs_all_four_steps', () => {
    /*
     * ROUTE 1, AND THE ONLY ONE THE OLD LITERALS DESCRIBED. Verification, who
     * is signing, the agreement, the pen.
     */
    expect(ceremonySequence({ pushed: false, particularsLockedAtVerification: false })).toEqual([
      'verify',
      'assignor',
      'particulars',
      'signature',
    ]);
  });

  it('walk_up_with_locked_particulars_runs_three_because_k5_is_skipped', () => {
    /*
     * ROUTE 2. Who signs is one of the locked particulars, so there is nothing
     * to choose and `Ceremony.tsx` goes from verification straight to K-3
     * (`k5_is_skipped_when_particulars_are_locked`). The chip has to agree with
     * that: three steps, and K-3 is the second of them rather than the third of
     * four.
     */
    expect(ceremonySequence({ pushed: false, particularsLockedAtVerification: true })).toEqual([
      'verify',
      'particulars',
      'signature',
    ]);
  });

  it('a_pushed_ceremony_counts_its_own_three_steps_and_never_announces_four', () => {
    /*
     * ROUTE 3 — THE ONE CARL HIT. No verification form and no K-5: reception
     * checked across the desk and the particulars were locked before the push.
     * Three screens, numbered one to three, and four is not a number this route
     * is allowed to say.
     */
    const sequence = ceremonySequence({ pushed: true, particularsLockedAtVerification: true });
    expect(sequence).toEqual(['check-details', 'particulars', 'signature']);
    for (const step of sequence) expect(stepNumber(step, sequence)?.total).toBe(3);
  });

  it('a_push_is_the_route_whatever_the_lock_says', () => {
    /*
     * A PUSH IS ALWAYS THE PUSHED ROUTE. The server locks before any device
     * sees the payload, so `particularsLockedAtVerification` is not a fact
     * about this route at all — and an unlocked agreement arriving on a pushed
     * path is a fault the ceremony hands over on, never a fourth route with a
     * different chip.
     */
    expect(ceremonySequence({ pushed: true, particularsLockedAtVerification: false })).toEqual(
      ceremonySequence({ pushed: true, particularsLockedAtVerification: true }),
    );
  });

  it('a_push_whose_details_were_confirmed_earlier_today_runs_two_steps_and_starts_at_one', () => {
    /*
     * ROUTE 4 — AND IT WAS ALREADY THERE WHEN THIS FILE WAS WRITTEN (Carl,
     * 27 September 2026, from a live tablet: "never goes to step 1").
     *
     * THE SERVER SKIPS K-P1 FOR A PATIENT WHO ALREADY TICKED TODAY — its own
     * ruling of 11 September, matched on the PATIENT rather than the agreement
     * because the case it exists for is a second agreement for the same visit
     * (`tablet-sessions.service.ts`, `detailsCheck: 'confirmed_today'`). So the
     * ceremony is two screens: the particulars, then the pen.
     *
     * COUNTING IT AS THE THREE-STEP PUSH IS THE ORIGINAL DEFECT WEARING A
     * DIFFERENT NUMBER. The patient opens on "Step 2 of 3" and there is no step
     * one, which is precisely what Carl reported and precisely what this
     * module's own doc comment warned would happen to a route it had not been
     * told about.
     */
    const sequence = ceremonySequence({
      pushed: true,
      particularsLockedAtVerification: true,
      detailsAlreadyConfirmed: true,
    });
    expect(sequence).toEqual(['particulars', 'signature']);
    expect(stepNumber('particulars', sequence)).toEqual({ position: 1, total: 2 });
    expect(stepNumber('signature', sequence)).toEqual({ position: 2, total: 2 });
    // The screen the route does not run is not a step of it.
    expect(stepNumber('check-details', sequence)).toBeNull();
  });
});

describe('step_number — where the patient is, and where there is no such thing', () => {
  it('numbers each step by its place in the sequence it belongs to', () => {
    const walkUp = ceremonySequence({ pushed: false, particularsLockedAtVerification: false });
    expect(stepNumber('verify', walkUp)).toEqual({ position: 1, total: 4 });
    expect(stepNumber('assignor', walkUp)).toEqual({ position: 2, total: 4 });
    expect(stepNumber('particulars', walkUp)).toEqual({ position: 3, total: 4 });
    expect(stepNumber('signature', walkUp)).toEqual({ position: 4, total: 4 });
  });

  it('the_same_screen_is_numbered_differently_on_a_different_route', () => {
    /*
     * K-3 IS THE THIRD OF FOUR, THE SECOND OF THREE, OR THE SECOND OF THREE
     * AGAIN, depending only on how the patient got there. This is the whole
     * reason a screen cannot number itself.
     */
    const locked = ceremonySequence({ pushed: false, particularsLockedAtVerification: true });
    const pushed = ceremonySequence({ pushed: true, particularsLockedAtVerification: true });
    expect(stepNumber('particulars', locked)).toEqual({ position: 2, total: 3 });
    expect(stepNumber('particulars', pushed)).toEqual({ position: 2, total: 3 });
    expect(stepNumber('signature', pushed)).toEqual({ position: 3, total: 3 });
  });

  it('a_step_outside_the_numbered_ceremony_has_no_number', () => {
    /*
     * BOOTING, PAIRING, THE LIST, THE THANK-YOU, THE HAND-OVER AND THE OUTAGE
     * ARE NOT STEPS OF THE CEREMONY and must not be given a chip that implies
     * they are. `null` rather than a position, so a screen that is handed one
     * of these draws no chip at all — K-6 already heads itself with
     * `strings.chrome.complete`, which is a word rather than a number.
     */
    const walkUp = ceremonySequence({ pushed: false, particularsLockedAtVerification: false });
    for (const step of ['booting', 'pairing', 'unpaired', 'idle', 'list', 'complete', 'handover']) {
      expect(stepNumber(step, walkUp)).toBeNull();
    }
    // And a step that is real but not on THIS route: K-5 never runs on a push.
    const pushed = ceremonySequence({ pushed: true, particularsLockedAtVerification: true });
    expect(stepNumber('assignor', pushed)).toBeNull();
    expect(stepNumber('verify', pushed)).toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * The same three routes, driven through the real `Ceremony`, reading the chip
 * off the header. `./api` is mocked wholesale for the reason
 * `walk-up-claim.test.tsx` gives: what matters is which screen the ceremony
 * lands on, not what any one endpoint returns over a wire.
 * ---------------------------------------------------------------------- */

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
  status: 'awaiting_signature',
  patientId: RILEY.patientId,
  assignorId: 'as-1',
  assignorIsPatient: true,
  particulars: { patientName: RILEY.patientName, serviceDate: '2026-09-04' },
  ruleSetVersion: '2026.07.01',
  mappingVersion: '2026.07.01',
  renderedArtefactHash: 'a'.repeat(64),
};

const LOCKED = { ...AGREEMENT, particularsLockedAt: '2026-09-04T08:30:00.000Z' };
const UNLOCKED = { ...AGREEMENT, particularsLockedAt: null };

/** The pushed patient. Obviously fake, and carrying no Medicare number (hard rule 1). */
const SESSION: TabletSessionPayload = {
  id: '11111111-1111-4111-8111-111111111111',
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
  patientId: 'e609b40e-63aa-56e1-8f5b-2e9bc5aa5133',
  detailsCheck: 'required',
  agreementId: RILEY.agreementId,
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

vi.mock('../pairing', () => ({
  PAIRING_CREDENTIAL_KEY: 'aob.kiosk.pairing',
  PERSISTABLE_KEYS: ['aob.kiosk.pairing'],
  readPairingCredential: () => 'fake-device-credential',
  writePairingCredential: () => true,
  clearPairingCredential: vi.fn(),
}));

vi.mock('../api', () => ({
  /*
   * THE HEARTBEAT, STUBBED HEALTHY. It runs on every screen of the ceremony,
   * and two consecutive failures would replace the screen under the test with
   * the outage screen — which is `outage.test.tsx`'s subject and nobody else's.
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
  fetchCopyOffer: vi.fn(async () => ({ channels: [], declineKey: 'not_now', version: 'test-copy-1' })),
  requestCopy: vi.fn(async () => ({ channel: 'email', queued: true })),
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

/** An ordinary tablet: no list, no rows, Begin opens K-2. */
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
      waiting: [],
      hidden: true,
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

/** Tick every row K-P1 drew, in the order the domain lists them. */
function tickEverything(): void {
  for (const type of CONFIRMABLE_DETAIL_TYPES) {
    fireEvent.click(screen.getByTestId(`detail-tick-${type}`));
  }
}

/** The chip, exactly as the header draws it. */
const chip = (position: number, total: number) => strings.chrome.stepOf(position, total);

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

describe('the chip counts the route the patient is on', () => {
  it('a_pushed_ceremony_counts_its_own_three_steps_and_never_announces_four', async () => {
    /*
     * THE REPORTED BUG, END TO END. Before this change the first screen Carl
     * saw said "Step 1 of 3", the next said "Step 3 of 4" and the pen said
     * "Step 4 of 4" — hence "there is no step2" and "it starts at step3".
     */
    asWalkUpTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(LOCKED);

    render(<Ceremony />);

    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
    expect(screen.getByText(chip(1, 3))).toBeTruthy();

    tickEverything();
    fireEvent.click(screen.getByTestId('check-details-continue'));

    await waitFor(() => expect(screen.getByTestId('continue-to-sign')).toBeTruthy());
    // THE LINE THE DEFECT WAS ON. K-3 is the second of three here, not the
    // third of four, and "of 4" is not a thing this route may say at all.
    expect(screen.getByText(chip(2, 3))).toBeTruthy();
    expect(screen.queryByText(chip(3, 4))).toBeNull();

    fireEvent.click(screen.getByTestId('continue-to-sign'));
    await waitFor(() => expect(screen.getByTestId('sign-control-tap')).toBeTruthy());
    expect(screen.getByText(chip(3, 3))).toBeTruthy();
    expect(screen.queryByText(chip(4, 4))).toBeNull();
  });

  it('a_walk_up_with_locked_particulars_forecasts_four_at_k2_then_narrows_to_three', async () => {
    /*
     * THE ONE PLACE THE COUNT IS A FORECAST, and it is asserted rather than
     * tolerated. Standing on K-2 the tablet has not read the agreement and
     * cannot know whether K-5 will run, so it counts the ordinary walk-up —
     * four — and narrows to three the moment verification tells it K-5 is
     * skipped. What matters is that the POSITIONS still run 1, 2, 3: no
     * number is skipped and none is repeated, which is the defect this file
     * exists for. The alternative is no chip at all on the first screen of
     * the ceremony, to avoid a number that was true when it was drawn.
     */
    asWalkUpTablet();
    claimWaitingRow.mockResolvedValueOnce({ outcome: 'passed', verificationEventId: 've-1', row: RILEY });
    fetchAgreement.mockResolvedValue(LOCKED);

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('start-check-in')).toBeTruthy());
    fireEvent.click(screen.getByTestId('start-check-in'));
    await waitFor(() => expect(screen.getByTestId('identifier-name-given')).toBeTruthy());

    // K-2 KEEPS ITS OWN SUFFIX. The chip names the step as well as counting it.
    expect(screen.getByText(`${chip(1, 4)} — ${strings.chrome.stepDetails}`)).toBeTruthy();

    fillAndSubmitVerify();
    await waitFor(() => expect(screen.getByTestId('particulars-heading')).toBeTruthy());
    // THE SECOND STEP, NOT THE THIRD. K-5 was skipped, and the chip no longer
    // reports the patient as having passed a screen they never saw.
    expect(screen.getByText(chip(2, 3))).toBeTruthy();
    expect(screen.queryByText(chip(3, 4))).toBeNull();

    fireEvent.click(screen.getByTestId('continue-to-sign'));
    await waitFor(() => expect(screen.getByTestId('sign-control-tap')).toBeTruthy());
    expect(screen.getByText(chip(3, 3))).toBeTruthy();
  });

  it('a_walk_up_with_open_particulars_counts_four_and_the_total_does_not_change_when_k3_locks', async () => {
    /*
     * THE TRAP IN DERIVING THIS FROM THE LIVE LOCK FLAG. On this route the
     * particulars are locked BY K-3, as the patient stands there
     * (`runLock`/the auto-lock effect). A sequence recomputed from
     * `agreement.particularsLockedAt` would therefore start this screen at
     * "Step 3 of 4" and rewrite it to "Step 2 of 3" a round trip later, in
     * front of somebody who had not moved. The route is settled once, when
     * verification passes and the ceremony chooses whether K-5 runs.
     */
    asWalkUpTablet();
    claimWaitingRow.mockResolvedValueOnce({ outcome: 'passed', verificationEventId: 've-1', row: RILEY });
    fetchAgreement.mockResolvedValue(UNLOCKED);
    lockParticulars.mockResolvedValue(LOCKED);

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('start-check-in')).toBeTruthy());
    fireEvent.click(screen.getByTestId('start-check-in'));
    await waitFor(() => expect(screen.getByTestId('identifier-name-given')).toBeTruthy());
    expect(screen.getByText(`${chip(1, 4)} — ${strings.chrome.stepDetails}`)).toBeTruthy();

    fillAndSubmitVerify();
    await waitFor(() => expect(screen.getByTestId('assignor-self')).toBeTruthy());
    expect(screen.getByText(`${chip(2, 4)} — ${strings.chrome.stepSigning}`)).toBeTruthy();

    fireEvent.click(screen.getByTestId('assignor-self'));
    await waitFor(() => expect(screen.getByTestId('particulars-heading')).toBeTruthy());
    expect(screen.getByText(chip(3, 4))).toBeTruthy();

    // The lock lands while the patient is reading. The chip must not move.
    await waitFor(() => expect(lockParticulars).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('continue-to-sign')).toBeTruthy());
    expect(screen.getByText(chip(3, 4))).toBeTruthy();
    expect(screen.queryByText(chip(2, 3))).toBeNull();

    fireEvent.click(screen.getByTestId('continue-to-sign'));
    await waitFor(() => expect(screen.getByTestId('sign-control-tap')).toBeTruthy());
    expect(screen.getByText(chip(4, 4))).toBeTruthy();
  });

  it('the_thank_you_screen_is_still_a_word_rather_than_a_number', async () => {
    /*
     * K-6 IS NOT A STEP OF THE CEREMONY and was never numbered; it heads itself
     * with `strings.chrome.complete`. Asserted here because deriving the
     * sequence is exactly the change that would tempt somebody to give it a
     * position, and "Step 4 of 3" is the shape that mistake takes.
     */
    asWalkUpTablet();
    fetchTabletSession.mockResolvedValue({ session: SESSION });
    fetchAgreement.mockResolvedValue(LOCKED);
    signAgreement.mockResolvedValue(LOCKED);
    completeCapture.mockResolvedValue({});

    render(<Ceremony />);
    await waitFor(() => expect(screen.getByTestId('check-details-heading')).toBeTruthy());
    tickEverything();
    fireEvent.click(screen.getByTestId('check-details-continue'));
    await waitFor(() => expect(screen.getByTestId('continue-to-sign')).toBeTruthy());
    fireEvent.click(screen.getByTestId('continue-to-sign'));
    await waitFor(() => expect(screen.getByTestId('sign-control-tap')).toBeTruthy());
    fireEvent.click(screen.getByTestId('sign-control-tap'));

    await waitFor(() => expect(screen.getByTestId('complete-heading')).toBeTruthy());
    expect(screen.getByText(strings.chrome.complete)).toBeTruthy();
    for (const total of [3, 4]) {
      for (let position = 1; position <= total; position += 1) {
        expect(screen.queryByText(chip(position, total))).toBeNull();
      }
    }
  });
});
