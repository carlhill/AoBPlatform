import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import { PracticeScoped } from '../auth/practice-scope.decorator';
import { PLATFORM_ADMIN, RequireRoles } from '../auth/roles.decorator';
import { RequireFreshSecondFactor } from '../auth/fresh-second-factor.decorator';
import { SessionActor, type Actor } from '../auth/actor.decorator';
import { AobPrinterHostsService } from './aobprinter-hosts.service';

/**
 * A REASON CODE AND NOTHING ELSE. The shape is checked here and the code
 * against the versioned list in the service (`isAobPrinterRebaselineReason`),
 * so an unlisted code is a 400 either way. There is no free-text reason: a
 * vault event carries codes, never notes.
 */
export class RebaselineAobPrinterHostDto {
  @IsString() @Matches(/^[a-z0-9_]{1,40}$/) reasonCode!: string;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

/**
 * THE PRACTICE'S AOBPRINTER HOST (PRINTER-HEARTBEAT.md §3–§4, D-2026-10-10-02).
 *
 * A NEW BASE, NOT `inbound/print-jobs`: that controller has `GET :id`, and a
 * console read beneath it would be one more route to keep above the
 * parameter. `/aobprinter-hosts` sits in the `db4` surface beside it.
 */
@Controller('aobprinter-hosts')
export class AobPrinterHostsController {
  constructor(private readonly hosts: AobPrinterHostsService) {}

  /** What the practice's console page reads, and the platform twin with it. */
  @Get()
  @PracticeScoped()
  list(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.hosts.listForPractice(requirePractice(practiceId));
  }

  /**
   * RE-BASELINE A REGRESSED CHAIN — the platform operator's act alone
   * (decision 7). A practice may not verify its own evidence, so this is not
   * `@PracticeScoped` and carries no practice header: the host is named by
   * its id. PLATFORM_ADMIN and a fresh second factor, the same pair of guards
   * device revocation uses; no auth flow is changed.
   *
   * 200, not 201: nothing is created; the row is answered as it now stands.
   */
  @Post(':hostId/rebaseline')
  @HttpCode(200)
  @RequireRoles(PLATFORM_ADMIN)
  @RequireFreshSecondFactor()
  rebaseline(
    @Param('hostId', ParseUUIDPipe) hostId: string,
    @Body() dto: RebaselineAobPrinterHostDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.hosts.rebaseline(hostId, dto.reasonCode, actor);
  }
}

/**
 * EVERY PRACTICE'S HOST, WORST FIRST (decision 10). The platform's page; in
 * the `always` set by its `/platform` prefix.
 */
@Controller('platform/aobprinter-hosts')
export class PlatformAobPrinterHostsController {
  constructor(private readonly hosts: AobPrinterHostsService) {}

  @Get()
  @RequireRoles(PLATFORM_ADMIN)
  overview() {
    return this.hosts.overview();
  }
}
