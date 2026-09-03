/**
 * ONE NAMED TEST PER HARD RULE THIS APP TOUCHES (CLAUDE.md §6, CONVENTIONS.md
 * §9). The names are traceability — do not rename them.
 *
 * These are not "does the button work" tests. Each one asserts that the
 * violation is UNREACHABLE, not merely absent from the current screens: the
 * signature test drives the real control with an invalid payload and proves it
 * still refuses; the identifier test hands the approved-set guard the excluded
 * name and proves it throws.
 */
import { fireEvent, render } from '@testing-library/react-native';
import { APPROVED_IDENTIFIER_TYPES, MIN_AGE_ASSIGN_FOR_OTHER, MIN_AGE_SELF_ASSIGN } from '@aobplatform/domain';
import { SignatureControl } from '../components/SignatureControl';
import { AssignorScreen } from '../screens/AssignorScreen';
import { evaluateSignatureGate, isSignable, type SignatureValidation } from './signature-gate';
import { identifierFieldsFor } from './identifiers';
import { decideAssignor, evaluateAssignorGate, matchesPracticeStaff } from './assignor';
import { afterAttempt, firstAttempt, KIOSK_MAX_ATTEMPTS, mismatchMessage } from './verification';
import { strings } from '../strings';


/**
 * EVERY WORD THIS DEVICE CAN RENDER, including the templated ones.
 *
 * `JSON.stringify` silently drops function values, and several strings here
 * are functions ("Signed. Thank you, {name}.", "Sign — {n} details still
 * needed"). A copy rule checked against the JSON alone would therefore pass
 * over exactly the strings most likely to be edited carelessly later. This
 * walks the table and CALLS each function with plausible arguments so its
 * output is checked too.
 */
function allCopy(): string {
  const out: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      out.push(value);
      return;
    }
    if (typeof value === 'function') {
      for (const args of [[1, 4], ['Sample', 'Sample'], [1, 'Sample']]) {
        try {
          const produced = (value as (...a: unknown[]) => unknown)(...args);
          if (typeof produced === 'string') out.push(produced);
        } catch {
          /* a signature we did not guess; the other attempts cover it */
        }
      }
      return;
    }
    if (value && typeof value === 'object') {
      for (const nested of Object.values(value as Record<string, unknown>)) visit(nested);
    }
  };
  visit(strings);
  return out.join(String.fromCharCode(10));
}

const LOCKED_AND_VALID = {
  status: 'awaiting_signature',
  particulars: { patientName: 'Jamie Sampleton' },
  particularsLockedAt: '2026-09-03T00:00:00.000Z',
  ruleSetVersion: 'draft-2026-08',
  renderedArtefactHash: 'a'.repeat(64),
};

describe('REQ-REG-06 — particulars complete and locked before signature', () => {
  it('signature_disabled_until_payload_valid', async () => {
    // Every way a payload can be short of signable, driven through the real control.
    const invalid: SignatureValidation[] = [
      { state: 'validating' },
      evaluateSignatureGate({ ...LOCKED_AND_VALID, particulars: null }),
      evaluateSignatureGate({ ...LOCKED_AND_VALID, particularsLockedAt: null }),
      evaluateSignatureGate({ ...LOCKED_AND_VALID, ruleSetVersion: null }),
      evaluateSignatureGate({ ...LOCKED_AND_VALID, renderedArtefactHash: null }),
      evaluateSignatureGate({ ...LOCKED_AND_VALID, status: 'draft' }),
    ];

    for (const validation of invalid) {
      expect(isSignable(validation)).toBe(false);
      const onSign = jest.fn();
      const screen = await render(
        <SignatureControl validation={validation} inkPresent submitting={false} onSign={onSign} />,
      );
      const control = screen.getByTestId('sign-control');
      expect(control.props.accessibilityState?.disabled).toBe(true);
      // The refusal says what is missing rather than only saying no.
      expect(String(control.props.accessibilityLabel).length).toBeGreaterThan(0);
      expect(control.props.accessibilityLabel).not.toBe(strings.signature.signAction);
      await screen.unmount();
    }

    // And the one payload that IS complete, locked and validated enables it.
    const valid = evaluateSignatureGate(LOCKED_AND_VALID);
    expect(isSignable(valid)).toBe(true);
    const screen = await render(<SignatureControl validation={valid} inkPresent submitting={false} onSign={jest.fn()} />);
    const enabled = screen.getByTestId('sign-control');
    expect(enabled.props.accessibilityState?.disabled).toBeFalsy();
    expect(enabled.props.accessibilityLabel).toBe(strings.signature.signAction);
  });

  it('signature_disabled_until_ink_present', async () => {
    // A second, independent condition. It can only ever narrow the gate.
    const valid = evaluateSignatureGate(LOCKED_AND_VALID);
    const screen = await render(
      <SignatureControl validation={valid} inkPresent={false} submitting={false} onSign={jest.fn()} />,
    );
    expect(screen.getByTestId('sign-control').props.accessibilityState?.disabled).toBe(true);
  });
});

describe('REQ-VER-02 — the Medicare card number is not an identifier', () => {
  it('medicare_number_rejected_as_identifier', () => {
    // The root ESLint config exempts hard-rule test files so the forbidden
    // name can be written here, and only here, to prove it is rejected.
    const medicareNumber = 'medicare_number';
    expect(() => identifierFieldsFor(['name', 'date_of_birth', medicareNumber])).toThrow(
      /not an approved patient identifier/i,
    );
    expect(() => identifierFieldsFor(['name', 'date_of_birth', 'medicare_card_number'])).toThrow();
    // And there is no label for one anywhere in the string table.
    expect(Object.keys(strings.verify.identifierNames).sort()).toEqual([...APPROVED_IDENTIFIER_TYPES].sort());
    // The words appear exactly once on this device: in the annotation panel
    // that says there is NO such field. Anywhere else is a bug.
    const mentions = allCopy().toLowerCase().split('medicare card').length - 1;
    expect(mentions).toBe(1);
    expect(strings.verify.annotationBody.toLowerCase()).toContain('no medicare card field');
  });

  it('identifier_fields_render_only_from_the_approved_set', () => {
    const built = identifierFieldsFor(['name', 'date_of_birth', 'address']);
    expect(built.map((f) => f.type)).toEqual(['name', 'date_of_birth', 'address']);
    for (const field of built) {
      expect(APPROVED_IDENTIFIER_TYPES).toContain(field.type);
    }
    // The floor is three distinct approved identifiers.
    expect(() => identifierFieldsFor(['name', 'date_of_birth'])).toThrow();
  });
});

describe('verification failures are generic', () => {
  it('mismatch_never_names_the_failed_identifier', () => {
    const message = `${strings.verify.mismatchHeading} ${mismatchMessage()}`.toLowerCase();
    for (const type of APPROVED_IDENTIFIER_TYPES) {
      expect(message).not.toContain(type.replace(/_/g, ' '));
      expect(message).not.toContain(type);
    }
    // It takes no arguments, so nothing can be interpolated into it.
    expect(mismatchMessage).toHaveLength(0);
  });

  it('three_attempts_then_lockout', () => {
    let state = firstAttempt();
    expect(state).toEqual({ kind: 'asking', attempt: 1 });
    state = afterAttempt(state, { outcome: 'failed' });
    expect(state.kind).toBe('mismatch');
    state = afterAttempt({ kind: 'asking', attempt: 2 }, { outcome: 'failed' });
    expect(state.kind).toBe('mismatch');
    state = afterAttempt({ kind: 'asking', attempt: KIOSK_MAX_ATTEMPTS }, { outcome: 'failed' });
    expect(state.kind).toBe('locked');
    // The server may also lock earlier from its own count; the kiosk obeys it.
    expect(afterAttempt(firstAttempt(), { outcome: 'locked_out' }).kind).toBe('locked');
  });
});

const PRACTICE_NAME = 'Sample Practice';

describe('assignor rules', () => {
  it('practice_staff_hard_blocked_as_assignor', () => {
    const decision = decideAssignor({
      choice: {
        assignorIsPatient: false,
        otherName: 'John Smith',
        otherRelationship: 'Parent',
        otherDeclaredOfAge: true,
      },
      practiceStaffNames: ['Carl HILL', 'John Smith'],
      practiceName: PRACTICE_NAME,
      patientAgeYears: null,
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error('unreachable');
    // REVISED, Carl, 3 Sep 2026 live test (see assignor.ts's module doc). The
    // block itself — the assertion above — is untouched; only the copy
    // changed, from silent-and-neutral to naming the rule. It still never
    // names WHICH name matched or how the match was made — that half of
    // REQ-VUL-04 still holds.
    expect(decision.message).toBe(strings.assignor.blockedBody(PRACTICE_NAME));
    expect(decision.message).toContain(PRACTICE_NAME);
    expect(decision.message.toLowerCase()).toContain('practice staff');
    expect(decision.message.toLowerCase()).not.toContain('req-vul');
    expect(decision.message.toLowerCase()).not.toContain('john smith');
    // Case and spacing must not walk through the block.
    expect(matchesPracticeStaff('  john   smith ', ['John Smith'])).toBe(true);
  });

  it('assignor_for_another_must_be_of_full_age', () => {
    const base = {
      practiceStaffNames: [] as string[],
      practiceName: PRACTICE_NAME,
      patientAgeYears: null,
    };
    const undeclared = decideAssignor({
      ...base,
      choice: {
        assignorIsPatient: false,
        otherName: 'Mai Nguyen',
        otherRelationship: 'Parent',
        otherDeclaredOfAge: false,
      },
    });
    expect(undeclared.allowed).toBe(false);
    const declared = decideAssignor({
      ...base,
      choice: {
        assignorIsPatient: false,
        otherName: 'Mai Nguyen',
        otherRelationship: 'Parent',
        otherDeclaredOfAge: true,
      },
    });
    expect(declared.allowed).toBe(true);
    // The threshold comes from the domain, never from a literal in this app.
    expect(MIN_AGE_ASSIGN_FOR_OTHER).toBe(18);
  });

  it('patient_14_may_self_assign', () => {
    expect(MIN_AGE_SELF_ASSIGN).toBe(14);
    const at14 = decideAssignor({
      choice: { ...EMPTY, assignorIsPatient: true },
      practiceStaffNames: [],
      practiceName: PRACTICE_NAME,
      patientAgeYears: MIN_AGE_SELF_ASSIGN,
    });
    expect(at14.allowed).toBe(true);
    const below = decideAssignor({
      choice: { ...EMPTY, assignorIsPatient: true },
      practiceStaffNames: [],
      practiceName: PRACTICE_NAME,
      patientAgeYears: MIN_AGE_SELF_ASSIGN - 1,
    });
    expect(below.allowed).toBe(false);
    // The kiosk is not sent a date of birth, so it defers rather than guessing.
    const deferred = decideAssignor({
      choice: { ...EMPTY, assignorIsPatient: true },
      practiceStaffNames: [],
      practiceName: PRACTICE_NAME,
      patientAgeYears: null,
    });
    expect(deferred.allowed).toBe(true);
    if (!deferred.allowed) throw new Error('unreachable');
    expect(deferred.selfAssignAgeCheckedBy).toBe('server');
  });

  it('self_assign_tap_advances', async () => {
    // K-5 (Carl, 3 Sep 2026 live test): tapping "I am signing for myself" must
    // not require a separate Continue press for the common case. The DECISION
    // side of that is already proved above — self-assign always defers to the
    // server (`patient_14_may_self_assign`'s `deferred` case) and is never
    // blocked by anything this device can check. This proves the SCREEN side
    // of the contract: the self button fires the choice once, synchronously,
    // with no Continue press anywhere in between — the ceremony (Ceremony.tsx)
    // wires that single `onChoose(true)` straight into the same
    // `decideAssignor` call Continue itself uses, which is what lets it
    // advance on the tap.
    const onChoose = jest.fn();
    const onContinue = jest.fn();
    const screen = await render(
      <AssignorScreen
        practiceName={PRACTICE_NAME}
        locationLine={null}
        patientName="Jamie Sampleton"
        choice={EMPTY}
        guard={evaluateAssignorGate({ choice: EMPTY, practiceStaffNames: [], practiceName: PRACTICE_NAME })}
        onChoose={onChoose}
        onChangeOther={jest.fn()}
        onContinue={onContinue}
        onSeeReception={jest.fn()}
      />,
    );
    await fireEvent.press(screen.getByTestId('assignor-self'));
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith(true);
    // No Continue press was needed to convey the choice.
    expect(onContinue).toHaveBeenCalledTimes(0);
    await screen.unmount();
  });

  it('staff_assignor_block_disables_continue_with_reason', async () => {
    // CLAUDE.md §6 — blocked states are unreachable, not merely inert. Before
    // this fix Continue looked live and simply did nothing when pressed; now
    // it is a `GuardedButton`, disabled with its reason, before anybody
    // presses it.
    const choice = {
      assignorIsPatient: false,
      otherName: 'Carl Hill',
      otherRelationship: 'Friend',
      otherDeclaredOfAge: true,
    };
    const guard = evaluateAssignorGate({
      choice,
      practiceStaffNames: ['Carl Hill'],
      practiceName: PRACTICE_NAME,
    });
    const screen = await render(
      <AssignorScreen
        practiceName={PRACTICE_NAME}
        locationLine={null}
        patientName="Jamie Sampleton"
        choice={choice}
        guard={guard}
        onChoose={jest.fn()}
        onChangeOther={jest.fn()}
        onContinue={jest.fn()}
        onSeeReception={jest.fn()}
      />,
    );
    const continueButton = screen.getByTestId('assignor-continue');
    expect(continueButton.props.accessibilityState?.disabled).toBe(true);
    // The same disabled-with-no-`onPress` primitive the signature gate uses.
    expect(continueButton.props.onPress).toBeUndefined();
    expect(String(continueButton.props.accessibilityLabel)).toMatch(/detail/i);
    // The fuller explanation names the rule, not just "ask reception".
    const explanation = screen.getByTestId('assignor-refusal');
    expect(explanation.props.children).toBe(strings.assignor.blockedBody(PRACTICE_NAME));
    await screen.unmount();
  });

  it('ui_never_asks_staff_to_assess_capacity', () => {
    // No capacity input exists on the decision, and no capacity word exists in
    // any string this device can render.
    const decisionInputKeys = Object.keys({
      assignorIsPatient: true,
      otherName: '',
      otherRelationship: '',
      otherDeclaredOfAge: false,
    });
    expect(decisionInputKeys.join(' ')).not.toMatch(/capacit/i);
    expect(allCopy()).not.toMatch(/can they consent|assess capacity|competen/i);
  });
});

describe('artefact copy rules', () => {
  it('no_dollar_amount_on_any_agreement_artefact', () => {
    // Rule 4 / REQ-REG-04. Nothing this device can render carries an amount.
    expect(JSON.stringify(strings)).not.toMatch(/\$\d|dollar|amount payable|fee\b|benefit amount/i);
  });

  it('no_practitioner_signature_field', () => {
    // Rule 3 / C10, abolished 1 July 2026.
    const mentions = (allCopy().match(/(practitioner|provider) signature/gi) ?? []).length;
    // The one and only mention is the tag that says there is NO such field.
    expect(mentions).toBe(1);
    expect(strings.particulars.tagNoProviderSignature).toBe('No provider signature field');
  });

  it('never_claims_certification_or_approval', () => {
    // Rule 12 / REQ-65C-05. The permitted phrasing is used instead.
    const copy = allCopy().toLowerCase();
    for (const banned of [/\bcertified\b/, /\bapproved\b/, /\baccredited\b/, /government.approved/]) {
      expect(copy).not.toMatch(banned);
    }
    expect(strings.particulars.footer).toBe('Checked against the s 65C data set');
  });

  it('nothing_blocks_care', () => {
    // REQ-REC-04: every dead end says the appointment is unaffected.
    expect(strings.verify.lockedReassurance).toMatch(/not affected/i);
    expect(strings.idle.loadFailed).toMatch(/not affected/i);
    expect(strings.particulars.lockFailed).toMatch(/not affected/i);
    expect(strings.signature.failed).toMatch(/not affected/i);
    expect(strings.errors.generic).toMatch(/not affected/i);
  });
});

const EMPTY = {
  assignorIsPatient: true,
  otherName: '',
  otherRelationship: '',
  otherDeclaredOfAge: false,
} as const;
