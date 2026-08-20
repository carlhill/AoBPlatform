import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Agreement as DbAgreement, Prisma } from '@prisma/client';
import type { RulesEngineClient } from '@aobplatform/contracts';
import {
  assertNoForbiddenAgreementFields,
  assertSignatureAllowed,
  canTransition,
  HardRuleViolation,
  validAnchorKindFor,
  type AgreementStatus,
  type EnduringPathway,
  type ProviderType,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { RULES_CLIENT } from '../rules-client/rules-client.module';
import { assertEnduringAllowed } from '@aobplatform/domain';
import type { CreateAgreementDto, LockParticularsDto } from './agreements.dto';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;

@Injectable()
export class AgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RULES_CLIENT) private readonly rules: RulesEngineClient,
  ) {}

  /**
   * Creates a draft agreement. Domain guards enforced up front: anchor kind
   * per type/pathway (organisation only on ACCHO/AMS), enduring GP-only
   * (REQ-END-01a), D7 explicit. Every write pairs with a vault outbox row in
   * the SAME transaction (FR-11.2).
   */
  async createDraft(practiceId: string, dto: CreateAgreementDto): Promise<DbAgreement> {
    const expectedAnchor = validAnchorKindFor(dto.type, dto.enduringPathway as EnduringPathway | undefined);
    if (dto.type === 'enduring' && !dto.enduringPathway) {
      throw new BadRequestException('An enduring agreement requires a pathway (reg 65CA/65CB).');
    }
    if (expectedAnchor === 'provider' && !dto.providerId) {
      throw new BadRequestException(`A ${dto.type} agreement anchors to a provider — providerId is required.`);
    }
    if (expectedAnchor === 'organisation' && !dto.organisationId) {
      throw new BadRequestException('An ACCHO/AMS enduring agreement anchors to the organisation (Addendum v3 §1.1).');
    }

    try {
      return await this.prisma.withPractice(practiceId, async (tx) => {
        if (expectedAnchor === 'provider') {
          const provider = await tx.provider.findFirst({ where: { id: dto.providerId } });
          if (!provider) throw new NotFoundException('Provider not found in this practice.');
          if (dto.type === 'enduring') {
            assertEnduringAllowed(provider.providerType as ProviderType, dto.enduringPathway as EnduringPathway);
          }
        }
        const patient = await tx.patient.findFirst({ where: { id: dto.patientId } });
        if (!patient) throw new NotFoundException('Patient not found in this practice.');
        const assignor = await tx.assignor.findFirst({ where: { id: dto.assignorId } });
        if (!assignor) throw new NotFoundException('Assignor not found in this practice.');

        const agreement = await tx.agreement.create({
          data: {
            practiceId,
            type: dto.type,
            anchorKind: expectedAnchor,
            providerId: expectedAnchor === 'provider' ? dto.providerId : null,
            organisationId: expectedAnchor === 'organisation' ? dto.organisationId : null,
            patientId: dto.patientId,
            assignorId: dto.assignorId,
            assignorIsPatient: dto.assignorIsPatient,
            enduringPathway: dto.enduringPathway ?? null,
            status: 'draft',
          },
        });
        await enqueueVaultEvent(tx, {
          type: 'agreement.created',
          actor: SYSTEM_ACTOR,
          subject: { type: 'Agreement', id: agreement.id },
          payload: { agreementType: dto.type, anchorKind: expectedAnchor },
        });
        return agreement;
      });
    } catch (err) {
      if (err instanceof HardRuleViolation) throw new BadRequestException(err.message);
      throw err;
    }
  }

  /**
   * Rule 2 (REQ-REG-06): particulars are validated by the rules engine and
   * locked BEFORE the signature control can ever enable. A rules-engine fail
   * blocks the lock; while no rule set is registered the rules service
   * returns 501 and locking is impossible — blocked states stay unreachable.
   */
  async lockParticulars(practiceId: string, agreementId: string, dto: LockParticularsDto): Promise<DbAgreement> {
    try {
      assertNoForbiddenAgreementFields(dto.particulars);
    } catch (err) {
      if (err instanceof HardRuleViolation) throw new BadRequestException(err.message);
      throw err;
    }

    const validation = await this.rules.validate({ payload: dto.particulars });
    if (!validation.valid) {
      const failures = validation.results.filter((r) => r.outcome === 'fail').map((r) => `${r.rule}: ${r.message}`);
      throw new BadRequestException({ message: 's 65C validation failed', failures });
    }

    return this.prisma.withPractice(practiceId, async (tx) => {
      const agreement = await tx.agreement.findFirst({ where: { id: agreementId } });
      if (!agreement) throw new NotFoundException('Agreement not found.');
      if (agreement.particularsLockedAt) {
        throw new BadRequestException('Particulars are already locked — corrections supersede (HARD-02).');
      }
      const updated = await tx.agreement.update({
        where: { id: agreementId },
        data: {
          particulars: dto.particulars as Prisma.InputJsonValue,
          particularsLockedAt: new Date(),
          ruleSetVersion: validation.ruleSetVersion,
          mappingVersion: validation.mappingVersion,
        },
      });
      await enqueueVaultEvent(tx, {
        type: 'agreement.particulars_locked',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Agreement', id: agreementId },
        payload: { ruleSetVersion: validation.ruleSetVersion, mappingVersion: validation.mappingVersion },
      });
      return updated;
    });
  }

  /** Status changes route through the domain transition map — nothing else. */
  async transition(practiceId: string, agreementId: string, to: string): Promise<DbAgreement> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const agreement = await tx.agreement.findFirst({ where: { id: agreementId } });
      if (!agreement) throw new NotFoundException('Agreement not found.');

      const from = agreement.status as AgreementStatus;
      if (!canTransition(from, to as AgreementStatus)) {
        throw new BadRequestException(`Illegal status transition ${from} → ${to} (REQ-REC-02).`);
      }
      if (to === 'signed') {
        try {
          assertSignatureAllowed({
            particularsPresent: agreement.particulars !== null,
            particularsLocked: agreement.particularsLockedAt !== null,
            validationPassed: agreement.ruleSetVersion !== null,
          });
        } catch (err) {
          if (err instanceof HardRuleViolation) throw new BadRequestException(err.message);
          throw err;
        }
      }

      const updated = await tx.agreement.update({ where: { id: agreementId }, data: { status: to } });
      await enqueueVaultEvent(tx, {
        type: to === 'signed' ? 'agreement.signed' : 'agreement.status_changed',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Agreement', id: agreementId },
        payload: { from, to },
      });
      return updated;
    });
  }

  async get(practiceId: string, agreementId: string): Promise<DbAgreement> {
    const agreement = await this.prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    if (!agreement) throw new NotFoundException('Agreement not found.');
    return agreement;
  }

  list(practiceId: string, status?: string): Promise<DbAgreement[]> {
    return this.prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findMany({ where: status ? { status } : undefined, orderBy: { createdAt: 'desc' } }),
    );
  }
}
