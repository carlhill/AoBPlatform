import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import type { RuleResult, ValidationResponse, ValidationStage } from '@aobplatform/contracts';
import { RULE_SET_REGISTRY, RuleSetRegistry } from './rule-set';
import type { ValidationPayload } from './rules-payload';

@Injectable()
export class RulesService {
  constructor(@Inject(RULE_SET_REGISTRY) private readonly registry: RuleSetRegistry) {}

  validate(payload: ValidationPayload, ruleSetVersion?: string, stage: ValidationStage = 'storage'): ValidationResponse {
    const ruleSet = this.registry.get(ruleSetVersion);
    if (!ruleSet) {
      // Honest failure, never a passthrough: a validator that silently
      // approves while the rules are unwritten would be worse than no
      // validator — signing an unvalidated payload is the criminal offence
      // this product exists to prevent (REQ-REG-06).
      throw new NotImplementedException(
        ruleSetVersion
          ? `Rule set ${ruleSetVersion} is not registered.`
          : 'No s 65C rule set is registered yet. The rule implementations are a human-authored zone ' +
            '(CLAUDE.md §7) — see src/rules/rule-set.ts and the conformance suite in rule-set.contract.ts.',
      );
    }
    const results: RuleResult[] = ruleSet.evaluate(payload, stage);
    return {
      valid: !results.some((r) => r.outcome === 'fail'),
      results,
      ruleSetVersion: ruleSet.version,
      mappingVersion: ruleSet.mappingVersion,
    };
  }

  versions(): { versions: string[] } {
    return { versions: this.registry.versions() };
  }
}
