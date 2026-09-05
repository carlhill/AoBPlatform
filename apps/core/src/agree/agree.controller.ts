import { Body, Controller, Get, Ip, Param, Post } from '@nestjs/common';
import { IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Public } from '../auth/public.decorator';
import { AgreeService } from './agree.service';

class ApproveDto {
  /**
   * tap_to_approve only, from a link. Carl accepted either method (Part 6
   * Q4); a drawn signature belongs on the kiosk where there is a stylus and
   * somewhere for the image to live — `SignatureEvent` has no image column
   * yet, so accepting `drawn` here would record a method with nothing behind
   * it.
   */
  @IsIn(['tap_to_approve'])
  method!: 'tap_to_approve';

  /**
   * THE STATEMENTS THE PERSON TICKED — keys, never sentences (Carl, 5 Sep
   * 2026; W1). The words are the server's own, at the version the agreement
   * records; a page that could send text could send text nobody agreed to.
   *
   * Optional here and mandatory in the service, for the reason the kiosk's
   * `SignDto` gives: the rule is about the AGREEMENT'S template rather than
   * about this class, so it lives where a rule can be tested.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  affirmations?: string[];
}

/**
 * The patient's side of a remote capture — public, because the person
 * holding the link has no account and must never need one (REQ-PORT-08).
 *
 * The sequence a patient's browser walks: `GET /capture/link/:token` (the
 * content-blind challenge) → `POST /capture/link/:token/verify` → `GET
 * /agree/:token` (what they are agreeing to, locked) → `POST
 * /agree/:token/approve`. The first two already existed; these two are the
 * half that was missing.
 */
@Controller('agree')
export class AgreeController {
  constructor(private readonly agree: AgreeService) {}

  @Public()
  @Get(':token')
  read(@Param('token') token: string) {
    return this.agree.read(token);
  }

  /** The patient's half of the correspondence log (design P-1, Messages tab). */
  @Public()
  @Get(':token/messages')
  messages(@Param('token') token: string) {
    return this.agree.messages(token);
  }

  @Public()
  @Post(':token/approve')
  approve(@Param('token') token: string, @Body() dto: ApproveDto, @Ip() ip: string) {
    return this.agree.approve(token, dto.method, ip, dto.affirmations ?? []);
  }
}
