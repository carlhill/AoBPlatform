import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { TabletSessionsService } from './tablet-sessions.service';
import { PushToDeviceDto } from './tablet-sessions.dto';
import { SessionActor, type Actor } from '../auth/actor.decorator';
import { PracticeScoped } from '../auth/practice-scope.decorator';

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

/**
 * RECEPTION'S SIDE OF THE PUSH — `/practice/tablet` talks to this
 * (TODO.md "Two front doors", Carl 4 Sep 2026).
 *
 * @PracticeScoped ON EVERY ACT, for the same reason `/devices` is. Sending a
 * patient's particulars to a screen in this practice's waiting room, and
 * recording the staff-verified identity check that goes with it, is the
 * PRACTICE'S OWN ACT. A platform operator reaches it only by acting as them,
 * which leaves a record of on whose behalf — and forces a re-approval by a
 * different person (CRITICAL-ISSUES.md §5).
 *
 * EVERY ACT REFUSES AN UNATTRIBUTED CALLER. The push IS the verification
 * record (REQ-VER-03/-04): it carries the identity of the person who checked
 * the patient across the desk. Recorded as `unattributed` it would be a
 * verification nobody can be asked about later, which is worse than a refusal.
 *
 * `POST /devices/:deviceId/push` SITS UNDER `/devices` BY PATH AND HERE BY
 * MODULE, deliberately. The resource being acted on is a tablet, so that is
 * where a reader looks for it; the behaviour is this feature's, so that is
 * where it lives. `DevicesController` keeps only what a device IS —
 * registering, pairing, revoking, rotating — and gains no knowledge of
 * agreements.
 */
@Controller()
export class TabletSessionsController {
  constructor(private readonly sessions: TabletSessionsService) {}

  /**
   * Send one locked agreement to one named tablet.
   *
   * Every refusal carries a `reason` code the console renders in its own words
   * (REQ-LANG-01) — a rule, never a patient's data. `device_busy` also carries
   * the live session's id, so the console can offer Recall rather than leaving
   * somebody wondering why the button did nothing.
   */
  @Post('devices/:deviceId/push')
  @PracticeScoped()
  push(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: PushToDeviceDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.sessions.push(requirePractice(practiceId), deviceId, dto.agreementId, actor);
  }

  /**
   * What is on this practice's tablets. STATES, NOT A MIRROR (TODO.md): a name,
   * a state and a time, which is what reception needs and is cheaper besides.
   *
   * `?active=true` (the default) is the live view the console polls. Anything
   * else returns the last twenty-four hours, for the question "what happened to
   * the one I sent at nine".
   */
  @Get('tablet-sessions')
  @PracticeScoped()
  list(@Headers('x-practice-id') practiceId: string | undefined, @Query('active') active?: string) {
    return this.sessions.list(requirePractice(practiceId), active !== 'false');
  }

  /**
   * Today's drafts, each with whether it can go to a tablet and, if not, which
   * rule is in the way.
   *
   * WHY IT IS HERE AND NOT `GET /agreements?pushable=today`. This list answers
   * "what can be PUSHED", which means it must encode the push's own
   * preconditions — one of which is that the s 65C rule set has no enduring
   * path yet. `/agreements` has no business knowing that, and a query
   * parameter that changed the shape of its response would make the endpoint
   * two endpoints wearing one name. It sits with the feature whose rules it
   * states.
   */
  @Get('tablet-sessions/pushable')
  @PracticeScoped()
  pushable(@Headers('x-practice-id') practiceId: string | undefined) {
    return this.sessions.pushable(requirePractice(practiceId));
  }

  /**
   * Take it back. Nothing on the agreement changes — the particulars stay
   * locked, the capture request stays open, and the patient can be handed the
   * tablet again in a minute or sign by any other channel (REQ-REC-04).
   *
   * DECLARED AFTER `pushable`: Nest matches in declaration order, and a
   * `:id` route above it would try to parse the word "pushable" as a UUID.
   */
  @Post('tablet-sessions/:id/recall')
  @PracticeScoped()
  recall(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.sessions.recall(requirePractice(practiceId), id, actor);
  }
}
