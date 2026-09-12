import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { Request } from 'express';
import { PracticeScoped } from '../auth/practice-scope.decorator';
import { SessionActor, type Actor } from '../auth/actor.decorator';
import { ArrivalsService } from './arrivals.service';
import { ArrivalDto, ArrivalPreviewDto, ServiceRenderedDto } from './arrivals.dto';

/**
 * Reception naming the practitioner-at-a-location the claim will go under. One
 * field, on purpose — and it is the affiliation, because that is what an
 * agreement is anchored on (Carl, 7 Sep 2026).
 */
export class ChooseProviderDto {
  @IsUUID()
  affiliationId!: string;
}

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

/**
 * WHERE A PRACTICE'S SOFTWARE SAYS SOMEBODY WALKED IN (Carl, 4 Sep 2026;
 * TODO.md "Reception-centric" §2).
 *
 * PRACTICE-SCOPED, THE PRACTICE'S OWN ACT — the same guard the connector's
 * other door uses (`POST /inbound/print-jobs`). A platform operator has no
 * business asserting that a patient arrived at somebody else's front desk, and
 * `@PracticeScoped` says so; acting-as still passes, and leaves a record of on
 * whose behalf. The `x-practice-id` header is the dev-time stand-in for the
 * connector's mTLS identity, exactly as it is everywhere else, and RLS means a
 * wrong or absent id yields nothing rather than leaking.
 *
 * `@Req` ALONGSIDE `@Body`, AND IT IS NOT LAZINESS — the same reason
 * `PATCH /patients/:id/details` does it. `whitelist: true` silently strips an
 * unknown field, which is right for a typo and WRONG for a forbidden one: a
 * body carrying a Medicare card number, or one asserting the agreement type,
 * would vanish and its sender would learn nothing. The raw key list goes to the
 * service, which refuses both out loud (hard rules 1, 6 and 14).
 *
 * 201, NOT 202. Unlike a print job this is not queued: by the time it returns,
 * the mirror is updated, the decision is made and recorded, and the draft — if
 * the visit needs one — exists and is on reception's queue. The response says
 * what was decided and why, so the connector's author can see the platform
 * disagreeing with their assumption rather than guessing.
 */
@Controller('arrivals')
export class ArrivalsController {
  constructor(private readonly arrivals: ArrivalsService) {}

  @Post()
  @PracticeScoped()
  receive(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Body() dto: ArrivalDto,
    @Req() req: Request,
    /**
     * WHOSE HANDS TYPED IT — undefined for every machine push, and the
     * undefined is a fact rather than a gap (`Arrival.receivedByPrincipalId`).
     *
     * IT AUTHORISES NOTHING. `@PracticeScoped` and RLS already say who may
     * reach this at all; the actor says who to name in the evidence when a
     * person, rather than a connector, is the one speaking. That is why an
     * absent actor is not refused here the way `PATCH /patients/:id/details`
     * refuses one: a connector legitimately has none.
     */
    @SessionActor() actor: Actor | undefined,
  ) {
    const sent = req.body && typeof req.body === 'object' ? Object.keys(req.body as object) : [];
    return this.arrivals.receive(requirePractice(practiceId), dto, sent, actor);
  }

  /**
   * "WHAT WOULD THIS VISIT NEED?" — READ, NOT WRITE (Carl, 7 Sep 2026;
   * PMS_to_AoB_Workflow.md W2 item 5).
   *
   * A POST BECAUSE IT CARRIES A PATIENT'S RECORD NUMBER, and an identifier
   * belongs in a body rather than in a URL that lands in every access log and
   * every browser history (REQ-LOG-08). It is idempotent and writes nothing;
   * the verb is about where the identifier goes, not about what happens.
   *
   * BEFORE `:id/provider` AND `:id`, because `preview` is not a UUID and Nest
   * matches routes in declaration order — the mistake that shipped a shadowed
   * route on 7 September (wow.md §1). `:id` is a GET and could not shadow a
   * POST, but the order says what it means without the reader having to check.
   */
  @Post('preview')
  @PracticeScoped()
  preview(@Headers('x-practice-id') practiceId: string | undefined, @Body() dto: ArrivalPreviewDto) {
    return this.arrivals.preview(requirePractice(practiceId), dto);
  }

  /**
   * THE SERVICE HAS BEEN RENDERED — THE SECOND PUSH (Carl, 11 Sep 2026;
   * TODO.md "Two front doors" decision (b)).
   *
   * The patient has seen the practitioner, the service is known, and where no
   * pre-agreement covers the billed item a post-agreement is drafted, locked
   * and put on reception's desk for the same tablet. One mechanism, two
   * moments.
   *
   * BEFORE `:id/provider` AND `:id`, because `service-rendered` is not a UUID
   * and Nest matches routes in declaration order — the mistake that shipped a
   * shadowed route on 7 September (wow.md section 1).
   *
   * `@Req` ALONGSIDE `@Body`, for the same reason `receive` takes it:
   * `whitelist: true` silently strips an unknown field, which is right for a
   * typo and WRONG for a forbidden one. A body carrying a Medicare card number
   * or a dollar amount would vanish and its sender would learn nothing; the raw
   * key list goes to the service, which refuses both out loud (hard rules 1
   * and 4).
   *
   * 201, NOT 202, and for the same reason the arrival returns one: by the time
   * this returns the decision is made and recorded, and the post-agreement — if
   * the service needs one — exists, is validated and locked, and is on the
   * desk.
   */
  @Post('service-rendered')
  @PracticeScoped()
  serviceRendered(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Body() dto: ServiceRenderedDto,
    @Req() req: Request,
    /** Whose hands typed it — undefined for every machine push, and the undefined is a fact. */
    @SessionActor() actor: Actor | undefined,
  ) {
    const sent = req.body && typeof req.body === 'object' ? Object.keys(req.body as object) : [];
    return this.arrivals.serviceRendered(requirePractice(practiceId), dto, sent, actor);
  }

  /**
   * THE DESK'S "NEEDS A PROVIDER" LIST — arrivals refused for naming somebody
   * who cannot be the provider on an agreement (Carl, 5–7 Sep 2026).
   *
   * BEFORE `:id`, because `needing-a-provider` and `servicing-providers` are
   * not UUIDs and Nest matches routes in declaration order.
   */
  @Get('needing-a-provider')
  @PracticeScoped()
  needingAProvider(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.arrivals.needingAProvider(requirePractice(practiceId));
  }

  /**
   * BOOKED FOR TODAY, NOT HERE YET — the front desk rail's "Expected" group
   * (Carl, 12 Sep 2026; FRONT-DESK-PAGE.md §12.4).
   *
   * THE ONE NEW READ THE FRONT DESK PAGE IS ALLOWED, and the plan says why:
   * everything else that page shows is answered by `GET
   * /tablet-sessions/pushable`, which reads agreements, and a patient who has
   * not arrived has none. The data exists, nothing else exposes it, and the
   * alternative is the page inferring who is missing — which it must not do.
   *
   * BEFORE `:id`, because `expected` is not a UUID and Nest matches routes in
   * declaration order (wow.md section 1) — the same reason
   * `needing-a-provider` and `servicing-providers` sit above it.
   *
   * `@PracticeScoped` LIKE ITS NEIGHBOURS. Who is booked in at a practice
   * today is the practice's own business; RLS means another practice's request
   * finds nothing rather than being filtered down to nothing.
   */
  @Get('expected')
  @PracticeScoped()
  expectedToday(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.arrivals.expectedToday(requirePractice(practiceId));
  }

  /**
   * THE DAY REGISTER — everybody who came in on one day (Carl, 12 September
   * 2026, on `/practice/frontdesk`: *"Add a button here with a link to show all
   * Patients seen at this practice today. You could put a filter on this to
   * search for any day. Default to today."*).
   *
   * BEFORE `:id`, because `day` is not a UUID and Nest matches routes in
   * declaration order — the mistake that shipped a shadowed route on 7
   * September (wow.md §1) and the same reason `expected`, `needing-a-provider`
   * and `servicing-providers` all sit above it.
   *
   * `date` IN THE QUERY STRING IS SAFE AND AN IDENTIFIER WOULD NOT BE. A
   * calendar day is not personal data; it lands in an access log and tells
   * nobody anything about a patient. That is exactly why `preview` is a POST
   * (REQ-LOG-08) and this is a GET — the rule is about what is in the URL, not
   * about the verb.
   *
   * OMITTED MEANS TODAY, and today is the SERVER's answer by the practice's
   * clock rather than the browser's guess. A page that filled the parameter in
   * from its own machine would head the register with whatever day that machine
   * was having.
   *
   * `@PracticeScoped` LIKE ITS NEIGHBOURS. Who came into a practice is the
   * practice's own business, and RLS means another practice's request finds
   * nothing rather than being filtered down to nothing.
   */
  @Get('day')
  @PracticeScoped()
  day(@Headers('x-practice-id') practiceId: string | undefined, @Query('date') date?: string) {
    return this.arrivals.day(requirePractice(practiceId), date);
  }

  /** Who reception may choose instead. Servicing providers only, by the same rule that refused. */
  @Get('servicing-providers')
  @PracticeScoped()
  servicingProviders(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.arrivals.servicingProviders(requirePractice(practiceId));
  }

  /**
   * RECEPTION'S FIX. Names the provider the claim goes under and the platform
   * replays the PMS's own message under the same idempotency key, so the retry
   * supersedes the refusal instead of making a second walk-in.
   */
  @Post(':id/provider')
  @PracticeScoped()
  chooseProvider(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChooseProviderDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.arrivals.chooseProvider(requirePractice(practiceId), id, dto.affiliationId, actor);
  }

  /**
   * One arrival, read back. Ids, a decision and a version — no patient value of
   * any kind, because there is nothing here a screen needs them for and the
   * work page already reads the five details from the one mirror.
   */
  @Get(':id')
  get(@Headers('x-practice-id') practiceId: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.arrivals.get(requirePractice(practiceId), id);
  }
}
