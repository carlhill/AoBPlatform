import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { OutboundModule } from './outbound/outbound.module';
import { ActingAsModule } from './acting-as/acting-as.module';
import { ReviewTasksModule } from './review-tasks/review-tasks.module';
import { IdentityDashboardModule } from './identity-dashboard/identity-dashboard.module';
import { IdentityModule } from './identity/identity.module';
import { VaultModule } from './vault/vault.module';
import { AgreementsModule } from './agreements/agreements.module';
import { DevSeedModule } from './dev-seed/dev-seed.module';
import { VerificationModule } from './verification/verification.module';
import { CaptureModule } from './capture/capture.module';
import { PracticesModule } from './practices/practices.module';
import { PmsModule } from './pms/pms.module';
import { AutoCaptureModule } from './auto-capture/auto-capture.module';
import { InboundModule } from './inbound/inbound.module';
import { AgreeModule } from './agree/agree.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { EnduringModule } from './enduring/enduring.module';
import { NoticesModule } from './notices/notices.module';
import { OrganisationsModule } from './organisations/organisations.module';
import { AffiliationsModule } from './affiliations/affiliations.module';
import { DomainExceptionFilter } from './common/domain-exception.filter';
import { DatabaseExceptionFilter } from './common/database-exception.filter';
import { MessagingModule } from './messaging/messaging.module';
import { ArtefactsModule } from './artefacts/artefacts.module';

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
    MessagingModule,
    AuthModule,
    OutboundModule,
    ActingAsModule,
    ReviewTasksModule,
    IdentityModule,
    VaultModule,
    AgreementsModule,
    VerificationModule,
    CaptureModule,
    PracticesModule,
    OrganisationsModule,
    AffiliationsModule,
    IdentityDashboardModule,
    ArtefactsModule,
    PmsModule,
    AutoCaptureModule,
    InboundModule,
    AgreeModule,
    ReconciliationModule,
    EnduringModule,
    NoticesModule,
    DevSeedModule,
    HealthModule,
  ],
  // Registered as a provider rather than in main.ts so it applies in tests
  // too — a filter that only exists in production is a filter nothing proves.
  providers: [
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: APP_FILTER, useClass: DatabaseExceptionFilter },
  ],
})
export class AppModule {}
