/**
 * THE THREE THINGS CARL FOUND ON A LIVE TABLET, as tests.
 *
 * Each of these was a defect you could only see by standing at the device:
 * they all passed a code read, and all three cost the person in front of the
 * screen something. They are named after the behaviour rather than the bug, so
 * the names still make sense once nobody remembers the bug.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { VerifyScreen } from '../screens/VerifyScreen';
import { ParticularsScreen, type ParticularsView } from '../screens/ParticularsScreen';
import { identifierFieldsFor } from './identifiers';
import { afterAttempt, firstAttempt, KIOSK_MAX_ATTEMPTS, retryAfterMismatch } from './verification';
import type { SignatureValidation } from './signature-gate';
import { strings } from '../strings';

const CHROME = { practiceName: 'Sample Practice', locationLine: 'NSW' };
const noop = () => undefined;
const FIELDS = identifierFieldsFor(['name', 'date_of_birth', 'address']);

/**
 * A thin stand-in for the ceremony: it holds `stated` the way `Ceremony.tsx`
 * does, so the address box — a plain field whose value IS the ceremony's state
 * — behaves here as it does in the app rather than typing into the void.
 */
function renderVerify(props: { mismatch: boolean; attempt: number }) {
  let stated: Record<string, string> = {};
  const view = render(
    <VerifyScreen
      {...CHROME}
      fields={FIELDS}
      stated={stated}
      state={{ kind: 'asking', attempt: props.attempt }}
      busy={false}
      incomplete={false}
      startError={false}
      mismatch={props.mismatch}
      onChange={(type, value) => {
        stated = { ...stated, [type]: value };
        view.rerender(
          <VerifyScreen
            {...CHROME}
            fields={FIELDS}
            stated={stated}
            state={{ kind: 'asking', attempt: props.attempt }}
            busy={false}
            incomplete={false}
            startError={false}
            mismatch={props.mismatch}
            onChange={() => undefined}
            onContinue={noop}
            onSeeReception={noop}
          />,
        );
      }}
      onContinue={noop}
      onSeeReception={noop}
    />,
  );
  return view;
}

describe('K-2 — a mismatch does not move the screen', () => {
  it('mismatch_keeps_entered_values_on_screen', () => {
    /*
     * THE DEFECT THIS REPLACES. "Some details don't match" navigated to a
     * separate screen whose only action, "Try again", came back to an EMPTY
     * form. One mistyped letter of an address therefore cost all three
     * identifiers — and the copy is not allowed to say which one was wrong
     * (REQ-SEC-07), so the patient could not even know which to concentrate
     * on. Retyping everything is also the surest way to spend the second
     * attempt and the third.
     *
     * The mismatch is now inline, the form is not remounted, and everything
     * typed is still there. Held in component state and nowhere else: the
     * zero-footprint rule is about persistence, and this is neither persisted
     * nor shared — the exit, the lockout and the reset all drop it.
     */
    const view = renderVerify({ mismatch: false, attempt: 1 });

    fireEvent.change(view.getByTestId('identifier-name-given'), { target: { value: 'Jamie' } });
    fireEvent.change(view.getByTestId('identifier-name-family'), { target: { value: 'Sampleton' } });
    fireEvent.change(view.getByTestId('identifier-address'), {
      target: { value: '2 Example St Sampletown 2000' },
    });
    fireEvent.change(view.getByTestId('identifier-dob-day'), { target: { value: '04' } });
    fireEvent.change(view.getByTestId('identifier-dob-month'), { target: { value: '08' } });
    fireEvent.change(view.getByTestId('identifier-dob-year'), { target: { value: '1962' } });

    // The attempt fails. The SCREEN is the same screen, re-rendered.
    view.rerender(
      <VerifyScreen
        {...CHROME}
        fields={FIELDS}
        stated={{ address: '2 Example St Sampletown 2000' }}
        state={{ kind: 'asking', attempt: 2 }}
        busy={false}
        incomplete={false}
        startError={false}
        mismatch
        onChange={noop}
        onContinue={noop}
        onSeeReception={noop}
      />,
    );

    // The one-line message is here, on the form, and names no identifier.
    const body = view.getByTestId('mismatch-body');
    expect(body.textContent).toBe(strings.verify.mismatchBody);
    expect(view.getByTestId('mismatch-heading').textContent).toBe(strings.verify.mismatchHeading);

    // The composite sub-fields kept what was typed — the form was not remounted.
    expect((view.getByTestId('identifier-name-given') as HTMLInputElement).value).toBe('Jamie');
    expect((view.getByTestId('identifier-name-family') as HTMLInputElement).value).toBe('Sampleton');
    expect((view.getByTestId('identifier-dob-year') as HTMLSelectElement).value).toBe('1962');
    // And so did the plain one, which lives in the ceremony's own state.
    expect((view.getByTestId('identifier-address') as HTMLInputElement).value).toBe(
      '2 Example St Sampletown 2000',
    );

    // Continue is still live: trying again is one press, not a journey.
    expect((view.getByTestId('verify-continue') as HTMLButtonElement).disabled).toBe(false);
    // And the footer counts the attempt they are now on.
    expect(view.container.textContent).toContain(strings.verify.attemptOf(2, KIOSK_MAX_ATTEMPTS));
  });

  it('third_mismatch_hands_over_and_clears', () => {
    /*
     * ONLY THE THIRD FAILURE LEAVES K-2. The ladder is the rule module's, so
     * this walks it: two failures keep the patient on the form, the third
     * locks. The kiosk is deliberately stricter than the server (which allows
     * five) — a person is standing right there, and a fourth guess at a tablet
     * is worth less than a staff member's thirty seconds.
     */
    let state = firstAttempt();
    state = retryAfterMismatch(afterAttempt(state, { outcome: 'failed' }));
    expect(state).toEqual({ kind: 'asking', attempt: 2 });
    state = retryAfterMismatch(afterAttempt(state, { outcome: 'failed' }));
    expect(state).toEqual({ kind: 'asking', attempt: 3 });
    state = afterAttempt(state, { outcome: 'failed' });
    expect(state.kind).toBe('locked');

    // And the locked screen is a different tree: the form is gone, so nothing
    // the patient typed is on screen, and there is nothing to type into.
    const view = render(
      <VerifyScreen
        {...CHROME}
        fields={FIELDS}
        stated={{ address: '2 Example St Sampletown 2000' }}
        state={{ kind: 'locked' }}
        busy={false}
        incomplete={false}
        startError={false}
        mismatch
        onChange={noop}
        onContinue={noop}
        onSeeReception={noop}
      />,
    );
    expect(view.queryByTestId('identifier-address')).toBeNull();
    expect(view.queryByTestId('identifier-name-given')).toBeNull();
    expect(view.container.querySelectorAll('input, select, textarea')).toHaveLength(0);
    expect(view.container.textContent).not.toContain('2 Example St');
    // It routes to a person and says the appointment is unaffected.
    expect(view.container.textContent).toContain(strings.verify.lockedHeading);
    expect(view.container.textContent).toContain(strings.verify.lockedReassurance);
    expect(view.getByTestId('locked-reception')).toBeTruthy();
  });
});

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

describe('K-3 — the reading step asks the patient for nothing', () => {
  it('k3_never_offers_a_field_to_the_patient', () => {
    /*
     * THE DEFECT THIS REPLACES. K-3 carried a free-text box labelled "Basic
     * description of the service — staff entry" on a PATIENT-FACING screen in
     * a waiting room. Anybody standing at the tablet could type a validated
     * particular of a contract into it, and what they typed was matched
     * exactly and case-sensitively against a mapping they could not see — so
     * the honest outcomes were a refusal nobody understood or a particular
     * somebody had guessed.
     *
     * D6a comes from the PMS appointment type through the practice's versioned
     * mapping (CONSULTATION-CAPTURE-PLAN section 2.4). It does not come from
     * the tablet, and neither does any other particular. Every C-rule failure
     * on this screen hands over instead; staff fix it on a staff surface.
     *
     * ASSERTED AS AN ABSENCE, on both states this screen can be in. The
     * absence is the requirement, so the absence is what is checked.
     */
    for (const validation of [
      { state: 'valid', artefactHash: 'b'.repeat(64), ruleSetVersion: 'draft-2026-08' },
      { state: 'validating' },
      { state: 'blocked', reasons: ['C6: D6a: a pre-agreement requires a basic service description'] },
    ] as SignatureValidation[]) {
      const view = render(
        <ParticularsScreen
          {...CHROME}
          view={VIEW}
          validation={validation}
          onContinue={noop}
          onBack={noop}
          onSeeReception={noop}
        />,
      );
      expect(view.container.querySelectorAll('input, select, textarea')).toHaveLength(0);
      expect(view.queryByTestId('staff-service-description')).toBeNull();
      expect(view.queryByTestId('ask-staff')).toBeNull();
      // And the server's own words are never on this screen, in any state.
      expect(view.container.textContent).not.toMatch(/internal server error|C6:|D6a/i);
      view.unmount();
    }
  });

  it('k3_has_one_primary_and_it_is_disabled_until_the_payload_validates', () => {
    // REQ-REG-06 on the reading step: Continue cannot enable from anything but
    // a locked, validated, rendered payload — and there is only one primary, so
    // nobody can think they have signed by reading.
    const blocked = render(
      <ParticularsScreen
        {...CHROME}
        view={VIEW}
        validation={{ state: 'validating' }}
        onContinue={vi.fn()}
        onBack={noop}
        onSeeReception={noop}
      />,
    );
    expect((blocked.getByTestId('continue-to-sign') as HTMLButtonElement).disabled).toBe(true);
    expect(blocked.queryByTestId('sign-control')).toBeNull();
    blocked.unmount();

    const onContinue = vi.fn();
    const valid = render(
      <ParticularsScreen
        {...CHROME}
        view={VIEW}
        validation={{ state: 'valid', artefactHash: 'b'.repeat(64), ruleSetVersion: 'draft-2026-08' }}
        onContinue={onContinue}
        onBack={noop}
        onSeeReception={noop}
      />,
    );
    const primary = valid.getByTestId('continue-to-sign') as HTMLButtonElement;
    expect(primary.disabled).toBe(false);
    fireEvent.click(primary);
    expect(onContinue).toHaveBeenCalledTimes(1);
    // Rule-set and mapping versions are shown (rule 14), and no amount is.
    expect(valid.getByTestId('versions').textContent).toContain('draft-2026-08');
    expect(valid.container.textContent).not.toMatch(/\$\d/);
  });
});
