import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  MANUAL_REVIEW_RESOLUTIONS,
  REVIEW_CLAIM_MINUTES,
  REVIEW_TASK_KEYS,
  isTaskClaimable,
  mayAutoResolve,
  reinvitationAttribution,
  resolutionAttribution,
  reviewTaskKind,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../auth/actor.decorator';

/**
 * Work arriving into the platform that needs a second look.
 *
 * Read packages/domain/src/review-tasks.ts for why this is separate from the
 * outbound queue and what an automated check may and may not close.
 *
 * THE TASK IS NOT THE EVIDENCE. The amendment record already holds what
 * changed, who changed it and why. What is evidence is the RESOLUTION —
 * somebody looked at this and accepted it — and that goes to the vault, so a
 * task row is prunable while the decision is not.
 */
@Injectable()
export class ReviewTasksService {
  private readonly logger = new Logger(ReviewTasksService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Raise one.
   *
   * TAKES A TRANSACTION, for the same reason the outbound enqueue does: the
   * thing that needs reviewing and the task asking somebody to review it must
   * commit together. A change that saved without raising its task is a change
   * nobody will look at, and it would look exactly like a change nobody needed
   * to look at.
   */
  async raise(
    tx: Prisma.TransactionClient,
    input: {
      practiceId: string;
      kind: string;
      subjectType: string;
      subjectId: string;
      summary: string;
      detail?: Record<string, unknown>;
      raisedBy?: string;
    },
  ) {
    if (!REVIEW_TASK_KEYS.includes(input.kind as never)) {
      throw new BadRequestException(
        `"${input.kind}" is not a review task kind. One of: ${REVIEW_TASK_KEYS.join(', ')}.`,
      );
    }
    return tx.reviewTask.create({
      data: {
        practiceId: input.practiceId,
        kind: input.kind,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        summary: input.summary,
        detail: (input.detail ?? {}) as Prisma.InputJsonValue,
        raisedBy: input.raisedBy ?? 'system',
      },
    });
  }

  /**
   * THE PATIENT-SUBJECT TASKS OF ONE KIND, FOR THE SCREEN THAT IS ABOUT A
   * PERSON (Carl, 4 Sep 2026: "what happens when the button is pressed" — the
   * answer must be that it appears on that patient's work page, not only on
   * the review queue).
   *
   * IT IS A METHOD RATHER THAN A QUERY IN `PatientsModule`, because module
   * boundaries are enforced and `review_tasks` is this module's table
   * (CLAUDE.md §4). Reception's queue asks a question; it does not reach in.
   *
   * OPEN MEANS OPEN OR CLAIMED — a task somebody has picked up is still work
   * the patient is waiting on, and hiding it the moment a colleague claimed it
   * would make the desk think it was done.
   */
  async openForPatients(practiceId: string, kind: string, patientIds?: readonly string[]) {
    return this.prisma.withPractice(practiceId, (tx) =>
      tx.reviewTask.findMany({
        where: {
          practiceId,
          kind,
          subjectType: 'Patient',
          state: { in: ['open', 'claimed'] },
          ...(patientIds ? { subjectId: { in: [...patientIds] } } : {}),
        },
        orderBy: { raisedAt: 'asc' },
      }),
    );
  }

  /**
   * EVERY TASK OF ONE KIND ABOUT ONE PATIENT, open or decided — what the work
   * page's history reads. The RESOLUTION is the half that matters there: "a
   * patient asked and somebody dealt with it" is a different fact from "a
   * detail was corrected", and only the first answers what the patient will
   * ask next time.
   */
  async forPatient(practiceId: string, kind: string, patientId: string) {
    return this.prisma.withPractice(practiceId, (tx) =>
      tx.reviewTask.findMany({
        where: { practiceId, kind, subjectType: 'Patient', subjectId: patientId },
        orderBy: { raisedAt: 'asc' },
      }),
    );
  }

  /** The queue, for a reviewer. */
  async list(practiceId: string | undefined, filter: { state?: string; kind?: string; take?: number } = {}) {
    if (!practiceId) throw new BadRequestException('Choose a practice first.');
    return this.prisma.withPractice(practiceId, async (tx) => {
      const where: Record<string, unknown> = { practiceId };
      if (filter.kind) where.kind = filter.kind;
      if (filter.state) where.state = filter.state;
      else where.state = { in: ['open', 'claimed'] };

      const tasks = await tx.reviewTask.findMany({
        where,
        orderBy: { raisedAt: 'asc' },
        take: filter.take ?? 100,
      });
      const now = new Date();
      return {
        tasks: tasks.map((t) => ({
          ...t,
          claimable: isTaskClaimable(t, now),
          kindLabel: reviewTaskKind(t.kind)?.label ?? t.kind,
          question: reviewTaskKind(t.kind)?.question ?? null,
          stakes: reviewTaskKind(t.kind)?.stakes ?? 'high',
        })),
        count: tasks.length,
      };
    });
  }

  /** Take one, so two reviewers do not work it at once. */
  async claim(practiceId: string, id: string, actor?: Actor) {
    if (!actor) throw new BadRequestException('Claiming a review records who took it, so it needs a signed-in user.');
    return this.prisma.withPractice(practiceId, async (tx) => {
      const task = await tx.reviewTask.findFirst({ where: { id } });
      if (!task) throw new NotFoundException('That task is not in this practice.');
      if (!isTaskClaimable(task, new Date())) {
        throw new BadRequestException(`Somebody else is already reviewing this (${task.claimedBy}).`);
      }
      return tx.reviewTask.update({
        where: { id },
        data: {
          state: 'claimed',
          claimedBy: actor.name,
          claimExpiresAt: new Date(Date.now() + REVIEW_CLAIM_MINUTES * 60_000),
        },
      });
    });
  }

  /**
   * A person decides.
   *
   * `resolvedAutomatically` is FALSE here and cannot be set by a caller. The
   * only path that sets it true is `recordAutomatedCheck`, which applies the
   * domain rule first. Keeping the two apart is what stops a future caller
   * writing "reviewed by a person" for something no person saw.
   */
  async resolve(
    practiceId: string,
    id: string,
    input: { resolution: string; note?: string },
    actor?: Actor,
  ) {
    if (!actor) throw new BadRequestException('Resolving a review records who decided, so it needs a signed-in user.');
    /*
     * THE MANUAL LIST. `reinvited` is written by `resolveReinvited` alone,
     * because it records that a new invitation actually went out — not that
     * somebody decided one should (Carl, 5 Sep 2026).
     */
    if (!MANUAL_REVIEW_RESOLUTIONS.includes(input.resolution as never)) {
      throw new BadRequestException(
        `"${input.resolution}" is not a resolution a person may choose. One of: ${MANUAL_REVIEW_RESOLUTIONS.join(', ')}.`,
      );
    }
    return this.prisma.withPractice(practiceId, async (tx) => {
      const task = await tx.reviewTask.findFirst({ where: { id } });
      if (!task) throw new NotFoundException('That task is not in this practice.');
      if (task.state === 'resolved' || task.state === 'dismissed') {
        throw new BadRequestException('That task has already been decided.');
      }

      const updated = await tx.reviewTask.update({
        where: { id },
        data: {
          state: input.resolution === 'escalated' ? 'open' : 'resolved',
          resolution: input.resolution,
          resolvedBy: actor.name,
          resolvedAt: new Date(),
          resolvedNote: input.note?.trim() || null,
          resolvedAutomatically: false,
          // Escalating hands it back, so the claim must go with it.
          claimedBy: input.resolution === 'escalated' ? null : task.claimedBy,
          claimExpiresAt: input.resolution === 'escalated' ? null : task.claimExpiresAt,
        },
      });

      /*
       * THE DECISION IS THE EVIDENCE, so it goes to the vault. The task row
       * can be pruned; this cannot.
       */
      await enqueueVaultEvent(tx, {
        type: 'review_task.resolved',
        actor: { principalType: 'staff', id: actor.id },
        subject: { type: task.subjectType, id: task.subjectId },
        payload: {
          reviewTaskId: task.id,
          kind: task.kind,
          resolution: input.resolution,
          attribution: resolutionAttribution({ automated: false, by: actor.name }),
          ...(input.note?.trim() ? { note: input.note.trim() } : {}),
        },
      });

      return updated;
    });
  }

  /**
   * THE CORRECTION WAS MADE, SO THE PATIENT'S REQUEST IS ANSWERED (Carl,
   * 4 Sep 2026).
   *
   * WHY SAVING CLOSES IT RATHER THAN LEAVING A SECOND STEP. Reception confirmed
   * the value with the patient and typed it in; asking them to then find the
   * task and tick it as well is how a queue fills up with work that was
   * actually done. The "Mark as done" control on the work page still exists for
   * the other outcome — the value we hold turned out to be right, or the change
   * belongs in the PMS alone.
   *
   * ONLY THE TASKS THIS CORRECTION ANSWERS. A patient who asked about their
   * mobile and had their address corrected is still waiting, and the task says
   * so. The match is on the detail TYPE the request carried, never on a value.
   *
   * IT RESOLVES THROUGH `resolve`, so every closure is a person's, is recorded
   * against them, and writes the same `review_task.resolved` event as any
   * other. There is no second closing path with weaker evidence.
   */
  async resolveCorrectionRequests(
    practiceId: string,
    patientId: string,
    detailTypes: readonly string[],
    actor: Actor | undefined,
  ): Promise<string[]> {
    if (!actor || detailTypes.length === 0) return [];
    const open = await this.openForPatients(practiceId, 'portal_correction_requested', [patientId]);
    const closed: string[] = [];
    for (const task of open) {
      const detail = (task.detail ?? {}) as Record<string, unknown>;
      const fieldType = typeof detail.fieldType === 'string' ? detail.fieldType : null;
      if (!fieldType || !detailTypes.includes(fieldType)) continue;
      await this.resolve(
        practiceId,
        task.id,
        {
          resolution: 'corrected',
          // A NOTE ABOUT THE TYPE, NEVER THE VALUE (REQ-VER-04, hard rule 9).
          note: `Corrected at the practice: ${fieldType.replace(/_/g, ' ')}.`,
        },
        actor,
      );
      closed.push(task.id);
    }
    return closed;
  }

  /**
   * A NEW INVITATION WENT, SO THE LOCKED ONE IS NO LONGER WAITING ON ANYBODY
   * (Carl, 5 Sep 2026).
   *
   * IT TAKES THE MINT'S OWN TRANSACTION, exactly as `raise` does and for the
   * mirror-image reason: an invitation that was minted while the task asking
   * for one stayed open would leave reception chasing a thing that had already
   * been done, and the two rows must move together or not at all.
   *
   * IT IS NOT `resolve`. That path records a PERSON'S DECISION about something
   * they read; nobody read this, and nothing was assessed — the lock was
   * replaced. `reinvited` is off the manual resolution list for the same
   * reason, so this is the only code that can write it, and the attribution
   * says plainly what happened (`reinvitationAttribution`).
   *
   * OPEN MEANS OPEN OR CLAIMED. A colleague who picked the task up is not a
   * reason to leave it open once the remedy has been performed.
   */
  async resolveReinvited(
    tx: Prisma.TransactionClient,
    input: { practiceId: string; patientId: string; by: string; invitationId: string },
  ): Promise<string[]> {
    const open = await tx.reviewTask.findMany({
      where: {
        practiceId: input.practiceId,
        kind: 'portal_activation_locked',
        subjectType: 'Patient',
        subjectId: input.patientId,
        state: { in: ['open', 'claimed'] },
      },
      orderBy: { raisedAt: 'asc' },
    });

    const closed: string[] = [];
    for (const task of open) {
      await tx.reviewTask.update({
        where: { id: task.id },
        data: {
          state: 'resolved',
          resolution: 'reinvited',
          resolvedBy: input.by,
          resolvedAt: new Date(),
          resolvedNote: 'A new portal invitation was minted for this patient.',
          resolvedAutomatically: false,
        },
      });

      await enqueueVaultEvent(tx, {
        type: 'review_task.resolved',
        actor: { principalType: input.by === 'system' ? 'system' : 'staff', id: input.by },
        subject: { type: task.subjectType, id: task.subjectId },
        payload: {
          reviewTaskId: task.id,
          kind: task.kind,
          resolution: 'reinvited',
          attribution: reinvitationAttribution(input.by),
          // The id of the invitation that replaced the locked one. No token,
          // no hash, no identifier type and no value (REQ-LOG-08, hard rule 9).
          replacedByInvitationId: input.invitationId,
        },
      });
      closed.push(task.id);
    }
    return closed;
  }

  /**
   * An automated check reports.
   *
   * IT ALWAYS RECORDS ITS OPINION. Whether it may also CLOSE the task is the
   * domain's decision, and it turns on three things: the kind is low-stakes,
   * the check is confident, and it found nothing. A confident check that DID
   * find something is exactly the case that must reach a person — the model
   * has done its job by flagging it.
   *
   * When it is not allowed to close, the verdict stays on the task and a human
   * sees it alongside the diff. That is the useful shape: the reviewer starts
   * with an opinion rather than a blank page, and is still the one deciding.
   */
  async recordAutomatedCheck(
    practiceId: string,
    id: string,
    input: { verdict: string; confidence: number; reasoning: string; foundConcern: boolean; checkedBy: string },
  ) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const task = await tx.reviewTask.findFirst({ where: { id } });
      if (!task) throw new NotFoundException('That task is not in this practice.');
      if (task.state === 'resolved' || task.state === 'dismissed') return task;

      const canClose = mayAutoResolve({
        kindKey: task.kind,
        confidence: input.confidence,
        foundConcern: input.foundConcern,
      });

      const updated = await tx.reviewTask.update({
        where: { id },
        data: {
          autoVerdict: input.verdict,
          autoConfidence: input.confidence,
          autoReasoning: input.reasoning.slice(0, 4000),
          autoCheckedBy: input.checkedBy,
          autoCheckedAt: new Date(),
          ...(canClose
            ? {
                state: 'resolved',
                resolution: 'no_change_needed',
                resolvedBy: input.checkedBy,
                resolvedAt: new Date(),
                resolvedAutomatically: true,
              }
            : {}),
        },
      });

      if (canClose) {
        await enqueueVaultEvent(tx, {
          type: 'review_task.resolved',
          actor: { principalType: 'system', id: input.checkedBy },
          subject: { type: task.subjectType, id: task.subjectId },
          payload: {
            reviewTaskId: task.id,
            kind: task.kind,
            resolution: 'no_change_needed',
            /*
             * Says plainly that nobody looked. A reader in two years must be
             * able to tell a human decision from an automated one without
             * knowing which kinds were automatable at the time.
             */
            attribution: resolutionAttribution({
              automated: true,
              by: input.checkedBy,
              confidence: input.confidence,
            }),
            confidence: input.confidence,
          },
        });
      } else if (input.foundConcern) {
        this.logger.warn(
          `Review task ${id} (${task.kind}): automated check flagged a concern and is NOT allowed to close it. ` +
            'Waiting for a person.',
        );
      }

      return updated;
    });
  }

  /** Which practices have work waiting. Counts only — see the migration. */
  async duePractices(limit = 200) {
    return this.prisma.$queryRaw<Array<{ practiceId: string; waiting: bigint }>>`
      SELECT * FROM core.review_tasks_due_practices(${limit})
    `;
  }
}
