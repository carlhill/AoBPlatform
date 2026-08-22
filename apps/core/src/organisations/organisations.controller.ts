import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { LOCKED_FIELDS } from '@aobplatform/domain';
import {
  Equals,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OrganisationsService } from './organisations.service';
import { ChecksService } from './checks.service';
import { AuditService } from './audit.service';
import { SetupService } from './setup.service';

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

  /**
   * How many practitioners the practice has. Sets the invitation cap, with
   * room to grow — a practice that says 500 does not thereby get 600.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5000)
  statedPractitionerCount?: number;

  // The head office, as SIX FIELDS. `headOfficeAddress` remains as a
  // compatibility path for a single line, which is parsed — lossily, and with
  // a refusal rather than a guess when it cannot be read.
  @IsOptional()
  @IsString()
  headOfficeAddress?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  headOfficeLine1?: string;

  @IsOptional()
  @IsString()
  headOfficeLine2?: string;

  @IsOptional()
  @IsString()
  headOfficeSuburb?: string;

  @IsOptional()
  @IsIn(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'])
  headOfficeState?: string;

  @IsOptional()
  @IsString()
  headOfficePostcode?: string;

  @IsOptional()
  @IsString()
  headOfficeCountry?: string;

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

/**
 * Asking an applicant to correct something.
 *
 * The reason is REQUIRED and is sent to the applicant verbatim, so it has to be
 * something a person outside this building can act on. "Details did not match"
 * tells them nothing; "the second contact's phone is the same as yours" tells
 * them exactly what to do.
 */
export class RequestCorrectionDto {
  @IsString()
  @MinLength(10)
  reason!: string;

  @IsString()
  @MinLength(1)
  requestedByName!: string;
}

/**
 * An amendment to an APPROVED practice, from the console.
 *
 * Every field optional, and `undefined` means "not touching this one" — which
 * is not the same as an empty string meaning "clear it". `diffApplication`
 * depends on that distinction, and getting it wrong once wiped fifteen fields
 * of a live application while submitting one.
 *
 * The locked fields are absent by construction: ABN, ACN, legal name, entity
 * type and ABN status come from the register, not from a form.
 */
export class AmendPracticeDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() website?: string;

  @IsOptional() @IsString() adminName?: string;
  @IsOptional() @IsEmail() adminEmail?: string;
  @IsOptional() @IsString() adminPhone?: string;
  @IsOptional() @IsString() adminPosition?: string;

  @IsOptional() @IsString() managerName?: string;
  @IsOptional() @IsEmail() managerEmail?: string;
  @IsOptional() @IsString() managerPhone?: string;
  @IsOptional() @IsString() managerPosition?: string;

  @IsOptional() @IsString() headOfficeLine1?: string;
  @IsOptional() @IsString() headOfficeLine2?: string;
  @IsOptional() @IsString() headOfficeSuburb?: string;
  @IsOptional() @IsString() headOfficeState?: string;
  @IsOptional() @IsString() headOfficePostcode?: string;

  @IsOptional() @IsInt() @Min(0) statedPractitionerCount?: number;

  /*
   * THE LOCKED FIELDS ARE DECLARED SO THEY CAN BE REFUSED BY NAME.
   *
   * Without them, `whitelist: true` strips an unknown property silently and
   * the request reaches the service with nothing in it — which then answers
   * "nothing was changed, so there is nothing to record". True, and useless:
   * somebody who tried to correct an ABN is told they changed nothing rather
   * than why they cannot.
   *
   * Declared here, present-and-refused, with the domain's own wording, so the
   * console and the applicant link give the same answer to the same question.
   */
  @IsOptional()
  @Equals(undefined, { message: LOCKED_FIELDS.abn })
  abn?: undefined;

  @IsOptional()
  @Equals(undefined, { message: LOCKED_FIELDS.acn })
  acn?: undefined;

  @IsOptional()
  @Equals(undefined, { message: LOCKED_FIELDS.legalName })
  legalName?: undefined;

  @IsOptional()
  @Equals(undefined, { message: LOCKED_FIELDS.entityType })
  entityType?: undefined;

  @IsOptional()
  @Equals(undefined, { message: LOCKED_FIELDS.abnStatus })
  abnStatus?: undefined;

  /** Never "the system". A change to an approved record has an author. */
  @IsString()
  @MinLength(1)
  changedByName!: string;

  /** A change with no stated reason is indistinguishable from a mistake. */
  @IsString()
  @MinLength(1)
  reason!: string;
}

export class RemoveCredentialDto {
  /** Never "the system". Removing evidence has an author. */
  @IsString()
  @MinLength(1)
  removedByName!: string;

  /**
   * "Entered twice", "belongs to another practice" and "turned out to be
   * false" are very different findings, and only the last says anything about
   * the applicant. "Removed" on its own answers none of it.
   */
  @IsString()
  @MinLength(1)
  reason!: string;
}

export class ResendInvitationDto {
  @IsString()
  @MinLength(1)
  requestedByName!: string;
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

  /**
   * Required to approve against the score when enforcement is HARD. An
   * override with no explanation is indistinguishable from the threshold not
   * existing at all.
   */
  @IsOptional()
  @IsString()
  identityOverrideReason?: string;
}

export class AddLocationDto {
  /** Compatibility path for a single line. Parsed, and refused if unreadable. */
  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  addressLine2?: string;

  @IsOptional()
  @IsString()
  suburb?: string;

  @IsOptional()
  @IsIn(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'])
  state?: string;

  @IsOptional()
  @IsString()
  postcode?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  code?: string;
}

export class ActivateLocationDto {
  @IsString()
  @MinLength(1)
  reviewerName!: string;
}

export class AddCredentialDto {
  @IsIn(['ahpra', 'hpio', 'accreditation', 'nash', 'other'])
  credentialType!: string;

  @IsString()
  @MinLength(2)
  credentialValue!: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  addedByName?: string;
}

export class VerifyCredentialDto {
  /** Never blank. A verification with nobody attached is a free point for typing. */
  @IsString()
  @MinLength(1)
  verifiedByName!: string;

  @IsIn(['ahpra_register', 'hi_service', 'accrediting_body', 'document_sighted'])
  verificationMethod!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class RecordCheckDto {
  @IsString()
  @MinLength(3)
  checkKey!: string;

  @IsIn(['passed', 'failed', 'not_applicable', 'could_not_complete'])
  outcome!: string;

  @IsString()
  @MinLength(1)
  performedByName!: string;

  /** Required on failed and could_not_complete, from that outcome's own list. */
  @IsOptional()
  @IsString()
  reasonCode?: string;

  @IsOptional()
  @IsString()
  note?: string;

  /** Structured detail a check requires — a number and where it came from. */
  @IsOptional()
  fields?: Record<string, string>;

  /** Evidence already uploaded to this practice. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  artefactIds?: string[];
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
  constructor(
    private readonly organisations: OrganisationsService,
    private readonly checks: ChecksService,
    private readonly auditService: AuditService,
    private readonly setup: SetupService,
  ) {}

  /**
   * The catalogue a reviewer works from. Public: it is the definition of the
   * process, not a secret — what stays private is the SCORING, because "you
   * need six points and here is what scores" is a fraud playbook.
   */
  @Get('checks/catalogue')
  catalogue() {
    return this.checks.catalogue();
  }

  /** Everything performed for this practice, plus what hard mode would decide. */
  /**
   * Everything that has happened to this application, in one ordered trail.
   *
   * Practice-scoped through the header like the rest of the check surface, so
   * RLS confines it — this is a reviewer looking at one application, not a
   * platform-wide feed.
   */
  /**
   * The practice setup hub — every card, in one call.
   *
   * Assembled server-side rather than by the page, because capture readiness is
   * a claim about whether a practice can lawfully record consent and a claim
   * like that gets one implementation, with tests, not a fragment of component
   * logic that quietly disagrees.
   */
  @Get('setup')
  setupHub(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.setup.hub(requirePractice(practiceId));
  }

  /**
   * Correct the application from the CONSOLE.
   *
   * Distinct from the applicant's token route: same rules, no five-day window.
   * The window time-boxes an emailed link; a session is authorised on its own
   * terms and expires on its own terms.
   */
  @Get('audit')
  auditTrail(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.auditService.trail(requirePractice(practiceId));
  }

  @Get('checks')
  checkSummary(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.checks.summary(requirePractice(practiceId));
  }

  /** Append-only: performing a check again writes a new row and keeps both. */
  @Post('checks')
  recordCheck(@Headers('x-practice-id') practiceId: string | undefined, @Body() dto: RecordCheckDto) {
    return this.checks.record(requirePractice(practiceId), dto);
  }

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

  /**
   * The applicant's own links, for a reviewer to send them.
   *
   * Returns the STATUS TOKEN, never the id. The id is a primary key: it lands
   * in logs, in Referer headers and in pasted support tickets, and a primary
   * key that doubles as a credential is a credential that leaks — and one that
   * cannot be rotated without breaking every foreign key pointing at it.
   *
   * Reviewer-facing, so it is not itself token-guarded; it sits behind the same
   * console gate as the rest of the review surface.
   */
  @Get(':organisationId/status-link')
  statusLink(@Param('organisationId', ParseUUIDPipe) organisationId: string) {
    return this.organisations.statusLinks(organisationId);
  }

  /** Ask the applicant to fix something, and open a five-day window. */
  @Post(':organisationId/request-correction')
  requestCorrection(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: RequestCorrectionDto,
  ) {
    return this.organisations.requestCorrection(organisationId, dto);
  }

  /** Send the applicant a link to confirm they can read mail at their address. */
  @Post(':organisationId/request-email-verification')
  requestEmailVerification(@Param('organisationId', ParseUUIDPipe) organisationId: string) {
    return this.organisations.requestEmailVerification(organisationId);
  }

  /**
   * Correct the contact details of a practice that has ALREADY been approved.
   *
   * The domain refuses a post-approval amendment through the applicant link
   * with "changes are made in the console, by a named admin" — this is that
   * console path, which did not exist. The entity itself is untouchable here:
   * a different ABN is a different legal entity and therefore a new
   * application, not an edit.
   */
  /**
   * Send the practice-admin sign-in invitation again.
   *
   * The one at approval can fail for ordinary reasons — most commonly because
   * Keycloak enforces one email per realm and the address already belongs to
   * another account. Without this, an approved practice whose invitation failed
   * had no route in at all.
   */
  @Post(':organisationId/resend-invitation')
  resendInvitation(
    @Param('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: ResendInvitationDto,
  ) {
    return this.organisations.resendAdminInvitation(organisationId, dto.requestedByName);
  }

  /**
   * Amend an approved practice from the console.
   *
   * The domain refuses a post-approval amendment through the applicant link
   * with "changes are made in the console, by a named admin" — this is that
   * path, over the sixteen AMENDABLE_FIELDS. The entity stays untouchable: a
   * different ABN is a different legal entity, so it is a new application.
   *
   * Changing  is a HANDOVER rather than a correction, because it
   * transfers who controls the practice account. The outgoing account is
   * disabled — see amendApplication.
   */
  @Patch(':organisationId')
  amend(@Param('organisationId', ParseUUIDPipe) organisationId: string, @Body() dto: AmendPracticeDto) {
    const { changedByName, reason, ...fields } = dto;
    return this.organisations.amendApplication(organisationId, fields, { changedByName, reason });
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

  @Get('credentials')
  listCredentials(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.organisations.listCredentials(requirePractice(practiceId));
  }

  /** As many as they want. Each is an independent signal, and entry scores nothing. */
  @Post('credentials')
  addCredential(@Headers('x-practice-id') practiceId: string | undefined, @Body() dto: AddCredentialDto) {
    return this.organisations.addCredential(requirePractice(practiceId), dto);
  }

  /** Recording an actual check. THIS is what carries weight. */
  @Post('credentials/:credentialId/verify')
  verifyCredential(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('credentialId', ParseUUIDPipe) credentialId: string,
    @Body() dto: VerifyCredentialDto,
  ) {
    return this.organisations.verifyCredential(requirePractice(practiceId), credentialId, dto);
  }

  @Post('credentials/:credentialId/remove')
  removeCredential(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('credentialId', ParseUUIDPipe) credentialId: string,
    @Body() dto: RemoveCredentialDto,
  ) {
    return this.organisations.removeCredential(requirePractice(practiceId), credentialId, dto);
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
