import { Controller, Get, Headers } from '@nestjs/common';
import { SessionActor, type Actor } from '../auth/actor.decorator';
import { PractitionerQueueService } from './practitioner-queue.service';

/**
 * WHO IS WAITING FOR ME TODAY (PRACTITIONER-QUEUE-PAGE.md §3; Carl,
 * 12 September 2026).
 *
 * ONE GET AND NOTHING ELSE, AND THAT IS THE DESIGN. §3: *"No buttons that act
 * on an agreement: a practitioner does not send tablets or correct addresses,
 * and a control they will never legitimately use is a control that will one
 * day be pressed by mistake."* A controller with no POST cannot grow one by
 * accident, and a page whose only server verb is GET cannot change anything
 * however it is driven.
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
}
