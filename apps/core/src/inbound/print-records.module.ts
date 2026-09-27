import { Module } from '@nestjs/common';
import { PrintRecordsService } from './print-records.service';

/**
 * A LEAF MODULE, AND THAT IS THE POINT. It imports nothing, so any module may
 * import it without closing a cycle — which `InboundModule` cannot offer,
 * because it reaches `AgreementsModule` through `ArrivalsModule`.
 *
 * It is still the INBOUND module's door onto the inbound module's table
 * (CLAUDE.md §4): the split is by dependency weight, not by ownership. Both
 * services live in `src/inbound` and nothing outside that folder touches
 * `inbound_print_jobs`.
 */
@Module({
  providers: [PrintRecordsService],
  exports: [PrintRecordsService],
})
export class PrintRecordsModule {}
