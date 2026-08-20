import { Module } from '@nestjs/common';
import { AgreementsController } from './agreements.controller';
import { AgreementsService } from './agreements.service';
import { RulesClientModule } from '../rules-client/rules-client.module';
import { CaptureModule } from '../capture/capture.module';
import { RenderModule } from '../render/render.module';
import { PmsModule } from '../pms/pms.module';

@Module({
  imports: [RulesClientModule, CaptureModule, RenderModule, PmsModule],
  controllers: [AgreementsController],
  providers: [AgreementsService],
  exports: [AgreementsService],
})
export class AgreementsModule {}
