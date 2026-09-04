import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { PortalService } from './portal.service';
import { PortalPasskeyService } from './portal-passkey.service';
import { PortalPasskeyAuthenticationVerifyDto, PortalPasskeyRegistrationVerifyDto } from './portal-passkey.dto';
import { readPortalCookie, setPortalCookie } from './portal-cookie';

/**
 * FR-8.2 — PASSKEYS. Six routes, and they fall into two halves that must not be
 * confused with each other.
 *
 * REGISTRATION AND THE LIST NEED A LIVE SESSION. `@Public()` on this controller
 * means the same thing it means on `PortalController` — reachable without a
 * Keycloak account, because a patient has none and must never need one
 * (REQ-PORT-08). It does not mean unauthenticated: the four session-bound
 * routes below resolve the cookie first and 401 without it, so a credential can
 * only ever be enrolled by somebody the three-identifier bootstrap already let
 * in. That is the whole reason a passkey on this platform means anything
 * (`passkey_registration_requires_a_bootstrapped_session`).
 *
 * THE TWO SIGN-IN ROUTES ARE GENUINELY UNAUTHENTICATED, and are the only such
 * write endpoints in the portal. They are also the only ones that are
 * rate-limited, keyed by address, because a discoverable sign-in has named
 * nobody yet — there is no account, no patient and no device to count against.
 *
 * NOTHING HERE READS A PRACTICE ID, AN ACCOUNT ID OR A PATIENT ID FROM THE
 * REQUEST. `x-practice-id` is ignored on this controller as it is on
 * `PortalController`. The only things that decide who the caller is are the
 * httpOnly session cookie and a signature over a challenge the server minted.
 */
@Controller('portal/passkeys')
export class PortalPasskeyController {
  constructor(
    private readonly portal: PortalService,
    private readonly passkeys: PortalPasskeyService,
  ) {}

  /**
   * The list, for the "Sign-in and security" card.
   *
   * Revoked credentials are absent: the patient asked for them to be gone and a
   * list that still showed them would read as "we did not do it". The rows
   * survive, because the history is evidence — the list is not the history.
   */
  @Public()
  @Get()
  async list(@Req() req: Request) {
    const accountId = await this.portal.accountForSession(readPortalCookie(req));
    return this.passkeys.list(accountId);
  }

  /** Step one of enrolment. A live session, or a 401. */
  @Public()
  @Post('registration/options')
  async registrationOptions(@Req() req: Request) {
    const sessionId = this.requireSessionId(req);
    const accountId = await this.portal.accountForSession(sessionId);
    return this.passkeys.registrationOptions(accountId, sessionId);
  }

  /**
   * Step two. The challenge is bound to the account AND the session that minted
   * it, so a registration begun before a sign-out cannot be finished after one.
   */
  @Public()
  @Post('registration/verify')
  async verifyRegistration(@Req() req: Request, @Body() dto: PortalPasskeyRegistrationVerifyDto) {
    const sessionId = this.requireSessionId(req);
    const accountId = await this.portal.accountForSession(sessionId);
    return this.passkeys.verifyRegistration({
      accountId,
      sessionId,
      challengeId: dto.challengeId,
      response: dto.response,
      label: dto.label,
    });
  }

  /**
   * Step one of sign-in. NO SESSION, NO USERNAME, NO CREDENTIAL LIST — the
   * response carries a challenge and an RP ID and nothing that could answer
   * "does this person have an account here".
   */
  @Public()
  @Post('authentication/options')
  async authenticationOptions(@Req() req: Request) {
    return this.passkeys.authenticationOptions(clientKey(req));
  }

  /**
   * Step two. On success the cookie is set exactly as activation sets it — one
   * definition of what a portal session is, arrived at through a second door.
   */
  @Public()
  @Post('authentication/verify')
  async verifyAuthentication(
    @Req() req: Request,
    @Body() dto: PortalPasskeyAuthenticationVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { result, sessionId } = await this.passkeys.signIn({
      clientKey: clientKey(req),
      challengeId: dto.challengeId,
      response: dto.response,
    });
    setPortalCookie(res, sessionId);
    return result;
  }

  /**
   * Taking one away. REVOKING THE LAST ONE IS ALLOWED (REQ-PORT-08): the portal
   * is never a precondition, and a patient wiping a phone they are selling
   * should not have to keep a credential in order to be permitted to remove the
   * others. Re-entry is a fresh invitation and the bootstrap again.
   */
  @Public()
  @Post(':id/revoke')
  async revoke(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const accountId = await this.portal.accountForSession(readPortalCookie(req));
    return this.passkeys.revoke(accountId, id);
  }

  /**
   * The cookie, or a 401 — and the SESSION ID rather than only the account, because
   * a registration challenge is bound to the session that minted it.
   */
  private requireSessionId(req: Request): string {
    const sessionId = readPortalCookie(req);
    if (!sessionId) throw new UnauthorizedException('Sign in to see your records.');
    return sessionId;
  }
}

/**
 * WHAT THE RATE LIMITER COUNTS AGAINST.
 *
 * `req.ip` WITH A FALLBACK, AND NO `X-Forwarded-For` PARSING OF OUR OWN. Express
 * derives `req.ip` from that header only when `trust proxy` is configured, which
 * is a deployment decision made once in `main.ts` rather than a header this
 * controller decides to believe. Reading the header directly here would mean any
 * caller could set their own rate-limit key, which is the same as having no
 * limiter.
 *
 * IT IS NOT AN IDENTIFIER AND IS NEVER STORED. The address exists as a key in an
 * in-memory map for ten minutes and appears in no event, no log line and no row
 * (REQ-LOG-08).
 */
function clientKey(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
