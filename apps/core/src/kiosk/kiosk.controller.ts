import { Body, Controller, Get, Headers, Post, Res } from '@nestjs/common';
import { IsObject } from 'class-validator';
import type { Response } from 'express';
import { KioskService } from './kiosk.service';
import { CallingDevice, KioskBuild, RequiresDevice } from '../devices/device.decorator';
import type { ResolvedDevice } from '../devices/devices.service';

export class KioskClaimDto {
  /**
   * The details the patient typed, keyed by identifier TYPE — the same
   * `stated` shape `POST /verification/challenges/:id/attempt` has always
   * taken, so one comparator serves both doors. Name arrives composed
   * ("given family"); `nameMatches` handles either order.
   *
   * VALUES ARE COMPARED AND DISCARDED. Nothing below this DTO stores, logs or
   * echoes one (REQ-VER-04), and there is no Medicare card number among the
   * types this practice may ask for (REQ-VER-02, hard rule 1).
   */
  @IsObject()
  stated!: Record<string, string>;
}

/**
 * THE TABLET'S OWN ENDPOINTS, and the practice scope now comes from the DEVICE.
 *
 * WHAT CHANGED, AND WHY IT HAD TO. This controller used to read
 * `x-practice-id` like every other practice surface, and `/kiosk` is a PUBLIC
 * route — so anybody who reached the URL with a practice id in a header saw
 * that practice's waiting room, which is a list of patient names. The route
 * could not be deployed anywhere reachable (TODO.md, "URGENT before any real
 * device").
 *
 * `@RequiresDevice()` ON THE CLASS is what closes it. Every handler below
 * answers only a request carrying a valid `x-device-credential`; the guard
 * DELETES any client-supplied `x-practice-id` on these routes before anything
 * reads it, and sets the header from the device it resolved. So the scope on
 * the request is the server's own answer to "which practice is this tablet",
 * and RLS re-checks it exactly as before. A revoked or unknown credential is
 * 401 and no body.
 *
 * PAIRING IS NOT A LOGIN. There is no Keycloak session here and there could
 * not be — a tablet has no person to authenticate as (hard rule 15 concerns
 * practitioner and admin auth, and is untouched).
 */
@Controller('kiosk')
@RequiresDevice()
export class KioskController {
  constructor(private readonly kiosk: KioskService) {}

  /**
   * WHO THIS TABLET IS, from the tablet's point of view: the practice name and
   * state for the header, the label a person gave it, and whether it is
   * running a build the practice has since rolled back past.
   *
   * IT REPLACES `GET /practices/:id` ON THE KIOSK. The tablet used to fetch a
   * practice by an id it held in a build-time environment variable; it now
   * asks the server who it is and is told. Nothing about the practice's
   * configuration comes back — a device with no settings is a device that
   * cannot be configured to ask for a card number (REQ-VER-02).
   */
  @Get('me')
  me(@CallingDevice() device: ResolvedDevice | undefined, @KioskBuild() kioskBuild: string | null) {
    return this.kiosk.me(device!, kioskBuild);
  }

  /**
   * Who is here, for this practice, right now.
   *
   * POLLED HARD AND CHEAPLY (§9.4). The response carries `pollMs` — the
   * cadence the server wants, fast while somebody is waiting and slow while
   * nobody is — and an `ETag`. A tablet echoing that tag in `If-None-Match`
   * gets `304` and no body while nothing has changed, which is most of the
   * requests on most mornings.
   *
   * THE RELOAD FLAG IS PART OF THE FINGERPRINT, and that is not a detail. If
   * `reload` were outside the ETag, a practice rolling its build back on a
   * quiet morning would change nothing about the waiting list, every poll
   * would answer 304, and the rollback would never reach the one tab it was
   * issued for — the exact failure the forced reload exists to prevent.
   *
   * `Cache-Control: no-store` because the one thing that must never happen is
   * an intermediary serving a stale waiting room, or holding a list of
   * patient names in a cache somewhere between here and the tablet.
   */
  /**
   * WHO IS HERE — and only for a TEST device (Carl, 4 Sep 2026).
   *
   * An ordinary tablet is answered `{ waiting: [], hidden: true }` with no
   * count, because the count was itself the disclosure. The walk-up patient
   * never sees this list: they type three details and `POST /kiosk/claim`
   * finds their row. The list survives for testing, behind a flag the CONSOLE
   * sets — never a tick-box on the tablet.
   */
  @Get('waiting-list')
  async waitingList(
    @CallingDevice() device: ResolvedDevice | undefined,
    @KioskBuild() kioskBuild: string | null,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.kiosk.waitingList(device!, kioskBuild);
    const etag = `"${result.revision}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-store');
    if (ifNoneMatch === etag) {
      res.status(304);
      return undefined;
    }
    return result;
  }

  /**
   * THE WALK-UP FRONT DOOR — "Confirm your details", and the server finds you.
   *
   * The patient types their name, date of birth and address; the server
   * evaluates every waiting row of THIS practice against all three and, if
   * exactly one matches, verifies them in the same step and returns that row.
   * Nothing about anybody else comes back, ever — not a name, not a count, and
   * not a hint about why a refusal was a refusal.
   *
   * NO PRACTICE COMES FROM THE CALLER. The guard has already deleted any
   * `x-practice-id` and resolved the practice from the device credential, so
   * the search space is this tablet's own waiting room and cannot be widened
   * by anything in the request.
   *
   * `Cache-Control: no-store` for the same reason the list has it: the success
   * body carries a patient's name, and no intermediary has any business
   * holding it.
   */
  @Post('claim')
  async claim(
    @CallingDevice() device: ResolvedDevice | undefined,
    @Body() dto: KioskClaimDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.kiosk.claim(device!, dto.stated ?? {});
  }
}
