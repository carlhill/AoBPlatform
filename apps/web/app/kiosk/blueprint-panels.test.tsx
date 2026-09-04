/**
 * THE BLUEPRINT PANELS ARE FOR A TEST DEVICE (Carl, 4 September 2026, reading
 * the live K-2 on a tablet).
 *
 * The right-hand rail on the verification screen is headed "REQ-VER-02" and
 * explains, in our vocabulary, which identifiers the regulation permits. K-5's
 * pair say "Age gates" and "Not on this screen". K-3's says "Ready to sign"
 * and prints a SHA-256. Every one of them is true, useful and well written —
 * for a reviewer. On a screen a patient is standing at, a requirement id is a
 * developer's note somebody is being asked to read past.
 *
 * SO THEY RENDER WHERE THE WAITING LIST DOES, and nowhere else. The same
 * `showsWaitingList` flag, set from the console and never from the tablet,
 * already decides whether this device is a demonstration device or one a
 * practice uses. The panels are UNCHANGED on a test device — they earn their
 * place when Carl is showing somebody the rule being kept — and absent on an
 * ordinary one, where the content takes the width they were holding.
 *
 * WHAT MUST SURVIVE THE HIDING, and is the reason this is a test rather than a
 * one-line diff: on K-3 the rail carries the primary and Back as well as the
 * panel. Hiding the column would hide the way forward — a patient on an
 * ordinary tablet unable to reach the signature screen at all, which is hard
 * rule 8 broken by a cosmetic change (REQ-REC-04).
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { VerifyScreen } from './screens/VerifyScreen';
import { AssignorScreen } from './screens/AssignorScreen';
import { ParticularsScreen, type ParticularsView } from './screens/ParticularsScreen';
import { firstAttempt } from './rules/verification';
import { EMPTY_CHOICE } from './rules/assignor';
import type { SignatureValidation } from './rules/signature-gate';
import { strings } from './strings';

const noop = () => undefined;
const CHROME = { practiceName: 'Sample Practice', locationLine: 'NSW' };

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
  serviceDate: '2026-09-04',
  agreementDate: '2026-09-04',
  basicServiceDescription: 'General practitioner attendance',
  assignorIsPatient: true,
  assignorName: null,
  assignorRelationship: null,
  particularsLocked: false,
  ruleSetVersion: 'draft-2026-08',
  mappingVersion: 'dev-mapping-1',
  artefactHash: 'b'.repeat(64),
};

/** Each annotated screen, and the panel text that must not reach a patient. */
function annotatedScreens(blueprintPanels: boolean) {
  return [
    {
      name: 'K-2 verification',
      element: (
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
          blueprintPanels={blueprintPanels}
          onSeeReception={noop}
        />
      ),
      panelText: [strings.verify.annotationKicker, strings.verify.annotationBody],
    },
    {
      name: 'K-5 who is signing',
      element: (
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
          blueprintPanels={blueprintPanels}
          onSeeReception={noop}
        />
      ),
      panelText: [
        strings.assignor.railAgeKicker,
        strings.assignor.railAgeBody,
        strings.assignor.railAbsentKicker,
        strings.assignor.railAbsentBody,
      ],
    },
    {
      name: 'K-3 locked particulars',
      element: (
        <ParticularsScreen
          {...CHROME}
          view={VIEW}
          validation={VALID}
          onContinue={noop}
          onBack={noop}
          blueprintPanels={blueprintPanels}
          onSeeReception={noop}
        />
      ),
      panelText: [strings.particulars.validatedHeading, strings.particulars.validatedBody],
    },
  ] as const;
}

describe('blueprint_panels_only_on_test_devices', () => {
  it('an ordinary tablet shows no requirement id and no annotation panel', () => {
    for (const { name, element, panelText } of annotatedScreens(false)) {
      const view = render(element);
      for (const text of panelText) {
        expect({ screen: name, found: view.queryByText(text) }).toEqual({ screen: name, found: null });
      }
      /*
       * AND NOTHING SHAPED LIKE ONE EITHER. A requirement id is a recognisable
       * pattern — REQ-VER-02, REQ-REG-06 — and this catches a panel somebody
       * adds later without reading this file.
       */
      expect({ screen: name, ids: /REQ-[A-Z0-9]+-\d/.test(view.container.textContent ?? '') }).toEqual({
        screen: name,
        ids: false,
      });
      view.unmount();
    }
  });

  it('a test device shows them exactly as they were', () => {
    for (const { name, element, panelText } of annotatedScreens(true)) {
      const view = render(element);
      for (const text of panelText) {
        expect({ screen: name, found: view.queryByText(text) !== null }).toEqual({
          screen: name,
          found: true,
        });
      }
      view.unmount();
    }
    // The one requirement id Carl reads out when demonstrating the rule.
    const k2 = render(annotatedScreens(true)[0].element);
    expect(k2.getByText('REQ-VER-02')).toBeTruthy();
  });

  it('hiding the panel never hides the way forward', () => {
    /*
     * K-3's rail carries the primary and Back as well as the annotation, so
     * the naive fix — drop the column — would leave a patient on an ordinary
     * tablet unable to reach the signature screen at all. The actions are
     * composed once and placed in whichever column exists.
     */
    const onContinue = vi.fn();
    const onBack = vi.fn();
    const view = render(
      <ParticularsScreen
        {...CHROME}
        view={VIEW}
        validation={VALID}
        onContinue={onContinue}
        onBack={onBack}
        blueprintPanels={false}
        onSeeReception={noop}
      />,
    );

    expect(view.getByTestId('continue-to-sign')).toBeTruthy();
    expect(view.getByTestId('particulars-back')).toBeTruthy();
    // The document itself is untouched — the agreement is what the patient is
    // there to read, and none of it lived in the rail.
    expect(view.getByTestId('particulars-heading')).toBeTruthy();
    expect(view.getByTestId('versions')).toBeTruthy();
    expect(view.getByText(strings.particulars.tagNoProviderSignature)).toBeTruthy();
    // And the way out, which is on every screen in every state (REQ-REC-04).
    expect(view.getByTestId('leave-for-reception')).toBeTruthy();
  });

  it('an ordinary tablet is the default — a screen given no flag shows no panel', () => {
    /*
     * FAIL CLOSED, the same way `showsWaitingList` does. A caller that forgets
     * the prop must produce a PATIENT's screen, never a developer's: the
     * mistake that shows a requirement id to a waiting room has to be the one
     * somebody makes on purpose.
     */
    const view = render(
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
        onSeeReception={noop}
      />,
    );
    expect(view.queryByText(strings.verify.annotationKicker)).toBeNull();
  });
});
