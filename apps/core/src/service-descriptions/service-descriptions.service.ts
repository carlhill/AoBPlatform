import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RuleResult } from '@aobplatform/contracts';
import type { RulesEngineClient } from '@aobplatform/contracts';
import {
  SERVICE_DESCRIPTIONS,
  SERVICE_DESCRIPTIONS_VERSION,
  isServiceDescription,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import type { Actor } from '../auth/actor.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RULES_CLIENT, RulesClientError } from '../rules-client/rules-client.module';

/** The pre-agreement types D6a applies to. C6 asks the same question. */
const PRE_AGREEMENT_TYPES = ['episodic_pre', 'treatment_plan'] as const;

export interface PendingServiceDescriptionRow {
  agreementId: string;
  /** "M. Placeholder" — initial and family name, as every practice list shows it. */
  patientName: string | null;
  providerName: string | null;
  appointmentDate: string | null;
  appointmentTime: string | null;
  /**
   * What is on the draft now, when there is something and it is simply no
   * longer in the current list. Says "this was set from a list that has since
   * moved" rather than "nobody has done this yet", which are different jobs.
   */
  currentDescription: string | null;
  setBy: string | null;
  setAt: string | null;
  createdAt: string;
}

export interface SetServiceDescriptionResult {
  agreementId: string;
  serviceDescription: string;
  mappingVersion: string;
  setBy: string;
  setAt: string;
  /**
   * What the rules engine said afterwards. `null` when it could not be asked —
   * in dev the human-authored rule set is often unregistered and answers 501,
   * and a description chosen from the list is still a description worth
   * keeping. The screen reads this to decide whether the row is now clear or
   * still blocked on something else.
   */
  validation: { ruleSetVersion: string; mappingVersion: string; c6: string; otherFailures: string[] } | null;
}

/**
 * D6a — THE ONE PARTICULAR THE PLATFORM CANNOT DERIVE, SET ON A STAFF SURFACE.
 *
 * WHY THIS MODULE EXISTS AT ALL. A pre-agreement drafted from the appointment
 * book carries every particular except the Basic Service Description: there is
 * no MBS mapping yet, so nothing can turn "9:00, Dr Example" into the exact
 * words s 65C(4) wants. C6 then refuses the lock and the tablet hands over —
 * correctly, because the tablet must never present a field a patient or a
 * passer-by could fill on the practice's behalf (Carl, 3 Sep 2026). The work
 * has to go somewhere, and this is the somewhere: a practice screen, where the
 * person doing it is a known staff member rather than whoever is standing at
 * the kiosk.
 *
 * WHY IT DOES NOT LOCK. The obvious shortcut was to call
 * `POST /agreements/:id/particulars` from the queue with the description in
 * it. That endpoint LOCKS, and locking at the desk closes the door on
 * `POST /agreements/:id/assignor` — after the lock the assignor cannot be
 * re-pointed (HARD-02), so a daughter who arrives with her father could no
 * longer be recorded as the person signing. Setting a particular and freezing
 * the contract are different acts and this is the first one.
 *
 * WHY THE DESCRIPTION LANDS ON THE DRAFT RATHER THAN IN THE REQUEST THAT
 * LOCKS. `lockParticulars` assembles the payload from the platform's own
 * records precisely so a client can never assert a fact the server owns
 * (REQ-DATA-11). D6a was the exception — supplied by whichever client happened
 * to lock — and the exception is what put a staff-entry box on a patient's
 * tablet in the first place. Parked on the agreement, it stops being an
 * exception.
 *
 * WHO DID IT IS RECORDED, and the endpoint refuses without it. An audit line
 * naming nobody is worse than a refusal, because later it cannot be questioned
 * (`SessionActor`'s own words).
 */
@Injectable()
export class ServiceDescriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RULES_CLIENT) private readonly rules: RulesEngineClient,
  ) {}

  /**
   * The list itself. NO PII, and nothing practice-specific — the scope is
   * required only so this cannot be read by an unscoped caller wandering the
   * API surface.
   */
  list(): { version: string; descriptions: readonly string[] } {
    return { version: SERVICE_DESCRIPTIONS_VERSION, descriptions: SERVICE_DESCRIPTIONS };
  }

  /** The practice's default, and the list, in one round trip for the screen. */
  async settings(practiceId: string): Promise<{
    version: string;
    descriptions: readonly string[];
    defaultDescription: string | null;
  }> {
    const practice = await this.prisma.withPractice(practiceId, (tx) => tx.practice.findFirst({}));
    return { ...this.list(), defaultDescription: practice?.defaultServiceDescription ?? null };
  }

  /**
   * Every unlocked pre-agreement draft this practice holds whose D6a is
   * missing or no longer in the current list.
   *
   * A DESCRIPTION SET FROM AN OLD LIST COUNTS AS MISSING, deliberately. C6
   * matches against the CURRENT mapping, so a description the list has since
   * dropped is one the rules engine will refuse — and a queue that stayed
   * silent about it would hand the discovery to a tablet in a waiting room.
   * This is what versioning is for (rule 14): the row says the words are stale
   * rather than pretending they are fine.
   *
   * SCOPING IS THE DATABASE'S JOB. `withPractice` sets the transaction-local
   * scope and FORCE RLS filters on it, so another practice's id sees that
   * practice and nothing of this one.
   */
  async pending(practiceId: string): Promise<PendingServiceDescriptionRow[]> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const drafts = await tx.agreement.findMany({
        where: {
          type: { in: [...PRE_AGREEMENT_TYPES] },
          particularsLockedAt: null,
          signatureEventId: null,
        },
        orderBy: { createdAt: 'asc' },
      });
      const needing = drafts.filter((a) => !isServiceDescription(a.serviceDescription));
      if (needing.length === 0) return [];

      const patients = await tx.patient.findMany({ where: { id: { in: needing.map((a) => a.patientId) } } });
      const patientById = new Map(patients.map((p) => [p.id, p]));
      const providerIds = needing.map((a) => a.providerId).filter((id): id is string => Boolean(id));
      const providers = providerIds.length
        ? await tx.provider.findMany({ where: { id: { in: providerIds } } })
        : [];
      const providerById = new Map(providers.map((p) => [p.id, p]));
      const appointments = await tx.appointment.findMany({
        where: { agreementId: { in: needing.map((a) => a.id) } },
      });
      const appointmentByAgreement = new Map(
        appointments.filter((a) => a.agreementId).map((a) => [a.agreementId as string, a]),
      );

      return needing.map((agreement) => {
        const patient = patientById.get(agreement.patientId);
        const appointment = appointmentByAgreement.get(agreement.id);
        return {
          agreementId: agreement.id,
          // An initial and a family name. A staff list never carries the full
          // given names, and it carries no identifier of any kind.
          patientName: patient ? `${patient.givenNames.trim().charAt(0)}. ${patient.familyName}`.trim() : null,
          providerName: agreement.providerId ? (providerById.get(agreement.providerId)?.name ?? null) : null,
          appointmentDate: appointment ? appointment.date.toISOString().slice(0, 10) : null,
          appointmentTime: appointment?.time ?? null,
          currentDescription: agreement.serviceDescription,
          setBy: agreement.serviceDescriptionSetBy,
          setAt: agreement.serviceDescriptionSetAt?.toISOString() ?? null,
          createdAt: agreement.createdAt.toISOString(),
        };
      });
    });
  }

  /**
   * A staff member chooses D6a for one draft.
   *
   * The write and its vault event commit in ONE transaction through the outbox
   * (hard rule 11): a description with no evidence of who set it, or evidence
   * of a change that did not happen, are both structurally impossible.
   */
  async setFor(
    practiceId: string,
    agreementId: string,
    description: string,
    actor: Actor | undefined,
  ): Promise<SetServiceDescriptionResult> {
    /*
     * WHO, FIRST. Refused rather than recorded as `unattributed`: this endpoint
     * exists BECAUSE the patient surface cannot say who acted. An unattributed
     * write here would reproduce the very gap it was built to close.
     */
    if (!actor) {
      throw new ForbiddenException(
        'D6a is set on a staff surface so that the person who set it is on the record. This request ' +
          'carries no signed-in user, so it is refused rather than recorded as nobody.',
      );
    }

    if (!isServiceDescription(description)) {
      // The version, so a stale screen says something useful; never the value
      // that was sent.
      throw new BadRequestException(
        `The description must be one of the current service-description list (version ${SERVICE_DESCRIPTIONS_VERSION}). ` +
          'C6 matches exactly and case-sensitively, so anything else would be refused at the lock.',
      );
    }

    const setAt = new Date();
    const updated = await this.prisma.withPractice(practiceId, async (tx) => {
      // A cross-practice id finds nothing — RLS filters on the
      // transaction-local scope, so this fails closed as a 404 rather than
      // admitting the agreement exists somewhere else.
      const agreement = await tx.agreement.findFirst({ where: { id: agreementId } });
      if (!agreement) throw new NotFoundException('Agreement not found.');

      if (!(PRE_AGREEMENT_TYPES as readonly string[]).includes(agreement.type)) {
        throw new BadRequestException(
          'D6a applies to pre-agreements only. A post-agreement carries MBS item numbers (D6b) instead.',
        );
      }
      /*
       * Hard rule 2 / REQ-REG-06 again, one step before the signature: after
       * the lock the artefact has been rendered and hashed against these
       * words, so a correction supersedes rather than edits (HARD-02). The
       * database trigger refuses it too; this is the message a person can read.
       */
      if (agreement.particularsLockedAt) {
        throw new BadRequestException(
          'The particulars are already locked, so the description cannot change — a correction supersedes (HARD-02).',
        );
      }

      const row = await tx.agreement.update({
        where: { id: agreementId },
        data: {
          serviceDescription: description,
          serviceDescriptionSetBy: actor.name,
          serviceDescriptionSetAt: setAt,
        },
      });

      await enqueueVaultEvent(tx, {
        type: 'agreement.service_description_set',
        // WHO, from the verified session and never from the body.
        actor: { principalType: 'staff', id: actor.id },
        subject: { type: 'Agreement', id: agreementId },
        payload: {
          serviceDescription: description,
          /*
           * WHICH LIST THEY CHOSE FROM (hard rule 14). On the event rather than
           * on a column, for the same reason `relationshipsVersion` is: the
           * question asked months later is what the practice was OFFERED at the
           * time, which is evidence, not current state.
           */
          serviceDescriptionsVersion: SERVICE_DESCRIPTIONS_VERSION,
          setBy: actor.name,
          replacedStaleDescription: agreement.serviceDescription !== null,
          // No dollar amount, no benefit, no identifier — a particular and a
          // version, which is all this act produced.
        },
      });

      return row;
    });

    return {
      agreementId,
      serviceDescription: description,
      mappingVersion: SERVICE_DESCRIPTIONS_VERSION,
      setBy: updated.serviceDescriptionSetBy ?? actor.name,
      setAt: (updated.serviceDescriptionSetAt ?? setAt).toISOString(),
      validation: await this.revalidate(practiceId, agreementId),
    };
  }

  /** The practice's default, for drafts the PMS gave no appointment type for. */
  async setDefault(
    practiceId: string,
    description: string | null,
    actor: Actor | undefined,
  ): Promise<{ defaultDescription: string | null; mappingVersion: string }> {
    if (!actor) {
      throw new ForbiddenException(
        'A practice setting that decides a particular of every future agreement is recorded against the ' +
          'person who changed it. This request carries no signed-in user, so it is refused.',
      );
    }
    if (description !== null && !isServiceDescription(description)) {
      throw new BadRequestException(
        `The default must be one of the current service-description list (version ${SERVICE_DESCRIPTIONS_VERSION}), or none.`,
      );
    }

    const practice = await this.prisma.withPractice(practiceId, async (tx) => {
      const existing = await tx.practice.findFirst({});
      if (!existing) throw new NotFoundException('Practice not found.');
      const row = await tx.practice.update({
        where: { id: existing.id },
        data: { defaultServiceDescription: description },
      });
      await enqueueVaultEvent(tx, {
        type: 'practice.default_service_description_set',
        actor: { principalType: 'staff', id: actor.id },
        subject: { type: 'Practice', id: existing.id },
        payload: {
          defaultServiceDescription: description ?? '',
          cleared: description === null,
          serviceDescriptionsVersion: SERVICE_DESCRIPTIONS_VERSION,
          setBy: actor.name,
        },
      });
      return row;
    });

    return {
      defaultDescription: practice.defaultServiceDescription,
      mappingVersion: SERVICE_DESCRIPTIONS_VERSION,
    };
  }

  /**
   * Ask the rule set what it makes of the draft now.
   *
   * BEST EFFORT, and it never undoes the write. While the human-authored rule
   * set is unregistered the rules service answers 501, which says nothing
   * about whether the description was a good one — it says the engine is not
   * there. The screen shows "not checked" rather than a false clearance.
   */
  private async revalidate(
    practiceId: string,
    agreementId: string,
  ): Promise<SetServiceDescriptionResult['validation']> {
    const payload = await this.prisma.withPractice(practiceId, async (tx) => {
      const agreement = await tx.agreement.findFirst({ where: { id: agreementId } });
      if (!agreement) return null;
      const patient = await tx.patient.findFirst({ where: { id: agreement.patientId } });
      const provider = agreement.providerId
        ? await tx.provider.findFirst({ where: { id: agreement.providerId } })
        : null;
      const appointment = await tx.appointment.findFirst({ where: { agreementId } });
      const serviceDate = appointment?.date ?? new Date();
      return {
        patientName: patient ? `${patient.givenNames} ${patient.familyName}` : undefined,
        agreementDate: new Date().toISOString().slice(0, 10),
        agreementType: agreement.type,
        providerName: provider?.name,
        providerAddress: provider?.placeOfPracticeAddress ?? undefined,
        serviceDate: serviceDate.toISOString().slice(0, 10),
        basicServiceDescription: agreement.serviceDescription ?? undefined,
        assignorIsPatient: agreement.assignorIsPatient,
      };
    });
    if (!payload) return null;

    try {
      const validation = await this.rules.validate({ payload, stage: 'pre_signature' });
      const c6 = validation.results.find((r: RuleResult) => r.rule === 'C6');
      return {
        ruleSetVersion: validation.ruleSetVersion,
        mappingVersion: validation.mappingVersion,
        // Silence is not a pass: a rule set with no C6 verdict has not answered
        // the question this module exists to close.
        c6: c6?.outcome ?? 'unknown',
        otherFailures: validation.results
          .filter((r: RuleResult) => r.outcome === 'fail' && r.rule !== 'C6')
          .map((r: RuleResult) => r.rule),
      };
    } catch (err) {
      if (err instanceof RulesClientError) return null;
      throw err;
    }
  }
}
