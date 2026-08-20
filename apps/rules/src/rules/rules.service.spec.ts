import { NotImplementedException } from '@nestjs/common';
import { RulesService } from './rules.service';
import { RuleSetRegistry, type RuleSet } from './rule-set';
import { ruleSetConformanceTests } from './rule-set.contract';

const fakeRuleSet: RuleSet = {
  version: 'test-1',
  mappingVersion: 'mapping-test-1',
  evaluate: (payload) => [
    {
      rule: 'C1',
      outcome: payload.patientName?.trim() ? 'pass' : 'fail',
      message: 'D1 patient name',
    },
  ],
};

describe('RulesService', () => {
  it('refuses to validate while no rule set is registered — 501, never a passthrough', () => {
    const service = new RulesService(new RuleSetRegistry());
    expect(() => service.validate({ patientName: 'x' })).toThrow(NotImplementedException);
  });

  it('validates against the registered current rule set and reports both versions', () => {
    const registry = new RuleSetRegistry();
    registry.register(fakeRuleSet, { current: true });
    const service = new RulesService(registry);

    const ok = service.validate({ patientName: 'Alex Testpatient' });
    expect(ok.valid).toBe(true);
    expect(ok.ruleSetVersion).toBe('test-1');
    expect(ok.mappingVersion).toBe('mapping-test-1');

    const bad = service.validate({ patientName: '' });
    expect(bad.valid).toBe(false);
  });

  it('refuses an unknown explicit version', () => {
    const registry = new RuleSetRegistry();
    registry.register(fakeRuleSet);
    const service = new RulesService(registry);
    expect(() => service.validate({}, 'no-such-version')).toThrow(NotImplementedException);
  });
});

describe('RuleSetRegistry', () => {
  it('rule sets are immutable content — re-registering a version throws (rule 14)', () => {
    const registry = new RuleSetRegistry();
    registry.register(fakeRuleSet);
    expect(() => registry.register({ ...fakeRuleSet })).toThrow(/never edited/);
  });
});

/**
 * The C1–C14 conformance suite runs against the human-authored rule set once
 * it is registered in rules.module.ts. Until then it runs against nothing and
 * is skipped — visibly, so the gap stays on the scoreboard.
 *
 * TODO(HUMAN): when the first rule set lands, replace `describe.skip` with
 * `describe` and pass a factory for the real implementation:
 *   describe('s 65C rule set 2026-07', () => ruleSetConformanceTests(() => new RuleSet_2026_07(mapping)));
 */
describe.skip('s 65C rule set conformance (awaiting human-authored implementation)', () => {
  ruleSetConformanceTests(() => {
    throw new Error('no rule set implemented yet');
  });
});
