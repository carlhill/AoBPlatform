import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { VaultModule } from './vault/vault.module';
import { AgreementsModule } from './agreements/agreements.module';
import { DevSeedModule } from './dev-seed/dev-seed.module';
import { VerificationModule } from './verification/verification.module';
import { CaptureModule } from './capture/capture.module';
import { PracticesModule } from './practices/practices.module';
import { PmsModule } from './pms/pms.module';

/**
 * Thin wiring only. Feature modules (M1 onboarding, M2 capture, M3
 * verification, M5 enduring, M6 notices, M7 reconciliation, M8 portal, M12
 * console, M13 campaigns, M14 language) are added here as they are built —
 * one Nest module per M-module, module APIs only, no cross-module table
 * access (CLAUDE.md §4).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    VaultModule,
    AgreementsModule,
    VerificationModule,
    CaptureModule,
    PracticesModule,
    PmsModule,
    DevSeedModule,
    HealthModule,
  ],
})
export class AppModule {}
