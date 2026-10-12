import { SessionActor, type Actor } from '../auth/actor.decorator';
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
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { ARTEFACT_PURPOSES } from '@aobplatform/domain';
import { ArtefactsService } from './artefacts.service';

/**
 * Upload as base64 in JSON rather than multipart.
 *
 * A deliberate choice: multipart needs a parser dependency, and a parser is
 * more attack surface than the problem justifies at this size. Base64 costs a
 * third in bandwidth on files capped at 20 MB, which is nothing, and keeps the
 * request one validated DTO. Revisit if artefacts ever get large.
 */
export class UploadArtefactDto {
  @IsString()
  @MinLength(4)
  contentBase64!: string;

  @IsOptional()
  @IsString()
  declaredContentType?: string;

  @IsOptional()
  @IsString()
  filename?: string;

  @IsIn(ARTEFACT_PURPOSES as unknown as string[])
  purpose!: string;

  @IsString()
  @MinLength(1)
  uploadedByName!: string;

  @IsOptional()
  @IsString()
  subjectType?: string;

  @IsOptional()
  @IsString()
  subjectId?: string;
}

export class TombstoneDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

@Controller('artefacts')
export class ArtefactsController {
  constructor(private readonly artefacts: ArtefactsService) {}

  @Post()
  upload(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Body() dto: UploadArtefactDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    let bytes: Uint8Array;
    try {
      // Strict: a data: URL prefix or stray whitespace would otherwise be
      // decoded into leading bytes that shift every signature check.
      const cleaned = dto.contentBase64.replace(/^data:[^;]*;base64,/, '').replace(/\s+/g, '');
      bytes = new Uint8Array(Buffer.from(cleaned, 'base64'));
    } catch {
      throw new BadRequestException('contentBase64 is not valid base64.');
    }
    /*
     * THE SESSION WINS. A name in the body is an assertion by whoever sent
     * the request; the token subject is a claim the realm signed. The body
     * value survives only where there is no verified session at all, which
     * is the staged-auth path and not a state to write new evidence from.
     */
    const uploadedByName = actor?.name ?? dto.uploadedByName;
    if (!uploadedByName) {
      throw new BadRequestException(
        'Evidence records who supplied it, so this needs a signed-in user.',
      );
    }
    return this.artefacts.upload(requirePractice(practiceId), { ...dto, uploadedByName, bytes });
  }

  @Get()
  list(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Query('subjectType') subjectType?: string,
    @Query('subjectId') subjectId?: string,
  ) {
    return this.artefacts.list(requirePractice(practiceId), { subjectType, subjectId });
  }

  /**
   * Download. Always an attachment, always with the DETECTED content type,
   * always nosniff — the headers come from the domain layer so there is one
   * definition of how an artefact is served.
   */
  /**
   * Does this file actually evidence what it is about to be cited for?
   *
   * Called after upload and before the check is saved, because the check being
   * evidenced is not known at upload time — a file is uploaded, then cited.
   *
   * Returns WARNINGS, never a refusal. Both of the things it looks for are
   * defeatable by anyone actually trying: a hash match is beaten by re-exporting
   * the file, and a content match is satisfied by a fabricated screenshot. What
   * a warning does that a block cannot is put a specific, checkable statement in
   * front of the person deciding, at the moment they can still act on it.
   */
  @Get(':artefactId/inspect')
  inspect(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('artefactId', ParseUUIDPipe) artefactId: string,
    @Query('checkKey') checkKey?: string,
    @Query('identifier') identifier?: string,
    @Query('identifierLabel') identifierLabel?: string,
  ) {
    return this.artefacts.inspect(requirePractice(practiceId), artefactId, {
      checkKey,
      identifier,
      identifierLabel,
    });
  }

  @Get(':artefactId/content')
  async download(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Headers('x-read-by') readBy: string | undefined,
    @Param('artefactId', ParseUUIDPipe) artefactId: string,
    @SessionActor() actor: Actor | undefined,
    @Res() res: Response,
  ) {
    const { bytes, headers } = await this.artefacts.download(
      requirePractice(practiceId),
      artefactId,
      actor?.name ?? readBy ?? 'unattributed',
    );
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
    res.send(Buffer.from(bytes));
  }

  /** Removes the content. The row, hash and provenance survive. */
  @Post(':artefactId/remove')
  tombstone(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('artefactId', ParseUUIDPipe) artefactId: string,
    @Body() dto: TombstoneDto,
  ) {
    return this.artefacts.tombstone(requirePractice(practiceId), artefactId, dto.reason);
  }
}
