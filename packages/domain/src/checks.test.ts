import {
  CHECKLIST_VERSION,
  CHECK_CATALOGUE,
  CheckError,
  MINIMUM_SCORE,
  assertCheckRecordable,
  assessAdmission,
  checksInCategory,
  findCheck,
  summariseChecks,
  type CheckRecord,
} from './checks';

const record = (over: Partial<CheckRecord> = {}): CheckRecord => ({
  checkKey: 'entity.abn_active',
  outcome: 'passed',
  performedByName: 'Carl Hill',
  ...over,
});

describe('the catalogue', () => {
  it('is versioned, so a check can be read as it was performed', () => {
    expect(CHECKLIST_VERSION).toMatch(/^\d{4}-\d{2}-v\d+$/);
  });

  it('has no duplicate keys', () => {
    const keys = CHECK_CATALOGUE.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every check evidence guidance — a reviewer should never guess what to attach', () => {
    for (const check of CHECK_CATALOGUE) {
      expect(check.evidenceGuidance.length).toBeGreaterThan(20);
      expect(check.whatItProves.length).toBeGreaterThan(20);
    }
  });

  it('offers SEVERAL entitlement checks, because one is rarely enough', () => {
    expect(checksInCategory('entitlement').length).toBeGreaterThanOrEqual(4);
  });

  it('weights a call to an independently obtained number above a document', () => {
    // Documents are the easiest of these to fabricate.
    expect(findCheck('entitlement.phone_call')!.weight).toBe('STRONG');
    expect(findCheck('entitlement.document')!.weight).toBe('MODERATE');
  });
});

describe('recording a check', () => {
  it('accepts a well-formed pass', () => {
    expect(() => assertCheckRecordable(record())).not.toThrow();
  });

  it('refuses an unknown check key', () => {
    expect(() => assertCheckRecordable(record({ checkKey: 'vibes.good' }))).toThrow(/not a check in catalogue/);
  });

  it('refuses an unnamed performer', () => {
    expect(() => assertCheckRecordable(record({ performedByName: ' ' }))).toThrow(/is not a check/);
  });
});

describe('FAILED needs a reason AND words', () => {
  it('refuses a bare failure', () => {
    expect(() => assertCheckRecordable(record({ outcome: 'failed' }))).toThrow(/needs a reason from the list/);
  });

  it('refuses a reason code that is not on the list', () => {
    expect(() =>
      assertCheckRecordable(record({ outcome: 'failed', reasonCode: 'because', note: 'x' })),
    ).toThrow(CheckError);
  });

  it('refuses a reason code with no explanation', () => {
    expect(() =>
      assertCheckRecordable(record({ outcome: 'failed', reasonCode: 'identity_not_confirmed' })),
    ).toThrow(/must say what happened, in words/);
  });

  it('accepts a reason plus an explanation', () => {
    expect(() =>
      assertCheckRecordable(
        record({ outcome: 'failed', reasonCode: 'contact_denied_association', note: 'Reception had not heard of them.' }),
      ),
    ).not.toThrow();
  });
});

describe('COULD NOT COMPLETE is not a failure', () => {
  it('has its own reason list — "no answer" is not "they denied it"', () => {
    expect(() =>
      assertCheckRecordable(record({ outcome: 'could_not_complete', reasonCode: 'identity_not_confirmed' })),
    ).toThrow(/different facts about an applicant/);
  });

  it('accepts a reason from its own list', () => {
    expect(() =>
      assertCheckRecordable(record({ outcome: 'could_not_complete', reasonCode: 'no_answer' })),
    ).not.toThrow();
  });

  it('does not demand evidence — not getting through produces none', () => {
    expect(() =>
      assertCheckRecordable(
        record({ checkKey: 'entitlement.phone_call', outcome: 'could_not_complete', reasonCode: 'no_answer' }),
      ),
    ).not.toThrow();
  });
});

describe('NOT APPLICABLE must be explained', () => {
  it('refuses an unexplained one', () => {
    expect(() => assertCheckRecordable(record({ outcome: 'not_applicable' }))).toThrow(/must say why/);
  });

  it('accepts an explained one — a sole trader has no manager to call', () => {
    expect(() =>
      assertCheckRecordable(record({ outcome: 'not_applicable', note: 'Sole trader; there is no second contact.' })),
    ).not.toThrow();
  });
});

describe('evidence is demanded of a PASS, and only a pass', () => {
  const phoneCall = {
    checkKey: 'entitlement.phone_call',
    performedByName: 'Carl Hill',
    fields: { phoneNumber: '0298765432', numberSource: 'nhsd', spokeWithName: 'Reception' },
  };

  it('refuses a passing phone call with nothing attached, and says what to attach', () => {
    expect(() => assertCheckRecordable({ ...phoneCall, outcome: 'passed', artefactCount: 0 })).toThrow(
      /recording and its transcript/,
    );
  });

  it('accepts it once evidence is attached', () => {
    expect(() => assertCheckRecordable({ ...phoneCall, outcome: 'passed', artefactCount: 2 })).not.toThrow();
  });

  it('still requires the structured fields', () => {
    expect(() =>
      assertCheckRecordable({
        ...phoneCall,
        outcome: 'passed',
        artefactCount: 1,
        fields: { phoneNumber: '0298765432', numberSource: '', spokeWithName: 'Reception' },
      }),
    ).toThrow(/needs numberSource recorded/);
  });

  it('does not demand evidence of a check that does not require it', () => {
    expect(() => assertCheckRecordable(record({ checkKey: 'entity.abn_active', artefactCount: 0 }))).not.toThrow();
  });
});

describe('summarising, using the LATEST outcome per check', () => {
  it('lets a later attempt supersede an earlier one', () => {
    const summary = summariseChecks([
      { checkKey: 'entitlement.phone_call', outcome: 'could_not_complete', performedByName: 'A' },
      { checkKey: 'entitlement.phone_call', outcome: 'passed', performedByName: 'B' },
    ]);
    // Tuesday's unanswered call and Thursday's successful one are one check.
    expect(summary.performed).toBe(1);
    expect(summary.entitlementPassed).toBe(1);
  });

  it('counts several DIFFERENT entitlement checks separately', () => {
    const summary = summariseChecks([
      { checkKey: 'entitlement.phone_call', outcome: 'passed', performedByName: 'A' },
      { checkKey: 'entitlement.domain_match', outcome: 'passed', performedByName: 'A' },
    ]);
    expect(summary.entitlementPassed).toBe(2);
    expect(summary.score).toBe(5); // STRONG 3 + MODERATE 2
  });

  it('scores nothing for a failed or incomplete check', () => {
    const summary = summariseChecks([
      { checkKey: 'entitlement.phone_call', outcome: 'failed', performedByName: 'A' },
      { checkKey: 'entity.abn_active', outcome: 'could_not_complete', performedByName: 'A' },
    ]);
    expect(summary.score).toBe(0);
  });

  it('SUBTRACTS for a negative finding', () => {
    const summary = summariseChecks([
      { checkKey: 'entitlement.phone_call', outcome: 'passed', performedByName: 'A' },
      { checkKey: 'reputation.disposable_email', outcome: 'passed', performedByName: 'A' },
    ]);
    expect(summary.score).toBe(1); // 3 - 2
  });

  it('excludes not_applicable from the counts rather than treating it as failure', () => {
    const summary = summariseChecks([
      { checkKey: 'entitlement.phone_call', outcome: 'not_applicable', performedByName: 'A' },
    ]);
    expect(summary.notApplicable).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.score).toBe(0);
  });
});

describe('what hard enforcement WOULD decide', () => {
  const passing = summariseChecks([
    { checkKey: 'entitlement.phone_call', outcome: 'passed', performedByName: 'A' }, // 3, STRONG
    { checkKey: 'entitlement.hpio_delegation', outcome: 'passed', performedByName: 'A' }, // 3, STRONG
    { checkKey: 'entity.abn_active', outcome: 'passed', performedByName: 'A' }, // 2
  ]);

  it('admits a practice with the score and a strong check', () => {
    expect(passing.score).toBeGreaterThanOrEqual(MINIMUM_SCORE);
    expect(assessAdmission(passing).wouldPass).toBe(true);
  });

  it('REFUSES points made only of weak signals, however many', () => {
    const weakOnly = summariseChecks([
      { checkKey: 'entity.abn_active', outcome: 'passed', performedByName: 'A' },
      { checkKey: 'entity.abn_age', outcome: 'passed', performedByName: 'A' },
      { checkKey: 'address.confirmed', outcome: 'passed', performedByName: 'A' },
      { checkKey: 'address.ahpra_locality_match', outcome: 'passed', performedByName: 'A' },
    ]);
    // Eight points, no STRONG check, no entitlement — the exact shape the
    // two-part gate exists to refuse.
    expect(weakOnly.score).toBeGreaterThanOrEqual(MINIMUM_SCORE);
    const assessment = assessAdmission(weakOnly);
    expect(assessment.wouldPass).toBe(false);
    expect(assessment.reasons.join(' ')).toMatch(/No STRONG check/);
    expect(assessment.reasons.join(' ')).toMatch(/No entitlement check/);
  });

  it('explains a shortfall rather than just refusing', () => {
    const thin = summariseChecks([{ checkKey: 'entity.abn_active', outcome: 'passed', performedByName: 'A' }]);
    expect(assessAdmission(thin).reasons.join(' ')).toMatch(/below the 6 needed/);
  });
});
