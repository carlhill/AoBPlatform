import { Module } from '@nestjs/common';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { CaptureModule } from '../capture/capture.module';
import { AutoCaptureModule } from '../auto-capture/auto-capture.module';

@Module({
  imports: [CaptureModule, AutoCaptureModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
