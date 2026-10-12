import { Module } from '@nestjs/common';
import { VerificationModule } from '../verification/verification.module';
import { PatientsModule } from '../patients/patients.module';
import { ReviewTasksModule } from '../review-tasks/review-tasks.module';
import { OutboundModule } from '../outbound/outbound.module';
import { PractitionerQueueModule } from '../practitioner-queue/practitioner-queue.module';
import { TelehealthController } from './telehealth.controller';
import { TelehealthService } from './telehealth.service';
import { TelehealthEvidence } from './telehealth-evidence';
import { TelehealthLinkDispatcher } from './telehealth-link.dispatcher';

/**
 * TELEHEALTH (TELEHEALTH-PLAN.md §8 step 2), behind `TELEHEALTH_ENABLED`,
 * default off. A leaf: nothing imports it. `telehealth_sessions` is this
 * module's table; patients, verification, review tasks and the outbound queue
 * are reached through their own modules' services (CLAUDE.md §4).
 */
@Module({
  imports: [VerificationModule, PatientsModule, ReviewTasksModule, OutboundModule, PractitionerQueueModule],
  controllers: [TelehealthController],
  providers: [TelehealthService, TelehealthEvidence, TelehealthLinkDispatcher],
  exports: [TelehealthService, TelehealthEvidence],
})
export class TelehealthModule {}
