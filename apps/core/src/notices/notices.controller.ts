import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsInt, IsISO8601, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { NoticesService } from './notices.service';

export class ClaimEventDto {
  @IsUUID()
  agreementId!: string;

  @IsString()
  claimReference!: string;

  @IsOptional()
  @IsISO8601()
  claimLodgedAt?: string;

  @IsISO8601()
  serviceDate!: string;

  /** In cents. The one lawful benefit amount in the product (CLAUDE.md rule 4). */
  @IsInt()
  @Min(0)
  benefitAmountCents!: number;

  @IsOptional()
  @IsUUID()
  serviceRecordId?: string;
}

export class CorrectionDto {
  @IsString()
  reason!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  benefitAmountCents?: number;

  @IsOptional()
  @IsISO8601()
  serviceDate?: string;

  @IsOptional()
  @IsString()
  practitionerName?: string;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

/**
 * Reg 89AA notices. Note what this controller does NOT expose: any endpoint
 * that chases, reminds, or asks the assignor to respond. The notice is
 * one-way and non-response has no effect on payment (REQ-CHASE-02).
 */
@Controller('notices')
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

  /** Claim intake (FR-6.1) — composes a notice only where reg 89AA applies. */
  @Post('claims')
  recordClaim(@Headers('x-practice-id') practiceId: string | undefined, @Body() dto: ClaimEventDto) {
    return this.notices.recordClaim(requirePractice(practiceId), dto);
  }

  @Post(':id/dispatch')
  dispatch(@Headers('x-practice-id') practiceId: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.notices.dispatch(requirePractice(practiceId), id);
  }

  /** Carrier/SMTP receipt. */
  @Post(':id/delivered')
  delivered(@Headers('x-practice-id') practiceId: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.notices.recordDelivered(requirePractice(practiceId), id);
  }

  /** Open signal — evidential colour only, never a compliance measure (REQ-DEL-07). */
  @Post(':id/read')
  read(@Headers('x-practice-id') practiceId: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.notices.recordRead(requirePractice(practiceId), id);
  }

  /** REQ-DEL-06 — corrections supersede; the original is never edited. */
  @Post(':id/correct')
  correct(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectionDto,
  ) {
    return this.notices.correct(requirePractice(practiceId), id, dto);
  }

  /** REQ-DEL-08 — the Notification Compliance Pack, in one action. */
  @Get('compliance-pack')
  compliancePack(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.notices.compliancePack(requirePractice(practiceId), from, to);
  }
}
