import { Module } from '@nestjs/common';
import { AgreementsModule } from '../agreements/agreements.module';
import { AgreeService } from './agree.service';
import { AgreeController } from './agree.controller';

/**
 * The patient's approval from a link — CONSULTATION-CAPTURE-PLAN.md §3.3,
 * build-order item 4.
 *
 * Its own module rather than two more routes on `CaptureController`, because
 * it needs `AgreementsService` (to lock and sign) and `AgreementsModule`
 * imports `CaptureModule` — the same cycle that put the invoice cascade above
 * `PmsModule`. Small on purpose: it decides nothing about signing that
 * `AgreementsService` does not already decide.
 */
@Module({
  imports: [AgreementsModule],
  controllers: [AgreeController],
  providers: [AgreeService],
})
export class AgreeModule {}
