import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  establishingEntitlementCheck,
  type PerformedCheck,
  AbnError,
  AddressError,
  isValidAhpraNumberFormat,
  addressWarnings,
  assertAddressUsable,
  ContactError,
  assertContactsIndependent,
  assertOrganisationApplicationValid,
  formatAddress,
  isValidAbnChecksum,
  normaliseAbn,
  parseSingleLine,
  type StructuredAddress,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * How long an applicant has to act on a correction request.
 *
 * Long enough to cover a weekend and a day off; short enough that a copy
 * forwarded, archived or left in a shared inbox is worthless within a week.
 */
const CORRECTION_WINDOW_DAYS = 5;

/**
 * How long an email-verification link lives.
 *
 * Longer than the correction window because it is not urgent: nothing is
 * waiting on it, and an applicant who opens their mail on Monday should not
 * find it dead.
 */
const EMAIL_VERIFICATION_DAYS = 7;
import { PracticeAdminService } from '../identity/practice-admin.service';
import { ChecksService } from './checks.service';
import { ConfigService } from '@nestjs/config';
import { ABR_CLIENT, ADDRESS_VALIDATOR } from './organisations.tokens';
import type { AbrClient } from './abr';
import type { AddressValidator } from './address-validator';

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
    private readonly checks: ChecksService,
    private readonly config: ConfigService,
  ) {}

  /**
   * `soft` (default) records everything and refuses nothing on score alone.
   * `hard` blocks an approval the score would not admit, unless the reviewer
   * overrides with a stated reason.
   *
   * Soft is not caution. You cannot calibrate a threshold you are already
   * enforcing, because you never learn what would have happened to the
   * applications you rejected — so running soft first is the only way to end
   * up with a number that is defensible rather than invented.
   */
  private enforcement(): 'soft' | 'hard' {
    return this.config.get<string>('IDENTITY_ENFORCEMENT', 'soft') === 'hard' ? 'hard' : 'soft';
  }

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
    statedPractitionerCount?: number;
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

    // Contact independence, also before any lookup, for the same reason: it is
    // offline and certain. The second contact exists to give the reviewer
    // somebody to call who is not the applicant, so two contacts sharing an
    // inbox or a handset is one contact wearing a hat. The form refuses this
    // too, but the form is not the boundary — this endpoint is.
    try {
      assertContactsIndependent({
        adminEmail: input.adminEmail,
        adminPhone: input.adminPhone,
        managerEmail: input.managerEmail,
        managerPhone: input.managerPhone,
      });
    } catch (err) {
      if (err instanceof ContactError) throw new BadRequestException(err.message);
      throw err;
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
          statedPractitionerCount: input.statedPractitionerCount ?? null,
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

    // Issue the email-verification token before acknowledging, so the
    // acknowledgement can carry the link. Seven days rather than the
    // correction window's five: this one is not urgent, and an applicant who
    // let it lapse should not be chased twice in a week.
    const [verification] = await this.prisma.$queryRaw<Array<{ token: string; code: string; expiresAt: Date }>>`
      SELECT * FROM issue_email_verification(${organisation.id}::uuid, ${EMAIL_VERIFICATION_DAYS}::integer)`;

    // Acknowledge, LAST, and never let it fail the registration. Everything
    // above is committed by this point; an application lost because a mail
    // server hiccuped would be a far worse outcome than an applicant who does
    // not receive a receipt.
    const acknowledgement = await this.practiceAdmin
      .onApplicationReceived({
        organisationId: organisation.id,
        organisationName: organisation.name,
        adminName: input.adminName,
        adminEmail: input.adminEmail,
        statusUrl: `${this.config.get<string>('APPLICATION_STATUS_BASE_URL', 'http://localhost:21100')}/status/${
          (
            await this.prisma.$queryRaw<Array<{ statusToken: string }>>`
              SELECT * FROM find_status_token(${organisation.id}::uuid)`
          )[0]?.statusToken ?? ''
        }`,
        supportPhone: this.config.get<string>('SUPPORT_PHONE'),
        verifyUrl: verification
          ? `${this.config.get<string>('APPLICATION_STATUS_BASE_URL', 'http://localhost:21100')}/verify/${
              verification.token
            }`
          : undefined,
        verifyCode: verification?.code,
        verifyExpiresAt: verification?.expiresAt,
      })
      .catch((err: Error) => {
        this.logger.error(`The acknowledgement for ${organisation.id} threw: ${err.message}`);
        return { notified: false, detail: 'The acknowledgement could not be sent.' };
      });

    return {
      acknowledgement,
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

  /**
   * The applicant's status and amendment links.
   *
   * Read through a SECURITY DEFINER function because a reviewer has no practice
   * context either — the console is cross-tenant by definition.
   */
  async statusLinks(organisationId: string) {
    const [row] = await this.prisma.$queryRaw<Array<{ statusToken: string }>>`
      SELECT * FROM find_status_token(${organisationId}::uuid)`;
    if (!row) throw new NotFoundException('No such application.');

    const base = this.config.get<string>('APPLICATION_STATUS_BASE_URL', 'http://localhost:21100');
    return {
      statusUrl: `${base}/status/${row.statusToken}`,
      amendUrl: `${base}/status/${row.statusToken}/correct`,
    };
  }

  /**
   * Ask the applicant to correct the application, and open a time-boxed window.
   *
   * Reviewer-initiated on purpose. Opening the window at submission would start
   * the clock while the application sits in a queue nobody has reached, so it
   * could expire before anyone had read it. Opening it here makes it an
   * attributable act: a named person looked, found something fixable, and said
   * so.
   */
  async requestCorrection(
    organisationId: string,
    input: { reason: string; requestedByName: string; windowDays?: number },
  ) {
    const days = input.windowDays ?? CORRECTION_WINDOW_DAYS;

    const [opened] = await this.prisma.$queryRaw<Array<{ statusToken: string; correctionExpiresAt: Date }>>`
      SELECT * FROM open_correction_window(
        ${organisationId}::uuid, ${days}::integer, ${input.requestedByName}, ${input.reason})`;

    if (!opened) {
      // The function only touches a PENDING application, so no row back means
      // it has already been decided.
      throw new BadRequestException(
        'This application has already been decided, so there is nothing for the applicant to correct.',
      );
    }

    const organisation = await this.prisma.withPractice(organisationId, (tx) =>
      tx.practice.findFirstOrThrow({ where: { id: organisationId } }),
    );

    const base = this.config.get<string>('APPLICATION_STATUS_BASE_URL', 'http://localhost:21100');
    const correctUrl = `${base}/status/${opened.statusToken}/correct`;

    const notified = await this.practiceAdmin.onCorrectionRequested({
      organisationName: organisation.name,
      adminName: organisation.adminName,
      adminEmail: organisation.adminEmail,
      reason: input.reason,
      requestedByName: input.requestedByName,
      correctUrl,
      expiresAt: opened.correctionExpiresAt,
      windowDays: days,
    });

    return {
      requested: true,
      expiresAt: opened.correctionExpiresAt,
      windowDays: days,
      correctUrl,
      notified: notified.notified,
      detail: notified.detail,
    };
  }

  /**
   * Send (or re-send) the email-confirmation link.
   *
   * New applications get one automatically at submission. This exists for the
   * two cases that automation cannot cover: an applicant whose link expired or
   * never arrived, and an application that predates the feature entirely.
   *
   * Reviewer-initiated rather than self-serve, because the applicant's route to
   * ask for one is to reply to the email — and if they cannot receive our email,
   * a self-serve button on a page they reach by email helps nobody.
   */
  async requestEmailVerification(organisationId: string) {
    const [issued] = await this.prisma.$queryRaw<
      Array<{
        token: string;
        code: string;
        expiresAt: Date;
        adminEmail: string | null;
        adminName: string | null;
        name: string;
      }>
    >`SELECT * FROM issue_email_verification(${organisationId}::uuid, ${EMAIL_VERIFICATION_DAYS}::integer)`;

    if (!issued) {
      // The function skips an already-verified address, so no row back means
      // there was nothing to do — which is a success, not a failure.
      return { sent: false, detail: 'That address has already been confirmed, so no new link was sent.' };
    }
    if (!issued.adminEmail) {
      return { sent: false, detail: 'No admin email is on record, so there is nowhere to send it.' };
    }

    const base = this.config.get<string>('APPLICATION_STATUS_BASE_URL', 'http://localhost:21100');
    const result = await this.practiceAdmin.onEmailVerificationRequested({
      organisationName: issued.name,
      adminName: issued.adminName,
      adminEmail: issued.adminEmail,
      verifyUrl: `${base}/verify/${issued.token}`,
      code: issued.code,
      expiresAt: issued.expiresAt,
    });

    return { sent: result.notified, expiresAt: issued.expiresAt, detail: result.detail };
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
      /** Required to approve against the score's advice when enforcement is hard. */
      identityOverrideReason?: string;
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

    // Score the practice as it stands, BEFORE the decision is written, so what
    // is stored is what the reviewer was actually looking at.
    const assessment = await this.checks.summary(organisationId);
    const mode = this.enforcement();

    /*
     * THE ENTITLEMENT COMES OFF THE RECORDED CHECK, not off the request.
     *
     * A reviewer who has already recorded a phone call — with the number, where
     * the number came from, who answered, and an artefact attached — should not
     * be asked to type it again at the decision, and what they typed should
     * certainly not outrank what was recorded. Two records of one event can
     * disagree, and the retyped one is the copy without evidence attached.
     *
     * It also fixes an attribution that was quietly wrong: one person rings the
     * practice and another approves, which is ordinary and arguably better
     * practice, and the decision used to record the APPROVER as the person who
     * made the call.
     *
     * The inline fields survive as a fallback for the case where no check was
     * recorded at all. They are used only then.
     */
    const established = establishingEntitlementCheck(assessment.history as PerformedCheck[]);
    const entitlement = established
      ? {
          method: established.method,
          phoneNumber: established.phoneNumber,
          numberSource: established.numberSource,
          spokeWithName: established.spokeWithName,
          checkedByName: established.performedByName,
          checkedAt: new Date(established.performedAt),
        }
      : {
          method: input.entitlementMethod,
          phoneNumber: input.entitlementPhoneNumber,
          numberSource: input.entitlementNumberSource,
          spokeWithName: input.entitlementSpokeWithName,
          // Null, so the function falls back to the reviewer — which is right
          // only here, where reviewer and checker really are the same person.
          checkedByName: undefined,
          checkedAt: undefined,
        };

    if (input.decision === 'validated' && mode === 'hard' && !assessment.admission.wouldPass) {
      if (!input.identityOverrideReason?.trim()) {
        throw new BadRequestException(
          'Identity enforcement is HARD and this practice does not meet the threshold: ' +
            assessment.admission.reasons.join(' ') +
            ' Approving anyway is possible, but it must carry a reason — an override with no explanation is ' +
            'indistinguishable from the threshold not existing.',
        );
      }
      this.logger.warn(
        `Practice ${organisationId} approved by ${input.reviewerName.trim()} against the identity threshold ` +
          `(score ${assessment.summary.score}): ${input.identityOverrideReason.trim()}`,
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
        ${entitlement.method ?? null}, ${entitlement.phoneNumber ?? null},
        ${entitlement.numberSource ?? null}, ${entitlement.spokeWithName ?? null},
        ${entitlement.checkedByName ?? null}, ${entitlement.checkedAt ?? null})`;

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
        entitlementMethod: entitlement.method ?? 'none',
        entitlementNumberSource: entitlement.numberSource ?? 'n/a',
        /*
         * WHO ESTABLISHED ENTITLEMENT, recorded separately from who approved.
         * They are often different people and the evidence should say so —
         * conflating them is how a record comes to assert something nobody did.
         */
        entitlementCheckedBy: entitlement.checkedByName ?? input.reviewerName.trim(),
        entitlementFromRecordedCheck: Boolean(established),
        entitlementCheckHadEvidence: established?.hasEvidence ?? false,
        // The score is part of the decision record, not a side calculation.
        identityScore: assessment.summary.score,
        identityScoringVersion: assessment.checklistVersion,
        identityWouldPassUnderHard: assessment.admission.wouldPass,
        identityEnforcement: mode,
      },
    });

    // Stamped with the scoring version, because a re-weighting must never
    // rewrite what a past reviewer was shown.
    await this.prisma.withPractice(organisationId, (tx) =>
      tx.practice.update({
        where: { id: organisationId },
        data: {
          identityScoreAtDecision: assessment.summary.score,
          identityScoringVersion: assessment.checklistVersion,
          identityWouldPassAtDecision: assessment.admission.wouldPass,
          identityEnforcementAtDecision: mode,
          identityOverrideReason: input.identityOverrideReason?.trim() || null,
        },
      }),
    );

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
            entitlementMethod: entitlement.method,
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
      identity: {
        score: assessment.summary.score,
        scoringVersion: assessment.checklistVersion,
        enforcement: mode,
        wouldPassUnderHard: assessment.admission.wouldPass,
        reasons: assessment.admission.reasons,
        overrideReason: input.identityOverrideReason?.trim() || null,
      },
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
