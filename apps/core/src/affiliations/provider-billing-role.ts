import type { Prisma } from '@prisma/client';
import { DEFAULT_BILLING_ROLE } from '@aobplatform/domain';

/**
 * WHAT THE BILLING ROLE IS FOR THE PROVIDER AN ARRIVAL NAMED — and the honest
 * account of why this needs a resolver at all (Carl, 5–7 Sep 2026).
 *
 * WHAT IS ACTUALLY IN THE SCHEMA, having read it rather than assumed it.
 *
 *   `providers` is a PRACTICE-scoped row. It has `name`, `providerType`, a
 *   FREE-TEXT `placeOfPracticeAddress`, an optional `providerNumber`, an
 *   optional `ahpraNumber` and an optional `pmsLinkageKey`. It has NO
 *   `locationId` and no foreign key to anything but `practices`. It is the
 *   LEGACY anchor: `Agreement.providerId` points at it, and the schema's own
 *   comment says that column "is being retired".
 *
 *   `affiliations` is the practitioner × location edge — unique on
 *   (practitionerId, locationId) — and is the anchor `Agreement.affiliationId`
 *   is being migrated TO. It carries the per-location provider number, which
 *   is the FR-1.8 shape and the reason the billing role belongs on it.
 *
 *   THERE IS NO LINK BETWEEN THEM. No foreign key, no shared id, and nothing
 *   in the codebase writes `Agreement.affiliationId` today. In the dev
 *   database the two tables have plainly lived separate lives: every
 *   `providers` row has an empty `ahpraNumber` and an empty `providerNumber`,
 *   while the affiliations hang off practitioners that do have AHPRA numbers.
 *   So the answer to "if the arrival names a `providers` row that is per
 *   location, that IS the affiliation" is: it is not. A `providers` row is per
 *   PRACTICE, and an arrival carries no location either.
 *
 * SO THIS MATCHES ON THE THREE KEYS THE TWO TABLES CAN SHARE, in the order of
 * how much they prove:
 *
 *   1. `pmsLinkageKey` — the practice's own software saying "these are the
 *      same person at the same place". The strongest of the three, and the one
 *      the connector will populate on both sides once D-01 is resolved.
 *   2. `providerNumber` — a number is issued per practitioner per location, so
 *      two rows carrying the same one ARE the same practitioner at the same
 *      location. Exact, when it is held.
 *   3. `ahpraNumber` — the same person, then; and where they hold exactly one
 *      affiliation at this practice, the same place too. Where they hold
 *      several, the arrival does not say which site, so this resolver does not
 *      guess: it takes the role only when every live affiliation agrees on it.
 *
 * WHEN NOTHING MATCHES, THE ANSWER IS `servicing_provider` AND NOT A REFUSAL.
 * That is the same reasoning as the column default: every practitioner on the
 * platform today is a doctor, and the practices running now have `providers`
 * rows with no affiliation beside them at all. Refusing what we cannot resolve
 * would stop every arrival in the estate on the day this shipped — which
 * would be the platform blocking the evidence for care it is not entitled to
 * interrupt (hard rule 8). `resolved: false` travels with the answer so a
 * caller can say "no role is recorded for this person" rather than "they are a
 * servicing provider", and the screens do.
 */
export interface ResolvedBillingRole {
  /** The affiliation the role came from, or null when none could be matched. */
  readonly affiliationId: string | null;
  /** The role. `servicing_provider` when nothing matched — see above. */
  readonly billingRole: string;
  /** False when nothing matched: the role is the default, not a record. */
  readonly resolved: boolean;
  /** How it was matched, for the log and for the report. */
  readonly matchedBy: 'pms_linkage_key' | 'provider_number' | 'ahpra_number' | null;
  /** The affiliation's provider number, where one is held. Null is lawful (s 65C(5)(a)). */
  readonly providerNumber: string | null;
}

const UNRESOLVED: ResolvedBillingRole = {
  affiliationId: null,
  billingRole: DEFAULT_BILLING_ROLE,
  resolved: false,
  matchedBy: null,
  providerNumber: null,
};

/** Live first: a role recorded against a finished affiliation is history. */
const LIVE = ['active', 'ending', 'invited'];

interface ProviderRow {
  readonly id: string;
  readonly providerNumber: string | null;
  readonly ahpraNumber: string | null;
  readonly pmsLinkageKey: string | null;
}

export async function resolveBillingRoleForProvider(
  tx: Prisma.TransactionClient,
  provider: ProviderRow,
): Promise<ResolvedBillingRole> {
  const pick = (
    rows: Array<{ id: string; billingRole: string; providerNumber: string | null; status: string }>,
    matchedBy: NonNullable<ResolvedBillingRole['matchedBy']>,
  ): ResolvedBillingRole | null => {
    const live = rows.filter((row) => LIVE.includes(row.status));
    const candidates = live.length > 0 ? live : rows;
    if (candidates.length === 0) return null;
    /*
     * SEVERAL AFFILIATIONS AND NO WAY TO TELL WHICH SITE. An arrival names a
     * provider and not a place, so where one practitioner works at two of a
     * practice's locations the role is only usable if it is the SAME at both.
     * Disagreeing rows mean the platform does not know, and it says so rather
     * than picking the first — picking would be a coin toss over whose name
     * goes on a contract.
     */
    const roles = new Set(candidates.map((row) => row.billingRole));
    if (roles.size > 1) return null;
    const chosen = candidates[0]!;
    return {
      affiliationId: candidates.length === 1 ? chosen.id : null,
      billingRole: chosen.billingRole,
      resolved: true,
      matchedBy,
      providerNumber: candidates.length === 1 ? chosen.providerNumber : null,
    };
  };

  const select = { id: true, billingRole: true, providerNumber: true, status: true } as const;

  if (provider.pmsLinkageKey) {
    const rows = await tx.affiliation.findMany({ where: { pmsLinkageKey: provider.pmsLinkageKey }, select });
    const answer = pick(rows, 'pms_linkage_key');
    if (answer) return answer;
  }

  if (provider.providerNumber) {
    const rows = await tx.affiliation.findMany({ where: { providerNumber: provider.providerNumber }, select });
    const answer = pick(rows, 'provider_number');
    if (answer) return answer;
  }

  if (provider.ahpraNumber) {
    const practitioner = await tx.practitioner.findFirst({
      where: { ahpraNumber: provider.ahpraNumber },
      select: { id: true },
    });
    if (practitioner) {
      const rows = await tx.affiliation.findMany({ where: { practitionerId: practitioner.id }, select });
      const answer = pick(rows, 'ahpra_number');
      if (answer) return answer;
    }
  }

  return UNRESOLVED;
}
