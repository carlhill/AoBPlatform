import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { DEVICE_LABEL_MAX_LENGTH } from '@aobplatform/domain';
import { DevicesService } from './devices.service';
import { SessionActor, type Actor } from '../auth/actor.decorator';
import { PracticeScoped } from '../auth/practice-scope.decorator';
import { Public } from '../auth/public.decorator';

export class RegisterDeviceDto {
  /** "Reception tablet 1". A name somebody could find the thing by. */
  @IsString()
  @MinLength(1)
  @MaxLength(DEVICE_LABEL_MAX_LENGTH)
  label!: string;
}

export class PairDeviceDto {
  /**
   * The eight characters, however they were typed. Normalised server-side —
   * the tablet is not asked to know about hyphens or capitals. Bounded so a
   * megabyte of "code" cannot be posted at the hashing function.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code!: string;
}

export class RevokeDeviceDto {
  /**
   * Optional, and worth having. A tablet taken out of service and one lost in
   * a taxi are different stories, and only one of them is a security event.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class DeviceSettingsDto {
  /**
   * A TEST DEVICE — the only kind shown the waiting list (Carl, 4 Sep 2026).
   * Required rather than optional: this is a disclosure switch, and "the
   * caller forgot to send it" must never be indistinguishable from "the
   * caller asked for false".
   */
  @IsBoolean()
  showsWaitingList!: boolean;
}

export class MinimumKioskBuildDto {
  /** `null` clears the floor — an explicit "no tablet needs to reload". */
  @IsOptional()
  @ValidateIf((o: MinimumKioskBuildDto) => o.build !== null)
  @IsString()
  @MaxLength(40)
  build!: string | null;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

/**
 * A PRACTICE'S TABLETS — registered, paired, revoked and rotated from the
 * CONSOLE, never from the device (TODO.md "Zero-footprint kiosk").
 *
 * @PracticeScoped ON THE CONSOLE ACTS, for the same reason `practice-users` is:
 * handing out the credential that opens a practice's waiting list is the
 * practice's own act, and a platform operator reaches it only by acting as
 * them — which leaves a record of on whose behalf.
 *
 * ONE ENDPOINT IS PUBLIC AND ONLY ONE. `POST /devices/pair` is reached by a
 * tablet that has no credential yet; acquiring one is the entire point of the
 * call. It is rate-limited, single-use, ten-minute-lived, and refuses every
 * kind of failure with the same sentence.
 *
 * NOTHING HERE IS AN AUTH FLOW IN THE KEYCLOAK SENSE. Pairing is a device
 * credential, not a login: no realm, no passkey, no session, no password path
 * of any kind (hard rule 15 is untouched — there is no person to authenticate
 * at a tablet).
 */
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  /** The console's list. Carries no credential and no hash — there is nothing to show. */
  @Get()
  @PracticeScoped()
  list(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.devices.list(requirePractice(practiceId));
  }

  /**
   * Register a tablet and issue its first pairing code.
   *
   * THE CODE IS IN THE RESPONSE AND NOWHERE ELSE. It is not stored, not
   * emailed, not logged, and cannot be re-displayed — a code that could be
   * fetched again would be a password with a nice name. Losing it costs a
   * rotate.
   */
  @Post()
  @PracticeScoped()
  register(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Body() dto: RegisterDeviceDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.devices.register(requirePractice(practiceId), dto.label, actor);
  }

  /**
   * The tablet exchanges its code for a credential. Public, once.
   *
   * DECLARED BEFORE THE `:id` ROUTES. Nest matches in declaration order, and a
   * `POST /devices/:id/...` above this would be fine — but `minimum-build`
   * below is a two-segment POST like this one, and keeping the literal paths
   * together is what stops the next person adding `/devices/:id` and swallowing
   * both.
   *
   * `@Ip()` IS THE RATE-LIMIT KEY AND IS NOT AN IDENTIFIER. It is not stored,
   * not logged and not written to any event; it lives in a bounded in-memory
   * window for ten minutes (see `pairing-rate-limit.ts`).
   */
  @Post('pair')
  @Public()
  pair(@Body() dto: PairDeviceDto, @Ip() ip: string) {
    return this.devices.pair(dto.code, ip ?? 'unknown');
  }

  /**
   * The build floor for this practice's tablets. Every tablet below it
   * reloads on its next poll — the rollback mechanism the zero-footprint rule
   * depends on.
   */
  @Put('minimum-build')
  @PracticeScoped()
  setMinimumBuild(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Body() dto: MinimumKioskBuildDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.devices.setMinimumKioskBuild(requirePractice(practiceId), dto.build ?? null, actor);
  }

  /**
   * PER-DEVICE SETTINGS — today exactly one, and it is a disclosure switch.
   *
   * `showsWaitingList` puts other patients' names on that tablet's screen.
   * Every ordinary tablet has it off and finds its one patient from what that
   * patient types into "Confirm your details"; a device with it on is a TEST
   * device and says so in a permanent banner.
   *
   * IT IS HERE AND NOT ON THE TABLET, deliberately (Carl, 4 Sep 2026: "never
   * a tick-box on the tablet"). Same reasoning as revoke: a device that can
   * widen its own disclosure is a device a passer-by can widen.
   */
  @Patch(':id')
  @PracticeScoped()
  updateSettings(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeviceSettingsDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.devices.setShowsWaitingList(requirePractice(practiceId), id, dto.showsWaitingList, actor);
  }

  /** Take the credential back. The tablet learns on its next request. */
  @Post(':id/revoke')
  @PracticeScoped()
  revoke(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokeDeviceDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.devices.revoke(requirePractice(practiceId), id, dto.reason, actor);
  }

  /** The same tablet, a new credential. The old one stops working immediately. */
  @Post(':id/rotate')
  @PracticeScoped()
  rotate(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.devices.rotate(requirePractice(practiceId), id, actor);
  }
}
