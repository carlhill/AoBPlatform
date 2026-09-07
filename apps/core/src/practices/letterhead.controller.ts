import { BadRequestException, Body, Controller, Delete, Get, Headers, Post } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { MAX_LOGO_BYTES } from '@aobplatform/domain';
import { LetterheadService } from './letterhead.service';
import { SessionActor, type Actor } from '../auth/actor.decorator';
import { PracticeScoped } from '../auth/practice-scope.decorator';

/**
 * Base64 in JSON rather than multipart, for the reason `UploadArtefactDto`
 * gives: a multipart parser is more attack surface than a 512 KB image
 * justifies, and base64 keeps the request one validated DTO.
 */
export class SetLogoDto {
  @IsString()
  @MinLength(4)
  @MaxLength(Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 128)
  contentBase64!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  filename?: string;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

/**
 * The practice letterhead — read the fields the agreement will print, and set
 * or clear the logo (W1).
 *
 * A SEPARATE PREFIX FROM `/practices/:id/config`, deliberately. Everything on
 * the config endpoint is a SETTING the practice chooses; almost everything
 * here is a FACT the platform already holds and merely renders — the legal
 * name, the ABR-verified ABN, the registered address. Putting them behind a
 * PATCH would invite a screen that offers to edit them, and a letterhead that
 * can disagree with the register is a letterhead that will.
 */
@Controller('practices/letterhead')
@PracticeScoped()
export class LetterheadController {
  constructor(private readonly letterhead: LetterheadService) {}

  @Get()
  settings(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.letterhead.settings(requirePractice(practiceId));
  }

  @Post('logo')
  setLogo(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Body() dto: SetLogoDto,
    @SessionActor() actor?: Actor,
  ) {
    let bytes: Uint8Array;
    try {
      const cleaned = dto.contentBase64.replace(/^data:[^;]*;base64,/, '').replace(/\s+/g, '');
      bytes = new Uint8Array(Buffer.from(cleaned, 'base64'));
    } catch {
      throw new BadRequestException('contentBase64 is not valid base64.');
    }
    return this.letterhead.setLogo(requirePractice(practiceId), bytes, dto.filename, actor);
  }

  @Delete('logo')
  clearLogo(@Headers('x-practice-id') practiceId: string | undefined, @SessionActor() actor?: Actor) {
    return this.letterhead.clearLogo(requirePractice(practiceId), actor);
  }
}
