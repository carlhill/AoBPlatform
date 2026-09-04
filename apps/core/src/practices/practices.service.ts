import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { assertValidIdentifierSet, IdentifierSetError } from '@aobplatform/domain';
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

  /** FR-1.8 — provider record; provider number optional by design (REQ-REG-02). */
  addProvider(practiceId: string, dto: CreateProviderDto) {
    return this.prisma.withPractice(practiceId, (tx) =>
      tx.provider.create({
        data: {
          practiceId,
          name: dto.name,
          providerType: dto.providerType,
          placeOfPracticeAddress: dto.placeOfPracticeAddress,
          providerNumber: dto.providerNumber,
          ahpraNumber: dto.ahpraNumber,
        },
      }),
    );
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
      const providerCount = await tx.provider.count({ where: { active: true } });
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
