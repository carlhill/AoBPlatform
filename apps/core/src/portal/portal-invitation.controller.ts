import { BadRequestException, Controller, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { SessionActor, type Actor } from '../auth/actor.decorator';
import { PortalService } from './portal.service';

function requirePractice(practiceId: string | undefined): string {
  if (!practiceId) throw new BadRequestException('x-practice-id header is required.');
  return practiceId;
}

/**
 * FR-1.14 — "offer, never require" portal activation after a signature.
 *
 * IT SITS ON THE AGREEMENT PATH AND NOT UNDER `/portal`, deliberately. Minting
 * an invitation is a PRACTICE act about one agreement — it belongs beside
 * `/agreements/:id/sign` in the order the ceremony runs, and a patient can
 * never reach it. Everything under `/portal` is the patient's own surface; one
 * prefix meaning two audiences is how an endpoint ends up with the wrong guard.
 *
 * THE TOKEN COMES BACK ONCE, IN THIS RESPONSE, AND IS NEVER READABLE AGAIN. It
 * is delivered to the patient through the messaging module on the sandbox
 * gateway. NO MESSAGE COPY IS WRITTEN HERE: the strings belong in the string
 * table on the web surface (REQ-LANG-01), and real sends cost money and need a
 * registered sender (CLAUDE.md §7).
 *
 * REQ-PORT-08 IS THE RULE THIS ENDPOINT EXISTS UNDER. Portal access is never a
 * precondition of signing, so nothing in the signing path calls this and fails;
 * a practice or a post-signature job offers it, and an offer that does not land
 * costs the patient nothing.
 */
@Controller('agreements')
export class PortalInvitationController {
  constructor(private readonly portal: PortalService) {}

  @Post(':id/portal-invitation')
  mint(
    @Headers('x-practice-id') practiceId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @SessionActor() actor: Actor | undefined,
  ) {
    /*
     * `system` IS AN HONEST ACTOR HERE AND NOT A GAP. Two callers mint these: a
     * staff member at the counter, and the post-signature step that offers
     * activation automatically. Recording the second as a person would be
     * worse than recording it as what it is.
     */
    return this.portal.mintInvitation(requirePractice(practiceId), id, actor?.id ?? 'system');
  }
}
