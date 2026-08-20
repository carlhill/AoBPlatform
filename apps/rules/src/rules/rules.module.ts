import { Module } from '@nestjs/common';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';
import { RULE_SET_REGISTRY, RuleSetRegistry } from './rule-set';

@Module({
  controllers: [RulesController],
  providers: [
    RulesService,
    {
      provide: RULE_SET_REGISTRY,
      useFactory: () => {
        const registry = new RuleSetRegistry();
        // ⚠ HUMAN-AUTHORED ZONE: rule-set implementations are registered here
        // as they are written and reviewed, e.g.:
        //   registry.register(new RuleSet_2026_07(mapping_2026_07), { current: true });
        // Until then the registry is empty and /validate returns 501 — an
        // honest failure, never a passthrough.
        return registry;
      },
    },
  ],
  exports: [RulesService],
})
export class RulesModule {}
