import {
  decideVisitAgreement,
  parseVisitPolicyContent,
  VISIT_POLICY_INPUTS,
  VISIT_POLICY_RULES,
  VISIT_POLICY_VERSION,
  type VisitPolicyInput,
} from './visit-policy';

/** Every combination of the four booleans — 16 visits, no examples cherry-picked. */
function everyInput(): VisitPolicyInput[] {
  const all: VisitPolicyInput[] = [];
  for (const providerIsGp of [true, false]) {
    for (const activeEnduringForProviderAndPatient of [true, false]) {
      for (const practiceOffersEnduringByDefault of [true, false]) {
        for (const patientDeclinedEnduring of [true, false]) {
          all.push({
            providerIsGp,
            activeEnduringForProviderAndPatient,
            practiceOffersEnduringByDefault,
            patientDeclinedEnduring,
          });
        }
      }
    }
  }
  return all;
}

const gpVisit: VisitPolicyInput = {
  providerIsGp: true,
  activeEnduringForProviderAndPatient: false,
  practiceOffersEnduringByDefault: true,
  patientDeclinedEnduring: false,
};

describe('the visit policy — what an arrival needs signed (hard rules 6 and 14)', () => {
  it('decides every possible visit: the table is total', () => {
    for (const input of everyInput()) {
      expect(() => decideVisitAgreement(input)).not.toThrow();
    }
  });

  /**
   * HARD RULE 6 / REQ-END-01a. Enduring is GP-only, and a specialist, allied
   * health provider or optometrist is never offered one. Proved against all
   * eight remaining combinations rather than one, because the mistake this
   * guards is a rule row added later that happens to match before the GP check.
   */
  it('visit_policy_never_offers_enduring_for_non_gp', () => {
    const nonGpVisits = everyInput().filter((input) => !input.providerIsGp);
    expect(nonGpVisits).toHaveLength(8);
    for (const input of nonGpVisits) {
      expect(decideVisitAgreement(input).type).not.toBe('enduring');
    }
    // And with nothing else in the way it is the episodic pre-agreement, not
    // silence: the visit still needs consent captured before the service.
    // (Treatment Plan Assignment, REQ-END-01a's alternative, is out of v1.)
    expect(decideVisitAgreement({ ...gpVisit, providerIsGp: false }).type).toBe('episodic_pre');
  });

  /**
   * HARD RULE 6 AGAIN, FROM THE OTHER SIDE. Coverage is per practitioner ×
   * patient: the SAME patient, on the SAME day, at the SAME practice, gets
   * `none` for the provider they already have an enduring agreement with and
   * `enduring` for the one they do not. The input list is asserted too — a
   * practice-wide coverage input is the one edit that would break this, and it
   * cannot be added without this test failing.
   */
  it('visit_policy_is_per_provider_not_per_practice', () => {
    const coveredProvider = decideVisitAgreement({ ...gpVisit, activeEnduringForProviderAndPatient: true });
    const otherProvider = decideVisitAgreement({ ...gpVisit, activeEnduringForProviderAndPatient: false });

    expect(coveredProvider.type).toBe('none');
    expect(otherProvider.type).toBe('enduring');

    expect([...VISIT_POLICY_INPUTS].sort()).toEqual(
      [
        'activeEnduringForProviderAndPatient',
        'patientDeclinedEnduring',
        'practiceOffersEnduringByDefault',
        'providerIsGp',
      ].sort(),
    );
    for (const rule of VISIT_POLICY_RULES) {
      for (const name of Object.keys(rule.when)) {
        expect(VISIT_POLICY_INPUTS).toContain(name);
      }
    }
  });

  /** Hard rule 14 — the answer is useless in 2028 without the table that gave it. */
  it('visit_policy_version_travels_with_the_decision', () => {
    for (const input of everyInput()) {
      expect(decideVisitAgreement(input).policyVersion).toBe(VISIT_POLICY_VERSION);
    }
    expect(VISIT_POLICY_VERSION).toBe('visit-policy-1');
  });

  it('names the rule that decided, so the console can say why', () => {
    expect(decideVisitAgreement(gpVisit).reason).toBe('gp_with_no_active_enduring');
    expect(decideVisitAgreement({ ...gpVisit, activeEnduringForProviderAndPatient: true }).reason).toBe(
      'already_covered_by_an_enduring_agreement',
    );
    expect(decideVisitAgreement({ ...gpVisit, providerIsGp: false }).reason).toBe('enduring_is_gp_only');
    expect(decideVisitAgreement({ ...gpVisit, patientDeclinedEnduring: true }).reason).toBe(
      'patient_declined_enduring',
    );
    expect(decideVisitAgreement({ ...gpVisit, practiceOffersEnduringByDefault: false }).reason).toBe(
      'practice_does_not_offer_enduring_by_default',
    );
  });

  /**
   * The pathway is content too (reg 65CA/65CB): `createDraft` refuses an
   * enduring agreement without one, so the row that answers `enduring` names
   * it and it travels with the decision.
   */
  it('an enduring decision carries the pathway its rule row names', () => {
    const decision = decideVisitAgreement(gpVisit);
    expect(decision.type).toBe('enduring');
    expect(decision.enduringPathway).toBe('mymedicare');
    // And nothing else does: a pathway on an episodic answer would be noise
    // the arrival could act on.
    expect(decideVisitAgreement({ ...gpVisit, providerIsGp: false }).enduringPathway).toBeUndefined();
    expect(
      decideVisitAgreement({ ...gpVisit, activeEnduringForProviderAndPatient: true }).enduringPathway,
    ).toBeUndefined();
  });

  it('a patient who declined an ongoing agreement is asked for the visit instead, not asked again', () => {
    expect(decideVisitAgreement({ ...gpVisit, patientDeclinedEnduring: true }).type).toBe('episodic_pre');
  });

  it('coverage is checked before eligibility: a covered patient is asked for nothing at all', () => {
    for (const input of everyInput().filter((i) => i.activeEnduringForProviderAndPatient)) {
      expect(decideVisitAgreement(input).type).toBe('none');
    }
  });
});

describe('the visit policy content file (versioned content, hard rule 14)', () => {
  const good = {
    version: 'test-1',
    rules: [
      { key: 'covered', when: { activeEnduringForProviderAndPatient: true }, type: 'none' },
      { key: 'fallback', when: {}, type: 'episodic_pre' },
    ],
  };

  it('accepts a well-formed table', () => {
    expect(parseVisitPolicyContent(good).version).toBe('test-1');
  });

  it('refuses a table that can fall through', () => {
    expect(() =>
      parseVisitPolicyContent({
        version: 'test-1',
        rules: [{ key: 'covered', when: { activeEnduringForProviderAndPatient: true }, type: 'none' }],
      }),
    ).toThrow(/LAST rule must have an empty/);
  });

  /**
   * The edit that would quietly break hard rule 6 — a condition naming
   * practice-wide coverage — is refused by name, with the reason in the
   * message so whoever tried it learns why rather than wondering.
   */
  it('refuses a condition that is not one of the four inputs', () => {
    expect(() =>
      parseVisitPolicyContent({
        version: 'test-1',
        rules: [
          { key: 'practice_wide', when: { activeEnduringAtThisPractice: true }, type: 'enduring', enduringPathway: 'mymedicare' },
          { key: 'fallback', when: {}, type: 'episodic_pre' },
        ],
      }),
    ).toThrow(/per practitioner x patient/);
  });

  it('refuses an unknown agreement type, a duplicate key and a missing version', () => {
    expect(() =>
      parseVisitPolicyContent({ version: 'x', rules: [{ key: 'a', when: {}, type: 'treatment_plan' }] }),
    ).toThrow(/must be one of/);
    expect(() =>
      parseVisitPolicyContent({
        version: 'x',
        rules: [
          { key: 'a', when: { providerIsGp: true }, type: 'enduring', enduringPathway: 'mymedicare' },
          { key: 'a', when: {}, type: 'episodic_pre' },
        ],
      }),
    ).toThrow(/appears twice/);
    expect(() => parseVisitPolicyContent({ rules: good.rules })).toThrow(/`version`/);
  });

  it('refuses an enduring row with no pathway, and an ACCHO/AMS one that anchors elsewhere', () => {
    expect(() =>
      parseVisitPolicyContent({
        version: 'x',
        rules: [
          { key: 'a', when: { providerIsGp: true }, type: 'enduring' },
          { key: 'fallback', when: {}, type: 'episodic_pre' },
        ],
      }),
    ).toThrow(/must name an enduringPathway/);
    expect(() =>
      parseVisitPolicyContent({
        version: 'x',
        rules: [
          { key: 'a', when: { providerIsGp: true }, type: 'enduring', enduringPathway: 'accho_ams' },
          { key: 'fallback', when: {}, type: 'episodic_pre' },
        ],
      }),
    ).toThrow(/must name an enduringPathway/);
    expect(() =>
      parseVisitPolicyContent({
        version: 'x',
        rules: [{ key: 'fallback', when: {}, type: 'episodic_pre', enduringPathway: 'mymedicare' }],
      }),
    ).toThrow(/only meaningful on a rule whose type is/);
  });

  it('refuses a non-boolean condition value', () => {
    expect(() =>
      parseVisitPolicyContent({
        version: 'x',
        rules: [
          { key: 'a', when: { providerIsGp: 'yes' }, type: 'enduring', enduringPathway: 'mymedicare' },
          { key: 'fallback', when: {}, type: 'episodic_pre' },
        ],
      }),
    ).toThrow(/must be a boolean/);
  });
});
