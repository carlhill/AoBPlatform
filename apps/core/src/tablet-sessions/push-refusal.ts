import { ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import type { PushBlockedReason } from '@aobplatform/domain';

/**
 * WHY A PUSH WAS REFUSED — one named refusal per reason, carrying a CODE the
 * console maps to its own words.
 *
 * THE CODE IS THE CONTRACT, NOT THE SENTENCE. The console renders its own
 * string-table entry for each reason (REQ-LANG-01), so the words a
 * receptionist reads are written for a receptionist and can be translated.
 * The sentence here is the honest fallback for anybody reading the API
 * directly, and it states a RULE — never a patient's data, never a rules-engine
 * message with a value folded into it (hard rule 9's reasoning applied to a
 * staff surface).
 *
 * THE STATUS IS PART OF THE ANSWER. `404` for a thing that is not there,
 * including a thing that belongs to another practice — RLS fails closed, and a
 * caller cannot tell a cross-practice id from a made-up one, which is the
 * correct amount to learn. `409` for a thing that exists and is in the wrong
 * state, which is the whole of the rest of this list: every one of them is
 * fixable at the desk in a few seconds, and a 400 would suggest the request
 * was malformed rather than early.
 *
 * NOTHING HERE BLOCKS CARE (hard rule 8, REQ-REC-04). Every refusal below
 * stops a SCREEN, never a patient: reception carries on, the patient is seen,
 * and capture falls back to post-service or paper.
 */
export class PushRefusal extends HttpException {
  constructor(
    readonly reason: PushBlockedReason,
    message: string,
    status: number,
    extra: Record<string, unknown> = {},
  ) {
    super({ statusCode: status, message, reason, ...extra }, status);
  }
}

export const pushRefusals = {
  deviceUnknown: () =>
    new PushRefusal(
      'device_unknown',
      'That tablet is not registered to this practice.',
      new NotFoundException().getStatus(),
    ),

  deviceRevoked: (label: string) =>
    new PushRefusal(
      'device_revoked',
      `${label} has been revoked and holds no credential, so it would show nothing. Rotate it to bring it back.`,
      new ConflictException().getStatus(),
    ),

  deviceNotPaired: (label: string) =>
    new PushRefusal(
      'device_not_paired',
      `${label} has not been paired yet. Type its code into the tablet first.`,
      new ConflictException().getStatus(),
    ),

  /**
   * OUT OF USE IS RECEPTION'S OWN SWITCH, AND THE REFUSAL SAYS SO (Carl, 4–5
   * Sep 2026).
   *
   * The fix is one press on `/practice/devices`, by the same person who is
   * reading this sentence — not a rotate, not an administrator, not a walk to
   * the tablet. So the refusal names the act rather than the state, and the
   * console's copy carries the link.
   */
  deviceOutOfUse: (label: string) =>
    new PushRefusal(
      'device_out_of_use',
      `${label} has been taken out of use, so it is showing "not in use" and would not show this ` +
        'agreement. Put it back in use, or send to another tablet.',
      new ConflictException().getStatus(),
    ),

  /**
   * ONE SESSION PER DEVICE, and the refusal carries the live session's id so
   * the console can offer Recall rather than leaving somebody to work out why
   * the button did nothing.
   */
  deviceBusy: (label: string, sessionId: string, state: string) =>
    new PushRefusal(
      'device_busy',
      `${label} is already showing an agreement. Recall it first — one tablet shows one patient.`,
      new ConflictException().getStatus(),
      { sessionId, sessionState: state },
    ),

  agreementNotFound: () =>
    new PushRefusal('agreement_not_found', 'Agreement not found.', new NotFoundException().getStatus()),

  agreementNotPushable: (status: string) =>
    new PushRefusal(
      'agreement_not_pushable',
      `An agreement in status ${status} cannot be sent to a tablet. Corrections supersede rather than edit (HARD-02).`,
      new ConflictException().getStatus(),
    ),

  serviceDescriptionMissing: () =>
    new PushRefusal(
      'service_description_missing',
      'This agreement still needs a basic description of the service, chosen from the current list. Set it ' +
        'on the practice screen first — the tablet never asks a patient for it.',
      new ConflictException().getStatus(),
    ),

  whoIsSigningUnset: () =>
    new PushRefusal(
      'who_is_signing_unset',
      'This agreement says somebody other than the patient is signing, but no party has been recorded. ' +
        'Set who is signing at the desk before sending it to a tablet (D7 is explicit, never inferred).',
      new ConflictException().getStatus(),
    ),

  patientConfidential: () =>
    new PushRefusal(
      'patient_confidential',
      'This patient record is flagged confidential, so nothing about them is shown on a waiting-room ' +
        'screen. Capture this one on paper or after the service — the patient is seen either way.',
      new ConflictException().getStatus(),
    ),

  /**
   * ENDURING IS GP-ONLY, PERMANENTLY (hard rule 6, REQ-END-01a).
   *
   * A specialist, allied health or optometry provider has NO enduring
   * pathway — this is not a gap waiting to be filled, it is the rule. The
   * offer for those providers is an episodic agreement or a Treatment Plan
   * Assignment (REQ-PLAN-06), and the console says so on the row.
   *
   * MISSING IS NOT GP. A provider whose discipline was never recorded fails
   * this check rather than passing it: the cost of guessing wrong is a
   * standing commitment to bulk bill, entered by a provider with no pathway to
   * enter it.
   */
  enduringNotGp: (providerType: string | null) =>
    new PushRefusal(
      'enduring_not_gp',
      `Ongoing agreements are for general practitioners only (REQ-END-01a); this provider is recorded as ` +
        `"${providerType ?? 'no discipline set'}". Offer an agreement for this visit, or a Treatment Plan ` +
        'Assignment.',
      new ConflictException().getStatus(),
    ),

  /**
   * ENDURING IS PER PRACTITIONER × PATIENT, NEVER PER PRACTICE (hard rule 6,
   * REQ-END-01). An agreement that names no single provider — an organisation
   * anchor on the ACCHO/AMS pathway, or a provider that was never set — cannot
   * be signed on a tablet, because the screen could not tell the person
   * signing who they are agreeing with.
   */
  enduringNotPerProvider: () =>
    new PushRefusal(
      'enduring_not_per_provider',
      'An ongoing agreement is between one provider and one patient, never practice-wide (REQ-END-01). ' +
        'This one names no single provider, so it cannot be sent to a tablet.',
      new ConflictException().getStatus(),
    ),

  /**
   * THE REPORTED GAP, STATED ON THE SCREEN RATHER THAN GUESSED AT — and it is
   * now the LAST thing in the way rather than the first (Carl, 4 Sep 2026;
   * GA-PLAN B5).
   *
   * Everything else an enduring push needs exists: the practice setting, the
   * GP and per-provider checks, the ceremony, the decline path. What does not
   * exist is the s 65C rule set's ENDURING BRANCH — reg 65CB's content set has
   * no rules written against it, C5 still demands the single service date a
   * standing agreement has no honest value for, and the conformance suite
   * (`apps/rules/src/rules/rule-set.contract.ts`) has no enduring case.
   *
   * SO THE PLATFORM ASKS THE RULE SET AND BELIEVES THE ANSWER. It sends the
   * enduring payload, and if the registered set returns no verdict on the
   * enduring family then silence is not a pass and this is the refusal. The
   * rule set is a HUMAN-AUTHORED ZONE (CLAUDE.md §7): writing that branch to
   * make this button work would be an agent authoring regulation. The contract
   * it is authored against is written out as a pending spec,
   * `apps/rules/test/enduring-ruleset.pending.spec.ts`, and the moment it
   * passes this refusal stops happening without another line of code.
   */
  enduringRulesNotAuthored: () =>
    new PushRefusal(
      'enduring_rules_not_authored',
      'Ongoing agreements are not yet enabled: the s 65C rule set returns no verdict on the enduring ' +
        'content set (reg 65CB), so the particulars cannot be validated or locked. Offer an agreement for ' +
        'this visit instead.',
      new ConflictException().getStatus(),
    ),

  /**
   * THE PUSH IS THE VERIFICATION RECORD, so it cannot be made by nobody
   * (REQ-VER-03/-04). Refused rather than recorded as `unattributed` — an
   * audit line naming nobody is worse than a refusal, because later it cannot
   * be questioned.
   */
  noActor: () =>
    new ForbiddenException(
      'Sending an agreement to a tablet records the staff-verified identity check that goes with it, so it ' +
        'is recorded against the person who did it. This request carries no signed-in user, so it is ' +
        'refused rather than recorded as nobody.',
    ),
};
