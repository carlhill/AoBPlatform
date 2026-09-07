/**
 * ⏸ PENDING — THE ENDURING BRANCH OF THE s 65C RULE SET, WRITTEN AS TESTS SO
 * THAT CARL CAN AUTHOR AGAINST IT (Carl, 4 Sep 2026; GA-PLAN B5).
 *
 * ⚠ THIS FILE CONTAINS NO RULES. It is the conformance suite for rules that do
 * not exist yet. The rule set is a HUMAN-AUTHORED ZONE (CLAUDE.md §7) — a
 * wrong rule here is statutory exposure — so an agent may write the
 * expectations and may not write the implementation. Everything else the
 * enduring path needs was built on 4 September 2026: the practice setting, the
 * GP-only and per-practitioner checks on the push, the kiosk ceremony, the
 * decline path and the console copy. THIS is the last thing in the way, and
 * the platform says so on screen (`enduring_rules_not_authored`) rather than
 * pretending otherwise.
 *
 * HOW TO USE IT. Write the branch in a NEW rule-set version (rule sets are
 * immutable content — REQ-65C-02 — so this is never an edit to
 * `rule-set-2026-08.draft.ts`), change `describe.skip` below to `describe`,
 * point `makeRuleSet` at the new set, and make it green. Core needs nothing:
 * it asks the registered set about an enduring payload and refuses only while
 * the answer contains no verdict from `ENDURING_RULE_IDS`
 * (`answersEnduringRules`, packages/contracts/src/rules-engine.ts). The moment
 * this suite passes, enduring pushes stop being refused.
 *
 * WHERE EVERY EXPECTATION COMES FROM. `.claude/docs/aob-requirements.md` —
 * REQ-REG-01 (the s 65C(4) data set), REQ-END-01/-01a/-02/-05/-06/-06a/-07,
 * REQ-TEST-02 ("for enduring forms, reg 65CB") — and CLAUDE.md's hard rules 4
 * and 6. Nothing below is inferred from training data: this regime changed in
 * 2025–26 and a rule invented here would be worse than a missing one.
 *
 * THE RULE IDS ARE A PROPOSAL. REQ-65C-01's table stops at C14, so the
 * enduring obligations are a NEW family (E1–E8) rather than an extension of
 * it. Renaming or re-cutting them is a human decision — core asks only that
 * the answer is not silence.
 *
 * ── OPEN QUESTIONS FOR CARL, flagged rather than decided ──
 *
 *  1. E6's threshold. REQ-END-02 requires a "patient written declaration
 *     (patient 14+ where not the assignor)"; the age itself is the same 14
 *     that REQ-OFF-13 and the domain's `MIN_AGE_SELF_ASSIGN` use. Whether the
 *     rule set should ASSERT it (it cannot see a date of birth — the payload
 *     carries no age) or whether the domain remains its only home is a
 *     decision. Written below as a rule about the DECLARATION FLAG the domain
 *     supplies, which is the only honest thing a zero-PII validator can check.
 *  2. E8 and the pathway list. `mymedicare | residential_aged_care |
 *     accho_ams` are the three the codebase already models (`EnduringPathway`,
 *     `CreateAgreementDto`). If reg 65CB names them differently, the DOC wins
 *     and this suite changes.
 *  3. Whether D2 (agreement date) for an enduring agreement is also its start
 *     date, or whether reg 65CB has a separate commencement element. The
 *     requirements doc does not say, so nothing below asserts one.
 */

import { ENDURING_RULE_IDS, type RuleResult } from '@aobplatform/contracts';
import type { RuleSet } from '../src/rules/rule-set';
import type { ValidationPayload } from '../src/rules/rules-payload';

/**
 * A COMPLETE ENDURING PAYLOAD as core assembles it today
 * (`AgreementsService.prepareLock`). Note what is ABSENT and is meant to be:
 * no `serviceDate` and no `basicServiceDescription` — see E7.
 */
const validEnduring = (): ValidationPayload => ({
  // The s 65C(4) elements that still apply, unchanged (REQ-REG-01).
  patientName: 'Alex Testpatient',
  agreementDate: '2026-09-04',
  agreementType: 'enduring',
  providerName: 'Dr Example Provider',
  providerAddress: '1 Example Street, Sampletown NSW 2000',
  assignorIsPatient: true,
  signaturePresent: true,
  signatureMethod: 'drawn',
  signatureTimestamp: '2026-09-04T09:30:00.000Z',
  particularsLockedAt: '2026-09-04T09:29:00.000Z',
  verificationPassed: true,

  // reg 65CB's own content set (REQ-END-02).
  enduringDeclaration: true,
  enduringPathway: 'mymedicare',
  anchorKind: 'provider',
  coveredServiceScopeType: 'mbs_group',
  coveredServiceClasses: ['A1'],
  notificationMethod: 'sms',
  terminationMethod: 'written_notice',
  providerType: 'general_practitioner',
  patientDeclarationPresent: true,
});

const outcomeOf = (results: readonly RuleResult[], rule: string): string | undefined =>
  results.find((r) => r.rule === rule)?.outcome;

/**
 * ⏸ REMOVE `.skip` WHEN THE BRANCH IS WRITTEN, and point this at the new rule
 * set. It throws today so that nobody can flip the flag and get a green suite
 * for a set that does not exist.
 */
const makeRuleSet = (): RuleSet => {
  throw new Error(
    'The enduring branch of the s 65C rule set has not been authored yet (human-authored zone, CLAUDE.md §7). ' +
      'Register the new rule-set version and return it here.',
  );
};

describe.skip('s 65C rule set — the ENDURING branch (reg 65CB). PENDING: human-authored', () => {
  let ruleSet: RuleSet;
  beforeEach(() => {
    ruleSet = makeRuleSet();
  });

  describe('baseline', () => {
    it('a complete enduring agreement produces no fail outcomes', () => {
      expect(ruleSet.evaluate(validEnduring()).filter((r) => r.outcome === 'fail')).toEqual([]);
    });

    /**
     * THE ONE THING CORE CHECKS FOR. Whatever the family is finally called, an
     * enduring payload must come back with a verdict from it — silence is not
     * a pass, and core refuses to lock on silence.
     */
    it('answers the enduring family, so core can tell an authored branch from an absent one', () => {
      const answered = ruleSet
        .evaluate(validEnduring())
        .map((r) => r.rule)
        .filter((rule) => (ENDURING_RULE_IDS as readonly string[]).includes(rule));
      expect(answered.length).toBeGreaterThan(0);
    });

    it('every result carries a plain-English message (REQ-TEST-06)', () => {
      for (const r of ruleSet.evaluate(validEnduring())) expect(r.message.length).toBeGreaterThan(0);
    });
  });

  /**
   * E1 — the enduring declaration itself (reg 65CB content set, REQ-END-02).
   * The first item on that list is that the agreement DECLARES itself an
   * enduring one. Without it the artefact is an episodic agreement wearing the
   * wrong label.
   */
  describe('E1 — enduring declaration present (Block)', () => {
    it('fails when the declaration is absent', () => {
      const payload = { ...validEnduring(), enduringDeclaration: undefined };
      expect(outcomeOf(ruleSet.evaluate(payload), 'E1')).toBe('fail');
    });

    it('does not apply to an episodic agreement', () => {
      const results = ruleSet.evaluate({ ...validEnduring(), agreementType: 'episodic_pre' });
      expect(outcomeOf(results, 'E1')).not.toBe('fail');
    });
  });

  /**
   * E2 — covered service classes (REQ-END-02 "covered service classes (MBS
   * Group/Subgroup)"; REQ-END-06a: scope may be set at MBS Category, Group,
   * Subgroup or Item level, or a combination).
   *
   * IT IS A COMMERCIAL COMMITMENT, not an admin field: once agreed, the
   * provider must bulk bill any in-scope service until termination
   * (REQ-END-06a). An empty scope is either a commitment to nothing or a
   * commitment to everything, and neither may be guessed at.
   *
   * NO AMOUNT, EVER (hard rule 4, REQ-REG-04) — a scope is a list of service
   * classes and never a price.
   */
  describe('E2 — covered service classes present and well-formed (Block)', () => {
    it.each([[[]], [undefined]])('fails on scope %p', (coveredServiceClasses) => {
      const payload = { ...validEnduring(), coveredServiceClasses: coveredServiceClasses as string[] };
      expect(outcomeOf(ruleSet.evaluate(payload), 'E2')).toBe('fail');
    });

    it.each([['mbs_category'], ['mbs_group'], ['mbs_subgroup'], ['mbs_item'], ['combination']])(
      'accepts scope level %s (REQ-END-06a)',
      (coveredServiceScopeType) => {
        const payload = { ...validEnduring(), coveredServiceScopeType };
        expect(outcomeOf(ruleSet.evaluate(payload), 'E2')).not.toBe('fail');
      },
    );

    it('fails when the scope carries a benefit or dollar amount (hard rule 4, REQ-REG-04)', () => {
      const payload = { ...validEnduring(), coveredServiceBenefitAmount: 41.4 };
      const results = ruleSet.evaluate(payload);
      // C11 already warns on any amount-shaped key; on an enduring scope it is
      // a block, because the scope is the thing a practice reads as a price
      // list if one is ever put in it.
      expect([outcomeOf(results, 'E2'), outcomeOf(results, 'C11')]).toContain('fail');
    });
  });

  /**
   * E3 — PER PRACTITIONER × PATIENT, NEVER PER PRACTICE (hard rule 6,
   * REQ-END-01: "Data model is practitioner × patient, not practice ×
   * patient"). The organisation anchor exists ONLY on the ACCHO/AMS pathway,
   * where the agreement is made with the organisation through its authorised
   * agent (REQ-END-01, addendum v3 §1.1; `validAnchorKindFor` in the domain).
   *
   * This is the single most consequential rule in the family: an agreement
   * that covered a whole practice would be a standing bulk-billing commitment
   * nobody at that practice individually made.
   */
  describe('E3 — one practitioner, one patient (Block)', () => {
    it('fails on a practice-wide anchor', () => {
      const payload = { ...validEnduring(), anchorKind: 'practice' };
      expect(outcomeOf(ruleSet.evaluate(payload), 'E3')).toBe('fail');
    });

    it('fails on an organisation anchor off the ACCHO/AMS pathway', () => {
      const payload = { ...validEnduring(), anchorKind: 'organisation', enduringPathway: 'mymedicare' };
      expect(outcomeOf(ruleSet.evaluate(payload), 'E3')).toBe('fail');
    });

    it('accepts an organisation anchor on the ACCHO/AMS pathway', () => {
      const payload = {
        ...validEnduring(),
        anchorKind: 'organisation',
        enduringPathway: 'accho_ams',
        providerType: undefined,
      };
      expect(outcomeOf(ruleSet.evaluate(payload), 'E3')).not.toBe('fail');
    });

    it('fails when no provider is identified on a provider-anchored agreement', () => {
      const payload = { ...validEnduring(), providerName: undefined, providerNumber: undefined };
      const results = ruleSet.evaluate(payload);
      // C4 (D4, s 65C(5)) already covers provider identification; E3 is about
      // the anchor being a single named practitioner rather than a place.
      expect([outcomeOf(results, 'E3'), outcomeOf(results, 'C4')]).toContain('fail');
    });
  });

  /**
   * E4 — GP-ONLY, PERMANENTLY (hard rule 6, REQ-END-01a; FAQ p. 38 as quoted
   * there: the exclusion covers a consultant physician or a specialist in a
   * speciality other than general practice). Specialists, allied health and
   * optometry have NO enduring pathway — episodic capture is their only
   * option, and the product offers a Treatment Plan Assignment instead.
   *
   * MISSING IS NOT GP. A payload that does not say fails, for the same reason
   * the push does: the cost of guessing is a standing commitment entered by
   * somebody with no pathway to enter it.
   */
  describe('E4 — the provider is a general practitioner (Block)', () => {
    it.each([['specialist'], ['allied_health'], ['optometrist'], ['nurse_practitioner'], ['other'], [undefined]])(
      'fails for provider type %p',
      (providerType) => {
        const payload = { ...validEnduring(), providerType: providerType as string };
        expect(outcomeOf(ruleSet.evaluate(payload), 'E4')).toBe('fail');
      },
    );

    it('passes for a general practitioner', () => {
      expect(outcomeOf(ruleSet.evaluate(validEnduring()), 'E4')).toBe('pass');
    });
  });

  /**
   * E5 — HOW EITHER PARTY REACHES THE OTHER (REQ-END-02: notification method
   * and termination method are both in the reg 65CB content set; REQ-END-06:
   * termination is by written notice, effective 2 business days later, and a
   * provider intending to terminate must notify the assignor beforehand).
   *
   * An agreement that does not say how it can be ended is an agreement the
   * patient cannot end, which is the opposite of what REQ-END-06 grants them.
   */
  describe('E5 — notification and termination methods present (Block)', () => {
    it('fails without a notification method', () => {
      const payload = { ...validEnduring(), notificationMethod: undefined };
      expect(outcomeOf(ruleSet.evaluate(payload), 'E5')).toBe('fail');
    });

    it('fails without a termination method', () => {
      const payload = { ...validEnduring(), terminationMethod: undefined };
      expect(outcomeOf(ruleSet.evaluate(payload), 'E5')).toBe('fail');
    });
  });

  /**
   * E6 — THE PATIENT'S OWN WRITTEN DECLARATION where somebody else is the
   * assignor and the patient is old enough to make one (REQ-END-02: "patient
   * written declaration (patient 14+ where not the assignor)"; reg 89A(2)(b)
   * requires keeping documents recording consent where the patient did not
   * sign — REQ-VUL-02).
   *
   * ⚠ SEE OPEN QUESTION 1. A zero-PII validator has no date of birth and can
   * only check the FLAG the domain supplies. If Carl would rather this live
   * entirely in the domain (`needsFourteenthBirthdayAction` and friends), drop
   * E6 and say so — the family is a proposal.
   */
  describe('E6 — patient declaration where the assignor is somebody else (Block)', () => {
    it('fails when the assignor is not the patient and no patient declaration is recorded', () => {
      const payload = {
        ...validEnduring(),
        assignorIsPatient: false,
        assignorName: 'Jamie Testassignor',
        assignorRelationship: 'parent',
        patientDeclarationPresent: undefined,
      };
      expect(outcomeOf(ruleSet.evaluate(payload), 'E6')).toBe('fail');
    });

    it('does not demand a declaration when the patient is the assignor', () => {
      const payload = { ...validEnduring(), patientDeclarationPresent: undefined };
      expect(outcomeOf(ruleSet.evaluate(payload), 'E6')).not.toBe('fail');
    });
  });

  /**
   * E7 — D5 AND D6a ARE EPISODIC ELEMENTS AND MUST NOT BE DEMANDED HERE.
   *
   * REQ-REG-01 defines D5 as "the date the service WILL BE (pre) or WAS (post)
   * rendered" and D6a as "basic description of the service — PRE-AGREEMENTS
   * ONLY". A standing agreement has neither: no single service date, and no
   * one description (its scope is E2's list of service classes). The current
   * draft set fails an enduring payload on C5 for exactly this reason, which
   * is the clearest evidence that the branch is missing rather than merely
   * strict.
   *
   * THIS IS THE RULE THAT CANNOT BE GOT WRONG QUIETLY. If C5 is left applying
   * to enduring, core will invent a service date to satisfy it — a particular
   * nobody stated, hashed into an artefact and rendered at a patient.
   */
  describe('E7 — no service date and no basic description are required (Block on demanding them)', () => {
    it('a valid enduring payload with neither D5 nor D6a produces no fail outcomes', () => {
      const payload = validEnduring();
      expect(payload.serviceDate).toBeUndefined();
      expect(payload.basicServiceDescription).toBeUndefined();
      expect(ruleSet.evaluate(payload).filter((r) => r.outcome === 'fail')).toEqual([]);
    });

    it('C5 does not fail an enduring agreement for a missing service date', () => {
      expect(outcomeOf(ruleSet.evaluate(validEnduring()), 'C5')).not.toBe('fail');
    });

    it('C6 does not fail an enduring agreement for a missing basic description', () => {
      expect(outcomeOf(ruleSet.evaluate(validEnduring()), 'C6')).not.toBe('fail');
    });

    /**
     * AND THE REVERSE, so C6 does not go on passing trivially: an enduring
     * payload that DOES carry a service date is stating something the
     * agreement type has no room for. Whether that is a block or a warn is
     * Carl's call; the suite asserts only that it is noticed.
     */
    it('notices a service date on an enduring agreement rather than ignoring it', () => {
      const payload = { ...validEnduring(), serviceDate: '2026-09-04' };
      const outcomes = ruleSet.evaluate(payload).map((r) => r.outcome);
      expect(outcomes).toEqual(expect.arrayContaining([expect.stringMatching(/fail|warn/)]));
    });
  });

  /**
   * E8 — THE PATHWAY, STATED EXPLICITLY. It decides which automatic cessation
   * triggers apply (REQ-END-07, 65CA(8)/(9)) and whether an 89AA notice is
   * ever sent at all: MyMedicare pathway ONLY, within 24 hours of each claim,
   * one-way and never chased (REQ-END-05, hard rule 7). A pathway inferred
   * later is a pathway that will be inferred wrongly once.
   */
  describe('E8 — enduring pathway explicit (Block)', () => {
    it('fails when no pathway is stated', () => {
      const payload = { ...validEnduring(), enduringPathway: undefined };
      expect(outcomeOf(ruleSet.evaluate(payload), 'E8')).toBe('fail');
    });

    it.each([['mymedicare'], ['residential_aged_care'], ['accho_ams']])(
      'accepts the %s pathway',
      (enduringPathway) => {
        const payload = { ...validEnduring(), enduringPathway, anchorKind: enduringPathway === 'accho_ams' ? 'organisation' : 'provider' };
        expect(outcomeOf(ruleSet.evaluate(payload), 'E8')).not.toBe('fail');
      },
    );

    it('fails on a pathway nobody has defined', () => {
      const payload = { ...validEnduring(), enduringPathway: 'hospital' };
      expect(outcomeOf(ruleSet.evaluate(payload), 'E8')).toBe('fail');
    });
  });

  /**
   * THE s 65C RULES THAT STILL APPLY UNCHANGED. Enduring adds obligations; it
   * removes only D5 and D6a (E7). These are here so that a branch written to
   * make E1–E8 green cannot quietly stop asking them.
   */
  describe('the C-rules that do not change for enduring', () => {
    it.each([
      ['C1', { patientName: '' }],
      ['C2', { agreementDate: undefined }],
      ['C4', { providerName: undefined, providerAddress: undefined, providerNumber: undefined }],
      ['C8', { assignorIsPatient: undefined }],
      ['C9', { signaturePresent: false }],
      ['C12', { particularsLockedAt: undefined }],
    ])('%s still blocks', (rule, patch) => {
      expect(outcomeOf(ruleSet.evaluate({ ...validEnduring(), ...patch }), rule)).toBe('fail');
    });

    it('C10 still blocks a practitioner signature field (abolished 1 July 2026, hard rule 3)', () => {
      const payload = { ...validEnduring(), practitionerSignature: 'anything' };
      expect(outcomeOf(ruleSet.evaluate(payload), 'C10')).toBe('fail');
    });

    it('C11 still catches a benefit amount (hard rule 4, REQ-REG-04)', () => {
      const payload = { ...validEnduring(), benefitAmount: 41.4 };
      expect(['fail', 'warn']).toContain(outcomeOf(ruleSet.evaluate(payload), 'C11'));
    });
  });
});
