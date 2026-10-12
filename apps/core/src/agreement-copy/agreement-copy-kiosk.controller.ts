import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { CallingDevice, RequiresDevice } from '../devices/device.decorator';
import type { ResolvedDevice } from '../devices/devices.service';
import { AgreementCopyService } from './agreement-copy.service';

export class RequestCopyDto {
  /**
   * A KEY FROM THE CONTENT FILE, and the only thing a tablet may send.
   *
   * There is no `destination`, no `email`, no `mobile` and there must never be
   * one: the address is resolved server-side from the record the signer's
   * contact lives on (D-2026-09-11-03). A DTO with no field for an address is
   * that rule enforced by the type system rather than by a validator somebody
   * can relax.
   */
  @IsString()
  @MaxLength(64)
  optionKey!: string;
}

/**
 * THE TABLET'S SIDE OF "SEND ME A COPY" — two routes under `/kiosk`, answering
 * only a paired device (W6, REQ-PORT-02).
 *
 * `@RequiresDevice()` ON THE CLASS, exactly as the other two `/kiosk`
 * controllers have it. The guard deletes any client-supplied `x-practice-id`
 * before anything reads it and sets the scope from the credential it resolved,
 * so the practice is the SERVER'S answer rather than the caller's assertion.
 *
 * A PAIRED TABLET MAY ASK FOR A COPY OF ANY SIGNED AGREEMENT AT ITS OWN
 * PRACTICE, and that is deliberate rather than overlooked. The capability it
 * grants is "send this practice's own document to the address this practice
 * already holds for the person who signed it" — there is no parameter that
 * redirects it anywhere else, so a stolen tablet can post a patient their own
 * agreement and nothing more. Narrowing it to the session the device is
 * holding would also break the walk-up ceremony, which has no session.
 *
 * NOTHING HERE IS ON THE CEREMONY'S CRITICAL PATH (hard rule 8). Both routes
 * are called AFTER the signature, from the thank-you screen; either failing
 * leaves the agreement signed, the visit unaffected and the screen complete.
 *
 * ROUTE SHAPE: `/kiosk/agreements/:id/...` shadows nothing —
 * `KioskController` has no `:param` route at its top level and
 * `KioskSessionController` lives under `/kiosk/session`.
 */
@Controller('kiosk')
@RequiresDevice()
export class AgreementCopyKioskController {
  constructor(private readonly copies: AgreementCopyService) {}

  /**
   * WHICH CHANNELS MAY BE OFFERED, and the MASKED address each one reaches.
   *
   * `no-store`. The response carries a masked contact, which is less than the
   * session route's date of birth and address but is still the patient's, and
   * an intermediary holding it is the thing the zero-footprint rule exists to
   * prevent.
   */
  @Get('agreements/:id/copy-offer')
  async offer(
    @CallingDevice() device: ResolvedDevice | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.copies.offerFor(device!.practiceId, id);
  }

  /**
   * The person who signed asked for their copy.
   *
   * THE ACTOR IS THE DEVICE, NOT A PERSON. A tablet has nobody to authenticate
   * as (pairing is not a login), and recording a staff id here would be the
   * platform asserting who was holding it. `device` is the honest principal
   * type, and the device id is the one the console can revoke.
   */
  @Post('agreements/:id/copy')
  request(
    @CallingDevice() device: ResolvedDevice | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestCopyDto,
  ) {
    return this.copies.requestCopy(device!.practiceId, id, dto.optionKey, {
      principalType: 'device',
      id: device!.deviceId,
    });
  }
}
