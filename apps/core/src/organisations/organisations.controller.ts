import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { OrganisationsService } from './organisations.service';

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
