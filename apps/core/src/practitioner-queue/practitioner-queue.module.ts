import { Module } from '@nestjs/common';
import { AffiliationsModule } from '../affiliations/affiliations.module';
import { ArrivalsModule } from '../arrivals/arrivals.module';
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
 * IT OWNS ONE TABLE AND READS EVERYBODY ELSE'S. Every fact on the LIST is
 * somebody else's, read across tables on the precedent `KioskService` and
 * `ReconciliationService` set: a row that must say "Jamie, 8:55, Not yet" cannot
 * be built from one module's tables. The one thing it owns is `visit_states` —
 * where a visit has got to, as somebody said it at the time (§3a) — and every
 * write to it carries its vault event in the same transaction (hard rule 11).
 *
 * IT STILL TOUCHES NO AGREEMENT. §3's rule against "buttons that act on an
 * agreement" stands: the write records attendance and nothing else — no
 * tablet is sent, no detail corrected, no patient moved.
 *
 * IT IMPORTS `AffiliationsModule` FOR EXACTLY ONE THING: the cross-practice
 * read of a practitioner's own affiliations, which answers "which practice is
 * this person asking about" for a token that carries no practice claim. That is
 * a SECURITY DEFINER function scoped to the practitioner, already written for
 * `/practitioner/me`, and asking the module for it rather than re-issuing the
 * query keeps the one copy.
 */
/*
 * IT IMPORTS `ArrivalsModule` FOR ONE THING (§3a rule 3, VISIT-CHECKLIST.md §6):
 * "Completed" is the service-rendered signal, and the decision about whether a
 * post-service agreement is owed belongs to `ArrivalsService.serviceRendered`
 * and to the versioned table behind it. Asking that service rather than
 * re-deciding here is hard rule 14 in practice — a second copy of the answer
 * would be a second, unversioned copy of the policy.
 *
 * NO CYCLE. `ArrivalsModule` imports agreements, auto-capture, capture and
 * enduring, and none of them imports this one — this module is a leaf that
 * reads other people's tables and now asks one other service a question.
 *
 * `ReviewTasksModule` IS `@Global()`, so `ReviewTasksService` needs no import
 * here. It is what "Reassign" raises: a task for reception, on the patient's
 * own work page, and nothing else (§3a rule 4).
 */
@Module({
  imports: [AffiliationsModule, ArrivalsModule],
  controllers: [PractitionerQueueController],
  providers: [PractitionerQueueService],
  exports: [PractitionerQueueService],
})
export class PractitionerQueueModule {}
