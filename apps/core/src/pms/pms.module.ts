import { Module } from '@nestjs/common';
import { MockPmsAdapter } from '@aobplatform/connector';
import { PMS_ADAPTER } from './pms.tokens';
import { PmsSyncService } from './pms-sync.service';
import { WriteBackService } from './write-back.service';
import { PmsController } from './pms.controller';
import { RenderModule } from '../render/render.module';

/**
 * M9 — PMS integration behind the FR-9.1 contract. The ONLY adapter until
 * decision D-01 (Medtech write-back mechanism) resolves is the mock; the real
 * MedtechEvolutionAdapter arrives behind the same interface via the
 * site-installed connector. Nothing outside this module knows which PMS is
 * behind the contract (C12.2).
 */
@Module({
  imports: [RenderModule],
  controllers: [PmsController],
  providers: [{ provide: PMS_ADAPTER, useClass: MockPmsAdapter }, PmsSyncService, WriteBackService],
  exports: [PMS_ADAPTER, WriteBackService],
})
export class PmsModule {}
