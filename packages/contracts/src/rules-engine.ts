/**
 * FR-4.1 — the Rules & Conformance engine evaluation contract.
 *
 * ⚠ HUMAN-AUTHORED ZONE: the rule implementations (s 65C rules C1–C14) live in
 * apps/rules and are written and reviewed by humans (CLAUDE.md §7). This file
 * defines only the contract every caller uses: validate pre-signature
 * (blocking), again at storage (assert), and from the public tester.
 *
 * The rules service holds ZERO PII (ADR A-07): payloads sent to it are the
 * s 65C particulars only, and nothing here is logged with values.
 */

/** Rule identifiers C1–C14 per REQ-65C-01, plus room for versioned additions. */
export type RuleId =
  | 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7'
  | 'C8' | 'C9' | 'C10' | 'C11' | 'C12' | 'C13' | 'C14'
  | (string & {});

export type RuleOutcome = 'pass' | 'fail' | 'warn';

export interface RuleResult {
  readonly rule: RuleId;
  readonly outcome: RuleOutcome;
  /** Plain-English finding with the regulation citation (REQ-TEST-06). */
  readonly message: string;
  readonly citation?: string;
}

/**
 * REQ-65C-01 runs the validator twice: BEFORE the signature control enables
 * (blocking) and again AT STORAGE (assert). Signature-dependent rules
 * (C9 signature present, C12 locked-before-signature) cannot be satisfied at
 * the pre-signature stage by definition — the stage tells the rule set which
 * obligations apply now and which are deferred to storage.
 */
export type ValidationStage = 'pre_signature' | 'storage';

export interface ValidationRequest {
  /** The agreement payload — s 65C particulars shape, defined in @aobplatform/domain. */
  readonly payload: unknown;
  /** Omit to validate against the current rule-set version. */
  readonly ruleSetVersion?: string;
  /** Defaults to 'storage' — the stricter stage. */
  readonly stage?: ValidationStage;
}

export interface ValidationResponse {
  readonly valid: boolean;
  readonly results: readonly RuleResult[];
  /** Rule 14 / REQ-65C-02: every response names the versions that produced it. */
  readonly ruleSetVersion: string;
  readonly mappingVersion: string;
}

export interface RulesEngineClient {
  validate(request: ValidationRequest): Promise<ValidationResponse>;
}

/**
 * THE ENDURING BRANCH'S RULE FAMILY — the boundary between what an agent may
 * build and what a human must author (Carl, 4 Sep 2026; GA-PLAN B5).
 *
 * WHY IT EXISTS AT ALL. Every enduring agreement is validated by the same
 * s 65C rules C1–C14 as an episodic one, except that D5 (service date) and D6a
 * (basic description) are episodic elements — a standing agreement has no
 * single service date and no one description — and reg 65CB adds a content set
 * of its own (REQ-END-02, REQ-TEST-02: "for enduring forms, reg 65CB"). Those
 * additional obligations are this family.
 *
 * SILENCE IS NOT A PASS, and that is the whole point of naming them here. The
 * registered rule set today has NO enduring branch: C6 skips D6a for the type
 * and passes trivially, and nothing asserts the pathway, the GP-only rule or
 * the per-practitioner anchor. A caller that simply read `valid: true` would
 * lock a standing commitment to bulk bill against rules nobody wrote. So core
 * requires the response to contain a verdict from THIS family before it will
 * lock an enduring agreement, and refuses with `enduring_rules_not_authored`
 * when it does not — the same idiom the assignor endpoint already applies to
 * C8 ("a rule set that returns no C8 verdict has not been asked the question").
 *
 * ⚠ THE IDS ARE A PROPOSAL, NOT A REGULATORY FACT. REQ-65C-01's table stops at
 * C14, so these are a new family rather than an extension of it, and their
 * content is written out — with the requirement each traces to — as a pending
 * conformance spec in `apps/rules/test/enduring-ruleset.pending.spec.ts`. That
 * spec is what the human author works against. Renaming or re-cutting the
 * family is a human decision; core asks only that the answer is not silence.
 */
export const ENDURING_RULE_IDS = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8'] as const;

export type EnduringRuleId = (typeof ENDURING_RULE_IDS)[number];

/**
 * DID THE RULE SET ANSWER THE ENDURING QUESTIONS AT ALL? One helper, used by
 * core before it locks and by the pending spec, so "the branch exists" has one
 * definition rather than two that drift.
 */
export function answersEnduringRules(results: readonly RuleResult[]): boolean {
  return results.some((result) => (ENDURING_RULE_IDS as readonly string[]).includes(result.rule));
}
