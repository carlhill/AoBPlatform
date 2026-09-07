import type { Prisma } from '@prisma/client';
import { DEFAULT_BILLING_ROLE } from '@aobplatform/domain';

/**
 * WHO AN AGREEMENT NAMES — read from the practitioner's affiliation at a
 * location, which is the anchor from 7 September 2026 (Carl: "retire providers
 * as the anchor").
 *
 * WHAT THIS REPLACED, and why it had to. Until today `Agreement.providerId`
 * pointed at a `providers` row: PRACTICE-scoped, no location, no key to a
 * practitioner, free-text address. Three separate rules need what it could not
 * give:
 *
 *   * REQ-END-01 (hard rule 6) makes an enduring agreement per PRACTITIONER x
 *     patient. A practice-wide row cannot say which person, so a GP working at
 *     two of a practice's sites looked like two providers and would have been
 *     offered a second enduring agreement at the second one.
 *   * FR-1.8: the provider number is issued per practitioner per LOCATION. A
 *     row with no location cannot hold the right one.
 *   * s 65C(5)(a): D4 identifies the professional by name and the address of
 *     the place of practice. Only the affiliation names the place.
 *
 * ONE HELPER RATHER THAN TWELVE COPIES. Twelve services read "the provider of
 * this agreement" — the render, the push, the kiosk list, the work page, the
 * portal, the reconciliation queue, the 89AA notice. Each of them did its own
 * `provider.findFirst`, so each of them would have needed its own join, and
 * the first one anybody forgot would quietly go on naming the practice-wide
 * row. They all call this instead.
 *
 * THE LEGACY PATH IS STILL HERE, AND IS HONEST ABOUT BEING LEGACY. Agreements
 * made before today have no `affiliationId` — the backfill would not guess one
 * where its three keys found nothing or found two candidates (see
 * `matchAffiliationsForProvider`). Those rows still answer from their
 * `providers` row, and `source` says so, because a screen showing a name has
 * to be able to say where the name came from. Nothing about their RENDER
 * changes: the artefact was hashed at lock and re-renders from its own stored
 * payload (hard rule 13), never from this.
 */
export interface AgreementAnchor {
  /** Null only on the legacy path — an agreement nobody could map to a person. */
  readonly affiliationId: string | null;
  /** The PERSON. What REQ-END-01 makes an enduring agreement per. */
  readonly practitionerId: string | null;
  /** Where they were working. What D4's address and the provider number are per. */
  readonly locationId: string | null;
  /** The name D4 states (s 65C(5)(a)). */
  readonly name: string;
  /** `general_practitioner` | `specialist` | ... — the enduring GP-only check reads this. */
  readonly providerType: string;
  /**
   * The LOCATION's provider number. Null is lawful and common: s 65C(5)(a)
   * identifies the professional by name and place of practice, and (b) by
   * number, and either satisfies D4 (REQ-REG-02).
   */
  readonly providerNumber: string | null;
  /** The place of practice — canonical where the address has been validated. */
  readonly placeOfPracticeAddress: string | null;
  /** Whose provider number the claim goes under, at this location. */
  readonly billingRole: string;
  /**
   * FALSE when the role is the default rather than a record — a legacy
   * `providers` row that no affiliation could be matched to. A caller may then
   * say "no role is recorded for this person" instead of "they are a servicing
   * provider", and the screens do.
   */
  readonly billingRoleRecorded: boolean;
  readonly source: 'affiliation' | 'legacy_provider';
}

/** The shape every caller has: an agreement row, or anything carrying the two ids. */
export interface AnchoredRow {
  readonly id?: string;
  readonly affiliationId: string | null;
  readonly providerId: string | null;
}

/** What a `providers` row can be matched on. */
export interface LegacyProviderRow {
  readonly id: string;
  readonly name: string;
  readonly providerType: string;
  readonly placeOfPracticeAddress?: string | null;
  readonly providerNumber: string | null;
  readonly ahpraNumber: string | null;
  readonly pmsLinkageKey: string | null;
}

/** Live first: a role recorded against a finished affiliation is history. */
const LIVE_STATUSES = ['active', 'ending', 'invited'];

const AFFILIATION_SELECT = {
  id: true,
  practitionerId: true,
  locationId: true,
  providerNumber: true,
  billingRole: true,
  status: true,
} as const;

type AffiliationRow = {
  id: string;
  practitionerId: string;
  locationId: string;
  providerNumber: string | null;
  billingRole: string;
  status: string;
};

/**
 * THE AFFILIATION, AS A PERSON AND A PLACE. One join out to the practitioner
 * (the name and the discipline) and one to the location (the address D4
 * renders), because an anchor that cannot say who and where is not an anchor.
 */
export async function anchorForAffiliation(
  tx: Prisma.TransactionClient,
  affiliationId: string,
): Promise<AgreementAnchor | null> {
  const affiliation = await tx.affiliation.findFirst({ where: { id: affiliationId }, select: AFFILIATION_SELECT });
  if (!affiliation) return null;
  return hydrate(tx, affiliation);
}

/** The batch form. Same answer, one query per table instead of one per row. */
export async function anchorsForAffiliations(
  tx: Prisma.TransactionClient,
  affiliationIds: readonly string[],
): Promise<Map<string, AgreementAnchor>> {
  const ids = [...new Set(affiliationIds)];
  const out = new Map<string, AgreementAnchor>();
  if (ids.length === 0) return out;

  const affiliations = await tx.affiliation.findMany({ where: { id: { in: ids } }, select: AFFILIATION_SELECT });
  if (affiliations.length === 0) return out;

  const [practitioners, locations] = await Promise.all([
    tx.practitioner.findMany({
      where: { id: { in: [...new Set(affiliations.map((a) => a.practitionerId))] } },
      select: { id: true, givenNames: true, familyName: true, providerType: true },
    }),
    tx.practiceLocation.findMany({
      where: { id: { in: [...new Set(affiliations.map((a) => a.locationId))] } },
      select: { id: true, address: true, addressCanonical: true },
    }),
  ]);
  const practitionerById = new Map(practitioners.map((p) => [p.id, p]));
  const locationById = new Map(locations.map((l) => [l.id, l]));

  for (const affiliation of affiliations) {
    const practitioner = practitionerById.get(affiliation.practitionerId);
    if (!practitioner) continue;
    const location = locationById.get(affiliation.locationId);
    out.set(affiliation.id, {
      affiliationId: affiliation.id,
      practitionerId: affiliation.practitionerId,
      locationId: affiliation.locationId,
      name: `${practitioner.givenNames} ${practitioner.familyName}`.trim(),
      providerType: practitioner.providerType,
      providerNumber: affiliation.providerNumber,
      /*
       * THE CANONICAL FORM WHERE THERE IS ONE. A validated address renders as
       * G-NAF wrote it, not as somebody typed it — the same choice
       * `PracticeLocation.addressCanonical` was added for. What was typed
       * stays on the row as evidence of the input.
       */
      placeOfPracticeAddress: location?.addressCanonical ?? location?.address ?? null,
      billingRole: affiliation.billingRole,
      billingRoleRecorded: true,
      source: 'affiliation',
    });
  }
  return out;
}

/**
 * WHICH AFFILIATIONS COULD A LEGACY `providers` ROW BE, and it never guesses.
 *
 * Three keys, in the order of how much they prove:
 *
 *   1. `pmsLinkageKey` — the practice's own software saying "these are the
 *      same person at the same place". The strongest, and the one the
 *      connector will populate on both sides once D-01 is resolved.
 *   2. `providerNumber` — issued per practitioner per location, so two rows
 *      carrying the same one ARE the same practitioner at the same location.
 *   3. `ahpraNumber` — the same PERSON; the same PLACE only where they hold
 *      exactly one affiliation at this practice.
 *
 * IT RETURNS ALL THE CANDIDATES, not one, because two answers are the
 * interesting case and collapsing them would hide it. The caller may take the
 * ANCHOR only when there is exactly one — naming a doctor on a contract by
 * coin toss is the mistake this whole change exists to stop — but may still
 * take the ROLE when every candidate agrees on it, which is what keeps a
 * practice nurse at two sites refused rather than waved through on a default.
 */
export async function matchAffiliationsForProvider(
  tx: Prisma.TransactionClient,
  provider: LegacyProviderRow,
): Promise<{ candidates: AffiliationRow[]; matchedBy: 'pms_linkage_key' | 'provider_number' | 'ahpra_number' } | null> {
  const live = (rows: AffiliationRow[]): AffiliationRow[] => {
    const alive = rows.filter((row) => LIVE_STATUSES.includes(row.status));
    return alive.length > 0 ? alive : rows;
  };

  if (provider.pmsLinkageKey) {
    const rows = await tx.affiliation.findMany({
      where: { pmsLinkageKey: provider.pmsLinkageKey },
      select: AFFILIATION_SELECT,
    });
    if (rows.length > 0) return { candidates: live(rows), matchedBy: 'pms_linkage_key' };
  }

  if (provider.providerNumber) {
    const rows = await tx.affiliation.findMany({
      where: { providerNumber: provider.providerNumber },
      select: AFFILIATION_SELECT,
    });
    if (rows.length > 0) return { candidates: live(rows), matchedBy: 'provider_number' };
  }

  if (provider.ahpraNumber) {
    const practitioner = await tx.practitioner.findFirst({
      where: { ahpraNumber: provider.ahpraNumber },
      select: { id: true },
    });
    if (practitioner) {
      const rows = await tx.affiliation.findMany({
        where: { practitionerId: practitioner.id },
        select: AFFILIATION_SELECT,
      });
      if (rows.length > 0) return { candidates: live(rows), matchedBy: 'ahpra_number' };
    }
  }

  return null;
}

/**
 * THE ANCHOR FOR A LEGACY `providers` ROW.
 *
 * Where exactly one affiliation matches, this IS that affiliation and reads
 * like any other. Where none or several do, the name and address come off the
 * legacy row and `billingRoleRecorded` is false — which is the honest answer
 * and not a refusal, because refusing what cannot be resolved would stop the
 * evidence for care the platform is not entitled to interrupt (hard rule 8).
 */
export async function anchorForLegacyProvider(
  tx: Prisma.TransactionClient,
  provider: LegacyProviderRow,
): Promise<AgreementAnchor> {
  const matched = await matchAffiliationsForProvider(tx, provider);
  if (matched && matched.candidates.length === 1) {
    const hydrated = await hydrate(tx, matched.candidates[0]!);
    if (hydrated) return hydrated;
  }

  /*
   * SEVERAL CANDIDATES AND NO WAY TO TELL WHICH SITE. The role is still usable
   * when they all agree on it — "this person is a practice nurse wherever they
   * work here" is a fact even when "which desk" is not. Disagreeing rows mean
   * the platform does not know, and it says so.
   */
  const roles = new Set((matched?.candidates ?? []).map((row) => row.billingRole));
  const agreed = roles.size === 1 ? [...roles][0]! : null;

  return {
    affiliationId: null,
    practitionerId: null,
    locationId: null,
    name: provider.name,
    providerType: provider.providerType,
    providerNumber: provider.providerNumber,
    placeOfPracticeAddress: provider.placeOfPracticeAddress ?? null,
    billingRole: agreed ?? DEFAULT_BILLING_ROLE,
    billingRoleRecorded: agreed !== null,
    source: 'legacy_provider',
  };
}

/**
 * WHO THIS AGREEMENT NAMES. The affiliation where there is one, the legacy row
 * where there is not, and `null` for an agreement anchored on neither — which
 * is the ACCHO/AMS organisation pathway, and a caller that treats `null` as
 * "no provider" is right about it (Addendum v3 §1.1).
 */
export async function anchorForAgreement(
  tx: Prisma.TransactionClient,
  agreement: AnchoredRow,
): Promise<AgreementAnchor | null> {
  if (agreement.affiliationId) return anchorForAffiliation(tx, agreement.affiliationId);
  if (!agreement.providerId) return null;
  const provider = await tx.provider.findFirst({ where: { id: agreement.providerId } });
  if (!provider) return null;
  return anchorForLegacyProvider(tx, provider);
}

/**
 * The same answer for a list, which is what every queue screen wants: two
 * queries for the anchored rows and one legacy lookup each for the rest,
 * rather than a join per line.
 *
 * Keyed by AGREEMENT id, because that is what a caller holds.
 */
export async function anchorsForAgreements(
  tx: Prisma.TransactionClient,
  agreements: readonly AnchoredRow[],
): Promise<Map<string, AgreementAnchor>> {
  const out = new Map<string, AgreementAnchor>();
  const withId = agreements.filter((a): a is AnchoredRow & { id: string } => typeof a.id === 'string');

  const byAffiliation = await anchorsForAffiliations(
    tx,
    withId.map((a) => a.affiliationId).filter((id): id is string => Boolean(id)),
  );

  const legacyIds = [
    ...new Set(
      withId.filter((a) => !a.affiliationId).map((a) => a.providerId).filter((id): id is string => Boolean(id)),
    ),
  ];
  const legacyAnchors = new Map<string, AgreementAnchor>();
  if (legacyIds.length > 0) {
    const providers = await tx.provider.findMany({ where: { id: { in: legacyIds } } });
    for (const provider of providers) {
      legacyAnchors.set(provider.id, await anchorForLegacyProvider(tx, provider));
    }
  }

  for (const agreement of withId) {
    const anchor = agreement.affiliationId
      ? byAffiliation.get(agreement.affiliationId)
      : agreement.providerId
        ? legacyAnchors.get(agreement.providerId)
        : undefined;
    if (anchor) out.set(agreement.id, anchor);
  }
  return out;
}

async function hydrate(tx: Prisma.TransactionClient, affiliation: AffiliationRow): Promise<AgreementAnchor | null> {
  const [practitioner, location] = await Promise.all([
    tx.practitioner.findFirst({
      where: { id: affiliation.practitionerId },
      select: { givenNames: true, familyName: true, providerType: true },
    }),
    tx.practiceLocation.findFirst({
      where: { id: affiliation.locationId },
      select: { address: true, addressCanonical: true },
    }),
  ]);
  if (!practitioner) return null;
  return {
    affiliationId: affiliation.id,
    practitionerId: affiliation.practitionerId,
    locationId: affiliation.locationId,
    name: `${practitioner.givenNames} ${practitioner.familyName}`.trim(),
    providerType: practitioner.providerType,
    providerNumber: affiliation.providerNumber,
    placeOfPracticeAddress: location?.addressCanonical ?? location?.address ?? null,
    billingRole: affiliation.billingRole,
    billingRoleRecorded: true,
    source: 'affiliation',
  };
}
