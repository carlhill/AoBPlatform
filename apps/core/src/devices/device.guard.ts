import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DevicesService, type ResolvedDevice } from './devices.service';
import { DEVICE_REQUIRED } from './device.decorator';

export const DEVICE_CREDENTIAL_HEADER = 'x-device-credential';
export const KIOSK_BUILD_HEADER = 'x-kiosk-build';

declare module 'express' {
  interface Request {
    device?: ResolvedDevice;
    kioskBuild?: string | null;
  }
}

/**
 * THE KIOSK'S WHOLE AUTHENTICATION, and the reason `/kiosk` can be deployed at
 * all (CLAUDE.md §7; TODO.md "URGENT before any real device").
 *
 * A GLOBAL GUARD, not middleware and not a per-controller guard, for two
 * reasons that pull the same way:
 *
 *  1. The ceremony does not live under `/kiosk`. A tablet also calls
 *     `/verification/challenges`, `/agreements/:id/…` and `/capture/:id/…`,
 *     and every one of those needs the practice scope the device carries.
 *     Resolving the credential once, for every route, is the only shape in
 *     which "the tablet never asserts a practice" is actually true.
 *  2. It runs AFTER `AuthGuard` (AuthModule is registered first, and Nest runs
 *     global guards in registration order), so a verified token's practice
 *     claim is already on the request when this looks — and a token wins. A
 *     staff member using a paired tablet's browser is themselves, not the
 *     tablet.
 *
 * WHAT IT DOES, in order:
 *  - On a `/kiosk` route, DELETES any client-supplied `x-practice-id` before
 *    anything else. That header is no longer accepted there, and deleting it
 *    is what makes the sentence true rather than merely intended. Everywhere
 *    else it is left alone: the console still sends it, and so does every
 *    existing test.
 *  - Resolves `x-device-credential` when present. Unknown or revoked is 401 —
 *    never a silent fall-through to an unscoped request, which is how a
 *    revoked tablet would keep working.
 *  - Requires a device on any handler marked `@RequiresDevice()`.
 *
 * IT NEVER BLOCKS CARE (hard rule 8). The worst it does is stop a tablet
 * reading a list; reception carries on, the patient is seen, and capture falls
 * back to post-service or paper.
 */
@Injectable()
export class DeviceCredentialGuard implements CanActivate {
  constructor(
    private readonly devices: DevicesService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest();
    const path: string = request.path ?? request.url ?? '';
    const isKioskRoute = path === '/kiosk' || path.startsWith('/kiosk/');

    /*
     * THE ENV-VAR PRACTICE ID IS GONE, and this is where it goes. `/kiosk/*`
     * used to take its scope from whatever header the caller sent, which is
     * how a public URL ended up able to read any practice's waiting list.
     */
    if (isKioskRoute) delete request.headers['x-practice-id'];

    const raw = request.headers[DEVICE_CREDENTIAL_HEADER];
    const credential = Array.isArray(raw) ? raw[0] : raw;
    const buildRaw = request.headers[KIOSK_BUILD_HEADER];
    request.kioskBuild = (Array.isArray(buildRaw) ? buildRaw[0] : buildRaw) ?? null;

    if (typeof credential === 'string' && credential.length > 0) {
      const device = await this.devices.resolveCredential(credential);
      /*
       * A CREDENTIAL THAT WAS OFFERED AND DID NOT RESOLVE IS A 401, on every
       * route, not only the kiosk's. Falling through would leave a revoked
       * tablet making unscoped requests that RLS happens to answer with
       * nothing — working "safely" by accident, and silently, which is the
       * failure mode this whole feature exists to remove.
       */
      if (!device) throw new UnauthorizedException(UNPAIRED_MESSAGE);
      request.device = device;

      // A verified token's practice claim wins. A person signed in on a paired
      // tablet is that person, not the tablet.
      const claimed = request.principal?.practiceId as string | undefined;
      if (!claimed) request.headers['x-practice-id'] = device.practiceId;

      // Fire and forget: the heartbeat must never be able to fail a request
      // for a patient standing at a tablet (REQ-REC-04).
      void this.devices
        .touch(device.deviceId, device.practiceId, request.kioskBuild ?? null)
        .catch(() => undefined);
    }

    const needsDevice = this.reflector.getAllAndOverride<boolean>(DEVICE_REQUIRED, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (needsDevice && !request.device) throw new UnauthorizedException(UNPAIRED_MESSAGE);

    return true;
  }
}

/**
 * ONE SENTENCE FOR "this tablet is not paired", and the kiosk shows its own
 * copy regardless. It names no practice and no device: an unpaired tablet is
 * being told to see reception, not being told what it nearly had.
 */
export const UNPAIRED_MESSAGE =
  'This tablet is not paired to a practice. Pair it from the practice console before it can be used.';
