import {
  anniversaryWarningBand,
  AUTOMATIC_CESSATION_TRIGGERS,
  daysUntilAnniversary,
  hasAnniversaryFuse,
  isBusinessDay,
  needsFourteenthBirthdayAction,
  requiresPostClaimNotice,
  terminationEffectiveDate,
  triggerAppliesTo,
  type BusinessDayCalendar,
} from './enduring';

const noHolidays: BusinessDayCalendar = { publicHolidays: new Set(), state: 'NSW' };
const nswLongWeekend: BusinessDayCalendar = {
  // Monday 5 Oct 2026 — NSW Labour Day.
  publicHolidays: new Set(['2026-10-05']),
  state: 'NSW',
};

describe('hospital_admission_does_not_end_aged_care_agreement (65CA(9))', () => {
  it('is not in the automatic cessation trigger set at all', () => {
    expect(AUTOMATIC_CESSATION_TRIGGERS).not.toContain('hospital_admission' as never);
    expect(AUTOMATIC_CESSATION_TRIGGERS).toHaveLength(6);
  });
});

describe('cessation triggers apply only to their own pathway', () => {
  it('MyMedicare deregistration never ceases an aged-care or ACCHO agreement', () => {
    expect(triggerAppliesTo('mymedicare_deregistered', 'mymedicare')).toBe(true);
    expect(triggerAppliesTo('mymedicare_deregistered', 'residential_aged_care')).toBe(false);
    expect(triggerAppliesTo('mymedicare_deregistered', 'accho_ams')).toBe(false);
  });
  it('leaving residential care ceases only the aged-care pathway', () => {
    expect(triggerAppliesTo('left_residential_aged_care', 'residential_aged_care')).toBe(true);
    expect(triggerAppliesTo('left_residential_aged_care', 'mymedicare')).toBe(false);
  });
  it('practitioner departure and the 14th birthday apply to every pathway', () => {
    for (const pathway of ['mymedicare', 'residential_aged_care', 'accho_ams'] as const) {
      expect(triggerAppliesTo('practitioner_left_location', pathway)).toBe(true);
      expect(triggerAppliesTo('patient_turned_14', pathway)).toBe(true);
    }
  });
});

describe('notices_are_mymedicare_only (REQ-END-05, C7.4)', () => {
  it('never for aged care or ACCHO', () => {
    expect(requiresPostClaimNotice('mymedicare')).toBe(true);
    expect(requiresPostClaimNotice('residential_aged_care')).toBe(false);
    expect(requiresPostClaimNotice('accho_ams')).toBe(false);
  });
});

describe('termination_is_two_business_days (REQ-END-06, REQ-OFF-03)', () => {
  it('skips weekends', () => {
    // Thursday 1 Oct 2026 + 2 business days = Monday 5 Oct.
    const effective = terminationEffectiveDate(new Date('2026-10-01T09:00:00Z'), noHolidays);
    expect(effective.toISOString().slice(0, 10)).toBe('2026-10-05');
  });

  it('skips state public holidays — a Friday notice before a long weekend lands differently per state', () => {
    // Same notice, NSW calendar with Mon 5 Oct a holiday ⇒ Tuesday 6 Oct.
    const effective = terminationEffectiveDate(new Date('2026-10-01T09:00:00Z'), nswLongWeekend);
    expect(effective.toISOString().slice(0, 10)).toBe('2026-10-06');
  });

  it('two calendar days is NOT the rule — a Friday notice does not take effect on Sunday', () => {
    const effective = terminationEffectiveDate(new Date('2026-10-02T09:00:00Z'), noHolidays);
    expect(effective.toISOString().slice(0, 10)).not.toBe('2026-10-04');
    expect(isBusinessDay(effective, noHolidays)).toBe(true);
  });
});

describe('anniversary_fuse_tracked (65CA(8)(e), REQ-END-03)', () => {
  it('applies to agreements entered on or before 30 June 2027, not after', () => {
    expect(hasAnniversaryFuse('2027-06-30')).toBe(true);
    expect(hasAnniversaryFuse('2027-07-01')).toBe(false);
  });

  it('counts down to the first anniversary', () => {
    const entered = new Date('2026-09-01T00:00:00Z');
    expect(daysUntilAnniversary(entered, new Date('2027-08-02T00:00:00Z'))).toBe(30);
  });

  it('warns at 90, 60 and 30 days — and stops once the fuse has blown', () => {
    const entered = new Date('2026-09-01T00:00:00Z');
    expect(anniversaryWarningBand(entered, new Date('2027-06-01T00:00:00Z'))).toBeNull(); // 92 days — outside
    expect(anniversaryWarningBand(entered, new Date('2027-06-10T00:00:00Z'))).toBe(90); // 83 days — inside
    expect(anniversaryWarningBand(entered, new Date('2027-07-15T00:00:00Z'))).toBe(60);
    expect(anniversaryWarningBand(entered, new Date('2027-08-10T00:00:00Z'))).toBe(30);
    expect(anniversaryWarningBand(entered, new Date('2027-01-01T00:00:00Z'))).toBeNull();
    expect(anniversaryWarningBand(entered, new Date('2027-09-05T00:00:00Z'))).toBeNull();
  });

  it('agreements entered after the cutoff carry no fuse to warn about', () => {
    expect(anniversaryWarningBand(new Date('2027-08-01T00:00:00Z'), new Date('2028-07-10T00:00:00Z'))).toBeNull();
  });
});

describe('fourteenth_birthday_is_deterministic (REQ-OFF-13, REQ-CHILD-05)', () => {
  const dob = new Date('2013-03-14T00:00:00Z'); // turns 14 on 2027-03-14

  it('prompts 30 days ahead when the patient is covered by someone else’s agreement', () => {
    expect(needsFourteenthBirthdayAction(dob, false, new Date('2027-02-20T00:00:00Z'))).toBe(true);
    expect(needsFourteenthBirthdayAction(dob, false, new Date('2027-01-01T00:00:00Z'))).toBe(false);
  });

  it('does not fire when the patient is their own assignor — nothing ceases', () => {
    expect(needsFourteenthBirthdayAction(dob, true, new Date('2027-03-13T00:00:00Z'))).toBe(false);
  });
});
