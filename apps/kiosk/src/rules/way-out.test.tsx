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
 *   IT IS AN EXIT, NOT A SKIP — pressing it calls NOTHING. The api client is
 *   mocked in full and every mutating call is asserted to have zero calls, so
 *   an exit that quietly completed a capture request or transitioned an
 *   agreement would fail here rather than in production.
 */
import { render, fireEvent } from '@testing-library/react-native';
import { VerifyScreen } from '../screens/VerifyScreen';
import { AssignorScreen } from '../screens/AssignorScreen';
import { ParticularsScreen, type ParticularsView } from '../screens/ParticularsScreen';
import { SignatureScreen } from '../screens/SignatureScreen';
import { firstAttempt } from './verification';
import type { SignatureValidation } from './signature-gate';
import { strings } from '../strings';
import * as client from '../api/client';

jest.mock('../api/client');

/** Every call that could change what the server holds about an agreement. */
const MUTATORS = [
  'startChallenge',
  'attemptChallenge',
  'transitionAgreement',
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
  patientName: 'Jamie Sampleton',
  providerName: 'Dr Sample Provider',
  providerAddress: '2 Example Street, Sampletown NSW 2000',
  serviceDate: '2026-09-03',
  agreementDate: '2026-09-03',
  basicServiceDescription: 'General practitioner attendance',
  assignorIsPatient: true,
  assignorName: null,
  assignorRelationship: null,
  ruleSetVersion: 'draft-2026-08',
  mappingVersion: 'dev-mapping-1',
  artefactHash: 'b'.repeat(64),
};

const noop = () => undefined;
const CHROME = { practiceName: 'Sample Practice', locationLine: 'NSW' };

/** One entry per screen of the ceremony. Adding a screen without an exit fails here. */
function ceremonyScreens(onLeave: () => void) {
  return [
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
        onChange={noop}
        onContinue={noop}
        onRetry={noop}
        onSeeReception={onLeave}
      />,
    ],
    [
      'K-5 who is signing',
      <AssignorScreen
        {...CHROME}
        patientName="Jamie Sampleton"
        choice={{
          assignorIsPatient: true,
          otherName: '',
          otherRelationship: '',
          otherDeclaredOfAge: false,
        }}
        refusal={null}
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
        serverFailures={[]}
        staffEntryOpen={false}
        staffDescription=""
        busy={false}
        onOpenStaffEntry={noop}
        onChangeStaffDescription={noop}
        onRetryLock={noop}
        onContinue={noop}
        onSeeReception={onLeave}
      />,
    ],
    [
      'K-4 signature',
      <SignatureScreen
        {...CHROME}
        validation={VALID}
        strokesRef={{ current: [] }}
        inkPresent
        submitting={false}
        error={null}
        onInkChange={noop}
        onClear={noop}
        onSignDrawn={noop}
        onSignTap={noop}
        onSeeReception={onLeave}
      />,
    ],
  ] as const;
}

describe('REQ-REC-04 — nothing blocks care', () => {
  beforeEach(() => jest.clearAllMocks());

  it('a_way_out_on_every_ceremony_screen', async () => {
    for (const [name, element] of ceremonyScreens(noop)) {
      const screen = await render(element);
      const exit = screen.getByTestId('leave-for-reception');
      expect(exit.props.accessibilityLabel).toBe(strings.chrome.leaveAction);

      // 44px or more. It lives in the header, which is a SIBLING of the
      // content view rather than inside it, so no amount of content can push
      // it off screen or behind a scroller.
      const flattened = [exit.props.style].flat(Infinity).filter(Boolean) as Array<{ minHeight?: number }>;
      const minHeight = flattened.reduce<number>((found, entry) => entry?.minHeight ?? found, 0);
      expect({ screen: name, minHeight }).toEqual({ screen: name, minHeight: expect.any(Number) });
      expect(minHeight).toBeGreaterThanOrEqual(44);

      // AWAIT THE UNMOUNT. React Native Testing Library 14 wraps render and
      // unmount in act(); leaving one un-awaited overlaps the next screen's
      // act scope and React renders NOTHING for it — which shows up as "no
      // such testID" on a screen that draws the control perfectly well on its
      // own. Half an hour went into that.
      await screen.unmount();
    }
  });

  it('leaving_changes_no_agreement_state', async () => {
    const count = ceremonyScreens(noop).length;
    for (let i = 0; i < count; i += 1) {
      const onLeave = jest.fn();
      // Built fresh with this screen's own spy; each render is awaited and
      // unmounted before the next, or React's act scopes overlap and the next
      // screen renders nothing at all.
      const screen = await render(ceremonyScreens(onLeave)[i][1]);
      // fireEvent is async in RNTL 14 as well — same act-scope trap as unmount.
      await fireEvent.press(screen.getByTestId('leave-for-reception'));
      expect(onLeave).toHaveBeenCalledTimes(1);
      await screen.unmount();
    }

    // THE ASSERTION THAT MATTERS. The whole api client is mocked, so if any
    // exit had advanced an agreement, completed a capture request, or slipped
    // past verification or signing, one of these counts would not be zero.
    for (const name of MUTATORS) {
      expect(jest.mocked(client)[name]).toHaveBeenCalledTimes(0);
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
  });
});
