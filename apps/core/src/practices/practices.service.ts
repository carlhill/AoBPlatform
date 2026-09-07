import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  assertValidIdentifierSet,
  BILLING_ROLES_VERSION,
  DEFAULT_BILLING_ROLE,
  IdentifierSetError,
  isBillingRole,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../auth/actor.decorator';
import type {
  CreateAssignorDto,
  CreatePracticeDto,
  CreateProviderDto,
  CreateStaffDto,
  UpdateConfigDto,
} from './practices.dto';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;

function collapse(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

@Injectable()
export class PracticesService {
  constructor(private readonly prisma: PrismaService) {}

  /** FR-1.1 — practice record with locations. */
  async create(dto: CreatePracticeDto) {
    const practiceId = randomUUID();
    return this.prisma.withPractice(practiceId, async (tx) => {
      const practice = await tx.practice.create({
        data: {
          id: practiceId,
          name: dto.name,
          abn: dto.abn,
          pms: dto.pms,
          state: dto.state ?? 'NSW',
          rails: dto.rails ?? [],
          locations: { create: dto.locations.map((l) => ({ address: l.address })) },
        },
        include: { locations: true },
      });
      return practice;
    });
  }

  async get(practiceId: string) {
    const practice = await this.prisma.withPractice(practiceId, (tx) =>
      tx.practice.findFirst({ include: { locations: true } }),
    );
    if (!practice) throw new NotFoundException('Practice not found.');
    return practice;
  }

  /** FR-1.4 — configuration. Identifier floor + Medicare exclusion enforced by the domain guard. */
  async updateConfig(practiceId: string, dto: UpdateConfigDto, actor?: Actor) {
    if (dto.identifierTypes) {
      try {
        assertValidIdentifierSet(dto.identifierTypes);
      } catch (err) {
        if (err instanceof IdentifierSetError) throw new BadRequestException(err.message);
        throw err;
      }
    }
    return this.prisma.withPractice(practiceId, async (tx) => {
      const practice = await tx.practice.findFirst({});
      if (!practice) throw new NotFoundException('Practice not found.');
      const updated = await tx.practice.update({
        where: { id: practiceId },
        data: {
          identifierTypes: dto.identifierTypes,
          linkExpiryHours: dto.linkExpiryHours,
          kioskIdleTimeoutSeconds: dto.kioskIdleTimeoutSeconds,
          enduringByDefault: dto.enduringByDefault,
          writeBackProven: dto.writeBackProven,
          senderIdRegistered: dto.senderIdRegistered,
        },
      });

      /*
       * THE INACTIVITY RESET IS EVIDENCED WHEN IT MOVES (Carl, 4 Sep 2026).
       *
       * It is a screen-hygiene control, not a comfort setting: it decides how
       * long a walked-away patient's name, date of birth and address stay on a
       * tablet sitting on a counter. Lengthening it is a decision somebody
       * should have to own, so it is written through the OUTBOX in the same
       * transaction as the row it evidences — one without the other is
       * structurally impossible (hard rule 11, FR-11.2).
       *
       * ONLY WHEN IT ACTUALLY CHANGES. This endpoint is a whole-form save and
       * the console posts every field on every press; an event per save would
       * make the trail say "somebody changed the timeout" on the morning
       * somebody ticked the sender-ID box.
       *
       * THE VALUE GOES IN THE PAYLOAD because a number of seconds is not PII
       * and "it was changed" without "to what" is not evidence of anything
       * (REQ-LOG-08 forbids identifier VALUES, not settings).
       */
      if (
        dto.kioskIdleTimeoutSeconds !== undefined &&
        dto.kioskIdleTimeoutSeconds !== practice.kioskIdleTimeoutSeconds
      ) {
        await enqueueVaultEvent(tx, {
          type: 'practice.kiosk_idle_timeout_set',
          // Attributed to the signed-in staff member where there is one. This
          // endpoint predates `SessionActor` and is still reachable without a
          // token while `AUTH_ENFORCE` is false, so it falls back to the
          // system actor rather than refusing a save that has always worked.
          actor: actor ? { principalType: actor.principalType, id: actor.id } : SYSTEM_ACTOR,
          subject: { type: 'Practice', id: practiceId },
          payload: {
            kioskIdleTimeoutSeconds: dto.kioskIdleTimeoutSeconds,
            previousSeconds: practice.kioskIdleTimeoutSeconds,
            ...(actor ? { setBy: actor.name } : {}),
          },
        });
      }

      /*
       * WHICH AGREEMENT THE PRE-STEP OFFERS IS EVIDENCED WHEN IT MOVES (Carl,
       * 4 Sep 2026; GA-PLAN B6) — the same treatment, and the same reasoning,
       * as the idle timeout above.
       *
       * It is a practice-wide choice with a per-patient consequence: with it
       * on, the first thing a GP practice offers at the desk is a STANDING
       * commitment to bulk bill this patient for this provider's in-scope
       * services until somebody ends it (REQ-END-06a). Turning it off changes
       * what every patient after that is asked. So who changed it, and to
       * what, is evidence rather than a preference — written through the
       * outbox in the same transaction as the row it evidences (hard rule 11).
       *
       * ONLY WHEN IT ACTUALLY CHANGES, because this endpoint is a whole-form
       * save and the console posts every field on every press.
       *
       * A BOOLEAN IS NOT PII (REQ-LOG-08), so the value travels in the
       * payload; "somebody changed a setting" without saying which way is not
       * evidence of anything.
       */
      if (
        dto.enduringByDefault !== undefined &&
        dto.enduringByDefault !== practice.enduringByDefault
      ) {
        await enqueueVaultEvent(tx, {
          type: 'practice.enduring_by_default_set',
          actor: actor ? { principalType: actor.principalType, id: actor.id } : SYSTEM_ACTOR,
          subject: { type: 'Practice', id: practiceId },
          payload: {
            enduringByDefault: dto.enduringByDefault,
            previous: practice.enduringByDefault,
            ...(actor ? { setBy: actor.name } : {}),
          },
        });
      }

      return updated;
    });
  }

  /** FR-1.5 — staff list; feeds the REQ-VUL-04 assignor hard block. */
  addStaff(practiceId: string, dto: CreateStaffDto) {
    return this.prisma.withPractice(practiceId, (tx) =>
      tx.staffMember.create({
        data: {
          practiceId,
          name: dto.name,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
          role: dto.role,
        },
      }),
    );
  }

  /**
   * FR-1.8 — THE PRACTITIONER AND THEIR AFFILIATION AT A LOCATION (Carl,
   * 7 Sep 2026). Provider number optional by design (REQ-REG-02), and per
   * location because that is how it is issued.
   *
   * WHAT THIS NO LONGER WRITES: a `providers` row. That table is
   * practice-scoped with no location and no link to a person, and it stopped
   * being the agreement anchor today — so writing one here would be adding to
   * the thing being retired. The returned `affiliationId` is what an agreement
   * is anchored on, and `id` mirrors it so a caller that only reads `id` gets
   * the anchor rather than a row nothing points at.
   *
   * THE PERSON IS SHARED, THE AFFILIATION IS NOT. A practitioner already known
   * to the platform (they work at another practice, or they were here before)
   * is REUSED on their AHPRA number rather than duplicated — the identity is
   * person-level and outlives any one practice.
   *
   * `status: 'active'` AND `startedAt`, because this is the practice recording
   * somebody who already works there, not inviting somebody who might. The
   * invitation path (`AffiliationsService.invite`) is the one that leaves a
   * practitioner to accept for themselves, and it is still the only way an
   * affiliation gets there from `invited`.
   */
  async addProvider(practiceId: string, dto: CreateProviderDto) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const locations = await tx.practiceLocation.findMany({ select: { id: true }, orderBy: { createdAt: 'asc' } });
      if (locations.length === 0) {
        throw new BadRequestException(
          'This practice has no location yet. A provider number is issued per practitioner per location and ' +
            's 65C(5)(a) identifies the professional by the address of their place of practice, so there is ' +
            'nowhere to put either. Add a location first.',
        );
      }
      const locationId = dto.locationId ?? (locations.length === 1 ? locations[0]!.id : null);
      if (!locationId) {
        throw new BadRequestException(
          'This practice has more than one location, so name the one this practitioner works at ' +
            '(locationId). Their provider number and the address on every agreement they sign come from it — ' +
            'it is not something to guess.',
        );
      }
      if (!locations.some((l) => l.id === locationId)) {
        throw new NotFoundException('That location was not found in this practice.');
      }
      if (dto.billingRole && !isBillingRole(dto.billingRole)) {
        throw new BadRequestException(
          `"${dto.billingRole}" is not a billing role. The list is versioned content ` +
            `(packages/domain/content/billing-roles.json, ${BILLING_ROLES_VERSION}).`,
        );
      }

      // One name, split the way the register holds it: everything before the
      // last space is given names. Crude, and it is the practice's own typing
      // being tidied rather than a fact being invented — the register lookup
      // (`AffiliationsService.preRegister`) is what replaces it.
      const trimmed = dto.name.trim().replace(/\s+/g, ' ');
      const cut = trimmed.lastIndexOf(' ');
      const givenNames = cut > 0 ? trimmed.slice(0, cut) : trimmed;
      const familyName = cut > 0 ? trimmed.slice(cut + 1) : trimmed;

      const practitioner =
        (await tx.practitioner.findFirst({ where: { ahpraNumber: dto.ahpraNumber } })) ??
        (await tx.practitioner.create({
          data: {
            ahpraNumber: dto.ahpraNumber,
            givenNames,
            familyName,
            providerType: dto.providerType,
            invitedByPracticeId: practiceId,
          },
        }));

      const existing = await tx.affiliation.findFirst({
        where: { practitionerId: practitioner.id, locationId },
      });
      if (existing) {
        throw new BadRequestException(
          'That practitioner already has an affiliation at that location. Change it on the affiliation ' +
            'screen rather than adding a second one — the pair is unique for a reason.',
        );
      }

      const affiliation = await tx.affiliation.create({
        data: {
          practiceId,
          practitionerId: practitioner.id,
          locationId,
          providerNumber: dto.providerNumber ?? null,
          billingRole: dto.billingRole ?? DEFAULT_BILLING_ROLE,
          status: 'active',
          startedAt: new Date(),
          acceptanceMethod: 'console',
        },
      });

      return {
        id: affiliation.id,
        affiliationId: affiliation.id,
        practitionerId: practitioner.id,
        locationId,
        name: `${practitioner.givenNames} ${practitioner.familyName}`.trim(),
        providerType: practitioner.providerType,
        providerNumber: affiliation.providerNumber,
        billingRole: affiliation.billingRole,
      };
    });
  }

  /**
   * Assignor creation with the REQ-VUL-04 hard block: practice staff cannot
   * be assignors. Matched against the active staff list by normalised name
   * (plus date of birth where both are held). There is no override — the
   * block is the Departmental position, not a preference.
   */
  async addAssignor(practiceId: string, dto: CreateAssignorDto) {
    // "Other" WITHOUT ITS NOTE IS NOT A BASIS, it is a shrug — the note IS the
    // basis on that branch (REQ-VUL-01). The database refuses it too
    // (assignors_other_basis_has_note); this is the sentence a person can act
    // on, said before the constraint has to say it.
    if (dto.authorityBasis === 'other_with_note' && !dto.authorityNote?.trim()) {
      throw new BadRequestException(
        'REQ-VUL-01: an "other" authority basis carries a note saying what it is. A friend signing is ' +
          'a legitimate answer; write "friend".',
      );
    }
    return this.prisma.withPractice(practiceId, async (tx) => {
      const staff = await tx.staffMember.findMany({ where: { active: true } });
      const candidateName = collapse(dto.name);
      const candidateDob = dto.dateOfBirth ? dto.dateOfBirth.slice(0, 10) : null;
      const blocked = staff.some((s) => {
        if (collapse(s.name) !== candidateName) return false;
        if (s.dateOfBirth && candidateDob) {
          return s.dateOfBirth.toISOString().slice(0, 10) === candidateDob;
        }
        return true; // name match with no DOB to disambiguate — fail closed
      });
      if (blocked) {
        throw new BadRequestException(
          'REQ-VUL-04: practice staff cannot act as assignors (Departmental FAQ). This is not configurable.',
        );
      }
      const assignor = await tx.assignor.create({
        data: {
          practiceId,
          name: dto.name,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
          relationshipToPatient: dto.relationshipToPatient,
          authorityBasis: dto.authorityBasis,
          authorityNote: dto.authorityNote,
        },
      });
      await enqueueVaultEvent(tx, {
        type: 'nomination.changed',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Assignor', id: assignor.id },
        payload: { action: 'created', authorityBasis: dto.authorityBasis },
      });
      return assignor;
    });
  }

  /** FR-1.7 — the go-live checklist, computed honestly from state. */
  async goLiveChecklist(practiceId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const practice = await tx.practice.findFirst({});
      if (!practice) throw new NotFoundException('Practice not found.');
      /*
       * "SOMEBODY CAN BE THE PROVIDER ON AN AGREEMENT HERE" — counted on
       * affiliations now, not on the retired `providers` table (Carl, 7 Sep
       * 2026). A practice whose only `providers` rows match no practitioner
       * could not anchor a single agreement, and the old count said it was
       * ready to go live.
       */
      const providerCount = await tx.affiliation.count({
        where: { status: { in: ['active', 'ending'] }, billingRole: 'servicing_provider' },
      });
      const items = [
        { item: 'write_back_proven', done: practice.writeBackProven, blocking: true, note: 'D-01 spike (FR-1.3)' },
        { item: 'sender_id_registered', done: practice.senderIdRegistered, blocking: true, note: 'ACMA Sender ID (FR-1.4)' },
        { item: 'provider_onboarded', done: providerCount > 0, blocking: true, note: 'FR-1.7' },
        {
          item: 'conformance_statement_available',
          done: false,
          blocking: true,
          note: 'Requires the human-authored s 65C rule set (REQ-65C-03)',
        },
      ];
      return { practiceId, readyForGoLive: items.every((i) => !i.blocking || i.done), items };
    });
  }
}
