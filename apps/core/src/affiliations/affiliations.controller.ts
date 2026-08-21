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
import { IsArray, IsDate, IsEmail, IsIn, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';
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

export class RegistrationTypeDto {
  @IsString()
  @MinLength(1)
  registrationType!: string;

  @IsOptional()
  @IsString()
  specialty?: string;

  /** MAY be in the past. That is a warning, never a refusal — see ahpra.ts. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiryDate?: Date;

  @IsOptional()
  @IsString()
  conditions?: string;

  @IsOptional()
  @IsString()
  endorsements?: string;

  @IsOptional()
  @IsString()
  notations?: string;
}

/** What a named human read off the AHPRA public register. */
export class RecordRegistrationDto {
  @IsString()
  @MinLength(1)
  registrationStatus!: string;

  @IsOptional()
  @IsString()
  profession?: string;

  @IsOptional()
  @IsString()
  division?: string;

  @IsOptional()
  @IsString()
  conditions?: string;

  @IsOptional()
  @IsString()
  undertakings?: string;

  @IsOptional()
  @IsString()
  reprimands?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dateOfFirstRegistration?: Date;

  // The register publishes the principal place of practice as suburb and
  // postcode only. There is deliberately no street-address field here.
  @IsOptional()
  @IsString()
  principalSuburb?: string;

  @IsOptional()
  @IsString()
  principalState?: string;

  @IsOptional()
  @IsString()
  principalPostcode?: string;

  @IsOptional()
  @IsString()
  principalCountry?: string;

  @IsIn(['ahpra_manual', 'pie_api'])
  source!: string;

  /** Required when the source is a person rather than an API. */
  @IsOptional()
  @IsString()
  sightedByName?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegistrationTypeDto)
  registrationTypes!: RegistrationTypeDto[];
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

  /**
   * INVITATION ONLY (CONVENTIONS.md §8b). Practice-scoped, and the practice
   * must be validated — there is no unauthenticated path that creates a
   * practitioner identity, because that path is how spam gets in.
   */
  @Post('practitioners')
  preRegister(@Headers('x-practice-id') practiceId: string | undefined, @Body() dto: PreRegisterDto) {
    return this.affiliations.preRegister(requirePractice(practiceId), dto);
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

  /** Record what the AHPRA public register says. Manual until PIE is bought. */
  @Post('practitioners/:practitionerId/registration')
  recordRegistration(
    @Param('practitionerId', ParseUUIDPipe) practitionerId: string,
    @Body() dto: RecordRegistrationDto,
  ) {
    return this.affiliations.recordRegistration(practitionerId, dto);
  }

  @Get('practitioners/:practitionerId/registration')
  registration(@Param('practitionerId', ParseUUIDPipe) practitionerId: string) {
    return this.affiliations.registrationFor(practitionerId);
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
