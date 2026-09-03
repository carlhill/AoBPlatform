import {
  assertRepointAllowed,
  assignorContactChannels,
  AUTHORITY_BASES_FOR_ANOTHER,
  buildAssignorForAnother,
  canRepointAssignor,
  HardRuleViolation,
  isWellFormedEmail,
  isWellFormedMobile,
  matchesPracticeStaff,
  preferredAssignorChannel,
} from './index';

const base = {
  name: 'Sam Carer',
  authorityBasis: 'parent',
  declaresEighteenOrOver: true,
  mobile: '0400 000 111',
  practiceStaffNames: ['Robin Frontdesk', 'Mai Nguyen'],
};

describe('who may be re-pointed onto an agreement (REQ-VUL-01/-04, REQ-AGE-01, C7.2)', () => {
  it('the fixed authority list is the six from REQ-VUL-01, and never "self"', () => {
    expect([...AUTHORITY_BASES_FOR_ANOTHER]).toEqual([
      'parent',
      'spouse',
      'co_resident_relative_18_plus',
      'guardian',
      'health_epoa',
      'other_with_note',
    ]);
    expect(() => buildAssignorForAnother({ ...base, authorityBasis: 'self' })).toThrow(HardRuleViolation);
  });

  it('non_patient_assignor_requires_contact_channel', () => {
    expect(() =>
      buildAssignorForAnother({ ...base, mobile: undefined, email: undefined }),
    ).toThrow(/REQ-REG-08/);
    // Malformed is the same as absent — a copy sent nowhere is not a copy.
    expect(() => buildAssignorForAnother({ ...base, mobile: '02 9999 0000' })).toThrow(/REQ-REG-08/);
    expect(() => buildAssignorForAnother({ ...base, mobile: undefined, email: 'not-an-address' })).toThrow(
      /REQ-REG-08/,
    );
    expect(buildAssignorForAnother({ ...base, mobile: undefined, email: 'sam@example.invalid' })
      .preferredChannel).toBe('email');
  });

  it('friend_is_other_with_note', () => {
    const friend = buildAssignorForAnother({
      ...base,
      authorityBasis: 'other_with_note',
      note: 'friend',
    });
    expect(friend.authorityBasis).toBe('other_with_note');
    expect(friend.authorityNote).toBe('friend');
    // C8 wants a relationship, and the note is the honest one.
    expect(friend.relationshipToPatient).toBe('friend');

    expect(() => buildAssignorForAnother({ ...base, authorityBasis: 'other_with_note' })).toThrow(
      /REQ-VUL-01/,
    );
  });

  it('practice_staff_rejected_as_assignor', () => {
    // Case and spacing folded — a block a different capitalisation walks
    // through is not a block.
    expect(() => buildAssignorForAnother({ ...base, name: 'robin  FRONTDESK' })).toThrow(/REQ-VUL-04/);
    expect(matchesPracticeStaff('  Mai   NGUYEN ', base.practiceStaffNames)).toBe(true);
    expect(matchesPracticeStaff('', base.practiceStaffNames)).toBe(false);
  });

  it('assignor_for_another_must_be_of_full_age', () => {
    expect(() => buildAssignorForAnother({ ...base, declaresEighteenOrOver: false })).toThrow(
      /REQ-AGE-01/,
    );
  });

  it('the staff block is reported ahead of the age gate', () => {
    // A refusal that names the age would tell a staff member the wrong reason.
    expect(() =>
      buildAssignorForAnother({ ...base, name: 'Robin Frontdesk', declaresEighteenOrOver: false }),
    ).toThrow(/REQ-VUL-04/);
  });

  it('never asks about capacity — there is no parameter for it (REQ-VUL-05)', () => {
    expect(JSON.stringify(buildAssignorForAnother(base))).not.toMatch(/capacit/i);
  });
});

describe('contact channels are contact, not identity (C7.2)', () => {
  it('accepts +61, 0061 and spaced forms of one mobile', () => {
    for (const form of ['0400000111', '+61 400 000 111', '0061400000111', '(04) 0000-0111']) {
      expect(isWellFormedMobile(form)).toBe(true);
    }
    expect(isWellFormedMobile('0299990000')).toBe(false);
    expect(isWellFormedMobile('040000011')).toBe(false);
  });

  it('mobile is preferred when both are given', () => {
    expect(preferredAssignorChannel({ mobile: '0400000111', email: 'a@b.invalid' })).toBe('mobile');
    expect(assignorContactChannels({ mobile: '0400000111', email: 'a@b.invalid' })).toEqual([
      'mobile',
      'email',
    ]);
    expect(preferredAssignorChannel({})).toBeNull();
  });

  it('refuses the typo that sends a copy nowhere', () => {
    expect(isWellFormedEmail('sam@example.invalid')).toBe(true);
    expect(isWellFormedEmail('sam@example')).toBe(false);
    expect(isWellFormedEmail('sam example@x.com')).toBe(false);
  });
});

describe('locked_agreement_cannot_change_assignor (hard rule 2 / REQ-REG-06)', () => {
  it('permits the change only while the particulars can still change', () => {
    expect(canRepointAssignor({ status: 'draft', particularsLocked: false })).toBe(true);
    expect(canRepointAssignor({ status: 'verification_pending', particularsLocked: false })).toBe(true);
    expect(canRepointAssignor({ status: 'awaiting_signature', particularsLocked: false })).toBe(true);

    expect(canRepointAssignor({ status: 'draft', particularsLocked: true })).toBe(false);
    expect(canRepointAssignor({ status: 'signed', particularsLocked: true })).toBe(false);
    expect(canRepointAssignor({ status: 'stored', particularsLocked: true })).toBe(false);
    expect(canRepointAssignor({ status: 'declined', particularsLocked: false })).toBe(false);
    expect(canRepointAssignor({ status: 'expired', particularsLocked: false })).toBe(false);
    expect(canRepointAssignor({ status: 'void', particularsLocked: false })).toBe(false);
  });

  it('names REQ-REG-06 when it refuses', () => {
    expect(() => assertRepointAllowed({ status: 'draft', particularsLocked: true })).toThrow(
      /REQ-REG-06/,
    );
  });
});
