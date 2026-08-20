import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { ReconciliationService } from './reconciliation.service';

export class ResendDto {
  @IsIn(['sms_link', 'email_link'])
  channel!: string;
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

  @Get('metrics')
  metrics(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.reconciliation.metrics(requirePractice(practiceId));
  }
}
