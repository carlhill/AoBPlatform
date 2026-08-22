import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  REVIEW_CLAIM_MINUTES,
  REVIEW_RESOLUTIONS,
  REVIEW_TASK_KEYS,
  isTaskClaimable,
  mayAutoResolve,
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
    if (!REVIEW_RESOLUTIONS.includes(input.resolution as never)) {
      throw new BadRequestException(
        `"${input.resolution}" is not a resolution. One of: ${REVIEW_RESOLUTIONS.join(', ')}.`,
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
