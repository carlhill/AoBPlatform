/**
 * THE POST-SERVICE TABLE — what a rendered service needs signed (hard rule 14).
 *
 * Its own file rather than more cases in `visit-policy.test.ts`, because it is
 * a different question asked at a different moment: the pre-service table
 * decides what to draft when somebody walks in, this one decides whether the
 * patient is handed the tablet a second time on their way out.
 */
import {
  decidePostServiceAgreement,
  parsePostServiceRules,
  POST_SERVICE_POLICY_INPUTS,
  POST_SERVICE_POLICY_RULES,
  VISIT_POLICY_VERSION,
  type PostServicePolicyInput,
} from './visit-policy';

/** Every combination of the two booleans — four services, no example cherry-picked. */
function everyService(): PostServicePolicyInput[] {
  const all: PostServicePolicyInput[] = [];
  for (const signedPreAgreementForProviderPatientAndDay of [true, false]) {
    for (const activeEnduringForProviderAndPatient of [true, false]) {
      all.push({ signedPreAgreementForProviderPatientAndDay, activeEnduringForProviderAndPatient });
    }
  }
  return all;
}

const uncovered: PostServicePolicyInput = {
  signedPreAgreementForProviderPatientAndDay: false,
  activeEnduringForProviderAndPatient: false,
};

describe('the post-service policy — what a rendered service needs signed', () => {
  it('decides every possible rendered service: the table is total', () => {
    for (const input of everyService()) {
      expect(() => decidePostServiceAgreement(input)).not.toThrow();
    }
  });

  it('post_service_push_drafts_an_episodic_post_from_the_rendered_service', () => {
    const decision = decidePostServiceAgreement(uncovered);
    expect(decision.outcome).toBe('episodic_post');
    expect(decision.reason).toBe('post_agreement_for_this_service');
  });

  it('a_covered_service_drafts_nothing_and_says_so', () => {
    const decision = decidePostServiceAgreement({
      ...uncovered,
      signedPreAgreementForProviderPatientAndDay: true,
    });
    expect(decision.outcome).toBe('covered');
    expect(decision.reason).toBe('covered_by_todays_agreement');
  });

  it("a live ongoing agreement is its own answer, not a second 'covered'", () => {
    const decision = decidePostServiceAgreement({
      ...uncovered,
      activeEnduringForProviderAndPatient: true,
    });
    expect(decision.outcome).toBe('covered_by_enduring');
    expect(decision.reason).toBe('covered_by_an_ongoing_agreement');
  });

  it("today's signed agreement is checked before the ongoing one: order is meaning", () => {
    const decision = decidePostServiceAgreement({
      signedPreAgreementForProviderPatientAndDay: true,
      activeEnduringForProviderAndPatient: true,
    });
    expect(decision.outcome).toBe('covered');
  });

  it('every decision carries the version of the table that made it (hard rule 14)', () => {
    for (const input of everyService()) {
      expect(decidePostServiceAgreement(input).policyVersion).toBe(VISIT_POLICY_VERSION);
    }
  });

  it('the shipped table ends in a row that matches everything', () => {
    const last = POST_SERVICE_POLICY_RULES[POST_SERVICE_POLICY_RULES.length - 1];
    expect(Object.keys(last.when)).toHaveLength(0);
  });

  it('offers no input for the containment check, which the mapping does not support yet', () => {
    // REQ-REG-03's MBS item-to-description mapping does not exist
    // (CONSULTATION-CAPTURE-PLAN 3.1, "blocked"), so no rule may pretend to
    // ask whether the billed item falls inside a pre-agreement's description.
    expect(POST_SERVICE_POLICY_INPUTS).toEqual([
      'signedPreAgreementForProviderPatientAndDay',
      'activeEnduringForProviderAndPatient',
    ]);
    expect(() =>
      parsePostServiceRules({
        postServiceRules: [
          { key: 'a', when: { itemInsidePreAgreementDescription: true }, outcome: 'covered' },
          { key: 'b', when: {}, outcome: 'episodic_post' },
        ],
      }),
    ).toThrow(/itemInsidePreAgreementDescription/);
  });

  it('refuses a table that can fall through', () => {
    expect(() =>
      parsePostServiceRules({
        postServiceRules: [
          { key: 'only', when: { activeEnduringForProviderAndPatient: true }, outcome: 'covered_by_enduring' },
        ],
      }),
    ).toThrow(/LAST postServiceRules row/);
  });

  it('refuses an outcome it has never heard of, and a duplicate key', () => {
    expect(() =>
      parsePostServiceRules({ postServiceRules: [{ key: 'a', when: {}, outcome: 'enduring' }] }),
    ).toThrow(/outcome must be one of/);
    expect(() =>
      parsePostServiceRules({
        postServiceRules: [
          { key: 'a', when: { activeEnduringForProviderAndPatient: true }, outcome: 'covered' },
          { key: 'a', when: {}, outcome: 'episodic_post' },
        ],
      }),
    ).toThrow(/appears twice/);
  });

  it('refuses a missing table rather than defaulting one', () => {
    expect(() => parsePostServiceRules({ rules: [] })).toThrow(/postServiceRules/);
  });
});
