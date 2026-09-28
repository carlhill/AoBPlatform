import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsISO8601, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import type { PrintJobEnvelope } from '@aobplatform/contracts';
import { PRINT_DOCUMENT_TYPES } from '@aobplatform/domain';
import { PracticeScoped } from '../auth/practice-scope.decorator';
import { InboundPrintJobsService } from './inbound-print-jobs.service';

/*
 * THE DOOR IS WHERE DATA MINIMISATION IS ENFORCED. These DTOs name exactly the
 * fields a print job may carry — the adapter contract's own shapes — and the
 * global ValidationPipe runs with `whitelist: true`, so anything else a
 * desktop sends is stripped before it is stored. That is not a courtesy; it is
 * HARD-03 at the boundary.
 *
 * ON THE GENERIC SHAPES BELOW, NO MEDICARE NUMBER HAS A FIELD TO LAND IN, and
 * `inbound_print_jobs_strips_a_medicare_number` still proves it. The DB4 Print
 * Record is the single, decided exception (`Db4PatientDto`,
 * D-2026-09-14-03): the Signed-DB4 reproduces the practice's own printed form,
 * so the number the form prints travels with the form and is stored on the job
 * row. It goes no further — hard rule 1's actual prohibitions (never to verify,
 * never to match, never in a log or an event, never to the rules service) are
 * unchanged, and `the_medicare_number_never_reaches_the_agreement_or_an_event`
 * is the test that says so.
 */
class PatientDto {
  @IsString() @MaxLength(200) pmsLinkageKey!: string;
  @IsString() @MaxLength(200) familyName!: string;
  @IsString() @MaxLength(200) givenNames!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateOfBirth!: string;
  @IsOptional() @IsString() @MaxLength(50) genderAsIdentified?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(100) patientRecordNumber?: string;
  @IsOptional() @IsString() @MaxLength(50) ihi?: string;
  @IsOptional() @IsString() @MaxLength(20) preferredLanguage?: string;
  @IsOptional() @IsString() @MaxLength(30) mobile?: string;
  @IsOptional() @IsString() @MaxLength(320) email?: string;
}

class ProviderDto {
  @IsString() @MaxLength(200) pmsProviderKey!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(20) providerNumber?: string;
  @IsOptional() @IsString() @MaxLength(500) locationAddress?: string;
  /**
   * `servicing` or `payee` on a DB4, absent everywhere else — the one field the
   * DB4 adds to a shape it otherwise shares. Only the SERVICING provider
   * anchors the visit; the payee is recorded and never used to anchor, because
   * an agreement has to name whose number the claim goes under (s 65C(5)(a)).
   * Not `@IsIn`: an unexpected role is data to record, not a form to refuse.
   */
  @IsOptional() @IsString() @MaxLength(20) role?: string;
}

/* ---------------------------------------------------------------------------
 * THE DB4 PRINT RECORD AT THE DOOR (DB4-AND-AOBL.md §13a piece 1).
 *
 * WHY THESE CLASSES EXIST AT ALL. `ValidationPipe({ whitelist: true })` strips
 * every property no DTO declares — which is the right posture for the generic
 * print lane and was, until this build, the reason a posted DB4 was stored as
 * five envelope fields and a discarded form. Declaring the shape is the fix,
 * and `a_db4_record_survives_the_validation_pipe` is the test that names the
 * bug.
 *
 * EVERY FIELD IS OPTIONAL, deliberately (see `Db4Form` in
 * `packages/contracts/src/print-capture.ts`). A field the parser could not read
 * off the page is absent, and a door that refused an unreadable form would turn
 * it into a permanent 400 the desktop retries or poisons — when the honest
 * answer is to keep the record and say on the job row why nothing could be made
 * of it (hard rule 8).
 *
 * THE MEDICARE NUMBER AND THE AMOUNTS HAVE FIELDS HERE AND NOWHERE ELSE. They
 * are content on the practice's own form (D-2026-09-14-03), stored on the job
 * row, and the handler never copies either into a `ServiceRenderedDto` — which
 * has no field either could land in, and a fence that refuses one out loud.
 * ------------------------------------------------------------------------- */

class Db4HeadingDto {
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(500, { each: true }) lines?: string[];
}

class Db4FormDto {
  @IsOptional() @IsString() @MaxLength(50) formCode?: string;
  /** The correlation key for every later message about this form, and the idempotency key. */
  @IsOptional() @IsString() @MaxLength(100) formReference?: string;
  @IsOptional() @IsString() @MaxLength(100) locationId?: string;
  @IsOptional() @IsString() @MaxLength(200) claimStatus?: string;
  @IsOptional() @IsBoolean() signedOnPaper?: boolean;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) serviceDate?: string;
  @IsOptional() @IsString() @MaxLength(10) currency?: string;
}

class Db4ServicingLocationDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(200, { each: true }) addressLines?: string[];
  @IsOptional() @IsString() @MaxLength(100) suburb?: string;
  @IsOptional() @IsString() @MaxLength(20) state?: string;
  @IsOptional() @IsString() @MaxLength(10) postcode?: string;
}

class Db4PatientDto {
  @IsOptional() @IsString() @MaxLength(200) pmsLinkageKey?: string;
  /** The practice's chart number — the ONLY key a DB4 is matched on (hard rule 1). */
  @IsOptional() @IsString() @MaxLength(100) patientRecordNumber?: string;
  /*
   * CARRIED, NEVER AN IDENTIFIER (D-2026-09-14-03). The single exception to the
   * file header above, and it is a decision with its own entry rather than an
   * oversight: the Signed-DB4 reproduces the form, so the number the form
   * prints has to travel. It is never used to verify anybody, never used to
   * match anybody, never logged and never put on an event.
   */
  // eslint-disable-next-line no-restricted-syntax
  @IsOptional() @IsString() @MaxLength(30) medicareCardNumber?: string;
  @IsOptional() @IsString() @MaxLength(5) irn?: string;
  @IsOptional() @IsString() @MaxLength(200) givenNames?: string;
  @IsOptional() @IsString() @MaxLength(200) familyName?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateOfBirth?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(30) mobile?: string;
}

class Db4ServiceDto {
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) serviceDate?: string;
  @IsOptional() @IsString() @MaxLength(10) time?: string;
  @IsOptional() @IsString() @MaxLength(10) mbsItemNumber?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  /** What PracSoft printed. Reproduced on the Signed-DB4, never on an agreement (hard rule 4). */
  @IsOptional() @IsString() @MaxLength(20) benefitAssigned?: string;
}

class Db4StatementDto {
  @IsOptional() @IsString() @MaxLength(100) key?: string;
  @IsOptional() @IsString() @MaxLength(1000) text?: string;
  @IsOptional() @IsBoolean() ticked?: boolean;
  /** False for the pathology statement — carried as data, never acted on. */
  @IsOptional() @IsBoolean() inScope?: boolean;
}

class Db4AssignmentDto {
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(2000, { each: true }) privacyNotice?: string[];
  @IsOptional() @IsString() @MaxLength(20) statementsJoinedBy?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => Db4StatementDto) statements?: Db4StatementDto[];
}

class Db4ReferralDto {
  @IsOptional() @IsString() @MaxLength(50) acrf?: string | null;
  @IsOptional() @IsString() @MaxLength(50) lspn?: string | null;
  @IsOptional() @IsString() @MaxLength(200) requestingProviderName?: string | null;
  @IsOptional() @IsString() @MaxLength(20) requestingProviderNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(20) dateOfRequest?: string | null;
  @IsOptional() @IsString() @MaxLength(100) periodOfReferral?: string | null;
}

class AppointmentDto {
  @IsString() @MaxLength(200) pmsAppointmentKey!: string;
  @IsString() @MaxLength(200) patientLinkageKey!: string;
  @IsString() @MaxLength(200) providerLinkageKey!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsOptional() @IsString() @MaxLength(10) time?: string;
}

class InvoiceDto {
  @IsString() @MaxLength(200) pmsInvoiceKey!: string;
  @IsString() @MaxLength(200) patientLinkageKey!: string;
  @IsString() @MaxLength(200) providerLinkageKey!: string;
  @IsString() @MaxLength(20) serviceDate!: string;
  @IsArray() @IsString({ each: true }) @MaxLength(10, { each: true }) mbsItemNumbers!: string[];
}

export class PrintJobEnvelopeDto {
  @IsIn(PRINT_DOCUMENT_TYPES as unknown as string[])
  documentType!: (typeof PRINT_DOCUMENT_TYPES)[number];

  @IsString() @Matches(/^[0-9a-fA-F]{64}$/) sourceSha256!: string;
  @IsString() @MaxLength(100) parserTemplateVersion!: string;
  @IsString() @MaxLength(100) pms!: string;
  @IsISO8601() capturedAt!: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PatientDto) patients?: PatientDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ProviderDto) providers?: ProviderDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AppointmentDto) appointments?: AppointmentDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => InvoiceDto) invoices?: InvoiceDto[];

  /* --- db4_assignment. The whole printed form, so the record survives the door. --- */
  /** Which print queue produced the form. Attribution, never PII (D-2026-09-17-02). */
  @IsOptional() @IsString() @MaxLength(100) queueName?: string;
  @IsOptional() @IsString() @MaxLength(100) queueLabel?: string;
  @IsOptional() @ValidateNested() @Type(() => Db4HeadingDto) heading?: Db4HeadingDto;
  @IsOptional() @ValidateNested() @Type(() => Db4FormDto) form?: Db4FormDto;
  @IsOptional() @ValidateNested() @Type(() => Db4ServicingLocationDto) servicingLocation?: Db4ServicingLocationDto;
  /** SINGULAR — a DB4 is one patient's form, and `patients` is the generic path's shape. */
  @IsOptional() @ValidateNested() @Type(() => Db4PatientDto) patient?: Db4PatientDto;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => Db4ServiceDto) services?: Db4ServiceDto[];
  @IsOptional() @ValidateNested() @Type(() => Db4AssignmentDto) assignment?: Db4AssignmentDto;
  @IsOptional() @ValidateNested() @Type(() => Db4ReferralDto) referral?: Db4ReferralDto;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

/**
 * Where a practice's desktop delivers what the PMS printed.
 *
 * 202, NOT 201. Nothing has been processed when this returns — the row is on
 * its lane and a worker will take it at the lane's pace. Saying "created"
 * would promise a draft exists; "accepted" is what is true.
 *
 * PRACTICE-SCOPED, THE PRACTICE'S OWN ACT. A platform operator has no business
 * feeding a practice print jobs, and `@PracticeScoped` says so the same way it
 * does for inviting a practitioner. Per-device signatures (8.5) arrive with
 * device enrolment in item 8; until then the row records `credentialKind:
 * 'practice'` so nothing later mistakes it for a device-attested job.
 */
@Controller('inbound/print-jobs')
export class InboundPrintJobsController {
  constructor(private readonly jobs: InboundPrintJobsService) {}

  @Post()
  @HttpCode(202)
  @PracticeScoped()
  ingest(@Headers('x-practice-id') practiceId: string | undefined, @Body() dto: PrintJobEnvelopeDto) {
    return this.jobs.ingest(requirePractice(practiceId), dto as unknown as PrintJobEnvelope, { kind: 'practice' });
  }

  @Get('metrics')
  metrics(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.jobs.metrics(requirePractice(practiceId));
  }

  /**
   * WHAT BECAME OF ONE PRINT JOB. The AOBPrinter test tool posts a DB4, gets
   * a 202 with an id, and reads this to learn whether it PLACED or was
   * refused and why — see `InboundPrintJobsService.status`, which returns
   * state, codes and timestamps and NEVER the stored envelope.
   *
   * AFTER `metrics` IN THE FILE AND AFTER IT ON THE ROUTER. A `:id` parameter
   * would otherwise swallow `/metrics` and answer it with "no such job".
   */
  @Get(':id')
  @PracticeScoped()
  status(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.jobs.status(requirePractice(practiceId), id);
  }
}
