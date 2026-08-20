import { Module } from '@nestjs/common';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';
import { RULE_SET_REGISTRY, RuleSetRegistry } from './rule-set';
import { createDraftRuleSet2026_08 } from './rule-set-2026-08.draft';

@Module({
  controllers: [RulesController],
  providers: [
    RulesService,
    {
      provide: RULE_SET_REGISTRY,
      useFactory: () => {
        const registry = new RuleSetRegistry();
        // ⚠ HUMAN-AUTHORED ZONE. A DRAFT set exists (rule-set-2026-08.draft.ts,
        // agent-authored at Carl's instruction, pending line-by-line review)
        // but it registers ONLY behind an explicit flag — the production
        // default stays the honest 501 until the draft is signed off.
        if (process.env.RULES_REGISTER_DRAFT_SET === 'true') {
          console.warn(
            '[rules] RULES_REGISTER_DRAFT_SET=true — registering the DRAFT s 65C rule set (draft-2026-08). ' +
              'This set is agent-authored and pending human review; do not rely on it for real agreements.',
          );
          registry.register(createDraftRuleSet2026_08(), { current: true });
        }
        return registry;
      },
    },
  ],
  exports: [RulesService],
})
export class RulesModule {}
