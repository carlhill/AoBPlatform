import { Global, Module } from '@nestjs/common';
import { OutboundService } from './outbound.service';
import { OutboundWorkerService } from './outbound-worker.service';

/**
 * Global, because the enqueue has to be reachable from inside any transaction
 * that writes something which must then leave the platform. Making callers
 * import a module to get transactional atomicity would mean some of them
 * quietly not bothering.
 */
@Global()
@Module({
  providers: [OutboundService, OutboundWorkerService],
  exports: [OutboundService],
})
export class OutboundModule {}
