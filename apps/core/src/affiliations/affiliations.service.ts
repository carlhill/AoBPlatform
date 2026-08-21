import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AffiliationError,
  assertDirectoryQueryAllowed,
  assertNoProviderNumber,
  assertNoticeValid,
  assertAffiliationTransition,
  canCaptureUnder,
  captureBlockReason,
  isValidAhpraNumberFormat,
  toDirectoryEntry,
  AFFILIATION_VELOCITY_THRESHOLD,
  AFFILIATION_VELOCITY_WINDOW_DAYS,
  isAffiliationVelocityAnomalous,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
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
  ) {}

  // -------------------------------------------------------------------------
  // Practitioners
  // -------------------------------------------------------------------------

  /**
   * Path A — the practitioner pre-registers themselves. No passkey and no
   * affiliation yet: this only establishes that the person exists here, so a
   * practice can find them by AHPRA number.
   */
  async preRegister(input: { ahpraNumber: string; familyName: string; givenNames: string; providerType: string; email?: string }) {
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
        `AHPRA number ${ahpraNumber} is already registered on this platform. If this is you and you have ` +
          'lost access, that is an account recovery — it is not a second registration.',
      );
    }

    const practitioner = await this.prisma.practitioner.create({
      data: {
        ahpraNumber,
        familyName: input.familyName.trim(),
        givenNames: input.givenNames.trim(),
        providerType: input.providerType,
        email: input.email,
      },
    });
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
    input: { ahpraNumber: string; locationId: string; departmentId?: string; providerNumber?: string; invitedByName: string },
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

    // REQ-ANOM-01 — surfaced, never blocking. There is no cap.
    await this.checkVelocity(practitioner.id);

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
          payload: { hasProviderNumber: Boolean(input.providerNumber), invitedBy: input.invitedByName },
        });
        return created;
      });

      return {
        id: affiliation.id,
        status: affiliation.status,
        practitioner: toDirectoryEntry(practitioner),
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
  async giveNotice(practiceId: string, affiliationId: string, input: { endsAt: Date; givenByName: string; reason?: string }) {
    const affiliation = await this.prisma.withPractice(practiceId, (tx) =>
      tx.affiliation.findFirst({ where: { id: affiliationId } }),
    );
    if (!affiliation) throw new NotFoundException('Affiliation not found in this practice.');

    const noticeGivenAt = new Date();
    try {
      assertNoticeValid({ noticeGivenAt, endsAt: input.endsAt });
      assertAffiliationTransition(affiliation.status as never, 'ending');
    } catch (err) {
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
        },
      });
      await enqueueVaultEvent(tx, {
        type: 'affiliation.notice_given',
        actor: { principalType: 'staff', id: practiceId },
        subject: { type: 'Affiliation', id: affiliationId },
        payload: {
          givenBy: input.givenByName,
          noticeDays: Math.round((input.endsAt.getTime() - noticeGivenAt.getTime()) / 86_400_000),
        },
      });
      return result;
    });

    return {
      id: updated.id,
      status: updated.status,
      noticeGivenAt: updated.noticeGivenAt,
      endsAt: updated.endsAt,
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
    return this.prisma.withPractice(practiceId, (tx) =>
      tx.affiliation.update({
        where: { id: affiliationId },
        data: { status: 'active', noticeGivenAt: null, noticeGivenBy: null, endsAt: null, endReason: null },
      }),
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
