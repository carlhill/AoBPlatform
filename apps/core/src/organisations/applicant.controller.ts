import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { ApplicantService } from './applicant.service';

/*
 * The DTO is declared BEFORE the controller deliberately.
 *
 * emitDecoratorMetadata resolves parameter types when the controller class is
 * DEFINED, not when a request arrives, so a DTO declared below it is still in
 * its temporal dead zone and the module throws "Cannot access
 * AmendApplicationDto before initialization" at startup — a crash on boot, from
 * code that compiles and typechecks perfectly.
 */

/**
 * The six-digit code from the confirmation email.
 *
 * Six rather than four because four digits is ten thousand combinations, which
 * a script exhausts in seconds against an endpoint that does not refuse. Six is
 * a million, and with the five-attempt cap it is not worth anyone's time. The
 * cost to the applicant is two extra characters.
 */
export class VerifyEmailDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'The code is six digits.' })
  code!: string;
}

/**
 * What an applicant may change.
 *
 * There is no `abn` here and there must never be. Every check runs against one
 * legal entity; moving the ABN would carry a clean entity's passed checks onto
 * a different one, which is the whole shape of the attack. A different ABN is a
 * different application.
 *
 * Nor is there legalName, entityType or abnStatus: those come from the
 * Australian Business Register, and an applicant restating what the register
 * says is not evidence of anything.
 */
export class AmendApplicationDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() website?: string;

  @IsOptional() @IsString() adminName?: string;
  @IsOptional() @IsString() adminEmail?: string;
  @IsOptional() @IsString() adminPhone?: string;
  @IsOptional() @IsString() adminPosition?: string;

  @IsOptional() @IsString() managerName?: string;
  @IsOptional() @IsString() managerEmail?: string;
  @IsOptional() @IsString() managerPhone?: string;
  @IsOptional() @IsString() managerPosition?: string;

  @IsOptional() @IsString() headOfficeLine1?: string;
  @IsOptional() @IsString() headOfficeLine2?: string;
  @IsOptional() @IsString() headOfficeSuburb?: string;
  @IsOptional() @IsString() headOfficeState?: string;
  @IsOptional() @IsString() headOfficePostcode?: string;

  @IsOptional() @IsInt() @Min(1) @Max(2000) statedPractitionerCount?: number;
}

/**
 * The applicant's own surfaces: check the status, correct a mistake.
 *
 * EVERY route here is UNAUTHENTICATED and reached with a bearer token in the
 * URL. That shapes what may be exposed, and the constraint is worth stating
 * plainly rather than leaving to be inferred:
 *
 *   - The token is 256 bits of randomness, so guessing is not the threat.
 *     Forwarding is. An applicant forwards the acknowledgement email and the
 *     recipient has whatever these routes return.
 *   - So these routes return what the applicant THEMSELVES submitted, plus the
 *     register values already shown on their own confirmation screen, plus
 *     which of the three gates has been reached. Nothing else.
 *   - Specifically NOT: the reviewer's note, who is reviewing, the checklist,
 *     any check outcome, the identity score, or whether an ABN is already
 *     registered here. That last one would turn a status query into a way to
 *     enumerate our customers — the same rule already enforced on rejection
 *     reasons.
 *
 * A check outcome is the sharpest of those. Telling an applicant that
 * "entitlement.phone_call FAILED" tells them precisely what to change before
 * trying again, which is help we are not in the business of giving.
 */
@Controller('applications')
export class ApplicantController {
  constructor(private readonly applicant: ApplicantService) {}

  /** Where the application has got to. Three gates, no detail. */
  @Get(':token/status')
  status(@Param('token') token: string) {
    return this.applicant.status(token);
  }

  /**
   * Confirm control of the admin email address.
   *
   * A GET, because it is reached by clicking a link in an email and there is
   * nowhere to POST from. That makes it vulnerable to being fetched by a mail
   * scanner or link-preview bot rather than a person — which is a real
   * limitation, and an accepted one: the failure mode is an address marked
   * confirmed slightly too eagerly, on a signal we deliberately treat as weak
   * and never as entitlement.
   */
  /**
   * What the page may show before a code is typed.
   *
   * A GET, and deliberately harmless: a mail scanner or link-preview bot
   * fetching this changes nothing at all. That is the whole point of splitting
   * the confirmation in two.
   */
  @Get('verify/:token')
  verifyState(@Param('token') token: string) {
    return this.applicant.emailVerificationState(token);
  }

  /** The code. This is the phase that actually confirms anything. */
  @Post('verify/:token')
  verify(@Param('token') token: string, @Body() dto: VerifyEmailDto) {
    return this.applicant.verifyEmail(token, dto.code);
  }

  /** The applicant's own values, for correcting. */
  @Get(':token/application')
  application(@Param('token') token: string) {
    return this.applicant.amendableApplication(token);
  }

  @Post(':token/amend')
  amend(@Param('token') token: string, @Body() dto: AmendApplicationDto) {
    return this.applicant.amend(token, { ...dto });
  }
}
