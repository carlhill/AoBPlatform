import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { assertValidIdentifierSet, IdentifierSetError } from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
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
  async updateConfig(practiceId: string, dto: UpdateConfigDto) {
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
      return tx.practice.update({
        where: { id: practiceId },
        data: {
          identifierTypes: dto.identifierTypes,
          linkExpiryHours: dto.linkExpiryHours,
          writeBackProven: dto.writeBackProven,
          senderIdRegistered: dto.senderIdRegistered,
        },
      });
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
