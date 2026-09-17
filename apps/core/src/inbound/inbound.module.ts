import { Module } from '@nestjs/common';
import { PmsModule } from '../pms/pms.module';
import { ArrivalsModule } from '../arrivals/arrivals.module';
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
  imports: [PmsModule, ArrivalsModule, AutoCaptureModule],
  controllers: [InboundPrintJobsController],
  providers: [InboundPrintJobsService, InboundPrintJobsProcessor, Db4AssignmentHandler, InboundLaneWorkerService],
  exports: [InboundPrintJobsService],
})
export class InboundModule {}
