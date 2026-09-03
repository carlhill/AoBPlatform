import { BadRequestException, Controller, Get, Headers, Res } from '@nestjs/common';
import type { Response } from 'express';
import { KioskService } from './kiosk.service';

/**
 * Practice scope arrives on `x-practice-id`, exactly as it does on every other
 * practice surface — and the auth guard overwrites that header from the
 * token's practice claim whenever a verified principal is present. The kiosk
 * is a staff passkey session in a big-buttons layout (Part 6, decision 3), so
 * there is deliberately nothing device-shaped here: no device id, no device
 * credential, no new auth surface to revoke.
 */
function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

@Controller('kiosk')
export class KioskController {
  constructor(private readonly kiosk: KioskService) {}

  /**
   * Who is here, for this practice, right now.
   *
   * POLLED HARD AND CHEAPLY (§9.4). The response carries `pollMs` — the
   * cadence the server wants, fast while somebody is waiting and slow while
   * nobody is — and an `ETag`. A tablet echoing that tag in `If-None-Match`
   * gets `304` and no body while nothing has changed, which is most of the
   * requests on most mornings.
   *
   * `Cache-Control: no-store` because the one thing that must never happen is
   * an intermediary serving a stale waiting room, or holding a list of
   * patient names in a cache somewhere between here and the tablet.
   */
  @Get('waiting-list')
  async waitingList(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.kiosk.waitingList(requirePractice(practiceId));
    const etag = `"${result.revision}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-store');
    if (ifNoneMatch === etag) {
      res.status(304);
      return undefined;
    }
    return result;
  }
}
