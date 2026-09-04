import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

/**
 * THE PATIENT MIRROR'S ONE STAFF-FACING WRITE (TODO.md "Check-your-details",
 * Carl 4 Sep 2026).
 *
 * WHY IT IS NOT IN `PmsModule`, WHICH ALSO TOUCHES `patients`. That module
 * MIRRORS: `ensurePatient` copies what the PMS says, and its own comment says
 * the PMS is the source of truth (REQ-DATA-10). This module CORRECTS, which is
 * the opposite direction and a different act — a named staff member disagreeing
 * with the mirror because the patient in front of them did. Folding the two
 * together would put a console endpoint inside the module whose docstring says
 * it deliberately has none, and would make "who may change a patient row" a
 * question with two answers in one file.
 *
 * IT IMPORTS NOTHING. A correction is one row and its events; it needs no rules
 * engine, no renderer and no agreement. The RE-SEND that usually follows one is
 * `TabletSessionsService`'s, because that is where the agreement and the
 * device live — and keeping the two apart is what lets reception correct a
 * detail for a patient who is not standing at a tablet at all.
 */
@Module({
  controllers: [PatientsController],
  providers: [PatientsService],
  exports: [PatientsService],
})
export class PatientsModule {}
