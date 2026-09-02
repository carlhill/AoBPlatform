import { MIN_AGE_SELF_ASSIGN } from './guards';
import { ageYearsAt, autoAssignorDecision, remoteChannelFor } from './auto-capture';

describe('ageYearsAt', () => {
  it('counts whole years, not rounded ones', () => {
    expect(ageYearsAt(new Date('2010-06-15'), new Date('2024-06-14'))).toBe(13);
    expect(ageYearsAt(new Date('2010-06-15'), new Date('2024-06-15'))).toBe(14);
    expect(ageYearsAt(new Date('2010-06-15'), new Date('2024-06-16'))).toBe(14);
  });

  it('handles a birthday later in the year than the reference month', () => {
    expect(ageYearsAt(new Date('2010-12-31'), new Date('2024-01-01'))).toBe(13);
  });
});

describe('autoAssignorDecision — Carl: "the self-assign age is 14 in Au"', () => {
  const today = new Date('2026-08-25');

  it('uses the domain constant, which is 14', () => {
    expect(MIN_AGE_SELF_ASSIGN).toBe(14);
  });

  it('makes a 14-year-old their own assignor without asking anybody', () => {
    const fourteenToday = new Date('2012-08-25');
    expect(autoAssignorDecision({ dateOfBirth: fourteenToday, at: today })).toEqual({
      auto: true,
      assignorIsPatient: true,
    });
  });

  it('leaves a 13-year-old to a person — a parent may have to sign, and choosing who is not ours', () => {
    const thirteen = new Date('2012-08-26');
    expect(autoAssignorDecision({ dateOfBirth: thirteen, at: today })).toEqual({
      auto: false,
      reason: 'under_self_assign_age',
    });
  });

  it('refuses to guess when there is no date of birth', () => {
    expect(autoAssignorDecision({ dateOfBirth: null, at: today })).toEqual({ auto: false, reason: 'dob_unknown' });
    expect(autoAssignorDecision({ dateOfBirth: undefined, at: today })).toEqual({
      auto: false,
      reason: 'dob_unknown',
    });
  });
});

describe('remoteChannelFor', () => {
  it('prefers email when both are held — the patient keeps a copy', () => {
    expect(remoteChannelFor({ email: 'a@example.invalid', mobile: '+61400000000' })).toBe('email_link');
  });

  it('falls back to SMS', () => {
    expect(remoteChannelFor({ email: null, mobile: '+61400000000' })).toBe('sms_link');
    expect(remoteChannelFor({ email: '   ', mobile: '+61400000000' })).toBe('sms_link');
  });

  it('returns null when nothing could receive a link — the caller must not draft', () => {
    expect(remoteChannelFor({ email: null, mobile: null })).toBeNull();
    expect(remoteChannelFor({})).toBeNull();
  });
});
