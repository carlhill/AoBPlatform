import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';

/**
 * Rules & Conformance service (M4). Holds ZERO PII — it is the only component
 * with an anonymous public attack surface (the free tester), so it has nothing
 * to leak (ADR A-07).
 *
 * ⚠ HUMAN-AUTHORED ZONE (CLAUDE.md §7): the s 65C rule implementations
 * (C1–C14), rule-set versioning, and mapping ingest are written and reviewed
 * by humans. Agents may assist with tests, review, and refactors — not author
 * them wholesale. The evaluation contract callers use is
 * @aobplatform/contracts (rules-engine.ts).
 */
import { RulesModule } from './rules/rules.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), HealthModule, RulesModule],
})
export class AppModule {}
