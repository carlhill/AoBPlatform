import { Module } from '@nestjs/common';
import { PmsModule } from '../pms/pms.module';
import { AutoCaptureModule } from '../auto-capture/auto-capture.module';
import { InboundPrintJobsService } from './inbound-print-jobs.service';
import { InboundPrintJobsProcessor } from './inbound-print-jobs.processor';
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
 */
@Module({
  imports: [PmsModule, AutoCaptureModule],
  controllers: [InboundPrintJobsController],
  providers: [InboundPrintJobsService, InboundPrintJobsProcessor, InboundLaneWorkerService],
  exports: [InboundPrintJobsService],
})
export class InboundModule {}
