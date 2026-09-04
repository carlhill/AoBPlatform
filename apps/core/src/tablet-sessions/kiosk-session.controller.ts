import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TabletSessionsService } from './tablet-sessions.service';
import { ConfirmDetailsDto, SetSessionStateDto } from './tablet-sessions.dto';
import { CallingDevice, RequiresDevice } from '../devices/device.decorator';
import type { ResolvedDevice } from '../devices/devices.service';

/**
 * THE TABLET'S SIDE OF THE PUSH — three routes under `/kiosk`, answering only
 * a paired device (TODO.md "Push-to-device capture", Carl 4 Sep 2026).
 *
 * `@RequiresDevice()` ON THE CLASS, exactly as `KioskController` has it. The
 * guard DELETES any client-supplied `x-practice-id` on `/kiosk/*` before
 * anything reads it and sets the scope from the credential it resolved, so the
 * practice on the request is the SERVER'S answer to "which practice is this
 * tablet" rather than the caller's assertion. A revoked or unknown credential
 * is 401 and no body.
 *
 * A SECOND CONTROLLER ON THE SAME PREFIX, deliberately. `KioskController`
 * answers the WALK-UP kiosk's questions — who is waiting, who am I — and stays
 * exactly as built (Carl, 4 Sep 2026: "the walk-up kiosk stays"). These are
 * the PUSH's questions. Folding them together would put two use cases in one
 * file and make the walk-up flow harder to leave alone.
 *
 * A PUSHED SESSION TAKES PRECEDENCE ON THE DEVICE, and the tablet decides
 * that: it polls this first and falls back to the waiting list when the answer
 * is `{ session: null }`. The server does not need to know which screen is
 * showing, and a server that did would be a server the tablet could lie to.
 *
 * PAIRING IS NOT A LOGIN. There is no Keycloak session here and there could not
 * be — a tablet has no person to authenticate as, and hard rule 15 concerns
 * practitioner and admin auth, which is untouched.
 */
@Controller('kiosk')
@RequiresDevice()
export class KioskSessionController {
  constructor(private readonly sessions: TabletSessionsService) {}

  /**
   * THE ONE SESSION THIS TABLET IS SHOWING, or `{ session: null }`.
   *
   * `Cache-Control: no-store`, because the one thing that must never happen is
   * an intermediary holding a patient's date of birth and address in a cache
   * somewhere between here and the tablet. The same reasoning the waiting list
   * gives, and it matters more here: that response carries names, this one
   * carries particulars.
   *
   * NO ETAG. The waiting list has one because a quiet morning is thousands of
   * identical polls; this answers for ONE device about ONE session and is
   * mostly `null`, so the tag would cost more than it saved — and a 304 on a
   * response this sensitive would be a cached copy on the device, which the
   * zero-footprint rule does not want.
   */
  @Get('session')
  async current(@CallingDevice() device: ResolvedDevice | undefined, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.sessions.currentFor(device!);
  }

  /**
   * THE PATIENT'S ANSWER TO EVERY DETAIL ON THE SCREEN — a tick, or a cross
   * (Carl, 4 Sep 2026).
   *
   * TYPES ONLY, AND IT IS NOT A VERIFICATION. The route is named
   * `confirm-details` and not `verify` for the reason TODO.md gives: a value
   * displayed on a screen and confirmed by whoever is holding it proves
   * nothing about who is holding it. The verification was the staff check
   * across the desk, which the push already recorded with the staff member's
   * identity (REQ-VER-03/-04).
   *
   * A CROSS POSTS IMMEDIATELY AND ASKS THE PATIENT FOR NOTHING FURTHER. The
   * point of the cross is that reception learns about it without the patient
   * having to explain it across a waiting room, so the tablet sends the answer
   * the moment every row has one and Continue goes dead. Nothing about the
   * agreement moves either way — a dispute stops a ceremony, not a visit
   * (hard rule 8, REQ-REC-04).
   */
  @Post('session/:id/confirm-details')
  confirmDetails(
    @CallingDevice() device: ResolvedDevice | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmDetailsDto,
  ) {
    return this.sessions.confirmDetails(device!, id, dto.confirmed, dto.disputed ?? []);
  }

  /**
   * The tablet says what it is showing — `reading`, that the person pressed
   * "See reception" and left, or that its own inactivity clock ended the
   * session with nobody there.
   *
   * `walked_away` IS THE EXIT BUTTON that every ceremony screen has, and
   * `timed_out` is the client-side clock firing on a pushed session (Carl,
   * 4 Sep 2026) — same effect on the record, different stored state, so
   * reception can tell the two apart. BOTH change NOTHING on the agreement
   * (hard rule 8, REQ-REC-04). The patient is still seen; reception chooses a
   * private bill or an episodic agreement after the service. Named tests:
   * `walked_away_changes_nothing_on_the_agreement`,
   * `timed_out_ends_the_session_and_changes_nothing_on_the_agreement`.
   */
  @Post('session/:id/state')
  setState(
    @CallingDevice() device: ResolvedDevice | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetSessionStateDto,
  ) {
    return this.sessions.setState(device!, id, dto.state as 'reading' | 'walked_away' | 'timed_out');
  }
}
