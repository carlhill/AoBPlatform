import { Module } from '@nestjs/common';
import { AgreementsController } from './agreements.controller';
import { AgreementsService } from './agreements.service';
import { RulesClientModule } from '../rules-client/rules-client.module';
import { CaptureModule } from '../capture/capture.module';
import { RenderModule } from '../render/render.module';
import { PmsModule } from '../pms/pms.module';
import { ArtefactsModule } from '../artefacts/artefacts.module';

/**
 * ArtefactsModule, not the artefacts TABLE. A drawn signature stores its
 * strokes and its image through the evidence-artefact service that already
 * validates, hashes and vault-events every other piece of evidence — module to
 * module, never a second path into somebody else's rows (CLAUDE.md §4).
 */
@Module({
  imports: [RulesClientModule, CaptureModule, RenderModule, PmsModule, ArtefactsModule],
  controllers: [AgreementsController],
  providers: [AgreementsService],
  exports: [AgreementsService],
})
export class AgreementsModule {}
