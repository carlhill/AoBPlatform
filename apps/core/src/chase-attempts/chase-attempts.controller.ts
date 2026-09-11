import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import {
  CHASE_ATTEMPT_CHANNELS,
  CHASE_ATTEMPT_OUTCOMES,
  CHASE_ATTEMPT_SUBJECT_TYPES,
  CHASE_NOTE_MAX_LENGTH,
  CONTACTED_PARTY_TYPES,
} from '@aobplatform/domain';
import { ChaseAttemptsService } from './chase-attempts.service';
import { SessionActor, type Actor } from '../auth/actor.decorator';

/**
 * NOTE WHAT IS NOT IN THIS DTO: a name, a phone number, an email address, or
 * an amount.
 *
 * The person is taken from the session (rule: `actor.decorator.ts`). The
 * contact detail is not recorded at all — the row says which KIND of contact
 * was used and who was contacted BY ROLE, never the value (REQ-VER-04,
 * REQ-LOG-08). And no artefact of an agreement carries a dollar figure (rule 4).
 *
 * `subjectType` is a closed list that cannot name a reg 89AA notice: a notice
 * is one-way and is NEVER chased (rule 7, REQ-CHASE-02, REQ-END-05). This is
 * the outermost of the three layers that say so — the domain refuses it, and a
 * CHECK constraint on the table refuses it again.
 */
export class RecordChaseAttemptDto {
  @IsIn(CHASE_ATTEMPT_SUBJECT_TYPES as unknown as string[])
  subjectType!: string;

  @IsUUID()
  subjectId!: string;

  @IsIn(CHASE_ATTEMPT_CHANNELS as unknown as string[])
  channel!: string;

  @IsIn(CHASE_ATTEMPT_OUTCOMES as unknown as string[])
  outcome!: string;

  @IsOptional()
  @IsIn(CONTACTED_PARTY_TYPES as unknown as string[])
  contactedPartyType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CHASE_NOTE_MAX_LENGTH)
  note?: string;

  /** When it happened, if it is being written down later in the day. */
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  /** The attempt this one corrects. A correction supersedes; nothing is edited. */
  @IsOptional()
  @IsUUID()
  supersedesId?: string;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

/**
 * The audit trail of what a PERSON at the practice did about an unanswered
 * agreement (Carl, 3 Sep 2026). The platform's own attempts are already
 * evidenced; this is the calls, the conversations at the desk and the letters.
 */
@Controller('chase-attempts')
export class ChaseAttemptsController {
  constructor(private readonly attempts: ChaseAttemptsService) {}

  @Post()
  record(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Body() dto: RecordChaseAttemptDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.attempts.record(requirePractice(practiceId), dto, actor);
  }

  /** The trail for one service record or agreement, with the band context R-2 draws. */
  @Get(':subjectType/:subjectId')
  trail(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('subjectType') subjectType: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ) {
    return this.attempts.trail(requirePractice(practiceId), subjectType, subjectId);
  }
}
