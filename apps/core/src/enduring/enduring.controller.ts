import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ArrayMinSize, IsArray, IsIn, IsISO8601, IsOptional, IsString, IsUUID } from 'class-validator';
import { EnduringService } from './enduring.service';
import { AUTOMATIC_CESSATION_TRIGGERS } from '@aobplatform/domain';

export class CreateEnduringDto {
  @IsUUID()
  agreementId!: string;

  /** Reg 89AA notices must use this method — fidelity is checked against it (REQ-DEL-02). */
  @IsIn(['sms', 'email', 'post', 'portal'])
  notificationMethod!: string;

  @IsOptional()
  @IsIn(['sms', 'email', 'post', 'portal'])
  notificationAlternate?: string;

  @IsIn(['sms', 'email', 'post', 'portal', 'in_writing'])
  terminationMethod!: string;

  @IsOptional()
  @IsString()
  responsiblePersonBasis?: string;

  @IsIn(['category', 'group', 'subgroup', 'item', 'combination'])
  scopeType!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  scopeValues!: string[];

  @IsOptional()
  @IsISO8601()
  patientDeclarationAt?: string;
}

export class TerminateDto {
  @IsIn(['patient', 'assignor', 'provider', 'practice'])
  initiatedBy!: 'patient' | 'assignor' | 'provider' | 'practice';
}

export class CeaseDto {
  @IsIn(AUTOMATIC_CESSATION_TRIGGERS as unknown as string[])
  trigger!: string;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

@Controller('enduring')
export class EnduringController {
  constructor(private readonly enduring: EnduringService) {}

  @Post()
  create(@Headers('x-practice-id') practiceId: string | undefined, @Body() dto: CreateEnduringDto) {
    return this.enduring.create(requirePractice(practiceId), dto);
  }

  /** REQ-END-06a — show the commitment before it is made. */
  @Get(':agreementId/scope-preview')
  scopePreview(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
  ) {
    return this.enduring.scopePreview(requirePractice(practiceId), agreementId);
  }

  /** REQ-END-06 — either party; the patient may terminate even if they did not sign. */
  @Post(':agreementId/terminate')
  terminate(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @Body() dto: TerminateDto,
  ) {
    return this.enduring.terminate(requirePractice(practiceId), agreementId, dto);
  }

  /** 65CA(8) automatic cessation. */
  @Post(':agreementId/cease')
  cease(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @Body() dto: CeaseDto,
  ) {
    return this.enduring.cease(requirePractice(practiceId), agreementId, dto.trigger as never);
  }

  /**
   * FR-5.5 — coverage query used by the capture cascade's first stage.
   *
   * NAME THE PERSON, NOT THE ROW (Carl, 7 Sep 2026). Coverage is per
   * practitioner × patient (REQ-END-01, hard rule 6), so `practitionerId` is
   * the true question and `affiliationId` is resolved to it — a GP at two of
   * the practice's sites is one practitioner, and asking about one site would
   * report the same patient as uncovered at the other.
   *
   * `providerId` still answers for agreements made before the anchor moved,
   * and goes when that column does.
   */
  @Get('coverage')
  coverage(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Query('patientId') patientId: string,
    @Query('practitionerId') practitionerId?: string,
    @Query('affiliationId') affiliationId?: string,
    @Query('providerId') providerId?: string,
    @Query('at') at?: string,
  ) {
    return this.enduring.coverage(requirePractice(practiceId), {
      patientId,
      practitionerId,
      affiliationId,
      providerId,
      at,
    });
  }

  @Get('anniversary-pipeline')
  anniversaryPipeline(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.enduring.anniversaryPipeline(requirePractice(practiceId));
  }

  @Get('fourteenth-birthday-due')
  fourteenthBirthdayDue(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.enduring.fourteenthBirthdayDue(requirePractice(practiceId));
  }
}
