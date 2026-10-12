/**
 * ASSOCIATE, AFTER THE SERVICE RECORD HAS COMMITTED, AND NEVER AT ITS EXPENSE
 * (D-2026-10-10-09 option (b); hard rule 8).
 *
 * The association is evidence about an unsigned DRAFT. The service record is
 * what a practice bills against. So the association runs in its OWN
 * transaction once the service record and its event have committed, and any
 * failure here -- two arrivals racing for one draft and losing on the unique
 * index, a lost connection -- is caught and logged, never thrown. The service
 * then simply has no association, and `associationChoices` lists it for a
 * person to choose, which is the same place an ambiguous match goes.
 *
 * THE LOG LINE CARRIES THE ERROR'S CLASS, ITS PRISMA CODE AND IDS ONLY. Never
 * the message (a Prisma message can quote values) and never a patient.
 */
import type { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { associateOnServiceArrival } from './pre-agreement-association';

export type AssociationAfterCommit = Awaited<ReturnType<typeof associateOnServiceArrival>> | { outcome: 'failed' };

export async function associateAfterCommit(
  prisma: Pick<PrismaService, 'withPractice'>,
  practiceId: string,
  serviceRecordId: string,
  logger: Pick<Logger, 'warn'>,
): Promise<AssociationAfterCommit> {
  try {
    return await prisma.withPractice(practiceId, async (tx) => {
      const record = await tx.serviceRecord.findFirst({ where: { id: serviceRecordId } });
      if (!record) return { outcome: 'none' as const, candidateCount: 0 };
      return associateOnServiceArrival(tx, practiceId, record);
    });
  } catch (err) {
    const kind = err instanceof Error ? err.constructor.name : typeof err;
    const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : 'none';
    logger.warn(
      `Association for service record ${serviceRecordId} at practice ${practiceId} failed (${kind}, code ${code}); ` +
        'the service record is kept and is listed on Reconciliation for a person to choose.',
    );
    return { outcome: 'failed' };
  }
}
