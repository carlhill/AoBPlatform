import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  assertChaseAttemptAllowed,
  assertChaseSubjectChaseable,
  attemptAllowed,
  chaseAttemptOrdinal,
  chaseBandFor,
  chaseNextStep,
  ChaseAttemptError,
  daysRemainingInLodgementWindow,
  LODGEMENT_WINDOW_DAYS,
  type ChaseAttemptSubjectType,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import type { Prisma } from '@prisma/client';
import type { Actor } from '../auth/actor.decorator';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordChaseAttemptInput {
  subjectType: string;
  subjectId: string;
  channel: string;
  outcome: string;
  contactedPartyType?: string | null;
  note?: string | null;
  /** When the contact happened, if it is being written down afterwards. */
  occurredAt?: string | null;
  /** The attempt this one corrects. */
  supersedesId?: string | null;
}

/**
 * The subject, resolved: which record was chased, which agreement (if any) it
 * hangs off, and the service date the whole lodgement window is measured from.
 */
interface ResolvedSubject {
  subjectType: ChaseAttemptSubjectType;
  subjectId: string;
  agreementId: string | null;
  serviceRecordId: string | null;
  serviceDate: Date | null;
}

/**
 * M7 — the human half of the chase (Carl, 3 Sep 2026).
 *
 * ONE LADDER, TWO KINDS OF CLIMBER. REQ-CHASE-05's escalation column
 * alternates between `ai` and `human`, so a staff phone call and an automated
 * capture link are rungs on the SAME ladder — counted together, capped
 * together, stopped together at the deadline. Every band question here is put
 * to `chase.ts`, the same functions the automated cascade asks; nothing about
 * the ladder is restated.
 *
 * MODULE BOUNDARY. This reads `service_records`, `agreements` and
 * `capture_requests` directly, as `ReconciliationService` does, because it is
 * the same M7 story: the ladder context this module must show is exactly the
 * context the reconciliation item detail shows. Going through
 * ReconciliationService instead would make the dependency circular the moment
 * the queue wants to display attempts — which is the next thing it will want.
 */
@Injectable()
export class ChaseAttemptsService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveSubject(
    tx: Prisma.TransactionClient,
    subjectType: string,
    subjectId: string,
  ): Promise<ResolvedSubject> {
    try {
      assertChaseSubjectChaseable(subjectType);
    } catch (err) {
      if (err instanceof ChaseAttemptError) throw new BadRequestException(err.message);
      throw err;
    }

    if (subjectType === 'ServiceRecord') {
      // RLS scopes this query, so another practice's record is simply not
      // there — the cross-practice answer is 404, never 403 with a hint.
      const record = await tx.serviceRecord.findFirst({ where: { id: subjectId } });
      if (!record) throw new NotFoundException('Service record not found.');
      return {
        subjectType,
        subjectId,
        agreementId: record.agreementId,
        serviceRecordId: record.id,
        serviceDate: record.serviceDate,
      };
    }

    const agreement = await tx.agreement.findFirst({ where: { id: subjectId } });
    if (!agreement) throw new NotFoundException('Agreement not found.');
    const record = await tx.serviceRecord.findFirst({ where: { agreementId: agreement.id } });
    return {
      subjectType: 'Agreement',
      subjectId,
      agreementId: agreement.id,
      serviceRecordId: record?.id ?? null,
      // No billed service yet means no lodgement window running: nothing can
      // have expired, so the band is read as a full window rather than guessed
      // from the agreement's own dates, which measure nothing statutory.
      serviceDate: record?.serviceDate ?? null,
    };
  }

  /** Both halves of the same trail: the service record and its agreement. */
  private subjectKeys(subject: ResolvedSubject): { subjectType: string; subjectId: string }[] {
    const keys: { subjectType: string; subjectId: string }[] = [];
    if (subject.serviceRecordId) keys.push({ subjectType: 'ServiceRecord', subjectId: subject.serviceRecordId });
    if (subject.agreementId) keys.push({ subjectType: 'Agreement', subjectId: subject.agreementId });
    if (keys.length === 0) keys.push({ subjectType: subject.subjectType, subjectId: subject.subjectId });
    return keys;
  }

  private daysRemainingFor(subject: ResolvedSubject): number {
    return subject.serviceDate ? daysRemainingInLodgementWindow(subject.serviceDate) : LODGEMENT_WINDOW_DAYS;
  }

  private async attemptsFor(tx: Prisma.TransactionClient, subject: ResolvedSubject) {
    const keys = this.subjectKeys(subject);
    const human = await tx.chaseAttempt.findMany({
      where: { OR: keys.map((k) => ({ subjectType: k.subjectType, subjectId: k.subjectId })) },
      orderBy: { occurredAt: 'asc' },
    });
    const supersededIds = new Set(human.map((a) => a.supersedesId).filter((id): id is string => id !== null));
    // A capture request is the platform's own attempt. It counts on the same
    // ladder — three unanswered links and a phone call is four attempts, not
    // one plus three.
    const automated = subject.agreementId
      ? await tx.captureRequest.count({ where: { agreementId: subject.agreementId } })
      : 0;
    return { human, supersededIds, automated, live: human.filter((a) => !supersededIds.has(a.id)).length };
  }

  private shape(row: {
    id: string;
    subjectType: string;
    subjectId: string;
    channel: string;
    outcome: string;
    contactedPartyType: string | null;
    note: string | null;
    attemptedBy: string;
    attemptedById: string;
    occurredAt: Date;
    recordedAt: Date;
    band: string;
    daysRemaining: number;
    attemptOrdinal: number;
    supersedesId: string | null;
  }) {
    return {
      id: row.id,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      channel: row.channel,
      outcome: row.outcome,
      contactedPartyType: row.contactedPartyType,
      note: row.note,
      by: row.attemptedBy,
      byId: row.attemptedById,
      occurredAt: row.occurredAt.toISOString(),
      recordedAt: row.recordedAt.toISOString(),
      band: row.band,
      daysRemaining: row.daysRemaining,
      attemptOrdinal: row.attemptOrdinal,
      supersedesId: row.supersedesId,
    };
  }

  /**
   * The trail: every human attempt against this service record and its
   * agreement, plus what the ladder makes of it.
   *
   * Superseded rows STAY, flagged. An audit trail that quietly drops the
   * version somebody first relied on is not an audit trail.
   */
  async trail(practiceId: string, subjectType: string, subjectId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const subject = await this.resolveSubject(tx, subjectType, subjectId);
      const { human, supersededIds, automated, live } = await this.attemptsFor(tx, subject);
      const daysRemaining = this.daysRemainingFor(subject);
      const policy = chaseBandFor(daysRemaining);
      const attemptsMade = automated + live;

      return {
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        serviceRecordId: subject.serviceRecordId,
        agreementId: subject.agreementId,
        serviceDate: subject.serviceDate ? subject.serviceDate.toISOString().slice(0, 10) : null,
        daysRemaining,
        band: policy.band,
        policy: {
          band: policy.band,
          attempts: policy.attempts,
          attemptWindowHours: policy.attemptWindowHours,
          escalation: policy.escalation,
          handback: policy.handback,
        },
        /** Automated and human together — one ladder. */
        attemptsMade,
        automatedAttempts: automated,
        humanAttempts: live,
        attemptAllowed: attemptAllowed({ attemptsMade, daysRemaining }),
        nextStep: chaseNextStep(policy, attemptsMade),
        attempts: human.map((row) => ({ ...this.shape(row), superseded: supersededIds.has(row.id) })),
      };
    });
  }

  /**
   * Record what a person did.
   *
   * The person comes from the session and nowhere else: a name in a request
   * body is an assertion by the sender, and once it is in an append-only table
   * it is indistinguishable from a checked one (see `actor.decorator.ts`).
   *
   * The row and its vault event are written in ONE transaction (rule 11,
   * FR-11.2) — an attempt without evidence, or evidence without an attempt,
   * is structurally impossible rather than merely unlikely.
   */
  async record(practiceId: string, input: RecordChaseAttemptInput, actor?: Actor) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const subject = await this.resolveSubject(tx, input.subjectType, input.subjectId);
      const { supersededIds, automated, live } = await this.attemptsFor(tx, subject);
      const daysRemaining = this.daysRemainingFor(subject);
      const policy = chaseBandFor(daysRemaining);

      const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
      if (Number.isNaN(occurredAt.getTime())) {
        throw new BadRequestException('occurredAt is not a date.');
      }
      if (occurredAt.getTime() > Date.now() + 60_000) {
        throw new BadRequestException('A chase attempt is recorded after it happened, not before.');
      }

      const supersedesId = input.supersedesId?.trim() || null;
      if (supersedesId) {
        const target = await tx.chaseAttempt.findFirst({ where: { id: supersedesId } });
        if (!target) throw new NotFoundException('The attempt being corrected was not found.');
        if (supersededIds.has(target.id)) {
          throw new BadRequestException('That attempt has already been corrected. Correct the correction instead.');
        }
      }

      const attemptsMade = automated + live;
      try {
        assertChaseAttemptAllowed({
          subjectType: subject.subjectType,
          channel: input.channel,
          outcome: input.outcome,
          contactedPartyType: input.contactedPartyType,
          attemptedBy: actor?.name,
          note: input.note,
          supersedes: supersedesId,
          attemptsMade,
          daysRemaining,
        });
      } catch (err) {
        if (err instanceof ChaseAttemptError) throw new BadRequestException(err.message);
        throw err;
      }

      const ordinal = supersedesId
        ? ((await tx.chaseAttempt.findFirst({ where: { id: supersedesId } }))?.attemptOrdinal ?? chaseAttemptOrdinal(attemptsMade))
        : chaseAttemptOrdinal(attemptsMade);

      const row = await tx.chaseAttempt.create({
        data: {
          practiceId,
          subjectType: subject.subjectType,
          subjectId: subject.subjectId,
          channel: input.channel,
          outcome: input.outcome,
          contactedPartyType: input.contactedPartyType?.trim() || null,
          note: input.note?.trim() || null,
          // FROM THE SESSION. Never from the body.
          attemptedBy: actor!.name,
          attemptedById: actor!.id,
          occurredAt,
          band: policy.band,
          daysRemaining,
          attemptOrdinal: ordinal,
          supersedesId,
        },
      });

      /*
       * The payload carries TYPES AND OUTCOMES ONLY (REQ-VER-04, REQ-LOG-08):
       * which channel, what came of it, who by role, where the ladder stood.
       * The note stays out of it — a staff note about a phone call is the one
       * field on this row likely to quote a patient, and the vault event is
       * the copy that travels furthest.
       */
      await enqueueVaultEvent(tx, {
        type: 'chase.attempted',
        actor: { principalType: actor!.principalType || 'staff', id: actor!.id },
        subject: { type: subject.subjectType, id: subject.subjectId },
        payload: {
          channel: input.channel,
          outcome: input.outcome,
          contactedPartyType: input.contactedPartyType?.trim() || '',
          by: 'human',
          attemptedBy: actor!.name,
          band: policy.band,
          daysRemaining,
          attemptOrdinal: ordinal,
          attemptsMadeBefore: attemptsMade,
          automatedAttemptsBefore: automated,
          noteRecorded: Boolean(input.note?.trim()),
          supersedes: supersedesId ?? '',
          occurredAt: occurredAt.toISOString(),
          agreementId: subject.agreementId ?? '',
          serviceRecordId: subject.serviceRecordId ?? '',
        },
      });

      return this.shape(row);
    });
  }
}
