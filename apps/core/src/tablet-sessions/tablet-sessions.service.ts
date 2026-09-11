import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Agreement as DbAgreement, Prisma, TabletSession } from '@prisma/client';
import {

  TABLET_SESSION_IDLE_MS,
  canChangeTabletSessionState,
  computeSignability,
  correctionTouchesParticulars,
  detailTypeForPatientField,
  isCorrectablePatientField,
  basicServiceDescriptionOf,
  isServiceDescription,
  mayBeProviderOnAgreement,
  projectTabletSessionPatient,
  shownDetailTypesFor,
  type AgreementType,
  type ConfirmableDetailType,
  type PushBlockedReason,
  type TabletSessionPayload,
  type TabletSessionRow,
  type TabletSessionState,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { anchorForAgreement, anchorsForAgreements } from '../affiliations/agreement-anchor';
import type { Actor } from '../auth/actor.decorator';
import { PrismaService } from '../prisma/prisma.service';
import {
  AgreementsService,
  EnduringRulesNotAuthoredError,
  type PreparedLock,
} from '../agreements/agreements.service';
import type { LockParticularsDto } from '../agreements/agreements.dto';
import { CaptureService } from '../capture/capture.service';
import { VerificationService } from '../verification/verification.service';
import { DevicesService, type ResolvedDevice } from '../devices/devices.service';
import { ServiceDescriptionsService } from '../service-descriptions/service-descriptions.service';
import { pushRefusals } from './push-refusal';
import type { DisputeResolutionOutcome } from './dispute-resolution.dto';

/**
 * The statuses a pre-agreement may be in and still be worth sending to a
 * tablet. `verification_failed` is deliberately absent: it is a lockout, and
 * putting a locked-out agreement on a screen would ask the patient to do
 * something that cannot succeed.
 */
const PUSHABLE_STATUSES = ['draft', 'verification_pending', 'awaiting_signature'] as const;

/** D6a applies to these; enduring is refused before it gets this far. */
const PRE_AGREEMENT_TYPES = ['episodic_pre', 'treatment_plan'] as const;

/**
 * A row on the console's left-hand list — a draft that could go to a tablet,
 * or the reason it could not.
 */
export interface PushableRow {
  agreementId: string;
  agreementType: AgreementType;
  status: string;
  patientName: string;
  /**
   * SO A ROW CAN BE FOLLOWED TO THE PATIENT IT IS ABOUT (the reception work
   * page, Carl 4 Sep 2026). An ID, NOT A DETAIL — exactly the reasoning
   * `TabletSessionRow.patientId` already carries: it names a row the vault
   * events also name, so nothing about the person is added to the wire by
   * putting it here. The five details are still fetched only when somebody
   * opens the control that needs them.
   */
  patientId: string;
  providerName: string | null;
  /** So the console offers episodic / Treatment Plan Assignment for a non-GP, never enduring (REQ-END-01a). */
  providerType: string | null;
  appointmentDate: string | null;
  appointmentTime: string | null;
  /** D6a as it stands, and whether it is from the CURRENT mapping (hard rule 14). */
  serviceDescription: string | null;
  serviceDescriptionValid: boolean;
  /**
   * THE POST-SERVICE PARTICULARS — D5 AND D6b (Carl, 11 Sep 2026; TODO.md "Two
   * front doors" (b)).
   *
   * `null` and `[]` on every pre-agreement row, and that is the discriminator
   * rather than a flag: a post-agreement is s 65C(4) table item 6 and carries
   * the date the service WAS rendered plus its MBS item numbers, where a
   * pre-agreement carries a Basic Service Description instead (REQ-REG-01 D6a
   * "pre-agreements only", D6b "post-agreements only"). The desk row reads
   * "Post-service · <date> · items <numbers>" off these two.
   *
   * NO AMOUNT, AND THERE IS NO FIELD FOR ONE (hard rule 4). The service record
   * these come from holds none either.
   */
  serviceDate: string | null;
  mbsItemNumbers: string[];
  /** D7 — explicit, never inferred (CLAUDE.md §3). */
  assignorIsPatient: boolean;
  assignorName: string | null;
  assignorRelationship: string | null;
  /**
   * WHERE THE SIGNER'S OWN COPY GOES -- and, because it is on the row, what the
   * "Who is signing?" panel shows when it is REOPENED (Carl, 10 Sep 2026). A
   * saved someone-else came back with the name and the relationship in their
   * controls and the two contact boxes empty, so a second Save meant typing a
   * mobile and an email that the practice already holds.
   *
   * `null` WHENEVER THE PATIENT IS SIGNING, on the same branch the name and the
   * relationship take: there is no third-party contact to carry, and the
   * patient's own is not it.
   *
   * A CONSOLE ROW, NOT A VERIFICATION AND NOT AN EVIDENCE EVENT. This list is
   * practice-scoped behind RLS and the practice took these values across the
   * desk; nothing here is an identifier, so hard rule 9 (REQ-VER-04) is
   * untouched -- verification logs still carry TYPES and outcomes only. Nothing
   * is written, so no vault event moves (hard rule 11).
   *
   * AND IT NEVER REACHES A TABLET. `TabletSessionPayload.assignor` carries
   * `isPatient`, `name` and `relationship` and has no field for either of
   * these; the named e2e asserts their absence from the kiosk payload.
   */
  assignorMobile: string | null;
  assignorEmail: string | null;
  particularsLocked: boolean;
  /**
   * WHEN A PERSON SAID WHO IS SIGNING — `null` until somebody has. The console
   * keeps the tablet select and Send dead while it is null, and the row's own
   * "Who is signing?" is the primary action instead (Carl, 7 Sep 2026).
   */
  assignorConfirmedAt: string | null;
  pushable: boolean;
  blockedReason: PushBlockedReason | null;
  /** Where it already is, if it is on a tablet right now. */
  activeSession: { id: string; deviceId: string; state: TabletSessionState } | null;
}

/**
 * A SERVICE THAT NEEDED NO SECOND SIGNATURE — a history line on the desk, never
 * a Send (Carl, 11 Sep 2026; TODO.md "One signature per episodic visit, not
 * two").
 *
 * Deliberately NOT a `PushableRow` with `pushable: false`. A row with a blocked
 * reason is work somebody has to unblock; this is work that is finished, and
 * putting the two in one list would mean a receptionist reading a reason code to
 * learn that there is nothing to do. Its own shape, its own read, and it names
 * the agreement that covers the visit so the line can link to it.
 */
export interface CoveredServiceRow {
  serviceRecordId: string;
  patientId: string | null;
  patientName: string | null;
  providerName: string | null;
  /** D5 — the day the service was rendered. */
  serviceDate: string;
  /** D6b — the item numbers that were billed. No amount (hard rule 4). */
  mbsItemNumbers: string[];
  decision: 'covered' | 'covered_by_enduring';
  reason: string;
  policyVersion: string;
  coveringAgreementId: string | null;
}

/**
 * PUSH-TO-DEVICE CAPTURE — reception hands the patient a locked screen
 * (TODO.md "Push-to-device capture" and "Two front doors", Carl 4 Sep 2026).
 *
 * THE SECOND FRONT DOOR. `/kiosk` stays exactly as built: a walk-up kiosk for
 * an unsupported patient who finds their own name and types their details to
 * prove it is them. This is the other use case on the same paired tablet.
 * Reception has checked the Medicare card in the PMS, matched the patient, and
 * asked date of birth, mobile, email and address across the desk — the
 * three-identifier staff check (REQ-VER-03). So the patient never searches and
 * never types: they tick their details as correct, read, and approve.
 * Everything from the agreement screen onward is identical in both flows.
 *
 * WHY THE PUSH IS STRONGER ON THE HARD RULE, and not merely faster. REQ-REG-06
 * requires the particulars complete and locked before the signature control
 * can enable; signing a draft is the criminal offence in this regime. A pull
 * model has a device assemble a payload and then ask. A push model validates
 * and locks on the SERVER before any device sees anything, so a tablet
 * structurally cannot hold a draft.
 *
 * THE PUSH IS THE VERIFICATION RECORD (REQ-VER-03/-04). It refuses without a
 * signed-in staff member, and it writes the staff-verified event carrying that
 * person's identity, the identifier TYPES checked, the outcome and the
 * channel. Never a value: there are no values here to have, because the check
 * happened across a desk.
 *
 * THE TICKS THAT FOLLOW ARE NOT A VERIFICATION and are not recorded as one. A
 * displayed value confirmed by whoever is holding the tablet proves nothing
 * about who is holding it. They are a data-accuracy confirmation, part of the
 * agreement ceremony, and their event is named for what it is.
 *
 * WRITES GO THROUGH MODULE APIs; READS CROSS TABLES. Every write this service
 * makes outside its own table is somebody else's module's call —
 * `AgreementsService.commitPushLock`, `CaptureService.openInPractice`,
 * `VerificationService.recordStaffVerified`, `DevicesService.find`. The reads
 * that assemble a screen span tables, on the precedent `KioskService` and
 * `ReconciliationService` set: a row that must say "Jamie, 9:00, Dr Example"
 * cannot be built from one module's tables, and reading owns nothing.
 *
 * NOTHING HERE BLOCKS CARE (hard rule 8, REQ-REC-04). Every refusal stops a
 * screen. Walking away, recalling and expiring change NOTHING on the
 * agreement — reception carries on and chooses a private bill or an episodic
 * agreement after the service.
 */
@Injectable()
export class TabletSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agreements: AgreementsService,
    private readonly capture: CaptureService,
    private readonly verification: VerificationService,
    private readonly devices: DevicesService,
    /**
     * D6a IS THE SERVICE-DESCRIPTIONS MODULE'S WRITE, not this one's — the
     * same rule every other cross-module write here follows. Used only by
     * `offerEpisodicAfterDecline`, to carry the description onto the draft it
     * creates.
     */
    private readonly serviceDescriptions: ServiceDescriptionsService,
  ) {}

  // -------------------------------------------------------------------------
  // The console
  // -------------------------------------------------------------------------

  /**
   * SEND ONE LOCKED AGREEMENT TO ONE NAMED TABLET.
   *
   * PRECONDITIONS FIRST, EACH WITH ITS OWN NAMED REFUSAL, then ONE
   * TRANSACTION. What commits together is the whole act: the capture request,
   * the staff-verified verification event, the validated-and-locked
   * particulars with their rendered hash, the agreement's move to
   * `awaiting_signature`, the session, and every vault event evidencing them
   * (hard rule 11 / FR-11.2). A locked agreement sitting on a tablet with no
   * record of who verified the patient — or a verification event for a push
   * that rolled back — are both structurally impossible.
   *
   * THE RULES ENGINE AND THE RENDERER RUN BEFORE THE TRANSACTION OPENS, in
   * `prepareLock`. Both are network-shaped work and holding a database
   * transaction across a network call is how a slow dependency becomes a
   * locked table — the same judgement `sign` makes about staging artefact
   * bytes.
   */
  async push(
    practiceId: string,
    deviceId: string,
    agreementId: string,
    actor: Actor | undefined,
  ): Promise<TabletSessionRow> {
    if (!actor) throw pushRefusals.noActor();

    // Any session that has been sitting untouched for half an hour is over
    // before anything else is asked — otherwise a tablet nobody is standing at
    // refuses tonight's push for a patient who left at lunchtime.
    await this.settle(practiceId);

    const device = await this.devices.find(practiceId, deviceId);
    if (!device) throw pushRefusals.deviceUnknown();
    if (device.state === 'revoked') throw pushRefusals.deviceRevoked(device.label);
    if (device.state === 'awaiting_pairing') throw pushRefusals.deviceNotPaired(device.label);
    // TAKEN OFF THE FLOOR BY RECEPTION. Not a security state and not a
    // credential problem: the tablet is showing "not in use", so an agreement
    // sent to it would sit behind that screen. Named test:
    // `push_refuses_an_out_of_use_device`.
    if (device.state === 'inactive') throw pushRefusals.deviceOutOfUse(device.label);

    const busy = await this.prisma.withPractice(practiceId, (tx) =>
      tx.tabletSession.findFirst({ where: { deviceId, endedAt: null } }),
    );
    if (busy) throw pushRefusals.deviceBusy(device.label, busy.id, busy.state);

    const context = await this.readPushContext(practiceId, agreementId);
    this.assertPushable(context);

    /*
     * ALREADY LOCKED IS THE RE-PUSH CASE, and it must not lock again. A
     * session that was recalled, walked away from, or expired leaves the
     * agreement locked at `awaiting_signature` — handing the tablet back to
     * the same patient is an ordinary thing to do, and HARD-02 says a locked
     * agreement is corrected by superseding rather than by editing. So the
     * re-push records a FRESH staff-verified event (reception has the person
     * in front of them again) and touches nothing else about the contract.
     */
    /*
     * THE ENDURING BOUNDARY IS INSIDE THE LOCK, so this is where it surfaces
     * (Carl, 4 Sep 2026; GA-PLAN B5). `prepareLock` asks the rule set about
     * the enduring content set and throws when it gets silence back; the push
     * turns that into its own CODE, which the console renders in a
     * receptionist's words with somewhere to go.
     *
     * A RE-PUSH NEVER REACHES IT, and correctly: an agreement that is already
     * locked was validated by a rule set that DID answer, so handing the same
     * patient the tablet again is not the moment to re-litigate it (HARD-02 —
     * a locked agreement is corrected by superseding, never by editing).
     */
    const prepared: PreparedLock | null = context.agreement.particularsLockedAt
      ? null
      : await this.prepareLockOrRefuse(
          practiceId,
          agreementId,
          {
            /*
             * D5 IS THE VISIT'S DATE, taken from the appointment the
             * pre-agreement was drafted for, and today's date for a walk-in
             * who has no booking. D2 is today, because today is when the
             * agreement is being proposed. The rules engine has the last word
             * on whether the pair is consistent (C5) — this supplies the two
             * facts and asserts nothing about them.
             */
            /*
             * D5 — THE VISIT'S DATE. For a pre-agreement it is the appointment
             * the draft was made for, and today for a walk-in with no booking.
             * For a POST-agreement it is the day the service WAS rendered, off
             * the service record the draft was made from (Carl, 11 Sep 2026) —
             * which matters because C5 requires a post-agreement's service date
             * to be on or BEFORE its agreement date, and "today" would be a
             * silent lie about a service rendered yesterday afternoon.
             */
            serviceDate: context.serviceDate ?? context.appointmentDate ?? today(),
            agreementDate: today(),
            /*
             * D6b — POST-AGREEMENTS ONLY (REQ-REG-01; s 65C(4) table item 6).
             * `undefined` on every other type, so C7 keeps its "applies to
             * post-agreements only" branch and nothing invents an item number
             * for a pre-agreement. The ordinary post-service path locks at
             * draft time and never reaches here; this is the re-lock for a
             * post-agreement whose first lock did not commit.
             */
            mbsItemNumbers:
              context.agreement.type === 'episodic_post' ? context.mbsItemNumbers : undefined,
          },
          // The staff-verified event is written in the SAME transaction as the
          // lock, so at this moment the agreement does not yet carry its id.
          // The override states the fact the transaction is about to make true.
          { verificationPassed: true },
        );

    const identifierTypes = await this.verification.identifierTypesFor(practiceId);

    try {
      const session = await this.prisma.withPractice(practiceId, async (tx) => {
        const request = await this.capture.openInPractice(tx, practiceId, agreementId);

        const verified = await this.verification.recordStaffVerified(tx, practiceId, {
          patientId: context.agreement.patientId,
          identifierTypes,
          staffId: actor.id,
          channel: 'in_practice',
        });

        await this.agreements.commitPushLock(tx, agreementId, prepared, verified.verificationEventId);

        const created = await tx.tabletSession.create({
          data: {
            practiceId,
            deviceId,
            agreementId,
            captureRequestId: request.id,
            verificationEventId: verified.verificationEventId,
            state: 'pushed',
            pushedBy: actor.name,
            pushedById: actor.id,
          },
        });

        await enqueueVaultEvent(tx, {
          type: 'tablet.session_pushed',
          actor: { principalType: 'staff', id: actor.id },
          subject: { type: 'TabletSession', id: created.id },
          // Ids, a device label and facts. No patient, no identifier value, no
          // amount (REQ-LOG-08, hard rules 4 and 9).
          payload: {
            deviceId,
            deviceLabel: device.label,
            agreementId,
            agreementType: context.agreement.type,
            captureRequestId: request.id,
            reusedCaptureRequest: request.reused,
            verificationEventId: verified.verificationEventId,
            particularsLockedByThisPush: prepared !== null,
            pushedBy: actor.name,
          },
        });

        return created;
      });

      return this.rowFor(session, device.label, context);
    } catch (err) {
      /*
       * THE UNIQUE INDEX WINS THE RACE. Two receptionists pushing to the same
       * tablet in the same second get one session and one refusal, and the
       * refusal is the same one the check above gives — a caller must not be
       * able to tell whether it lost by a second or by a microsecond.
       */
      if (isUniqueViolation(err)) {
        const live = await this.prisma.withPractice(practiceId, (tx) =>
          tx.tabletSession.findFirst({ where: { deviceId, endedAt: null } }),
        );
        if (live) throw pushRefusals.deviceBusy(device.label, live.id, live.state);
      }
      throw err;
    }
  }

  /**
   * TAKE IT BACK. A console act, like revoke, and for the same reason: a
   * tablet that could release itself could be released by a passer-by.
   *
   * NOTHING ON THE AGREEMENT CHANGES. The particulars stay locked, the capture
   * request stays open, the status stays `awaiting_signature` — the patient
   * can be handed the tablet again in a minute, or sign by any other channel,
   * or be billed privately. Recall ends a screen, not an agreement
   * (REQ-REC-04). Named test: `recall_changes_nothing_on_the_agreement`.
   */
  async recall(practiceId: string, sessionId: string, actor: Actor | undefined): Promise<TabletSessionRow> {
    if (!actor) throw pushRefusals.noActor();
    const ended = await this.end(practiceId, sessionId, 'recalled', {
      principalType: 'staff',
      id: actor.id,
    });
    return this.decorate(practiceId, [ended]).then((rows) => rows[0]);
  }

  /**
   * SEND A TABLET BACK TO BEGIN (Carl, 4–5 Sep 2026; TODO.md "Tablet heartbeat
   * and Return to Begin").
   *
   * THE ONE THING RECEPTION COULD NOT DO BEFORE. Recall reaches a PUSHED
   * session; a walk-up ceremony is nobody's session — the patient typed three
   * details into a tablet by themselves — so a tablet stuck half-way through
   * verifying somebody who wandered off could only be cleared by walking over
   * and touching it, or by waiting out the practice's idle timeout. This is
   * the button for it.
   *
   * IT IS BOTH HALVES, AND IT HAS TO BE. A live pushed session is RECALLED
   * through the existing path — the same `end`, the same `recalled` state, the
   * same `tablet.session_ended` event — so the console's story about that
   * session is the story it has always told. And a command is left on the
   * DEVICE, because a walk-up has no session to recall and the command is the
   * only thing that reaches one.
   *
   * IT LIVES HERE AND NOT IN `DevicesController` for the same reason
   * `POST /devices/:deviceId/push` does: the resource is a tablet, so the PATH
   * is under `/devices`, but the behaviour ends a session, so the CODE is in
   * the module that owns sessions. `DevicesController` keeps only what a
   * device IS.
   *
   * IT NEVER BLOCKS CARE (hard rule 8, REQ-REC-04). Nothing on the agreement
   * moves: the particulars stay locked, the capture request stays open, and
   * the patient — who is standing in front of the person who pressed this — is
   * seen either way. The tablet says so in words before it clears.
   */
  async returnToBegin(
    practiceId: string,
    deviceId: string,
    actor: Actor | undefined,
  ): Promise<{ deviceId: string; commandId: string; issuedAt: string; recalledSessionId: string | null }> {
    if (!actor) throw pushRefusals.noActor();

    const device = await this.devices.find(practiceId, deviceId);
    // A cross-practice id finds nothing — RLS fails closed, and a caller
    // cannot tell one from a made-up id, which is the correct amount to learn.
    if (!device) throw pushRefusals.deviceUnknown();

    /*
     * THE RECALL FIRST, SO THE SESSION IS OVER BEFORE THE TABLET IS TOLD.
     * Reception has decided the tablet is needed; leaving a live session on a
     * device that is about to show Begin would be a session the console still
     * offers Recall for after the screen it belonged to has gone.
     */
    const live = await this.prisma.withPractice(practiceId, (tx) =>
      tx.tabletSession.findFirst({ where: { deviceId, endedAt: null } }),
    );
    if (live) {
      await this.end(practiceId, live.id, 'recalled', { principalType: 'staff', id: actor.id });
    }

    const command = await this.devices.requestReturnToBegin(practiceId, deviceId, actor, {
      recalledSessionId: live?.id ?? null,
    });
    return { ...command, recalledSessionId: live?.id ?? null };
  }

  /**
   * TAKE A TABLET OUT OF USE, OR PUT IT BACK (Carl, 4–5 Sep 2026; TODO.md
   * "Tablets: make one inactive").
   *
   * RECEPTION'S SWITCH, NOT AN ADMINISTRATOR'S REVOKE. A flat battery, a
   * tablet gone for repair, one on the wrong desk: the credential is fine, and
   * revoking it would cost a rotate and somebody walking to the device to type
   * a code in. Out of use refuses pushes, shows a quiet "not in use" screen,
   * and reverses with one press — while the tablet keeps heartbeating, so it
   * stays visible on the console instead of being indistinguishable from one
   * switched off.
   *
   * TAKING IT OUT RECALLS WHATEVER IS ON IT, and that is why this act lives in
   * this module rather than in `DevicesService` alone. A tablet declared off
   * the floor while still holding somebody's particulars would be a screen
   * nobody is watching with a session the console still thinks is live.
   * Putting it BACK recalls nothing — there is nothing to take back.
   *
   * IT NEVER BLOCKS CARE (hard rule 8). The agreement is untouched; reception
   * sends to another tablet, bills privately, or captures after the service.
   */
  async setDeviceOutOfUse(
    practiceId: string,
    deviceId: string,
    outOfUse: boolean,
    actor: Actor | undefined,
  ): Promise<{ deviceId: string; outOfUse: boolean; recalledSessionId: string | null }> {
    if (!actor) throw pushRefusals.noActor();

    const device = await this.devices.find(practiceId, deviceId);
    if (!device) throw pushRefusals.deviceUnknown();

    let recalledSessionId: string | null = null;
    if (outOfUse) {
      const live = await this.prisma.withPractice(practiceId, (tx) =>
        tx.tabletSession.findFirst({ where: { deviceId, endedAt: null } }),
      );
      if (live) {
        await this.end(practiceId, live.id, 'recalled', { principalType: 'staff', id: actor.id });
        recalledSessionId = live.id;
      }
    }

    const result = await this.devices.setOutOfUse(practiceId, deviceId, outOfUse, actor, {
      recalledSessionId,
    });
    return { ...result, recalledSessionId };
  }

  /**
   * SEND IT AGAIN, WITH THE CORRECTED DETAILS (Carl, 4 Sep 2026).
   *
   * The patient crossed a row, reception fixed it at the desk
   * (`PATCH /patients/:id/details`), and this is the one button that finishes
   * the loop: take the old screen back, and hand the same tablet a fresh
   * session for the same visit, built from the records as they now stand.
   *
   * IT IS RECALL + PUSH, AND DELIBERATELY NOT A THIRD MECHANISM. Both halves
   * already carry their own rules and their own evidence — the recall changes
   * nothing on the agreement and says so on its event; the push re-reads the
   * patient (REQ-DATA-11), re-validates, re-locks where it must, and records a
   * FRESH staff-verified event because reception has the person in front of
   * them again (REQ-VER-03). Writing a bespoke path would mean a second copy
   * of both, and the second copy is the one that drifts.
   *
   * THE ONE GENUINELY NEW DECISION: WHETHER TO SUPERSEDE.
   *
   *  - NOT LOCKED YET → nothing to supersede. The push locks it for the first
   *    time, assembling the particulars from the corrected records.
   *  - LOCKED, AND ONLY A CONTACT DETAIL CHANGED → the same agreement goes out
   *    again. A mobile number and an email address are not particulars: they
   *    say where a copy goes and nothing about the contract, so the artefact
   *    that was rendered and hashed still states exactly what it stated
   *    (REQ-VER-02 keeps them out of the identity set for the same reason).
   *  - LOCKED, AND A PARTICULAR CHANGED → SUPERSEDE (HARD-02). The old
   *    particulars are hashed in; correcting them means a new agreement
   *    carrying `supersedesAgreementId`, and the old one keeps its own true
   *    record. `AgreementsService.supersedeForCorrection` owns that write — it
   *    is the agreements module's table and its rule.
   *
   * "A PARTICULAR CHANGED" MEANS "SINCE THE LOCK", not "ever". A patient whose
   * address was corrected last March and whose mobile was corrected two
   * minutes ago must not spawn a superseding agreement over the address: the
   * lock happened after it and already carries it. That is what the per-field
   * timestamps on the patient row are for.
   *
   * NOTHING HERE BLOCKS CARE. If the re-send cannot go — the tablet was
   * revoked, somebody else grabbed it, the agreement moved on — reception gets
   * the same refusal code the push gives, the patient is still seen, and the
   * visit can be billed privately or captured after the service (hard rule 8,
   * REQ-REC-04).
   */
  async resend(
    practiceId: string,
    sessionId: string,
    actor: Actor | undefined,
  ): Promise<TabletSessionRow & { supersededAgreementId: string | null }> {
    if (!actor) throw pushRefusals.noActor();

    const found = await this.prisma.withPractice(practiceId, async (tx) => {
      const session = await tx.tabletSession.findFirst({ where: { id: sessionId } });
      if (!session) return null;
      const agreement = await tx.agreement.findFirst({ where: { id: session.agreementId } });
      if (!agreement) return null;
      const patient = await tx.patient.findFirst({ where: { id: agreement.patientId } });
      return { session, agreement, patient };
    });
    if (!found) throw new NotFoundException('That tablet session was not found.');
    const { session, agreement, patient } = found;

    /*
     * TAKE THE SCREEN BACK FIRST. `end` is idempotent, so a session that has
     * already walked away or expired is not an error — reception pressing
     * Re-send on a row that ended a second ago should get a fresh session, not
     * a lecture. And the device must be free before the push, because one
     * session per device is a database fact.
     */
    if (!session.endedAt) {
      await this.end(practiceId, session.id, 'recalled', { principalType: 'staff', id: actor.id });
    }

    const correctedTypes = particularsCorrectedSince(patient, agreement.particularsLockedAt);
    const mustSupersede =
      agreement.particularsLockedAt !== null && correctionTouchesParticulars(correctedTypes);

    let targetAgreementId = agreement.id;
    let supersededAgreementId: string | null = null;

    if (mustSupersede) {
      targetAgreementId = await this.prisma.withPractice(practiceId, async (tx) => {
        const replacement = await this.agreements.supersedeForCorrection(
          tx,
          practiceId,
          agreement,
          correctedTypes,
          { id: actor.id, name: actor.name },
        );
        /*
         * AND NOTHING MAY STILL BE SIGNED AGAINST THE OLD ONE. Its evidence
         * stays exactly as it is — the artefact, the hash, the verification —
         * but every channel that could still collect a signature on the stale
         * particulars is closed, on every channel at once rather than only the
         * tablet's (FR-2.7's instinct: one visit, one live capture).
         */
        await this.capture.cancelOpenFor(tx, agreement.id, 'agreement_superseded');
        return replacement.id;
      });
      supersededAgreementId = agreement.id;
    }

    const row = await this.push(practiceId, session.deviceId, targetAgreementId, actor);
    return { ...row, supersededAgreementId };
  }

  /**
   * THE PATIENT DECLINED THE ONGOING AGREEMENT — SO OFFER THEM TODAY'S VISIT
   * (Carl, 4 Sep 2026; GA-PLAN B5).
   *
   * ONE PRESS AT THE DESK, and it is the whole of reception's reply to a
   * decline: a fresh `episodic_pre` draft for the SAME patient, the SAME
   * provider and the same description of the service, pushed to the same
   * tablet the patient is still standing at. Without it the receptionist would
   * have to leave this screen, find the patient somewhere else and build a
   * draft by hand, which is the "directions to a screen" failure the design
   * principle names (CLAUDE.md §7).
   *
   * IT IS A NEW AGREEMENT AND NOT A CONVERSION, and it could not be anything
   * else. The declined one is an ENDURING agreement — a standing commitment
   * under reg 65CB — and the new one is an episodic pre-agreement for one
   * service under s 65C(4). They have different content sets and, in a moment,
   * different rendered artefacts; turning one into the other by changing a
   * column would produce an agreement whose type does not match its own
   * evidence.
   *
   * THE DECLINED AGREEMENT IS NOT TOUCHED. It was never signed, nothing was
   * locked against it that this can change, and a decline is not a deletion —
   * it is a fact somebody may be asked about later. Its capture request closed
   * with its session.
   *
   * D6a IS COPIED WHERE THERE IS ONE AND OTHERWISE LEFT UNSET, deliberately.
   * An enduring agreement has no basic service description (that is a
   * pre-agreement element, REQ-REG-01 D6a), so in practice the source is the
   * practice's own default. Where there is neither, the new draft arrives
   * without D6a and the push refuses with `service_description_missing` — a
   * refusal the console already fixes INLINE on the row. Guessing a
   * description would put a word the practice never chose onto a contract.
   *
   * NOTHING HERE BLOCKS CARE. If the push cannot go — the tablet was taken,
   * the description is unset — the draft still exists on reception's list with
   * its reason on it, and the patient is seen either way (hard rule 8,
   * REQ-REC-04).
   */
  async offerEpisodicAfterDecline(
    practiceId: string,
    sessionId: string,
    actor: Actor | undefined,
  ): Promise<TabletSessionRow & { agreementId: string }> {
    if (!actor) throw pushRefusals.noActor();

    const found = await this.prisma.withPractice(practiceId, async (tx) => {
      const session = await tx.tabletSession.findFirst({ where: { id: sessionId } });
      if (!session) return null;
      const agreement = await tx.agreement.findFirst({ where: { id: session.agreementId } });
      if (!agreement) return null;
      const practice = await tx.practice.findFirst({});
      return { session, agreement, practiceDefaultD6a: practice?.defaultServiceDescription ?? null };
    });
    if (!found) throw new NotFoundException('That tablet session was not found.');
    const { session, agreement, practiceDefaultD6a } = found;

    /*
     * ONLY A DECLINE HAS THIS REPLY. A session that ended some other way — the
     * patient walked away, the clock ran out, reception recalled it — is not a
     * decline, and offering "instead of the ongoing agreement" against it
     * would put a sentence in the record about a conversation that never
     * happened. The ordinary Send on the row is the right control there.
     */
    if (session.state !== 'declined_enduring') {
      throw new ConflictException(
        'This offer replaces an ongoing agreement the patient declined. That session ended some other way, ' +
          'so use the ordinary Send on the row instead.',
      );
    }

    const offered = await this.draftEpisodicInstead(practiceId, agreement, practiceDefaultD6a, actor);

    await this.prisma.withPractice(practiceId, (tx) =>
      enqueueVaultEvent(tx, {
        type: 'tablet.episodic_offered_after_decline',
        actor: { principalType: 'staff', id: actor.id },
        subject: { type: 'Agreement', id: offered.agreementId },
        // Ids and types. No patient, no identifier value, no amount.
        payload: {
          declinedSessionId: session.id,
          declinedAgreementId: agreement.id,
          offeredAgreementId: offered.agreementId,
          offeredType: 'episodic_pre',
          affiliationId: offered.affiliationId,
          serviceDescriptionCarried: offered.serviceDescription !== null,
          offeredBy: actor.name,
        },
      }),
    );

    const row = await this.push(practiceId, session.deviceId, offered.agreementId, actor);
    return { ...row, agreementId: offered.agreementId };
  }

  /**
   * THE ONGOING AGREEMENT CANNOT BE ASKED FOR AT ALL — SO ASK FOR THIS VISIT
   * (Carl, 5 Sep 2026; CLAUDE.md §7 "shortcuts to the answer, not directions
   * to a screen", second instance).
   *
   * WHAT THE BAND USED TO SAY AND COULD NOT DO. A GP practice that offers
   * ongoing agreements by default drafts an `enduring` agreement for every
   * arrival, and every one of them sits on reception's list refusing to go
   * with `enduring_rules_not_authored` — the s 65C rule set's enduring branch
   * is a human-authored zone (CLAUDE.md §7) and is not written yet. The
   * console stated that, correctly, and then stopped: no control, no link, and
   * a receptionist who cannot author a rule set and cannot get the patient in
   * front of them an agreement either. This is the control.
   *
   * IT IS THE SIBLING OF `offerEpisodicAfterDecline` AND NOT THE SAME ACT. The
   * decline is the PATIENT'S answer, given on a tablet they are still standing
   * at, so that one pushes. This one answers a block the patient never saw:
   * there may be no tablet, no session and nobody at the desk yet, so it stops
   * at reception's list — the row appears, pushable if the description of the
   * service was there to lock, and reception sends it when the patient
   * arrives. The DRAFTING is identical, which is why both go through
   * `draftEpisodicInstead` rather than through two copies of the same rules.
   *
   * THE ENDURING DRAFT IS NOT DELETED, and it must not be. The vault is
   * append-only (hard rule 11, ADR A-02) and the draft is evidence of what the
   * practice offered this patient on this day; deleting it would erase the
   * only record that an ongoing agreement was ever on the table. Its status
   * does not move either — nothing was declined, refused or superseded. What
   * DOES close is its open capture request, which is the codebase's own idiom
   * for "this one has nowhere left to go" (`readPushableRows` filters on
   * exactly that), so it leaves the waiting list without anything being
   * rewritten.
   *
   * IT REFUSES AN AGREEMENT THAT IS ON A TABLET RIGHT NOW. Closing the capture
   * request under a live session would leave a patient reading an agreement
   * the console has already retired; reception recalls the screen first.
   *
   * IDEMPOTENT PER VISIT. Reception presses it twice, or two receptionists
   * press it at once, and the second press finds the episodic that is already
   * open for this provider × patient × today and returns it. Drafting a second
   * one would put two live agreements behind one service — which is exactly
   * what `pushable`'s open-capture filter exists to keep off the list.
   *
   * NOTHING HERE BLOCKS CARE (hard rule 8, REQ-REC-04). If the practice has no
   * default description of the service the draft arrives unlocked and the row
   * says `service_description_missing`, which the console fixes inline; the
   * patient is seen either way.
   */
  async offerEpisodicInstead(
    practiceId: string,
    agreementId: string,
    actor: Actor | undefined,
  ): Promise<{ agreementId: string; enduringAgreementId: string; reused: boolean }> {
    if (!actor) throw pushRefusals.noActor();

    const found = await this.prisma.withPractice(practiceId, async (tx) => {
      // A cross-practice id finds nothing — RLS filters on the
      // transaction-local scope, so this fails closed as a 404 rather than
      // admitting the agreement exists somewhere else.
      const agreement = await tx.agreement.findFirst({ where: { id: agreementId } });
      if (!agreement) return null;
      const live = await tx.tabletSession.findFirst({ where: { agreementId, endedAt: null } });
      const practice = await tx.practice.findFirst({});
      return { agreement, live, practiceDefaultD6a: practice?.defaultServiceDescription ?? null };
    });
    if (!found) throw pushRefusals.agreementNotFound();
    const { agreement, live, practiceDefaultD6a } = found;

    if (live) {
      throw new ConflictException(
        'That agreement is on a tablet right now. Take the screen back first, then offer an agreement ' +
          'for this visit.',
      );
    }

    const already = await this.openEpisodicForVisit(practiceId, agreement);
    if (already) {
      return { agreementId: already, enduringAgreementId: agreement.id, reused: true };
    }

    const offered = await this.draftEpisodicInstead(practiceId, agreement, practiceDefaultD6a, actor);

    /*
     * THE CAPTURE REQUEST IS WHAT PUTS IT ON RECEPTION'S LIST, and it is
     * opened in the same order an arrival opens one — before the lock, because
     * `CaptureService.open` refuses anything past `verification_pending` and
     * the lock is what moves it past.
     */
    await this.capture.open(practiceId, { agreementId: offered.agreementId, channel: 'in_practice' });

    /*
     * AND THEN EXACTLY WHAT AN ARRIVAL DOES WITH THE PRACTICE'S DEFAULT: move
     * it to `awaiting_signature` and lock the particulars, so the row is
     * pushable the moment it appears. WITH NO DEFAULT THERE IS NO LOCK AND NO
     * TRANSITION — an agreement sitting at `awaiting_signature` with unlocked
     * particulars is the shape hard rule 2 (REQ-REG-06) forbids, and the
     * platform never guesses a particular of a contract. The row arrives
     * saying `service_description_missing`, which reception fixes on the row
     * itself with the control that is already there.
     */
    if (offered.serviceDescription) {
      await this.agreements.transition(practiceId, offered.agreementId, 'awaiting_signature');
      await this.agreements.lockParticulars(practiceId, offered.agreementId, { serviceDate: today() });
    }

    await this.prisma.withPractice(practiceId, async (tx) => {
      /*
       * THE ENDURING DRAFT LEAVES THE LIST — through the capture module's own
       * API, never by editing its row. See the docstring: the draft itself is
       * evidence and stays exactly as it is.
       */
      await this.capture.cancelOpenFor(tx, agreement.id, 'episodic_offered_instead');
      await enqueueVaultEvent(tx, {
        type: 'agreement.episodic_offered_instead',
        actor: { principalType: 'staff', id: actor.id },
        subject: { type: 'Agreement', id: offered.agreementId },
        // AGREEMENT IDS AND NOTHING ELSE. Everything the new agreement says is
        // already on its own `agreement.created`,
        // `agreement.service_description_set` and `agreement.particulars_locked`
        // events; repeating it here would be two records of one fact.
        payload: {
          enduringAgreementId: agreement.id,
          offeredAgreementId: offered.agreementId,
        },
      });
    });

    return { agreementId: offered.agreementId, enduringAgreementId: agreement.id, reused: false };
  }

  /**
   * THE DRAFTING BOTH OFFERS SHARE — the same provider, the same patient, the
   * same party signing, and the practice's own words for the service.
   *
   * ONE COPY, TWO DOORS TO IT (Carl, 5 Sep 2026). `offerEpisodicAfterDecline`
   * answers the patient; `offerEpisodicInstead` answers a rule set that cannot
   * be asked. What follows differs — one pushes to the tablet the patient is
   * standing at, the other stops at reception's list — but what is CREATED is
   * one thing, and a second copy of "which provider, which assignor, which
   * description" is a second place for HARD-01 and D7 to be got wrong.
   *
   * IT IS A NEW AGREEMENT AND NOT A CONVERSION, and it could not be anything
   * else: the source is an ENDURING agreement — a standing commitment under
   * reg 65CB — and this is an episodic pre-agreement for one service under
   * s 65C(4). They have different content sets and different rendered
   * artefacts; turning one into the other by changing a column would produce
   * an agreement whose type does not match its own evidence.
   *
   * D6a IS CARRIED WHERE THERE IS ONE AND OTHERWISE LEFT UNSET, deliberately.
   * An enduring agreement has no basic service description (that is a
   * pre-agreement element, REQ-REG-01 D6a), so in practice the source is the
   * practice's own default. Guessing a description would put a word the
   * practice never chose onto a contract. It is written through the
   * service-descriptions module's API, which checks it against the CURRENT
   * versioned list (hard rule 14) and records who set it.
   */
  private async draftEpisodicInstead(
    practiceId: string,
    source: DbAgreement,
    practiceDefaultD6a: string | null,
    actor: Actor,
  ): Promise<{ agreementId: string; affiliationId: string; serviceDescription: string | null }> {
    if (source.type !== 'enduring') {
      throw new ConflictException('Only an ongoing agreement can be replaced by one for the visit.');
    }
    if (source.anchorKind !== 'provider' || !source.affiliationId) {
      throw pushRefusals.enduringNotPerProvider();
    }
    /*
     * Held once, after the guard: the SAME practitioner at the SAME location
     * carries onto the new agreement and onto its event (HARD-01 — a
     * replacement offer is the same provider seeing the same patient; a
     * different one would need its own consent). Since 7 September 2026 that
     * is the affiliation rather than the practice-wide provider row.
     */
    const affiliationId = source.affiliationId;

    // The agreements module owns its own table: the draft is created through
    // its API, which re-asserts the anchor and D7 rules and writes its own
    // `agreement.created` event.
    const replacement = await this.agreements.createDraft(
      practiceId,
      {
        type: 'episodic_pre',
        affiliationId,
        patientId: source.patientId,
        assignorId: source.assignorId,
        assignorIsPatient: source.assignorIsPatient,
      },
      /*
       * AND WHO IS SIGNING CARRIES WITH IT (Carl, 7 Sep 2026). Same patient,
       * same visit, same signer — reception answered that question for the
       * agreement this one is offered instead of, and the answer did not stop
       * being true when the patient said they would rather agree each visit.
       * Re-asking would mean pressing this button and being told to press
       * another about a question answered a second earlier.
       */
      {
        assignorConfirmedAt: source.assignorConfirmedAt,
        assignorConfirmedBy: source.assignorConfirmedBy,
      },
    );

    const candidate = source.serviceDescription ?? practiceDefaultD6a;
    const d6a = candidate && isServiceDescription(candidate) ? candidate : null;
    if (d6a) await this.serviceDescriptions.setFor(practiceId, replacement.id, d6a, actor);

    return { agreementId: replacement.id, affiliationId, serviceDescription: d6a };
  }

  /**
   * IS THERE ALREADY AN AGREEMENT OPEN FOR THIS VISIT? — the idempotency this
   * offer needs (named test `offer_episodic_instead_is_idempotent_per_visit`).
   *
   * "THIS VISIT" IS PROVIDER × PATIENT × TODAY, and "today" is read exactly as
   * `readPushableRows` reads it: the appointment's date where the agreement
   * has a booking, and the day the draft was created where it does not. A
   * second definition here would mean a row that this method thinks is
   * yesterday's and the waiting list thinks is today's.
   *
   * "OPEN" IS AN OPEN CAPTURE REQUEST, the same test the waiting list applies
   * — an agreement whose capture request was cancelled or completed has
   * nowhere left to go, and treating it as an answer would leave reception
   * pressing a button that returns a row they cannot see.
   */
  private async openEpisodicForVisit(
    practiceId: string,
    source: Pick<DbAgreement, 'affiliationId' | 'patientId'>,
  ): Promise<string | null> {
    if (!source.affiliationId) return null;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayIso = today();

    return this.prisma.withPractice(practiceId, async (tx) => {
      const candidates = await tx.agreement.findMany({
        where: {
          type: 'episodic_pre',
          affiliationId: source.affiliationId,
          patientId: source.patientId,
          status: { in: [...PUSHABLE_STATUSES] },
          signatureEventId: null,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (candidates.length === 0) return null;

      const appointments = await tx.appointment.findMany({
        where: { agreementId: { in: candidates.map((a) => a.id) } },
      });
      const appointmentByAgreement = new Map(
        appointments.filter((a) => a.agreementId).map((a) => [a.agreementId as string, a]),
      );

      for (const candidate of candidates) {
        const appointment = appointmentByAgreement.get(candidate.id);
        const forToday = appointment
          ? appointment.date.toISOString().slice(0, 10) === todayIso
          : candidate.createdAt >= startOfDay;
        if (!forToday) continue;
        const open = await tx.captureRequest.findFirst({
          where: { agreementId: candidate.id, status: 'open' },
        });
        if (open) return candidate.id;
      }
      return null;
    });
  }

  /**
   * HOW THE DISPUTE ENDED — the other half of the cross (Carl, 4 Sep 2026).
   *
   * WHY THE RECORD NEEDS THIS AT ALL. `tablet.details_disputed` says that at a
   * given moment the person the particulars are about looked at them and said
   * one was not theirs. On its own that is half a story, and the missing half
   * is the one somebody will actually ask about: was our record wrong, or was
   * the patient? Reception knows within seconds, and until now had nowhere to
   * put the answer.
   *
   * AND WITHOUT IT, "THE PATIENT WAS MISTAKEN" HAD TO BE FAKED AS A
   * CORRECTION. The only way out of a dispute was `PATCH /patients/:id/details`
   * — which writes `patient.details_corrected` — so a receptionist whose
   * record was right had to either re-save the same value (an event claiming a
   * change nobody made) or leave the cross hanging. Both are worse than a
   * second, honestly-named outcome.
   *
   * IT CHANGES NOTHING AND IT MUST NOT. Not the agreement, not the patient,
   * not the session's state or its disputed types: the cross is a fact and
   * facts are not edited (hard rule 11's instinct applied to a session row).
   * What follows is a re-send, which builds a FRESH session — and after
   * `patient_error` nothing was corrected, so `particularsCorrectedSince`
   * finds nothing and the SAME agreement goes out again, unsuperseded. That
   * falls out of `resend` as it stands rather than being arranged here, which
   * is the reason there is no special case for it.
   *
   * A STAFF ACTOR IS REQUIRED, like every other console act on this page. A
   * resolution nobody can be asked about is the shape this platform exists to
   * prevent (`SessionActor`'s own words).
   *
   * TYPES, NEVER VALUES (REQ-VER-04). The DTO has no field for one and this
   * method reads no patient row.
   */
  async resolveDispute(
    practiceId: string,
    sessionId: string,
    outcome: DisputeResolutionOutcome,
    details: string[],
    actor: Actor | undefined,
  ): Promise<{
    id: string;
    outcome: DisputeResolutionOutcome;
    details: ConfirmableDetailType[];
    resolvedAt: string;
    state: TabletSessionState;
  }> {
    if (!actor) throw pushRefusals.noActor();
    const resolved = [...new Set(details)] as ConfirmableDetailType[];

    return this.prisma.withPractice(practiceId, async (tx) => {
      // A cross-practice id finds nothing — RLS filters on the
      // transaction-local scope, so this fails closed rather than admitting
      // the session exists somewhere else.
      const session = await tx.tabletSession.findFirst({ where: { id: sessionId } });
      if (!session) throw new NotFoundException('That tablet session was not found.');

      /*
       * THERE MUST BE A DISPUTE TO RESOLVE. Recording an answer to a question
       * nobody asked would put an event in the vault that reads like evidence
       * of a conversation that never happened.
       */
      if (session.detailsDisputedTypes.length === 0) {
        throw new BadRequestException('This session has no disputed detail to resolve.');
      }

      /*
       * THE ROW AND THE EVENT, IN ONE TRANSACTION (hard rule 11, FR-11.2).
       * Neither is allowed to exist without the other: a row saying reception
       * answered with nothing in the vault to evidence it, or an event about a
       * row that never moved, are both worse than a refusal. The outbox insert
       * below is in this same `tx`, so a failure on either rolls back both —
       * which is what `resolved_dispute_persists_with_its_event` asserts by
       * making the event write fail and finding the columns still null.
       *
       * A SECOND RESOLUTION REPLACES THE FIRST. Reception may correct a detail
       * and then realise it was the patient's error after all. The columns hold
       * the LATEST answer and the outbox holds every one of them — the row is
       * state, the events are history, and that is the right way round.
       *
       * THE STATE DOES NOT MOVE. `details_disputed` stays: the cross happened,
       * and a resolution does not unhappen it. What follows is a re-send, which
       * builds a fresh session and leaves this one's resolution on it.
       *
       * A PRINCIPAL ID, NEVER A NAME, in the column. The display name goes on
       * the event, where an audit line needs to read; a name in a column goes
       * stale the moment somebody is renamed.
       */
      const resolvedAt = new Date();
      await tx.tabletSession.update({
        where: { id: session.id },
        data: {
          disputeResolution: outcome,
          disputeResolvedAt: resolvedAt,
          disputeResolvedByPrincipalId: actor.id,
        },
      });

      await enqueueVaultEvent(tx, {
        type: 'tablet.dispute_resolved',
        actor: { principalType: 'staff', id: actor.id },
        subject: { type: 'TabletSession', id: session.id },
        payload: {
          agreementId: session.agreementId,
          outcome,
          /*
           * WHAT THE PATIENT CROSSED, AND WHAT RECEPTION ANSWERED FOR — as
           * TYPES, joined into one string because a vault payload holds
           * scalars, and sorted so the same answer compares equal whichever
           * order the console listed them in.
           *
           * THE TWO LISTS ARE RECORDED SEPARATELY AND ARE ALLOWED TO DIFFER.
           * A patient who crossed their address while mentioning that their
           * mobile is also wrong leaves reception correcting two details
           * against one cross — and an event that folded the second into the
           * first would say the patient disputed something they ticked.
           */
          disputedTypes: [...session.detailsDisputedTypes].sort().join(','),
          resolvedTypes: [...resolved].sort().join(','),
          resolvedCount: resolved.length,
          resolvedBy: actor.name,
          /*
           * AND THE CONTRACT DID NOT MOVE. Closing a dispute settles what
           * reception does next, never what was agreed (hard rule 8,
           * REQ-REC-04) — the same statement, for the same reason, as the
           * dispute event that preceded it.
           */
          agreementChanged: false,
        },
      });

      return {
        id: session.id,
        outcome,
        details: resolved,
        resolvedAt: resolvedAt.toISOString(),
        // UNCHANGED, and stated rather than implied: a resolution is a fact
        // about the dispute, not a new state.
        state: session.state as TabletSessionState,
      };
    });
  }

  /** What is on the practice's tablets right now — states, never a mirror. */
  async list(practiceId: string, activeOnly: boolean): Promise<TabletSessionRow[]> {
    await this.settle(practiceId);
    const sessions = await this.prisma.withPractice(practiceId, (tx) =>
      tx.tabletSession.findMany({
        where: activeOnly ? { endedAt: null } : { pushedAt: { gte: new Date(Date.now() - 86_400_000) } },
        orderBy: { pushedAt: 'desc' },
      }),
    );
    return this.decorate(practiceId, sessions);
  }

  /**
   * TODAY'S PUSHABLE DRAFTS — the console's left-hand list.
   *
   * IT LISTS THE BLOCKED ONES TOO, and that is the whole point. Carl's own
   * live test on the walk-up kiosk (TODO.md, 4 Sep 2026) was a patient doing
   * work for nothing and a hand-over screen that named nobody, so reception
   * could not tell who needed fixing. A list that silently omitted the drafts
   * that cannot be pushed would reproduce that at the desk. Each row says
   * whether it can go and, if not, which rule is in the way — as a CODE the
   * console renders in its own words, never a rules-engine sentence.
   *
   * "TODAY" is the appointment's date, and for a walk-in with no booking it is
   * the day the draft was created. A patient at the desk this morning is not
   * looking for last Tuesday's draft.
   */
  async pushable(practiceId: string): Promise<PushableRow[]> {
    await this.settle(practiceId);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const rows = await this.readPushableRows(practiceId, startOfDay);

    /*
     * AND THEN THE ONE QUESTION THE ROWS CANNOT ANSWER THEMSELVES: has the
     * rule set's enduring branch been authored? (Carl, 4 Sep 2026; GA-PLAN B5.)
     *
     * ASKED ONCE PER LIST, NOT ONCE PER ROW, and OUTSIDE the transaction —
     * holding a database transaction across a network call is how a slow
     * dependency becomes a locked table, which is the same judgement
     * `prepareLock` makes about the rules service and the renderer.
     *
     * ASKED ONLY WHERE IT MATTERS. A practice with no enduring drafts on
     * screen never calls the rules service at all, and a row already blocked
     * for a permanent reason (not a GP, no single provider) keeps that reason:
     * telling somebody the rules are pending, when the real answer is that
     * this provider has no enduring pathway at all, would send them to wait
     * for something that will not help them.
     */
    const undecided = rows.filter((row) => row.agreementType === 'enduring' && row.pushable);
    if (undecided.length === 0) return rows;
    if (await this.agreements.enduringRulesAuthored()) return rows;
    for (const row of undecided) {
      row.pushable = false;
      row.blockedReason = 'enduring_rules_not_authored';
    }
    return rows;
  }


  /**
   * TODAY'S COVERED SERVICES — the quiet history line, never a Send (Carl,
   * 11 Sep 2026, step 4).
   *
   * A service the platform decided needs no second signature produces no draft,
   * so it can never appear on `pushable` — that list reads agreements and this
   * has none of its own. Leaving it invisible would mean reception seeing a
   * patient walk out with nothing on screen about them and no way to tell
   * "already covered" from "we forgot": exactly the "generic fallback message
   * is a defect" case (Carl, 4 Sep 2026).
   *
   * SO IT IS A SEPARATE READ AND A SEPARATE SHAPE. Nothing here is pushable,
   * nothing here has a blocked reason, and the row carries the id of the
   * agreement that COVERS it so the line can LINK to the answer rather than
   * assert it ("shortcuts to the answer", CLAUDE.md section 7).
   *
   * TODAY ONLY, on the same boundary `pushable` uses — the desk is a day's
   * work, and yesterday's covered visits are the reporting surface's business.
   *
   * A STAFF SURFACE, so the practice's own list of its own patients may carry a
   * name, exactly as every other console list does. No date of birth, no
   * address, no contact detail, no identifier — and no amount (hard rule 4):
   * there is no field for one and the service record holds none.
   */
  async coveredToday(practiceId: string): Promise<CoveredServiceRow[]> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return this.prisma.withPractice(practiceId, async (tx) => {
      const records = await tx.serviceRecord.findMany({
        where: {
          visitDecision: { in: ['covered', 'covered_by_enduring'] },
          serviceRenderedAt: { gte: startOfDay },
        },
        orderBy: { serviceRenderedAt: 'desc' },
        take: 50,
      });
      if (records.length === 0) return [];

      const patientIds = [...new Set(records.map((r) => r.patientId).filter((id): id is string => id !== null))];
      const patients = patientIds.length
        ? await tx.patient.findMany({
            where: { id: { in: patientIds } },
            select: { id: true, givenNames: true, familyName: true },
          })
        : [];
      const patientById = new Map(patients.map((p) => [p.id, p]));

      const anchors = await anchorsForAgreements(
        tx,
        records.map((r) => ({ id: r.id, affiliationId: r.affiliationId, providerId: r.providerId })),
      );

      return records.map((record) => {
        const patient = record.patientId ? patientById.get(record.patientId) : undefined;
        return {
          serviceRecordId: record.id,
          patientId: record.patientId,
          patientName: patient ? `${patient.givenNames} ${patient.familyName}` : null,
          providerName: anchors.get(record.id)?.name ?? null,
          serviceDate: record.serviceDate.toISOString().slice(0, 10),
          mbsItemNumbers: [...record.mbsItemNumbers],
          /** `covered` | `covered_by_enduring` — two different stories, two codes. */
          decision: record.visitDecision as CoveredServiceRow['decision'],
          /** The rule key that decided; the console renders it in its own words. */
          reason: record.decisionReason ?? '',
          /** Hard rule 14 — which table gave the answer. */
          policyVersion: record.policyVersion ?? '',
          /** What to LINK to. The database refuses a covered row without one. */
          coveringAgreementId: record.coveringAgreementId,
        } satisfies CoveredServiceRow;
      });
    });
  }

  /**
   * HAS THIS AGREEMENT MOVED PAST THE POINT A TABLET COULD MEAN ANYTHING?
   *
   * THE SAME TWO CONDITIONS `blockingReason` USES for
   * `agreement_not_pushable`, and deliberately not a third opinion: a row that
   * offered "Send again" and a server that refused it were the fault Carl found
   * on 7 Sep 2026, and two separate readings of "pushable" is how that comes
   * back. This one answers a narrower question — not "can it go now" (a
   * missing D6a blocks that, and is fixable) but "has it left" — so a draft
   * waiting on a service description still reads as work rather than history.
   */
  private outcomeOf(
    agreement: { status: string; signatureEventId: string | null } | undefined,
    /*
     * AND WHETHER SOMETHING HAS REPLACED IT (Carl's reproduction, 10 Sep
     * 2026). A supersession does not move the old agreement's status — there
     * is no `superseded` state in the lifecycle — so this ended session used
     * to keep offering "Send again" on an agreement that had been replaced,
     * and reception's next Save landed on the row the chain had left behind.
     * The caller supplies the fact because it is a second table; the reading
     * of it stays here, so the console and the endpoint keep ONE definition of
     * "has it left".
     */
    superseded = false,
  ): 'signed' | 'moved_on' | null {
    if (!agreement) return null;
    if (agreement.signatureEventId) return 'signed';
    if (superseded) return 'moved_on';
    if (!(PUSHABLE_STATUSES as readonly string[]).includes(agreement.status)) return 'moved_on';
    return null;
  }

  /** The rows themselves — one transaction, no network calls. See `pushable`. */
  private async readPushableRows(practiceId: string, startOfDay: Date): Promise<PushableRow[]> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const candidates = await tx.agreement.findMany({
        where: { status: { in: [...PUSHABLE_STATUSES] }, signatureEventId: null },
        orderBy: { createdAt: 'asc' },
      });
      if (candidates.length === 0) return [];

      const appointments = await tx.appointment.findMany({
        where: { agreementId: { in: candidates.map((a) => a.id) } },
      });
      const appointmentByAgreement = new Map(
        appointments.filter((a) => a.agreementId).map((a) => [a.agreementId as string, a]),
      );

      const todayIso = today();
      const dueToday = candidates.filter((agreement) => {
        const appointment = appointmentByAgreement.get(agreement.id);
        if (appointment) return appointment.date.toISOString().slice(0, 10) === todayIso;
        return agreement.createdAt >= startOfDay;
      });
      if (dueToday.length === 0) return [];

      /*
       * ONE ROW PER AGREEMENT WITH SOMEWHERE LEFT TO GO. A retried draft can
       * leave TWO agreement rows behind a single visit — the first attempt's
       * in-practice capture request timed out or was cancelled, and a fresh
       * one was opened for the same patient. Both would satisfy "today" and
       * "unsigned", and the stale one has no path to a signature any more: its
       * capture request is closed and nothing will ever open it again. So it
       * is excluded here rather than merely outranked — an agreement stays a
       * candidate only while it has an OPEN capture request, or has none yet
       * (a draft nobody has tried to capture at all).
       */
      const captureRequests = await tx.captureRequest.findMany({
        where: { agreementId: { in: dueToday.map((a) => a.id) } },
      });
      const hasAnyCapture = new Set(captureRequests.map((r) => r.agreementId));
      const hasOpenCapture = new Set(captureRequests.filter((r) => r.status === 'open').map((r) => r.agreementId));
      /*
       * AND NEVER THE ONE THAT HAS BEEN REPLACED (Carl's reproduction, 10 Sep
       * 2026). A superseded agreement keeps its own status — there is no
       * `superseded` state in the lifecycle, and `supersedeForCorrection`
       * explains why — so the fact lives where it is true: another agreement
       * pointing back at this one. Its capture requests are closed on
       * supersession, which already removes it from this list in the ordinary
       * case, but "no capture request at all" and "closed" are different rows
       * here and only one of them was covered. Reading the successor makes the
       * exclusion a property of the CHAIN rather than of a side-effect, so
       * reception is always editing the newest agreement for the visit: a
       * second "Who is signing" Save lands on a row that is still live and
       * writes, instead of being refused as having moved on.
       */
      const successors = await tx.agreement.findMany({
        where: { supersedesAgreementId: { in: dueToday.map((a) => a.id) } },
        select: { supersedesAgreementId: true },
      });
      const superseded = new Set(
        successors.map((s) => s.supersedesAgreementId).filter((id): id is string => id !== null),
      );
      const forToday = dueToday.filter(
        (agreement) =>
          !superseded.has(agreement.id)
          && (!hasAnyCapture.has(agreement.id) || hasOpenCapture.has(agreement.id)),
      );
      if (forToday.length === 0) return [];

      const patients = await tx.patient.findMany({
        where: { id: { in: forToday.map((a) => a.patientId) } },
      });
      const patientById = new Map(patients.map((p) => [p.id, p]));
      /*
       * WHO EACH AGREEMENT NAMES, RESOLVED ONCE FOR THE WHOLE LIST -- the
       * practitioner at a location, with their discipline and their billing
       * role. `blockingReason` is synchronous and is called per row (it must
       * stay so), and a day's queue is a handful of practitioners, so the
       * lookup happens here rather than becoming a query per line.
       */
      const anchorByAgreement = await anchorsForAgreements(tx, forToday);
      /*
       * THE SERVICE BEHIND A POST-AGREEMENT — D5 and D6b (Carl, 11 Sep 2026).
       * Read for the whole list in one query rather than per row, exactly as
       * the anchors are: a day's desk is a handful of services, and
       * `blockingReason` must stay synchronous.
       */
      const services = await tx.serviceRecord.findMany({
        where: { agreementId: { in: forToday.map((a) => a.id) } },
      });
      const serviceByAgreement = new Map(
        services.filter((s) => s.agreementId).map((s) => [s.agreementId as string, s]),
      );
      const assignors = await tx.assignor.findMany({
        where: { id: { in: forToday.map((a) => a.assignorId) } },
      });
      const assignorById = new Map(assignors.map((a) => [a.id, a]));
      const live = await tx.tabletSession.findMany({ where: { endedAt: null } });
      const sessionByAgreement = new Map(live.map((s) => [s.agreementId, s]));
      /*
       * THE DESK IS ORDERED BY WHEN THE PATIENT ARRIVED (Carl, 11 Sep 2026).
       *
       * HIS REPORT: "when updating the patient card with who is signing, it
       * saves correctly but loses its place in the list on the page." A party
       * change supersedes rather than edits (D-2026-09-11-01), so the Save
       * creates a NEW agreement with `now()` for its `createdAt`; this list
       * used to order on that column, so the card left where reception was
       * looking and reappeared at the very bottom of the queue.
       *
       * THE COLUMN WAS THE BUG, not the supersession. This is a picture of who
       * is waiting in the room, and the person who has been there longest
       * belongs at the top. `Agreement.createdAt` answers "when did we draft
       * the paperwork", which supersession is entitled to change; the arrival
       * answers "when did this patient turn up", which nothing on this screen
       * may change. So the arrival is what it sorts on.
       *
       * AND THE ARRIVAL IS FOUND THROUGH THE CHAIN. `Arrival.agreementId`
       * points at the agreement drafted when the patient walked in — the HEAD
       * of the chain — and a successor is a different row that no arrival has
       * ever named. Reading only the row's own arrival would therefore fix
       * nothing: every superseded card would still fall to the fallback and
       * still jump. So each agreement is walked back through
       * `supersedesAgreementId` to its origin, and the whole chain's earliest
       * arrival is its place in the queue.
       */
      const ancestorCreatedAt = new Map<string, Date>();
      const parentOf = new Map<string, string>();
      for (const agreement of forToday) {
        if (agreement.supersedesAgreementId) parentOf.set(agreement.id, agreement.supersedesAgreementId);
      }
      /*
       * WALKING BACK PAST ROWS THAT HAVE LEFT THIS LIST. A superseded agreement
       * is excluded from `forToday` above, so its `supersedesAgreementId` is not
       * in the map yet and a two-hop chain (A <- B <- C) would stop at B. Each
       * pass reads the ancestors the last one discovered; the loop is bounded so
       * a cycle — impossible through the `agreements_one_successor` index, but
       * cheap to rule out — cannot hang the desk.
       */
      let frontier = [...parentOf.values()].filter((id) => !parentOf.has(id));
      for (let hop = 0; hop < 16 && frontier.length > 0; hop += 1) {
        const ancestors = await tx.agreement.findMany({
          where: { id: { in: frontier } },
          select: { id: true, supersedesAgreementId: true, createdAt: true },
        });
        for (const a of ancestors) {
          if (a.supersedesAgreementId) parentOf.set(a.id, a.supersedesAgreementId);
          ancestorCreatedAt.set(a.id, a.createdAt);
        }
        frontier = ancestors
          .map((a) => a.supersedesAgreementId)
          .filter((id): id is string => id !== null && !parentOf.has(id) && !ancestorCreatedAt.has(id));
      }
      /** Every id in an agreement's chain, itself first, oldest last. */
      const chainOf = (id: string): string[] => {
        const chain = [id];
        let current = id;
        for (let hop = 0; hop < 16; hop += 1) {
          const parent = parentOf.get(current);
          if (!parent || chain.includes(parent)) break;
          chain.push(parent);
          current = parent;
        }
        return chain;
      };
      const everyChainId = [...new Set(forToday.flatMap((a) => chainOf(a.id)))];
      const arrivals = await tx.arrival.findMany({
        where: { agreementId: { in: everyChainId } },
        select: { agreementId: true, arrivedAt: true },
      });
      const arrivedAtByAgreement = new Map(
        arrivals
          .filter((a): a is typeof a & { agreementId: string } => a.agreementId !== null)
          .map((a) => [a.agreementId, a.arrivedAt]),
      );
      /*
       * THE FALLBACK IS THE ORIGIN'S OWN `createdAt`, NEVER THE SUCCESSOR'S.
       * Not every agreement on this desk came from an arrival — a post-service
       * agreement is drafted after the visit, and a dev script writes some with
       * no arrival at all — so a fallback is needed. Taking it from the HEAD of
       * the chain keeps the fix whole: an agreement with no arrival that is then
       * superseded still holds the position it had, because both rows resolve to
       * the same origin.
       */
      const placeInQueue = (agreement: (typeof forToday)[number]): number => {
        const chain = chainOf(agreement.id);
        const arrived = chain
          .map((id) => arrivedAtByAgreement.get(id))
          .filter((d): d is Date => d !== undefined)
          .map((d) => d.getTime());
        if (arrived.length > 0) return Math.min(...arrived);
        const origin = chain[chain.length - 1];
        const originCreated = origin === agreement.id ? agreement.createdAt : ancestorCreatedAt.get(origin);
        return (originCreated ?? agreement.createdAt).getTime();
      };
      /*
       * A STABLE TIE-BREAK. Two patients can share an arrival time to the
       * millisecond in a seeded database, and a list whose order flickers
       * between three-second polls is its own defect. The agreement id is
       * arbitrary but it is the SAME arbitrary answer every read.
       */
      const sortedForToday = [...forToday].sort((a, b) => {
        const byArrival = placeInQueue(a) - placeInQueue(b);
        return byArrival !== 0 ? byArrival : a.id.localeCompare(b.id);
      });

      const rows: PushableRow[] = [];
      for (const agreement of sortedForToday) {
        const patient = patientById.get(agreement.patientId);
        if (!patient) continue;
        const anchor = anchorByAgreement.get(agreement.id);
        const assignor = assignorById.get(agreement.assignorId);
        const appointment = appointmentByAgreement.get(agreement.id);
        const service = serviceByAgreement.get(agreement.id);
        const session = sessionByAgreement.get(agreement.id);

        const blocked = this.blockingReason({
          agreement,
          assignorName: assignor?.name ?? null,
          confidential: patient.confidentialityFlag,
          providerType: anchor?.providerType ?? null,
          billingRole: anchor ? anchor.billingRole : null,
        });

        // The same D6a read `lockParticulars` does, and the same one
        // `computeSignability` documents: the column while the draft is
        // still open, falling back to the locked snapshot once it is not
        // (`basicServiceDescriptionOf`, the domain's one copy). A locked
        // agreement whose description arrived
        // through the lock's own DTO, rather than the staff surface that
        // writes the column, must still show as set here.
        const d6a = basicServiceDescriptionOf(agreement);

        rows.push({
          agreementId: agreement.id,
          agreementType: agreement.type as AgreementType,
          status: agreement.status,
          // A staff surface: the practice's own list of its own patients, the
          // same shape every other console list uses.
          patientName: `${patient.givenNames} ${patient.familyName}`,
          patientId: patient.id,
          providerName: anchor?.name ?? null,
          providerType: anchor?.providerType ?? null,
          appointmentDate: appointment ? appointment.date.toISOString().slice(0, 10) : null,
          appointmentTime: appointment?.time ?? null,
          serviceDescription: d6a ?? null,
          serviceDescriptionValid: d6a ? isServiceDescription(d6a) : false,
          /*
           * D5 AND D6b, OFF THE SERVICE THIS AGREEMENT WAS MADE FOR. Present
           * only where there is one, which in practice means only on a
           * post-agreement: a pre-agreement is drafted from an arrival, before
           * anything has been billed.
           */
          serviceDate: service ? service.serviceDate.toISOString().slice(0, 10) : null,
          mbsItemNumbers: service ? [...service.mbsItemNumbers] : [],
          assignorIsPatient: agreement.assignorIsPatient,
          assignorName: agreement.assignorIsPatient ? null : (assignor?.name ?? null),
          assignorRelationship: agreement.assignorIsPatient
            ? null
            : (assignor?.relationshipToPatient ?? null),
          // The SAME branch the name and the relationship take, off the SAME
          // assignor record — so a row can never show a third party's contact
          // beside "the patient is signing".
          assignorMobile: agreement.assignorIsPatient ? null : (assignor?.contactMobile ?? null),
          assignorEmail: agreement.assignorIsPatient ? null : (assignor?.contactEmail ?? null),
          particularsLocked: agreement.particularsLockedAt !== null,
          assignorConfirmedAt: agreement.assignorConfirmedAt
            ? agreement.assignorConfirmedAt.toISOString()
            : null,
          pushable: blocked === null,
          blockedReason: blocked,
          activeSession: session
            ? { id: session.id, deviceId: session.deviceId, state: session.state as TabletSessionState }
            : null,
        });
      }
      return rows;
    });
  }

  // -------------------------------------------------------------------------
  // The tablet
  // -------------------------------------------------------------------------

  /**
   * THE ONE SESSION THIS TABLET IS SHOWING, or none.
   *
   * WHY THIS PAYLOAD CARRIES VALUES WHEN THE WALK-UP WAITING LIST CARRIES NONE.
   * The justification is specific rather than general, and every part of it is
   * enforced somewhere:
   *
   *   - THE DEVICE IS PAIRED to this practice. The guard resolved the practice
   *     from an opaque credential the console issued and can revoke; a client
   *     `x-practice-id` is deleted on `/kiosk/*` before anything reads it.
   *   - THE SESSION WAS PUSHED BY A NAMED STAFF MEMBER who has, seconds
   *     earlier, checked this person's Medicare card in the PMS and asked them
   *     their date of birth, mobile, email and address across the desk. The
   *     push refuses without that person's identity and records it.
   *   - THE READER IS THE SUBJECT. Reception hands the tablet to the patient it
   *     was pushed for. This is the one screen in the product where showing a
   *     date of birth means showing somebody their own, at the moment they
   *     were asked for it — and asking them to confirm it is a data-accuracy
   *     check they are uniquely placed to answer.
   *   - ONE SESSION PER DEVICE, as a partial unique index, so the previous
   *     patient's details cannot still be on the screen.
   *   - THIRTY MINUTES AND IT IS GONE, so a tablet nobody is standing at is
   *     showing nothing.
   *
   * NO MEDICARE NUMBER, ANYWHERE. There is no column for one in this system
   * and no field for one in the payload; the card is checked in the PMS before
   * the platform is involved, and it is not an identity identifier in any case
   * (hard rule 1, REQ-VER-02). Named test:
   * `session_payload_never_carries_a_medicare_number`.
   *
   * NO BENEFIT AND NO DOLLAR AMOUNT (hard rule 4). Nothing here could carry one.
   */
  async currentFor(device: ResolvedDevice): Promise<{ session: TabletSessionPayload | null }> {
    await this.settle(device.practiceId);

    const found = await this.prisma.withPractice(device.practiceId, async (tx) => {
      const session = await tx.tabletSession.findFirst({
        where: { deviceId: device.deviceId, endedAt: null },
      });
      if (!session) return null;

      const agreement = await tx.agreement.findFirst({ where: { id: session.agreementId } });
      if (!agreement) return null;
      const patient = await tx.patient.findFirst({ where: { id: agreement.patientId } });
      if (!patient) return null;
      const assignor = await tx.assignor.findFirst({ where: { id: agreement.assignorId } });
      /*
       * HAS THIS PERSON ALREADY TICKED THEIR DETAILS TODAY, IN A PUSHED SESSION
       * AT THIS PRACTICE? (Carl, 11 Sep 2026 — the post-service second push.)
       *
       * THE SERVER ANSWERS IT, not the tablet (REQ-DATA-11). Matched on the
       * PATIENT rather than the agreement, because the whole point is that this
       * is a SECOND agreement for the same visit; scoped to today, because
       * yesterday's address is not evidence about today's; and refused where the
       * earlier session DISPUTED anything, because a crossed row is exactly the
       * case where the details must be asked about again.
       *
       * RLS scopes the read to this practice, so "at this practice" is enforced
       * at the database rather than remembered here.
       */
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const samePatientToday = await tx.agreement.findMany({
        where: { patientId: agreement.patientId },
        select: { id: true },
      });
      const confirmedToday = await tx.tabletSession.findFirst({
        where: {
          agreementId: { in: samePatientToday.map((a) => a.id) },
          detailsConfirmedAt: { gte: startOfDay },
          detailsDisputedAt: null,
        },
        select: { id: true },
      });
      return { session, agreement, patient, assignor, detailsConfirmedToday: confirmedToday !== null };
    });

    if (!found) return { session: null };
    const { session, agreement, patient, assignor } = found;

    return {
      session: {
        id: session.id,
        state: session.state as TabletSessionPayload['state'],
        agreementType: agreement.type as AgreementType,
        /*
         * PROJECTED, NOT SPREAD. `projectTabletSessionPatient` takes only the
         * six permitted fields out of whatever it is handed, so an IHI, a
         * patient record number or a confidentiality flag cannot reach a
         * tablet even if somebody passes a whole patient row in later. The
         * same construction, and the same reason, as the waiting list's own
         * projection.
         */
        patient: projectTabletSessionPatient({
          ...patient,
          dateOfBirth: patient.dateOfBirth.toISOString().slice(0, 10),
        }),
        /*
         * OUR OWN ID FOR THE RECORD, so the tablet's footer can name it and a
         * support call or a test run can match what is on the tablet to what
         * reception is looking at (Carl, 7 Sep 2026). Deliberately OUTSIDE the
         * projection above: that projection exists to let only the six
         * permitted DETAIL fields through, and an opaque row id is not one of
         * them — it is the same kind of thing as the session id beside it.
         */
        patientId: patient.id,
        assignor: agreement.assignorIsPatient
          ? { isPatient: true }
          : {
              isPatient: false,
              name: assignor?.name ?? '',
              relationship: assignor?.relationshipToPatient ?? '',
            },
        /*
         * WHETHER THE CEREMONY STILL OWES K-P1. Decided here and stated on the
         * payload, so the tablet renders an answer rather than reaching one.
         */
        detailsCheck: found.detailsConfirmedToday ? 'confirmed_today' : 'required',
        agreementId: agreement.id,
        // Passed straight back to the EXISTING `POST /agreements/:id/sign`.
        captureRequestId: session.captureRequestId ?? '',
      },
    };
  }

  /**
   * THE TICKS — "these particulars are correct", recorded as TYPES.
   *
   * IT IS A DATA-ACCURACY CHECK AND NOT A VERIFICATION, and the naming says so
   * everywhere it can: the endpoint, the state, the column and the vault event
   * all read `details_confirmed` rather than anything with "verified" in it.
   * The reason does not change indoors (TODO.md, 4 Sep 2026): a displayed
   * value confirmed by whoever holds the tablet proves nothing about who is
   * holding it. If reception has verified, the ticks add no evidence; if it
   * has not, they do not substitute. What they DO add is a record that the
   * person was shown their particulars and said they were right, which is part
   * of the agreement ceremony.
   *
   * TYPES, NEVER VALUES (REQ-VER-04). The DTO has no field that could carry a
   * value and the database CHECK constraint refuses any word outside the five.
   * Two of the five — `mobile` and `email` — are CONTACT details and are never
   * counted as identifiers (REQ-VER-02).
   */
  async confirmDetails(
    device: ResolvedDevice,
    sessionId: string,
    confirmed: string[],
    disputed: string[] = [],
  ): Promise<{
    id: string;
    state: TabletSessionState;
    confirmed: ConfirmableDetailType[];
    disputed: ConfirmableDetailType[];
  }> {
    const ticked = [...new Set(confirmed)] as ConfirmableDetailType[];
    const crossed = [...new Set(disputed)] as ConfirmableDetailType[];

    /*
     * TICKED OR CROSSED, NEVER BOTH. A record saying the patient agreed AND
     * disagreed about their address is not a record of anything, and the
     * database refuses it too (`tablet_sessions_answers_disjoint`) so this
     * cannot be got round by another caller.
     */
    const both = ticked.filter((type) => crossed.includes(type));
    if (both.length > 0) {
      throw new BadRequestException('A detail is either right or wrong, never both.');
    }

    return this.prisma.withPractice(device.practiceId, async (tx) => {
      const session = await this.requireDeviceSession(tx, device, sessionId);

      /*
       * ONE CROSS ENDS THE TABLET'S PART IN IT (Carl, 4 Sep 2026).
       *
       * THIS REVERSES WHAT THIS METHOD USED TO ALLOW, and the reversal is the
       * ruling. It used to accept a second answer on a disputed session —
       * reasoning that a patient who crosses a second row should extend the
       * list, and one who changes their mind should be able to tick it after
       * all. Carl's ruling from live testing is that the moment a cross
       * reaches reception the SCREEN IS DISABLED: the patient is told to wait,
       * and the only route forward is reception's re-send, which builds a
       * fresh session. A screen that kept accepting answers after reception
       * had been called would let the record move under the person who is
       * already acting on it.
       *
       * THE UI HALF IS THE TABLET'S; THIS IS THE OTHER HALF. "Blocked states
       * are unreachable, not merely inert" (CLAUDE.md §6) is only true when
       * the server refuses as well — a control disabled on glass is a
       * suggestion.
       *
       * IT WRITES NOTHING AND EMITS NOTHING. The refusal happens before the
       * update and before the event, so a locked-out device cannot add to the
       * evidence by retrying.
       *
       * 409 AND A CODE, because this is a thing that exists and is in the
       * wrong state rather than a malformed request — the same judgement
       * `push-refusal.ts` makes at length. The ENDED states below keep the
       * refusal they have always had: they were already refused, nothing about
       * them changed today, and giving them a new status would move a
       * contract nobody asked to move.
       */
      if (session.state === 'details_disputed') {
        throw new ConflictException({
          statusCode: 409,
          message:
            'A detail on this session is with reception. Ask them to send the agreement again.',
          reason: 'session_disputed',
        });
      }

      const to: TabletSessionState = crossed.length > 0 ? 'details_disputed' : 'details_confirmed';
      /*
       * SAYING THE SAME THING TWICE IS NOT AN ERROR, on the confirmed side. The
       * tablet posts whenever the answers change, so a repeat of an
       * all-ticked answer must not fail. The update below is what carries it;
       * an ENDED session is refused here, and a DISPUTED one above.
       */
      if (session.state !== to && !canChangeTabletSessionState(session.state, to)) {
        throw new BadRequestException(sessionIsOver());
      }
      if (session.endedAt) throw new BadRequestException(sessionIsOver());

      /*
       * EVERY ROW THE TABLET DREW HAS AN ANSWER, CHECKED HERE AND NOT TAKEN ON
       * TRUST. The server knows which rows it sent — a detail it holds nothing
       * for is not drawn, because nobody is shown a blank line and asked
       * whether it is correct — so it can tell a complete answer from a
       * partial one. A session recorded as `details_confirmed` having answered
       * three of five rows would be a ceremony record that says more than
       * happened (REQ-REG-06's instinct, applied to the ceremony rather than
       * to the contract).
       */
      const agreement = await tx.agreement.findFirst({ where: { id: session.agreementId } });
      const patient = agreement
        ? await tx.patient.findFirst({ where: { id: agreement.patientId } })
        : null;
      if (patient) {
        const shown = shownDetailTypesFor(
          projectTabletSessionPatient({
            ...patient,
            dateOfBirth: patient.dateOfBirth.toISOString().slice(0, 10),
          }),
        );
        const answered = new Set<string>([...ticked, ...crossed]);
        const unanswered = shown.filter((type) => !answered.has(type));
        const unknown = [...answered].filter((type) => !(shown as readonly string[]).includes(type));
        if (unanswered.length > 0 || unknown.length > 0) {
          // The TYPES are safe to name back — that is the whole vocabulary of
          // this endpoint — and naming them is what makes a client bug
          // findable rather than mysterious.
          throw new BadRequestException(
            `Every detail shown must be answered exactly once. Expected: ${shown.join(', ')}.`,
          );
        }
      }

      const now = new Date();
      const updated = await tx.tabletSession.update({
        where: { id: session.id },
        data: {
          state: to,
          detailsConfirmedTypes: ticked,
          detailsConfirmedAt: ticked.length > 0 ? now : null,
          detailsDisputedTypes: crossed,
          detailsDisputedAt: crossed.length > 0 ? now : null,
          lastStateAt: now,
        },
      });

      await enqueueVaultEvent(tx, {
        /*
         * A DISPUTE IS ITS OWN EVENT, not a flag on the confirmation. Somebody
         * will be asked about it later: at this moment the person the
         * particulars are about looked at them and said one or more were not
         * theirs. Filing that inside a "details confirmed" event would bury the
         * one fact worth finding.
         *
         * NEITHER IS NAMED `verification.*`. See above — a value displayed on a
         * tablet and answered by whoever holds it proves nothing about who is
         * holding it.
         */
        type: crossed.length > 0 ? 'tablet.details_disputed' : 'tablet.details_confirmed',
        actor: { principalType: 'device', id: device.deviceId },
        subject: { type: 'TabletSession', id: session.id },
        payload: {
          agreementId: session.agreementId,
          /*
           * THE TYPES, never the values behind them (REQ-VER-04) — and on the
           * dispute event, never what the patient believes the right value to
           * be either: they were not asked, and the tablet has no field to
           * take it. Joined into one string because a vault payload holds
           * scalars, and sorted so the same answers compare equal whichever
           * order the tablet listed them in.
           */
          confirmedTypes: [...ticked].sort().join(','),
          confirmedCount: ticked.length,
          disputedTypes: [...crossed].sort().join(','),
          disputedCount: crossed.length,
          /*
           * STATED ON THE RECORD, because it is the single most likely thing
           * for somebody to misread later. This is a DATA-ACCURACY check by
           * whoever was holding the tablet; the identity check was the staff
           * check across the desk, recorded on its own event (REQ-VER-03).
           */
          isVerification: false,
          /*
           * AND THE CONTRACT DID NOT MOVE. A cross stops the ceremony and
           * changes nothing about the agreement — reception corrects the
           * detail and sends it again, or bills privately after the service
           * (hard rule 8, REQ-REC-04).
           */
          agreementChanged: false,
        },
      });

      return {
        id: updated.id,
        state: updated.state as TabletSessionState,
        confirmed: ticked,
        disputed: crossed,
      };
    });
  }

  /**
   * THE TABLET SAYS WHAT IT IS SHOWING — reading, that the person left, or
   * that its own inactivity clock ended the session with nobody there.
   *
   * `walked_away` IS THE EXIT BUTTON, and `timed_out` IS THE CLOCK
   * (`useInactivityReset`, Carl 4 Sep 2026) — a pushed session the tablet's
   * own five-minute-by-default timer ended with no request from the patient
   * at all. BOTH change NOTHING on the agreement. That is hard rule 8 in one
   * line: a patient who declines a screen, or who is no longer at it, is
   * still seen, and reception chooses a private bill or an episodic agreement
   * after the service (REQ-CHASE-07). Named tests:
   * `walked_away_changes_nothing_on_the_agreement`,
   * `timed_out_ends_the_session_and_changes_nothing_on_the_agreement`.
   */
  async setState(
    device: ResolvedDevice,
    sessionId: string,
    state: 'reading' | 'walked_away' | 'timed_out' | 'declined_enduring' | 'signature_failed',
    /**
     * ONLY `signature_failed` CARRIES ONE, and it is the SERVER'S OWN CODE
     * echoed back rather than a diagnosis the tablet composed (Carl, 7 Sep
     * 2026). The device is reporting the answer it was given.
     */
    reason?: string,
  ): Promise<{ id: string; state: TabletSessionState }> {
    if (
      state === 'walked_away' ||
      state === 'timed_out' ||
      state === 'declined_enduring' ||
      state === 'signature_failed'
    ) {
      const ended = await this.end(
        device.practiceId,
        sessionId,
        state,
        { principalType: 'device', id: device.deviceId },
        device.deviceId,
        state === 'signature_failed' ? (reason ?? 'other') : undefined,
      );
      return { id: ended.id, state: ended.state as TabletSessionState };
    }

    return this.prisma.withPractice(device.practiceId, async (tx) => {
      const session = await this.requireDeviceSession(tx, device, sessionId);
      if (session.state === 'reading') return { id: session.id, state: 'reading' as TabletSessionState };
      if (!canChangeTabletSessionState(session.state, 'reading')) {
        throw new BadRequestException(sessionIsOver());
      }
      const updated = await tx.tabletSession.update({
        where: { id: session.id },
        data: { state: 'reading', lastStateAt: new Date() },
      });
      await enqueueVaultEvent(tx, {
        type: 'tablet.session_state_changed',
        actor: { principalType: 'device', id: device.deviceId },
        subject: { type: 'TabletSession', id: session.id },
        payload: { from: session.state, to: 'reading', agreementId: session.agreementId },
      });
      return { id: updated.id, state: updated.state as TabletSessionState };
    });
  }

  // -------------------------------------------------------------------------
  // Housekeeping
  // -------------------------------------------------------------------------

  /**
   * BRING THE SESSION TABLE UP TO DATE BEFORE ANYBODY READS IT — signed
   * sessions closed, stale ones expired.
   *
   * ON READ RATHER THAN ON A CROSS-PRACTICE SWEEP, deliberately. The capture
   * expiry sweep needs a SECURITY DEFINER function because it must cross every
   * tenant under FORCE RLS; this does not, because every path that can OBSERVE
   * a session or be BLOCKED by one runs through here first, inside that
   * practice's own scope — the tablet polling for its session, the console
   * listing them, and the push asking whether a device is free. A session
   * nobody is looking at and nothing is waiting on costs nothing by staying a
   * row until somebody does. That is the whole of the reasoning, and it is why
   * there is no scheduled job here to go wrong at three in the morning.
   *
   * SIGNING CLOSES THE SESSION WITHOUT THE SIGN PATH KNOWING THIS EXISTS. The
   * signature is recorded by the EXISTING `POST /agreements/:id/sign` against
   * the session's own capture request; the truth about whether it happened is
   * the agreement's `signatureEventId`, and that is what is read here. The
   * alternative — a hook inside the signature-storage path — would put a
   * dependency on this module into the most sensitive code in the product, and
   * a circular one at that.
   */
  private async settle(practiceId: string): Promise<void> {
    const cutoff = new Date(Date.now() - TABLET_SESSION_IDLE_MS);

    await this.prisma.withPractice(practiceId, async (tx) => {
      const active = await tx.tabletSession.findMany({ where: { endedAt: null } });
      if (active.length === 0) return;

      const agreements = await tx.agreement.findMany({
        where: { id: { in: active.map((s) => s.agreementId) } },
      });
      const signed = new Set(agreements.filter((a) => a.signatureEventId !== null).map((a) => a.id));

      /*
       * A SESSION WHOSE CHANNEL HAS CLOSED IS OVER (Carl, 7 Sep 2026 —
       * "who is signing" on a locked row).
       *
       * A supersession cancels every open capture request on the agreement it
       * replaces, on every channel at once, because nothing may still be
       * signed against particulars that have been corrected (HARD-02;
       * `AgreementsService.supersedeForAssignorChange` and `resend`'s
       * correction both do it). A tablet still showing that agreement has
       * nowhere left to sign: `POST /agreements/:id/sign` would refuse it, so
       * leaving the screen up would hand a patient a control that can only
       * fail — and would hold the device against the replacement that reception
       * needs to send.
       *
       * ENDED AS `recalled`, WHICH IS WHAT HAPPENED. A person at the desk did
       * something that took the screen back; it is not an expiry (no clock ran
       * out) and not a walk-away (nobody left). Nothing on the agreement is
       * touched here — this method has no `tx.agreement` write and must never
       * have one — and the patient is still seen either way (hard rule 8,
       * REQ-REC-04).
       *
       * SIGNED WINS, and the order below says so: a session whose request was
       * COMPLETED by the signature it just collected is `signed`, never
       * `recalled`.
       */
      const requestIds = active
        .map((s) => s.captureRequestId)
        .filter((id): id is string => id !== null);
      const closedRequests = requestIds.length
        ? new Set(
            (
              await tx.captureRequest.findMany({
                where: { id: { in: requestIds }, status: 'cancelled' },
                select: { id: true },
              })
            ).map((r) => r.id),
          )
        : new Set<string>();

      for (const session of active) {
        const to: TabletSessionState | null = signed.has(session.agreementId)
          ? 'signed'
          : session.captureRequestId && closedRequests.has(session.captureRequestId)
            ? 'recalled'
            : session.lastStateAt <= cutoff
              ? 'expired'
              : null;
        if (!to) continue;

        await tx.tabletSession.update({
          where: { id: session.id },
          data: { state: to, endedAt: new Date(), lastStateAt: new Date() },
        });
        await enqueueVaultEvent(tx, {
          type: 'tablet.session_ended',
          /*
           * THE SYSTEM ENDED IT, and saying so is more honest than attributing
           * an expiry to the last person who touched the screen. Who signed is
           * on the signature event, which is where that question belongs.
           */
          actor: { principalType: 'system', id: 'core' },
          subject: { type: 'TabletSession', id: session.id },
          payload: {
            from: session.state,
            to,
            agreementId: session.agreementId,
            agreementChanged: false,
            // WHY, where the answer is not the clock. A reader asking "why did
            // that tablet clear" gets it here rather than having to join two
            // events by hand.
            ...(to === 'recalled' ? { reason: 'capture_request_cancelled' } : {}),
          },
        });
      }
    });
  }

  /**
   * End a session. ONE PLACE, so that "ending changes nothing on the
   * agreement" is a property of the code rather than of three callers
   * remembering it. There is no `tx.agreement` write anywhere in this method
   * and there must never be one.
   *
   * `timed_out` RUNS THROUGH HERE TOO (Carl, 4 Sep 2026), exactly the same
   * path as `walked_away` — same idempotency, same one-session-per-device
   * ownership check, same `agreementChanged: false` on the vault event. Only
   * the stored `state` differs, which is the whole of the feature: reception
   * reads a different word for the same outcome.
   */
  private async end(
    practiceId: string,
    sessionId: string,
    to: 'walked_away' | 'timed_out' | 'recalled' | 'declined_enduring' | 'signature_failed',
    actor: { principalType: string; id: string },
    deviceId?: string,
    /** `signature_failed` only — the refusing server's own code (Carl, 7 Sep 2026). */
    signatureFailureReason?: string,
  ): Promise<TabletSession> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const session = await tx.tabletSession.findFirst({ where: { id: sessionId } });
      if (!session) throw new NotFoundException('That tablet session was not found.');
      // A device may only end its OWN session. Reception may end any of this
      // practice's, which is what recall is for.
      if (deviceId && session.deviceId !== deviceId) {
        throw new NotFoundException('That tablet session was not found.');
      }
      // Idempotent: asking for the state it is already in is not an event, and
      // a second Recall press must not look like a failure.
      if (session.endedAt) return session;
      if (!canChangeTabletSessionState(session.state, to)) {
        throw new BadRequestException(sessionIsOver());
      }

      const ended = await tx.tabletSession.update({
        where: { id: session.id },
        data: {
          state: to,
          endedAt: new Date(),
          lastStateAt: new Date(),
          ...(to === 'signature_failed' ? { signatureFailureReason: signatureFailureReason ?? 'other' } : {}),
        },
      });
      await enqueueVaultEvent(tx, {
        type: 'tablet.session_ended',
        actor,
        subject: { type: 'TabletSession', id: session.id },
        payload: {
          from: session.state,
          to,
          agreementId: session.agreementId,
          // Stated on the record, because it is the thing somebody will ask
          // about later: the patient walked away and nothing was signed, and
          // nothing about the agreement moved (REQ-REC-04).
          agreementChanged: false,
        },
      });
      /*
       * AND THE DECLINE GETS ITS OWN EVENT, IN THE SAME TRANSACTION (Carl,
       * 4 Sep 2026).
       *
       * `tablet.session_ended` says a screen finished and names the word it
       * finished on. That is not enough for this one: "the patient read a
       * standing agreement and said they would rather agree each visit" is a
       * fact about the AGREEMENT OFFER, and the next thing that happens —
       * reception offering an episodic agreement for the visit — is a reply to
       * it. Two events, one transaction, so neither can exist without the
       * other (hard rule 11).
       *
       * NOTHING ON THE AGREEMENT MOVED and the payload says so, for the same
       * reason the walk-away event does: declining an ongoing agreement
       * declines neither bulk billing nor care (hard rule 8, REQ-REC-04).
       */
      if (to === 'declined_enduring') {
        await enqueueVaultEvent(tx, {
          type: 'tablet.enduring_declined',
          actor,
          subject: { type: 'TabletSession', id: session.id },
          payload: {
            agreementId: session.agreementId,
            agreementType: 'enduring',
            agreementChanged: false,
            // No reason is asked for and none is recorded. The tablet has one
            // quiet secondary action and no field to type into.
            offeredInstead: 'episodic_pre',
          },
        });
      }

      /*
       * AND THE REFUSED SIGNATURE GETS ITS OWN EVENT, IN THE SAME TRANSACTION
       * (Carl, 7 Sep 2026) — the same construction as the decline above, for
       * the same reason (hard rule 11).
       *
       * `tablet.session_ended` says a screen finished on the word
       * `signature_failed`. The fact worth keeping is WHY: somebody stood at a
       * tablet, signed, and the platform did not record it. THE CODE AND
       * NOTHING ELSE — never the server's sentence, never the payload, and
       * never the assignor's strokes, which are identifier-grade and do not go
       * near an event (REQ-LOG-08).
       */
      if (to === 'signature_failed') {
        await enqueueVaultEvent(tx, {
          type: 'tablet.signature_failed',
          actor,
          subject: { type: 'TabletSession', id: session.id },
          payload: {
            agreementId: session.agreementId,
            reason: signatureFailureReason ?? 'other',
            // The signature was refused, so nothing was recorded and nothing
            // moved. The patient is seen either way (hard rule 8, REQ-REC-04).
            agreementChanged: false,
          },
        });
      }
      return ended;
    });
  }

  // -------------------------------------------------------------------------
  // Reads and refusals
  // -------------------------------------------------------------------------

  private async readPushContext(practiceId: string, agreementId: string) {
    const found = await this.prisma.withPractice(practiceId, async (tx) => {
      // A cross-practice id finds nothing — RLS filters on the
      // transaction-local scope, so this fails closed rather than admitting
      // the agreement exists somewhere else.
      const agreement = await tx.agreement.findFirst({ where: { id: agreementId } });
      if (!agreement) return null;
      const patient = await tx.patient.findFirst({ where: { id: agreement.patientId } });
      const assignor = await tx.assignor.findFirst({ where: { id: agreement.assignorId } });
      /*
       * THE PRACTITIONER AT A LOCATION (Carl, 7 Sep 2026). Their discipline
       * decides the GP-only enduring check and their billing role decides
       * whether the claim can go under them at all -- both facts about the
       * PERSON at the PLACE, which is why the practice-wide row could not
       * carry them.
       */
      const anchor = await anchorForAgreement(tx, agreement);
      const appointment = await tx.appointment.findFirst({ where: { agreementId } });
      /*
       * THE SERVICE THIS AGREEMENT WAS MADE FOR, where there is one (Carl,
       * 11 Sep 2026). Only a post-agreement has one: D5 is the day it was
       * rendered and D6b is the item numbers, and both are needed if this push
       * has to lock the particulars itself.
       */
      const service = await tx.serviceRecord.findFirst({ where: { agreementId } });
      return {
        agreement,
        patientName: patient ? `${patient.givenNames} ${patient.familyName}` : '',
        confidential: patient?.confidentialityFlag ?? false,
        assignorName: assignor?.name ?? null,
        providerName: anchor?.name ?? null,
        /*
         * THE DISCIPLINE, BECAUSE ENDURING IS GP-ONLY (hard rule 6,
         * REQ-END-01a). Read here rather than inferred anywhere later, and
         * `null` where no anchor was found — which the GP check treats as
         * "not a GP", never as "probably fine".
         */
        providerType: anchor?.providerType ?? null,
        /*
         * WHOSE PROVIDER NUMBER THE CLAIM GOES UNDER (Carl, 5-7 Sep 2026).
         * `null` where no provider row was found, which the check below skips
         * rather than fails on -- an agreement with no provider is already
         * caught by `enduring_not_per_provider` and by the anchor rules, and
         * inventing a second refusal for it would say the same thing twice.
         */
        billingRole: anchor ? anchor.billingRole : null,
        appointmentDate: appointment ? appointment.date.toISOString().slice(0, 10) : null,
        /** D5 for a post-agreement — the day the service WAS rendered. */
        serviceDate: service ? service.serviceDate.toISOString().slice(0, 10) : null,
        /** D6b — post-agreements only (REQ-REG-01). Empty everywhere else. */
        mbsItemNumbers: service ? [...service.mbsItemNumbers] : [],
      };
    });
    if (!found) throw pushRefusals.agreementNotFound();
    return found;
  }

  private assertPushable(context: {
    agreement: DbAgreement;
    assignorName: string | null;
    confidential: boolean;
    providerType: string | null;
    billingRole: string | null;
    providerName?: string | null;
  }): void {
    const reason = this.blockingReason(context);
    if (!reason) return;
    switch (reason) {
      case 'provider_not_servicing':
        throw pushRefusals.providerNotServicing(context.providerName ?? null, context.billingRole);
      case 'enduring_not_gp':
        throw pushRefusals.enduringNotGp(context.providerType);
      case 'enduring_not_per_provider':
        throw pushRefusals.enduringNotPerProvider();
      case 'enduring_rules_not_authored':
        throw pushRefusals.enduringRulesNotAuthored();
      case 'agreement_not_pushable':
        throw pushRefusals.agreementNotPushable(context.agreement.status);
      case 'patient_confidential':
        throw pushRefusals.patientConfidential();
      case 'service_description_missing':
        throw pushRefusals.serviceDescriptionMissing();
      case 'who_is_signing_unset':
        throw pushRefusals.whoIsSigningUnset();
      case 'assignor_not_confirmed':
        throw pushRefusals.assignorNotConfirmed();
      default:
        throw pushRefusals.agreementNotPushable(context.agreement.status);
    }
  }

  /**
   * `prepareLock`, WITH THE ONE FAILURE THIS SURFACE HAS ITS OWN WORD FOR.
   *
   * The rule set's enduring branch is a human-authored zone (CLAUDE.md §7) and
   * `AgreementsService` reports its absence as a fact rather than as an HTTP
   * status, because each caller says it differently. Here it becomes
   * `enduring_rules_not_authored` — a CODE the console maps to copy and a
   * destination, never a rules-engine sentence shown to a receptionist.
   */
  private async prepareLockOrRefuse(
    practiceId: string,
    agreementId: string,
    dto: LockParticularsDto,
    overrides: { verificationPassed?: true },
  ): Promise<PreparedLock> {
    try {
      return await this.agreements.prepareLock(practiceId, agreementId, dto, overrides);
    } catch (err) {
      if (err instanceof EnduringRulesNotAuthoredError) throw pushRefusals.enduringRulesNotAuthored();
      throw err;
    }
  }

  /**
   * THE PUSH'S PRECONDITIONS, IN ONE FUNCTION, so the list the console renders
   * and the refusal the push gives cannot drift apart. The console shows the
   * reason before anybody presses anything; the server refuses regardless,
   * because a control that exists only on a screen is a suggestion.
   */
  private blockingReason(context: {
    agreement: DbAgreement;
    assignorName: string | null;
    confidential: boolean;
    /** The provider's discipline, or null where none is recorded. Missing is NOT a GP. */
    providerType: string | null;
    /** The billing role at this practice, or null where no provider row was found. */
    billingRole: string | null;
  }): PushBlockedReason | null {
    const { agreement } = context;

    /*
     * WHOSE NUMBER THE CLAIM GOES UNDER, BEFORE ANYTHING ELSE (Carl, 5-7 Sep
     * 2026). An agreement naming somebody who cannot be the provider on one is
     * wrong in a way no other check catches, and it is checked here as well as
     * at arrival because the ROLE can change after the draft was made.
     *
     * A NULL ROLE IS SKIPPED, not failed. It means no provider row was found,
     * and the anchor rules below already have a word for that -- a second
     * refusal saying the same thing differently would just make the screen
     * argue with itself.
     */
    if (context.billingRole !== null && !mayBeProviderOnAgreement(context.billingRole)) {
      return 'provider_not_servicing';
    }

    /*
     * ENDURING FIRST, and it is now THREE questions rather than one blanket
     * refusal (Carl, 4 Sep 2026; GA-PLAN B5). Two of them are permanent rules
     * and are answered here; the third is about the rule set and is answered
     * by asking it (`enduringRulesAuthored`), because this function is
     * synchronous and must stay so — it is called once per row of a list.
     *
     * GP-ONLY, PERMANENTLY (hard rule 6, REQ-END-01a). Specialists, allied
     * health and optometry have no enduring pathway and never will; the offer
     * there is an episodic agreement or a Treatment Plan Assignment. A
     * provider with NO discipline recorded fails closed — the cost of guessing
     * is a standing commitment to bulk bill entered by somebody with no
     * pathway to enter it.
     *
     * PER PRACTITIONER × PATIENT, NEVER PER PRACTICE (hard rule 6,
     * REQ-END-01). One agreement names one provider and one patient. An
     * organisation anchor (the ACCHO/AMS pathway) is a real thing and is not a
     * thing a waiting-room tablet may collect a signature on: the screen could
     * not tell the person signing who they are agreeing with.
     */
    if (agreement.type === 'enduring') {
      /*
       * "NAMES ONE PROVIDER" IS NOW "NAMES ONE PRACTITIONER AT A LOCATION"
       * (Carl, 7 Sep 2026). The anchor moved; the rule did not. `providerId`
       * is still accepted here because agreements made before it moved carry
       * only that, and refusing to push one of those would be the platform
       * blocking evidence over a schema change (hard rule 8).
       */
      if (agreement.anchorKind !== 'provider' || (!agreement.affiliationId && !agreement.providerId)) {
        return 'enduring_not_per_provider';
      }
      if (context.providerType !== 'general_practitioner') return 'enduring_not_gp';
    }

    if (!(PUSHABLE_STATUSES as readonly string[]).includes(agreement.status)) {
      return 'agreement_not_pushable';
    }
    if (agreement.signatureEventId) return 'agreement_not_pushable';

    if (context.confidential) return 'patient_confidential';

    /*
     * D6a, THE SAME STRUCTURAL PRECHECK THE WAITING LIST MAKES, and for the
     * same reason: it is the one particular the tablet cannot supply, because
     * the tablet must never present a field a patient could fill on the
     * practice's behalf (Carl, 3 Sep 2026). An agreement whose particulars are
     * already locked has passed the rules engine once and is not re-litigated
     * here.
     */
    if ((PRE_AGREEMENT_TYPES as readonly string[]).includes(agreement.type)) {
      const signability = computeSignability(
        {
          particularsLockedAt: agreement.particularsLockedAt,
          basicServiceDescription: basicServiceDescriptionOf(agreement),
        },
        isServiceDescription,
      );
      if (!signability.signable) return 'service_description_missing';
    }

    /*
     * D7 IS EXPLICIT AND IS SET AT THE DESK, before the push
     * (`POST /agreements/:id/assignor`). An agreement that says somebody other
     * than the patient is signing, with no party recorded, must never reach a
     * tablet: the ceremony would print a blank where the contract names its
     * counterparty.
     */
    if (!agreement.assignorIsPatient && !(context.assignorName ?? '').trim()) {
      return 'who_is_signing_unset';
    }

    /*
     * AND HAS ANYBODY ACTUALLY BEEN ASKED? (Carl, 7 Sep 2026.)
     *
     * LAST, so every more specific fault still wins. A row with no description
     * of the service, or naming somebody who cannot be the provider, has a
     * different thing wrong with it and should say so — telling reception to
     * confirm who is signing on a row that also cannot go for a second reason
     * would send them round the loop twice.
     *
     * IT IS NOT ABOUT WHAT THE AGREEMENT SAYS, which is why no other check
     * catches it. The agreement says the patient is signing, and so does every
     * agreement the moment it is drafted; what is missing is a person having
     * been asked. `assignorConfirmedAt` is written by
     * `POST /agreements/:id/assignor` and by nothing else.
     */
    if (agreement.assignorConfirmedAt === null) return 'assignor_not_confirmed';

    return null;
  }

  /** A session as the console lists it, with the names a staff screen may show. */
  private async decorate(practiceId: string, sessions: TabletSession[]): Promise<TabletSessionRow[]> {
    if (sessions.length === 0) return [];
    return this.prisma.withPractice(practiceId, async (tx) => {
      const devices = await tx.device.findMany({ where: { id: { in: sessions.map((s) => s.deviceId) } } });
      const deviceById = new Map(devices.map((d) => [d.id, d]));
      const agreements = await tx.agreement.findMany({
        where: { id: { in: sessions.map((s) => s.agreementId) } },
      });
      const agreementById = new Map(agreements.map((a) => [a.id, a]));
      const patients = await tx.patient.findMany({
        where: { id: { in: agreements.map((a) => a.patientId) } },
      });
      const patientById = new Map(patients.map((p) => [p.id, p]));
      const anchorByAgreement = await anchorsForAgreements(tx, agreements);
      /*
       * WHICH OF THESE AGREEMENTS HAS BEEN REPLACED — one query for the whole
       * list, on the same reasoning as the anchors above. `outcomeOf` turns it
       * into `moved_on`, which is what stops an ended session offering "Send
       * again" for a row the chain has moved past.
       */
      const successors = await tx.agreement.findMany({
        where: { supersedesAgreementId: { in: agreements.map((a) => a.id) } },
        select: { supersedesAgreementId: true },
      });
      const superseded = new Set(
        successors.map((s) => s.supersedesAgreementId).filter((id): id is string => id !== null),
      );

      return sessions.map((session) => {
        const agreement = agreementById.get(session.agreementId);
        const patient = agreement ? patientById.get(agreement.patientId) : undefined;
        const anchor = agreement ? anchorByAgreement.get(agreement.id) : undefined;
        return {
          id: session.id,
          deviceId: session.deviceId,
          deviceLabel: deviceById.get(session.deviceId)?.label ?? '',
          agreementId: session.agreementId,
          agreementType: (agreement?.type ?? 'episodic_pre') as AgreementType,
          // A staff surface. A name and nothing else about the person — no date
          // of birth, no address, no contact detail: reception is watching a
          // state, not mirroring a screen.
          patientName: patient ? `${patient.givenNames} ${patient.familyName}` : '',
          patientId: agreement?.patientId ?? '',
          providerName: anchor?.name ?? null,
          state: session.state as TabletSessionState,
          // TYPES, never the values behind them (REQ-VER-04). Reception reads
          // "Patient says wrong: address, mobile" and looks the values up on
          // their own screen.
          disputedDetails: [...session.detailsDisputedTypes],
          /*
           * AND WHETHER RECEPTION HAS ANSWERED IT (Carl, 4 Sep 2026). This is
           * what lets the row read "Resolved — ready to re-send" instead of
           * repeating "a detail is wrong" at somebody who has already fixed
           * it. An OUTCOME and a TIME — never who by, because a staff
           * principal id on a list that refreshes every three seconds is an
           * identifier nobody on that screen needs; it is on the event, where
           * an audit reads it.
           */
          disputeResolution: (session.disputeResolution ?? null) as TabletSessionRow['disputeResolution'],
          disputeResolvedAt: session.disputeResolvedAt?.toISOString() ?? null,
          /*
           * WHY A SIGNATURE WAS REFUSED — the server's own code, mapped to
           * words by the console (Carl, 7 Sep 2026). Null on every session
           * that did not end that way; the CHECK constraint makes that a fact
           * about the table rather than about this projection.
           */
          signatureFailureReason: session.signatureFailureReason ?? null,
          /*
           * AND WHETHER THE AGREEMENT BEHIND IT HAS LEFT. Read from the
           * agreement rows this projection already fetched — no extra query,
           * and no second definition of "pushable" (see `outcomeOf`).
           */
          agreementOutcome: this.outcomeOf(agreement, superseded.has(session.agreementId)),
          pushedBy: session.pushedBy,
          pushedAt: session.pushedAt.toISOString(),
          lastStateAt: session.lastStateAt.toISOString(),
          endedAt: session.endedAt?.toISOString() ?? null,
        };
      });
    });
  }

  private rowFor(
    session: TabletSession,
    deviceLabel: string,
    context: { agreement: DbAgreement; patientName: string; providerName: string | null },
  ): TabletSessionRow {
    return {
      id: session.id,
      deviceId: session.deviceId,
      deviceLabel,
      agreementId: session.agreementId,
      agreementType: context.agreement.type as AgreementType,
      patientName: context.patientName,
      patientId: context.agreement.patientId,
      providerName: context.providerName,
      state: session.state as TabletSessionState,
      disputedDetails: [...session.detailsDisputedTypes],
      disputeResolution: (session.disputeResolution ?? null) as TabletSessionRow['disputeResolution'],
      disputeResolvedAt: session.disputeResolvedAt?.toISOString() ?? null,
      signatureFailureReason: session.signatureFailureReason ?? null,
      agreementOutcome: this.outcomeOf(context.agreement),
      pushedBy: session.pushedBy,
      pushedAt: session.pushedAt.toISOString(),
      lastStateAt: session.lastStateAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
    };
  }

  /**
   * A device may only act on ITS OWN session, and a session from another
   * practice is not found rather than refused — the scope has already been
   * resolved from the credential, so there is nothing to tell the caller.
   */
  private async requireDeviceSession(
    tx: Prisma.TransactionClient,
    device: ResolvedDevice,
    sessionId: string,
  ): Promise<TabletSession> {
    const session = await tx.tabletSession.findFirst({
      where: { id: sessionId, deviceId: device.deviceId },
    });
    if (!session) throw new NotFoundException('That tablet session was not found.');
    return session;
  }
}

/** Today, as the ISO date every particular in this system is written in. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * WHICH DETAIL TYPES A STAFF MEMBER CORRECTED AFTER THIS AGREEMENT WAS LOCKED.
 *
 * SINCE THE LOCK, NOT EVER, and the difference decides whether a superseding
 * agreement is created. `patients.detailsCorrectedFields` is a per-field map of
 * `{ field: isoTimestamp }` (schema.prisma says why it is a map rather than six
 * columns); a correction made BEFORE the lock is already inside the hashed
 * snapshot, and treating it as a reason to supersede would mint a fresh
 * agreement on every re-send for the rest of the patient's life.
 *
 * AN UNLOCKED AGREEMENT ANSWERS THE EMPTY LIST, because there is nothing to
 * supersede: the push is about to assemble the particulars from these very
 * records for the first time.
 *
 * FIELD NAMES AND TIMES ONLY. Nothing here reads a value, and there is no
 * value in the map to read (REQ-VER-04).
 */
function particularsCorrectedSince(
  patient: { detailsCorrectedFields: unknown } | null,
  lockedAt: Date | null,
): ConfirmableDetailType[] {
  if (!patient || !lockedAt) return [];
  const map = patient.detailsCorrectedFields;
  if (!map || typeof map !== 'object') return [];

  const types = new Set<ConfirmableDetailType>();
  for (const [field, at] of Object.entries(map as Record<string, unknown>)) {
    if (typeof at !== 'string') continue;
    if (!isCorrectablePatientField(field)) continue;
    const when = new Date(at);
    if (Number.isNaN(when.getTime()) || when <= lockedAt) continue;
    types.add(detailTypeForPatientField(field));
  }
  return [...types];
}

/**
 * D6a, THE SAME READ `lockParticulars` DOES —
 * `agreement.serviceDescription ?? particulars.basicServiceDescription` — and
 * the one `computeSignability`'s own docstring names. The column holds D6a
 * while the draft is still open; once locked, the trigger in the
 * `service_description` migration refuses any further change to it, so the
 * column can be stale (or never populated at all, when a caller supplied
 * `basicServiceDescription` straight to the lock rather than through the
 * staff surface that writes the column) while the LOCKED snapshot in
 * `particulars` still carries the true, rendered value. Reading the column
 * alone is exactly the bug this fixes: a locked agreement with a real D6a
 * showing "Not set" and refusing to push (kiosk.service.ts's
 * `collectWaiting` makes the identical read, for the identical reason).
 */

/**
 * ONE SENTENCE FOR "this session is over", whichever way it ended. A tablet
 * whose poll lands a second after a recall is told the session is over and
 * shown the idle screen; it is not told whether reception took it back, the
 * clock ran out, or somebody signed on another channel — none of which is the
 * tablet's business, and all of which would be a detail on a screen in a
 * waiting room.
 */
function sessionIsOver(): string {
  return 'This session is no longer active. Ask reception to send the agreement again.';
}

/** Prisma's unique-constraint code. The partial index on one-active-per-device. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}
