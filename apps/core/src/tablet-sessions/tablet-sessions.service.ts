import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Agreement as DbAgreement, Prisma, TabletSession } from '@prisma/client';
import {

  TABLET_SESSION_IDLE_MS,
  canChangeTabletSessionState,
  computeSignability,
  correctionTouchesParticulars,
  detailTypeForPatientField,
  isCorrectablePatientField,
  isServiceDescription,
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
import type { Actor } from '../auth/actor.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AgreementsService, type PreparedLock } from '../agreements/agreements.service';
import { CaptureService } from '../capture/capture.service';
import { VerificationService } from '../verification/verification.service';
import { DevicesService, type ResolvedDevice } from '../devices/devices.service';
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
  providerName: string | null;
  /** So the console offers episodic / Treatment Plan Assignment for a non-GP, never enduring (REQ-END-01a). */
  providerType: string | null;
  appointmentDate: string | null;
  appointmentTime: string | null;
  /** D6a as it stands, and whether it is from the CURRENT mapping (hard rule 14). */
  serviceDescription: string | null;
  serviceDescriptionValid: boolean;
  /** D7 — explicit, never inferred (CLAUDE.md §3). */
  assignorIsPatient: boolean;
  assignorName: string | null;
  assignorRelationship: string | null;
  particularsLocked: boolean;
  pushable: boolean;
  blockedReason: PushBlockedReason | null;
  /** Where it already is, if it is on a tablet right now. */
  activeSession: { id: string; deviceId: string; state: TabletSessionState } | null;
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
    const prepared: PreparedLock | null = context.agreement.particularsLockedAt
      ? null
      : await this.agreements.prepareLock(
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
            serviceDate: context.appointmentDate ?? today(),
            agreementDate: today(),
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
      const forToday = dueToday.filter((agreement) => !hasAnyCapture.has(agreement.id) || hasOpenCapture.has(agreement.id));
      if (forToday.length === 0) return [];

      const patients = await tx.patient.findMany({
        where: { id: { in: forToday.map((a) => a.patientId) } },
      });
      const patientById = new Map(patients.map((p) => [p.id, p]));
      const providerIds = forToday.map((a) => a.providerId).filter((id): id is string => Boolean(id));
      const providers = providerIds.length
        ? await tx.provider.findMany({ where: { id: { in: providerIds } } })
        : [];
      const providerById = new Map(providers.map((p) => [p.id, p]));
      const assignors = await tx.assignor.findMany({
        where: { id: { in: forToday.map((a) => a.assignorId) } },
      });
      const assignorById = new Map(assignors.map((a) => [a.id, a]));
      const live = await tx.tabletSession.findMany({ where: { endedAt: null } });
      const sessionByAgreement = new Map(live.map((s) => [s.agreementId, s]));

      const rows: PushableRow[] = [];
      for (const agreement of forToday) {
        const patient = patientById.get(agreement.patientId);
        if (!patient) continue;
        const provider = agreement.providerId ? providerById.get(agreement.providerId) : undefined;
        const assignor = assignorById.get(agreement.assignorId);
        const appointment = appointmentByAgreement.get(agreement.id);
        const session = sessionByAgreement.get(agreement.id);

        const blocked = this.blockingReason({
          agreement,
          assignorName: assignor?.name ?? null,
          confidential: patient.confidentialityFlag,
        });

        // The same D6a read `lockParticulars` does, and the same one
        // `computeSignability` documents: the column while the draft is
        // still open, falling back to the locked snapshot once it is not
        // (see `d6aOf` below). A locked agreement whose description arrived
        // through the lock's own DTO, rather than the staff surface that
        // writes the column, must still show as set here.
        const d6a = d6aOf(agreement);

        rows.push({
          agreementId: agreement.id,
          agreementType: agreement.type as AgreementType,
          status: agreement.status,
          // A staff surface: the practice's own list of its own patients, the
          // same shape every other console list uses.
          patientName: `${patient.givenNames} ${patient.familyName}`,
          providerName: provider?.name ?? null,
          providerType: provider?.providerType ?? null,
          appointmentDate: appointment ? appointment.date.toISOString().slice(0, 10) : null,
          appointmentTime: appointment?.time ?? null,
          serviceDescription: d6a ?? null,
          serviceDescriptionValid: d6a ? isServiceDescription(d6a) : false,
          assignorIsPatient: agreement.assignorIsPatient,
          assignorName: agreement.assignorIsPatient ? null : (assignor?.name ?? null),
          assignorRelationship: agreement.assignorIsPatient
            ? null
            : (assignor?.relationshipToPatient ?? null),
          particularsLocked: agreement.particularsLockedAt !== null,
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
      return { session, agreement, patient, assignor };
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
        assignor: agreement.assignorIsPatient
          ? { isPatient: true }
          : {
              isPatient: false,
              name: assignor?.name ?? '',
              relationship: assignor?.relationshipToPatient ?? '',
            },
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
    state: 'reading' | 'walked_away' | 'timed_out',
  ): Promise<{ id: string; state: TabletSessionState }> {
    if (state === 'walked_away' || state === 'timed_out') {
      const ended = await this.end(device.practiceId, sessionId, state, {
        principalType: 'device',
        id: device.deviceId,
      }, device.deviceId);
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

      for (const session of active) {
        const to: TabletSessionState | null = signed.has(session.agreementId)
          ? 'signed'
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
          payload: { from: session.state, to, agreementId: session.agreementId, agreementChanged: false },
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
    to: 'walked_away' | 'timed_out' | 'recalled',
    actor: { principalType: string; id: string },
    deviceId?: string,
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
        data: { state: to, endedAt: new Date(), lastStateAt: new Date() },
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
      const provider = agreement.providerId
        ? await tx.provider.findFirst({ where: { id: agreement.providerId } })
        : null;
      const appointment = await tx.appointment.findFirst({ where: { agreementId } });
      return {
        agreement,
        patientName: patient ? `${patient.givenNames} ${patient.familyName}` : '',
        confidential: patient?.confidentialityFlag ?? false,
        assignorName: assignor?.name ?? null,
        providerName: provider?.name ?? null,
        appointmentDate: appointment ? appointment.date.toISOString().slice(0, 10) : null,
      };
    });
    if (!found) throw pushRefusals.agreementNotFound();
    return found;
  }

  private assertPushable(context: {
    agreement: DbAgreement;
    assignorName: string | null;
    confidential: boolean;
  }): void {
    const reason = this.blockingReason(context);
    if (!reason) return;
    switch (reason) {
      case 'enduring_not_supported':
        throw pushRefusals.enduringNotSupported();
      case 'agreement_not_pushable':
        throw pushRefusals.agreementNotPushable(context.agreement.status);
      case 'patient_confidential':
        throw pushRefusals.patientConfidential();
      case 'service_description_missing':
        throw pushRefusals.serviceDescriptionMissing();
      case 'who_is_signing_unset':
        throw pushRefusals.whoIsSigningUnset();
      default:
        throw pushRefusals.agreementNotPushable(context.agreement.status);
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
  }): PushBlockedReason | null {
    const { agreement } = context;

    /*
     * ENDURING FIRST, because it is the one refusal that is about US rather
     * than about this agreement. The push flow's normal case is meant to be an
     * enduring agreement for a GP (REQ-END-01/-01a) — the renderer handles the
     * type, and the s 65C rule set does not have an enduring path at all. The
     * rule set is a human-authored zone (CLAUDE.md §7), so this is reported
     * and refused rather than filled in by an agent writing regulation.
     */
    if (agreement.type === 'enduring') return 'enduring_not_supported';

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
          basicServiceDescription: d6aOf(agreement),
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
      const providerIds = agreements.map((a) => a.providerId).filter((id): id is string => Boolean(id));
      const providers = providerIds.length
        ? await tx.provider.findMany({ where: { id: { in: providerIds } } })
        : [];
      const providerById = new Map(providers.map((p) => [p.id, p]));

      return sessions.map((session) => {
        const agreement = agreementById.get(session.agreementId);
        const patient = agreement ? patientById.get(agreement.patientId) : undefined;
        const provider = agreement?.providerId ? providerById.get(agreement.providerId) : undefined;
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
          providerName: provider?.name ?? null,
          state: session.state as TabletSessionState,
          // TYPES, never the values behind them (REQ-VER-04). Reception reads
          // "Patient says wrong: address, mobile" and looks the values up on
          // their own screen.
          disputedDetails: [...session.detailsDisputedTypes],
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
function d6aOf(agreement: Pick<DbAgreement, 'serviceDescription' | 'particulars'>): string | undefined {
  if (agreement.serviceDescription) return agreement.serviceDescription;
  const particulars = agreement.particulars as Record<string, unknown> | null;
  return typeof particulars?.basicServiceDescription === 'string'
    ? (particulars.basicServiceDescription as string)
    : undefined;
}

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
