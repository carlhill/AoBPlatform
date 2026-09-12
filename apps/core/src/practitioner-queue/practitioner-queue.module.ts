import { Module } from '@nestjs/common';
import { AffiliationsModule } from '../affiliations/affiliations.module';
import { PractitionerQueueController } from './practitioner-queue.controller';
import { PractitionerQueueService } from './practitioner-queue.service';

/**
 * THE PRACTITIONER'S OWN QUEUE (PRACTITIONER-QUEUE-PAGE.md).
 *
 * ITS OWN MODULE RATHER THAN A METHOD ON THE TABLET DESK, for the reason §2
 * gives for the page existing at all: it answers a different question. The
 * desk's `pushable` list is WORK — agreements with somewhere left to go, signed
 * ones excluded by construction — and this is a REPORT, whose most important
 * answer is "Done", which that list can never contain. Bolting it on would have
 * meant one read serving two contradictory definitions of what belongs in it.
 *
 * IT OWNS NO TABLE. Every fact is somebody else's, read across tables on the
 * precedent `KioskService` and `ReconciliationService` set: a row that must say
 * "Jamie, 8:55, Not yet" cannot be built from one module's tables, and reading
 * owns nothing. It writes nothing at all, so there is no outbox event here and
 * no vault event — the vault stays untouched because nothing happened.
 *
 * IT IMPORTS `AffiliationsModule` FOR EXACTLY ONE THING: the cross-practice
 * read of a practitioner's own affiliations, which answers "which practice is
 * this person asking about" for a token that carries no practice claim. That is
 * a SECURITY DEFINER function scoped to the practitioner, already written for
 * `/practitioner/me`, and asking the module for it rather than re-issuing the
 * query keeps the one copy.
 */
@Module({
  imports: [AffiliationsModule],
  controllers: [PractitionerQueueController],
  providers: [PractitionerQueueService],
  exports: [PractitionerQueueService],
})
export class PractitionerQueueModule {}
