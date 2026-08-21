import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AbnError, assertOrganisationApplicationValid, isValidAbnChecksum, normaliseAbn } from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { ABR_CLIENT, ADDRESS_VALIDATOR } from './organisations.tokens';
import type { AbrClient } from './abr';
import type { AddressValidator } from './address-validator';
import { extractState } from './address-validator';

/**
 * Organisation onboarding (ORG-MODEL-PROPOSAL.md §4).
 *
 * Three gates, in order, and all three must pass:
 *   1. the ABN checksum          — offline, catches typos before any wait
 *   2. the ABR                   — ACTIVE, and the typed name matches a
 *                                  registered legal or business name
 *   3. a named human             — because 1 and 2 together are necessary and
 *                                  not sufficient
 *
 * Nothing here holds a bank account number, and nothing ever will (§8).
 */
@Injectable()
export class OrganisationsService {
  private readonly logger = new Logger(OrganisationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ABR_CLIENT) private readonly abr: AbrClient,
    @Inject(ADDRESS_VALIDATOR) private readonly addresses: AddressValidator,
  ) {}

  /**
   * Gate 1 + 2. Creates the organisation in `pending`, which can do nothing
   * until a human validates it.
   */
  async register(input: {
    name: string;
    abn: string;
    acn?: string;
    pms?: string;
    hpiO?: string;
    adminName: string;
    adminEmail: string;
    adminPhone: string;
    adminPosition?: string;
    managerName?: string;
    managerEmail?: string;
    managerPhone?: string;
    managerPosition?: string;
    website?: string;
    headOfficeAddress: string;
    headOfficeIsPlaceOfPractice?: boolean;
    credentialType?: string;
    credentialValue?: string;
    abrAttestation?: {
      legalName: string;
      businessNames?: string[];
      abnStatus: string;
      entityType: string;
      gstRegistered?: boolean;
      sightedByName: string;
    };
  }) {
    const abn = normaliseAbn(input.abn);

    // Gate 1 FIRST, before any lookup. It is pure arithmetic, so a typo comes
    // back as "the check digits do not agree" rather than as whatever the ABR
    // says about a number that was never going to resolve.
    if (!isValidAbnChecksum(abn)) {
      throw new BadRequestException(`"${input.abn}" is not a valid ABN — the check digits do not agree.`);
    }

    // The API wins whenever it can answer. A human attestation is a FALLBACK
    // for environments with no GUID, never an override — otherwise "the ABR
    // says CANCELLED" could be talked around by retyping it.
    let lookup = await this.abr.lookup(abn);
    let source: 'abr_api' | 'manual_attestation' = 'abr_api';

    if (!lookup && input.abrAttestation) {
      const attested = input.abrAttestation;
      lookup = {
        abn,
        abnStatus: attested.abnStatus,
        legalName: attested.legalName,
        businessNames: attested.businessNames ?? [],
        entityType: attested.entityType,
        gstRegistered: attested.gstRegistered,
      };
      source = 'manual_attestation';
      this.logger.warn(
        `ABN ${abn} was verified by ATTESTATION, not by the ABR API: ${attested.sightedByName} sighted the ` +
          'register and typed these details. The reviewer approving this practice will see that.',
      );
    }

    if (!lookup) {
      throw new BadRequestException(
        this.abr.kind === 'offline'
          ? `ABN ${abn} passed its check digits, but no ABN lookup is configured in this environment, so it ` +
            'cannot be verified against the ABR — and an organisation is never created on an unverified ABN. ' +
            'Either register for an ABN Lookup GUID at abr.business.gov.au and set ABR_API_GUID, or use one ' +
            'of the offline fixtures: 53004085616, 51824753556, 13824753558.'
          : `The ABR returned no record for ABN ${abn}. Check the number, or refer to human validation.`,
      );
    }

    let gate;
    try {
      gate = assertOrganisationApplicationValid({ typedName: input.name, abn, acn: input.acn }, lookup);
    } catch (err) {
      if (err instanceof AbnError) throw new BadRequestException(err.message);
      throw err;
    }

    // One ABN, one organisation. A second registration against the same ABN is
    // almost always someone re-onboarding a practice that already exists.
    //
    // Both this and the create below go through SECURITY DEFINER functions,
    // because registration is PRE-TENANT: there is no practice id to scope to
    // yet, so an ordinary insert can never satisfy the RLS WITH CHECK. Doing
    // it through the client would not error — RLS would simply filter the
    // duplicate check to zero rows and then refuse the insert.
    const [existing] = await this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT * FROM find_organisation_by_abn(${abn})`;
    if (existing) {
      throw new ConflictException(
        `ABN ${abn} is already registered on this platform as "${existing.name}". If this is your practice ` +
          'and you have lost access, that is an account recovery, not a new registration.',
      );
    }

    const [{ register_organisation: organisationId }] = await this.prisma.$queryRaw<
      Array<{ register_organisation: string }>
    >`SELECT register_organisation(
        ${input.name}, ${gate.abn}, ${gate.acn}, ${gate.legalName},
        ${gate.businessNames as string[]}, ${gate.entityType},
        ${lookup.abnStatus.toUpperCase()}, ${gate.gstRegistered},
        ${gate.nameMatch.tier}, ${gate.nameMatch.matched ?? null},
        ${input.hpiO ?? null}, ${input.pms ?? 'medtech_evolution'},
        ${source}, ${input.abrAttestation?.sightedByName ?? null},
        ${input.adminName}, ${input.adminEmail}, ${input.adminPhone}, ${input.website ?? null},
        ${input.headOfficeAddress}, ${extractState(input.headOfficeAddress) ?? null},
        ${input.headOfficeIsPlaceOfPractice ?? false},
        ${input.credentialType ?? null}, ${input.credentialValue ?? null},
        ${input.adminPosition ?? null}, ${input.managerName ?? null}, ${input.managerEmail ?? null},
        ${input.managerPhone ?? null}, ${input.managerPosition ?? null})`;

    const organisation = await this.prisma.withPractice(organisationId, (tx) =>
      tx.practice.findFirstOrThrow({ where: { id: organisationId } }),
    );

    await enqueueVaultEvent(this.prisma, {
      type: 'organisation.registered',
      actor: { principalType: 'system', id: 'onboarding' },
      subject: { type: 'Organisation', id: organisation.id },
      payload: {
        abnStatus: lookup.abnStatus.toUpperCase(),
        entityType: gate.entityType,
        nameMatchTier: gate.nameMatch.tier,
        acnDerived: Boolean(gate.acn),
        // Provenance is evidence: "the register said so" and "a colleague
        // said the register said so" are different claims.
        verificationSource: source,
        sightedBy: input.abrAttestation?.sightedByName ?? 'n/a',
      },
    });

    if (input.headOfficeIsPlaceOfPractice) {
      const result = await this.addresses.validate(input.headOfficeAddress);
      await this.prisma.withPractice(organisationId, (tx) =>
        tx.practiceLocation.create({
          data: {
            practiceId: organisationId,
            address: input.headOfficeAddress,
            code: 'Head office',
            state: result.state ?? extractState(input.headOfficeAddress),
            addressValidated: result.validated,
            addressCanonical: result.canonical,
            active: result.validated,
          },
        }),
      );
    }

    return {
      id: organisation.id,
      name: organisation.name,
      abn: organisation.abn,
      acn: organisation.acn,
      legalName: organisation.legalName,
      tradingNames: organisation.tradingNames,
      entityType: organisation.entityType,
      validationState: organisation.validationState,
      abnVerificationSource: organisation.abnVerificationSource,
      abnSightedByName: organisation.abnSightedByName,
      adminEmail: organisation.adminEmail,
      headOfficeAddress: organisation.headOfficeAddress,
      headOfficeIsPlaceOfPractice: organisation.headOfficeIsPlaceOfPractice,
      /** Shown to the operator so an inexact match is visible, not silent. */
      nameMatch: { tier: gate.nameMatch.tier, matched: gate.nameMatch.matched, source: gate.nameMatch.source },
      next: 'This organisation is queued for human validation. It cannot add locations or practitioners until approved.',
    };
  }

  /**
   * The queue a reviewer works from. Spans every tenant by definition — a
   * platform operator reviewing applications — so it goes through the
   * function rather than the scoped client, which would return nothing.
   */
  async pendingValidation() {
    const pending = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM list_pending_organisations()`;
    return { count: pending.length, organisations: pending };
  }

  /**
   * Every organisation that has applied, in any state.
   *
   * Platform-operator territory: the person who approves practices needs to
   * find one afterwards, and an approved organisation leaves the pending
   * queue. Carries no patient data, no agreements and no provider numbers.
   */
  async listOrganisations(state: 'pending' | 'validated' | 'rejected' | 'all' = 'all') {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM list_organisations(${state})`;
    return {
      count: rows.length,
      organisations: rows.map((r) => ({
        ...r,
        // bigint does not survive JSON.
        locationCount: Number(r.locationCount ?? 0),
        activeLocationCount: Number(r.activeLocationCount ?? 0),
      })),
    };
  }

  /** Gate 3. The reviewer is NAMED — "approved by the system" is not a thing. */
  async decideValidation(
    organisationId: string,
    input: {
      decision: 'validated' | 'rejected';
      reviewerName: string;
      note?: string;
      /** §11 — HOW the applicant was verified to represent this entity. */
      entitlementMethod?: string;
      entitlementPhoneNumber?: string;
      entitlementNumberSource?: string;
      entitlementSpokeWithName?: string;
    },
  ) {
    if (!input.reviewerName?.trim()) {
      throw new BadRequestException('A validation decision must name the human who made it.');
    }
    const [organisation] = await this.prisma.$queryRaw<Array<{ validationState: string }>>`
      SELECT * FROM get_organisation_validation(${organisationId}::uuid)`;
    if (!organisation) throw new NotFoundException('Organisation not found.');
    if (organisation.validationState !== 'pending') {
      throw new ConflictException(
        `This organisation is already ${organisation.validationState}. Re-deciding would overwrite the ` +
          'record of who approved it and when.',
      );
    }
    if (input.decision === 'rejected' && !input.note?.trim()) {
      throw new BadRequestException('A rejection must record why, so the applicant can be told something useful.');
    }

    // The function re-checks 'pending' itself, so two reviewers racing cannot
    // both write a decision.
    const [updated] = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        validationState: string;
        validatedByName: string;
        validatedAt: Date;
        adminName: string | null;
        adminEmail: string | null;
      }>
    >`SELECT * FROM decide_organisation_validation(
        ${organisationId}::uuid, ${input.decision}, ${input.reviewerName.trim()}, ${input.note ?? null},
        ${input.entitlementMethod ?? null}, ${input.entitlementPhoneNumber ?? null},
        ${input.entitlementNumberSource ?? null}, ${input.entitlementSpokeWithName ?? null})`;

    await enqueueVaultEvent(this.prisma, {
      type: input.decision === 'validated' ? 'organisation.validated' : 'organisation.rejected',
      actor: { principalType: 'staff', id: organisationId },
      subject: { type: 'Organisation', id: organisationId },
      // The reviewer's NAME is evidence here, not PII incidental to a payload:
      // "who approved this practice" is the whole point of the queue.
      payload: {
        decision: input.decision,
        reviewedBy: input.reviewerName.trim(),
        // The entitlement decision is the substance of the approval, so it is
        // evidence rather than incidental detail.
        entitlementMethod: input.entitlementMethod ?? 'none',
        entitlementNumberSource: input.entitlementNumberSource ?? 'n/a',
      },
    });

    return {
      id: updated.id,
      validationState: updated.validationState,
      validatedBy: updated.validatedByName,
      validatedAt: updated.validatedAt,
    };
  }

  /** Used by every downstream flow — a pending organisation does nothing. */
  async assertValidated(organisationId: string): Promise<void> {
    const [organisation] = await this.prisma.$queryRaw<Array<{ name: string; validationState: string }>>`
      SELECT * FROM get_organisation_validation(${organisationId}::uuid)`;
    if (!organisation) throw new NotFoundException('Organisation not found.');
    if (organisation.validationState === 'not_applicable') {
      throw new BadRequestException(
        `"${organisation.name}" was not created through organisation onboarding — it has no verified ABN, so ` +
          'there is nothing to validate. Register it via POST /organisations to use the location, ' +
          'department and affiliation endpoints.',
      );
    }
    if (organisation.validationState !== 'validated') {
      throw new BadRequestException(
        `"${organisation.name}" is ${organisation.validationState}, not validated. An ACTIVE ABN with a ` +
          'matching name is necessary but not sufficient — a named human approves before a practice operates.',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Locations
  // -------------------------------------------------------------------------

  /**
   * A location is created INACTIVE. It cannot host an affiliation until its
   * address validates, because an unconfirmed address must not appear in a
   * s 65C(5)(a) particulars block.
   */
  async addLocation(practiceId: string, input: { address: string; code?: string }) {
    await this.assertValidated(practiceId);

    const result = await this.addresses.validate(input.address);

    return this.prisma.withPractice(practiceId, async (tx) => {
      const location = await tx.practiceLocation.create({
        data: {
          practiceId,
          address: input.address,
          code: input.code,
          state: result.state ?? extractState(input.address),
          addressValidated: result.validated,
          addressCanonical: result.canonical,
          gnafPid: result.gnafPid,
          gnafVersion: result.gnafVersion,
          active: result.validated,
        },
      });
      if (result.validated) {
        await enqueueVaultEvent(tx, {
          type: 'location.activated',
          actor: { principalType: 'system', id: 'address_validation' },
          subject: { type: 'PracticeLocation', id: location.id },
          payload: { validator: this.addresses.kind, state: location.state ?? 'unknown' },
        });
      }
      return {
        id: location.id,
        address: location.addressCanonical ?? location.address,
        code: location.code,
        state: location.state,
        active: location.active,
        addressValidated: location.addressValidated,
        validator: this.addresses.kind,
        reason: result.reason,
        suggestions: result.suggestions,
      };
    });
  }

  /**
   * Manual activation, for ADDRESS_VALIDATION_MODE=manual. Named human, same
   * as the organisation queue — and recorded as a MANUAL validation so the
   * evidence never claims G-NAF confirmed something it did not.
   */
  async activateLocation(practiceId: string, locationId: string, reviewerName: string) {
    if (!reviewerName?.trim()) {
      throw new BadRequestException('Activating a location must name the human who confirmed the address.');
    }
    await this.assertValidated(practiceId);

    return this.prisma.withPractice(practiceId, async (tx) => {
      const location = await tx.practiceLocation.findFirst({ where: { id: locationId } });
      if (!location) throw new NotFoundException('Location not found in this practice.');
      if (!location.state) {
        throw new BadRequestException(
          'This location has no state, so the public-holiday calendar for 2-business-day terminations ' +
            'cannot be selected (REQ-OFF-03). Fix the address first.',
        );
      }
      const updated = await tx.practiceLocation.update({
        where: { id: locationId },
        data: { active: true, addressValidated: true, gnafVersion: `manual:${reviewerName.trim()}` },
      });
      await enqueueVaultEvent(tx, {
        type: 'location.activated',
        actor: { principalType: 'staff', id: practiceId },
        subject: { type: 'PracticeLocation', id: locationId },
        payload: { validator: 'manual', confirmedBy: reviewerName.trim(), state: updated.state ?? 'unknown' },
      });
      return { id: updated.id, active: updated.active, state: updated.state, validator: 'manual' as const };
    });
  }

  async listLocations(practiceId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const locations = await tx.practiceLocation.findMany({ orderBy: { createdAt: 'asc' } });
      return locations.map((l) => ({
        id: l.id,
        code: l.code,
        address: l.addressCanonical ?? l.address,
        state: l.state,
        active: l.active,
        addressValidated: l.addressValidated,
      }));
    });
  }

  // -------------------------------------------------------------------------
  // Departments
  // -------------------------------------------------------------------------

  async addDepartment(practiceId: string, input: { locationId: string; name: string }) {
    await this.assertValidated(practiceId);
    return this.prisma.withPractice(practiceId, async (tx) => {
      const location = await tx.practiceLocation.findFirst({ where: { id: input.locationId } });
      if (!location) throw new NotFoundException('Location not found in this practice.');
      try {
        return await tx.department.create({
          data: { practiceId, locationId: input.locationId, name: input.name },
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          throw new ConflictException(`"${input.name}" already exists at this location.`);
        }
        throw err;
      }
    });
  }

  async listDepartments(practiceId: string, locationId?: string) {
    return this.prisma.withPractice(practiceId, (tx) =>
      tx.department.findMany({ where: locationId ? { locationId } : {}, orderBy: { name: 'asc' } }),
    );
  }
}
