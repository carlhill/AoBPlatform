import { Injectable } from '@nestjs/common';
import { captureReadiness, orderCards, worstRowsFirst, type CardState, type SetupRow } from '@aobplatform/domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The practice setup hub.
 *
 * NOT A WIZARD. A wizard implies a finish, and a practice adds locations and
 * practitioners for years after it onboards — so this is cards worked in any
 * order, each carrying its own state, revisited indefinitely.
 *
 * ASSEMBLED SERVER-SIDE, in one call, rather than letting the page make six
 * requests and work out readiness itself. Capture readiness is a claim about
 * whether a practice can lawfully record consent, and a claim like that should
 * have one implementation with tests behind it — not a fragment of component
 * logic that quietly disagrees with the API.
 *
 * Every card returns a ROLL-UP plus at most two rows, worst first. A multi-site
 * organisation can have hundreds of affiliations, and a card that scrolls hides
 * exactly the row the promotion rule just surfaced.
 */
@Injectable()
export class SetupService {
  /** Cards summarise; the page holds the list. */
  private static readonly ROWS_PER_CARD = 2;

  constructor(private readonly prisma: PrismaService) {}

  private static trim(rows: SetupRow[]): { rows: SetupRow[]; more: number } {
    const ordered = worstRowsFirst(rows);
    return {
      rows: ordered.slice(0, SetupService.ROWS_PER_CARD),
      more: Math.max(0, ordered.length - SetupService.ROWS_PER_CARD),
    };
  }

  async hub(practiceId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const [practice, locations, affiliations, credentials] = await Promise.all([
        tx.practice.findFirstOrThrow({ where: { id: practiceId } }),
        tx.practiceLocation.findMany({ orderBy: { createdAt: 'asc' } }),
        tx.affiliation.findMany({ include: { practitioner: true, location: true } }),
        tx.practiceCredential.findMany(),
      ]);

      const activeLocations = locations.filter((l) => l.active);

      // Accepted BY THE PRACTITIONER. A practice cannot self-accept, and the
      // difference between invited and accepted is the single fact this hub
      // exists to keep visible.
      const accepted = affiliations.filter((a) => a.status === 'active' || a.status === 'ending');

      // s 65C(5): a provider number, OR a place-of-practice address at an
      // active location. Either satisfies it; neither being present does not.
      const captureReady = accepted.filter(
        (a) => Boolean(a.providerNumber) || activeLocations.some((l) => l.id === a.locationId),
      );

      const readiness = captureReadiness({
        activeLocations: activeLocations.length,
        practitioners: new Set(affiliations.map((a) => a.practitionerId)).size,
        acceptedAffiliations: accepted.length,
        captureReadyAffiliations: captureReady.length,
      });

      // --- 1. The entity ---------------------------------------------------
      // Done at approval and essentially never revisited, which is why it sits
      // first and quiet: it is the only card that is genuinely finished.
      const entity = {
        key: 'entity',
        title: 'The entity',
        state: 'done' as CardState,
        rollup: [practice.entityType ?? 'Entity', practice.abnStatus ?? 'unknown'].join(' · '),
        rows: [
          { label: practice.legalName ?? practice.name, note: `ABN ${practice.abn ?? '—'}`, needsWork: false },
          {
            label: practice.tradingNames?.[0] ? `Trading as ${practice.tradingNames[0]}` : 'No trading name',
            note:
              practice.abnVerificationSource === 'manual_attestation'
                ? `Attested by ${practice.abnSightedByName ?? 'the applicant'}`
                : 'Verified against the ABR',
            needsWork: false,
          },
        ],
        more: 0,
        // The entity is READ-ONLY, but it still has a page. A card with facts
        // on it and no way through reads as a dead end, and the page is where
        // the locked fields explain themselves.
        href: '/practice/entity',
      };

      // --- 2. Locations ----------------------------------------------------
      const locationRows: SetupRow[] = locations.map((l) => ({
        label: l.addressCanonical ?? l.address ?? `${l.addressLine1 ?? ''} ${l.suburb ?? ''}`.trim(),
        note: l.active ? 'active' : 'inactive — the address is not confirmed',
        needsWork: !l.active,
      }));
      const locationTrim = SetupService.trim(locationRows);

      // --- 3. Practitioners ------------------------------------------------
      const practitioners = new Map<string, { name: string; checked: boolean }>();
      for (const a of affiliations) {
        practitioners.set(a.practitionerId, {
          // Family name first, as a register lists them and as a reviewer
          // scanning a column expects.
          name: a.practitioner
            ? `${a.practitioner.familyName}, ${a.practitioner.givenNames}`
            : 'Practitioner',
          checked: Boolean(a.practitioner?.registrationSightedAt),
        });
      }
      const practitionerRows: SetupRow[] = [...practitioners.values()].map((p) => ({
        label: p.name,
        note: p.checked ? 'register checked' : 'register not checked',
        needsWork: !p.checked,
      }));
      const practitionerTrim = SetupService.trim(practitionerRows);

      // --- 4. Affiliations -------------------------------------------------
      const affiliationRows: SetupRow[] = affiliations.map((a) => {
        const ready = Boolean(a.providerNumber) || activeLocations.some((l) => l.id === a.locationId);
        const isAccepted = a.status === 'active' || a.status === 'ending';
        return {
          label: `${a.practitioner?.familyName ?? 'Practitioner'} @ ${a.location?.code ?? 'a location'}`,
          note: !isAccepted ? a.status : ready ? 'capture open' : 'no provider number or active location',
          needsWork: !isAccepted || !ready,
        };
      });
      const affiliationTrim = SetupService.trim(affiliationRows);

      // --- 5. Capture channels ---------------------------------------------
      //
      // Sender-ID registration is ONBOARDING, not settings. It has a lead time,
      // and an unregistered sender shows to patients as "Unverified" and is
      // grouped with scams — so it silently destroys response rates if it is
      // left to be discovered later.
      const channelRows: SetupRow[] = [
        {
          label: 'SMS sender ID',
          note: practice.senderIdRegistered
            ? 'registered'
            : 'unregistered — patients see “Unverified”, alongside scams',
          needsWork: !practice.senderIdRegistered,
        },
        {
          label: 'Kiosk',
          note: 'unpaired',
          needsWork: true,
        },
      ];

      const cards = [
        entity,
        {
          key: 'locations',
          title: 'Locations',
          state: (locations.length === 0
            ? 'not_started'
            : activeLocations.length === 0
              ? 'blocked'
              : locationRows.some((r) => r.needsWork)
                ? 'attention'
                : 'done') as CardState,
          rollup:
            locations.length === 0
              ? 'none yet'
              : `${activeLocations.length} active · ${locations.length - activeLocations.length} pending`,
          ...locationTrim,
          href: '/practice/locations',
        },
        {
          key: 'practitioners',
          title: 'Practitioners',
          state: (practitioners.size === 0
            ? 'not_started'
            : practitionerRows.some((r) => r.needsWork)
              ? 'attention'
              : 'done') as CardState,
          rollup:
            practitioners.size === 0
              ? 'none yet'
              : `${practitionerRows.filter((r) => !r.needsWork).length} register checked · ` +
                `${practitionerRows.filter((r) => r.needsWork).length} not checked`,
          ...practitionerTrim,
          href: '/practice/practitioners',
        },
        {
          key: 'affiliations',
          title: 'Affiliations',
          state: (affiliations.length === 0
            ? 'not_started'
            : captureReady.length === 0
              ? 'blocked'
              : affiliationRows.some((r) => r.needsWork)
                ? 'attention'
                : 'done') as CardState,
          rollup:
            affiliations.length === 0
              ? 'none yet'
              : `${accepted.length} of ${affiliations.length} accepted · ${captureReady.length} capture open`,
          ...affiliationTrim,
          href: '/practice/affiliations',
        },
        {
          key: 'channels',
          title: 'Capture channels',
          state: (channelRows.every((r) => r.needsWork) ? 'not_started' : 'attention') as CardState,
          rollup: practice.senderIdRegistered ? 'sender ID registered' : 'sender ID unregistered',
          ...SetupService.trim(channelRows),
          href: '/practice/channels',
        },
      ];

      return {
        practice: {
          id: practice.id,
          name: practice.name,
          legalName: practice.legalName,
          abn: practice.abn,
          abnStatus: practice.abnStatus,
          validationState: practice.validationState,
          validatedByName: practice.validatedByName,
          validatedAt: practice.validatedAt,
          pms: practice.pms,
          credentialCount: credentials.length,
        },
        readiness,
        // Blocked and attention first. A hub sorted by a designed order rather
        // than by state asks the reader to find the problem; this has already
        // answered.
        cards: orderCards(cards),
      };
    });
  }
}
