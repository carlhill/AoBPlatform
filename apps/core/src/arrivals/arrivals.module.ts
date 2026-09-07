import { Module } from '@nestjs/common';
import { ArrivalsController } from './arrivals.controller';
import { ArrivalsService } from './arrivals.service';
import { AgreementsModule } from '../agreements/agreements.module';
import { CaptureModule } from '../capture/capture.module';
import { EnduringModule } from '../enduring/enduring.module';

/**
 * THE ARRIVAL CONTRACT — our side of the PMS push, until D-01 resolves
 * (TODO.md "Reception-centric" §2, GA-PLAN B4).
 *
 * IT COMPOSES, IT DOES NOT REACH. Three modules, each asked through its own
 * service and none of them read at the table (CLAUDE.md §4): `EnduringModule`
 * answers "is this provider and this patient already covered", `AgreementsModule`
 * owns the draft and its guards, `CaptureModule` opens the in-practice request
 * that puts the patient on reception's queue. The one thing this module owns
 * outright is the `arrivals` table and the decision recorded on it.
 *
 * IT DOES NOT IMPORT `PatientsModule`, and the reason is the same one that
 * module's own docstring gives for not living in `PmsModule`: that module
 * CORRECTS a detail on a named staff member's say-so, and this one MIRRORS what
 * the PMS says, which is the opposite direction and a different act. Folding
 * them together would give "who may change a patient row" two answers in one
 * place. The mirror write here is the sync's kind, and it stamps nothing that
 * would make a later staff correction look like a machine's.
 *
 * NOR `PmsModule` ITSELF. `PmsSyncService.ensurePatient` matches on
 * `pmsLinkageKey` — the key a sync feed carries — while an arrival carries the
 * practice's own patient record number, which is what reception reads off the
 * screen in front of them. Two different handles for the same person is a real
 * difference, and pretending otherwise would make one of them wrong.
 */
@Module({
  imports: [AgreementsModule, CaptureModule, EnduringModule],
  controllers: [ArrivalsController],
  providers: [ArrivalsService],
  exports: [ArrivalsService],
})
export class ArrivalsModule {}
