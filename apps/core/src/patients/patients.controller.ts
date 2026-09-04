import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PatientsService } from './patients.service';
import { CorrectPatientDetailsDto } from './patients.dto';
import { SessionActor, type Actor } from '../auth/actor.decorator';
import { PracticeScoped } from '../auth/practice-scope.decorator';

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

/**
 * CORRECTING A DETAIL THE PATIENT SAID WAS WRONG (TODO.md
 * "Check-your-details: tick or cross per row", Carl 4 Sep 2026).
 *
 * ONE ROUTE, AND IT IS A STAFF ACT. The patient crosses a row on the tablet
 * and is asked for nothing further — the tablet presents no field, on the same
 * reasoning K-3 presents none (Carl, 3 Sep 2026: "the tablet never presents a
 * field that a patient or a passer-by could fill on the practice's behalf").
 * The person who says what the right value is stands at the desk, and their
 * identity is recorded when they say it.
 *
 * `@PracticeScoped` AND A REQUIRED ACTOR, together. The first says whose act
 * it is — a platform operator reaches it only by acting as the practice, which
 * leaves a record of on whose behalf. The second says whose hands typed it.
 * Neither substitutes for the other.
 *
 * `PATCH`, NOT `PUT`. The body names the details being corrected and says
 * nothing about the rest of the row; a `PUT` would invite a caller to send the
 * whole patient back, which is how a field nobody edited gets overwritten with
 * whatever the client happened to be holding.
 *
 * THERE IS NO CREATE AND NO DELETE HERE, and there should not be. The PMS is
 * the source of truth for who a patient is (REQ-DATA-10); the mirror row is
 * created by the sync and this endpoint corrects five details on it. A console
 * that could invent a patient would be a console that could invent a party to
 * a contract.
 */
@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  /**
   * THE PATIENTS WITH SOMETHING OPEN TODAY — reception's queue
   * (TODO.md "Reception-centric: the patient work page", Carl 4 Sep 2026).
   *
   * `?open=today` AND NOTHING ELSE. There is deliberately no unfiltered list
   * of a practice's patients here: this platform is not a patient directory,
   * and an endpoint that answered "everyone" would become one the first time
   * somebody paged it. The query names the only question reception asks — who
   * has something waiting today — and any other value is refused.
   *
   * IT COMPOSES `TabletSessionsService` RATHER THAN RE-ASKING THE DATABASE,
   * so the work list and `/practice/tablet` cannot disagree about what "today"
   * means (the service's own comment says what it means).
   */
  @Get()
  @PracticeScoped()
  open(@Headers('x-practice-id') practiceId: string | undefined, @Query('open') open?: string) {
    if (open !== 'today') {
      throw new BadRequestException(
        'This lists the patients with something open today: ask for ?open=today. There is no list of ' +
          'every patient — the practice management system holds the patient record (REQ-DATA-10).',
      );
    }
    return this.patients.openToday(requirePractice(practiceId));
  }

  /**
   * WHAT HAPPENED TO THIS PATIENT, IN ORDER — the work page's History card.
   *
   * TYPES, TIMES AND SHORT CODES, never values (REQ-VER-04) and never a
   * sentence: the words belong to the console's string table (REQ-LANG-01).
   * Declared BEFORE nothing and after `:id/details` only for reading order —
   * both are `:id`-shaped and neither shadows the other.
   */
  @Get(':id/timeline')
  @PracticeScoped()
  timeline(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.patients.timeline(requirePractice(practiceId), id);
  }

  /**
   * THE SIX DETAILS AS THEY STAND — read when reception opens the correction
   * control, and not before.
   *
   * A STAFF SURFACE READING ITS OWN PRACTICE'S PATIENT, which is what
   * `@PracticeScoped` and RLS between them make true: a cross-practice id
   * finds nothing rather than being refused, because the scope was resolved
   * from the caller's own claim.
   */
  @Get(':id/details')
  @PracticeScoped()
  details(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.patients.correctableDetails(requirePractice(practiceId), id);
  }

  /**
   * `@Req` ALONGSIDE `@Body`, AND IT IS NOT LAZINESS.
   *
   * The global `ValidationPipe` runs with `whitelist: true`, so a field that
   * is not on the DTO is STRIPPED before this method sees it. That is right
   * for an unknown field and wrong for a forbidden one: a request carrying a
   * Medicare card number would be silently ignored, and the sender would
   * believe it had been accepted. So the RAW keys go to the service, which
   * refuses anything matching /medicare/i out loud (hard rule 1, REQ-VER-02).
   * The raw body itself is never read for a VALUE — only for its key names.
   */
  @Patch(':id/details')
  @PracticeScoped()
  correct(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectPatientDetailsDto,
    @Req() req: Request,
    @SessionActor() actor: Actor | undefined,
  ) {
    const sent = req.body && typeof req.body === 'object' ? Object.keys(req.body as object) : [];
    return this.patients.correctDetails(requirePractice(practiceId), id, dto, sent, actor);
  }
}
