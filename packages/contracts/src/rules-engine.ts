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

export interface ValidationRequest {
  /** The agreement payload — s 65C particulars shape, defined in @aobplatform/domain. */
  readonly payload: unknown;
  /** Omit to validate against the current rule-set version. */
  readonly ruleSetVersion?: string;
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
