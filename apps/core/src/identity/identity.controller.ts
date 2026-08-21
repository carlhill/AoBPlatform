import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsEmail, IsOptional } from 'class-validator';
import { IdentityService } from './identity.service';
import { RecordCeremonyDto } from './ceremony.dto';

export class InviteDto {
  /** Where the passkey-enrolment link is sent. Without it the account is created but nobody is invited. */
  @IsOptional()
  @IsEmail()
  email?: string;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

/**
 * Identity onboarding (FR-1.9, FR-1.5). Note what is absent: any endpoint
 * that sets a password. Practitioner and admin accounts are passkey-only by
 * construction (rule 15) — there is no password to set, reset, or leak.
 */
@Controller('identity')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  /** Who has an account and can actually sign in. */
  @Get('status')
  status(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.identity.status(requirePractice(practiceId));
  }

  /**
   * REQ-PKI-01 — record the enrolment ceremony. This must exist before an
   * invitation can be sent, and therefore before any key can be bound.
   */
  @Post('ceremonies')
  recordCeremony(@Headers('x-practice-id') practiceId: string | undefined, @Body() dto: RecordCeremonyDto) {
    return this.identity.recordCeremony(requirePractice(practiceId), dto);
  }

  @Get('ceremonies')
  ceremonyStatus(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.identity.ceremonyStatus(requirePractice(practiceId));
  }

  @Post('providers/:providerId/invite')
  inviteProvider(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Body() dto: InviteDto,
  ) {
    return this.identity.inviteProvider(requirePractice(practiceId), providerId, dto.email);
  }

  @Post('staff/:staffId/invite')
  inviteStaff(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body() dto: InviteDto,
  ) {
    return this.identity.inviteStaff(requirePractice(practiceId), staffId, dto.email);
  }

  /** REQ-PKI-04 — departure or deregistration removes access immediately. */
  @Post('providers/:providerId/revoke')
  revokeProvider(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('providerId', ParseUUIDPipe) providerId: string,
  ) {
    return this.identity.revokeProvider(requirePractice(practiceId), providerId);
  }
}
