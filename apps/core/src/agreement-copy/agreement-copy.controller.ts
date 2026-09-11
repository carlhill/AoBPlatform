import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { AgreementCopyService } from './agreement-copy.service';

/**
 * THE PUBLIC END OF A COPY LINK — W6, REQ-PORT-02.
 *
 * PUBLIC BECAUSE THE TOKEN IS THE AUTHORITY, exactly as the capture link and
 * the activation invitation are. It was sent to an address the record already
 * held for the person who signed, it opens ONE document that that person has
 * already read and already signed, and it grants nothing else: no list, no
 * other agreement, no account.
 *
 * IT ASKS FOR NOTHING. No identifiers, no sign-in, no details. The portal's
 * own copy route asks three identifiers because it opens a WHOLE RECORD; this
 * opens the single document the reader was sent, and putting a quiz in front
 * of it would make a copy of your own signature harder to get than the
 * signature was.
 *
 * `no-store`, `nosniff`, and the hash in a header the reader can quote back —
 * one definition of how a file leaves this platform.
 *
 * ROUTE SHAPE: `/agreement-copy/:token` sits at the root and shadows nothing.
 * It is deliberately not under `/portal`, which is the account world, or under
 * `/agreements/:id`, which is the practice's.
 */
@Controller('agreement-copy')
export class AgreementCopyController {
  constructor(private readonly copies: AgreementCopyService) {}

  @Public()
  @Get(':token')
  async serve(@Param('token') token: string, @Res() res: Response) {
    const artefact = await this.copies.serve(token);
    res.setHeader('Content-Type', artefact.mediaType);
    res.setHeader('Content-Disposition', `attachment; filename="${artefact.filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    // The hash the reader can quote back. Their copy is checkable against the
    // record without them having to ask us what it should be.
    res.setHeader('X-Artefact-Sha256', artefact.sha256);
    res.send(artefact.bytes);
  }
}
