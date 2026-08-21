import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  CHECKLIST_VERSION,
  CHECK_CATALOGUE,
  CheckError,
  FAILURE_REASONS,
  INCOMPLETE_REASONS,
  assertCheckRecordable,
  assessAdmission,
  summariseChecks,
  type CheckRecord,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The validation checklist (IDENTITY-STRENGTH-DESIGN.md §3).
 *
 * Checks are APPEND-ONLY: performing one again writes a new row and both
 * survive, because how many attempts a check took is part of the picture. The
 * summary reads the latest outcome per key; the history stays.
 */
@Injectable()
export class ChecksService {
  private readonly logger = new Logger(ChecksService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The catalogue a reviewer works from, with its guidance on what to attach. */
  catalogue() {
    return {
      checklistVersion: CHECKLIST_VERSION,
      failureReasons: FAILURE_REASONS,
      incompleteReasons: INCOMPLETE_REASONS,
      checks: CHECK_CATALOGUE,
    };
  }

  async record(
    practiceId: string,
    input: {
      checkKey: string;
      outcome: string;
      performedByName: string;
      reasonCode?: string;
      note?: string;
      fields?: Record<string, string>;
      /** Artefact ids already uploaded against this practice. */
      artefactIds?: string[];
    },
  ) {
    // Count the evidence BEFORE validating, because "may this pass with no
    // artefact" is one of the things being validated.
    const artefactCount = await this.countArtefacts(practiceId, input.artefactIds ?? []);

    let definition;
    try {
      definition = assertCheckRecordable({ ...input, artefactCount });
    } catch (err) {
      if (err instanceof CheckError) throw new BadRequestException(err.message);
      throw err;
    }

    return this.prisma.withPractice(practiceId, async (tx) => {
      const check = await tx.practiceCheck.create({
        data: {
          practiceId,
          checkKey: input.checkKey,
          // Stamped, not looked up later: re-weighting the catalogue must never
          // silently rewrite what a past reviewer was told.
          checklistVersion: CHECKLIST_VERSION,
          category: definition.category,
          weight: definition.weight,
          outcome: input.outcome,
          reasonCode: input.reasonCode ?? null,
          note: input.note ?? null,
          fields: (input.fields ?? {}) as Record<string, string>,
          performedByName: input.performedByName.trim(),
        },
      });

      // Attach the evidence to the check now that it has an id.
      if (input.artefactIds?.length) {
        await tx.artefact.updateMany({
          where: { id: { in: input.artefactIds } },
          data: { subjectType: 'PracticeCheck', subjectId: check.id },
        });
      }

      await enqueueVaultEvent(tx, {
        type: 'organisation.validated',
        actor: { principalType: 'staff', id: practiceId },
        subject: { type: 'PracticeCheck', id: check.id },
        payload: {
          action: 'check_performed',
          checkKey: input.checkKey,
          checklistVersion: CHECKLIST_VERSION,
          outcome: input.outcome,
          reasonCode: input.reasonCode ?? 'n/a',
          performedBy: input.performedByName.trim(),
          artefactCount,
        },
      });

      return check;
    });
  }

  /**
   * Everything performed, plus what hard enforcement WOULD decide.
   *
   * The `wouldPass` field is the point of running soft: it shows, live, how
   * many real practices a threshold would be turning away. You cannot
   * calibrate a threshold you are already enforcing, because you never see the
   * outcomes of what you rejected.
   */
  async summary(practiceId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const rows = await tx.practiceCheck.findMany({ orderBy: { performedAt: 'asc' } });
      const artefacts = await tx.artefact.findMany({
        where: { subjectType: 'PracticeCheck' },
        select: { id: true, subjectId: true, filename: true, detectedContentType: true, deletedAt: true },
      });

      const records: CheckRecord[] = rows.map((r) => ({
        checkKey: r.checkKey,
        outcome: r.outcome,
        performedByName: r.performedByName,
        reasonCode: r.reasonCode,
        note: r.note,
      }));
      const summary = summariseChecks(records);

      return {
        checklistVersion: CHECKLIST_VERSION,
        summary,
        // Advisory while enforcement is soft. Never shown to an applicant —
        // "you need 6 points, here is what scores" is a fraud playbook.
        admission: assessAdmission(summary),
        history: rows.map((r) => ({
          id: r.id,
          checkKey: r.checkKey,
          checklistVersion: r.checklistVersion,
          category: r.category,
          weight: r.weight,
          outcome: r.outcome,
          reasonCode: r.reasonCode,
          note: r.note,
          fields: r.fields,
          performedByName: r.performedByName,
          performedAt: r.performedAt,
          artefacts: artefacts
            .filter((a) => a.subjectId === r.id && !a.deletedAt)
            .map((a) => ({ id: a.id, filename: a.filename, contentType: a.detectedContentType })),
        })),
      };
    });
  }

  /** Only artefacts belonging to THIS practice count as evidence for it. */
  private async countArtefacts(practiceId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.prisma.withPractice(practiceId, (tx) =>
      tx.artefact.count({ where: { id: { in: ids }, deletedAt: null } }),
    );
  }
}
