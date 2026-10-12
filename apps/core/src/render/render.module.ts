import { Module } from '@nestjs/common';
import { ArtefactsModule } from '../artefacts/artefacts.module';
import { RendererRegistry } from './renderer-registry';
import { ArtefactLogoLoader, LOGO_LOADER } from './logo-loader';

/**
 * The one deterministic render path (rule 13).
 *
 * IT DEPENDS ON THE ARTEFACT MODULE because the practice's letterhead logo is
 * an artefact, addressed by content hash, and it is embedded in the bytes of
 * every agreement that practice makes. Through the module's SERVICE, never its
 * tables (CLAUDE.md §4).
 */
@Module({
  imports: [ArtefactsModule],
  providers: [RendererRegistry, { provide: LOGO_LOADER, useClass: ArtefactLogoLoader }],
  exports: [RendererRegistry],
})
export class RenderModule {}
