import { Controller, Get, Headers, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { OUTBOUND_STATES } from '@aobplatform/domain';
import { OutboundService } from './outbound.service';
import { SessionActor, type Actor } from '../auth/actor.decorator';

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
  @Get()
  list(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Query('mediaType') mediaType?: string,
    @Query('state') state?: string,
    @Query('channel') channel?: string,
    @Query('search') search?: string,
    @Query('take') take?: string,
  ) {
    return this.outbound.list(practiceId, {
      mediaType,
      state,
      channel,
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
