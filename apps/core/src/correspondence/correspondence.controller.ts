import { BadRequestException, Controller, Get, Headers, Query } from '@nestjs/common';
import { CorrespondenceService } from './correspondence.service';

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

  @Get()
  list(@Headers('x-practice-id') practiceId: string | undefined, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.correspondence.listForPractice(requirePractice(practiceId), n);
  }
}
