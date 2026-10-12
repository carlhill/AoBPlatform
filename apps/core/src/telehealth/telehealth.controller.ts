import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { APPROVED_IDENTIFIER_TYPES, TELEHEALTH_CHANNELS, TELEHEALTH_NOT_DONE_REASON_KEYS } from '@aobplatform/domain';
import { Public } from '../auth/public.decorator';
import { SessionActor, type Actor } from '../auth/actor.decorator';
import { TelehealthService } from './telehealth.service';

/**
 * SEND: who, which identifier TYPES were checked, who is on the call, and how.
 *
 * NO CONTACT FIELD AND NO VALUE FIELD, AND THERE NEVER WILL BE. The link goes
 * to the contact on the record (D-2026-09-11-03); `whitelist: true` on the
 * global pipe strips anything else a caller sends. The identifier types are
 * checked against the approved six in the service (hard rule 1).
 */
export class SendTelehealthDto {
  @IsUUID()
  patientId!: string;

  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  // The approved six at the boundary (hard rule 1). The message names the rule, never the value sent (hard rule 9).
  @IsIn(APPROVED_IDENTIFIER_TYPES as unknown as string[], {
    each: true,
    message: 'identifierTypes may hold only the approved identifier types',
  })
  identifierTypes!: string[];

  @IsIn(TELEHEALTH_CHANNELS as unknown as string[])
  channel!: string;

  /** Explicit, never defaulted (D7): the patient, or somebody acting for them. */
  @IsBoolean()
  consenterIsPatient!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  consenterRelationship?: string;

  @IsOptional()
  @IsBoolean()
  consenterAttested18?: boolean;
}

export class SendAgainDto {
  @IsOptional()
  @IsIn(TELEHEALTH_CHANNELS as unknown as string[])
  channel?: string;
}

/** The reason is a key from the versioned list; the note only for the one reason that takes it. */
export class NotDoneDto {
  @IsIn(TELEHEALTH_NOT_DONE_REASON_KEYS as unknown as string[])
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  @IsOptional()
  @IsISO8601()
  consultationAt?: string;
}

export class RecordNotDoneDto extends NotDoneDto {
  @IsUUID()
  patientId!: string;
}

export class DidNotProceedDto {
  @IsOptional()
  @IsISO8601()
  consultationAt?: string;
}

export class EnterCodeDto {
  /** Digits only, so nothing else ever reaches the comparison or a log. */
  @IsString()
  @Matches(/^[0-9]{4,10}$/)
  code!: string;
}

export class AgreeDto {
  @IsString()
  @MaxLength(80)
  consentKey!: string;
}

/**
 * THE PROVIDER'S TELEHEALTH PANEL (TELEHEALTH-PLAN.md §3 steps 2–8, §4).
 *
 * NOT `@PracticeScoped()`, FOR THE REASON THE PRACTITIONER QUEUE GIVES: a
 * practitioner's token carries no practice claim. The practice is resolved and
 * CHECKED against their own live affiliations before any scope opens, and RLS
 * hides the rest. The practitioner is never in the path: it comes off the
 * token. Passkey sign-in is the console's, unchanged (hard rule 15).
 *
 * 404 `telehealth_not_enabled` on every route but `enabled` while the flag is
 * off, which is the default.
 */
@Controller('telehealth')
export class TelehealthController {
  constructor(private readonly telehealth: TelehealthService) {}

  @Get('enabled')
  enabled() {
    return { enabled: this.telehealth.enabled() };
  }

  @Get('patients')
  patients(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Query('q') q: string | undefined,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.telehealth.searchPatients(actor, practiceId, q ?? '');
  }

  @Get('patients/:patientId/contact')
  contact(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.telehealth.contact(actor, practiceId, patientId);
  }

  @Get('sessions')
  list(@Headers('x-practice-id') practiceId: string | undefined, @SessionActor() actor: Actor | undefined) {
    return this.telehealth.list(actor, practiceId);
  }

  @Post('sessions')
  send(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Body() dto: SendTelehealthDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.telehealth.send(actor, practiceId, dto);
  }

  @Post('sessions/:id/send-again')
  sendAgain(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendAgainDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.telehealth.sendAgain(actor, practiceId, id, dto);
  }

  @Post('sessions/:id/not-done')
  notDone(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NotDoneDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.telehealth.markNotDone(actor, practiceId, id, dto);
  }

  @Post('not-done')
  recordNotDone(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Body() dto: RecordNotDoneDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.telehealth.recordNotDone(actor, practiceId, dto);
  }

  @Post('sessions/:id/did-not-proceed')
  didNotProceed(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DidNotProceedDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.telehealth.markDidNotProceed(actor, practiceId, id, dto);
  }

  /*
   * THE PATIENT'S PAGE — public, because the person holding the link has no
   * account and must never need one (REQ-PORT-08). The token, then the page
   * key, is the only credential; the practice scope comes from it.
   */

  @Public()
  @Get('link/:token')
  landing(@Param('token') token: string) {
    return this.telehealth.landing(token);
  }

  @Public()
  @Post('link/:token/code')
  enterCode(@Param('token') token: string, @Body() dto: EnterCodeDto) {
    return this.telehealth.enterCode(token, dto.code);
  }

  @Public()
  @Get('page')
  page(@Headers('x-telehealth-page-key') pageKey: string | undefined) {
    return this.telehealth.page(pageKey);
  }

  @Public()
  @Post('page/agree')
  agree(@Headers('x-telehealth-page-key') pageKey: string | undefined, @Body() dto: AgreeDto) {
    return this.telehealth.agree(pageKey, dto.consentKey);
  }
}
