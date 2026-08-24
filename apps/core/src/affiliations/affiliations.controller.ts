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
import { EXTERNAL_NOTICE_KEYS, EXTERNAL_NOTICE_MEANS } from '@aobplatform/domain';
import { AffiliationsService } from './affiliations.service';
import { InvitationService } from './invitation.service';
import { PLATFORM_ADMIN, RequireRoles } from '../auth/roles.decorator';
import { PracticeScoped } from '../auth/practice-scope.decorator';
import { SessionActor, type Actor } from '../auth/actor.decorator';

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

export class AnswerInvitationDto {
  @IsString()
  @MinLength(6)
  code!: string;

  @IsIn(['accept', 'decline'])
  decision!: 'accept' | 'decline';
}

export class RespondDto {
  @IsIn(['accept', 'reject'])
  decision!: 'accept' | 'reject';
}

/**
 * Notice given outside AoBPlatform, for a departure that has already
 * happened. Optional — a future-dated departure needs none of this.
 */
export class ExternalNoticeDto {
  @IsIn(EXTERNAL_NOTICE_KEYS)
  means!: string;

  @Type(() => Date)
  @IsDate()
  givenAt!: Date;

  @IsOptional()
  @IsString()
  note?: string;
}

export class GiveNoticeDto {
  @Type(() => Date)
  @IsDate()
  endsAt!: Date;

  /**
   * REQUIRED when the end date has passed. The domain refuses a past
   * departure without it, because recording one would assert that we gave
   * notice before a date that has already gone by.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => ExternalNoticeDto)
  externalNotice?: ExternalNoticeDto;

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
  constructor(
    private readonly affiliations: AffiliationsService,
    private readonly invitations: InvitationService,
  ) {}

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

  /**
   * The practice's own roster — everyone it pre-registered or is affiliated
   * with, including the ones not yet invited anywhere.
   *
   * PRACTICE-SCOPED, and note it sits above the directory route rather than
   * below it: `/practitioners` and `/practitioners/directory` are distinct
   * paths, but keeping the narrower-scoped one first makes it obvious that
   * this endpoint answers "who is mine" and the other answers "does this AHPRA
   * number exist here", which are questions with very different answers.
   */
  @Get('practitioners')
  roster(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.affiliations.listRoster(requirePractice(practiceId));
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

  /**
   * Record what the AHPRA public register says. PLATFORM OPERATOR ONLY.
   *
   * NOT THE PRACTICE’S ACT, for the same reason a practice cannot confirm
   * its own address. A register check is EVIDENCE THAT SOMEBODY INDEPENDENT
   * LOOKED: it is what turns a typed-in registration number into something
   * with weight, and it feeds the practitioner strength score that decides
   * whether consent may be captured in that person’s name.
   *
   * A practice recording its own practitioner as "Registered" is a practice
   * awarding itself the check. That is not a weaker check, it is a
   * self-attestation wearing the name of an independent one — and in the
   * audit trail it reads identically to a real one.
   *
   * The practice still ADDS the practitioner and still enters the AHPRA
   * number. Entering scores nothing; only the recorded check does.
   *
   * Manual until PIE is bought.
   */
  /**
   * Every register check on one practitioner.
   *
   * PLATFORM ONLY, like recording one. This is our record of our own
   * attestations; a practice that could read who checked and when could work
   * out how closely it is being watched. What the practice needs — whether the
   * check is done and what it says now — it already has on its roster.
   */
  /**
   * One affiliation's life. PRACTICE-scoped, unlike the register-check history:
   * this is the practice's own record of its own affiliation, and the query is
   * keyed on the practice so it cannot be pointed at another one's.
   */
  @Get('affiliations/:affiliationId/history')
  affiliationHistory(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('affiliationId', ParseUUIDPipe) affiliationId: string,
  ) {
    return this.affiliations.affiliationHistory(requirePractice(practiceId), affiliationId);
  }

  @RequireRoles(PLATFORM_ADMIN)
  @Get('practitioners/:practitionerId/registration/history')
  registerCheckHistory(@Param('practitionerId', ParseUUIDPipe) practitionerId: string) {
    return this.affiliations.registerCheckHistory(practitionerId);
  }

  @RequireRoles(PLATFORM_ADMIN)
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

  // --- The invitation, answered by the practitioner -------------------------
  //
  // UNSCOPED AND UNAUTHENTICATED, by necessity: the practitioner has no
  // account here yet. The token IS the authorisation, and everything behind
  // these two routes goes through SECURITY DEFINER functions keyed on it.
  //
  // Note there is no route by which a PRACTICE can answer. That is the rule
  // this whole flow exists to hold, and a convenience endpoint for the case
  // where the practitioner is standing right there would quietly dissolve it.

  /** What the page may show before a code is entered. Names the practice. */
  @Get('invitations/:token')
  invitationState(@Param('token') token: string) {
    return this.invitations.state(token);
  }

  /** Accept or decline. The CODE answers it; the link only addresses the page. */
  @Post('invitations/:token/answer')
  answerInvitation(@Param('token') token: string, @Body() dto: AnswerInvitationDto) {
    return this.invitations.answer(token, dto.code, dto.decision);
  }

  // --- Practice-scoped ------------------------------------------------------

  /** The ways notice can have been given outside AoBPlatform. */
  @Get('affiliations/external-notice/catalogue')
  externalNoticeCatalogue() {
    return { means: EXTERNAL_NOTICE_MEANS };
  }

  @Get('affiliations')
  list(@Headers('x-practice-id') practiceId: string | undefined, @SessionActor() actor: Actor | undefined) {
    const scope = requirePractice(practiceId);
    /*
     * IS THE CALLER THE PRACTICE, or somebody looking at it?
     *
     * The token's own claim answers it. A practice user carries this practice;
     * so does a platform operator with an acting-as session open, which is
     * right -- acting as them IS being them, recorded. An operator reading
     * read-only carries no claim at all, and gets the list without provider
     * numbers.
     *
     * Decided here rather than in the view, because a screen that decides what
     * to hide has already been sent the thing it is hiding.
     */
    const asPractice = actor?.practiceId === scope;
    return this.affiliations.listForPractice(scope, { asPractice });
  }

  /**
   * Invite a practitioner to a location. THE PRACTICE’S OWN ACT.
   *
   * A platform operator may not do this for them: an invitation is how a
   * practitioner comes to be named on consent records at a site, and if
   * the platform could originate one, the practice’s records would show
   * the practice inviting somebody it never invited.
   *
   * A platform user ACTING AS the practice passes, because they hold that
   * practice’s claim — and CRITICAL-ISSUES.md §5 rules 6 and 7 then force
   * a re-approval by a different person, which is the cost that stops
   * impersonation becoming the normal path.
   */
  @PracticeScoped()
  @Post('affiliations')
  invite(@Headers('x-practice-id') practiceId: string | undefined, @Body() dto: InviteAffiliationDto) {
    return this.affiliations.invite(requirePractice(practiceId), dto);
  }

  /**
   * Send (or re-send) the invitation email.
   *
   * Re-sending REPLACES the previous token, so an old link stops working the
   * moment a new one goes out — otherwise every re-send would leave another
   * live credential behind in an inbox.
   */
  @PracticeScoped()
  @Post('affiliations/:affiliationId/invitation')
  sendInvitation(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('affiliationId', ParseUUIDPipe) affiliationId: string,
  ) {
    return this.invitations.send(requirePractice(practiceId), affiliationId);
  }

  /** Offboarding. Notice runs BEFORE the end date (§6). */
  /**
   * Record that a practitioner is leaving. THE PRACTICE’S OWN ACT.
   *
   * Ending an affiliation stops consent being captured in that person’s
   * name at that site, and the practice is the only party that knows they
   * have gone. A platform operator ending one would be removing a
   * practitioner from a practice that never asked — and the practice’s
   * records would show the practice doing it.
   */
  @PracticeScoped()
  @Post('affiliations/:affiliationId/notice')
  giveNotice(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('affiliationId', ParseUUIDPipe) affiliationId: string,
    @Body() dto: GiveNoticeDto,
  ) {
    return this.affiliations.giveNotice(requirePractice(practiceId), affiliationId, dto);
  }

  // Withdrawing it is the same act, undone.
  @PracticeScoped()
  @Post('affiliations/:affiliationId/notice/withdraw')
  withdrawNotice(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('affiliationId', ParseUUIDPipe) affiliationId: string,
  ) {
    return this.affiliations.withdrawNotice(requirePractice(practiceId), affiliationId);
  }
}
