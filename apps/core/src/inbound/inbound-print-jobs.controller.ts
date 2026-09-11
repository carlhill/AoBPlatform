import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsISO8601, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import type { PrintJobEnvelope } from '@aobplatform/contracts';
import { PRINT_DOCUMENT_TYPES } from '@aobplatform/domain';
import { PracticeScoped } from '../auth/practice-scope.decorator';
import { InboundPrintJobsService } from './inbound-print-jobs.service';

/*
 * THE DOOR IS WHERE DATA MINIMISATION IS ENFORCED. These DTOs name exactly the
 * fields a print job may carry — the adapter contract's own shapes — and the
 * global ValidationPipe runs with `whitelist: true`, so anything else a
 * desktop sends is stripped before it is stored. No Medicare number has a
 * field to land in. That is not a courtesy; it is HARD-03 at the boundary.
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
}
