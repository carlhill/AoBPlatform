import { Global, Module } from '@nestjs/common';
import { CorrespondenceService } from './correspondence.service';
import { CorrespondenceController } from './correspondence.controller';

/**
 * The evidence record of every send — CONSULTATION-CAPTURE-PLAN.md Part 4,
 * build-order item 5.
 *
 * GLOBAL, deliberately, and it is the only feature module that is. Every
 * sender (the outbound queue, the 89AA notices, the practitioner's personal
 * messages) must write here in its own transaction, and a module each of
 * them has to remember to import is a module one of them will forget — which
 * is exactly how outbound_items came to have no evidence twin. Depends only
 * on Prisma and configuration, so being global creates no cycle.
 */
@Global()
@Module({
  controllers: [CorrespondenceController],
  providers: [CorrespondenceService],
  exports: [CorrespondenceService],
})
export class CorrespondenceModule {}
