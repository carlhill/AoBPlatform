import { Module } from '@nestjs/common';
import { MockPmsAdapter } from '@aobplatform/connector';
import { PMS_ADAPTER } from './pms.tokens';
import { PmsSyncService } from './pms-sync.service';
import { WriteBackService } from './write-back.service';
import { RenderModule } from '../render/render.module';

/**
 * M9 — PMS integration behind the FR-9.1 contract. The ONLY adapter until
 * decision D-01 (Medtech write-back mechanism) resolves is the mock; the real
 * adapters — the print-capture one first (CONSULTATION-CAPTURE-PLAN.md Part 8),
 * a Medtech API one if a practice pays for it — arrive behind the same
 * interface. Nothing outside this module knows which PMS is behind the
 * contract (C12.2).
 *
 * NO CONTROLLER HERE ANY MORE. `POST /pms/sync` moved to `AutoCaptureModule`,
 * because "sync the invoices" is no longer the whole action — what the
 * practice means by it is "sync, and ask the patients we now know we have to
 * ask". That orchestration needs `AgreementsService`, and `AgreementsModule`
 * imports this module for write-back, so it cannot live here without a cycle.
 * The mirror step stays here, pure; the deciding happens one layer up.
 */
@Module({
  imports: [RenderModule],
  providers: [{ provide: PMS_ADAPTER, useClass: MockPmsAdapter }, PmsSyncService, WriteBackService],
  exports: [PMS_ADAPTER, PmsSyncService, WriteBackService],
})
export class PmsModule {}
