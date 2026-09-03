import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import type { Agreement as DbAgreement, Prisma } from '@prisma/client';
import type { RulesEngineClient } from '@aobplatform/contracts';
import { RendererRegistry } from '../render/renderer-registry';
import { CaptureService } from '../capture/capture.service';
import { WriteBackService } from '../pms/write-back.service';
import {
  assertNoForbiddenAgreementFields,
  assertRepointAllowed,
  assertSignatureAllowed,
  buildAssignorForAnother,
  canTransition,
  HardRuleViolation,
  validAnchorKindFor,
  type AgreementStatus,
  type EnduringPathway,
  type ProviderType,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { RULES_CLIENT, RulesClientError } from '../rules-client/rules-client.module';
import { assertEnduringAllowed } from '@aobplatform/domain';
import type { ChangeAssignorDto, CreateAgreementDto, LockParticularsDto } from './agreements.dto';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;

function prune(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

@Injectable()
export class AgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RULES_CLIENT) private readonly rules: RulesEngineClient,
    private readonly renderers: RendererRegistry,
    private readonly capture: CaptureService,
    private readonly writeBack: WriteBackService,
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
   * SOMEBODY OTHER THAN THE PATIENT IS SIGNING — re-point a draft agreement
   * at them (REQ-VUL-01/-02/-04, REQ-AGE-01, C7.2, D7).
   *
   * WHY THIS ENDPOINT EXISTS. The check-in cascade drafts every `episodic_pre`
   * with `assignorIsPatient: true` (CONSULTATION-CAPTURE-PLAN.md §2.1 step 4),
   * which is right most of the time and wrong once a morning: a parent has
   * brought a child, a spouse or a carer is signing. Nothing could move a
   * draft onto a different assignor, so the tablet handed over to the desk and
   * the ceremony restarted by hand (apps/kiosk/README.md).
   *
   * IT IS ONE TRANSACTION, AND THAT IS THE POINT (rule 11 / FR-11.2). The
   * assignor row, the flag on the agreement, the vault outbox event AND the
   * re-validation all commit or none do: a C8 failure rolls the change back
   * rather than leaving an agreement pointing at a party the rule set refuses.
   *
   * THE GUARDS RUN HERE, NOT ONLY ON THE DEVICE. The kiosk asks the same
   * questions (`apps/kiosk/src/rules/assignor.ts`), and both surfaces reach
   * their answer through `@aobplatform/domain` — but this endpoint can be
   * called directly, so a control that existed only on the tablet would be a
   * suggestion. In particular the REQ-VUL-04 staff block is enforced against
   * the practice's own `staffMember` rows, read inside the practice scope,
   * with the same normalisation the tablet uses.
   *
   * WHAT IT NEVER DOES: verify the claimed authority (reg 65CB(5) makes it a
   * self-declaration — REQ-VUL-02), ask anybody to assess capacity
   * (REQ-VUL-05), or judge the relationship. A friend is `other_with_note`
   * with the note "friend"; the platform has no opinion on who a patient
   * brings with them.
   */
  async changeAssignor(practiceId: string, agreementId: string, dto: ChangeAssignorDto): Promise<DbAgreement> {
    try {
      return await this.prisma.withPractice(practiceId, async (tx) => {
        // A cross-practice id finds nothing: RLS filters on the
        // transaction-local scope, so this fails closed as a 404 rather than
        // leaking that the agreement exists somewhere else.
        const agreement = await tx.agreement.findFirst({ where: { id: agreementId } });
        if (!agreement) throw new NotFoundException('Agreement not found.');

        // Hard rule 2 / REQ-REG-06. Who signs is a particular, so it may only
        // move while the particulars can still move. After the lock the
        // artefact has been rendered and hashed against this party; a
        // correction supersedes (HARD-02), it does not edit.
        assertRepointAllowed({
          status: agreement.status as AgreementStatus,
          particularsLocked: agreement.particularsLockedAt !== null,
        });

        if (dto.assignorIsPatient) {
          // Idempotent: asking for the state it is already in is not an event.
          if (agreement.assignorIsPatient) return agreement;
          if (!agreement.patientAssignorId) {
            throw new BadRequestException(
              'REQ-VUL-01: this agreement has never had the patient as its own assignor, so there is ' +
                'nothing to revert to. Create the agreement with the patient assigning, or choose a party.',
            );
          }
          const reverted = await tx.agreement.update({
            where: { id: agreementId },
            data: { assignorId: agreement.patientAssignorId, assignorIsPatient: true },
          });
          await enqueueVaultEvent(tx, {
            type: 'agreement.assignor_changed',
            actor: SYSTEM_ACTOR,
            subject: { type: 'Agreement', id: agreementId },
            // IDs and facts, never a name and never a contact value
            // (REQ-LOG-08, REQ-VER-04).
            payload: {
              assignorIsPatient: true,
              assignorId: reverted.assignorId,
              previousAssignorId: agreement.assignorId,
            },
          });
          await this.assertAssignorPartyPasses(tx, reverted);
          return reverted;
        }

        /*
         * EVERY NAME THE PRACTICE KNOWS, active or not (REQ-VUL-04, fail
         * closed). Somebody whose console access was withdrawn last week is
         * still practice staff this morning, and the list the tablet holds
         * from `GET /practice-users` includes them — so the server compares
         * against the same population rather than a narrower one.
         */
        const staffNames = (await tx.staffMember.findMany({ select: { name: true } })).map((s) => s.name);

        // Throws a HardRuleViolation naming the rule — and never the name that
        // was typed — for: no name, a basis outside the fixed list, `other`
        // without its note, practice staff, not of full age, and no usable
        // contact channel.
        const party = buildAssignorForAnother({
          name: dto.name,
          authorityBasis: dto.authorityBasis,
          note: dto.note,
          declaresEighteenOrOver: dto.declaresEighteenOrOver,
          mobile: dto.mobile,
          email: dto.email,
          practiceStaffNames: staffNames,
        });

        const declaredAt = new Date();
        const assignor = await tx.assignor.create({
          data: {
            practiceId,
            name: party.name,
            relationshipToPatient: party.relationshipToPatient,
            authorityBasis: party.authorityBasis,
            authorityNote: party.authorityNote,
            contactMobile: party.contactMobile,
            contactEmail: party.contactEmail,
            preferredChannel: party.preferredChannel,
            // The two declarations, recorded and never verified (REQ-VUL-02,
            // REQ-AGE-01). No date of birth is asked for or stored.
            authorityDeclaredAt: declaredAt,
            declaredOfFullAgeAt: declaredAt,
          },
        });

        const updated = await tx.agreement.update({
          where: { id: agreementId },
          data: {
            assignorId: assignor.id,
            assignorIsPatient: false,
            // Remembered on the way out, so "the patient is signing after all"
            // is exact rather than a name match.
            patientAssignorId: agreement.assignorIsPatient
              ? agreement.assignorId
              : agreement.patientAssignorId,
          },
        });

        await enqueueVaultEvent(tx, {
          type: 'agreement.assignor_changed',
          actor: SYSTEM_ACTOR,
          subject: { type: 'Agreement', id: agreementId },
          payload: {
            assignorIsPatient: false,
            assignorId: assignor.id,
            previousAssignorId: agreement.assignorId,
            authorityBasis: party.authorityBasis,
            // The TYPE of channel, never the number or the address.
            contactChannelType: party.preferredChannel,
            hasAuthorityNote: party.authorityNote !== null,
            // Reg 65CB(5): what was recorded is a declaration, and the record
            // says so rather than implying anybody checked.
            authoritySelfDeclared: true,
            declaredOfFullAge: true,
          },
        });

        await this.assertAssignorPartyPasses(tx, updated);
        return updated;
      });
    } catch (err) {
      if (err instanceof HardRuleViolation) throw new BadRequestException(err.message);
      throw err;
    }
  }

  /**
   * C8, asserted on the payload AS PERSISTED rather than on the request that
   * produced it (REQ-65C-01). The DTO said what was wanted; this asks the rule
   * set about what is actually now on the record, using the SAME projection
   * `lockParticulars` will send later — so a change that the lock would refuse
   * is refused now, while it is still a draft and still cheap to fix.
   *
   * Runs inside the caller's transaction on purpose: a failure here rolls the
   * re-point back rather than leaving an agreement the lock cannot accept.
   */
  private async assertAssignorPartyPasses(tx: Prisma.TransactionClient, agreement: DbAgreement): Promise<void> {
    const assignor = await tx.assignor.findFirst({ where: { id: agreement.assignorId } });
    const payload = prune({
      agreementType: agreement.type,
      assignorIsPatient: agreement.assignorIsPatient,
      assignorName: agreement.assignorIsPatient ? undefined : assignor?.name,
      assignorRelationship: agreement.assignorIsPatient
        ? undefined
        : (assignor?.relationshipToPatient ?? undefined),
    });

    const validation = await this.rules.validate({ payload, stage: 'pre_signature' }).catch((err) => {
      if (err instanceof RulesClientError && err.status === 501) {
        throw new NotImplementedException(
          'The s 65C rule set is not registered yet (human-authored zone) — D7 cannot be asserted, ' +
            'so the assignor cannot be changed.',
        );
      }
      throw err;
    });

    const c8 = validation.results.find((r) => r.rule === 'C8');
    if (!c8) {
      // Silence is not a pass. A rule set that returns no C8 verdict has not
      // been asked the question this endpoint exists to answer.
      throw new InternalServerErrorException(
        `Rule set ${validation.ruleSetVersion} returned no C8 verdict — D7 cannot be asserted, so the ` +
          'assignor change is refused.',
      );
    }
    if (c8.outcome === 'fail') {
      // The rule set's own wording, which carries the citation and no PII.
      throw new BadRequestException({ message: 'C8 (D7): the assignor party is incomplete', rule: 'C8', detail: c8.message });
    }
  }

  /**
   * Rule 2 (REQ-REG-06): particulars are validated by the rules engine and
   * locked BEFORE the signature control can ever enable. A rules-engine fail
   * blocks the lock; while no rule set is registered the rules service
   * returns 501 and locking is impossible — blocked states stay unreachable.
   */
  async lockParticulars(practiceId: string, agreementId: string, dto: LockParticularsDto): Promise<DbAgreement> {
    // Assemble the particulars from the platform's OWN records (REQ-DATA-11:
    // cache the person, snapshot the agreement) — the client supplies only
    // what the server cannot know; it can never assert a fact the server owns.
    const particulars = await this.prisma.withPractice(practiceId, async (tx) => {
      const agreement = await tx.agreement.findFirst({ where: { id: agreementId } });
      if (!agreement) throw new NotFoundException('Agreement not found.');
      if (agreement.particularsLockedAt) {
        throw new BadRequestException('Particulars are already locked — corrections supersede (HARD-02).');
      }
      const patient = await tx.patient.findFirst({ where: { id: agreement.patientId } });
      if (!patient) throw new NotFoundException('Patient not found.');
      const provider = agreement.providerId
        ? await tx.provider.findFirst({ where: { id: agreement.providerId } })
        : null;
      const assignor = await tx.assignor.findFirst({ where: { id: agreement.assignorId } });

      // undefined values are pruned: they vanish in the JSON round-trip
      // through Postgres, and rule 13 requires the stored snapshot to
      // re-render byte-identically to what was hashed at lock.
      return prune({
        patientName: `${patient.givenNames} ${patient.familyName}`,
        agreementDate: dto.agreementDate ?? new Date().toISOString().slice(0, 10),
        agreementType: agreement.type,
        providerName: provider?.name,
        providerAddress: provider?.placeOfPracticeAddress ?? undefined,
        providerNumber: provider?.providerNumber ?? undefined,
        serviceDate: dto.serviceDate,
        basicServiceDescription: dto.basicServiceDescription,
        mbsItemNumbers: dto.mbsItemNumbers,
        assignorIsPatient: agreement.assignorIsPatient,
        assignorName: agreement.assignorIsPatient ? undefined : assignor?.name,
        assignorRelationship: agreement.assignorIsPatient ? undefined : (assignor?.relationshipToPatient ?? undefined),
        verificationPassed: agreement.verificationEventId !== null ? true : undefined,
      });
    });

    try {
      assertNoForbiddenAgreementFields(particulars);
    } catch (err) {
      if (err instanceof HardRuleViolation) throw new BadRequestException(err.message);
      throw err;
    }

    const validation = await this.rules.validate({ payload: particulars, stage: 'pre_signature' }).catch((err) => {
      // Surface the rules service's own status honestly — a 501 means the
      // human-authored rule set is not registered yet; a lock is impossible,
      // not broken (blocked states stay unreachable).
      if (err instanceof RulesClientError && err.status === 501) {
        throw new NotImplementedException(
          'The s 65C rule set is not registered yet (human-authored zone) — particulars cannot be locked.',
        );
      }
      throw err;
    });
    if (!validation.valid) {
      const failures = validation.results.filter((r) => r.outcome === 'fail').map((r) => `${r.rule}: ${r.message}`);
      throw new BadRequestException({ message: 's 65C validation failed', failures });
    }

    // Rule 13 / REQ-VAULT-02: one deterministic render path — the artefact is
    // rendered and hashed at lock time, and the hash is evidenced BEFORE the
    // signature control can enable.
    const languages = ['en'] as const; // bilingual rendering (REQ-LANG-02) arrives with M14
    const rendered = await this.renderers.current().render(particulars, languages);

    return this.prisma.withPractice(practiceId, async (tx) => {
      const agreement = await tx.agreement.findFirst({ where: { id: agreementId } });
      if (!agreement) throw new NotFoundException('Agreement not found.');
      if (agreement.particularsLockedAt) {
        throw new BadRequestException('Particulars are already locked — corrections supersede (HARD-02).');
      }
      const updated = await tx.agreement.update({
        where: { id: agreementId },
        data: {
          particulars: particulars as Prisma.InputJsonValue,
          particularsLockedAt: new Date(),
          ruleSetVersion: validation.ruleSetVersion,
          mappingVersion: validation.mappingVersion,
          renderedArtefactHash: rendered.sha256,
          rendererVersion: rendered.rendererVersion,
          renderedLanguages: [...languages],
        },
      });
      await enqueueVaultEvent(tx, {
        type: 'agreement.particulars_locked',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Agreement', id: agreementId },
        payload: { ruleSetVersion: validation.ruleSetVersion, mappingVersion: validation.mappingVersion },
      });
      await enqueueVaultEvent(tx, {
        type: 'agreement.rendered',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Agreement', id: agreementId },
        payload: { artefactSha256: rendered.sha256, rendererVersion: rendered.rendererVersion },
      });
      return updated;
    });
  }

  /**
   * Signature capture (REQ-SIG-01/-02): binds the hash of the exact rendered
   * artefact, the rule-set + mapping versions, the preceding verification
   * event, timestamp, channel, device and IP into an append-only signature
   * event — then validates at storage and completes the capture request
   * (closing every other open channel, FR-2.7).
   */
  async sign(
    practiceId: string,
    agreementId: string,
    dto: {
      method: string;
      channel: string;
      captureRequestId?: string;
      deviceFingerprint?: string;
      ipAddress?: string;
    },
  ): Promise<DbAgreement> {
    // Storage-time re-validation (REQ-65C-01: "and again at storage").
    const agreementBefore = await this.get(practiceId, agreementId);
    if (agreementBefore.status !== 'awaiting_signature') {
      throw new BadRequestException(`Cannot sign an agreement in status ${agreementBefore.status}.`);
    }
    try {
      assertSignatureAllowed({
        particularsPresent: agreementBefore.particulars !== null,
        particularsLocked: agreementBefore.particularsLockedAt !== null,
        validationPassed: agreementBefore.ruleSetVersion !== null,
      });
    } catch (err) {
      if (err instanceof HardRuleViolation) throw new BadRequestException(err.message);
      throw err;
    }
    // Storage pass (REQ-65C-01 "and again at storage"): the stored snapshot
    // plus the signature and lock facts, against the SAME rule-set version
    // that validated the lock (rule 14).
    const revalidation = await this.rules.validate({
      payload: {
        ...(agreementBefore.particulars as Record<string, unknown>),
        signaturePresent: true,
        signatureMethod: dto.method,
        signatureTimestamp: new Date().toISOString(),
        particularsLockedAt: agreementBefore.particularsLockedAt?.toISOString(),
        verificationPassed: agreementBefore.verificationEventId !== null ? true : undefined,
      },
      ruleSetVersion: agreementBefore.ruleSetVersion ?? undefined,
      stage: 'storage',
    });
    if (!revalidation.valid) {
      throw new BadRequestException('Storage-time s 65C validation failed — the agreement cannot be stored.');
    }

    // Rule 13: any later use re-verifies the hash — re-render with the SAME
    // renderer version that produced the artefact, and compare.
    const renderer = this.renderers.get(agreementBefore.rendererVersion);
    if (!renderer) {
      throw new InternalServerErrorException(
        `Renderer version ${agreementBefore.rendererVersion} is not registered — the artefact cannot be re-verified.`,
      );
    }
    const rerendered = await renderer.render(
      agreementBefore.particulars as Record<string, unknown>,
      agreementBefore.renderedLanguages,
    );
    if (rerendered.sha256 !== agreementBefore.renderedArtefactHash) {
      throw new InternalServerErrorException(
        'Render determinism violation: re-rendered artefact hash differs from the hash recorded at lock. ' +
          'Signing is refused (rule 13).',
      );
    }

    await this.prisma.withPractice(practiceId, async (tx) => {
      const signatureEvent = await tx.signatureEvent.create({
        data: {
          practiceId,
          agreementId,
          captureRequestId: dto.captureRequestId ?? null,
          method: dto.method,
          channel: dto.channel,
          artefactHash: rerendered.sha256,
          rendererVersion: rerendered.rendererVersion,
          ruleSetVersion: agreementBefore.ruleSetVersion,
          mappingVersion: agreementBefore.mappingVersion,
          verificationEventId: agreementBefore.verificationEventId,
          deviceFingerprint: dto.deviceFingerprint ?? null,
          ipAddress: dto.ipAddress ?? null,
        },
      });
      await enqueueVaultEvent(tx, {
        type: 'signature.captured',
        actor: SYSTEM_ACTOR,
        subject: { type: 'SignatureEvent', id: signatureEvent.id },
        payload: {
          agreementId,
          method: dto.method,
          channel: dto.channel,
          artefactSha256: rerendered.sha256,
          hasVerificationEvent: agreementBefore.verificationEventId !== null,
        },
      });

      let current = await tx.agreement.update({
        where: { id: agreementId },
        data: { status: 'signed', signatureEventId: signatureEvent.id },
      });
      await enqueueVaultEvent(tx, {
        type: 'agreement.signed',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Agreement', id: agreementId },
        payload: { signatureEventId: signatureEvent.id },
      });

      for (const to of ['validated', 'stored'] as const) {
        current = await tx.agreement.update({ where: { id: agreementId }, data: { status: to } });
        await enqueueVaultEvent(tx, {
          type: to === 'validated' ? 'agreement.validated' : 'agreement.stored',
          actor: SYSTEM_ACTOR,
          subject: { type: 'Agreement', id: agreementId },
          payload: { ruleSetVersion: agreementBefore.ruleSetVersion ?? '' },
        });
      }
      return current;
    });

    if (dto.captureRequestId) {
      await this.capture.complete(practiceId, dto.captureRequestId);
    }
    // Write-back is the product (REQ-INT-02) — attempted immediately; the
    // sweep retries on failure, so a PMS outage slows evidence, never care.
    await this.writeBack.attempt(practiceId, agreementId);
    return this.get(practiceId, agreementId);
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
