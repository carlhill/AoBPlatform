import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { TabletSessionsModule } from '../tablet-sessions/tablet-sessions.module';

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
 * IT IMPORTS ONE MODULE, AND ONLY TO ASK IT A QUESTION. A correction is still
 * one row and its events — no rules engine, no renderer, no agreement — and the
 * RE-SEND that usually follows one is `TabletSessionsService`'s, because that
 * is where the agreement and the device live; keeping the two apart is what
 * lets reception correct a detail for a patient who is not standing at a tablet
 * at all. What was added (Carl, 4 Sep 2026) is reception's WORK LIST, which
 * must name exactly the patients `/practice/tablet` names — so it borrows that
 * module's own notion of "open today" through its service rather than copying
 * the query. Two answers to one question is how two screens come to disagree
 * in front of a patient.
 */
@Module({
  imports: [TabletSessionsModule],
  controllers: [PatientsController],
  providers: [PatientsService],
  exports: [PatientsService],
})
export class PatientsModule {}
