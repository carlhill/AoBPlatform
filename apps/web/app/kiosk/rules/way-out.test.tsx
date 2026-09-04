/**
 * THE WAY OUT — REQ-REC-04 and hard rule 8, as a test rather than an intention.
 *
 * "The platform never blocks care." A tablet a patient cannot walk away from is
 * the purest form of blocking it: they are standing in a waiting room, holding
 * a device that will not let them go and ask a person a question. So every
 * screen of the ceremony carries an exit, and this file proves two things about
 * it that are easy to lose in a later refactor:
 *
 *   IT IS THERE, on all four screens, at 44px or more, without scrolling.
 *   IT IS AN EXIT, NOT A SKIP — pressing it calls NOTHING. The api module is
 *   mocked in full and every mutating call is asserted to have zero calls, so
 *   an exit that quietly completed a capture request or transitioned an
 *   agreement would fail here rather than in production.
 *
 * AND SO IS BACK (Carl, 3 Sep 2026 live test). Back is NAVIGATION — one step
 * up the ceremony — and the way out is a HAND-OVER; they are different things
 * and they look different. What they have in common is the property this file
 * exists to protect: neither of them may touch the agreement. Back is held to
 * the same zero-mutation assertion, and it is absent from K-4 the moment a
 * signature is in flight, because a control that looks like it could undo one
 * would be a lie about what this platform does.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { CheckDetailsScreen } from '../screens/CheckDetailsScreen';
import { VerifyScreen } from '../screens/VerifyScreen';
import { AssignorScreen } from '../screens/AssignorScreen';
import { ParticularsScreen, type ParticularsView } from '../screens/ParticularsScreen';
import { SignatureScreen } from '../screens/SignatureScreen';
import { firstAttempt } from './verification';
import { EMPTY_CHOICE } from './assignor';
import type { SignatureValidation } from './signature-gate';
import { strings } from '../strings';
import * as api from '../api';

vi.mock('../api');

/** Every call that could change what the server holds about an agreement. */
const MUTATORS = [
  'startChallenge',
  'attemptChallenge',
  'transitionAgreement',
  'changeAssignor',
  'lockParticulars',
  'signAgreement',
  'completeCapture',
] as const;

const VALID: SignatureValidation = {
  state: 'valid',
  artefactHash: 'b'.repeat(64),
  ruleSetVersion: 'draft-2026-08',
};

const VIEW: ParticularsView = {
  agreementType: 'episodic_pre',
  patientName: 'Jamie Sampleton',
  providerName: 'Dr Sample Provider',
  providerAddress: '2 Example Street, Sampletown NSW 2000',
  serviceDate: '2026-09-03',
  agreementDate: '2026-09-03',
  basicServiceDescription: 'General practitioner attendance',
  assignorIsPatient: true,
  assignorName: null,
  assignorRelationship: null,
  particularsLocked: false,
  ruleSetVersion: 'draft-2026-08',
  mappingVersion: 'dev-mapping-1',
  artefactHash: 'b'.repeat(64),
};

const noop = () => undefined;
const CHROME = {
  practiceName: 'Sample Practice',
  locationLine: 'NSW',
  // Only `SignatureScreen` reads this; harmless as an extra prop everywhere else.
  heading: strings.particulars.headingByAgreementType.episodic_pre,
};

/**
 * The rows K-P1 draws for a pushed session. Values a patient is being shown
 * about themselves, which is the one screen in the product where that is right
 * — and the exit still has to be on it (TODO.md "Two front doors").
 */
const DETAIL_ROWS = [
  { type: 'name', label: 'Name', value: 'Jamie Sampleton' },
  { type: 'date_of_birth', label: 'Date of birth', value: '4 August 1962' },
  { type: 'address', label: 'Address', value: '2 Example Street, Sampletown NSW 2000' },
] as const;

/** One entry per screen of the ceremony. Adding a screen without an exit fails here. */
function ceremonyScreens(onLeave: () => void): ReadonlyArray<readonly [string, ReactElement]> {
  return [
    [
      /*
       * K-P1, THE PUSHED CEREMONY'S FIRST SCREEN. It is in this list for the
       * same reason every other screen is: a patient holding a tablet must
       * always be able to ask a person instead. On the pushed path the exit
       * additionally posts `walked_away`, which ends the SESSION and changes
       * nothing on the agreement — asserted where it happens, in
       * `pushed-session.test.tsx`'s `walked_away_posts_state_and_changes_
       * nothing_else`. What is asserted HERE is what this file asserts about
       * every screen: the control exists, and the screen itself calls nothing.
       */
      'K-P1 check your details',
      <CheckDetailsScreen
        {...CHROME}
        agreementType="episodic_pre"
        rows={DETAIL_ROWS}
        ticked={new Set()}
        saving={false}
        saveError={false}
        onToggle={noop}
        onContinue={noop}
        onSeeReception={onLeave}
      />,
    ],
    [
      'K-2 verification',
      <VerifyScreen
        {...CHROME}
        fields={[{ type: 'name', label: 'Your full name' }]}
        stated={{}}
        state={firstAttempt()}
        busy={false}
        incomplete={false}
        startError={false}
        mismatch={false}
        onChange={noop}
        onContinue={noop}
        onSeeReception={onLeave}
      />,
    ],
    [
      'K-5 who is signing',
      <AssignorScreen
        {...CHROME}
        patientName="Jamie Sampleton"
        choice={EMPTY_CHOICE}
        guard={{ state: 'valid' }}
        saveError={false}
        saving={false}
        onChoose={noop}
        onChangeOther={noop}
        onContinue={noop}
        onSeeReception={onLeave}
      />,
    ],
    [
      'K-3 locked particulars',
      <ParticularsScreen
        {...CHROME}
        view={VIEW}
        validation={VALID}
        onContinue={noop}
        onBack={noop}
        onSeeReception={onLeave}
      />,
    ],
    [
      'K-4 signature',
      <SignatureScreen
        {...CHROME}
        validation={VALID}
        padRef={{ current: null }}
        inkPresent
        submitting={false}
        error={null}
        onInkChange={noop}
        onClear={noop}
        onSignDrawn={noop}
        onSignTap={noop}
        onBack={noop}
        onSeeReception={onLeave}
      />,
    ],
  ] as const;
}

describe('REQ-REC-04 — nothing blocks care', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a_way_out_on_every_ceremony_screen', () => {
    for (const [name, element] of ceremonyScreens(noop)) {
      const view = render(element);
      const exit = view.getByTestId('leave-for-reception');
      expect(exit.getAttribute('aria-label')).toBe(strings.chrome.leaveAction);
      /*
       * 44px OR MORE, asserted against the stylesheet rather than a computed
       * height, because jsdom does not lay anything out and `getBoundingClient
       * Rect` returns zeros regardless of the CSS. The class is the contract:
       * `.leave` in `kiosk.module.css` carries `min-height: 44px` and nothing
       * else on this device is smaller. The Playwright ceremony spec measures
       * the real thing in a real browser.
       */
      expect(exit.className).toContain('leave');
      // It lives in the header, which is a SIBLING of the scrolling content
      // rather than inside it, so no amount of content can push it off screen.
      expect(exit.closest('header')).not.toBeNull();
      expect(exit.closest('main')).toBeNull();
      expect({ screen: name, found: true }).toEqual({ screen: name, found: true });
      view.unmount();
    }
  });

  it('leaving_changes_no_agreement_state', () => {
    const count = ceremonyScreens(noop).length;
    for (let i = 0; i < count; i += 1) {
      const onLeave = vi.fn();
      const view = render(ceremonyScreens(onLeave)[i][1]);
      fireEvent.click(view.getByTestId('leave-for-reception'));
      expect(onLeave).toHaveBeenCalledTimes(1);
      view.unmount();
    }

    // THE ASSERTION THAT MATTERS. The whole api module is mocked, so if any
    // exit had advanced an agreement, completed a capture request, re-pointed
    // an assignor, or slipped past verification or signing, one of these counts
    // would not be zero.
    for (const name of MUTATORS) {
      expect(vi.mocked(api)[name]).toHaveBeenCalledTimes(0);
    }
  });

  it('the_exit_hands_over_and_promises_nothing', () => {
    // Plain about what happens next, and it does not claim a signature, a
    // refusal or a decline — a patient who asked a question has declined
    // nothing (REQ-REC-04; `declined` is a status with consequences).
    expect(strings.chrome.leaveBody).toMatch(/nothing has been signed/i);
    expect(strings.chrome.leaveBody).toMatch(/not affected/i);
    expect(`${strings.chrome.leaveAction} ${strings.chrome.leaveHeading} ${strings.chrome.leaveBody}`)
      .not.toMatch(/declin|refus|cancel|reject/i);

    /*
     * AND IT COVERS THE PUSHED PATH, which is the same words on a screen that
     * DOES call something — `POST /kiosk/session/:id/state { walked_away }`.
     * The distinction the copy has to keep true is that ending the screen is
     * not ending the agreement: the session releases the tablet so reception
     * can push the next patient, and the contract is untouched. So K-P1's own
     * copy points at reception and says the appointment is unaffected, and the
     * hand-over the patient lands on is the same one every other screen uses.
     */
    expect(strings.checkDetails.somethingWrong).toMatch(/see reception/i);
    expect(strings.checkDetails.somethingWrong).toMatch(/not affected/i);
    expect(strings.checkDetails.somethingWrong).not.toMatch(/declin|refus|cancel|reject/i);
    expect(strings.checkDetails.saveFailed).toMatch(/not affected/i);
  });

  it('back_is_navigation_and_changes_no_agreement_state', () => {
    /*
     * BACK EXISTS ON K-3 AND K-4 (Carl, 3 Sep 2026 live test), it is a
     * SECONDARY beside the primary rather than the header control, and — the
     * part worth a test — it calls nothing. A "Back" that quietly re-locked
     * particulars or re-pointed an assignor on the way past would be a
     * mutation wearing the word "back".
     */
    const onBackK3 = vi.fn();
    const k3 = render(
      <ParticularsScreen
        {...CHROME}
        view={VIEW}
        validation={VALID}
        onContinue={noop}
        onBack={onBackK3}
        onSeeReception={noop}
      />,
    );
    const backK3 = k3.getByTestId('particulars-back');
    expect(backK3.textContent).toBe(strings.chrome.backAction);
    // Not the way out, and not dressed as it: different control, different label.
    expect(backK3).not.toBe(k3.getByTestId('leave-for-reception'));
    fireEvent.click(backK3);
    expect(onBackK3).toHaveBeenCalledTimes(1);
    k3.unmount();

    const onBackK4 = vi.fn();
    const k4 = render(
      <SignatureScreen
        {...CHROME}
        validation={VALID}
        padRef={{ current: null }}
        inkPresent
        submitting={false}
        error={null}
        onInkChange={noop}
        onClear={noop}
        onSignDrawn={noop}
        onSignTap={noop}
        onBack={onBackK4}
        onSeeReception={noop}
      />,
    );
    fireEvent.click(k4.getByTestId('signature-back'));
    expect(onBackK4).toHaveBeenCalledTimes(1);
    k4.unmount();

    for (const name of MUTATORS) {
      expect(vi.mocked(api)[name]).toHaveBeenCalledTimes(0);
    }
  });

  it('back_is_withdrawn_once_a_signature_is_in_flight', () => {
    // Re-reading the particulars is a step somebody may want. Un-signing is not
    // a thing this platform does, so the control is gone rather than disabled —
    // there is nothing to explain, because there is nothing to offer.
    const view = render(
      <SignatureScreen
        {...CHROME}
        validation={VALID}
        padRef={{ current: null }}
        inkPresent
        submitting
        error={null}
        onInkChange={noop}
        onClear={noop}
        onSignDrawn={noop}
        onSignTap={noop}
        onBack={noop}
        onSeeReception={noop}
      />,
    );
    expect(view.queryByTestId('signature-back')).toBeNull();
    // The way out is still there — a patient may always ask for a person.
    expect(view.getByTestId('leave-for-reception')).toBeTruthy();
  });
});
