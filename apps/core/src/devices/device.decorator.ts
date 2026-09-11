import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { ResolvedDevice } from './devices.service';

export const DEVICE_REQUIRED = 'aob:device-required';

/**
 * This endpoint answers only a PAIRED TABLET.
 *
 * The mirror of `@Public()`. `@Public()` says "no account is needed here";
 * this says "an account is not the thing that is needed here — a registered
 * device is". Both are on endpoints reached by somebody who cannot sign in,
 * and they are not the same somebody: a patient holding a capture link, and a
 * tablet bolted to a reception desk.
 */
export const RequiresDevice = () => SetMetadata(DEVICE_REQUIRED, true);

/**
 * The resolved device, or undefined where none was offered. Read from the
 * request rather than from a header, so a handler cannot be tricked into
 * trusting a string a client sent.
 */
export const CallingDevice = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ResolvedDevice | undefined =>
    context.switchToHttp().getRequest().device,
);

/** What the tablet says it is running, for the forced-reload answer. */
export const KioskBuild = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | null =>
    context.switchToHttp().getRequest().kioskBuild ?? null,
);
