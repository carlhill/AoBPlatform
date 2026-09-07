import type { Prisma } from '@prisma/client';

/**
 * A PRACTITIONER AT A LOCATION, for tests — which is what an agreement is
 * anchored on from 7 September 2026 (Carl: "retire providers as the anchor").
 *
 * WHY A HELPER RATHER THAN FOUR `create` CALLS IN THIRTY FILES. An anchor is
 * now three rows that have to agree with each other: a `PracticeLocation` with
 * a structured address (`locations_active_needs_structured_address`), a
 * `Practitioner` keyed on a globally unique AHPRA number, and the
 * `Affiliation` that joins them and carries the per-location provider number
 * and billing role. A test that gets one of those wrong fails on a constraint
 * name rather than on the thing it was testing.
 *
 * THE LEGACY `providers` ROW IS CREATED TOO, AND ON PURPOSE. The column is not
 * dropped for a release: the identity endpoints still address a provider row,
 * and the deprecated `providerId` field on the arrival contract is still
 * accepted for one. Both are linked to the affiliation by `pmsLinkageKey` —
 * the strongest of the three keys the resolver matches on — so a test can use
 * either door and both describe the same person at the same place. It goes
 * when the table does.
 *
 * FAKE IDENTITIES ONLY, and the AHPRA number is random rather than fixed
 * because it is globally unique and these suites run repeatedly against one
 * database (CLAUDE.md §7).
 */
export interface SeededAnchor {
  /** The anchor. `id` is an alias so a call site can read either. */
  readonly affiliationId: string;
  readonly id: string;
  readonly practitionerId: string;
  readonly locationId: string;
  /** The legacy `providers` row, linked by `pmsLinkageKey`. Deprecated. */
  readonly providerId: string;
  readonly name: string;
  readonly providerType: string;
  readonly providerNumber: string | null;
  readonly billingRole: string;
  readonly pmsLinkageKey: string;
}

export interface SeedAnchorOptions {
  /** "Dr GP Test" — split on the last space, as the practices endpoint does. */
  readonly name?: string;
  readonly providerType?: string;
  readonly billingRole?: string;
  /** Optional by design — s 65C(5)(a) OR (b) (REQ-REG-02). */
  readonly providerNumber?: string | null;
  /** Reuse a location, to put two practitioners at one site or one at two. */
  readonly locationId?: string;
  /** Reuse a person, which is how a GP comes to work at two of the sites. */
  readonly practitionerId?: string;
  readonly address?: string;
  readonly suburb?: string;
  readonly locationCode?: string;
  readonly status?: string;
  readonly pmsLinkageKey?: string;
}

let seq = 0;

function ahpraNumber(): string {
  seq += 1;
  const random = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0');
  return `MED${random}${seq.toString().padStart(4, '0')}`;
}

export async function createServicingProvider(
  tx: Prisma.TransactionClient,
  practiceId: string,
  opts: SeedAnchorOptions = {},
): Promise<SeededAnchor> {
  const name = opts.name ?? 'Dr Example Provider';
  const providerType = opts.providerType ?? 'general_practitioner';
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const cut = trimmed.lastIndexOf(' ');
  const givenNames = cut > 0 ? trimmed.slice(0, cut) : trimmed;
  const familyName = cut > 0 ? trimmed.slice(cut + 1) : trimmed;
  const suburb = opts.suburb ?? 'Sampletown';
  const address = opts.address ?? `1 Example Street, ${suburb} NSW 2000`;

  const locationId =
    opts.locationId ??
    (
      await tx.practiceLocation.create({
        data: {
          practiceId,
          address,
          addressLine1: address.split(',')[0]!.trim(),
          suburb,
          state: 'NSW',
          postcode: '2000',
          code: opts.locationCode ?? suburb,
          active: true,
        },
      })
    ).id;

  const practitionerId =
    opts.practitionerId ??
    (
      await tx.practitioner.create({
        data: {
          ahpraNumber: ahpraNumber(),
          givenNames,
          familyName,
          providerType,
          invitedByPracticeId: practiceId,
        },
      })
    ).id;

  const pmsLinkageKey = opts.pmsLinkageKey ?? `test-anchor-${practitionerId}-${locationId}`;
  const providerNumber = opts.providerNumber ?? null;
  const billingRole = opts.billingRole ?? 'servicing_provider';
  const status = opts.status ?? 'active';

  const affiliation = await tx.affiliation.create({
    data: {
      practiceId,
      practitionerId,
      locationId,
      providerNumber,
      pmsLinkageKey,
      billingRole,
      status,
      // `affiliations_active_requires_acceptance` — an active affiliation is
      // one somebody accepted, and the column has to say when.
      startedAt: status === 'active' || status === 'ending' ? new Date() : null,
      acceptanceMethod: 'console',
    },
  });

  const provider = await tx.provider.create({
    data: {
      practiceId,
      name,
      providerType,
      placeOfPracticeAddress: address,
      providerNumber,
      pmsLinkageKey,
    },
  });

  return {
    affiliationId: affiliation.id,
    id: affiliation.id,
    practitionerId,
    locationId,
    providerId: provider.id,
    name,
    providerType,
    providerNumber,
    billingRole,
    pmsLinkageKey,
  };
}

/**
 * TAKE THE ANCHOR ROWS DOWN AGAIN, in the order the foreign keys allow.
 *
 * A suite's teardown ends `await tx.practice.deleteMany({})`, and a practice
 * with an affiliation or a location still pointing at it cannot be deleted —
 * so this goes just before it. The PRACTITIONER is deleted too, and by id:
 * `practitioners` is a PLATFORM table (one identity across every practice
 * somebody works at), it is not practice-scoped, and a suite that left its
 * people behind would fill the development database with doctors nobody
 * employs.
 *
 * Agreements reference affiliations, so they must already be gone — which they
 * are: every teardown deletes them first.
 */
export async function deleteSeededAnchors(tx: Prisma.TransactionClient): Promise<void> {
  const affiliations = await tx.affiliation.findMany({ select: { practitionerId: true } });
  await tx.affiliation.deleteMany({});
  await tx.practiceLocation.deleteMany({});
  const ids = [...new Set(affiliations.map((a) => a.practitionerId))];
  if (ids.length > 0) await tx.practitioner.deleteMany({ where: { id: { in: ids } } });
}
