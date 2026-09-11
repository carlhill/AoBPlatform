import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsString } from 'class-validator';
import { OUTBOUND_STATES } from '@aobplatform/domain';
import { OutboundService } from './outbound.service';
import { SessionActor, type Actor } from '../auth/actor.decorator';
import { PLATFORM_ADMIN, RequireRoles } from '../auth/roles.decorator';

/**
 * Reading the queue.
 *
 * WHO SEES WHAT, and this is the whole design:
 *
 *   - A PRACTICE USER sees their own practice's items, and nothing else. Their
 *     token carries the practice claim and RLS does the rest — there is no
 *     code path here that could widen it.
 *   - A PLATFORM OPERATOR may look at any one practice, by naming it. They do
 *     NOT get an all-practices firehose: these payloads contain patient names
 *     and consent details, and "show me everything" is not a question anybody
 *     operating this system actually needs answered.
 *
 * ⚠ WHAT THIS IS NOT FOR. Practitioners and patients asking "what was sent to
 * me" must be answered from `Notice`, which is retained for the statutory
 * period — not from here, which is transport and is pruned after thirty days.
 * A patient looking at this screen would watch their own records vanish. See
 * TODO.md; that is a different screen over different data.
 */
export class ResendDto {
  /**
   * The KEY, from `resend_reasons`. Required, and checked against the table
   * rather than against a list here — the table is the one that can grow.
   */
  @IsString()
  reason!: string;

  /**
   * The WORDS. Required too, and at least three of them: a resend is a second
   * assertion that notice was given, and the next person needs to know what
   * happened rather than merely that it did.
   *
   * "Optional, but it is what the next person reads" was the old comment, which
   * is two incompatible claims.
   */
  @IsString()
  note!: string;
}

@Controller('outbound')
export class OutboundController {
  constructor(private readonly outbound: OutboundService) {}

  /**
   * The queue, filtered.
   *
   * The practice comes from the header, which the auth guard overwrites from
   * the token's practice claim whenever there is one. So a practice user
   * cannot ask for somebody else's queue by editing a request — the value they
   * send is replaced before it reaches here.
   */
  /**
   * The summary reports: five grains and two comparison matrices.
   *
   * NO `scope` PARAMETER, deliberately. Whose figures these are is read off the
   * caller's own token, so there is nothing here to edit. A practice narrowing
   * to another practice's id is ignored rather than refused, because the
   * refusal would itself confirm the id exists.
   */
  @Get('report')
  report(
    @SessionActor() actor: Actor | undefined,
    @Query('grain') grain?: string,
    @Query('groupBy') groupBy?: string,
    @Query('practiceId') practiceId?: string,
    @Query('locationId') locationId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('from') from?: string,
  ) {
    return this.outbound.timeseries(
      { roles: actor?.roles, practiceId: actor?.practiceId },
      { grain, groupBy, practiceId, locationId, departmentId, from },
    );
  }

  @Get()
  list(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Query('mediaType') mediaType?: string,
    @Query('state') state?: string,
    @Query('channel') channel?: string,
    @Query('locationId') locationId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('recipientType') recipientType?: string,
    @Query('recipientId') recipientId?: string,
    @Query('search') search?: string,
    @Query('take') take?: string,
  ) {
    return this.outbound.list(practiceId, {
      mediaType,
      state,
      channel,
      locationId,
      departmentId,
      recipientType,
      recipientId,
      search,
      take: take ? Math.min(Number(take) || 50, 200) : 50,
    });
  }

  /** One item, with its payload, for the viewer. */
  @Get('item/:id')
  item(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.outbound.item(practiceId, id, actor);
  }

  /**
   * Send it again. PRACTICE OR PLATFORM — Carl was explicit that either
   * may, and it is a repair rather than a privilege: the practice is
   * usually the one being told the message never arrived.
   */
  /** The reasons, so the screen offers exactly what the server accepts. */
  @Get('resend-reasons')
  resendReasons() {
    return this.outbound.resendReasons();
  }

  @Post('item/:id/resend')
  resend(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResendDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.outbound.resend(practiceId, id, { reason: dto.reason, note: dto.note }, actor);
  }

  /**
   * Every practice, for the organisation filter.
   *
   * PLATFORM OPERATORS ONLY. A practice user has exactly one practice and
   * their token says which, so offering them a chooser would be offering
   * a list of other people’s practices — the disclosure this screen was
   * careful about in the first place.
   *
   * Names and ids only. Nothing about what is queued for them.
   */
  @RequireRoles(PLATFORM_ADMIN)
  @Get('practices')
  practices() {
    return this.outbound.practicesForChooser();
  }

  /** Sites and people this practice has actually sent to. */
  @Get('filters')
  filters(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.outbound.filterOptions(practiceId);
  }

  /**
   * Totals for every practice. PLATFORM ONLY.
   *
   * Safe to be platform-wide because it is COUNTS. A practice sending 412
   * emails yesterday tells an operator the platform is working; it says
   * nothing about any patient or consent record.
   */
  @RequireRoles(PLATFORM_ADMIN)
  @Get('summary/by-org')
  totalsByOrg() {
    return this.outbound.totalsByOrg();
  }

  /** Totals within one practice, by site and department. */
  @Get('summary/by-site')
  totalsBySite(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.outbound.totalsBySite(practiceId);
  }

  /** Counts by state and channel, plus what is oldest. */
  @Get('health')
  health(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.outbound.health(practiceId ?? '');
  }

  /** The filter vocabulary, so the screen and the server cannot drift. */
  @Get('catalogue')
  catalogue() {
    return {
      states: OUTBOUND_STATES,
      mediaTypes: ['email', 'json', 'xml', 'pdf', 'markdown'],
      channels: ['email', 'sms', 'webhook', 'device'],
    };
  }
}
