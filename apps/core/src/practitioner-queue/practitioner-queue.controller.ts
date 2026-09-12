import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsIn, IsString } from 'class-validator';
import { VISIT_STATE_KEYS } from '@aobplatform/domain';
import { SessionActor, type Actor } from '../auth/actor.decorator';
import { PractitionerQueueService } from './practitioner-queue.service';

/**
 * THE WHOLE BODY OF THE ONE WRITE THIS PAGE HAS — a state key, and nothing else
 * (PRACTITIONER-QUEUE-PAGE.md §3a rule 1).
 *
 * THERE IS NO NOTE FIELD AND THERE NEVER WILL BE. *"It is attendance, not
 * clinical documentation ... No free text anywhere. A note box here becomes a
 * clinical record within a week."* `whitelist: true` on the global validation
 * pipe strips anything else a caller sends, so a field added by a future
 * client is discarded rather than stored.
 *
 * WHO SET IT IS NOT IN THE BODY EITHER. It comes off the token
 * (`@SessionActor`), never a typed name — an id in a token is a claim somebody
 * signed; a name in a body is an assertion.
 *
 * THE ALLOWED VALUES ARE THE VERSIONED CONTENT'S, not a literal union
 * (hard rule 14). `pending` is in `VISIT_STATE_KEYS` and is refused a layer
 * deeper by `mayBeSetByHand`, with a message that says why — a 400 listing the
 * settable keys is more use than a validation error that merely says "invalid".
 */
export class SetVisitStateDto {
  @IsString()
  @IsIn(VISIT_STATE_KEYS as unknown as string[])
  state!: string;
}

/**
 * WHO IS WAITING FOR ME TODAY (PRACTITIONER-QUEUE-PAGE.md §3; Carl,
 * 12 September 2026).
 *
 * ONE GET AND ONE NARROW POST. §3 says *"no buttons that act on an agreement: a
 * practitioner does not send tablets or correct addresses, and a control they
 * will never legitimately use is a control that will one day be pressed by
 * mistake."* That rule stands and nothing here breaks it: the POST records
 * ATTENDANCE — where a visit had got to, as somebody said it at the time (§3a)
 * — and touches no agreement, no tablet, no patient detail and nobody's
 * appointment. §3a supersedes §3 for exactly this one write and no other, and
 * VISIT-CHECKLIST.md §5 says why: *"marking your own attendance is not acting
 * on an agreement, so the rule narrows rather than falls."*
 *
 * NO PRACTITIONER IN THE PATH, EVER. The same rule `/practitioner/me` states:
 * the id comes off the token, so there is no parameter to tamper with and no
 * ownership check to forget. §4.2 requires that a practitioner never sees
 * another practitioner's list; the strongest way to guarantee it is to give
 * the endpoint nothing to be wrong about.
 *
 * NOT `@PracticeScoped()`, AND THE REASON IS NOT LAXITY. That decorator
 * requires a practice CLAIM on the token, and a practitioner's token
 * deliberately carries none — they work at several practices and which ones
 * changes (`PractitionerAccessService`). Refusing them here would close the
 * page to the audience it was written for. The scope is resolved and CHECKED
 * in the service instead: a practitioner's practice must be one they hold a
 * live affiliation with, verified before the RLS scope is opened, and everyone
 * else still reaches this only with a practice claim. Cross-practice fails
 * closed twice over — once at that check and once at RLS.
 *
 * `practitioner-queue`, NOT `doctor-...`. "Doctor" stays out of the URL: the
 * domain word is provider and practitioner (CLAUDE.md §3, REQ-MP-01), and a
 * route is the one place a banned word survives every later rename (§1).
 */
@Controller('practitioner-queue')
export class PractitionerQueueController {
  constructor(private readonly queue: PractitionerQueueService) {}

  /**
   * TODAY'S LIST, FOR WHOEVER IS ASKING.
   *
   * THE HEADER IS "WHICH PRACTICE", NEVER "WHOSE LIST". A practice user's is
   * their claim, re-stamped by the server; a practitioner's is checked against
   * their own affiliations before it is trusted for anything. Whose list it is
   * comes from the token alone and cannot be asked for.
   */
  @Get('waiting')
  waiting(@Headers('x-practice-id') practiceId: string | undefined, @SessionActor() actor: Actor | undefined) {
    return this.queue.waiting(actor, practiceId);
  }

  /**
   * WHERE THIS VISIT HAS GOT TO (§3a; Carl, 12 September 2026).
   *
   * THE ONE POST, AND IT NARROWS §3 RATHER THAN OVERTURNING IT. *"No buttons
   * that act on an agreement"* still holds — this acts on no agreement, sends
   * no tablet, corrects no detail and moves no patient. VISIT-CHECKLIST.md §5
   * is explicit that *"marking your own attendance is not acting on an
   * agreement, so the rule narrows rather than falls: the only control a
   * practitioner ever gets is 'I have seen this patient'"*.
   *
   * THE ARRIVAL IS IN THE PATH AND THE PRACTITIONER IS NOT. Whose visit this
   * may be marked by comes off the token, exactly as the GET's scope does, so
   * there is no parameter in which to ask for somebody else's authority. The
   * arrival id is safe in the path because an id from another practice is
   * invisible to the query — RLS returns nothing and the caller is told there
   * is no such visit.
   *
   * NOT `@PracticeScoped()`, FOR THE REASON THE GET GIVES AT LENGTH. That
   * decorator requires a practice CLAIM, and a practitioner's token
   * deliberately carries none — they work at several practices and which ones
   * changes. Refusing them here would close the control to the audience §3a
   * wrote it for. The scope is resolved and CHECKED in the service instead,
   * from the same `resolveScope` the read uses, so what a practitioner can SEE
   * and what they can SET are one answer and cannot drift apart.
   *
   * A UUID PIPE ON THE PATH so a malformed id is a 400 at the door rather than
   * a database error carrying a fragment of somebody's input into a log.
   */
  @Post('visits/:arrivalId/state')
  setState(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('arrivalId', ParseUUIDPipe) arrivalId: string,
    @Body() dto: SetVisitStateDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.queue.setState(actor, practiceId, arrivalId, dto.state);
  }
}
