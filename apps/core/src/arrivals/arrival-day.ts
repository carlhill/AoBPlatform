/**
 * THE TWO READS EVERY "ONE PRACTICE, ONE DAY" PAGE MAKES.
 *
 * WHY THEY ARE HERE AND NOT IN A SERVICE. `PractitionerQueueService` worked
 * both of these out first, for the waiting list, and its own docstring says why
 * they are subtle: *"ARRIVALS, NOT AGREEMENTS, ARE THE SPINE"*, and *"reading
 * only the arrival's own agreement would show 'Not yet' for a patient who
 * signed the successor five minutes ago, which is the single worst thing this
 * page can get wrong."* The day register asks the same two questions of the
 * same two tables. A second copy would be a second place for that mistake to
 * come back, in a file whose author had not read the first one (wow.md §10).
 *
 * FUNCTIONS OVER A TRANSACTION, NOT AN INJECTABLE. Both callers are already
 * inside `prisma.withPractice`, which is where the RLS scope lives; taking the
 * scoped client as an argument means neither of these can open a scope of its
 * own, or a wrong one. There is nothing to inject and nothing to configure.
 *
 * NEITHER OF THEM WRITES. No outbox event, no vault event, nothing to commit.
 */

import type { PrismaService } from '../prisma/prisma.service';

/**
 * The practice-scoped client `withPractice` hands its callback. Derived rather
 * than restated so it cannot drift from the thing it describes.
 */
export type ScopedTx = Parameters<Parameters<PrismaService['withPractice']>[1]>[0];

/**
 * HOW FAR A SUPERSESSION CHAIN IS WALKED. Bounded because an unbounded walk
 * over data is a page that hangs; sixteen is far past any real correction
 * history and a cycle is impossible through the one-successor index anyway.
 */
export const MAX_CHAIN_HOPS = 16;

/**
 * WHAT THE PRACTICE ACCEPTED IN A WINDOW, IN THE ORDER PEOPLE WALKED IN.
 *
 * `outcome: 'received'` IS THE FILTER AND IT IS NOT A TIDY-UP. A refused
 * arrival is one the platform would not accept because the person named could
 * not be the provider on an agreement — nothing was mirrored onto the patient
 * and the desk is being asked for a missing field. It is not somebody who came
 * in; it is a message that bounced, and it has its own list
 * (`GET /arrivals/needing-a-provider`).
 *
 * ARRIVAL ORDER, WHICH IS RECEPTION'S ORDER (FRONT-DESK-PAGE.md §12.6).
 * Callers do not re-sort it.
 *
 * `to` IS OPTIONAL, AND ITS ABSENCE MEANS "AND EVERYTHING SINCE". The waiting
 * list wants today onwards with no upper bound — a clock a few minutes fast at
 * the sender would otherwise drop somebody standing in the room. A register
 * about a named day wants both ends, because a day that ends at "now" is a
 * different day for every hour it is opened.
 */
export function receivedArrivalsIn(tx: ScopedTx, window: { from: Date; to?: Date }) {
  return tx.arrival.findMany({
    where: {
      arrivedAt: window.to ? { gte: window.from, lt: window.to } : { gte: window.from },
      outcome: 'received',
    },
    orderBy: { arrivedAt: 'asc' },
  });
}

/**
 * THE LAST AGREEMENT IN EACH CHAIN, WALKED FORWARD FROM THE ARRIVAL'S OWN.
 *
 * An arrival names the agreement drafted when the patient walked in — the HEAD
 * of the chain — and a correction supersedes it with a new row the arrival has
 * never heard of (HARD-02: corrections supersede). The row that actually gets
 * signed is the newest one, so that is the one a screen must report on.
 *
 * The desk walks BACKWARD, from a live row to the arrival that put it in the
 * queue. This is the other end.
 *
 * Returns a map from each id it was given to the newest id in that id's chain;
 * an agreement with no successor maps to itself.
 */
export async function newestAgreementInChain(
  tx: ScopedTx,
  agreementIds: readonly string[],
): Promise<Map<string, string>> {
  const newest = new Map<string, string>(agreementIds.map((id) => [id, id]));
  let frontier = [...agreementIds];

  for (let hop = 0; hop < MAX_CHAIN_HOPS && frontier.length > 0; hop += 1) {
    const successors = await tx.agreement.findMany({
      where: { supersedesAgreementId: { in: frontier } },
      select: { id: true, supersedesAgreementId: true },
    });
    if (successors.length === 0) break;

    const byPredecessor = new Map(
      successors
        .filter((s): s is typeof s & { supersedesAgreementId: string } => s.supersedesAgreementId !== null)
        .map((s) => [s.supersedesAgreementId, s.id]),
    );
    for (const [origin, current] of newest) {
      const next = byPredecessor.get(current);
      if (next) newest.set(origin, next);
    }
    frontier = [...byPredecessor.values()];
  }

  return newest;
}

/** Distinct, non-empty ids from a list that may hold nulls. */
export function idsOf(values: ReadonlyArray<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}
