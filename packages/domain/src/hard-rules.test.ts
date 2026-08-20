/**
 * Named tests for the CLAUDE.md §2 hard rules this package touches.
 * Definition of done (§6): every feature carries one named test per hard rule.
 * Do not rename these tests — the names are the traceability.
 */
import type { Agreement, AgreementAnchor } from './agreement';
import { assertValidIdentifierSet, IdentifierSetError, isApprovedIdentifierType } from './identifiers';
import {
  assertEnduringAllowed,
  assertNoForbiddenAgreementFields,
  assertSignatureAllowed,
  canActAsAssignor,
  canEnableSignature,
  canOfferEnduring,
  HardRuleViolation,
  isVerbalCaptureAllowed,
  validAnchorKindFor,
} from './guards';
import { applyChange, canTransition, isContentImmutable, transition } from './lifecycle';

const providerAnchor: AgreementAnchor = { kind: 'provider', providerId: 'prov-1' as never };

function makeAgreement(overrides: Partial<Agreement> = {}): Agreement {
  return {
    id: 'agr-1' as never,
    type: 'episodic_pre',
    anchor: providerAnchor,
    practiceId: 'prac-1' as never,
    patientId: 'pat-1' as never,
    assignorId: 'asr-1' as never,
    assignorIsPatient: true,
    status: 'draft',
    legalHold: false,
    ...overrides,
  };
}

// Rule 1 — REQ-VER-02
describe('medicare_number_rejected_as_identifier', () => {
  it('rejects every Medicare-card variant as an identifier type, non-configurably', () => {
    expect(isApprovedIdentifierType('medicare_number')).toBe(false);
    expect(isApprovedIdentifierType('medicare_card_number')).toBe(false);
    expect(() => assertValidIdentifierSet(['name', 'date_of_birth', 'medicare_number'])).toThrow(IdentifierSetError);
  });

  it('accepts only the six RACGP-approved identifiers, minimum three distinct', () => {
    expect(() => assertValidIdentifierSet(['name', 'date_of_birth', 'address'])).not.toThrow();
    expect(() => assertValidIdentifierSet(['name', 'name', 'date_of_birth'])).toThrow(IdentifierSetError);
    expect(() => assertValidIdentifierSet(['name', 'date_of_birth'])).toThrow(IdentifierSetError);
  });
});

// Rule 2 — REQ-REG-06 / HARD-05
describe('signature_blocked_until_particulars_locked_and_validated', () => {
  it('cannot enable the signature control on a draft, unlocked, or unvalidated payload', () => {
    expect(canEnableSignature({ particularsPresent: false, particularsLocked: false, validationPassed: false })).toBe(
      false,
    );
    expect(canEnableSignature({ particularsPresent: true, particularsLocked: false, validationPassed: true })).toBe(
      false,
    );
    expect(canEnableSignature({ particularsPresent: true, particularsLocked: true, validationPassed: false })).toBe(
      false,
    );
    expect(() =>
      assertSignatureAllowed({ particularsPresent: true, particularsLocked: false, validationPassed: true }),
    ).toThrow(HardRuleViolation);
  });

  it('enables only when particulars are present, locked, and validated', () => {
    expect(canEnableSignature({ particularsPresent: true, particularsLocked: true, validationPassed: true })).toBe(
      true,
    );
  });
});

// Rule 3 — C10
describe('practitioner_signature_field_rejected', () => {
  it('blocks any payload carrying a practitioner/provider signature field, at any depth', () => {
    expect(() => assertNoForbiddenAgreementFields({ practitionerSignature: 'x' })).toThrow(HardRuleViolation);
    expect(() => assertNoForbiddenAgreementFields({ nested: { provider_signature: 'x' } })).toThrow(HardRuleViolation);
  });
});

// Rule 4 — REQ-REG-04
describe('benefit_amount_rejected_on_agreement_artefact', () => {
  it('blocks benefit/dollar/fee/rebate amount fields on agreement payloads', () => {
    expect(() => assertNoForbiddenAgreementFields({ benefitAmount: 65.7 })).toThrow(HardRuleViolation);
    expect(() => assertNoForbiddenAgreementFields({ details: { rebate_amount: 10 } })).toThrow(HardRuleViolation);
  });

  it('allows the s 65C data set fields through', () => {
    expect(() =>
      assertNoForbiddenAgreementFields({
        patientName: 'Pat Example',
        serviceDate: '2026-09-01',
        mbsItemNumbers: ['23'],
        assignorIsPatient: true,
      }),
    ).not.toThrow();
  });
});

// HARD-03 (defence in depth; primary enforcement is the absence of any such field/column)
describe('medicare_number_never_stored', () => {
  it('blocks any payload attempting to carry a Medicare card number', () => {
    expect(() => assertNoForbiddenAgreementFields({ medicareNumber: '2951xxxxxx' })).toThrow(HardRuleViolation);
  });
});

// Rule 5 — REQ-REG-10
describe('verbal_capture_auto_disables_after_30_june_2027', () => {
  it('allows verbal capture through 30 June 2027', () => {
    expect(isVerbalCaptureAllowed('2027-06-30')).toBe(true);
  });
  it('disables verbal capture from 1 July 2027 without an explicit override + reason', () => {
    expect(isVerbalCaptureAllowed('2027-07-01')).toBe(false);
    expect(isVerbalCaptureAllowed('2027-07-01', { reason: '  ' })).toBe(false);
    expect(isVerbalCaptureAllowed('2027-07-01', { reason: 'patient unable to sign, principal approved' })).toBe(true);
  });
});

// Rule 6 — REQ-END-01/-01a
describe('enduring_is_gp_only_and_per_provider', () => {
  it('never offers enduring pathways to non-GP provider types', () => {
    expect(canOfferEnduring('specialist')).toBe(false);
    expect(canOfferEnduring('allied_health')).toBe(false);
    expect(canOfferEnduring('optometrist')).toBe(false);
    expect(() => assertEnduringAllowed('specialist', 'mymedicare')).toThrow(HardRuleViolation);
    expect(() => assertEnduringAllowed('general_practitioner', 'mymedicare')).not.toThrow();
  });

  it('anchors to the organisation only on the ACCHO/AMS pathway', () => {
    expect(validAnchorKindFor('enduring', 'accho_ams')).toBe('organisation');
    expect(validAnchorKindFor('enduring', 'mymedicare')).toBe('provider');
    expect(validAnchorKindFor('enduring', 'residential_aged_care')).toBe('provider');
    expect(validAnchorKindFor('episodic_post')).toBe('provider');
  });
});

// Rule 10 — REQ-VUL-04/-05, REQ-AGE-01/-02
describe('assignor_rules_enforced', () => {
  it('hard-blocks practice staff as assignors', () => {
    const res = canActAsAssignor({ selfAssigning: false, ageYears: 45, isPracticeStaffOfProvider: true });
    expect(res.allowed).toBe(false);
    expect(res.rule).toBe('REQ-VUL-04');
  });
  it('requires 18+ to assign for another person', () => {
    expect(canActAsAssignor({ selfAssigning: false, ageYears: 17, isPracticeStaffOfProvider: false }).allowed).toBe(
      false,
    );
    expect(canActAsAssignor({ selfAssigning: false, ageYears: 18, isPracticeStaffOfProvider: false }).allowed).toBe(
      true,
    );
  });
  it('permits self-assignment from 14', () => {
    expect(canActAsAssignor({ selfAssigning: true, ageYears: 13, isPracticeStaffOfProvider: false }).allowed).toBe(
      false,
    );
    expect(canActAsAssignor({ selfAssigning: true, ageYears: 14, isPracticeStaffOfProvider: false }).allowed).toBe(
      true,
    );
  });
});

// HARD-01 / HARD-02
describe('agreement_anchor_immutable_and_signed_content_immutable', () => {
  it('rejects any change to the anchor — terminate and recreate is the only path', () => {
    const agreement = makeAgreement();
    expect(() =>
      applyChange(agreement, { anchor: { kind: 'provider', providerId: 'prov-2' as never } } as Partial<Agreement>),
    ).toThrow(HardRuleViolation);
  });

  it('rejects particulars/artefact changes once signed — corrections supersede', () => {
    const signed = makeAgreement({ status: 'signed' });
    expect(isContentImmutable('signed')).toBe(true);
    expect(() => applyChange(signed, { renderedArtefactHash: 'tampered' })).toThrow(HardRuleViolation);
  });

  it('routes status changes through the transition map only', () => {
    const draft = makeAgreement();
    expect(() => applyChange(draft, { status: 'signed' } as Partial<Agreement>)).toThrow(HardRuleViolation);
    expect(canTransition('draft', 'signed')).toBe(false);
    expect(canTransition('awaiting_signature', 'signed')).toBe(true);
    expect(transition(makeAgreement({ status: 'awaiting_signature' }), 'signed').status).toBe('signed');
  });
});
