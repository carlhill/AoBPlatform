import { Module } from '@nestjs/common';
import { AgreementsController } from './agreements.controller';
import { AgreementsService } from './agreements.service';
import { RulesClientModule } from '../rules-client/rules-client.module';
import { CaptureModule } from '../capture/capture.module';
import { AGREEMENT_RENDERER, CanonicalJsonRenderer } from '../render/renderer';

@Module({
  imports: [RulesClientModule, CaptureModule],
  controllers: [AgreementsController],
  providers: [AgreementsService, { provide: AGREEMENT_RENDERER, useClass: CanonicalJsonRenderer }],
  exports: [AgreementsService],
})
export class AgreementsModule {}
