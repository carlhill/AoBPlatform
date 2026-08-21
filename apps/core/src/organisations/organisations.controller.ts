import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { OrganisationsService } from './organisations.service';

/**
 * What a named human read off abr.business.gov.au, when the platform has no
 * ABR GUID to call the API with.
 *
 * This is NOT a way to skip verification — every gate still runs against
 * these values: the ABN must be ACTIVE, the typed practice name must match one
 * of these registered names, and a company must still yield an ACN. What
 * changes is only WHO looked, and that is recorded.
 */
export class AbrAttestationDto {
  /** Exactly as the ABR shows it — this is what the name gate matches against. */
  @IsString()
  @MinLength(2)
  legalName!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  businessNames?: string[];

  /** ACTIVE or CANCELLED, as shown. Typing ACTIVE for a cancelled ABN is fraud, not a shortcut. */
  @IsString()
  abnStatus!: string;

  @IsString()
  entityType!: string;

  @IsOptional()
  @IsBoolean()
  gstRegistered?: boolean;

  /** The human who sighted the register. Never blank, never "system". */
  @IsString()
  @MinLength(1)
  sightedByName!: string;
}

export class RegisterOrganisationDto {
  /** The practice name as the operator knows it — legal OR trading name. */
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  abn!: string;

  /** Optional: we derive it from the ABN. Supplied and disagreeing is a hard fail. */
  @IsOptional()
  @IsString()
  acn?: string;

  @IsOptional()
  @IsString()
  pms?: string;

  @IsOptional()
  @IsString()
  hpiO?: string;

  // --- The applicant, and their manager ---
  //
  // BOTH people are captured, with a position and personal contact details for
  // each. This is the anti-fraud surface: a lone applicant with one throwaway
  // email is cheap; two named people in stated positions, each reachable
  // independently, is a much harder thing to fabricate — and gives the
  // reviewer a second person to call who was not the one who applied.
  @IsString()
  @MinLength(2)
  adminName!: string;

  @IsEmail()
  adminEmail!: string;

  @IsString()
  @MinLength(6)
  adminPhone!: string;

  @IsOptional()
  @IsString()
  adminPosition?: string;

  @IsOptional()
  @IsString()
  managerName?: string;

  @IsOptional()
  @IsEmail()
  managerEmail?: string;

  @IsOptional()
  @IsString()
  managerPhone?: string;

  @IsOptional()
  @IsString()
  managerPosition?: string;

  @IsOptional()
  @IsString()
  website?: string;

  /** NOT a Location. See the schema comment — a head office is often not a place of practice. */
  @IsString()
  @MinLength(5)
  headOfficeAddress!: string;

  @IsOptional()
  @IsBoolean()
  headOfficeIsPlaceOfPractice?: boolean;

  @IsOptional()
  @IsIn(['ahpra', 'hpio', 'accreditation'])
  credentialType?: string;

  @IsOptional()
  @IsString()
  credentialValue?: string;

  /**
   * Supplied ONLY when the ABR API is unavailable in this environment. If the
   * API is configured, it wins and this is ignored — a human cannot overrule
   * the register when the register can be asked.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => AbrAttestationDto)
  abrAttestation?: AbrAttestationDto;

  // NOTE: there is no banking field here, and there never will be (§8).
}

export class ValidationDecisionDto {
  @IsIn(['validated', 'rejected'])
  decision!: 'validated' | 'rejected';

  /** Never "system". A named human owns every approval. */
  @IsString()
  @MinLength(1)
  reviewerName!: string;

  @IsOptional()
  @IsString()
  note?: string;

  /**
   * §11 — how the applicant was verified to represent this entity. Required to
   * APPROVE; not required to reject, because refusing an application you could
   * not verify is the right outcome and demanding a completed check first
   * would be backwards.
   */
  @IsOptional()
  @IsIn(['phone_call', 'domain_match', 'hpio', 'document', 'none'])
  entitlementMethod?: string;

  @IsOptional()
  @IsString()
  entitlementPhoneNumber?: string;

  /** Where the number came from. A number off the application form proves nothing. */
  @IsOptional()
  @IsIn(['nhsd', 'practice_website', 'public_directory', 'application_form', 'other'])
  entitlementNumberSource?: string;

  @IsOptional()
  @IsString()
  entitlementSpokeWithName?: string;
}

export class AddLocationDto {
  @IsString()
  @MinLength(5)
  address!: string;

  @IsOptional()
  @IsString()
  code?: string;
}

export class ActivateLocationDto {
  @IsString()
  @MinLength(1)
  reviewerName!: string;
}

export class AddDepartmentDto {
  @IsString()
  locationId!: string;

  @IsString()
  @MinLength(1)
  name!: string;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

/**
 * Organisation onboarding and the sites it operates from.
 *
 * `/organisations` and `/organisations/:id/validate` are pre-tenant: the
 * organisation is the tenant, and it does not exist yet. Everything under
 * /locations and /departments is practice-scoped as usual.
 */
@Controller('organisations')
export class OrganisationsController {
  constructor(private readonly organisations: OrganisationsService) {}

  @Post()
  register(@Body() dto: RegisterOrganisationDto) {
    return this.organisations.register(dto);
  }

  /**
   * Every organisation that has applied. `?state=validated` answers "which
   * practice did I approve, and what is its id" — which was previously
   * unanswerable without reading the database by hand.
   */
  @Get()
  list(@Query('state') state?: string) {
    const allowed = ['pending', 'validated', 'rejected', 'all'] as const;
    const chosen = (allowed as readonly string[]).includes(state ?? '') ? state : 'all';
    return this.organisations.listOrganisations(chosen as (typeof allowed)[number]);
  }

  /** The human validation queue (§4). */
  @Get('pending')
  pending() {
    return this.organisations.pendingValidation();
  }

  @Post(':organisationId/validate')
  decide(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: ValidationDecisionDto,
  ) {
    return this.organisations.decideValidation(organisationId, dto);
  }

  @Get('locations')
  listLocations(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.organisations.listLocations(requirePractice(practiceId));
  }

  @Post('locations')
  addLocation(@Headers('x-practice-id') practiceId: string | undefined, @Body() dto: AddLocationDto) {
    return this.organisations.addLocation(requirePractice(practiceId), dto);
  }

  /** Manual address confirmation, until the G-NAF ingest lands (§9). */
  @Post('locations/:locationId/activate')
  activateLocation(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body() dto: ActivateLocationDto,
  ) {
    return this.organisations.activateLocation(requirePractice(practiceId), locationId, dto.reviewerName);
  }

  @Get('departments')
  listDepartments(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Query('locationId') locationId?: string,
  ) {
    return this.organisations.listDepartments(requirePractice(practiceId), locationId);
  }

  @Post('departments')
  addDepartment(@Headers('x-practice-id') practiceId: string | undefined, @Body() dto: AddDepartmentDto) {
    return this.organisations.addDepartment(requirePractice(practiceId), dto);
  }
}
