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
import { ResolveDisputeDto } from './dispute-resolution.dto';
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

  /**
   * SEND IT AGAIN, NOW THAT THE DETAIL IS FIXED (Carl, 4 Sep 2026).
   *
   * The patient crossed a row on the tablet, reception corrected it at the
   * desk, and this recalls the old screen and hands the SAME tablet a fresh
   * session for the same visit — re-read from the platform's records, so the
   * corrected detail is what the patient sees.
   *
   * IT REFUSES THE SAME WAY THE PUSH DOES, with the same `reason` codes, for
   * the good reason that it IS a push: a tablet revoked between the dispute
   * and the fix, or an agreement that has moved on, must read the same on this
   * button as on the other one.
   *
   * IF A PARTICULAR WAS CORRECTED ON A LOCKED AGREEMENT, THE RESPONSE SAYS SO.
   * `supersededAgreementId` names the agreement that was replaced (HARD-02 —
   * corrections supersede, they do not edit), so the console can tell
   * reception plainly rather than leaving them to wonder why the row's id
   * changed under them.
   */
  @Post('tablet-sessions/:id/resend')
  @PracticeScoped()
  resend(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.sessions.resend(requirePractice(practiceId), id, actor);
  }

  /**
   * THE PATIENT WOULD RATHER AGREE EACH VISIT — SO OFFER THEM THIS ONE
   * (Carl, 4 Sep 2026; GA-PLAN B5).
   *
   * The one press that answers a declined ongoing agreement: a fresh
   * `episodic_pre` draft for the same patient, provider and description of the
   * service, pushed to the tablet the patient is still standing at.
   *
   * IT REFUSES THE SAME WAY THE PUSH DOES, with the same `reason` codes,
   * because the second half of it IS a push. A draft that reaches the list but
   * not the tablet — no description of the service, somebody else took the
   * device — is still on reception's screen with its reason on it, and the
   * patient is seen regardless (hard rule 8, REQ-REC-04).
   *
   * THE RESPONSE NAMES THE NEW AGREEMENT, so the console can follow it rather
   * than reload and guess which row appeared.
   */
  @Post('tablet-sessions/:id/offer-episodic')
  @PracticeScoped()
  offerEpisodic(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.sessions.offerEpisodicAfterDecline(requirePractice(practiceId), id, actor);
  }

  /**
   * HOW THE DISPUTE ENDED (Carl, 4 Sep 2026) — reception says what they did
   * about the row the patient crossed.
   *
   * TWO OUTCOMES, AND THE SECOND IS WHY THIS EXISTS. `corrected` says the
   * detail was changed on the platform's mirror (that act writes its own
   * `patient.details_corrected` event); `patient_error` says the detail was
   * right all along. Without the second, closing a dispute would mean faking
   * a correction that never happened.
   *
   * IT CHANGES NOTHING — not the agreement, not the session, not the patient.
   * It records a fact against a named staff member and nothing else, which is
   * exactly what it is for: a cross with no recorded answer is a hole in the
   * evidence, and a cross answered by an unattributed caller is worse.
   *
   * TYPES, NEVER VALUES (REQ-VER-04). The DTO has no field that could carry
   * one.
   */
  @Post('tablet-sessions/:id/dispute-resolution')
  @PracticeScoped()
  resolveDispute(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveDisputeDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    return this.sessions.resolveDispute(requirePractice(practiceId), id, dto.outcome, dto.details, actor);
  }
}
