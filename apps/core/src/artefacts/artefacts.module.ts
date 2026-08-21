import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArtefactsController } from './artefacts.controller';
import { ArtefactsService } from './artefacts.service';
import { ARTEFACT_STORE, FilesystemArtefactStore } from './artefact-store';

/**
 * Evidence artefacts (IDENTITY-STRENGTH-DESIGN.md §4).
 *
 * The store is an interface with a filesystem implementation, on the same
 * pattern as the ABR client and the address validator. Production is object
 * storage in an Australian region, encrypted at rest — one class, not a
 * refactor, because the seam is already here.
 */
@Module({
  controllers: [ArtefactsController],
  providers: [
    ArtefactsService,
    {
      provide: ARTEFACT_STORE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new FilesystemArtefactStore(config.get<string>('ARTEFACT_STORE_ROOT', '/var/lib/aobplatform/artefacts')),
    },
  ],
  exports: [ArtefactsService],
})
export class ArtefactsModule {}
