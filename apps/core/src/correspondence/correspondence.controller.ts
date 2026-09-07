import { BadRequestException, Controller, Get, Headers, Query } from '@nestjs/common';
import { CorrespondenceService } from './correspondence.service';

/** Shape only — the scope is still RLS's, and a well-formed stranger's id matches nothing. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

/**
 * "What have we sent" — the practice's view (plan §4.2). Practice-scoped by
 * RLS like everything that carries practice data. The doctor's view is on
 * `/practitioner/me/messages`; the patient's arrives with their approval page
 * (item 9).
 */
@Controller('correspondence')
export class CorrespondenceController {
  constructor(private readonly correspondence: CorrespondenceService) {}

  /**
   * `?patientId=` NARROWS IT TO ONE PERSON — the work page's Correspondence
   * card (TODO.md "Reception-centric: the patient work page", Carl 4 Sep 2026).
   *
   * THE FILTER IS THE SERVER'S, NOT THE BROWSER'S, and that is the point. The
   * page could have read the practice's whole log and kept the rows it wanted,
   * which would have pulled every other patient's messages — subject lines and
   * bodies included — into a screen about one person, for nothing. Same query,
   * same shaping, a different WHERE (`listForPatient`), inside the practice's
   * own RLS scope: a patient id from another practice matches no row rather
   * than being refused.
   */
  @Get()
  list(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Query('limit') limit?: string,
    @Query('patientId') patientId?: string,
  ) {
    const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const practice = requirePractice(practiceId);
    if (patientId && !UUID.test(patientId)) {
      throw new BadRequestException('patientId must be an id.');
    }
    return patientId
      ? this.correspondence.listForPatient(practice, patientId, n)
      : this.correspondence.listForPractice(practice, n);
  }
}
