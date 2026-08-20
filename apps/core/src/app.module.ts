import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';

/**
 * Thin wiring only. Feature modules (M1 onboarding, M2 capture, M3
 * verification, M5 enduring, M6 notices, M7 reconciliation, M8 portal, M12
 * console, M13 campaigns, M14 language) are added here as they are built —
 * one Nest module per M-module, module APIs only, no cross-module table
 * access (CLAUDE.md §4).
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), HealthModule],
})
export class AppModule {}
