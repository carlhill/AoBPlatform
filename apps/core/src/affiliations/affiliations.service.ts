import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AhpraError,
  compareLocality,
  compareProfession,
  hasInvitationCapacity,
  invitationCapMessage,
  invitationLimitFor,
  assertRegistrationPermitsPractice,
  assertSightingAttributable,
  registrationWarnings,
  AffiliationError,
  assertDirectoryQueryAllowed,
  assertNoProviderNumber,
  assessDeparture,
  DepartureNoticeError,
  calendarFor,
  assertAffiliationTransition,
  canCaptureUnder,
  captureBlockReason,
  isValidAhpraNumberFormat,
  toDirectoryEntry,
  toRosterEntry,
  ACCEPTANCE_MEANS,
  type AcceptanceMethod,
  AFFILIATION_VELOCITY_THRESHOLD,
  AFFILIATION_VELOCITY_WINDOW_DAYS,
  isAffiliationVelocityAnomalous,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { OutboundService } from '../outbound/outbound.service';
import { EmailComposer } from '../messaging/composer.service';
import { OrganisationsService } from '../organisations/organisations.service';

/**
 * Practitioners and their affiliations (ORG-MODEL-PROPOSAL.md §5, §6).
 *
 * The two rules this module exists to hold:
 *
 *   1. THE PRACTITIONER ACCEPTS. A practice can invite; only the practitioner
 *      can turn an invitation into an active affiliation. Invitations go to a
 *      practitioner-owned email for exactly that reason.
 *
 *   2. NOTICE RUNS BEFORE THE END DATE. During notice the practitioner is
 *      still working and still bulk billing, so capture continues. At the end
 *      date the affiliation ends and enduring agreements CEASE under reg
 *      65CA(8) — they are not "blocked", and the evidence is retained in full.
 */
@Injectable()
export class AffiliationsService {
  private readonly logger = new Logger(AffiliationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly organisations: OrganisationsService,
  
    private readonly outbound: OutboundService,
    private readonly composer: EmailComposer,
  ) {}

  // -------------------------------------------------------------------------
  // Practitioners
  // -------------------------------------------------------------------------

  /**
   * Create a practitioner stub — BY INVITATION FROM A VALIDATED PRACTICE ONLY.
   *
   * There is deliberately no self-registration path (CONVENTIONS.md §8b). To
   * mint a fake practitioner an attacker would first have to obtain a
   * validated practice, which costs a real ACTIVE ABN, a matching registered
   * name, a passed entitlement check and a named human's approval. That turns
   * identity creation from free into expensive.
   *
   * WHAT THE PRACTICE MAY DO IS NARROW, and stays narrow: it supplies the
   * AHPRA number, the name, and the practitioner's OWN email. It does not set
   * a passkey, does not complete the profile, and cannot accept anything on
   * their behalf. A practice that could create AND control an identity in a
   * doctor's name would be the impersonation REQ-PKI-01 exists to prevent.
   */
  async preRegister(
    practiceId: string,
    input: { ahpraNumber: string; familyName: string; givenNames: string; providerType: string; email?: string },
  ) {
    // The invitation is only worth anything if the inviter is real.
    await this.organisations.assertValidated(practiceId);

    const ahpraNumber = input.ahpraNumber.trim().toUpperCase();
    if (!isValidAhpraNumberFormat(ahpraNumber)) {
      throw new BadRequestException(
        `"${input.ahpraNumber}" is not a valid AHPRA registration number. It is three profession letters ` +
          'followed by ten digits, e.g. MED0001234567.',
      );
    }

    const existing = await this.prisma.practitioner.findUnique({ where: { ahpraNumber } });
    if (existing) {
      throw new ConflictException(
        `AHPRA number ${ahpraNumber} is already on this platform. Invite them to your practice instead — a ` +
          'practitioner is one identity across every practice they work at, and a second record would break ' +
          'the deregistration hard-stop and the anomaly detection that depend on that.',
      );
    }

    const practitioner = await this.prisma.practitioner.create({
      data: {
        ahpraNumber,
        familyName: input.familyName.trim(),
        givenNames: input.givenNames.trim(),
        providerType: input.providerType,
        email: input.email,
        invitedByPracticeId: practiceId,
      },
    });

    await this.prisma.withPractice(practiceId, (tx) =>
      enqueueVaultEvent(tx, {
        type: 'nomination.changed',
        actor: { principalType: 'staff', id: practiceId },
        subject: { type: 'Practitioner', id: practitioner.id },
        payload: {
          action: 'practitioner_stub_created_by_invitation',
          // Which practice vouched for this identity existing at all. There is
          // always an answer to "who invited them", by construction.
          invitedByPracticeId: practiceId,
          hasEmail: Boolean(input.email),
        },
      }),
    );

    return toDirectoryEntry(practitioner);
  }

  /**
   * The directory. AHPRA number only, exact match — see directory.ts for why
   * name browse is refused rather than merely unimplemented.
   */
  async findInDirectory(query: string) {
    const ahpraNumber = assertDirectoryQueryAllowed(query);
    const practitioner = await this.prisma.practitioner.findUnique({ where: { ahpraNumber } });
    if (!practitioner) {
      // Deliberately the same shape as a hit-with-no-match: this endpoint must
      // not become an oracle for "which AHPRA numbers are on this platform".
      return { found: false as const, ahpraNumber };
    }
    const entry = toDirectoryEntry(practitioner);
    assertNoProviderNumber(entry, 'directory response');
    return { found: true as const, practitioner: entry };
  }

  /**
   * Record what the AHPRA public register says about this practitioner.
   *
   * Manual by default, because there is no free API: PIE is a paid service
   * ($4,000 to install the API, $1,000/yr support, $1 per practitioner per
   * year) and scraping the register would be routing around the commercial
   * licence the regulator sells for exactly this. So a named human reads the
   * register and types what it says — the same shape as the ABR attestation,
   * and swappable for PIE later without changing anything above this line.
   */
  async recordRegistration(
    practitionerId: string,
    input: {
      registrationStatus: string;
      profession?: string;
      division?: string;
      conditions?: string;
      undertakings?: string;
      reprimands?: string;
      dateOfFirstRegistration?: Date;
      principalSuburb?: string;
      principalState?: string;
      principalPostcode?: string;
      principalCountry?: string;
      source: string;
      sightedByName?: string;
      registrationTypes: Array<{
        registrationType: string;
        specialty?: string;
        expiryDate?: Date;
        conditions?: string;
        endorsements?: string;
        notations?: string;
      }>;
    },
  ) {
    const practitioner = await this.prisma.practitioner.findUnique({ where: { id: practitionerId } });
    if (!practitioner) throw new NotFoundException('Practitioner not found.');

    try {
      assertSightingAttributable(input.source, input.sightedByName);
    } catch (err) {
      if (err instanceof AhpraError) throw new BadRequestException(err.message);
      throw err;
    }

    const record = {
      registrationNumber: practitioner.ahpraNumber,
      familyName: practitioner.familyName,
      givenNames: practitioner.givenNames,
      profession: input.profession ?? '',
      division: input.division,
      registrationStatus: input.registrationStatus,
      conditions: input.conditions,
      undertakings: input.undertakings,
      reprimands: input.reprimands,
      dateOfFirstRegistration: input.dateOfFirstRegistration,
      registrationTypes: input.registrationTypes,
    };

    const sightedAt = new Date();
    const warnings = registrationWarnings(record, { sightedAt });

    // The STATUS decides. Everything else warns — a past expiry in particular
    // must never refuse, because AHPRA says such a practitioner may still be
    // practising while a renewal is finalised.
    let permitted = true;
    let refusal: string | null = null;
    try {
      assertRegistrationPermitsPractice(record);
    } catch (err) {
      if (!(err instanceof AhpraError)) throw err;
      permitted = false;
      refusal = err.message;
    }

    await this.prisma.$transaction([
      this.prisma.practitioner.update({
        where: { id: practitionerId },
        data: {
          registrationStatus: input.registrationStatus,
          profession: input.profession,
          division: input.division,
          conditions: input.conditions,
          undertakings: input.undertakings,
          reprimands: input.reprimands,
          dateOfFirstRegistration: input.dateOfFirstRegistration,
          principalSuburb: input.principalSuburb,
          principalState: input.principalState,
          principalPostcode: input.principalPostcode,
          principalCountry: input.principalCountry,
          registrationSource: input.source,
          registrationSightedByName: input.sightedByName,
          registrationSightedAt: sightedAt,
        },
      }),
      this.prisma.practitionerRegistration.deleteMany({ where: { practitionerId } }),
      this.prisma.practitionerRegistration.createMany({
        data: input.registrationTypes.map((t) => ({
          practitionerId,
          registrationType: t.registrationType,
          specialty: t.specialty,
          expiryDate: t.expiryDate,
          conditions: t.conditions,
          endorsements: t.endorsements,
          notations: t.notations,
        })),
      }),
    ]);

    // A status that forbids practice is REQ-XFER-08 territory: it ends every
    // affiliation immediately, without waiting for anyone to tell us.
    if (!permitted && !practitioner.deregisteredAt) {
      await this.recordDeregistration(practitionerId, `AHPRA status: ${input.registrationStatus}`);
    }

    return {
      practitionerId,
      registrationStatus: input.registrationStatus,
      permitted,
      refusal,
      source: input.source,
      sightedBy: input.sightedByName ?? null,
      sightedAt,
      warnings,
    };
  }

  /** What the register said, for a console to show. */
  async registrationFor(practitionerId: string) {
    const practitioner = await this.prisma.practitioner.findUnique({
      where: { id: practitionerId },
      include: { registrations: true },
    });
    if (!practitioner) throw new NotFoundException('Practitioner not found.');
    if (!practitioner.registrationStatus) {
      return { practitionerId, checked: false as const };
    }
    const record = {
      registrationNumber: practitioner.ahpraNumber,
      familyName: practitioner.familyName,
      givenNames: practitioner.givenNames,
      profession: practitioner.profession ?? '',
      registrationStatus: practitioner.registrationStatus,
      conditions: practitioner.conditions,
      undertakings: practitioner.undertakings,
      reprimands: practitioner.reprimands,
      registrationTypes: practitioner.registrations.map((r) => ({
        registrationType: r.registrationType,
        specialty: r.specialty,
        expiryDate: r.expiryDate,
        conditions: r.conditions,
        endorsements: r.endorsements,
        notations: r.notations,
      })),
    };
    return {
      practitionerId,
      checked: true as const,
      registrationStatus: practitioner.registrationStatus,
      profession: practitioner.profession,
      division: practitioner.division,
      principalSuburb: practitioner.principalSuburb,
      principalState: practitioner.principalState,
      principalPostcode: practitioner.principalPostcode,
      principalCountry: practitioner.principalCountry,
      source: practitioner.registrationSource,
      sightedBy: practitioner.registrationSightedByName,
      sightedAt: practitioner.registrationSightedAt,
      registrations: record.registrationTypes,
      warnings: registrationWarnings(record, { sightedAt: practitioner.registrationSightedAt }),
    };
  }

  /**
   * REQ-XFER-08 — deregistration is an immediate hard stop across EVERY
   * affiliation, with no notice period. "Do not wait for the practice to tell
   * you."
   */
  async recordDeregistration(practitionerId: string, reason: string) {
    const practitioner = await this.prisma.practitioner.findUnique({ where: { id: practitionerId } });
    if (!practitioner) throw new NotFoundException('Practitioner not found.');
    if (practitioner.deregisteredAt) {
      return { id: practitionerId, deregisteredAt: practitioner.deregisteredAt, alreadyRecorded: true };
    }

    const at = new Date();

    // Spans every practice the practitioner works at, so it goes through the
    // SECURITY DEFINER function. Through the ordinary client RLS would filter
    // this to zero rows and deregistration would silently end nothing.
    const affected = await this.prisma.$queryRaw<Array<{ id: string; practiceId: string }>>`
      SELECT id, "practiceId" FROM list_live_affiliations_for_practitioner(${practitionerId}::uuid)`;

    // practitioners is not practice-scoped, so this write needs no scope.
    await this.prisma.practitioner.update({
      where: { id: practitionerId },
      data: { deregisteredAt: at, deregisteredReason: reason },
    });

    // The WRITES are scoped, one practice at a time. The escape hatch was used
    // to learn WHICH tenants to scope to, never to write across them.
    for (const affiliation of affected) {
      await this.prisma.withPractice(affiliation.practiceId, async (tx) => {
        await tx.affiliation.update({
          where: { id: affiliation.id },
          // endsAt = endedAt = now is the tell that no notice period applied.
          data: { status: 'ended', endedAt: at, endsAt: at, endReason: 'deregistered' },
        });
        await enqueueVaultEvent(tx, {
          type: 'affiliation.ended',
          actor: { principalType: 'system', id: 'ahpra_check' },
          subject: { type: 'Affiliation', id: affiliation.id },
          payload: { reason: 'deregistered', noticePeriodApplied: false },
        });
      });
    }

    await enqueueVaultEvent(this.prisma, {
      type: 'practitioner.deregistered',
      actor: { principalType: 'system', id: 'ahpra_check' },
      subject: { type: 'Practitioner', id: practitionerId },
      payload: { affiliationsEnded: affected.length, immediate: true },
    });

    this.logger.warn(
      `REQ-XFER-08: practitioner ${practitionerId} deregistered — ${affected.length} affiliation(s) ended ` +
        'immediately, no notice period. Enduring agreements at those locations have ceased under 65CA(8).',
    );
    return { id: practitionerId, deregisteredAt: at, affiliationsEnded: affected.length };
  }

  // -------------------------------------------------------------------------
  // Affiliations
  // -------------------------------------------------------------------------

  /** The practice invites. It cannot accept on the practitioner's behalf. */
  async invite(
    practiceId: string,
    input: {
      ahpraNumber: string;
      locationId: string;
      departmentId?: string;
      providerNumber?: string;
      invitedByName: string;
      /** The role this practice is asserting, if different from the profile. */
      providerType?: string;
    },
  ) {
    await this.organisations.assertValidated(practiceId);
    const ahpraNumber = assertDirectoryQueryAllowed(input.ahpraNumber);

    const practitioner = await this.prisma.practitioner.findUnique({ where: { ahpraNumber } });
    if (!practitioner) {
      throw new NotFoundException(
        `No practitioner with AHPRA number ${ahpraNumber} is registered here yet. Ask them to pre-register ` +
          'first — a practice cannot create a practitioner identity on their behalf.',
      );
    }
    if (practitioner.deregisteredAt) {
      throw new ForbiddenException(
        'REQ-XFER-08: this practitioner is no longer registered with AHPRA. They cannot be affiliated.',
      );
    }

    const location = await this.prisma.withPractice(practiceId, (tx) =>
      tx.practiceLocation.findFirst({ where: { id: input.locationId } }),
    );
    if (!location) throw new NotFoundException('Location not found in this practice.');
    if (!location.active) {
      throw new BadRequestException(
        'This location is not active: its address has not been validated. An unconfirmed address must not ' +
          'appear in a s 65C(5)(a) particulars block, so it cannot host a practitioner yet.',
      );
    }

    // THE INVITATION CAP. Validation is a point-in-time check on the ENTITY;
    // nothing in it limits what that entity does afterwards, and inviting is
    // how a rogue practice would manufacture identities at scale.
    //
    // Checked BEFORE the practitioner is looked up, so a practice at its
    // ceiling cannot use this endpoint to probe which AHPRA numbers exist here.
    const practice = await this.prisma.withPractice(practiceId, (tx) =>
      tx.practice.findFirstOrThrow({
        where: { id: practiceId },
        select: { statedPractitionerCount: true, contractedInvitationCap: true },
      }),
    );
    // INSIDE withPractice. Counted unscoped this returns ZERO — RLS filters it
    // rather than erroring — and the cap silently never fires. That is the
    // third time this class of bug has appeared here; it is why CONVENTIONS.md
    // §6 says an RLS exception must be justified in writing, and why anything
    // that must see rows had better be scoped or go through a SECURITY DEFINER
    // function on purpose.
    const currentCount = await this.prisma.withPractice(practiceId, (tx) =>
      // Active plus invited. Ordinary churn does not consume the cap.
      tx.affiliation.count({ where: { status: { in: ['invited', 'active', 'ending'] } } }),
    );
    const cap = {
      statedPractitionerCount: practice.statedPractitionerCount,
      contractedCap: practice.contractedInvitationCap,
      currentCount,
    };
    if (!hasInvitationCapacity(cap)) {
      // The message says a limit exists and how to lift it, and deliberately
      // reveals neither its value nor its arithmetic — "four remaining" would
      // hand an attacker their budget.
      this.logger.warn(
        `Practice ${practiceId} hit its invitation cap at ${currentCount} of ${invitationLimitFor(cap)}. ` +
          'Repeated attempts are worth a look (REQ-ANOM-01).',
      );
      throw new ForbiddenException(invitationCapMessage());
    }

    // REQ-ANOM-01 — surfaced, never blocking. There is no cap.
    await this.checkVelocity(practitioner.id);

    // THE PAYOFF FOR STRUCTURED ADDRESSES.
    //
    // AHPRA publishes a practitioner's principal place of practice as suburb +
    // postcode. Comparing it to the location they are being affiliated to is
    // free, and it is the only check we hold that ties a PERSON to a PLACE —
    // which is exactly the entitlement gap (ORG-MODEL-PROPOSAL.md §11).
    //
    // A SIGNAL, NEVER A GATE. Practitioners legitimately work at several
    // locations and the register names only the principal one, so a mismatch
    // is common and innocent. The value is the other direction: a match means
    // an independent regulator has placed this person in this locality.
    const locality =
      practitioner.principalSuburb || practitioner.principalPostcode
        ? compareLocality(
            { suburb: location.suburb ?? '', postcode: location.postcode ?? '' },
            { suburb: practitioner.principalSuburb, postcode: practitioner.principalPostcode },
          )
        : null;
    // Does the register's PROFESSION support the role this practice is
    // asserting? A nurse affiliated as a GP is usually a data-entry slip — and
    // is also the shape of a real registration number being used for a role
    // its holder cannot fill. Free to detect, because the register publishes it.
    const profession = compareProfession(input.providerType ?? practitioner.providerType, practitioner.profession);
    if (profession.result === 'mismatch') {
      this.logger.warn(`Profession signal for practitioner ${practitioner.id}: ${profession.message}`);
    }

    if (locality && locality.result === 'mismatch') {
      this.logger.warn(
        `Locality signal for practitioner ${practitioner.id} at location ${input.locationId}: ${locality.message}`,
      );
    }

    try {
      const affiliation = await this.prisma.withPractice(practiceId, async (tx) => {
        const created = await tx.affiliation.create({
          data: {
            practiceId,
            practitionerId: practitioner.id,
            locationId: input.locationId,
            departmentId: input.departmentId,
            providerNumber: input.providerNumber,
            status: 'invited',
            invitedByName: input.invitedByName,
          },
        });
        await enqueueVaultEvent(tx, {
          type: 'affiliation.invited',
          actor: { principalType: 'staff', id: practiceId },
          subject: { type: 'Affiliation', id: created.id },
          payload: {
            hasProviderNumber: Boolean(input.providerNumber),
            invitedBy: input.invitedByName,
            localitySignal: locality?.result ?? 'not_checked',
            professionSignal: profession.result,
          },
        });
        return created;
      });

      return {
        id: affiliation.id,
        status: affiliation.status,
        practitioner: toDirectoryEntry(practitioner),
        /** Null when the register has not been checked for this practitioner. */
        localitySignal: locality,
        /** `unknown` until the register has been checked — silence is not consent. */
        professionSignal: profession,
        next: practitioner.email
          ? `An invitation goes to the practitioner's own email. Only they can accept it.`
          : 'This practitioner has no email on record, so they must accept in the console. A practice cannot accept for them.',
      };
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          'This practitioner already has an affiliation at this location. A practitioner has ONE provider ' +
            'number per place of practice (FR-1.8), so there is nothing a second row could mean.',
        );
      }
      throw err;
    }
  }

  /** Only the practitioner. `practitionerId` comes from their own session. */
  async respond(affiliationId: string, practitionerId: string, decision: 'accept' | 'reject') {
    // The lookup is keyed on BOTH ids, so it returns nothing unless the
    // affiliation really is this practitioner's — the ownership check is the
    // query, not a comparison after the fact.
    const [affiliation] = await this.prisma.$queryRaw<Array<{ id: string; practiceId: string; status: string }>>`
      SELECT * FROM find_affiliation_for_practitioner(${affiliationId}::uuid, ${practitionerId}::uuid)`;
    if (!affiliation) {
      // Deliberately the SAME answer whether the affiliation does not exist or
      // belongs to someone else. Distinguishing them would turn this endpoint
      // into an oracle for "is this a real affiliation id" — and there is no
      // legitimate caller who needs to know the difference, because a
      // practitioner following their own invitation link always matches.
      throw new NotFoundException(
        'This invitation was not found, or is not yours. Only the practitioner named on an invitation can answer it.',
      );
    }
    try {
      assertAffiliationTransition(affiliation.status as never, decision === 'accept' ? 'active' : 'rejected');
    } catch (err) {
      if (err instanceof AffiliationError) throw new ConflictException(err.message);
      throw err;
    }

    const now = new Date();
    const updated = await this.prisma.withPractice(affiliation.practiceId, async (tx) => {
      const result = await tx.affiliation.update({
        where: { id: affiliationId },
        data:
          decision === 'accept'
            ? { status: 'active', startedAt: now }
            : { status: 'rejected', rejectedAt: now, endReason: 'rejected' },
      });
      await enqueueVaultEvent(tx, {
        type: decision === 'accept' ? 'affiliation.accepted' : 'affiliation.rejected',
        actor: { principalType: 'provider', id: practitionerId },
        subject: { type: 'Affiliation', id: affiliationId },
        payload: { decision },
      });
      return result;
    });

    return { id: updated.id, status: updated.status, startedAt: updated.startedAt };
  }

  /**
   * Offboarding. Either side may give notice; the other is always told.
   * `endsAt` is the commercially agreed date — the platform records it and
   * refuses only the impossible shape, an end date before the notice.
   */
  async giveNotice(
    practiceId: string,
    affiliationId: string,
    input: {
      endsAt: Date;
      givenByName: string;
      reason?: string;
      /**
       * Set when the departure has already happened and notice was given
       * outside AoBPlatform. Stored AS an attestation, never relabelled as
       * our own notice.
       */
      externalNotice?: { means: string; givenAt: Date; note?: string };
    },
  ) {
    const affiliation = await this.prisma.withPractice(practiceId, (tx) =>
      tx.affiliation.findFirst({ where: { id: affiliationId } }),
    );
    if (!affiliation) throw new NotFoundException('Affiliation not found in this practice.');

    const noticeGivenAt = new Date();

    /*
     * THE HOLIDAY CALENDAR IS PER LOCATION, because a Friday notice before
     * a long weekend lands differently in each state (REQ-OFF-03). The
     * location carries the state for exactly this.
     */
    const location = await this.prisma.withPractice(practiceId, (tx) =>
      tx.practiceLocation.findFirst({ where: { id: affiliation.locationId } }),
    );
    const calendar = calendarFor((location?.state ?? 'NSW') as never, input.endsAt);

    let assessment;
    try {
      assessment = assessDeparture({
        now: noticeGivenAt,
        endsAt: input.endsAt,
        calendar,
        external: input.externalNotice,
      });
      assertAffiliationTransition(affiliation.status as never, 'ending');
    } catch (err) {
      if (err instanceof DepartureNoticeError) throw new BadRequestException(err.message);
      if (err instanceof AffiliationError) throw new BadRequestException(err.message);
      throw err;
    }

    const updated = await this.prisma.withPractice(practiceId, async (tx) => {
      const result = await tx.affiliation.update({
        where: { id: affiliationId },
        data: {
          status: 'ending',
          noticeGivenAt,
          noticeGivenBy: input.givenByName,
          endsAt: input.endsAt,
          endReason: input.reason ?? 'practitioner_left_location',
          externalNoticeMeans: input.externalNotice?.means ?? null,
          externalNoticeGivenAt: input.externalNotice?.givenAt ?? null,
          externalNoticeNote: input.externalNotice?.note?.trim() || null,
          externalNoticeAttestedBy: input.externalNotice ? input.givenByName : null,
          noticeLeadBusinessDays: assessment.leadBusinessDays,
          noticeAnomaly: assessment.anomaly ?? null,
        },
      });
      /*
       * TELL THE PRACTITIONER, and do it IN THIS TRANSACTION.
       *
       * Nothing was being sent at all: the practice recorded a departure and
       * the person leaving found out from their employer or not at all. For
       * an affiliation that governs whether consent may be captured in their
       * name, that is not an oversight to fix later.
       *
       * Enqueued rather than sent inline, and enqueued HERE rather than after
       * the commit, so it is impossible to end up with a recorded departure
       * nobody was told about, or a notice sent for a departure that rolled
       * back. See OutboundService — that atomicity is the entire reason the
       * queue lives in Postgres.
       */
      const practitioner = await tx.practitioner.findFirst({ where: { id: affiliation.practitionerId } });
      if (practitioner?.email) {
        /*
         * COMPOSED HERE, not in the worker. This is where we know what the
         * message is about; the worker moves bytes and should never acquire
         * opinions about wording.
         */
        const who = [practitioner.familyName, practitioner.givenNames].filter(Boolean).join(", ");
        const lastDay = input.endsAt.toLocaleDateString("en-AU", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        });
        const practice = await tx.practice.findFirst({ where: { id: practiceId } });
        const practiceName = practice?.tradingNames?.[0] ?? practice?.legalName ?? "the practice";

        const subject = `Your last day at ${practiceName} is recorded as ${lastDay}`;
        const composed = {
          subject,
          ...this.composer.compose(subject, [
            { text: `${who || "Doctor"}, ${practiceName} has recorded that you are leaving this location.` },
            { heading: "What has been recorded" },
            { text: `Your last day at this location: ${lastDay}.` },
            ...(input.reason ? [{ text: `Reason given: ${input.reason}` }] : []),
            { rule: true },
            { heading: "What this means" },
            {
              text:
                "Until that date nothing changes — patients can still sign agreements naming you at this " +
                "location, and those remain valid.",
            },
            {
              text:
                "From that date, enduring agreements at this location cease under reg 65CA(8). They do not " +
                "lapse quietly; they cease, and the evidence is kept in full. Claims for services you " +
                "provided before that date remain valid.",
            },
            { rule: true },
            { heading: "If this is wrong" },
            {
              text:
                `Tell ${practiceName} directly. They recorded this and only they can change or withdraw it. ` +
                "We have sent this so that you know what has been recorded about you, not to ask you to " +
                "approve it.",
            },
            {
              small:
                assessment.basis === "external_attested"
                  ? "The practice has told us that notice was given to you outside AoBPlatform."
                  : "This was recorded in AoBPlatform on the date shown above.",
            },
          ], this.practitionerFooter(practiceName)),
        };

        await this.outbound.enqueue(tx, {
          practiceId,
          channel: 'email',
          destination: practitioner.email,
          subjectType: 'Affiliation',
          subjectId: affiliationId,
          // WHERE and WHO, so this is findable when somebody rings to say it
          // never arrived. Without these the only way to identify it is to
          // open payloads, which the queue deliberately does not allow.
          locationId: affiliation.locationId,
          departmentId: affiliation.departmentId,
          recipientType: 'practitioner',
          recipientId: affiliation.practitionerId,
          recipientName: who || practitioner.email,
          payload: composed as unknown as Record<string, unknown>,
          // A withdraw-and-re-notice is a NEW notice, not a retry of the old
          // one, so it must not collapse onto the same key.
          attemptGroup: noticeGivenAt.toISOString(),
        });
      }
      await enqueueVaultEvent(tx, {
        type: 'affiliation.notice_given',
        actor: { principalType: 'staff', id: practiceId },
        subject: { type: 'Affiliation', id: affiliationId },
        payload: {
          givenBy: input.givenByName,
          // The BASIS, not just the count. A reader must be able to tell
          // notice we delivered from notice a practice says it gave.
          basis: assessment.basis,
          leadBusinessDays: assessment.leadBusinessDays,
          sufficientLead: assessment.sufficientLead,
          agreementsCeasedOn: assessment.agreementsCeasedOn.toISOString(),
          ...(input.externalNotice ? { externalNoticeMeans: input.externalNotice.means } : {}),
          ...(assessment.anomaly ? { anomaly: assessment.anomaly } : {}),
        },
      });
      return result;
    });

    return {
      id: updated.id,
      status: updated.status,
      noticeGivenAt: updated.noticeGivenAt,
      endsAt: updated.endsAt,
      basis: assessment.basis,
      leadBusinessDays: assessment.leadBusinessDays,
      sufficientLead: assessment.sufficientLead,
      anomaly: assessment.anomaly ?? null,
      /** The load-bearing sentence: nothing stops until the end date. */
      effectNow:
        'The affiliation is STILL ACTIVE. Capture proceeds and claims are valid until the end date — notice ' +
        'runs before the end, not after it.',
      effectAtEnd:
        'At the end date the affiliation ends, enduring agreements at this location cease under reg 65CA(8), ' +
        'and new capture stops. Claims for services rendered before that date remain valid, and the evidence ' +
        'is retained in full for the 2-year period.',
    };
  }

  /** Withdrawing notice — the practitioner stayed. */
  async withdrawNotice(practiceId: string, affiliationId: string) {
    const affiliation = await this.prisma.withPractice(practiceId, (tx) =>
      tx.affiliation.findFirst({ where: { id: affiliationId } }),
    );
    if (!affiliation) throw new NotFoundException('Affiliation not found in this practice.');
    if (affiliation.status !== 'ending') {
      throw new ConflictException(`This affiliation is ${affiliation.status}; there is no notice to withdraw.`);
    }
    return this.prisma.withPractice(practiceId, async (tx) => {
      const updated = await tx.affiliation.update({
        where: { id: affiliationId },
        data: {
          status: 'active',
          noticeGivenAt: null,
          noticeGivenBy: null,
          endsAt: null,
          endReason: null,
          /*
           * THE ATTESTATION GOES TOO. It said notice was given outside
           * AoBPlatform — for a notice that no longer exists. Leaving it
           * behind would be a standing claim about a departure that was
           * called off, and the next reader would have no way to tell it
           * was stale.
           */
          externalNoticeMeans: null,
          externalNoticeGivenAt: null,
          externalNoticeNote: null,
          externalNoticeAttestedBy: null,
          noticeLeadBusinessDays: null,
          noticeAnomaly: null,
        },
      });

      /*
       * RECORDED, which it was not before.
       *
       * Withdrawing a notice is a real act with a real effect — capture
       * continues, agreements do not cease — and it left no trace at all.
       * A notice given and then withdrawn is NOT the same history as one
       * never given: somebody was told they were leaving.
       */
      await enqueueVaultEvent(tx, {
        type: 'affiliation.notice_withdrawn',
        actor: { principalType: 'staff', id: practiceId },
        subject: { type: 'Affiliation', id: affiliationId },
        payload: {
          // Omitted rather than null — the vault payload takes primitives, and
          // an absent key reads the same as "there was none".
          ...(affiliation.noticeGivenAt
            ? { withdrewNoticeGivenAt: affiliation.noticeGivenAt.toISOString() }
            : {}),
          ...(affiliation.endsAt ? { withdrewEndsAt: affiliation.endsAt.toISOString() } : {}),
        },
      });

      /*
       * TELL THEM IT IS OFF. We emailed this person to say they were
       * leaving on a date. If that is reversed and we say nothing, the last
       * thing they heard from us is wrong — and they may act on it.
       */
      const practitioner = await tx.practitioner.findFirst({ where: { id: affiliation.practitionerId } });
      if (practitioner?.email) {
        const who = [practitioner.familyName, practitioner.givenNames].filter(Boolean).join(", ");
        const practice = await tx.practice.findFirst({ where: { id: practiceId } });
        const practiceName = practice?.tradingNames?.[0] ?? practice?.legalName ?? "the practice";
        const wasEnding = affiliation.endsAt
          ? affiliation.endsAt.toLocaleDateString("en-AU", {
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            })
          : null;

        const subject = `You are staying at ${practiceName} — the leaving date has been withdrawn`;
        const composed = {
          subject,
          ...this.composer.compose(
            subject,
            [
              {
                text:
                  `${who || "Doctor"}, ${practiceName} has withdrawn the leaving date they recorded for ` +
                  "you at this location.",
              },
              { heading: "What has changed" },
              {
                text: wasEnding
                  ? `We previously told you your last day here was ${wasEnding}. That no longer applies.`
                  : "We previously told you a leaving date had been recorded. That no longer applies.",
              },
              { text: "Your affiliation with this location is active again, with no end date." },
              { rule: true },
              { heading: "What this means" },
              {
                text:
                  "Nothing ceases. Patients can sign agreements naming you at this location, and existing " +
                  "enduring agreements continue exactly as before — they were never interrupted.",
              },
              { rule: true },
              { heading: "If this is wrong" },
              {
                text:
                  `Tell ${practiceName} directly. They recorded this and only they can change it. We have ` +
                  "sent this so that you know what has been recorded about you, not to ask you to approve it.",
              },
            ],
            this.practitionerFooter(practiceName),
          ),
        };

        await this.outbound.enqueue(tx, {
          practiceId,
          channel: 'email',
          destination: practitioner.email,
          subjectType: 'Affiliation',
          subjectId: affiliationId,
          // WHERE and WHO, so this is findable when somebody rings to say it
          // never arrived. Without these the only way to identify it is to
          // open payloads, which the queue deliberately does not allow.
          locationId: affiliation.locationId,
          departmentId: affiliation.departmentId,
          recipientType: 'practitioner',
          recipientId: affiliation.practitionerId,
          recipientName: who || practitioner.email,
          payload: composed as unknown as Record<string, unknown>,
          // Each withdrawal is its own message, not a retry of the notice.
          attemptGroup: `withdrawn:${new Date().toISOString()}`,
        });
      }

      return updated;
    });
  }

  /**
   * The footer for somebody who never applied to us.
   *
   * A practitioner was added by a practice; they did not fill in a form
   * here. Telling them "this address was given on an application" is false,
   * and false in the one paragraph whose entire job is to make the message
   * credible. A reader who catches us being wrong about why they got it has
   * every reason to treat the rest as a scam — which for a message about
   * consent records is exactly the wrong instinct to teach.
   */
  private practitionerFooter(practiceName: string) {
    return this.composer.footerFor(
      `You received this because ${practiceName} listed this address for you on AoBPlatform, where they ` +
        `record patient consent naming you as the practitioner.`,
    );
  }

  /**
   * The sweep that actually ends affiliations whose date has arrived. Runs on
   * a schedule; also callable so a test can prove the transition rather than
   * waiting for a cron.
   */
  async endDueAffiliations(now: Date = new Date()) {
    // Spans every practice — a system job by nature. Through the ordinary
    // client RLS would return zero and the sweep would report success while
    // never ending anything, letting the platform keep accepting consent
    // under affiliations that had already expired.
    const due = await this.prisma.$queryRaw<Array<{ id: string; practiceId: string }>>`
      SELECT id, "practiceId" FROM list_due_affiliations(${now})`;

    for (const affiliation of due) {
      await this.prisma.withPractice(affiliation.practiceId, async (tx) => {
        await tx.affiliation.update({
          where: { id: affiliation.id },
          data: { status: 'ended', endedAt: now },
        });
        // 65CA(8): enduring agreements at this location cease. Not deleted,
        // not blocked — ceased, with the reason recorded.
        //
        // Two steps because EnduringDetail carries agreementId as a plain
        // column rather than a Prisma relation, so it cannot be filtered on
        // the agreement's anchor directly.
        const anchored = await tx.agreement.findMany({
          where: { affiliationId: affiliation.id, type: 'enduring' },
          select: { id: true },
        });
        if (anchored.length > 0) {
          await tx.enduringDetail.updateMany({
            where: { agreementId: { in: anchored.map((a) => a.id) }, ceasedAt: null },
            data: { ceasedAt: now, cessationReason: 'practitioner_left_location' },
          });
        }
        await enqueueVaultEvent(tx, {
          type: 'affiliation.ended',
          actor: { principalType: 'system', id: 'affiliation_sweep' },
          subject: { type: 'Affiliation', id: affiliation.id },
          payload: { reason: 'practitioner_left_location', noticePeriodApplied: true },
        });
      });
    }
    return { ended: due.length };
  }

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  /**
   * THE PRACTICE'S OWN ROSTER — every practitioner it has a relationship with.
   *
   * WHY THIS ENDPOINT HAD TO EXIST. Until it did, practitioners were only ever
   * derived from affiliations, so a practitioner who had been pre-registered
   * and not yet invited anywhere was invisible on every screen. The workflow is
   * pre-register, THEN invite; a first step whose result cannot be seen is a
   * first step people redo, and redoing it collides with the unique AHPRA
   * number and looks like a broken platform.
   *
   * THE PRACTITIONER TABLE IS NOT RLS-SCOPED, deliberately (see schema.prisma):
   * a doctor at three practices is one person. So the boundary here is the
   * WHERE clause, and it is narrow on purpose. A row qualifies only if:
   *
   *   - this practice created it (`invitedByPracticeId`), or
   *   - its id came out of this practice's own affiliation rows, which WERE
   *     read under RLS and therefore cannot name anybody else's practitioners.
   *
   * There is no third branch, and adding one would need the same argument in
   * writing (CONVENTIONS.md 6). What comes back is `toRosterEntry`, which is
   * built field-by-field and carries no provider number.
   */
  async listRoster(practiceId: string) {
    const affiliations = await this.prisma.withPractice(practiceId, (tx) =>
      tx.affiliation.findMany({
        select: { practitionerId: true, status: true, locationId: true },
      }),
    );
    const affiliatedIds = [...new Set(affiliations.map((a) => a.practitionerId))];

    const practitioners = await this.prisma.practitioner.findMany({
      where: {
        OR: [{ invitedByPracticeId: practiceId }, { id: { in: affiliatedIds } }],
      },
      orderBy: [{ familyName: 'asc' }, { givenNames: 'asc' }],
    });

    const roster = practitioners.map((p) => {
      const theirs = affiliations.filter((a) => a.practitionerId === p.id);
      return {
        ...toRosterEntry(p, practiceId),
        /**
         * Counts, not rows. The affiliations themselves have their own screen;
         * what this page needs is whether this person is anywhere yet, because
         * "pre-registered and never invited" is the state that gets lost.
         */
        affiliationCount: theirs.length,
        activeAffiliationCount: theirs.filter((a) => a.status === 'active' || a.status === 'ending').length,
        invitedAffiliationCount: theirs.filter((a) => a.status === 'invited').length,
      };
    });

    // Cheap, and it turns a future copy-paste mistake into a failure here
    // rather than a disclosure at the boundary.
    assertNoProviderNumber(roster, 'practice roster');
    return roster;
  }

  /** What a practice sees: its own affiliations, provider numbers included. */
  async listForPractice(practiceId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const affiliations = await tx.affiliation.findMany({
        include: { practitioner: true, location: true, department: true },
        orderBy: { invitedAt: 'desc' },
      });
      const now = new Date();
      return affiliations.map((a) => ({
        id: a.id,
        status: a.status,
        practitioner: toDirectoryEntry(a.practitioner),
        location: { id: a.locationId, address: a.location.addressCanonical ?? a.location.address, code: a.location.code },
        department: a.department?.name ?? null,
        // The practice's OWN provider number for its OWN practitioner. This is
        // the only place it is ever returned.
        providerNumber: a.providerNumber,
        startedAt: a.startedAt,
        noticeGivenAt: a.noticeGivenAt,
        endsAt: a.endsAt,

        /*
         * WHERE THE INVITATION ITSELF HAS GOT TO.
         *
         * Without this the console can say "invited" and nothing more, and
         * "invited" covers two states a practice must not confuse: one where
         * we have emailed the practitioner and are waiting on them, and one
         * where nobody has told them anything at all. The second looks
         * identical and is entirely the practice's move.
         *
         * The token and the code are NOT here and never will be. They are
         * addressed to the practitioner; a practice that could read them could
         * accept on their behalf, which is the one thing this whole flow
         * exists to prevent.
         */
        invitationSentAt: a.inviteSentAt,
        invitationExpiresAt: a.inviteExpiresAt,
        /** email_link_and_code | passkey | console. Null until answered. */
        acceptanceMethod: a.acceptanceMethod,
        acceptanceMeans: a.acceptanceMethod
          ? (ACCEPTANCE_MEANS[a.acceptanceMethod as AcceptanceMethod] ?? null)
          : null,
        canCapture: canCaptureUnder({ ...a, status: a.status as never }, now),
        blockReason: captureBlockReason({ ...a, status: a.status as never }, now),
      }));
    });
  }

  /**
   * What a PRACTITIONER sees: their own affiliations across every practice.
   *
   * Goes through the SECURITY DEFINER function because this is a legitimate
   * cross-tenant read that RLS cannot express — and that function's projection
   * carries no provider number, so this view cannot harvest them either.
   */
  async listForPractitioner(practitionerId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<Record<string, unknown>>
    >`SELECT * FROM list_practitioner_affiliations(${practitionerId}::uuid)`;
    assertNoProviderNumber(rows, 'practitioner self-view');
    return rows;
  }

  /** REQ-ANOM-01 — a signal for a human, never an automatic refusal. */
  private async checkVelocity(practitionerId: string): Promise<void> {
    const since = new Date(Date.now() - AFFILIATION_VELOCITY_WINDOW_DAYS * 86_400_000);
    // Counts across practices, so again the function — and it returns counts
    // only, never naming a practice.
    const [counts] = await this.prisma.$queryRaw<Array<{ activeCount: bigint; addedInWindow: bigint }>>`
      SELECT * FROM count_practitioner_affiliations(${practitionerId}::uuid, ${since})`;
    const activeCount = Number(counts?.activeCount ?? 0);
    const addedInLastDays = Number(counts?.addedInWindow ?? 0);
    if (isAffiliationVelocityAnomalous({ activeCount, addedInLastDays, windowDays: AFFILIATION_VELOCITY_WINDOW_DAYS })) {
      this.logger.warn(
        `REQ-ANOM-01: practitioner ${practitionerId} has been added to ${addedInLastDays} practices in ` +
          `${AFFILIATION_VELOCITY_WINDOW_DAYS} days (threshold ${AFFILIATION_VELOCITY_THRESHOLD}), and now holds ` +
          `${activeCount}. Not blocked — working across many practices is ordinary — but worth a look.`,
      );
    }
  }
}
