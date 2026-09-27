import { Module } from '@nestjs/common';
import { AgreementsController } from './agreements.controller';
import { AgreementsService } from './agreements.service';
import { SignedDb4Service } from './signed-db4.service';
import { RulesClientModule } from '../rules-client/rules-client.module';
import { PrintRecordsModule } from '../inbound/print-records.module';
import { CaptureModule } from '../capture/capture.module';
import { RenderModule } from '../render/render.module';
import { PmsModule } from '../pms/pms.module';
import { ArtefactsModule } from '../artefacts/artefacts.module';
import { PracticesModule } from '../practices/practices.module';
import { TemplatesModule } from '../templates/templates.module';

/**
 * ArtefactsModule, not the artefacts TABLE. A drawn signature stores its
 * strokes and its image through the evidence-artefact service that already
 * validates, hashes and vault-events every other piece of evidence — module to
 * module, never a second path into somebody else's rows (CLAUDE.md §4).
 */
@Module({
  // PracticesModule for the letterhead and TemplatesModule for the words: the
  // lock assembles the WHOLE document before it renders and hashes it, and
  // both of those are somebody else's module (CLAUDE.md §4).
  imports: [
    RulesClientModule,
    CaptureModule,
    RenderModule,
    PmsModule,
    ArtefactsModule,
    PracticesModule,
    TemplatesModule,
    /*
     * The Signed-DB4 is rendered from the DB4 Print Record, which belongs to
     * the inbound module. Through its SERVICE, never its table (CLAUDE.md §4)
     * — and through the LEAF half of it, because `InboundModule` reaches this
     * module back through `ArrivalsModule` and importing it would close a
     * cycle.
     */
    PrintRecordsModule,
  ],
  controllers: [AgreementsController],
  providers: [AgreementsService, SignedDb4Service],
  exports: [AgreementsService, SignedDb4Service],
})
export class AgreementsModule {}
