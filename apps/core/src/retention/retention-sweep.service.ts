import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { canTransition, type AgreementStatus } from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { ArtefactsService } from '../artefacts/artefacts.service';
import { CorrespondenceService } from '../correspondence/correspondence.service';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;
const BATCH = 500;

export interface RetentionSweepResult {
  agreementsScheduled: number;
  correspondenceRemoved: number;
  artefactsRemoved: number;
}

/**
 * Retention, soft (CONSULTATION-CAPTURE-PLAN.md Part 5; REQ-REG-09, REQ-INT-04).
 *
 * Hourly, two passes. (a) Agreements whose retention expiry has arrived move
 * to the terminal state `retention_expiry_scheduled`. (b) Anything past expiry
 * and not on hold has its CONTENT removed — correspondence text, artefact
 * bytes — while the row, its hash and its provenance survive. Every removal is
 * a vault event; where the retention clock was defaulted conservatively, the
 * event says so. `legalHold` wins, always.
 *
 * Cross-practice reads go through narrow SECURITY DEFINER functions that return
 * ids only (CONVENTIONS.md §6); every write is scoped like any other.
 */
@Injectable()
export class RetentionSweepService {
  private readonly logger = new Logger(RetentionSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly artefacts: ArtefactsService,
    private readonly correspondence: CorrespondenceService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    try {
      const r = await this.run();
      if (r.agreementsScheduled + r.correspondenceRemoved + r.artefactsRemoved > 0) {
        this.logger.log(
          `Retention: ${r.agreementsScheduled} agreement(s) scheduled for expiry, content removed from ` +
            `${r.correspondenceRemoved} correspondence row(s) and ${r.artefactsRemoved} artefact(s). Rows and hashes kept.`,
        );
      }
    } catch (err) {
      // A sweep failure must never take the process down, and never pass silently.
      this.logger.error(`Retention sweep failed: ${(err as Error).message}`);
    }
  }

  /** Callable so a test proves the transition rather than waiting for a cron. */
  async run(now: Date = new Date()): Promise<RetentionSweepResult> {
    const today = now.toISOString().slice(0, 10);
    return {
      agreementsScheduled: await this.scheduleDueAgreements(today, now),
      correspondenceRemoved: await this.removeDueCorrespondence(today, now),
      artefactsRemoved: await this.removeDueArtefacts(today),
    };
  }

  private async scheduleDueAgreements(today: string, now: Date): Promise<number> {
    const due = await this.prisma.$queryRaw<Array<{ id: string; practiceId: string; retentionClockSource: string }>>`
      SELECT * FROM core.retention_due_agreements(${today}::date, ${BATCH}::int)`;
    let n = 0;
    for (const row of due) {
      const done = await this.prisma.withPractice(row.practiceId, async (tx) => {
        // Re-read under scope: the hold and the status are checked at write time, not list time.
        const agreement = await tx.agreement.findFirst({ where: { id: row.id } });
        if (!agreement || agreement.legalHold) return false;
        const from = agreement.status as AgreementStatus;
        if (!canTransition(from, 'retention_expiry_scheduled')) return false;
        await tx.agreement.update({ where: { id: row.id }, data: { status: 'retention_expiry_scheduled' } });
        await enqueueVaultEvent(tx, {
          type: 'agreement.status_changed',
          actor: SYSTEM_ACTOR,
          subject: { type: 'Agreement', id: row.id },
          payload: { from, to: 'retention_expiry_scheduled' },
        });
        await enqueueVaultEvent(tx, {
          type: 'retention.expiry_scheduled',
          actor: SYSTEM_ACTOR,
          subject: { type: 'Agreement', id: row.id },
          payload: {
            retentionExpiryDate: agreement.retentionExpiryDate?.toISOString().slice(0, 10) ?? '',
            retentionClockSource: row.retentionClockSource,
            // REQ-INT-04: say so when the clock was not anchored on an observed claim.
            clockDefaulted: row.retentionClockSource !== 'observed_claim',
            scheduledAt: now.toISOString(),
          },
        });
        return true;
      });
      if (done) n += 1;
    }
    return n;
  }

  private async removeDueCorrespondence(today: string, now: Date): Promise<number> {
    const due = await this.prisma.$queryRaw<
      Array<{ id: string; practiceId: string | null; recipientId: string | null }>
    >`
      SELECT * FROM core.retention_due_correspondence(${today}::date, ${BATCH}::int)`;
    let n = 0;
    for (const row of due) {
      // A practice-less row is a practitioner's personal message: scope it on the person.
      const scoped = row.practiceId
        ? <T>(fn: Parameters<PrismaService['withPractice']>[1]) =>
            this.prisma.withPractice(row.practiceId!, fn) as Promise<T>
        : row.recipientId
          ? <T>(fn: Parameters<PrismaService['withPractitioner']>[1]) =>
              this.prisma.withPractitioner(row.recipientId!, fn) as Promise<T>
          : null;
      if (!scoped) continue;
      const removed = await scoped<boolean>((tx) => this.correspondence.tombstone(tx, row.id, now));
      if (removed) n += 1;
    }
    return n;
  }

  private async removeDueArtefacts(today: string): Promise<number> {
    const due = await this.prisma.$queryRaw<Array<{ id: string; practiceId: string }>>`
      SELECT * FROM core.retention_due_artefacts(${today}::date, ${BATCH}::int)`;
    let n = 0;
    for (const row of due) {
      // The existing tombstone path: bytes gone, hash and provenance kept, event emitted. It refuses a hold.
      const r = await this.artefacts.tombstone(
        row.practiceId,
        row.id,
        'Retention period expired (REQ-REG-09).',
        SYSTEM_ACTOR,
      );
      if (!('alreadyRemoved' in r)) n += 1;
    }
    return n;
  }
}
