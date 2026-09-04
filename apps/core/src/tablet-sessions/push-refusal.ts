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
   * THE REPORTED GAP, STATED ON THE SCREEN RATHER THAN GUESSED AT.
   *
   * The push flow's normal case is meant to be an ENDURING agreement for a GP
   * (REQ-END-01/-01a). The renderer handles the type — it is content-agnostic
   * and renders whatever particulars it is given. The s 65C RULE SET does not:
   * it has no enduring path at all. C6 skips D6a for the type, C5 still demands
   * the single service date a standing agreement does not have, and the
   * conformance suite (`apps/rules/src/rules/rule-set.contract.ts`) has no
   * enduring case to check any of it against.
   *
   * The rule set is a HUMAN-AUTHORED ZONE (CLAUDE.md §7). Writing enduring
   * rules to make this button work would be an agent authoring regulation, so
   * the push refuses and says so, and the gap is reported rather than filled.
   */
  enduringNotSupported: () =>
    new PushRefusal(
      'enduring_not_supported',
      'Enduring agreements cannot be sent to a tablet yet: the s 65C rule set has no enduring path, so the ' +
        'particulars cannot be validated or locked. Offer an episodic agreement for this visit.',
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
