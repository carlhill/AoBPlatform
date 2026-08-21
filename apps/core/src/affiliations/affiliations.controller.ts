import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDate, IsEmail, IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { AffiliationsService } from './affiliations.service';

export class PreRegisterDto {
  @IsString()
  ahpraNumber!: string;

  @IsString()
  @MinLength(1)
  familyName!: string;

  @IsString()
  @MinLength(1)
  givenNames!: string;

  @IsString()
  providerType!: string;

  /** PRACTITIONER-owned. Invitations go here, so a practice cannot self-accept. */
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class InviteAffiliationDto {
  @IsString()
  ahpraNumber!: string;

  @IsUUID()
  locationId!: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  /** The practitioner's number AT THIS LOCATION (FR-1.8). Optional per REQ-REG-02. */
  @IsOptional()
  @IsString()
  providerNumber?: string;

  @IsString()
  @MinLength(1)
  invitedByName!: string;
}

export class RespondDto {
  @IsIn(['accept', 'reject'])
  decision!: 'accept' | 'reject';
}

export class GiveNoticeDto {
  @Type(() => Date)
  @IsDate()
  endsAt!: Date;

  @IsString()
  @MinLength(1)
  givenByName!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class DeregisterDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

/**
 * Practitioners and affiliations.
 *
 * Note which endpoints are NOT practice-scoped, and why: pre-registration and
 * the self-view belong to the practitioner, who exists across practices.
 * Accepting an invitation is the practitioner's act, so it carries their id,
 * not a practice header.
 */
@Controller()
export class AffiliationsController {
  constructor(private readonly affiliations: AffiliationsService) {}

  // --- Practitioner-owned ---------------------------------------------------

  /** Path A — the practitioner registers themselves. */
  @Post('practitioners')
  preRegister(@Body() dto: PreRegisterDto) {
    return this.affiliations.preRegister(dto);
  }

  /** AHPRA number only, exact match. Name browse is refused by design. */
  @Get('practitioners/directory')
  directory(@Query('ahpraNumber') ahpraNumber: string) {
    return this.affiliations.findInDirectory(ahpraNumber ?? '');
  }

  /** A practitioner's own affiliations, across every practice. */
  @Get('practitioners/:practitionerId/affiliations')
  listMine(@Param('practitionerId', ParseUUIDPipe) practitionerId: string) {
    return this.affiliations.listForPractitioner(practitionerId);
  }

  /** The practitioner answers. A practice cannot call this for them. */
  @Post('practitioners/:practitionerId/affiliations/:affiliationId/respond')
  respond(
    @Param('practitionerId', ParseUUIDPipe) practitionerId: string,
    @Param('affiliationId', ParseUUIDPipe) affiliationId: string,
    @Body() dto: RespondDto,
  ) {
    return this.affiliations.respond(affiliationId, practitionerId, dto.decision);
  }

  /** REQ-XFER-08 — immediate, across every affiliation, no notice period. */
  @Post('practitioners/:practitionerId/deregister')
  deregister(@Param('practitionerId', ParseUUIDPipe) practitionerId: string, @Body() dto: DeregisterDto) {
    return this.affiliations.recordDeregistration(practitionerId, dto.reason);
  }

  // --- Practice-scoped ------------------------------------------------------

  @Get('affiliations')
  list(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.affiliations.listForPractice(requirePractice(practiceId));
  }

  @Post('affiliations')
  invite(@Headers('x-practice-id') practiceId: string | undefined, @Body() dto: InviteAffiliationDto) {
    return this.affiliations.invite(requirePractice(practiceId), dto);
  }

  /** Offboarding. Notice runs BEFORE the end date (§6). */
  @Post('affiliations/:affiliationId/notice')
  giveNotice(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('affiliationId', ParseUUIDPipe) affiliationId: string,
    @Body() dto: GiveNoticeDto,
  ) {
    return this.affiliations.giveNotice(requirePractice(practiceId), affiliationId, dto);
  }

  @Post('affiliations/:affiliationId/notice/withdraw')
  withdrawNotice(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('affiliationId', ParseUUIDPipe) affiliationId: string,
  ) {
    return this.affiliations.withdrawNotice(requirePractice(practiceId), affiliationId);
  }
}
