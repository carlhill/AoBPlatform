import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AbnError,
  AddressError,
  isValidAhpraNumberFormat,
  addressWarnings,
  assertAddressUsable,
  assertOrganisationApplicationValid,
  formatAddress,
  isValidAbnChecksum,
  normaliseAbn,
  parseSingleLine,
  type StructuredAddress,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { PracticeAdminService } from '../identity/practice-admin.service';
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
    private readonly practiceAdmin: PracticeAdminService,
  ) {}

  /**
   * Accept an address as SIX FIELDS, or fall back to parsing one line.
   *
   * The single line is a compatibility path, not the preferred one: it is
   * lossy, and when it cannot be parsed the caller gets nothing rather than a
   * guess. Structured input is what every downstream check matches on.
   */
  private structureAddress(input: {
    addressLine1?: string;
    addressLine2?: string;
    suburb?: string;
    state?: string;
    postcode?: string;
    country?: string;
    singleLine?: string;
  }): { address: StructuredAddress; canonical: string; warnings: ReturnType<typeof addressWarnings> } {
    let candidate: Partial<StructuredAddress>;

    if (input.addressLine1?.trim()) {
      candidate = {
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2 ?? null,
        suburb: input.suburb ?? '',
        state: (input.state ?? '').toUpperCase(),
        postcode: input.postcode ?? '',
        country: input.country ?? 'Australia',
      };
    } else {
      const parsed = parseSingleLine(input.singleLine ?? '');
      if (!parsed.parsed) {
        throw new BadRequestException(
          'This address could not be read as an Australian address. Enter it as separate fields: address ' +
            'line 1, suburb, state and postcode. Those are what the AHPRA register, G-NAF and the ABR are ' +
            'matched against, so a single line cannot be used.',
        );
      }
      candidate = parsed;
    }

    const address = candidate as StructuredAddress;
    try {
      assertAddressUsable(address);
    } catch (err) {
      if (err instanceof AddressError) throw new BadRequestException(err.message);
      throw err;
    }
    return { address, canonical: formatAddress(address), warnings: addressWarnings(address) };
  }

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
    headOfficeAddress?: string;
    headOfficeLine1?: string;
    headOfficeLine2?: string;
    headOfficeSuburb?: string;
    headOfficeState?: string;
    headOfficePostcode?: string;
    headOfficeCountry?: string;
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

    const headOffice = this.structureAddress({
      addressLine1: input.headOfficeLine1,
      addressLine2: input.headOfficeLine2,
      suburb: input.headOfficeSuburb,
      state: input.headOfficeState,
      postcode: input.headOfficePostcode,
      country: input.headOfficeCountry,
      singleLine: input.headOfficeAddress,
    });

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
        ${headOffice.canonical}, ${headOffice.address.state},
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

    await this.prisma.withPractice(organisationId, (tx) =>
      tx.practice.update({
        where: { id: organisationId },
        data: {
          headOfficeLine1: headOffice.address.addressLine1,
          headOfficeLine2: headOffice.address.addressLine2,
          headOfficeSuburb: headOffice.address.suburb,
          headOfficePostcode: headOffice.address.postcode,
          headOfficeCountry: headOffice.address.country ?? 'Australia',
        },
      }),
    );

    // The first credential goes into the table too, so there is one place to
    // read them from. The legacy columns stay for now and are the compatibility
    // path, not the source of truth.
    if (input.credentialType && input.credentialValue?.trim()) {
      await this.prisma.withPractice(organisationId, (tx) =>
        tx.practiceCredential.create({
          data: {
            practiceId: organisationId,
            credentialType: input.credentialType!,
            credentialValue: input.credentialValue!.trim(),
            addedByName: input.adminName,
          },
        }),
      );
    }

    if (input.headOfficeIsPlaceOfPractice) {
      const result = await this.addresses.validate(headOffice.canonical);
      await this.prisma.withPractice(organisationId, (tx) =>
        tx.practiceLocation.create({
          data: {
            practiceId: organisationId,
            address: headOffice.canonical,
            addressLine1: headOffice.address.addressLine1,
            addressLine2: headOffice.address.addressLine2,
            suburb: headOffice.address.suburb,
            postcode: headOffice.address.postcode,
            country: headOffice.address.country ?? 'Australia',
            code: 'Head office',
            state: headOffice.address.state,
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
      addressWarnings: headOffice.warnings,
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
    // INPUT VALIDATION RUNS FIRST, before the organisation is even looked up.
    // These checks were originally below the state lookup, so a malformed
    // rejection reason on an already-decided organisation reported "already
    // rejected" and the reason was never examined at all — the guard looked
    // like it worked because the wrong error happened to fire.
    if (input.decision === 'rejected' && !input.note?.trim()) {
      throw new BadRequestException('A rejection must record why, so the applicant can be told something useful.');
    }
    if (input.decision === 'rejected' && /already registered/i.test(input.note ?? '')) {
      throw new BadRequestException(
        'A rejection reason must not disclose whether an ABN is already registered here — that turns a ' +
          'rejection into a way to enumerate our customers. Say that the application could not be verified.',
      );
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

    // Step 3 begins here. Deliberately AFTER the decision is committed: an
    // approval must not be rolled back because an email bounced, and the
    // outcome of the invitation is returned rather than swallowed.
    const followUp =
      input.decision === 'validated'
        ? await this.practiceAdmin.onApproved({
            organisationId: organisationId,
            organisationName: updated.name,
            adminName: updated.adminName,
            adminEmail: updated.adminEmail,
            approvedByName: input.reviewerName.trim(),
            entitlementMethod: input.entitlementMethod,
          })
        : await this.practiceAdmin.onRejected({
            organisationName: updated.name,
            adminEmail: updated.adminEmail,
            reason: input.note ?? 'The application could not be verified.',
            rejectedByName: input.reviewerName.trim(),
          });

    return {
      id: updated.id,
      validationState: updated.validationState,
      validatedBy: updated.validatedByName,
      validatedAt: updated.validatedAt,
      adminEmail: updated.adminEmail,
      followUp,
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
  async addLocation(
    practiceId: string,
    input: {
      address?: string;
      addressLine1?: string;
      addressLine2?: string;
      suburb?: string;
      state?: string;
      postcode?: string;
      country?: string;
      code?: string;
    },
  ) {
    await this.assertValidated(practiceId);

    const structured = this.structureAddress({ ...input, singleLine: input.address });
    const result = await this.addresses.validate(structured.canonical);

    return this.prisma.withPractice(practiceId, async (tx) => {
      const location = await tx.practiceLocation.create({
        data: {
          practiceId,
          address: structured.canonical,
          addressLine1: structured.address.addressLine1,
          addressLine2: structured.address.addressLine2,
          suburb: structured.address.suburb,
          postcode: structured.address.postcode,
          country: structured.address.country ?? 'Australia',
          code: input.code,
          state: structured.address.state,
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
        warnings: structured.warnings,
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
        addressLine1: l.addressLine1,
        addressLine2: l.addressLine2,
        suburb: l.suburb,
        postcode: l.postcode,
        country: l.country,
        state: l.state,
        active: l.active,
        addressValidated: l.addressValidated,
      }));
    });
  }

  // -------------------------------------------------------------------------
  // Credentials — many per practice, and entry is worth nothing
  // -------------------------------------------------------------------------

  /**
   * Add a credential. It arrives UNVERIFIED and therefore worth zero.
   *
   * That is the rule the whole strength score rests on
   * (IDENTITY-STRENGTH-DESIGN.md §1): points attach to verified checks, never
   * to entered data. If typing an HPI-O scored, a fraudster would type ten
   * invented ones and clear any threshold, and the score would be measuring
   * effort at the keyboard.
   */
  async addCredential(
    practiceId: string,
    input: { credentialType: string; credentialValue: string; label?: string; addedByName?: string },
  ) {
    const value = input.credentialValue.trim();
    if (!value) throw new BadRequestException('A credential needs a number or reference.');

    // Format-check what we can. An AHPRA number has a shape, and catching a
    // typo now saves a reviewer chasing a number that never existed.
    if (input.credentialType === 'ahpra' && !isValidAhpraNumberFormat(value)) {
      throw new BadRequestException(
        `"${value}" is not a valid AHPRA registration number. Three profession letters then ten digits, ` +
          'e.g. MED0001234567.',
      );
    }

    try {
      return await this.prisma.withPractice(practiceId, (tx) =>
        tx.practiceCredential.create({
          data: {
            practiceId,
            credentialType: input.credentialType,
            credentialValue: value,
            label: input.label,
            addedByName: input.addedByName,
          },
        }),
      );
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          'That credential is already recorded for this practice. The same number twice is a duplicate, not a ' +
            'second signal.',
        );
      }
      throw err;
    }
  }

  async listCredentials(practiceId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const rows = await tx.practiceCredential.findMany({ orderBy: { addedAt: 'asc' } });
      return rows.map((c) => ({
        id: c.id,
        credentialType: c.credentialType,
        credentialValue: c.credentialValue,
        label: c.label,
        verified: Boolean(c.verifiedAt),
        verifiedAt: c.verifiedAt,
        verifiedByName: c.verifiedByName,
        verificationMethod: c.verificationMethod,
        addedAt: c.addedAt,
        addedByName: c.addedByName,
      }));
    });
  }

  /**
   * Record that a credential was actually checked. THIS is what carries weight.
   * A named human and a method are both required — enforced by CHECK
   * constraint as well as here, because a "verified" flag with nobody attached
   * would be a free point for typing.
   */
  async verifyCredential(
    practiceId: string,
    credentialId: string,
    input: { verifiedByName: string; verificationMethod: string; note?: string },
  ) {
    if (!input.verifiedByName?.trim()) {
      throw new BadRequestException('Verifying a credential must name the human who checked it.');
    }
    return this.prisma.withPractice(practiceId, async (tx) => {
      const existing = await tx.practiceCredential.findFirst({ where: { id: credentialId } });
      if (!existing) throw new NotFoundException('Credential not found in this practice.');
      const updated = await tx.practiceCredential.update({
        where: { id: credentialId },
        data: {
          verifiedAt: new Date(),
          verifiedByName: input.verifiedByName.trim(),
          verificationMethod: input.verificationMethod,
          verificationNote: input.note,
        },
      });
      await enqueueVaultEvent(tx, {
        type: 'organisation.validated',
        actor: { principalType: 'staff', id: practiceId },
        subject: { type: 'PracticeCredential', id: credentialId },
        payload: {
          action: 'credential_verified',
          credentialType: updated.credentialType,
          method: input.verificationMethod,
          verifiedBy: input.verifiedByName.trim(),
        },
      });
      return updated;
    });
  }

  async removeCredential(practiceId: string, credentialId: string) {
    return this.prisma.withPractice(practiceId, (tx) =>
      tx.practiceCredential.deleteMany({ where: { id: credentialId } }),
    );
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
