import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReconciliationService } from './reconciliation.service';
import { SessionActor, type Actor } from '../auth/actor.decorator';

export class ResendDto {
  @IsIn(['sms_link', 'email_link'])
  channel!: string;
}

export class DecideDto {
  @IsIn(['convert_to_private', 'forgo_benefit', 'keep_chasing'])
  decision!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get('outstanding')
  outstanding(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.reconciliation.outstanding(requirePractice(practiceId));
  }

  @Post(':serviceRecordId/resend')
  resend(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('serviceRecordId', ParseUUIDPipe) serviceRecordId: string,
    @Body() dto: ResendDto,
  ) {
    return this.reconciliation.resend(requirePractice(practiceId), serviceRecordId, dto.channel);
  }

  /**
   * FR-7.3 — convert-or-forgo. The deciding person comes from the session,
   * never the body; the AttributionInterceptor would overwrite it anyway.
   */
  @Post(':serviceRecordId/decide')
  decide(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('serviceRecordId', ParseUUIDPipe) serviceRecordId: string,
    @Body() dto: DecideDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.reconciliation.decide(requirePractice(practiceId), serviceRecordId, dto, actor);
  }

  @Get('metrics')
  metrics(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.reconciliation.metrics(requirePractice(practiceId));
  }

  /**
   * One item in full — what was tried, what the band allows, what comes next
   * (queue wireframe R-2). DECLARED LAST, deliberately: Nest matches routes
   * in declaration order, and a `:serviceRecordId` above `metrics` would try
   * to parse the word "metrics" as a UUID and answer 400.
   */
  @Get(':serviceRecordId')
  detail(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('serviceRecordId', ParseUUIDPipe) serviceRecordId: string,
  ) {
    return this.reconciliation.detail(requirePractice(practiceId), serviceRecordId);
  }
}
