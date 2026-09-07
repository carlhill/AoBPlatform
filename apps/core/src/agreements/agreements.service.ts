import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import type { Agreement as DbAgreement, Prisma } from '@prisma/client';
import { answersEnduringRules, type RulesEngineClient } from '@aobplatform/contracts';
import { RendererRegistry, renderInputOf } from '../render/renderer-registry';
import { LetterheadService } from '../practices/letterhead.service';
import { TemplatesService } from '../templates/templates.service';
import { RenderRefusal, type AgreementDocument } from '../render/agreement-document';
import { CaptureService } from '../capture/capture.service';
import { WriteBackService } from '../pms/write-back.service';
import {
  AgreementTemplateError,
  renderAgreementTemplate,
  type RenderedAgreementTemplate,
  assertNoForbiddenAgreementFields,
  assertRepointAllowed,
  assertSignatureAllowed,
  assertSignatureCaptureAcceptable,
  buildAssignorForAnother,
  canTransition,
  HardRuleViolation,
  SignatureCaptureError,
  SIGNATURE_RASTER_PURPOSE,
  SIGNATURE_VECTOR_PURPOSE,
  validAnchorKindFor,
  type AcceptedSignatureCapture,
  type AgreementStatus,
  type DrawnSignatureCapture,
  type EnduringPathway,
  type ProviderType,
} from '@aobplatform/domain';
import { ArtefactsService } from '../artefacts/artefacts.service';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { resolveBillingRoleForProvider } from '../affiliations/provider-billing-role';
import { PrismaService } from '../prisma/prisma.service';
import { RULES_CLIENT, RulesClientError } from '../rules-client/rules-client.module';
import { assertCanBeProviderOnAgreement, assertEnduringAllowed } from '@aobplatform/domain';
import type { ChangeAssignorDto, CreateAgreementDto, LockParticularsDto } from './agreements.dto';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;

/**
 * WHO "UPLOADED" A SIGNATURE ARTEFACT. Not a name — the artefact rule requires
 * an attribution and the honest one here is the ceremony, not a person typing.
 * Who signed is bound through the agreement's assignor record, where it is
 * scoped and encrypted; repeating it on an artefact row would spread a name
 * for no evidential gain (REQ-LOG-08).
 */
const SIGNATURE_ATTRIBUTION = 'signature ceremony';

/**
 * PAST THE SIGNATURE ALREADY — which turns `sign` into `already_signed` rather
 * than `not_awaiting_signature` (Carl, 7 Sep 2026).
 *
 * The distinction is the whole value of the code to reception: "somebody has
 * already signed this, there is nothing to send" is a different next act from
 * "this is not at the signing step" (a draft, a declined agreement, an expired
 * one), which usually is a send-again once the reason is fixed.
 */
const SIGNED_ALREADY_STATUSES: ReadonlySet<string> = new Set([
  'signed',
  'validated',
  'stored',
  'active',
  'claim_linked',
  'registration_pending',
  'registered',
  'registration_overdue',
]);

/**
 * HOW LONG THE "IS THE ENDURING BRANCH AUTHORED?" ANSWER IS REUSED. A minute:
 * long enough that a console list of a dozen enduring rows costs one call,
 * short enough that registering the rule set is visible without a restart.
 */
const ENDURING_PROBE_TTL_MS = 60_000;

function prune(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

/**
 * EVERYTHING THE LOCK DECIDED, BEFORE IT WROTE ANYTHING — the snapshot, the
 * two versions that validated it (hard rule 14) and the hash of the artefact
 * rendered from it (rule 13).
 *
 * It exists so that the writes can be handed to a caller's transaction:
 * `lockParticulars` prepares and commits in one call, and the push-to-device
 * flow prepares first and then commits alongside its verification event and
 * its session, atomically (hard rule 11).
 */
/**
 * THE RULE SET WAS ASKED ABOUT AN ENDURING AGREEMENT AND DID NOT ANSWER
 * (Carl, 4 Sep 2026; GA-PLAN B5).
 *
 * NOT AN HTTP EXCEPTION, deliberately. Every caller of `prepareLock` has its
 * own vocabulary for a refusal — the tablet push has a CODE the console maps
 * to a receptionist's words (`enduring_rules_not_authored`), and a direct API
 * caller wants a status. Throwing a `ConflictException` from here would decide
 * that for both of them and would put a sentence written for one surface on
 * the other. So the fact travels as a fact and each caller says it its own way.
 *
 * WHY IT IS A REFUSAL AND NOT A PASS. The registered rule set has no enduring
 * branch: C6 skips D6a for the type and passes trivially, and NOTHING asserts
 * reg 65CB's content set, the pathway, the GP-only rule or the per-practitioner
 * anchor. A `valid: true` from that set means "none of the episodic rules
 * failed", not "this standing commitment to bulk bill is sound" — and silence
 * is not a pass (the same idiom `setAssignor` applies to a missing C8 verdict).
 *
 * IT IS A GAP, NOT A FAULT, and nothing here blocks care (hard rule 8): the
 * patient is seen, and reception offers an agreement for the visit instead.
 */
export class EnduringRulesNotAuthoredError extends Error {
  constructor(readonly ruleSetVersion: string) {
    super(
      `Rule set ${ruleSetVersion} returns no verdict on the enduring content set (reg 65CB), so an enduring ` +
        'agreement cannot be validated or locked. The s 65C rule set is a human-authored zone (CLAUDE.md §7); ' +
        'apps/rules/test/enduring-ruleset.pending.spec.ts is the contract the branch is authored against.',
    );
    this.name = 'EnduringRulesNotAuthoredError';
  }
}

export interface PreparedLock {
  readonly particulars: Record<string, unknown>;
  readonly ruleSetVersion: string;
  readonly mappingVersion: string;
  readonly renderedArtefactHash: string;
  readonly rendererVersion: string;
  readonly languages: readonly string[];
  /**
   * THE WHOLE DOCUMENT THAT WAS HASHED — letterhead, resolved words and the
   * particulars above (Carl, 5 Sep 2026; W1). Stored on the agreement so that
   * re-rendering to check the hash has something complete to re-render, and so
   * that a change to ANY rendered element moves the bytes. Before this, the
   * render input was the particulars alone and correcting a detail the page
   * did not carry changed nothing (the 4 September note).
   */
  readonly renderPayload: AgreementDocument;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly letterheadHash: string;
  /** The statements the assignor must tick, in order. Keys travel to the signature. */
  readonly statements: readonly { readonly key: string; readonly text: string }[];
}

@Injectable()
export class AgreementsService {
  private readonly logger = new Logger(AgreementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(RULES_CLIENT) private readonly rules: RulesEngineClient,
    private readonly renderers: RendererRegistry,
    private readonly capture: CaptureService,
    private readonly writeBack: WriteBackService,
    private readonly artefacts: ArtefactsService,
    private readonly letterheads: LetterheadService,
    private readonly templates: TemplatesService,
  ) {}

  /** See `enduringRulesAuthored`. In-process and per-instance, which is all a hint needs to be. */
  private enduringProbe: { at: number; authored: boolean } | null = null;

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
          /*
           * THE PROVIDER ON AN AGREEMENT IS THE SERVICING PROVIDER (Carl, 5-7
           * Sep 2026; TODO.md "Billing role on the affiliation").
           *
           * HERE AND NOT ONLY AT ARRIVAL. The arrival is the commonest way an
           * agreement gets a provider and it refuses a nurse there with its own
           * reason code -- but it is not the only way. The desk can draft one by
           * hand, the appointment sweep drafts them, and a correction supersedes
           * one. A rule enforced at one door of four is a rule with three doors,
           * so it lives at the service that owns the guards.
           */
          assertCanBeProviderOnAgreement(
            (await resolveBillingRoleForProvider(tx, provider)).billingRole,
            provider.name,
          );
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
   * A LOCKED AGREEMENT WHOSE PARTICULARS HAVE BEEN CORRECTED — SUPERSEDE IT
   * (HARD-02, and Carl's ruling of 4 Sep 2026 on re-sending a disputed
   * tablet session).
   *
   * WHY THERE IS NO OTHER ANSWER. Once `lockParticulars` has run, the s 65C
   * snapshot has been validated, rendered and HASHED, and rule 13 says any
   * later display re-verifies that hash. Editing the snapshot would break it;
   * editing the patient row and re-rendering would produce a second artefact
   * for one agreement, which is the same thing wearing a hat. So a corrected
   * particular produces a NEW agreement carrying `supersedesAgreementId`, and
   * the old one keeps its own true record of what it said and when.
   *
   * WHAT IS COPIED, AND WHY EACH. The anchor (HARD-01 — a superseding
   * agreement is the SAME provider seeing the SAME patient; a different
   * provider would be a different agreement needing fresh consent), the
   * patient, the assignor and D7, the enduring pathway, and D6a — because the
   * Basic Service Description was chosen by a staff member on a staff surface
   * and losing it would send reception back to the reconciliation screen to
   * re-choose something nobody changed (hard rule 14: the version it validates
   * under is recorded at the new lock, so nothing is smuggled forward).
   *
   * WHAT IS NOT COPIED: everything about the LOCK. No particulars, no hash, no
   * rule-set or mapping version, no verification event, no signature. The new
   * agreement is a draft, and the push that follows validates and locks it
   * from scratch against the corrected records (REQ-DATA-11) — which is the
   * point of the exercise.
   *
   * THE OLD AGREEMENT'S STATUS IS LEFT ALONE, deliberately. There is no
   * `superseded` status in the lifecycle (`packages/domain/src/lifecycle.ts`)
   * and inventing a transition to `expired` or `declined` here would file this
   * under a word that means something else — a patient declined nothing and no
   * clock ran out. What stops the old one being signed is that the caller
   * closes its capture requests; what records why is the event below. A real
   * `superseded` status is worth adding and is a domain decision, not a
   * side-effect of this endpoint.
   */
  async supersedeForCorrection(
    tx: Prisma.TransactionClient,
    practiceId: string,
    agreement: DbAgreement,
    correctedTypes: readonly string[],
    actor: { id: string; name: string },
  ): Promise<DbAgreement> {
    const replacement = await tx.agreement.create({
      data: {
        practiceId,
        type: agreement.type,
        anchorKind: agreement.anchorKind,
        providerId: agreement.providerId,
        affiliationId: agreement.affiliationId,
        organisationId: agreement.organisationId,
        patientId: agreement.patientId,
        assignorId: agreement.assignorId,
        assignorIsPatient: agreement.assignorIsPatient,
        patientAssignorId: agreement.patientAssignorId,
        enduringPathway: agreement.enduringPathway,
        /*
         * THE SAME D6a READ `pushable` USES (`d6aOf`, this file's own copy of
         * `tablet-sessions.service.ts`'s helper — Carl flagged this live, 4
         * Sep 2026). D6a can live in the COLUMN or, when it arrived through
         * `lockParticulars`'s own DTO rather than the staff surface that
         * writes the column, in `particulars.basicServiceDescription`. The old
         * agreement's `particulars` is never copied (see below — it belongs to
         * the LOCK this draft has not gone through yet), so a description that
         * only ever lived there must be read out and copied across as a plain
         * column value now, or it is gone: the new draft would show "Not set"
         * and refuse to push over a detail nobody changed.
         */
        serviceDescription: d6aOf(agreement),
        serviceDescriptionSetBy: agreement.serviceDescriptionSetBy,
        serviceDescriptionSetAt: agreement.serviceDescriptionSetAt,
        status: 'draft',
        supersedesAgreementId: agreement.id,
      },
    });

    await enqueueVaultEvent(tx, {
      type: 'agreement.superseded',
      // A PERSON, NOT THE SYSTEM. A staff member corrected a detail and asked
      // for the agreement to go out again; that act is theirs and the record
      // says so.
      actor: { principalType: 'staff', id: actor.id },
      subject: { type: 'Agreement', id: agreement.id },
      payload: {
        supersededBy: replacement.id,
        reason: 'patient_details_corrected',
        /*
         * WHICH KINDS OF DETAIL, never the values (REQ-VER-04) — `name`,
         * `date_of_birth`, `address`: the same five words the tablet's
         * tick-boxes use.
         */
        correctedTypes: [...correctedTypes].sort().join(','),
        correctedBy: actor.name,
        agreementType: agreement.type,
      },
    });

    return replacement;
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
            // The caller's own word when it gave one (the kiosk's dropdown),
            // otherwise the one derived from the basis. REQ-VUL-01 keeps
            // relationship and authority basis as separate attributes.
            relationshipToPatient: dto.relationship?.trim() || party.relationshipToPatient,
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
            // WHICH LIST THEY CHOSE FROM (hard rule 14). A relationship word is
            // versioned content; the question asked months later is what the
            // person was offered at the time, which is evidence rather than
            // current state — so it lives on the event, not on a column. Absent
            // for callers that do not use a list.
            ...(dto.relationshipsVersion ? { relationshipsVersion: dto.relationshipsVersion } : {}),
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
   *
   * SPLIT INTO `prepareLock` AND `commitLock` (4 Sep 2026), and this method is
   * now the two of them in a row. The behaviour is unchanged for every existing
   * caller; what the split buys is that the push-to-device flow can do its
   * WRITES in the SAME transaction as the staff-verified verification event
   * and the tablet session (hard rule 11 — a locked agreement with no evidence
   * of who verified the patient, or evidence of a push that did not happen,
   * are both structurally impossible). It could not do that while the only
   * entry point owned its own transaction.
   */
  async lockParticulars(practiceId: string, agreementId: string, dto: LockParticularsDto): Promise<DbAgreement> {
    const prepared = await this.prepareLock(practiceId, agreementId, dto);
    return this.prisma.withPractice(practiceId, (tx) => this.commitLock(tx, agreementId, prepared));
  }

  /**
   * EVERYTHING THE LOCK DOES BEFORE IT WRITES ANYTHING: assemble the
   * particulars from the platform's own records, assert the forbidden fields
   * are absent, ask the rules engine, and render.
   *
   * IT DELIBERATELY HOLDS NO TRANSACTION. Two of the three steps are network
   * calls — the rules service and (in time) the renderer's fonts — and holding
   * a database transaction open across a network call is how a slow dependency
   * turns into a locked table. The same reasoning `sign` gives for staging
   * artefact bytes before it opens its transaction.
   *
   * `overrides` EXISTS FOR EXACTLY ONE CALLER and says so. The push records a
   * staff-verified verification event in the same transaction as the lock, so
   * at the moment the particulars are assembled the agreement does not yet
   * carry the event id — and `verificationPassed` would read false for a
   * patient who was verified across the desk a second ago. The override states
   * the fact the caller is about to make true, atomically. Nothing else may
   * use it, and nothing else does.
   */
  async prepareLock(
    practiceId: string,
    agreementId: string,
    dto: LockParticularsDto,
    overrides: { verificationPassed?: true } = {},
  ): Promise<PreparedLock> {
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
      /*
       * AN ENDURING AGREEMENT'S CONTENT SET IS reg 65CB'S, NOT D5/D6a's
       * (REQ-END-02, REQ-TEST-02: "for enduring forms, reg 65CB").
       *
       * D5 is "the date the service will be (pre) or was (post) rendered" and
       * D6a is "basic description — PRE-AGREEMENTS ONLY" (REQ-REG-01). A
       * standing agreement is neither: it has no single service date to state
       * and no one description, which is exactly why the rule set's C5/C6 do
       * not fit it and why the enduring branch has to be authored rather than
       * inferred. So neither is assembled here — a serviceDate invented for an
       * enduring agreement would be a particular the platform made up, hashed
       * into an artefact and rendered at a patient.
       *
       * READ, NOT WRITTEN. The enduring detail is the enduring module's table
       * and this only reads it, on the precedent every other assembly here
       * follows: the snapshot has to state what the agreement says, and one
       * module's tables cannot say it alone.
       */
      const enduring =
        agreement.type === 'enduring'
          ? await tx.enduringDetail.findFirst({ where: { agreementId } })
          : null;

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
        serviceDate: agreement.type === 'enduring' ? undefined : dto.serviceDate,
        /*
         * D6a FROM THE DRAFT WHEN THE CLIENT DID NOT SEND ONE, and that is the
         * ordinary case now rather than the exception. The Basic Service
         * Description is chosen by a staff member on a staff surface
         * (`POST /service-descriptions/agreements/:id`) and parked on the
         * agreement, because the kiosk must never present a field a patient
         * could fill on the practice's behalf (Carl, 3 Sep 2026) — so the
         * tablet sends nothing and the server reads its own record, exactly as
         * it does for every other particular above (REQ-DATA-11).
         *
         * The DTO still wins where it is given, for the callers that predate
         * the staff surface.
         */
        basicServiceDescription:
          agreement.type === 'enduring'
            ? undefined
            : (dto.basicServiceDescription ?? agreement.serviceDescription ?? undefined),
        mbsItemNumbers: agreement.type === 'enduring' ? undefined : dto.mbsItemNumbers,
        /*
         * reg 65CB'S OWN CONTENT SET, carried only on the type it belongs to
         * (REQ-END-02). The pathway decides which cessation triggers apply and
         * whether an 89AA notice is ever sent (REQ-END-05, REQ-END-07); the
         * covered service classes are the SCOPE the provider is committing to
         * bulk bill until termination (REQ-END-06a); the notification and
         * termination methods are how either party reaches the other
         * (REQ-END-06).
         *
         * NO BENEFIT OR DOLLAR AMOUNT, here or anywhere on the artefact (hard
         * rule 4) — the scope is a list of service classes, never a price.
         *
         * ABSENT UNTIL THE ENDURING DETAIL EXISTS, and absent is honest: the
         * rule set's enduring branch is what decides whether an agreement
         * missing them may be locked, and it says so with a named failure
         * rather than this function guessing a default.
         */
        enduringPathway: agreement.type === 'enduring' ? (agreement.enduringPathway ?? undefined) : undefined,
        coveredServiceClasses: enduring ? [...enduring.scopeValues] : undefined,
        coveredServiceScopeType: enduring?.scopeType ?? undefined,
        notificationMethod: enduring?.notificationMethod ?? undefined,
        terminationMethod: enduring?.terminationMethod ?? undefined,
        assignorIsPatient: agreement.assignorIsPatient,
        assignorName: agreement.assignorIsPatient ? undefined : assignor?.name,
        assignorRelationship: agreement.assignorIsPatient ? undefined : (assignor?.relationshipToPatient ?? undefined),
        verificationPassed:
          overrides.verificationPassed ?? (agreement.verificationEventId !== null ? true : undefined),
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

    /*
     * SILENCE IS NOT A PASS — the enduring boundary, checked BEFORE the
     * ordinary verdict (Carl, 4 Sep 2026; GA-PLAN B5).
     *
     * BEFORE, because the honest answer matters more than the first failure.
     * An enduring payload put through today's set fails C5 (no service date —
     * correctly, since a standing agreement has none), and reporting that
     * would send somebody looking for a date that does not exist instead of
     * telling them the branch has not been written. The order of these two
     * lines IS the "shortcuts to the answer" rule (CLAUDE.md §7).
     */
    if (particulars.agreementType === 'enduring' && !answersEnduringRules(validation.results)) {
      throw new EnduringRulesNotAuthoredError(validation.ruleSetVersion);
    }

    if (!validation.valid) {
      const failures = validation.results.filter((r) => r.outcome === 'fail').map((r) => `${r.rule}: ${r.message}`);
      throw new BadRequestException({ message: 's 65C validation failed', failures });
    }

    /*
     * THE DOCUMENT, ASSEMBLED (Carl, 5 Sep 2026; W1). Three things the
     * particulars alone never carried: whose practice this is, what the words
     * mean, and which version of those words was in force.
     *
     * ORDER MATTERS HERE. The letterhead and the template are fetched AFTER
     * the rules verdict, because a payload that will not validate is not worth
     * a template lookup — and BEFORE the render, because the render is where
     * they become bytes.
     */
    const [{ letterhead, letterheadHash }, resolved] = await Promise.all([
      this.letterheads.forPractice(practiceId),
      this.templates.resolve(practiceId, String(particulars.agreementType ?? '')),
    ]);
    if (resolved.fallbackReason) {
      // A stored practice variant that no longer validates. The agreement is
      // NOT blocked — it falls back to the generic wording (hard rule 8) — but
      // the reason is loud, because somebody has to fix the variant.
      this.logger.error(
        `Practice ${practiceId} has an active agreement template that no longer validates; the generic ` +
          `wording was used instead. ${resolved.fallbackReason}`,
      );
    }

    let template: RenderedAgreementTemplate;
    try {
      template = renderAgreementTemplate(resolved.template, templateValuesFor(particulars, validation));
    } catch (err) {
      if (err instanceof AgreementTemplateError) {
        // A particular the words need and the payload does not have. The rules
        // engine has already passed, so this is a gap between the two — and
        // rendering braces at a patient is not an option (hard rule 2).
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const renderPayload: AgreementDocument = {
      practiceId,
      particulars,
      letterhead,
      letterheadHash,
      template,
      /*
       * THE DRAFT MARKER IS DECIDED HERE AND STORED, never read at render time
       * — see `AgreementDocument`. It is on while the words are unreviewed and
       * we are not in production: a page that failed to say its wording was
       * unreviewed would be the platform passing draft legal copy off as
       * settled, and a marker that depended on the environment would make an
       * agreement stop verifying when it moved between them.
       */
      draftMarker:
        resolved.template.status === 'draft_pending_review' && process.env.NODE_ENV !== 'production',
    };

    // Rule 13 / REQ-VAULT-02: one deterministic render path — the artefact is
    // rendered and hashed at lock time, and the hash is evidenced BEFORE the
    // signature control can enable.
    const languages = ['en'] as const; // bilingual rendering (REQ-LANG-02) arrives with M14
    let rendered;
    try {
      rendered = await this.renderers
        .current()
        .render(renderPayload as unknown as Record<string, unknown>, languages);
    } catch (err) {
      // The render-time guards (hard rules 3, 4 and 12) refuse rather than
      // redact. A refusal at the lock is a person seeing the reason and fixing
      // the record it came from; nobody is blocked from being seen or billed.
      if (err instanceof RenderRefusal) throw new BadRequestException(err.message);
      throw err;
    }

    return {
      particulars,
      ruleSetVersion: validation.ruleSetVersion,
      mappingVersion: validation.mappingVersion,
      renderedArtefactHash: rendered.sha256,
      rendererVersion: rendered.rendererVersion,
      languages: [...languages],
      renderPayload,
      templateId: resolved.template.id,
      templateVersion: resolved.template.version,
      letterheadHash,
      statements: template.statements,
    };
  }

  /**
   * HAS THE ENDURING BRANCH BEEN AUTHORED YET? — the same question
   * `prepareLock` asks, asked cheaply enough for a LIST (Carl, 4 Sep 2026).
   *
   * WHY THE LIST NEEDS TO ASK AT ALL. The console shows the reason a row
   * cannot go BEFORE anybody presses anything, and a row that says nothing and
   * then refuses is the fault Carl found on 4 September ("Cannot be sent yet
   * ... see the practice queue"). So the enduring rows say what they are
   * waiting for, in the same words the refusal would use.
   *
   * ONE PROBE, NOT ONE PER ROW. The question is about the registered RULE SET,
   * not about any agreement, so the payload is a type and nothing else — no
   * patient, no provider, nothing that could be PII in a service that holds
   * none (ADR A-07) — and the answer is cached briefly. A practice with twelve
   * enduring drafts on screen costs one call, and a rule set registered while
   * a console tab is open is picked up within the minute.
   *
   * FALSE ON ANY DOUBT. An unreachable rules service, a 501, a malformed
   * answer: all of them mean "this cannot be validated right now", and the
   * console says so rather than offering a Send that would refuse. Nothing
   * here blocks care (hard rule 8) — it blocks a screen.
   */
  async enduringRulesAuthored(): Promise<boolean> {
    const now = Date.now();
    if (this.enduringProbe && this.enduringProbe.at > now - ENDURING_PROBE_TTL_MS) {
      return this.enduringProbe.authored;
    }
    // Declared without an initial value on purpose: both branches below assign
    // it, and a `false` here would be a value nothing ever reads
    // (`no-useless-assignment`).
    let authored: boolean;
    try {
      const validation = await this.rules.validate({
        payload: { agreementType: 'enduring' },
        stage: 'pre_signature',
      });
      authored = answersEnduringRules(validation.results);
    } catch {
      authored = false;
    }
    this.enduringProbe = { at: now, authored };
    return authored;
  }

  /**
   * THE LOCK'S WRITES, inside a transaction the caller owns.
   *
   * The re-read and the already-locked guard happen HERE rather than only in
   * `prepareLock`, because between preparing and committing anything could
   * have happened — including another lock. HARD-02 is that corrections
   * supersede rather than edit, and this is the line that holds it.
   */
  async commitLock(
    tx: Prisma.TransactionClient,
    agreementId: string,
    prepared: PreparedLock,
    extra: Prisma.AgreementUncheckedUpdateInput = {},
  ): Promise<DbAgreement> {
    const agreement = await tx.agreement.findFirst({ where: { id: agreementId } });
    if (!agreement) throw new NotFoundException('Agreement not found.');
    if (agreement.particularsLockedAt) {
      throw new BadRequestException('Particulars are already locked — corrections supersede (HARD-02).');
    }
    const updated = await tx.agreement.update({
      where: { id: agreementId },
      data: {
        particulars: prepared.particulars as Prisma.InputJsonValue,
        particularsLockedAt: new Date(),
        ruleSetVersion: prepared.ruleSetVersion,
        mappingVersion: prepared.mappingVersion,
        renderedArtefactHash: prepared.renderedArtefactHash,
        rendererVersion: prepared.rendererVersion,
        renderedLanguages: [...prepared.languages],
        // The whole hashed document, and the two versions rule 14 adds to the
        // rule set and mapping already above.
        renderPayload: prepared.renderPayload as unknown as Prisma.InputJsonValue,
        templateId: prepared.templateId,
        templateVersion: prepared.templateVersion,
        letterheadHash: prepared.letterheadHash,
        ...extra,
      },
    });
    await enqueueVaultEvent(tx, {
      type: 'agreement.particulars_locked',
      actor: SYSTEM_ACTOR,
      subject: { type: 'Agreement', id: agreementId },
      payload: {
        ruleSetVersion: prepared.ruleSetVersion,
        mappingVersion: prepared.mappingVersion,
        // WHICH WORDS, alongside which rules (hard rule 14). Without it the
        // evidence says an agreement was locked and validated but not what it
        // said, which is the question a dispute is actually about.
        templateId: prepared.templateId,
        templateVersion: prepared.templateVersion,
      },
    });
    await enqueueVaultEvent(tx, {
      type: 'agreement.rendered',
      actor: SYSTEM_ACTOR,
      subject: { type: 'Agreement', id: agreementId },
      payload: {
        artefactSha256: prepared.renderedArtefactHash,
        rendererVersion: prepared.rendererVersion,
        letterheadHash: prepared.letterheadHash,
      },
    });
    return updated;
  }

  /**
   * THE PUSH'S LOCK — the same commit, plus the two facts that only the push
   * knows, in the same row update (TODO.md "Push-to-device capture").
   *
   * The verification event id, because THE PUSH IS THE VERIFICATION RECORD:
   * reception cannot push until the staff-verified check has been recorded,
   * and the agreement carries the id of the event that records it (REQ-VER-03,
   * REQ-SIG-02 binds it into the signature later).
   *
   * And `awaiting_signature`, because the whole point of a push is that the
   * tablet receives something ready to sign. Doing it here rather than in a
   * second call is what makes "a draft can never reach a device" true of the
   * database rather than of the caller's good intentions (REQ-REG-06).
   */
  async commitPushLock(
    tx: Prisma.TransactionClient,
    agreementId: string,
    /**
     * `null` IS THE RE-PUSH, and it is an ordinary thing rather than an edge
     * case. A session that was recalled, walked away from or expired leaves
     * the agreement locked at `awaiting_signature`; handing the tablet back to
     * the same patient must NOT lock it a second time, because a locked
     * agreement is corrected by superseding and never by editing (HARD-02).
     * What the re-push does record is a FRESH staff-verified event — reception
     * has the person in front of them again — and the agreement points at the
     * newest one, which is what REQ-SIG-02 will bind into the signature.
     */
    prepared: PreparedLock | null,
    verificationEventId: string,
  ): Promise<DbAgreement> {
    const before = await tx.agreement.findFirst({ where: { id: agreementId } });
    if (!before) throw new NotFoundException('Agreement not found.');
    const from = before.status as AgreementStatus;

    if (!prepared) {
      if (!before.particularsLockedAt) {
        // Belt and braces: a caller that skipped the lock on an UNLOCKED
        // agreement would be putting a draft on a tablet, which is the one
        // thing this whole flow exists to make impossible (REQ-REG-06).
        throw new BadRequestException(
          'Particulars are not locked, so this agreement cannot be sent to a tablet (REQ-REG-06).',
        );
      }
      const updated = await tx.agreement.update({
        where: { id: agreementId },
        data: { verificationEventId },
      });
      await enqueueVaultEvent(tx, {
        type: 'agreement.status_changed',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Agreement', id: agreementId },
        payload: { from, to: from, verificationEventId, repushed: true },
      });
      return updated;
    }

    if (!canTransition(from, 'awaiting_signature')) {
      throw new BadRequestException(`Illegal status transition ${from} → awaiting_signature (REQ-REC-02).`);
    }

    const updated = await this.commitLock(tx, agreementId, prepared, {
      verificationEventId,
      status: 'awaiting_signature',
    });
    await enqueueVaultEvent(tx, {
      type: 'agreement.status_changed',
      actor: SYSTEM_ACTOR,
      subject: { type: 'Agreement', id: agreementId },
      // Ids and facts. The verification event holds TYPES and an outcome and
      // never a value (REQ-VER-04); nothing about the person is here.
      payload: { from, to: 'awaiting_signature', verificationEventId },
    });
    return updated;
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
      signature?: DrawnSignatureCapture;
      /** The statement keys the assignor ticked. Every one, or the signature is refused. */
      affirmations?: string[];
    },
  ): Promise<DbAgreement> {
    // Storage-time re-validation (REQ-65C-01: "and again at storage").
    const agreementBefore = await this.get(practiceId, agreementId);
    if (agreementBefore.status !== 'awaiting_signature') {
      /*
       * EVERY REFUSAL ON THIS PATH CARRIES A `reason` CODE (Carl, 7 Sep 2026).
       *
       * The sentence is for a developer reading a log; the CODE is what a
       * receptionist eventually reads, because the tablet echoes it back on
       * `signature_failed` and the console maps it to copy plus a destination.
       * A refusal with only prose is a refusal reception can do nothing with
       * ("Shortcuts to the answer", CLAUDE.md §7).
       */
      throw new BadRequestException({
        message: `Cannot sign an agreement in status ${agreementBefore.status}.`,
        reason: SIGNED_ALREADY_STATUSES.has(agreementBefore.status)
          ? 'already_signed'
          : 'not_awaiting_signature',
      });
    }
    try {
      assertSignatureAllowed({
        particularsPresent: agreementBefore.particulars !== null,
        particularsLocked: agreementBefore.particularsLockedAt !== null,
        validationPassed: agreementBefore.ruleSetVersion !== null,
      });
    } catch (err) {
      if (err instanceof HardRuleViolation) {
        throw new BadRequestException({ message: err.message, reason: 'not_locked' });
      }
      throw err;
    }

    /*
     * THE MARK ITSELF (REQ-SIG-01/-02).
     *
     * A `drawn` signature must arrive with the strokes and the image they
     * produced, and no other method may carry them. Checked here — after the
     * cheap facts about the agreement's own state, before the rules call and
     * the re-render — so a malformed body never costs a validation round trip
     * or a rendered PDF, and so a draft is still refused for being a draft
     * rather than for the shape of its payload.
     *
     * THE REFUSAL NEVER QUOTES THE PAYLOAD. The strokes are the assignor's own
     * hand: identifier-grade, encrypted store only, and never a log line or an
     * error message.
     */
    let capture: AcceptedSignatureCapture | null;
    try {
      capture = assertSignatureCaptureAcceptable({ method: dto.method, signature: dto.signature });
    } catch (err) {
      if (err instanceof SignatureCaptureError) {
        throw new BadRequestException({ message: err.message, reason: 'signature_capture_invalid' });
      }
      throw err;
    }

    /*
     * `signature_requires_every_statement_affirmed` — EVERY TICK BOX, ON THE
     * SERVER (Carl, 5 Sep 2026; W1).
     *
     * The particulars were locked before the tablet drew anything (hard rule
     * 2), and the ticks are the separate thing: the assignor's affirmations of
     * what the document says. They are recorded as KEYS on the signature
     * event, and a signature that does not carry every statement of the
     * template the agreement was rendered from is refused here rather than
     * merely discouraged in the UI — the kiosk's gate is markup, and this is
     * the line that holds for the remote link, the portal and anything built
     * later.
     *
     * AGREEMENTS LOCKED BEFORE TODAY CARRY NO TEMPLATE, so there is nothing to
     * affirm and nothing is required. That is not a loophole a new agreement
     * can reach: `prepareLock` has assembled a template on every lock since.
     */
    const required = statementKeysOf(agreementBefore);
    if (required.length > 0) {
      const ticked = new Set(dto.affirmations ?? []);
      const missing = required.filter((key) => !ticked.has(key));
      if (missing.length > 0) {
        throw new BadRequestException({
          message:
            `The person signing has not agreed to every statement on this agreement (${missing.length} of ` +
            `${required.length} outstanding). A signature is a signature to what the document says, so it ` +
            'cannot be recorded against statements nobody ticked.',
          /*
           * THE CODE MATTERS MORE THAN THE SENTENCE HERE (Carl, 7 Sep 2026).
           * A tablet running a bundle from before the statements existed
           * cannot send them and will be refused every time, so the kiosk
           * reads this code as a reason to hard-reload itself ONCE — a stale
           * bundle heals without anybody visiting the device.
           */
          reason: 'affirmations_missing',
        });
      }
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
      throw new BadRequestException({
        message: 'Storage-time s 65C validation failed — the agreement cannot be stored.',
        reason: 'storage_validation_failed',
      });
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
      renderInputOf(agreementBefore),
      agreementBefore.renderedLanguages,
    );
    if (rerendered.sha256 !== agreementBefore.renderedArtefactHash) {
      throw new InternalServerErrorException(
        'Render determinism violation: re-rendered artefact hash differs from the hash recorded at lock. ' +
          'Signing is refused (rule 13).',
      );
    }

    /*
     * THE BYTES GO TO THE STORE BEFORE THE TRANSACTION OPENS; the ROWS go
     * inside it (`ArtefactsService.stage` / `recordStaged`).
     *
     * That ordering is the same one every artefact upload has always used, and
     * for the same reason: content with no row is merely orphaned and
     * identifiable by its hash, whereas a row pointing at content that was
     * never written is a broken reference. Writing to object storage inside a
     * transaction would also hold a database transaction open across a network
     * call, which is how a slow store turns into a locked table.
     */
    const stagedRaster = capture
      ? await this.artefacts.stage(practiceId, {
          bytes: capture.rasterBytes,
          purpose: SIGNATURE_RASTER_PURPOSE,
          filename: `signature-${agreementId}.png`,
          // NOT the assignor's name. The identity of the signer is bound
          // through the agreement and its assignor record, where it is
          // scoped and encrypted; copying it onto an artefact row would put a
          // name in a second place for no evidential gain (REQ-LOG-08).
          uploadedByName: SIGNATURE_ATTRIBUTION,
          subjectType: 'Agreement',
          subjectId: agreementId,
        })
      : null;
    const stagedVector = capture
      ? await this.artefacts.stage(practiceId, {
          bytes: capture.vectorBytes,
          purpose: SIGNATURE_VECTOR_PURPOSE,
          filename: `signature-${agreementId}.strokes.json`,
          // Deliberately no declaredContentType: the strokes are UTF-8 JSON
          // and the detector calls that `text/plain`. Claiming
          // `application/json` would flag a "mismatch" on every signature and
          // train a real one to be ignored.
          uploadedByName: SIGNATURE_ATTRIBUTION,
          subjectType: 'Agreement',
          subjectId: agreementId,
        })
      : null;

    await this.prisma.withPractice(practiceId, async (tx) => {
      /*
       * ONE TRANSACTION: the two artefact rows, their vault events, the
       * signature event that binds their hashes, and every agreement event
       * after it (rule 11). A signature bound to an artefact row that rolled
       * back would be evidence pointing at nothing.
       */
      const raster = stagedRaster ? await this.artefacts.recordStaged(tx, practiceId, stagedRaster) : null;
      const vector = stagedVector ? await this.artefacts.recordStaged(tx, practiceId, stagedVector) : null;

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
          signatureRasterArtefactId: raster?.id ?? null,
          signatureRasterSha256: raster?.sha256 ?? null,
          signatureVectorArtefactId: vector?.id ?? null,
          signatureVectorSha256: vector?.sha256 ?? null,
          padWidth: capture?.padWidth ?? null,
          padHeight: capture?.padHeight ?? null,
          strokeCount: capture?.strokeCount ?? null,
          pointCount: capture?.pointCount ?? null,
          // KEYS, never the sentences — the words are in the template at the
          // version recorded beside them.
          affirmations: required,
          templateId: agreementBefore.templateId,
          templateVersion: agreementBefore.templateVersion,
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
          // HOW MANY STATEMENTS WERE AFFIRMED, and under which wording. A
          // count and two versions, never the sentences (REQ-LOG-08).
          affirmationCount: required.length,
          templateVersion: agreementBefore.templateVersion ?? 'none',
          // BOTH HALVES OF THE MARK, alongside the rendered agreement's hash
          // (REQ-SIG-02). Hashes and shape only — never the strokes, never the
          // image, never anything a log could leak. Pruned rather than sent as
          // nulls, so a tap-to-approve's event carries no empty signature keys
          // suggesting a drawing that was lost.
          ...prune({
            signatureRasterSha256: raster?.sha256,
            signatureVectorSha256: vector?.sha256,
            strokeCount: capture?.strokeCount,
            pointCount: capture?.pointCount,
            padWidth: capture?.padWidth,
            padHeight: capture?.padHeight,
          }),
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

  /**
   * SHOW THE SIGNATURE — and re-verify it on the way out (rule 13).
   *
   * The agreement's own artefact is re-verified by RE-RENDERING it under the
   * renderer version that produced it and comparing hashes; a signature cannot
   * be re-rendered, because it is not derived from anything — so the same rule
   * is honoured the way the artefact path already honours it: the stored bytes
   * are hashed again on the way out and refused if they no longer match. That
   * check lives in `ArtefactsService.download` and is reused rather than
   * copied, so there is one definition of "these bytes are still the bytes".
   *
   * ONE EXTRA LINK IS CHECKED HERE, which download alone cannot: that the hash
   * the SIGNATURE EVENT bound at signing is still the hash on the artefact
   * row. Download proves the content matches its row; this proves the row is
   * the one the signature was bound to. Both must hold, or what is displayed
   * is not what was signed.
   */
  async signatureArtefact(
    practiceId: string,
    agreementId: string,
    kind: 'raster' | 'vector',
    readByName: string,
  ): Promise<{ bytes: Uint8Array; headers: Record<string, string> }> {
    const agreement = await this.get(practiceId, agreementId);
    if (!agreement.signatureEventId) {
      throw new NotFoundException('This agreement has not been signed.');
    }
    const event = await this.prisma.withPractice(practiceId, (tx) =>
      tx.signatureEvent.findFirst({ where: { id: agreement.signatureEventId as string, agreementId } }),
    );
    if (!event) throw new NotFoundException('Signature event not found for this agreement.');

    const artefactId = kind === 'raster' ? event.signatureRasterArtefactId : event.signatureVectorArtefactId;
    const boundHash = kind === 'raster' ? event.signatureRasterSha256 : event.signatureVectorSha256;
    if (!artefactId || !boundHash) {
      throw new NotFoundException(
        `This signature was captured by ${event.method} and has no drawn mark to show. Only a drawn ` +
          'signature stores strokes and an image (REQ-SIG-01).',
      );
    }

    const stored = await this.prisma.withPractice(practiceId, (tx) =>
      tx.artefact.findFirst({ where: { id: artefactId } }),
    );
    if (!stored) throw new NotFoundException('The stored signature artefact is missing.');
    if (stored.sha256 !== boundHash) {
      throw new BadRequestException(
        'The stored signature no longer matches the hash the signature event bound at signing, so it will ' +
          'not be shown. That is a tamper signal, not a transient error (rule 13).',
      );
    }

    // Re-hashes the bytes and refuses on a mismatch — the same path, and the
    // same refusal, as every other artefact display.
    return this.artefacts.download(practiceId, artefactId, readByName);
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

/**
 * D6a, READ THE SAME WAY EVERYWHERE IT MATTERS (Carl flagged the gap live, 4
 * Sep 2026, over `supersedeForCorrection` losing it). The description lives in
 * the COLUMN when a staff member set it through the reconciliation surface, or
 * in `particulars.basicServiceDescription` when it arrived through
 * `lockParticulars`'s own DTO instead — `tablet-sessions.service.ts` has its
 * own copy of this exact function for `pushable`'s identical read, and
 * `kiosk.service.ts`'s waiting-list read makes the same check inline. This
 * copy exists so `supersedeForCorrection` can carry the value forward as a
 * plain column on the NEW draft — the new agreement never inherits the old
 * one's `particulars` (that belongs to the lock this draft has not gone
 * through), so a description that only ever lived there must be resolved and
 * copied now or it is silently gone.
 */
function d6aOf(agreement: Pick<DbAgreement, 'serviceDescription' | 'particulars'>): string | undefined {
  if (agreement.serviceDescription) return agreement.serviceDescription;
  const particulars = agreement.particulars as Record<string, unknown> | null;
  return typeof particulars?.basicServiceDescription === 'string'
    ? (particulars.basicServiceDescription as string)
    : undefined;
}

/**
 * THE PARTICULARS, TURNED INTO THE VALUES THE WORDS NEED.
 *
 * A DELIBERATE, EXPLICIT MAPPING rather than spreading the payload into the
 * substitution. The template's placeholder names are content — a practice may
 * rewrite every sentence around them — and the particulars' keys are the
 * platform's own vocabulary. Coupling them by coincidence of naming would mean
 * a rename in one silently blanking a particular on a contract in the other.
 *
 * THE EM DASH IS THE ANSWER FOR AN ELEMENT THAT DOES NOT APPLY, never an empty
 * string: `renderAgreementTemplate` throws on a missing value precisely so
 * that a particular cannot vanish, and the branches (`isPreAgreement`,
 * `assignorIsPatient`) are what keep an inapplicable element off the page
 * rather than a blank standing in for it.
 *
 * ONE ELEMENT IS NOT SOURCED FROM THE REQUIREMENTS AND SAYS SO:
 * `commencementDate`. REQ-END-02's reg 65CB content set lists "signature and
 * date", and `EnduringDetail.enteredIntoAt` is "the date the agreement was
 * entered into" — neither is called a commencement. Rather than invent a
 * field, the agreement's own D2 date stands in, which is the day the standing
 * commitment begins on every reading of REQ-END-06a we have. FLAGGED for Carl:
 * if reg 65CB carries a distinct commencement element, it belongs here.
 */
export function templateValuesFor(
  particulars: Record<string, unknown>,
  validation: { readonly mappingVersion: string },
): { values: Record<string, string>; conditions: Record<string, boolean> } {
  const text = (key: string): string => {
    const value = particulars[key];
    if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : NOT_APPLICABLE;
    if (value === undefined || value === null || value === '') return NOT_APPLICABLE;
    return String(value);
  };

  const agreementType = String(particulars.agreementType ?? '');
  /*
   * D4, s 65C(5): NAME + PLACE OF PRACTICE, **OR** PROVIDER NUMBER (REQ-REG-02).
   *
   * A provider number is NOT mandatory, and the whole point of (a) is that a
   * practice can be onboarded without one -- which is also why Carl's ruling
   * of 5-7 Sep 2026 ALLOWS a servicing provider with no number recorded, and
   * flags it on the affiliation screen rather than blocking their agreements.
   * So D4 is never blank, whichever of the two the platform holds.
   *
   * BOTH WHERE BOTH ARE HELD, and that is not belt-and-braces. The statute
   * offers (a) OR (b); a document carrying both satisfies it either way, and
   * the number is the key a claim is actually made against -- a reader
   * reconciling this agreement to a claim should not have to go and look it up.
   * The number is per practitioner PER LOCATION, so the one that renders is the
   * one for the place of practice named beside it.
   */
  const providerName = text('providerName');
  const providerAddress = particulars.providerAddress;
  const providerNumber = particulars.providerNumber;
  const hasAddress = typeof providerAddress === 'string' && providerAddress.trim().length > 0;
  const hasNumber = typeof providerNumber === 'string' && providerNumber.trim().length > 0;
  const providerDetails = [
    providerName,
    hasAddress ? String(providerAddress) : null,
    hasNumber ? `provider number ${String(providerNumber)}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(', ');

  return {
    values: {
      patientName: text('patientName'),
      agreementDate: text('agreementDate'),
      providerName,
      providerDetails,
      serviceDate: text('serviceDate'),
      basicServiceDescription: text('basicServiceDescription'),
      mbsItemNumbers: text('mbsItemNumbers'),
      mappingVersion: validation.mappingVersion,
      assignorName: text('assignorName'),
      assignorRelationship: text('assignorRelationship'),
      enduringPathway: text('enduringPathway'),
      coveredServiceScope: coveredScopeOf(particulars),
      notificationMethod: text('notificationMethod'),
      terminationMethod: text('terminationMethod'),
      // See the note above: D2 stands in, and the naming says the two are the
      // same day rather than pretending to a field the docs do not record.
      commencementDate: text('agreementDate'),
    },
    conditions: {
      assignorIsPatient: particulars.assignorIsPatient !== false,
      // `treatment_plan` takes the pre-service branch: it is agreed before the
      // services it covers, which is what D3 is asking.
      isPreAgreement: agreementType !== 'episodic_post',
    },
  };
}

/** REQ-END-06a — the scope, said as a scope type and its values, never a price. */
function coveredScopeOf(particulars: Record<string, unknown>): string {
  const values = particulars.coveredServiceClasses;
  const scopeType = particulars.coveredServiceScopeType;
  if (!Array.isArray(values) || values.length === 0) return NOT_APPLICABLE;
  const list = values.map(String).join(', ');
  return typeof scopeType === 'string' && scopeType ? `${scopeType}: ${list}` : list;
}

/**
 * WHAT AN ELEMENT THAT DOES NOT APPLY PRINTS AS. An em dash, because a blank
 * on a contract reads as something that failed to print, and because the
 * substitution refuses an empty value outright.
 */
const NOT_APPLICABLE = '—';

/**
 * The statement keys the agreement's own stored document says must be ticked.
 *
 * READ OFF THE STORED DOCUMENT, not off the practice's CURRENT template. What
 * the person signed is what was rendered and hashed for them; a template
 * activated between the lock and the signature must not change what they are
 * required to have agreed to.
 */
function statementKeysOf(agreement: Pick<DbAgreement, 'renderPayload'>): string[] {
  const payload = agreement.renderPayload as { template?: { statements?: unknown } } | null;
  const statements = payload?.template?.statements;
  if (!Array.isArray(statements)) return [];
  return statements
    .map((s) => (s && typeof s === 'object' ? (s as { key?: unknown }).key : undefined))
    .filter((key): key is string => typeof key === 'string' && key.length > 0);
}
