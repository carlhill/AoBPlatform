import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { EnduringDetail } from '@prisma/client';
import {
  anniversaryWarningBand,
  assertEnduringAllowed,
  daysUntilAnniversary,
  hasAnniversaryFuse,
  HardRuleViolation,
  needsFourteenthBirthdayAction,
  terminationEffectiveDate,
  triggerAppliesTo,
  type AutomaticCessationTrigger,
  type BusinessDayCalendar,
  type CessationReason,
  type EnduringPathway,
  type ProviderType,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;

/**
 * ⚠ PUBLIC HOLIDAYS ARE NOT WIRED IN. Termination is 2 BUSINESS days
 * (REQ-OFF-03) and business days depend on STATE public holidays — a Friday
 * notice before a long weekend lands differently in each state. data.gov.au
 * publishes the dataset; ingesting it is an unbuilt job. Until then the
 * calculation is weekend-only, which is WRONG NEAR EVERY PUBLIC HOLIDAY, and
 * every termination records which calendar produced its date so the gap is
 * visible in the evidence rather than hidden.
 */
const WEEKEND_ONLY_CALENDAR: BusinessDayCalendar = {
  publicHolidays: new Set(),
  state: 'UNKNOWN_weekend_only_no_holiday_data',
};

export interface CreateEnduringInput {
  agreementId: string;
  notificationMethod: string;
  notificationAlternate?: string;
  terminationMethod: string;
  responsiblePersonBasis?: string;
  scopeType: string;
  scopeValues: string[];
  patientDeclarationAt?: string;
}

@Injectable()
export class EnduringService {
  private readonly logger = new Logger(EnduringService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * FR-5.1 — create the reg 65CB detail for an enduring agreement.
   * GP-only is re-asserted here even though the draft path already checked
   * it: this is the record that makes the agreement operative.
   */
  async create(practiceId: string, input: CreateEnduringInput): Promise<EnduringDetail> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const agreement = await tx.agreement.findFirst({ where: { id: input.agreementId } });
      if (!agreement) throw new NotFoundException('Agreement not found.');
      if (agreement.type !== 'enduring') {
        throw new BadRequestException('Only an enduring agreement carries reg 65CB detail.');
      }
      if (agreement.anchorKind === 'provider') {
        const provider = await tx.provider.findFirst({ where: { id: agreement.providerId! } });
        if (!provider) throw new NotFoundException('Provider not found.');
        try {
          assertEnduringAllowed(provider.providerType as ProviderType, agreement.enduringPathway as EnduringPathway);
        } catch (err) {
          if (err instanceof HardRuleViolation) throw new BadRequestException(err.message);
          throw err;
        }
      }
      const existing = await tx.enduringDetail.findFirst({ where: { agreementId: input.agreementId } });
      if (existing) throw new BadRequestException('This agreement already has enduring detail.');

      const detail = await tx.enduringDetail.create({
        data: {
          practiceId,
          agreementId: input.agreementId,
          notificationMethod: input.notificationMethod,
          notificationAlternate: input.notificationAlternate ?? null,
          terminationMethod: input.terminationMethod,
          responsiblePersonBasis: input.responsiblePersonBasis ?? null,
          patientDeclarationAt: input.patientDeclarationAt ? new Date(input.patientDeclarationAt) : null,
          scopeType: input.scopeType,
          scopeValues: input.scopeValues,
          enteredIntoAt: new Date(),
        },
      });
      await enqueueVaultEvent(tx, {
        type: 'agreement.status_changed',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Agreement', id: input.agreementId },
        payload: {
          enduringDetailCreated: true,
          pathway: agreement.enduringPathway ?? '',
          notificationMethod: input.notificationMethod,
          scopeType: input.scopeType,
          scopeItemCount: input.scopeValues.length,
        },
      });
      return detail;
    });
  }

  /**
   * REQ-END-06a — the scope preview. "Once agreed, the provider is required
   * to bulk bill for any future in-scope services until terminated." That is
   * a COMMERCIAL COMMITMENT, not an admin convenience, so the practice sees
   * exactly what it is committing to before signature.
   */
  async scopePreview(practiceId: string, agreementId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const detail = await tx.enduringDetail.findFirst({ where: { agreementId } });
      if (!detail) throw new NotFoundException('Enduring detail not found.');
      return {
        agreementId,
        scopeType: detail.scopeType,
        scopeValues: detail.scopeValues,
        itemCount: detail.scopeValues.length,
        commitment:
          'Once this agreement is in effect, this provider must bulk bill the patient for any in-scope ' +
          'service until it is terminated. Changing the scope means terminating this agreement and creating ' +
          'a new one (REQ-END-06b) — it is not an edit.',
      };
    });
  }

  /**
   * REQ-END-06 — termination by either party, effective 2 BUSINESS days after
   * written notice. The patient may terminate even where somebody else
   * entered the agreement on their behalf, so `initiatedBy` never gates on
   * who signed.
   */
  async terminate(
    practiceId: string,
    agreementId: string,
    input: { initiatedBy: 'patient' | 'assignor' | 'provider' | 'practice'; reason?: CessationReason },
  ): Promise<EnduringDetail> {
    const noticeAt = new Date();
    const effectiveAt = terminationEffectiveDate(noticeAt, WEEKEND_ONLY_CALENDAR);

    return this.prisma.withPractice(practiceId, async (tx) => {
      const detail = await tx.enduringDetail.findFirst({ where: { agreementId } });
      if (!detail) throw new NotFoundException('Enduring detail not found.');
      if (detail.ceasedAt) throw new BadRequestException('This agreement has already ceased.');
      if (detail.terminationNoticeAt) throw new BadRequestException('Termination notice has already been given.');

      const updated = await tx.enduringDetail.update({
        where: { id: detail.id },
        data: {
          terminationNoticeAt: noticeAt,
          terminationEffectiveAt: effectiveAt,
          terminationCalendarState: WEEKEND_ONLY_CALENDAR.state,
          cessationReason:
            input.reason ??
            (input.initiatedBy === 'patient'
              ? 'patient_terminated'
              : input.initiatedBy === 'assignor'
                ? 'assignor_terminated'
                : 'provider_terminated'),
        },
      });
      await enqueueVaultEvent(tx, {
        type: 'agreement.terminated',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Agreement', id: agreementId },
        payload: {
          initiatedBy: input.initiatedBy,
          noticeAt: noticeAt.toISOString(),
          effectiveAt: effectiveAt.toISOString(),
          businessDayCalendar: WEEKEND_ONLY_CALENDAR.state,
        },
      });
      return updated;
    });
  }

  /**
   * Automatic cessation (65CA(8)). Each trigger is checked against the
   * pathway it can actually apply to — `hospital_admission` is not a trigger
   * at all and must never become one (65CA(9)).
   */
  async cease(
    practiceId: string,
    agreementId: string,
    trigger: AutomaticCessationTrigger,
  ): Promise<EnduringDetail> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const agreement = await tx.agreement.findFirst({ where: { id: agreementId } });
      if (!agreement) throw new NotFoundException('Agreement not found.');
      const detail = await tx.enduringDetail.findFirst({ where: { agreementId } });
      if (!detail) throw new NotFoundException('Enduring detail not found.');
      if (!triggerAppliesTo(trigger, agreement.enduringPathway as EnduringPathway)) {
        throw new BadRequestException(
          `Trigger "${trigger}" does not apply to the ${agreement.enduringPathway} pathway (65CA(8)).`,
        );
      }
      const ceasedAt = new Date();
      const updated = await tx.enduringDetail.update({
        where: { id: detail.id },
        data: { ceasedAt, cessationReason: trigger },
      });
      await tx.agreement.update({ where: { id: agreementId }, data: { status: 'ceased' } });
      await enqueueVaultEvent(tx, {
        type: 'agreement.ceased',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Agreement', id: agreementId },
        payload: { trigger, automatic: true, pathway: agreement.enduringPathway ?? '' },
      });
      this.logger.warn(
        `Enduring agreement ${agreementId} ceased automatically (${trigger}). ` +
          'Any claim lodged against it after this point was never validly assigned.',
      );
      return updated;
    });
  }

  /**
   * FR-5.5 — coverage query. "Is service S for patient P by practitioner X
   * covered by an active enduring agreement?" Used by the capture cascade's
   * first stage and by reconciliation.
   */
  async coverage(practiceId: string, query: { patientId: string; providerId?: string; at?: string }) {
    const at = query.at ? new Date(query.at) : new Date();
    return this.prisma.withPractice(practiceId, async (tx) => {
      const agreements = await tx.agreement.findMany({
        where: { type: 'enduring', patientId: query.patientId, providerId: query.providerId },
      });
      const details = await tx.enduringDetail.findMany({
        where: { agreementId: { in: agreements.map((a) => a.id) } },
      });
      const detailByAgreement = new Map(details.map((d) => [d.agreementId, d]));
      const covering = agreements.filter((agreement) => {
        const detail = detailByAgreement.get(agreement.id);
        if (!detail) return false;
        if (detail.ceasedAt && detail.ceasedAt <= at) return false;
        if (detail.terminationEffectiveAt && detail.terminationEffectiveAt <= at) return false;
        return true;
      });
      return {
        covered: covering.length > 0,
        agreementIds: covering.map((a) => a.id),
        at: at.toISOString(),
      };
    });
  }

  /** REQ-END-03 — anniversary fuse pipeline: what is due to blow, and when. */
  async anniversaryPipeline(practiceId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const details = await tx.enduringDetail.findMany({ where: { ceasedAt: null } });
      return details
        .map((detail) => ({
          agreementId: detail.agreementId,
          enteredIntoAt: detail.enteredIntoAt.toISOString().slice(0, 10),
          hasFuse: hasAnniversaryFuse(detail.enteredIntoAt),
          daysUntilAnniversary: daysUntilAnniversary(detail.enteredIntoAt),
          warningBand: anniversaryWarningBand(detail.enteredIntoAt),
          registered: detail.registeredAt !== null,
          // D-11: no registration mechanism has been published anywhere.
          // Tracked and warned on; nothing speculative is built.
          registrationMechanism: 'unpublished (decision D-11) — track only',
        }))
        .filter((row) => row.hasFuse && !row.registered)
        .sort((a, b) => a.daysUntilAnniversary - b.daysUntilAnniversary);
    });
  }

  /**
   * REQ-OFF-13 — the 14th-birthday job. Deterministic from date of birth, so
   * there is no excuse for missing it. Prompts the PRACTICE 30 days ahead;
   * never notifies the former assignor with anything that discloses the
   * patient's new autonomy (REQ-CHILD-05).
   */
  @Interval(6 * 3600_000)
  async fourteenthBirthdaySweep(): Promise<void> {
    const rows = await this.prisma.$queryRaw<Array<{ practiceId: string }>>`
      SELECT DISTINCT "practiceId" FROM enduring_details WHERE "ceasedAt" IS NULL`;
    for (const { practiceId } of rows) {
      const due = await this.fourteenthBirthdayDue(practiceId);
      for (const item of due) {
        this.logger.warn(
          `Patient turning ${item.turns14On} is covered by agreement ${item.agreementId} they are not party to — ` +
            're-paper before the birthday (REQ-OFF-13); the agreement ceases automatically at 14.',
        );
      }
    }
  }

  async fourteenthBirthdayDue(practiceId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const details = await tx.enduringDetail.findMany({ where: { ceasedAt: null } });
      const agreements = await tx.agreement.findMany({
        where: { id: { in: details.map((d) => d.agreementId) } },
      });
      const patients = await tx.patient.findMany({ where: { id: { in: agreements.map((a) => a.patientId) } } });
      const patientById = new Map(patients.map((p) => [p.id, p]));

      return agreements
        .filter((agreement) => {
          const patient = patientById.get(agreement.patientId);
          return patient ? needsFourteenthBirthdayAction(patient.dateOfBirth, agreement.assignorIsPatient) : false;
        })
        .map((agreement) => {
          const patient = patientById.get(agreement.patientId)!;
          const birthday = new Date(patient.dateOfBirth);
          birthday.setUTCFullYear(birthday.getUTCFullYear() + 14);
          return { agreementId: agreement.id, patientId: patient.id, turns14On: birthday.toISOString().slice(0, 10) };
        });
    });
  }
}
