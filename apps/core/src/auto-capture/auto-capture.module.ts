import { Module } from '@nestjs/common';
import { PmsModule } from '../pms/pms.module';
import { AgreementsModule } from '../agreements/agreements.module';
import { CaptureModule } from '../capture/capture.module';
import { EnduringModule } from '../enduring/enduring.module';
import { OutboundModule } from '../outbound/outbound.module';
import { MessagingModule } from '../messaging/messaging.module';
import { AutoCaptureService } from './auto-capture.service';
import { AutoCaptureController } from './auto-capture.controller';
import { CaptureLinkDispatcher } from './capture-link.dispatcher';

/**
 * The capture cascade run by the platform, with nobody at the practice
 * deciding first — CONSULTATION-CAPTURE-PLAN.md Parts 2 and 3.
 *
 * ONE LAYER ABOVE EVERYTHING IT USES. Agreements, capture, enduring coverage,
 * the outbound queue and the PMS mirror all exist and all work; this module
 * only decides WHEN to call them and records WHY when it does not. It sits
 * above them in the import graph so nothing below has to know it exists.
 */
@Module({
  imports: [PmsModule, AgreementsModule, CaptureModule, EnduringModule, OutboundModule, MessagingModule],
  controllers: [AutoCaptureController],
  providers: [AutoCaptureService, CaptureLinkDispatcher],
  exports: [AutoCaptureService],
})
export class AutoCaptureModule {}
