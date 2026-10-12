import { Body, Controller, Get, Ip, Param, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Public } from '../auth/public.decorator';
import { DrawnSignatureDto } from '../agreements/agreements.dto';
import { AgreeService } from './agree.service';

class ApproveDto {
  /**
   * `tap_to_approve`, or `drawn` ON A DB4 ONLY (TELEHEALTH-PLAN §8 step 1,
   * 12 Oct 2026).
   *
   * The link used to take a tap and nothing else, because a drawing had
   * nowhere to live. It has since: the kiosk's `drawn` signature stores the
   * strokes and the image as artefacts and binds both hashes on the signature
   * event (REQ-SIG-01/-02), and the Signed-DB4 composites that image onto the
   * practice's form. A DB4 sent to a patient's phone has to be signable the
   * way the tablet signs it, or the chart folder never receives a Signed-DB4
   * (`no_drawn_signature`).
   *
   * WHICH AGREEMENTS MAY TAKE `drawn` IS THE SERVICE'S RULE, not this class's
   * — it depends on the agreement, so it lives where it can be tested
   * (`link_takes_a_drawing_only_on_a_db4`).
   */
  @IsIn(['tap_to_approve', 'drawn'])
  method!: 'tap_to_approve' | 'drawn';

  /**
   * THE MARK, for `drawn` — the same DTO the kiosk's `POST /agreements/:id/sign`
   * validates, so the size caps and the PNG check are one set of rules
   * (`assertSignatureCaptureAcceptable`). Never logged, never echoed.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => DrawnSignatureDto)
  signature?: DrawnSignatureDto;

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
    return this.agree.approve(token, dto.method, ip, dto.affirmations ?? [], dto.signature);
  }
}
