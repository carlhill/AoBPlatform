import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { PortalService } from './portal.service';
import { PortalReadsService } from './portal-reads.service';
import { ActivatePortalDto, CorrectionRequestDto } from './portal.dto';
import { clearPortalCookie, readPortalCookie, setPortalCookie } from './portal-cookie';
import { clientKey } from './portal-client-key';

/**
 * THE PATIENT'S OWN PAGE — C8, and a GA MUST (REQ-PORT-01..08, FR-8.1/8.2).
 *
 * EVERY ROUTE IS `@Public()`, and that word is doing something specific here.
 * It means "reachable without a Keycloak account", not "reachable without
 * proving who you are" — a patient has no console login and must never need one
 * (REQ-PORT-08). What guards these routes is the session cookie, and behind
 * that the three-identifier check that issued it. There is no header a caller
 * can send to widen what they see: every read starts from the account's own
 * links.
 *
 * THE PRACTICE SCOPE IS NEVER TAKEN FROM THE REQUEST. `x-practice-id` is
 * ignored on this controller. The only practice ids that mean anything are the
 * ones on the account's links, and `POST /portal/details/correction-request`
 * resolves the one it is given against that set before doing anything with it.
 */
@Controller('portal')
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly reads: PortalReadsService,
  ) {}

  /**
   * FR-1.14 — WHICH BOXES THE ACTIVATION PAGE SHOULD DRAW, and nothing else.
   *
   * The one read on this controller that works without a session, because it is
   * what the invitation link opens. It answers with the practice's identifier
   * TYPES, its name, when the link dies and how many tries are left — no name,
   * no initials, no masked value, no agreement id. See
   * `PortalService.activationChallenge` for why each of those is absent.
   *
   * THE TOKEN IS IN THE PATH, not a query string, matching the link the message
   * carries: a query string is the part of a URL that leaks into referrers,
   * server logs and analytics.
   */
  @Public()
  @Get('activate/:token/challenge')
  async activationChallenge(@Param('token') token: string, @Req() req: Request) {
    return this.portal.activationChallenge(token, clientKey(req));
  }

  /**
   * FR-1.14 — the invitation plus three approved identifiers.
   *
   * If the caller already holds a session, the new practice is added to THAT
   * account. Otherwise an account is created. Either way the response sets the
   * cookie, so a patient activating from a second practice does not silently
   * end up with two accounts and half a record in each.
   */
  @Public()
  @Post('activate')
  async activate(
    @Body() dto: ActivatePortalDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const existingSessionId = readPortalCookie(req);
    let existingAccountId: string | null = null;
    if (existingSessionId) {
      // A stale or revoked cookie is not an error on this path: the person is
      // activating, and refusing them because an old session expired would be
      // the platform getting in the way of its own offer.
      existingAccountId = await this.portal.accountForSession(existingSessionId).catch(() => null);
    }

    const { result, sessionId } = await this.portal.activate({
      agreementId: dto.agreementId,
      activationToken: dto.activationToken,
      stated: dto.stated,
      existingAccountId,
      clientKey: clientKey(req),
    });
    setPortalCookie(res, sessionId);
    return result;
  }

  @Public()
  @Get('session')
  async session(@Req() req: Request) {
    const accountId = await this.portal.accountForSession(readPortalCookie(req));
    return this.portal.session(accountId);
  }

  /** Signing out is a server-side revoke, not only a cleared cookie. */
  @Public()
  @Post('sign-out')
  async signOut(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sessionId = readPortalCookie(req);
    if (sessionId) await this.portal.revokeSession(sessionId);
    clearPortalCookie(res);
    return { signedOut: true as const };
  }

  @Public()
  @Get('details')
  async details(@Req() req: Request) {
    return this.reads.details(await this.portal.accountForSession(readPortalCookie(req)));
  }

  @Public()
  @Post('details/correction-request')
  async requestCorrection(@Req() req: Request, @Body() dto: CorrectionRequestDto) {
    const accountId = await this.portal.accountForSession(readPortalCookie(req));
    return this.reads.requestCorrection(accountId, dto);
  }

  @Public()
  @Get('agreements')
  async agreements(@Req() req: Request) {
    return this.reads.agreements(await this.portal.accountForSession(readPortalCookie(req)));
  }

  /**
   * REQ-PORT-02 — the copy, as signed.
   *
   * Re-rendered under the recorded renderer version and hash-checked before a
   * byte is written to the response (rule 13). Served as an attachment with
   * `nosniff`, the same way every other piece of evidence in this platform is
   * served — one definition of how a file leaves.
   */
  @Public()
  @Get('agreements/:id/artefact')
  async artefact(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const accountId = await this.portal.accountForSession(readPortalCookie(req));
    const artefact = await this.reads.artefact(accountId, id);
    res.setHeader('Content-Type', artefact.mediaType);
    res.setHeader('Content-Disposition', `attachment; filename="${artefact.filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The hash the patient can quote back. Their copy is checkable against the
    // record without them having to ask us what it should be.
    res.setHeader('X-Artefact-Sha256', artefact.sha256);
    res.send(artefact.bytes);
  }

  @Public()
  @Get('enduring')
  async enduring(@Req() req: Request) {
    return this.reads.enduringAgreements(await this.portal.accountForSession(readPortalCookie(req)));
  }

  /** REQ-PORT-05 / 65CA(7)(b) — one click, two business days (FR-5.3). */
  @Public()
  @Post('enduring/:id/terminate')
  async terminate(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const accountId = await this.portal.accountForSession(readPortalCookie(req));
    return this.reads.terminateEnduring(accountId, id);
  }

  @Public()
  @Get('notices')
  async notices(@Req() req: Request) {
    return this.reads.notices(await this.portal.accountForSession(readPortalCookie(req)));
  }

  @Public()
  @Get('visits')
  async visits(@Req() req: Request) {
    return this.reads.visits(await this.portal.accountForSession(readPortalCookie(req)));
  }

  @Public()
  @Get('messages')
  async messages(@Req() req: Request) {
    return this.reads.messages(await this.portal.accountForSession(readPortalCookie(req)));
  }

  @Public()
  @Get('assignors')
  async assignors(@Req() req: Request) {
    return this.reads.assignors(await this.portal.accountForSession(readPortalCookie(req)));
  }

  /** FR-1.23 — at any time, with no justification asked for and none accepted. */
  @Public()
  @Post('assignors/:id/revoke')
  async revokeAssignor(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const accountId = await this.portal.accountForSession(readPortalCookie(req));
    return this.reads.revokeAssignor(accountId, id);
  }

  @Public()
  @Get('access-log')
  async accessLog(@Req() req: Request) {
    return this.reads.accessLog(await this.portal.accountForSession(readPortalCookie(req)));
  }
}
