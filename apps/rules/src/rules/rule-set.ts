import type { RuleResult } from '@aobplatform/contracts';
import type { ValidationPayload } from './rules-payload';

/**
 * ⚠ HUMAN-AUTHORED ZONE (CLAUDE.md §7). Implementations of this interface —
 * the actual s 65C rules C1–C14 — are written and reviewed by humans. The
 * regulatory facts (section numbers, the block/warn split, date tolerances)
 * come from `.claude/docs/aob-requirements.md` §3 (REQ-65C-01), never from
 * memory.
 *
 * Rule sets are VERSIONED CONTENT (rule 14, REQ-65C-02): a new regulation
 * version means a new RuleSet registered under a new version string — never
 * an in-place edit — and every stored agreement records the version that
 * validated it. The mapping version travels with the rule set because pre-
 * agreement rule C6 validates against a specific Basic Service Description
 * mapping.
 *
 * The conformance test suite an implementation must pass is
 * `ruleSetConformanceTests()` in ./rule-set.contract.ts — written first,
 * against this interface, so the human implementation drops in with zero new
 * test code.
 */
export interface RuleSet {
  readonly version: string;
  readonly mappingVersion: string;
  evaluate(payload: ValidationPayload): RuleResult[];
}

export class RuleSetRegistry {
  private readonly sets = new Map<string, RuleSet>();
  private currentVersion?: string;

  register(set: RuleSet, options?: { current?: boolean }): void {
    if (this.sets.has(set.version)) {
      throw new Error(`Rule set ${set.version} is already registered — rule sets are immutable content, never edited.`);
    }
    this.sets.set(set.version, set);
    if (options?.current || this.currentVersion === undefined) this.currentVersion = set.version;
  }

  get(version?: string): RuleSet | undefined {
    return this.sets.get(version ?? this.currentVersion ?? '');
  }

  versions(): string[] {
    return [...this.sets.keys()];
  }
}

export const RULE_SET_REGISTRY = Symbol('RULE_SET_REGISTRY');
