/**
 * ONE NAMED TEST PER HARD RULE THIS SURFACE TOUCHES (CLAUDE.md §6,
 * CONVENTIONS.md §9). The names are traceability and are carried over from
 * `apps/kiosk/src/rules/hard-rules.test.tsx` unchanged — do not rename them.
 *
 * These are not "does the button work" tests. Each one asserts that the
 * violation is UNREACHABLE, not merely absent from the current screens: the
 * signature test drives the real control with an invalid payload and proves it
 * still refuses; the identifier test hands the approved-set guard the excluded
 * name and proves it throws.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { fireEvent, render } from '@testing-library/react';
import {
  APPROVED_IDENTIFIER_TYPES,
  MIN_AGE_ASSIGN_FOR_OTHER,
  MIN_AGE_SELF_ASSIGN,
} from '@aobplatform/domain';
import { SignatureControl } from '../components/SignatureControl';
import { AssignorScreen } from '../screens/AssignorScreen';
import { evaluateSignatureGate, isSignable, type SignatureValidation } from './signature-gate';
import { identifierFieldsFor } from './identifiers';
import {
  ASSIGNOR_RELATIONSHIP_OPTIONS,
  ASSIGNOR_RELATIONSHIPS_VERSION,
  assignorRequestFrom,
  decideAssignor,
  evaluateAssignorGate,
  matchesPracticeStaff,
  EMPTY_CHOICE,
} from './assignor';
import { afterAttempt, firstAttempt, KIOSK_MAX_ATTEMPTS, mismatchMessage } from './verification';
import { strings } from '../strings';

/**
 * EVERY WORD THIS SURFACE CAN RENDER, including the templated ones.
 *
 * `JSON.stringify` silently drops function values, and several strings here
 * are functions ("Signed. Thank you, {name}.", "Sign — {n} details still
 * needed"). A copy rule checked against the JSON alone would therefore pass
 * over exactly the strings most likely to be edited carelessly later. This
 * walks the table and CALLS each function with plausible arguments so its
 * output is checked too.
 *
 * IT WALKS `strings.kiosk`, NOT THE WHOLE PLATFORM TABLE, and that narrowing
 * is deliberate rather than convenient: the console legitimately says
 * "Approved by" about a practice application, and hard rule 12 is about what
 * we say about OUR FORMS. The kiosk is the surface where that rule bites.
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

const noop = () => undefined;

describe('REQ-REG-06 — particulars complete and locked before signature', () => {
  it('signature_disabled_until_payload_valid', () => {
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
      const onSign = vi.fn();
      const view = render(
        <SignatureControl validation={validation} inkPresent submitting={false} onSign={onSign} />,
      );
      const control = view.getByTestId('sign-control') as HTMLButtonElement;
      expect(control.disabled).toBe(true);
      // The refusal says what is missing rather than only saying no.
      expect(String(control.getAttribute('aria-label')).length).toBeGreaterThan(0);
      expect(control.getAttribute('aria-label')).not.toBe(strings.signature.signAction);
      // And pressing it does nothing at all — there is no handler to reach.
      fireEvent.click(control);
      expect(onSign).toHaveBeenCalledTimes(0);
      view.unmount();
    }

    // And the one payload that IS complete, locked and validated enables it.
    const valid = evaluateSignatureGate(LOCKED_AND_VALID);
    expect(isSignable(valid)).toBe(true);
    const view = render(
      <SignatureControl validation={valid} inkPresent submitting={false} onSign={vi.fn()} />,
    );
    const enabled = view.getByTestId('sign-control') as HTMLButtonElement;
    expect(enabled.disabled).toBe(false);
    expect(enabled.getAttribute('aria-label')).toBe(strings.signature.signAction);
  });

  it('signature_disabled_until_ink_present', () => {
    // A second, independent condition. It can only ever narrow the gate.
    const valid = evaluateSignatureGate(LOCKED_AND_VALID);
    const view = render(
      <SignatureControl validation={valid} inkPresent={false} submitting={false} onSign={vi.fn()} />,
    );
    expect((view.getByTestId('sign-control') as HTMLButtonElement).disabled).toBe(true);
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

const PATIENT = 'Jamie Sampleton';

/** A complete, permitted "someone else" — every gate satisfied, no staff match. */
const VALID_OTHER = {
  assignorIsPatient: false as const,
  otherName: 'Pat Example',
  relationship: 'friend',
  describe: '',
  otherDeclaredOfAge: true,
  mobile: '0400 000 000',
  email: '',
};

function renderAssignor(props: Partial<ComponentProps<typeof AssignorScreen>> = {}) {
  const choice = props.choice ?? EMPTY_CHOICE;
  return render(
    <AssignorScreen
      practiceName={PRACTICE_NAME}
      locationLine={null}
      patientName={PATIENT}
      choice={choice}
      guard={props.guard ?? evaluateAssignorGate({ choice, practiceStaffNames: [], patientName: PATIENT })}
      saveError={false}
      saving={false}
      onChoose={props.onChoose ?? noop}
      onChangeOther={noop}
      onContinue={props.onContinue ?? noop}
      onSeeReception={noop}
      {...props}
    />,
  );
}

describe('assignor rules', () => {
  it('practice_staff_hard_blocked_as_assignor', () => {
    const decision = decideAssignor({
      choice: { ...VALID_OTHER, otherName: 'John Smith' },
      practiceStaffNames: ['Carl HILL', 'John Smith'],
      patientName: PATIENT,
      patientAgeYears: null,
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error('unreachable');
    /*
     * THE BLOCK IS UNCHANGED; ONLY THE COPY MOVED (Carl, 3 Sep 2026). The
     * match is NAME-BASED and can catch an innocent namesake, so the sentence
     * states the match rather than accusing the person of anything — and it
     * still never names WHICH name matched or how the match was made, which is
     * the half of REQ-VUL-04 worth protecting.
     */
    expect(decision.message).toBe(strings.assignor.blockedBody);
    expect(decision.message.toLowerCase()).toContain('practice staff');
    expect(decision.message.toLowerCase()).toContain('if that is not you');
    expect(decision.message.toLowerCase()).not.toContain('req-vul');
    expect(decision.message.toLowerCase()).not.toContain('john smith');
    // Case and spacing must not walk through the block.
    expect(matchesPracticeStaff('  john   smith ', ['John Smith'])).toBe(true);
  });

  it('assignor_for_another_must_be_of_full_age', () => {
    const base = { practiceStaffNames: [] as string[], patientName: PATIENT, patientAgeYears: null };
    const undeclared = decideAssignor({
      ...base,
      choice: { ...VALID_OTHER, otherDeclaredOfAge: false },
    });
    expect(undeclared.allowed).toBe(false);
    const declared = decideAssignor({ ...base, choice: VALID_OTHER });
    expect(declared.allowed).toBe(true);
    // The threshold comes from the domain, never from a literal in this app.
    expect(MIN_AGE_ASSIGN_FOR_OTHER).toBe(18);
  });

  it('patient_14_may_self_assign', () => {
    expect(MIN_AGE_SELF_ASSIGN).toBe(14);
    const at14 = decideAssignor({
      choice: { ...EMPTY_CHOICE, assignorIsPatient: true },
      practiceStaffNames: [],
      patientName: PATIENT,
      patientAgeYears: MIN_AGE_SELF_ASSIGN,
    });
    expect(at14.allowed).toBe(true);
    const below = decideAssignor({
      choice: { ...EMPTY_CHOICE, assignorIsPatient: true },
      practiceStaffNames: [],
      patientName: PATIENT,
      patientAgeYears: MIN_AGE_SELF_ASSIGN - 1,
    });
    expect(below.allowed).toBe(false);
    // The kiosk is not sent a date of birth, so it defers rather than guessing.
    const deferred = decideAssignor({
      choice: { ...EMPTY_CHOICE, assignorIsPatient: true },
      practiceStaffNames: [],
      patientName: PATIENT,
      patientAgeYears: null,
    });
    expect(deferred.allowed).toBe(true);
    if (!deferred.allowed) throw new Error('unreachable');
    expect(deferred.selfAssignAgeCheckedBy).toBe('server');
  });

  it('self_assign_tap_advances', () => {
    // K-5 (Carl, 3 Sep 2026 live test): tapping "I am signing for myself" must
    // not require a separate Continue press for the common case. The DECISION
    // side of that is proved above — self-assign always defers to the server
    // and is never blocked by anything this device can check. This proves the
    // SCREEN side: the self button fires the choice once, synchronously, with
    // no Continue press anywhere in between. `Ceremony.tsx` wires that single
    // `onChoose(true)` straight into the same `decideAssignor` call Continue
    // uses, which is what lets it advance on the tap.
    const onChoose = vi.fn();
    const onContinue = vi.fn();
    const view = renderAssignor({ onChoose, onContinue });
    fireEvent.click(view.getByTestId('assignor-self'));
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith(true);
    // No Continue press was needed to convey the choice.
    expect(onContinue).toHaveBeenCalledTimes(0);
    /*
     * AND NO CONTINUE IS EVEN OFFERED (Carl, 3 Sep 2026 live test). The tap
     * always advanced; what was wrong was that a second control sat under a
     * choice already made, which reads as the step you still have to take. A
     * person waited for something that was not there. Self needs no Continue —
     * nothing about it can fail on this device — so it is not drawn.
     */
    expect(view.queryByTestId('assignor-continue')).toBeNull();
    // And the choice is visible as well as recorded — a tap that changes
    // nothing on screen reads as a tap that did not register.
    view.unmount();
    const chosen = renderAssignor({ choice: { ...EMPTY_CHOICE, assignorIsPatient: true } });
    expect(chosen.getByTestId('assignor-self').getAttribute('aria-pressed')).toBe('true');
    expect(chosen.getByTestId('assignor-other').getAttribute('aria-pressed')).toBe('false');
  });

  it('staff_assignor_block_disables_continue_with_reason', () => {
    // CLAUDE.md §6 — blocked states are unreachable, not merely inert. Continue
    // is a `GuardedButton`, disabled with its reason, before anybody presses it.
    const choice = { ...VALID_OTHER, otherName: 'Carl Hill' };
    const guard = evaluateAssignorGate({
      choice,
      practiceStaffNames: ['Carl Hill'],
      patientName: PATIENT,
    });
    const onContinue = vi.fn();
    const view = renderAssignor({ choice, guard, onContinue });

    const continueButton = view.getByTestId('assignor-continue') as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);
    expect(String(continueButton.getAttribute('aria-label'))).toMatch(/detail/i);
    fireEvent.click(continueButton);
    expect(onContinue).toHaveBeenCalledTimes(0);

    // The reason is on screen before the press, not only after it.
    expect(view.getByTestId('assignor-continue-reason-0').textContent).toBe(
      strings.assignor.reasonStaffBlocked,
    );
    // And the fuller explanation states the match without naming the person.
    expect(view.getByTestId('assignor-refusal').textContent).toBe(strings.assignor.blockedBody);
    expect(view.getByTestId('assignor-refusal').textContent).not.toMatch(/carl hill/i);
  });

  it('non_patient_assignor_continues_to_agreement', () => {
    /*
     * THE GAP THE EXPO BUILD LEFT, CLOSED. It ran these gates and then handed
     * over to the desk, because nothing re-pointed an agreement at a new
     * assignor. A complete, permitted "someone else" must now be ALLOWED —
     * which is what lets `Ceremony.advanceAssignor` POST the change and go on
     * to K-3 instead of to reception.
     */
    const decision = decideAssignor({
      choice: VALID_OTHER,
      practiceStaffNames: ['Carl HILL', 'John Smith'],
      patientName: PATIENT,
      patientAgeYears: null,
    });
    expect(decision.allowed).toBe(true);

    const guard = evaluateAssignorGate({
      choice: VALID_OTHER,
      practiceStaffNames: ['Carl HILL', 'John Smith'],
      patientName: PATIENT,
    });
    expect(guard.state).toBe('valid');

    /*
     * AND THE BODY IT PRODUCES CARRIES BOTH ATTRIBUTES (REQ-VUL-01). The word
     * the person chose AND the legal basis derived from it through versioned
     * content, plus the version of the list they chose from (hard rule 14).
     * "Friend" is a legitimate answer; it lands on `other_with_note` with the
     * relationship itself as the note.
     */
    const body = assignorRequestFrom(VALID_OTHER);
    expect(body).not.toBeNull();
    expect(body?.relationship).toBe('Friend');
    expect(body?.authorityBasis).toBe('other_with_note');
    expect(body?.note).toBe('Friend');
    expect(body?.declaresEighteenOrOver).toBe(true);
    expect(body?.relationshipsVersion).toBe(ASSIGNOR_RELATIONSHIPS_VERSION);
    // The tablet never asserts co-residence or a legal instrument from a word.
    expect(['co_resident_relative_18_plus', 'guardian', 'health_epoa']).not.toContain(
      body?.authorityBasis,
    );

    // The screen's Continue is live, and pressing it calls the ceremony.
    const onContinue = vi.fn();
    const view = renderAssignor({ choice: VALID_OTHER, guard, onContinue });
    const button = view.getByTestId('assignor-continue') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onContinue).toHaveBeenCalledTimes(1);

    // "Friend" needs no free-text box; only the option the content file marks
    // `freeText` reveals one.
    expect(view.queryByTestId('assignor-describe')).toBeNull();
  });

  it('relationship_options_come_from_content_not_code', () => {
    /*
     * HARD RULE 14, AS A TEST. The dropdown's options and their ORDER come
     * from `packages/domain/content/assignor-relationships.json`, which is
     * versioned content — a practice's list of relationships is exactly the
     * sort of thing that moves, and it must move without a code change. The
     * component contributes only the words, looked up in the string table by
     * the content file's key.
     *
     * This asserts the screen renders exactly the file's keys, in the file's
     * order. A fixture with an extra option therefore appears on screen with
     * no edit to any component: the assertion is written against the file, so
     * adding an option changes what this test expects and what the screen
     * renders in the same step.
     */
    const view = renderAssignor({ choice: { ...VALID_OTHER } });
    const select = view.getByTestId('assignor-relationship') as HTMLSelectElement;
    const rendered = [...select.options].map((option) => option.value).filter(Boolean);
    expect(rendered).toEqual(ASSIGNOR_RELATIONSHIP_OPTIONS.map((option) => option.key));

    // And the free-text box is revealed by the file's flag, not by a
    // comparison written in the component.
    const freeTextKey = ASSIGNOR_RELATIONSHIP_OPTIONS.find((option) => option.freeText)?.key;
    expect(freeTextKey).toBeTruthy();
    view.unmount();
    const withFreeText = renderAssignor({
      choice: { ...VALID_OTHER, relationship: freeTextKey as string, describe: '' },
    });
    expect(withFreeText.getByTestId('assignor-describe')).toBeTruthy();
  });

  it('ui_never_asks_staff_to_assess_capacity', () => {
    // No capacity input exists on the decision, and no capacity word exists in
    // any string this device can render.
    expect(Object.keys(EMPTY_CHOICE).join(' ')).not.toMatch(/capacit/i);
    expect(allCopy()).not.toMatch(/can they consent|assess capacity|competen/i);
  });
});

describe('artefact copy rules', () => {
  it('no_dollar_amount_on_any_agreement_artefact', () => {
    // Rule 4 / REQ-REG-04. Nothing this device can render carries an amount.
    expect(JSON.stringify(strings)).not.toMatch(/\$\d|dollar|amount payable|fee\b|benefit amount/i);
    expect(allCopy()).not.toMatch(/\$\d|dollar|amount payable|fee\b|benefit amount/i);
  });

  it('no_practitioner_signature_field', () => {
    // Rule 3 / C10, abolished 1 July 2026.
    const mentions = (allCopy().match(/(practitioner|provider) signature/gi) ?? []).length;
    // The one and only mention is the tag that says there is NO such field.
    expect(mentions).toBe(1);
    expect(strings.particulars.tagNoProviderSignature).toBe('No provider signature field');
  });

  it('never_claims_certification_or_approval', () => {
    // Rule 12 / REQ-65C-05. The permitted phrasing is used instead. Note this
    // walks the KIOSK subtree only: the console says "Approved by" about a
    // practice application, which is a different claim about a different thing.
    const copy = allCopy().toLowerCase();
    for (const banned of [/\bcertified\b/, /\baccredited\b/, /government.approved/]) {
      expect(copy).not.toMatch(banned);
    }
    // "Approved" as a claim about our forms is banned; "approve" as the
    // PATIENT'S action is the whole point of the tap-to-approve control.
    expect(copy).not.toMatch(/\bapproved\b/);
    expect(strings.particulars.footer).toBe('Checked against the s 65C data set');
  });

  it('nothing_blocks_care', () => {
    // REQ-REC-04: every dead end says the appointment is unaffected.
    expect(strings.verify.lockedReassurance).toMatch(/not affected/i);
    expect(strings.idle.loadFailed).toMatch(/not affected/i);
    expect(strings.particulars.needsReceptionBody).toMatch(/not affected/i);
    expect(strings.particulars.serverFault).toMatch(/not affected/i);
    expect(strings.signature.failed).toMatch(/not affected/i);
    expect(strings.assignor.saveFailed).toMatch(/not affected/i);
    expect(strings.errors.generic).toMatch(/not affected/i);
  });
});

