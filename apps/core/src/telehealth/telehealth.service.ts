import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { Prisma as PrismaErrors, type Prisma, type TelehealthSession } from '@prisma/client';
import {
  ASSIGNOR_RELATIONSHIP_KEYS,
  IdentifierSetError,
  TELEHEALTH_CHANNELS,
  TELEHEALTH_CODE_LOCKED_TASK_KIND,
  TELEHEALTH_CONTENT,
  TELEHEALTH_CONTENT_VERSION,
  TELEHEALTH_LINK_STATES,
  TELEHEALTH_NOT_DONE_NOTE_MAX,
  TELEHEALTH_NOT_DONE_REASONS_VERSION,
  assertValidIdentifierSet,
  isApprovedIdentifierType,
  isTelehealthSessionState,
  maskEmail,
  maskMobile,
  mayMoveTelehealthSession,
  isPlausibleConsenterName,
  isWellFormedMobile,
  normalisePhone,
  telehealthConsentStatement,
  telehealthConsultationId,
  telehealthNotDoneReason,
  type TelehealthChannel,
  type TelehealthSessionState,
} from '@aobplatform/domain';
import type {
  TelehealthCodeAccepted,
  TelehealthCodeRefused,
  TelehealthLinkLanding,
  TelehealthMaskedContact,
  TelehealthPageView,
  TelehealthSendResult,
  TelehealthSessionView,
} from '@aobplatform/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationService } from '../verification/verification.service';
import { PatientsService } from '../patients/patients.service';
import { ReviewTasksService } from '../review-tasks/review-tasks.service';
import { PractitionerQueueService } from '../practitioner-queue/practitioner-queue.service';
import { telehealthProvider } from './telehealth-provider';
import { mintCaptureToken, parseCaptureToken } from '../capture/capture-token';
import type { Actor } from '../auth/actor.decorator';
import { generateTelehealthCode, hashTelehealthCode, telehealthCodeMatches } from './telehealth-code';
import { TELEHEALTH_VAULT_EVENTS_APPROVED, TelehealthEvidence, type TelehealthVaultEvent } from './telehealth-evidence';
import { TelehealthLinkDispatcher } from './telehealth-link.dispatcher';

/** Affiliation statuses that mean somebody works here now (as the practitioner queue reads them). */
const LIVE_AFFILIATION_STATUSES = ['active', 'ending'];
/** The verification channel the provider's check on the call is recorded under. */
export const TELEHEALTH_VERIFICATION_CHANNEL = 'telehealth';
/** How far back the panel's live list reaches. A consultation day, not a history. */
const PANEL_WINDOW_HOURS = 24;

/** A note that looks like it holds an identifier: six digits in a row, or an address. */
const NOTE_LOOKS_LIKE_A_VALUE = /\d{6,}|\S+@\S+\.\S+/;

/**
 * THE STEP BEFORE A TELEHEALTH CONSULTATION (TELEHEALTH-PLAN.md §3–§4, §8 step 2).
 *
 * THE PROVIDER'S HALF: pick the patient, record which identifier TYPES were
 * checked on the call, send the link to the contact on the record, show the
 * code once, watch the state, record "not done, with a reason" or "did not
 * proceed". THE PATIENT'S HALF: open the link, type the code, see the practice
 * and the provider, press the one button, and wait on the same page.
 *
 * NOTHING HERE CAN STOP A CONSULTATION (hard rule 8). Every refusal is about
 * the evidence; "not done" is open from every state before an outcome, and the
 * provider may record it with no session at all.
 *
 * EVERY WRITE HANDS ITS EVENT TO `TelehealthEvidence.record` INSIDE ITS OWN
 * TRANSACTION, which enqueues it on the vault outbox with that same `tx`
 * (hard rule 11). The event types were approved by Carl on 12 Oct 2026
 * (D-2026-10-12-02) — see `telehealth-evidence.ts`.
 *
 * NO IDENTIFIER VALUE, CONTACT VALUE OR CODE IS LOGGED, STORED OR RETURNED TO
 * THE PATIENT'S PAGE. The code is returned once, to the provider.
 */
/** The states a practitioner records that close the link: the page says which (Carl, 12 Oct 2026). */
const TELEHEALTH_OUTCOME_STATES: readonly string[] = ['went_ahead', 'did_not_proceed', 'not_done'];

@Injectable()
export class TelehealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly verification: VerificationService,
    private readonly patients: PatientsService,
    private readonly reviewTasks: ReviewTasksService,
    private readonly queue: PractitionerQueueService,
    private readonly evidence: TelehealthEvidence,
    private readonly dispatcher: TelehealthLinkDispatcher,
  ) {}

  /* ---------------------------------------------------------------------
   * The flag
   * ------------------------------------------------------------------ */

  /**
   * OFF BY DEFAULT: `TELEHEALTH_ENABLED` alone gates it. Every write's vault
   * event goes to the outbox in the write's own transaction (hard rule 11), so
   * the old NODE_ENV restriction, which existed only while the event types
   * awaited approval, is gone (Carl, 12 Oct 2026, D-2026-10-12-02).
   *
   * STILL FAILS CLOSED if the approval constant is ever turned back off: then
   * nothing runs anywhere, rather than writes running without their events.
   */
  enabled(): boolean {
    if (!TELEHEALTH_VAULT_EVENTS_APPROVED) return false;
    return this.config.get<string>('TELEHEALTH_ENABLED', 'false') === 'true';
  }

  private assertEnabled(): void {
    if (!this.enabled()) {
      throw new NotFoundException({
        code: 'telehealth_not_enabled',
        message: 'Telehealth is not switched on for this platform yet.',
      });
    }
  }

  /* ---------------------------------------------------------------------
   * Who is asking
   * ------------------------------------------------------------------ */

  /**
   * THE PRACTITIONER ON THE CALL, AT A PRACTICE THEY WORK AT. The practice is
   * checked against their own live affiliations by the same code the waiting
   * list uses (`practiceForPractitioner`), before any scope opens; RLS then
   * hides every other practice's rows. Step 4 adds reception (`staff`).
   */
  private async scope(actor: Actor | undefined, headerPracticeId: string | undefined) {
    this.assertEnabled();
    const practitionerId = actor?.practitionerId;
    if (!actor || !practitionerId) {
      throw new ForbiddenException(
        'A telehealth session is started by the practitioner on the call, signed in as themselves. This ' +
          'account is not a practitioner’s.',
      );
    }
    const practiceId = await this.queue.practiceForPractitioner(practitionerId, headerPracticeId);
    return { practiceId, practitionerId, actorId: actor.id };
  }

  /**
   * A TRANSACTION THAT CREATES A SESSION, RUN AGAIN ON THE RARE ID CLASH. The
   * consultation ID is drawn inside `fn`, so a retry draws a fresh one. A
   * unique violation aborts the whole transaction in Postgres, which is why
   * the retry is the transaction and not the insert. Three tries: with 40 bits
   * a second clash in a row is not a thing that happens.
   */
  private async withFreshConsultationId<T>(practiceId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.withPractice(practiceId, fn);
      } catch (err) {
        const clash =
          err instanceof PrismaErrors.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          JSON.stringify(err.meta?.target ?? '').includes('consultationId');
        if (!clash || attempt >= 3) throw err;
      }
    }
  }

  private async liveAffiliation(tx: Prisma.TransactionClient, practitionerId: string) {
    const affiliation = await tx.affiliation.findFirst({
      where: { practitionerId, status: { in: LIVE_AFFILIATION_STATUSES } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!affiliation) {
      throw new ForbiddenException('You have no current affiliation at this practice, so a session cannot be recorded here.');
    }
    return affiliation.id;
  }

  /* ---------------------------------------------------------------------
   * The provider's panel
   * ------------------------------------------------------------------ */

  /** From the PMS sync, through the patients module's own search (no directory, minimum characters). */
  async searchPatients(actor: Actor | undefined, headerPracticeId: string | undefined, term: string) {
    const { practiceId } = await this.scope(actor, headerPracticeId);
    return this.patients.search(practiceId, term ?? '');
  }

  /**
   * The chosen patient's record, IN FULL, for the doctor to compare on the
   * call (Carl, D-2026-10-12-03 item 1), plus the masked contact for the
   * channel choice. Only the practitioner on the call reaches this (`scope`),
   * and nothing here is stored: the session records identifier types only.
   */
  async contact(
    actor: Actor | undefined,
    headerPracticeId: string | undefined,
    patientId: string,
  ): Promise<TelehealthMaskedContact> {
    const { practiceId } = await this.scope(actor, headerPracticeId);
    const patient = await this.prisma.withPractice(practiceId, (tx) =>
      tx.patient.findFirst({
        where: { id: patientId },
        select: {
          id: true,
          givenNames: true,
          familyName: true,
          dateOfBirth: true,
          genderAsIdentified: true,
          address: true,
          patientRecordNumber: true,
          ihi: true,
          mobile: true,
          email: true,
        },
      }),
    );
    if (!patient) throw new NotFoundException('That patient is not on this practice’s records.');
    return {
      patientId: patient.id,
      maskedMobile: maskMobile(patient.mobile),
      maskedEmail: maskEmail(patient.email),
      record: {
        givenNames: patient.givenNames,
        familyName: patient.familyName,
        dateOfBirth: patient.dateOfBirth.toISOString().slice(0, 10),
        gender: patient.genderAsIdentified,
        address: patient.address,
        patientRecordNumber: patient.patientRecordNumber,
        ihi: patient.ihi,
        // Only what would be sent to: a value the masker rejects is not a usable contact.
        mobile: maskMobile(patient.mobile) ? patient.mobile : null,
        email: maskEmail(patient.email) ? patient.email : null,
      },
    };
  }

  /** This practitioner's sessions from the last day, newest first — what the live status polls. */
  async list(actor: Actor | undefined, headerPracticeId: string | undefined): Promise<TelehealthSessionView[]> {
    const { practiceId, practitionerId } = await this.scope(actor, headerPracticeId);
    return this.prisma.withPractice(practiceId, async (tx) => {
      const rows = await tx.telehealthSession.findMany({
        where: { practitionerId, createdAt: { gte: new Date(Date.now() - PANEL_WINDOW_HOURS * 3600_000) } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return this.views(tx, rows);
    });
  }

  /**
   * SEND: the identity check, the session, the link and the code, in one
   * transaction. Refused — never half-done — when the record holds no contact
   * for the chosen channel; the panel then offers "not done: no contact on
   * file", which is true for that record.
   */
  async send(
    actor: Actor | undefined,
    headerPracticeId: string | undefined,
    input: {
      patientId: string;
      identifierTypes: string[];
      channel: string;
      consenterIsPatient: boolean;
      consenterRelationship?: string;
      consenterAttested18?: boolean;
    },
  ): Promise<TelehealthSendResult> {
    const { practiceId, practitionerId, actorId } = await this.scope(actor, headerPracticeId);
    this.assertIdentifierTypes(input.identifierTypes);
    const channel = this.channelOf(input.channel);
    this.assertConsenter(input);

    const minted = mintCaptureToken(practiceId);
    const code = generateTelehealthCode(TELEHEALTH_CONTENT.code.digits);
    const codeExpiresAt = new Date(Date.now() + TELEHEALTH_CONTENT.code.validityMinutes * 60_000);

    const result = await this.withFreshConsultationId(practiceId, async (tx) => {
      const patient = await tx.patient.findFirst({ where: { id: input.patientId } });
      if (!patient) throw new NotFoundException('That patient is not on this practice’s records.');
      this.assertContactFor(channel, patient);
      const affiliationId = await this.liveAffiliation(tx, practitionerId);

      // The provider's check on the call, recorded as staff-verified: types, outcome, who. Never values.
      const verified = await this.verification.recordStaffVerified(tx, practiceId, {
        patientId: patient.id,
        identifierTypes: input.identifierTypes,
        staffId: actorId,
        channel: TELEHEALTH_VERIFICATION_CHANNEL,
        principalType: 'practitioner',
      });

      const session = await tx.telehealthSession.create({
        data: {
          practiceId,
          /*
           * The reference the patient quotes (D-2026-10-12-03 item 11). Unique across the
           * platform: the index refuses a clash and `withFreshConsultationId` draws again.
           */
          consultationId: telehealthConsultationId((n) => randomBytes(n)),
          patientId: patient.id,
          practitionerId,
          affiliationId,
          state: 'opened',
          identityCheckedByType: 'practitioner',
          identityCheckedById: actorId,
          identifierTypes: [...new Set(input.identifierTypes)],
          verificationEventId: verified.verificationEventId,
          consenterIsPatient: input.consenterIsPatient,
          consenterRelationship: input.consenterIsPatient ? null : input.consenterRelationship,
          consenterAttested18: input.consenterIsPatient ? null : true,
          channel,
          linkTokenHash: minted.tokenHash,
          linkExpiresAt: codeExpiresAt,
          linkSentCount: 1,
          codeHash: await hashTelehealthCode(code),
          codeExpiresAt,
          contentVersion: TELEHEALTH_CONTENT_VERSION,
          createdById: actorId,
        },
      });

      const actorRef = { principalType: 'practitioner', id: actorId };
      await this.record(tx, session.id, actorRef, {
        type: 'telehealth.session_opened',
        payload: {
          patientId: patient.id,
          practitionerId,
          affiliationId,
          verificationEventId: verified.verificationEventId,
          identifierTypeCount: session.identifierTypes.length,
          consenterIsPatient: input.consenterIsPatient,
          channel,
          contentVersion: TELEHEALTH_CONTENT_VERSION,
        },
      });
      const queued = await this.dispatch(tx, practiceId, session, patient, channel, minted.token, codeExpiresAt);
      await this.record(tx, session.id, actorRef, {
        type: 'telehealth.link_sent',
        payload: { channel, sendCount: 1, codeExpiresAt: codeExpiresAt.toISOString() },
      });
      const [view] = await this.views(tx, [session]);
      return { view: view!, queued };
    });

    return { session: result.view, code, codeExpiresAt: codeExpiresAt.toISOString(), queued: result.queued };
  }

  /**
   * SEND AGAIN: a fresh link and a new code, THE SAME SESSION (§3 "If the page
   * was closed"). The old link and the old page both stop working; the wrong
   * attempt count starts again, which is also how a locked code is unlocked —
   * by the provider on the call, not by waiting.
   */
  async sendAgain(
    actor: Actor | undefined,
    headerPracticeId: string | undefined,
    sessionId: string,
    input: { channel?: string },
  ): Promise<TelehealthSendResult> {
    const { practiceId, practitionerId, actorId } = await this.scope(actor, headerPracticeId);
    const minted = mintCaptureToken(practiceId);
    const code = generateTelehealthCode(TELEHEALTH_CONTENT.code.digits);
    const codeExpiresAt = new Date(Date.now() + TELEHEALTH_CONTENT.code.validityMinutes * 60_000);

    const result = await this.prisma.withPractice(practiceId, async (tx) => {
      const session = await this.ownSession(tx, sessionId, practitionerId);
      if (!session.linkSentCount) {
        throw new ConflictException('No link was ever sent for this session; it was recorded as not done.');
      }
      if (!TELEHEALTH_LINK_STATES.includes(session.state as TelehealthSessionState)) {
        throw new ConflictException(`This session is ${session.state.replace(/_/g, ' ')}, so no new link is sent.`);
      }
      const channel = input.channel ? this.channelOf(input.channel) : (session.channel as TelehealthChannel);
      const patient = await tx.patient.findFirst({ where: { id: session.patientId } });
      if (!patient) throw new NotFoundException('That patient is no longer on this practice’s records.');
      this.assertContactFor(channel, patient);

      const updated = await tx.telehealthSession.update({
        where: { id: session.id },
        data: {
          channel,
          linkTokenHash: minted.tokenHash,
          linkExpiresAt: codeExpiresAt,
          linkConsumedAt: null,
          linkSentCount: session.linkSentCount + 1,
          codeHash: await hashTelehealthCode(code),
          codeExpiresAt,
          codeAttempts: 0,
          codeLockedAt: null,
          // The open page, if any, stops working and is told why ("a newer link was sent").
          retiredPageKeyHash: session.pageKeyHash ?? session.retiredPageKeyHash,
          pageKeyHash: null,
          pageKeyExpiresAt: null,
        },
      });
      const queued = await this.dispatch(tx, practiceId, updated, patient, channel, minted.token, codeExpiresAt);
      await this.record(tx, session.id, { principalType: 'practitioner', id: actorId }, {
        type: 'telehealth.link_sent',
        payload: { channel, sendCount: updated.linkSentCount, codeExpiresAt: codeExpiresAt.toISOString() },
      });
      const [view] = await this.views(tx, [updated]);
      return { view: view!, queued };
    });
    return { session: result.view, code, codeExpiresAt: codeExpiresAt.toISOString(), queued: result.queued };
  }

  /** NOT DONE, WITH A REASON, on a session that exists (§4). The consultation goes ahead. */
  async markNotDone(
    actor: Actor | undefined,
    headerPracticeId: string | undefined,
    sessionId: string,
    input: { reason: string; note?: string; consultationAt?: string },
  ): Promise<TelehealthSessionView> {
    const { practiceId, practitionerId, actorId } = await this.scope(actor, headerPracticeId);
    const { reason, note } = this.reasonOf(input);
    const consultationAt = this.consultationAtOf(input.consultationAt);
    return this.prisma.withPractice(practiceId, async (tx) => {
      const session = await this.ownSession(tx, sessionId, practitionerId);
      this.assertMove(session.state, 'not_done');
      const now = new Date();
      const updated = await tx.telehealthSession.update({
        where: { id: session.id },
        data: {
          state: 'not_done',
          notDoneReason: reason,
          notDoneReasonsVersion: TELEHEALTH_NOT_DONE_REASONS_VERSION,
          notDoneNote: note,
          consultationAt,
          outcomeRecordedAt: now,
          outcomeRecordedById: actorId,
          // An unopened link dies with the step; an open page reads the new state.
          linkExpiresAt: session.linkConsumedAt ? session.linkExpiresAt : now,
          codeHash: null,
        },
      });
      await this.record(tx, session.id, { principalType: 'practitioner', id: actorId }, {
        type: 'telehealth.not_done',
        payload: {
          reason,
          reasonsVersion: TELEHEALTH_NOT_DONE_REASONS_VERSION,
          hasNote: note !== null,
          fromState: session.state,
          consultationAt: consultationAt?.toISOString() ?? null,
          recordedAt: now.toISOString(),
        },
      });
      const [view] = await this.views(tx, [updated]);
      return view!;
    });
  }

  /**
   * NOT DONE, WITH A REASON, AND NO SESSION BEFORE IT — an emergency, no
   * contact on file, or the provider recording it next morning
   * (`doctor_without_access`, scenario B). No identity check, no link, no code.
   */
  async recordNotDone(
    actor: Actor | undefined,
    headerPracticeId: string | undefined,
    input: { patientId: string; reason: string; note?: string; consultationAt?: string },
  ): Promise<TelehealthSessionView> {
    const { practiceId, practitionerId, actorId } = await this.scope(actor, headerPracticeId);
    const { reason, note } = this.reasonOf(input);
    const consultationAt = this.consultationAtOf(input.consultationAt);
    return this.withFreshConsultationId(practiceId, async (tx) => {
      const patient = await tx.patient.findFirst({ where: { id: input.patientId }, select: { id: true } });
      if (!patient) throw new NotFoundException('That patient is not on this practice’s records.');
      const affiliationId = await this.liveAffiliation(tx, practitionerId);
      const now = new Date();
      const session = await tx.telehealthSession.create({
        data: {
          practiceId,
          /*
           * The reference the patient quotes (D-2026-10-12-03 item 11). Unique across the
           * platform: the index refuses a clash and `withFreshConsultationId` draws again.
           */
          consultationId: telehealthConsultationId((n) => randomBytes(n)),
          patientId: patient.id,
          practitionerId,
          affiliationId,
          state: 'not_done',
          notDoneReason: reason,
          notDoneReasonsVersion: TELEHEALTH_NOT_DONE_REASONS_VERSION,
          notDoneNote: note,
          consultationAt,
          outcomeRecordedAt: now,
          outcomeRecordedById: actorId,
          contentVersion: TELEHEALTH_CONTENT_VERSION,
          createdById: actorId,
        },
      });
      await this.record(tx, session.id, { principalType: 'practitioner', id: actorId }, {
        type: 'telehealth.not_done',
        payload: {
          reason,
          reasonsVersion: TELEHEALTH_NOT_DONE_REASONS_VERSION,
          hasNote: note !== null,
          fromState: 'none',
          consultationAt: consultationAt?.toISOString() ?? null,
          recordedAt: now.toISOString(),
        },
      });
      const [view] = await this.views(tx, [session]);
      return view!;
    });
  }

  /** DID NOT PROCEED (scenario C2, not yet ruled): the consultation did not happen. */
  async markDidNotProceed(
    actor: Actor | undefined,
    headerPracticeId: string | undefined,
    sessionId: string,
    input: { consultationAt?: string },
  ): Promise<TelehealthSessionView> {
    const { practiceId, practitionerId, actorId } = await this.scope(actor, headerPracticeId);
    const consultationAt = this.consultationAtOf(input.consultationAt);
    return this.prisma.withPractice(practiceId, async (tx) => {
      const session = await this.ownSession(tx, sessionId, practitionerId);
      this.assertMove(session.state, 'did_not_proceed');
      const now = new Date();
      const updated = await tx.telehealthSession.update({
        where: { id: session.id },
        data: {
          state: 'did_not_proceed',
          consultationAt,
          outcomeRecordedAt: now,
          outcomeRecordedById: actorId,
          linkExpiresAt: session.linkConsumedAt ? session.linkExpiresAt : now,
          codeHash: null,
        },
      });
      await this.record(tx, session.id, { principalType: 'practitioner', id: actorId }, {
        type: 'telehealth.did_not_proceed',
        payload: { fromState: session.state, consultationAt: consultationAt?.toISOString() ?? null, recordedAt: now.toISOString() },
      });
      const [view] = await this.views(tx, [updated]);
      return view!;
    });
  }

  /**
   * CONSULTATION COMPLETE (Carl, 12 Oct 2026, D-2026-10-12-03 item 6): after
   * the patient agreed, the provider records that the consultation was held.
   * The write and its approved vault event `telehealth.consultation_held`
   * commit together (hard rule 11).
   */
  async markWentAhead(
    actor: Actor | undefined,
    headerPracticeId: string | undefined,
    sessionId: string,
    input: { consultationAt?: string },
  ): Promise<TelehealthSessionView> {
    const { practiceId, practitionerId, actorId } = await this.scope(actor, headerPracticeId);
    const consultationAt = this.consultationAtOf(input.consultationAt);
    return this.prisma.withPractice(practiceId, async (tx) => {
      const session = await this.ownSession(tx, sessionId, practitionerId);
      this.assertMove(session.state, 'went_ahead');
      const now = new Date();
      const updated = await tx.telehealthSession.update({
        where: { id: session.id },
        data: {
          state: 'went_ahead',
          consultationAt,
          outcomeRecordedAt: now,
          outcomeRecordedById: actorId,
        },
      });
      await this.record(tx, session.id, { principalType: 'practitioner', id: actorId }, {
        type: 'telehealth.consultation_held',
        payload: { fromState: session.state, consultationAt: consultationAt?.toISOString() ?? null, recordedAt: now.toISOString() },
      });
      const [view] = await this.views(tx, [updated]);
      return view!;
    });
  }

  /* ---------------------------------------------------------------------
   * The patient's page (public: the link token, then the page key)
   * ------------------------------------------------------------------ */

  /** Practice-branded and content-blind: no patient, no provider, before the code. */
  async landing(token: string): Promise<TelehealthLinkLanding> {
    this.assertEnabled();
    const parsed = parseCaptureToken(token);
    if (!parsed) throw new NotFoundException({ code: 'link_invalid', message: 'This link is not valid.' });
    return this.prisma.withPractice(parsed.practiceId, async (tx) => {
      const session = await tx.telehealthSession.findFirst({ where: { linkTokenHash: parsed.tokenHash } });
      if (!session) throw new NotFoundException({ code: 'link_invalid', message: 'This link is not valid.' });
      const practice = await tx.practice.findFirst({ select: { name: true } });
      const state = this.linkState(session);
      // Which outcome closed it, so the page can say the right thing (Carl, 12 Oct 2026). Nothing about the patient.
      const outcome = state === 'closed' && TELEHEALTH_OUTCOME_STATES.includes(session.state) ? session.state : null;
      return { state, practiceName: practice?.name ?? null, outcome: outcome as TelehealthLinkLanding['outcome'] };
    });
  }

  /**
   * THE CODE. Right: the link is spent (single use), the code is spent, and a
   * page key keeps this one page open. Wrong: counted, and at the limit the
   * code locks and the practice is told (a review task), in the same
   * transaction. The count is committed BEFORE the refusal is thrown — a
   * refusal thrown inside the transaction would roll the count back and make
   * the lockout guessable forever.
   */
  async enterCode(token: string, code: string): Promise<TelehealthCodeAccepted> {
    this.assertEnabled();
    const parsed = parseCaptureToken(token);
    if (!parsed) throw new NotFoundException({ code: 'link_invalid', message: 'This link is not valid.' });
    const pageKey = mintCaptureToken(parsed.practiceId);
    const limit = TELEHEALTH_CONTENT.code.wrongAttemptsBeforeLock;

    type Outcome = { ok: true } | { ok: false; refusal: TelehealthCodeRefused & { code: string }; status: number };
    const refuse = (status: number, outcome: TelehealthCodeRefused['outcome'], attemptsLeft: number | null, code: string = outcome): Outcome => ({
      ok: false,
      status,
      refusal: { code, outcome, attemptsLeft },
    });

    const outcome = await this.prisma.withPractice(parsed.practiceId, async (tx): Promise<Outcome> => {
      /*
       * THE ROW LOCK FIRST. Parallel guesses on one link queue here, so each
       * one reads the attempt count the last one committed. Without it, N
       * requests could all read "4 so far", all compare, and all be counted
       * as the fourth (review, 12 Oct 2026).
       */
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "telehealth_sessions" WHERE "linkTokenHash" = ${parsed.tokenHash} FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException({ code: 'link_invalid', message: 'This link is not valid.' });
      const session = await tx.telehealthSession.findFirstOrThrow({ where: { id: locked[0]!.id } });

      const state = this.linkState(session);
      if (state === 'locked') return refuse(423, 'locked', 0);
      if (state === 'used') return refuse(410, 'expired', null, 'link_used');
      if (state === 'closed') return refuse(410, 'expired', null, 'session_closed');
      if (state === 'expired' || (session.codeExpiresAt && session.codeExpiresAt < new Date())) {
        return refuse(410, 'expired', null, 'code_expired');
      }

      /*
       * COUNTED BEFORE IT IS COMPARED, and only while the code is not locked.
       * A right code is a try too; what matters is that no guess is ever
       * compared without having been counted.
       */
      const counted = await tx.$queryRaw<{ codeAttempts: number }[]>`
        UPDATE "telehealth_sessions" SET "codeAttempts" = "codeAttempts" + 1, "updatedAt" = now()
        WHERE "id" = ${session.id}::uuid AND "codeLockedAt" IS NULL
        RETURNING "codeAttempts"`;
      if (counted.length === 0) return refuse(423, 'locked', 0);
      const attempts = counted[0]!.codeAttempts;

      if (!(await telehealthCodeMatches((code ?? '').trim(), session.codeHash))) {
        if (attempts >= limit) {
          await tx.telehealthSession.update({
            where: { id: session.id },
            data: { codeLockedAt: new Date(), codeHash: null },
          });
          const task = await this.reviewTasks.raise(tx, {
            practiceId: parsed.practiceId,
            kind: TELEHEALTH_CODE_LOCKED_TASK_KIND,
            subjectType: 'TelehealthSession',
            subjectId: session.id,
            summary: `A telehealth link was locked after ${attempts} wrong codes. The provider can send a fresh link and code.`,
            detail: { attempts },
          });
          await this.record(tx, session.id, { principalType: 'system', id: 'core' }, {
            type: 'telehealth.code_locked_out',
            payload: { attempts, reviewTaskId: task.id },
          });
          return refuse(423, 'locked', 0);
        }
        /*
         * VAULTED WHEN IT HAPPENS (D-2026-10-12-02 ruling item 8), on this
         * same `tx` as the count above, so the count and its event commit
         * together or not at all (hard rule 11). Without it a wrong attempt
         * reached the vault only through a later `code_checked` or
         * `code_locked_out`, and a fresh send that resets the count lost it.
         * The attempt that reaches the limit is `code_locked_out` alone,
         * which already carries the count: one attempt, one event.
         */
        await this.record(tx, session.id, { principalType: 'system', id: 'core' }, {
          type: 'telehealth.code_wrong',
          payload: { attempts },
        });
        return refuse(400, 'wrong_code', limit - attempts);
      }

      const now = new Date();
      await tx.telehealthSession.update({
        where: { id: session.id },
        data: {
          linkConsumedAt: now,
          codeHash: null,
          codeCheckedAt: session.codeCheckedAt ?? now,
          state: session.state === 'opened' ? 'code_checked' : session.state,
          pageKeyHash: pageKey.tokenHash,
          pageKeyExpiresAt: new Date(now.getTime() + TELEHEALTH_CONTENT.page.pageHours * 3600_000),
        },
      });
      await this.record(tx, session.id, { principalType: 'system', id: 'core' }, {
        type: 'telehealth.code_checked',
        payload: { attempts },
      });
      return { ok: true };
    });

    // Thrown AFTER the transaction commits, so the count is never rolled back with the refusal.
    if (!outcome.ok) throw new HttpException(outcome.refusal, outcome.status);
    return { pageKey: pageKey.token };
  }

  /** The one page: the practice, the provider and one statement. */
  async page(pageKey: string | undefined): Promise<TelehealthPageView> {
    this.assertEnabled();
    const { practiceId, session } = await this.byPageKey(pageKey);
    return this.prisma.withPractice(practiceId, (tx) => this.pageView(tx, session));
  }

  /**
   * THE ONE BUTTON. The statement key must be the one the page was shown —
   * the server's words at the server's version, never text from the page.
   * Pressing twice is the same answer, not a second record.
   */
  async agree(
    pageKey: string | undefined,
    consentKey: string,
    consenter: { name?: string; mobile?: string } = {},
  ): Promise<TelehealthPageView> {
    this.assertEnabled();
    const { practiceId, session } = await this.byPageKey(pageKey);
    /*
     * SOMEONE ACTING FOR THE PATIENT NAMES THEMSELVES, WITH A MOBILE (Carl, 12 Oct
     * 2026, D-2026-10-12-03 item 12): their own declaration, made on their page
     * before the tick, and a number the practice can reach them on. The patient
     * agreeing for themselves is asked for neither.
     */
    const carer = session.consenterIsPatient === false;
    const consenterName = carer ? (consenter.name ?? '').trim().replace(/\s+/g, ' ') : null;
    const consenterMobile = carer ? normalisePhone(consenter.mobile ?? '') : null;
    if (carer && !isPlausibleConsenterName(consenterName ?? '')) {
      throw new BadRequestException({ code: 'consenter_name_needed', message: 'Type your full name.' });
    }
    if (carer && !isWellFormedMobile(consenterMobile ?? '')) {
      throw new BadRequestException({
        code: 'consenter_mobile_needed',
        message: 'Type a mobile number starting 04, so the practice can reach you.',
      });
    }
    if (consentKey !== TELEHEALTH_CONTENT.consent.key) {
      throw new ConflictException({
        code: 'wording_changed',
        message: 'The wording on this page has changed. Reload the page to read it again.',
      });
    }
    return this.prisma.withPractice(practiceId, async (tx) => {
      // The row lock first, so a double press and a practitioner's "not done" queue behind it.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "telehealth_sessions" WHERE "id" = ${session.id}::uuid FOR UPDATE`;
      const current = locked.length ? await tx.telehealthSession.findFirst({ where: { id: session.id } }) : null;
      if (current && current.pageKeyHash !== session.pageKeyHash) {
        // A fresh link was sent between the read and the press.
        throw new GoneException({
          code: 'page_replaced',
          message: 'A newer link was sent for this consultation. Open the latest message.',
        });
      }
      if (!current) {
        throw new NotFoundException({
          code: 'page_not_open',
          message: 'This page is no longer open. Ask the practitioner on the call for a new link.',
        });
      }
      if (current.state === 'agreed') return this.pageView(tx, current);
      if (current.state === 'not_done' || current.state === 'did_not_proceed' || current.state === 'went_ahead') {
        // Said by code, so the page shows what the practitioner recorded, not "the wording changed".
        throw new ConflictException({
          code: `session_${current.state}`,
          message: 'Your practitioner has already recorded this consultation.',
        });
      }
      this.assertMove(current.state, 'agreed');
      const updated = await tx.telehealthSession.update({
        where: { id: current.id },
        data: {
          state: 'agreed',
          agreedAt: new Date(),
          consenterName,
          consenterMobile,
          consentKey: TELEHEALTH_CONTENT.consent.key,
          contentVersion: TELEHEALTH_CONTENT_VERSION,
        },
      });
      await this.record(tx, current.id, { principalType: 'system', id: 'core' }, {
        type: 'telehealth.consent_recorded',
        payload: {
          consentKey: TELEHEALTH_CONTENT.consent.key,
          contentVersion: TELEHEALTH_CONTENT_VERSION,
          consenterIsPatient: current.consenterIsPatient ?? true,
        },
      });
      return this.pageView(tx, updated);
    });
  }

  /* ---------------------------------------------------------------------
   * Helpers
   * ------------------------------------------------------------------ */

  private async record(
    tx: Prisma.TransactionClient,
    sessionId: string,
    actor: { principalType: string; id: string },
    event: TelehealthVaultEvent,
  ) {
    await this.evidence.record(tx, { event, actor, subject: { type: 'TelehealthSession', id: sessionId } });
  }

  private async dispatch(
    tx: Prisma.TransactionClient,
    practiceId: string,
    session: TelehealthSession,
    patient: { id: string; givenNames: string; familyName: string; mobile: string | null; email: string | null },
    channel: TelehealthChannel,
    token: string,
    expiresAt: Date,
  ) {
    const practice = await tx.practice.findFirst({ select: { name: true } });
    const provider = await telehealthProvider(tx, session.practitionerId);
    return this.dispatcher.send(tx, {
      practiceId,
      practiceName: practice?.name ?? 'Your practice',
      providerName: provider?.name ?? 'your practitioner',
      ahpraNumber: provider?.ahpraNumber ?? null,
      consultationId: session.consultationId,
      sessionId: session.id,
      sendNumber: session.linkSentCount,
      patient,
      channel,
      token,
      expiresOn: expiresAt.toISOString(),
    });
  }

  /**
   * THE SESSION, LOCKED FOR THIS TRANSACTION. Every write that reads a state
   * and then moves it takes the row lock first — as `enterCode` does — so a
   * "not done" pressed while the patient presses the button, or a fresh link
   * sent while the code is being typed, queue rather than overwrite each other
   * (review, 12 Oct 2026). RLS hides another practice's session; the
   * practitioner filter hides a colleague's.
   */
  private async ownSession(tx: Prisma.TransactionClient, sessionId: string, practitionerId: string) {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "telehealth_sessions"
      WHERE "id" = ${sessionId}::uuid AND "practitionerId" = ${practitionerId}::uuid
      FOR UPDATE`;
    if (locked.length === 0) {
      throw new NotFoundException('There is no telehealth session of yours with that id at this practice.');
    }
    return tx.telehealthSession.findFirstOrThrow({ where: { id: sessionId } });
  }

  private async byPageKey(pageKey: string | undefined) {
    const notOpen = () =>
      new NotFoundException({
        code: 'page_not_open',
        message: 'This page is not open. Ask the practitioner on the call for a new link.',
      });
    const parsed = pageKey ? parseCaptureToken(pageKey) : null;
    if (!parsed) throw notOpen();
    const session = await this.prisma.withPractice(parsed.practiceId, (tx) =>
      tx.telehealthSession.findFirst({
        where: { OR: [{ pageKeyHash: parsed.tokenHash }, { retiredPageKeyHash: parsed.tokenHash }] },
      }),
    );
    if (!session) throw notOpen();
    if (session.pageKeyHash !== parsed.tokenHash) {
      throw new GoneException({
        code: 'page_replaced',
        message: 'A newer link was sent for this consultation. Open the latest message.',
      });
    }
    if (session.pageKeyExpiresAt && session.pageKeyExpiresAt < new Date()) {
      throw new GoneException({ code: 'page_expired', message: 'This page has closed. Ask your practice for a new link.' });
    }
    return { practiceId: parsed.practiceId, session };
  }

  private async pageView(tx: Prisma.TransactionClient, session: TelehealthSession): Promise<TelehealthPageView> {
    const practice = await tx.practice.findFirst({ select: { name: true } });
    const provider = await telehealthProvider(tx, session.practitionerId);
    const providerName = provider?.name ?? null;
    const consenterIsPatient = session.consenterIsPatient ?? true;
    // After the code only: the patient's own name in their statement, the given names in a carer's.
    const patient = await tx.patient.findFirst({ where: { id: session.patientId }, select: { givenNames: true, familyName: true } });
    return {
      state: session.state as TelehealthPageView['state'],
      practiceName: practice?.name ?? null,
      providerName,
      ahpraNumber: provider?.ahpraNumber ?? null,
      consultationId: session.consultationId,
      statement: telehealthConsentStatement({
        providerName: providerName ?? 'your practitioner',
        consenterIsPatient,
        patientGivenNames: patient?.givenNames,
        patientName: patient ? `${patient.givenNames} ${patient.familyName}` : undefined,
        relationshipKey: session.consenterRelationship,
        // The name the person typed, once agreed; before that the slot stays for the page to fill.
        consenterName: session.consenterName ?? undefined,
      }),
      consentKey: TELEHEALTH_CONTENT.consent.key,
      contentVersion: TELEHEALTH_CONTENT_VERSION,
      consenterIsPatient,
      agreedAt: session.agreedAt?.toISOString() ?? null,
    };
  }

  private linkState(session: TelehealthSession): TelehealthLinkLanding['state'] {
    if (!TELEHEALTH_LINK_STATES.includes(session.state as TelehealthSessionState)) return 'closed';
    if (session.codeLockedAt) return 'locked';
    if (session.linkConsumedAt) return 'used';
    if (!session.linkExpiresAt || session.linkExpiresAt < new Date()) return 'expired';
    return 'open';
  }

  /**
   * THE APPROVED SIX, AT LEAST THREE — AND THE REFUSAL NEVER REPEATS WHAT WAS
   * SENT. The domain guard's own message quotes the offending entry; a value
   * that should never have been typed must not come back in an error, a log
   * line or a screen (hard rule 9).
   */
  private assertIdentifierTypes(types: readonly string[]): void {
    if (!Array.isArray(types) || !types.every((t) => typeof t === 'string' && isApprovedIdentifierType(t))) {
      throw new BadRequestException({
        code: 'identifier_type_not_approved',
        message:
          'Only the approved identifier types can be ticked: name, date of birth, gender, address, patient record ' +
          'number and IHI. The Medicare card number is not one of them.',
      });
    }
    try {
      assertValidIdentifierSet(types);
    } catch (err) {
      if (err instanceof IdentifierSetError) {
        throw new BadRequestException({
          code: 'identifier_types_too_few',
          message: 'Tick at least three of the approved identifier types you checked on the call.',
        });
      }
      throw err;
    }
  }

  private channelOf(raw: string): TelehealthChannel {
    if (!(TELEHEALTH_CHANNELS as readonly string[]).includes(raw)) {
      throw new BadRequestException(`The channel must be one of ${TELEHEALTH_CHANNELS.join(', ')}.`);
    }
    return raw as TelehealthChannel;
  }

  /** Hard rule 10, as far as this step goes: someone acting for another says who they are to the patient, and is 18+. */
  private assertConsenter(input: { consenterIsPatient: boolean; consenterRelationship?: string; consenterAttested18?: boolean }) {
    if (typeof input.consenterIsPatient !== 'boolean') {
      throw new BadRequestException('Say whether the patient or somebody acting for them is on the call.');
    }
    if (input.consenterIsPatient) return;
    if (!input.consenterRelationship || !ASSIGNOR_RELATIONSHIP_KEYS.includes(input.consenterRelationship)) {
      throw new BadRequestException('Choose how the person on the call is related to the patient.');
    }
    if (input.consenterAttested18 !== true) {
      throw new BadRequestException('Someone acting for the patient must be 18 or over. Tick the box once they have confirmed it.');
    }
  }

  /** Names the transport the record lacks — true for THIS record, and the fix that is true for it (wow.md §13). */
  private assertContactFor(channel: TelehealthChannel, patient: { mobile: string | null; email: string | null }) {
    const missing: string[] = [];
    if ((channel === 'sms' || channel === 'both') && !maskMobile(patient.mobile)) missing.push('mobile number');
    if ((channel === 'email' || channel === 'both') && !maskEmail(patient.email)) missing.push('email address');
    if (missing.length > 0) {
      throw new ConflictException({
        code: 'no_contact_on_file',
        message:
          `This patient’s record holds no ${missing.join(' or ')}, so the link cannot go that way. Correct it in ` +
          'the practice management system and it syncs through, or choose the other channel, or record this step ' +
          'as not done: no contact on file.',
      });
    }
  }

  private reasonOf(input: { reason: string; note?: string }): { reason: string; note: string | null } {
    const reason = telehealthNotDoneReason(input.reason);
    if (!reason) throw new BadRequestException('Choose one of the listed reasons.');
    const note = input.note?.trim() ? input.note.trim() : null;
    if (!reason.takesNote) {
      if (note) throw new BadRequestException('Only the reason “other” takes a note.');
      return { reason: reason.key, note: null };
    }
    if (!note) throw new BadRequestException('Say briefly why, in a few words.');
    if (note.length > TELEHEALTH_NOT_DONE_NOTE_MAX) {
      throw new BadRequestException(`Keep the note to ${TELEHEALTH_NOT_DONE_NOTE_MAX} characters.`);
    }
    if (NOTE_LOOKS_LIKE_A_VALUE.test(note) || /\d{6,}/.test(note.replace(/[\s\-\u2010-\u2015]/g, ''))) {
      throw new BadRequestException(
        'The note looks like it holds a number or an email address. Describe the reason without any identifiers.',
      );
    }
    return { reason: reason.key, note };
  }

  private consultationAtOf(raw: string | undefined): Date | null {
    if (!raw) return null;
    const at = new Date(raw);
    if (Number.isNaN(at.getTime())) throw new BadRequestException('The consultation time is not a date and time.');
    if (at.getTime() > Date.now() + 24 * 3600_000) {
      throw new BadRequestException('The consultation time is more than a day ahead. Record it once it has happened.');
    }
    return at;
  }

  private assertMove(from: string, to: TelehealthSessionState) {
    if (!isTelehealthSessionState(from) || !mayMoveTelehealthSession(from, to)) {
      throw new ConflictException(`This session is already ${from.replace(/_/g, ' ')}.`);
    }
  }

  private async views(tx: Prisma.TransactionClient, rows: TelehealthSession[]): Promise<TelehealthSessionView[]> {
    const patients = await tx.patient.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.patientId))] } },
      select: { id: true, givenNames: true, familyName: true },
    });
    const byId = new Map(patients.map((p) => [p.id, p]));
    const limit = TELEHEALTH_CONTENT.code.wrongAttemptsBeforeLock;
    return rows.map((row) => {
      const p = byId.get(row.patientId);
      return {
        id: row.id,
        consultationId: row.consultationId,
        patientId: row.patientId,
        patientName: p ? `${p.givenNames} ${p.familyName}` : '',
        state: row.state as TelehealthSessionView['state'],
        channel: (row.channel as TelehealthSessionView['channel']) ?? null,
        identifierTypes: row.identifierTypes,
        consenterIsPatient: row.consenterIsPatient,
        codeExpiresAt: row.codeExpiresAt?.toISOString() ?? null,
        pageExpiresAt: row.pageKeyExpiresAt?.toISOString() ?? null,
        codeLocked: row.codeLockedAt !== null,
        codeAttemptsLeft: row.linkSentCount ? Math.max(0, limit - row.codeAttempts) : null,
        linkSentCount: row.linkSentCount,
        codeCheckedAt: row.codeCheckedAt?.toISOString() ?? null,
        agreedAt: row.agreedAt?.toISOString() ?? null,
        notDoneReason: row.notDoneReason,
        notDoneNote: row.notDoneNote,
        consenterName: row.consenterName,
        consenterMobile: row.consenterMobile,
        consultationAt: row.consultationAt?.toISOString() ?? null,
        outcomeRecordedAt: row.outcomeRecordedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        contentVersion: row.contentVersion,
      };
    });
  }
}
