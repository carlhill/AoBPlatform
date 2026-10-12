/**
 * AN AGREEMENT THE CLOSURE SWEEP CLOSED IS REFUSED BY NAME, NEVER BY A RAW
 * DATABASE CHECK (review of D-2026-10-10-09, 11 Oct 2026).
 *
 * The sweep closes an unsigned agreement with no service after N days, under a
 * row lock. A signature or a lock that read the agreement BEFORE the close and
 * writes AFTER it would otherwise trip `agreements_closure_all_or_none` and
 * reach the tablet as a bare 400. So the writers that move an unsigned
 * agreement forward take the same row lock first, and a closed agreement is
 * refused with its own code and a sentence that says what happened.
 *
 * WHAT THE SENTENCE SAYS IS WHAT WAS RECORDED (wow.md §13): the day it was
 * closed, the reason, and the N applied. No remedy: whether this visit needs a
 * new agreement is not something this check can know.
 */
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { practiceToday } from '@aobplatform/domain';

/** The refusal code a tablet echoes and the console words (`SIGNATURE_REFUSAL_REASONS`). */
export const AGREEMENT_CLOSED_UNSIGNED = 'agreement_closed_unsigned';

export interface ClosureColumns {
  closedReason: string | null;
  closedAt: Date | null;
  closureDays: number | null;
}

export function closedUnsignedRefusal(row: ClosureColumns): BadRequestException {
  const on = row.closedAt ? practiceToday(row.closedAt) : 'an earlier day';
  const within = row.closureDays ? ` within ${row.closureDays} days` : '';
  return new BadRequestException({
    reason: AGREEMENT_CLOSED_UNSIGNED,
    message:
      `This agreement was closed on ${on} as not needed: no service was recorded for its visit${within}. ` +
      'Nothing was changed or signed.',
  });
}

/**
 * LOCK THE AGREEMENT ROW (`FOR UPDATE`) AND REFUSE IT IF IT WAS CLOSED. Returns
 * the status read under the lock, so the caller can re-check its own step.
 * RLS scopes the statement, so a cross-practice id locks nothing and returns null.
 */
export async function lockAndRefuseIfClosed(
  tx: Prisma.TransactionClient,
  agreementId: string,
): Promise<{ status: string } | null> {
  const rows = await tx.$queryRaw<Array<ClosureColumns & { status: string }>>`
    SELECT "status", "closedReason", "closedAt", "closureDays"
    FROM "agreements" WHERE "id" = ${agreementId}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row) return null;
  if (row.closedReason) throw closedUnsignedRefusal(row);
  return { status: row.status };
}
