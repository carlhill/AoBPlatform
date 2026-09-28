import { Module } from '@nestjs/common';
import { PmsModule } from '../pms/pms.module';
import { ArrivalsModule } from '../arrivals/arrivals.module';
import { AgreementsModule } from '../agreements/agreements.module';
import { CaptureModule } from '../capture/capture.module';
import { AutoCaptureModule } from '../auto-capture/auto-capture.module';
import { InboundPrintJobsService } from './inbound-print-jobs.service';
import { InboundPrintJobsProcessor } from './inbound-print-jobs.processor';
import { Db4AssignmentHandler } from './db4-assignment.handler';
import { InboundLaneWorkerService } from './inbound-lane.worker';
import { InboundPrintJobsController } from './inbound-print-jobs.controller';

/**
 * The print channel's landing point — CONSULTATION-CAPTURE-PLAN.md Part 8
 * (the queue, 8.4) and Part 9 (the lanes). Item 3 of the build order.
 *
 * Above AutoCaptureModule in the import graph, for the same reason that
 * module sits above everything it uses: this only decides WHEN the cascade
 * runs for a print job, and records what happened. The cascade decides
 * everything else.
 *
 * AND ABOVE `ArrivalsModule`, FOR THE SAME REASON AND ONE MORE. A DB4 printed
 * to AOBPRINTER is precisely a post-service event, so `Db4AssignmentHandler`
 * asks `ArrivalsService.serviceRendered` rather than reimplementing the
 * post-service policy, the service record, the draft and the lock — one code
 * path for the regulated decision, reached through the service that owns it,
 * never at its tables (CLAUDE.md §4).
 */
@Module({
  /*
   * `AgreementsModule` AND `CaptureModule` ARE HERE FOR THE CORRECTED-REPRINT
   * PATH (28 September 2026). A DB4 whose particulars changed supersedes the
   * agreement it made, and the handler asks the services that own those
   * writes rather than doing them itself — the same posture it already takes
   * with `ArrivalsService` for the placement.
   */
  imports: [PmsModule, ArrivalsModule, AutoCaptureModule, AgreementsModule, CaptureModule],
  controllers: [InboundPrintJobsController],
  providers: [InboundPrintJobsService, InboundPrintJobsProcessor, Db4AssignmentHandler, InboundLaneWorkerService],
  exports: [InboundPrintJobsService],
})
export class InboundModule {}
