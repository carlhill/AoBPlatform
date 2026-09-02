import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PmsAdapter } from '@aobplatform/contracts';
import {
  autoAssignorDecision,
  chaseBandFor,
  daysRemainingInLodgementWindow,
  remoteChannelFor,
  type AutoCaptureSuppressionReason,
  type IsoDate,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { PMS_ADAPTER } from '../pms/pms.tokens';
import { PmsSyncService } from '../pms/pms-sync.service';
import { AgreementsService } from '../agreements/agreements.service';
import { CaptureService } from '../capture/capture.service';
import { EnduringService } from '../enduring/enduring.service';
import { OutboundService } from '../outbound/outbound.service';
import { CaptureLinkDispatcher } from './capture-link.dispatcher';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;

type Outcome =
  | { captured: true; agreementId: string }
  | { captured: false; reason: AutoCaptureSuppressionReason }
  | { captured: false; alreadyLinked: string };

type ReasonTally = Partial<Record<AutoCaptureSuppressionReason, number>>;

/**
 * The capture cascade, run by the platform with nobody at the practice
 * deciding first — CONSULTATION-CAPTURE-PLAN.md Parts 2 and 3.
 *
 * TWO TRIGGERS, ONE SHAPE. An appointment arrives and a pre-agreement should
 * be waiting on the kiosk when the patient reaches the desk. An invoice
 * arrives with no agreement behind it and a post-agreement should reach the
 * patient before the lodgement window closes. In both cases the questions are
 * the same and are asked in the same order: is anybody allowed to be
 * contacted, is there already an agreement, may the patient be their own
 * assignor, and can we reach them.
 *
 * WHEN THE ANSWER IS NO, IT IS RECORDED. Every branch that decides not to ask
 * writes a `capture.suppressed` event naming the reason, and the reason is
 * tallied into the response. "Why was this patient never asked" is a question
 * the evidence has to answer, and a `continue` statement does not.
 *
 * IN PHASES, NOT ONE TRANSACTION — and the reason is worth stating because
 * the single-transaction version was written first and failed. The services
 * this leans on (`AgreementsService.createDraft`, `CaptureService.open`) each
 * open their OWN transaction, because they own the domain guards and are
 * called from controllers that way. A row created inside a transaction here is
 * invisible to them until it commits: the assignor "did not exist" and the
 * draft was refused. So the decision phase commits first, then the draft is
 * asked for, then the link is written AT ONCE — so that a crash anywhere after
 * leaves a record WITH an agreement and the existing resend path, never a
 * record that looks untouched and gets a second draft on the next sync.
 *
 * WHAT IT DOES NOT DO. It does not lock particulars — that needs the rules
 * engine and happens when the patient is in front of the agreement. It does
 * not sign, verify or store anything. It drafts, it opens a request, and it
 * makes sure a message goes out.
 */
@Injectable()
export class AutoCaptureService {
  private readonly logger = new Logger(AutoCaptureService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PMS_ADAPTER) private readonly adapter: PmsAdapter,
    private readonly pmsSync: PmsSyncService,
    private readonly agreements: AgreementsService,
    private readonly capture: CaptureService,
    private readonly enduring: EnduringService,
    private readonly outbound: OutboundService,
    private readonly links: CaptureLinkDispatcher,
  ) {}

  // -------------------------------------------------------------------------
  // POST-consultation: an invoice with nothing behind it
  // -------------------------------------------------------------------------

  /**
   * What `POST /pms/sync` now means: mirror the invoices, then ask every
   * patient we have just learned we need to ask.
   */
  async syncInvoicesAndCapture(practiceId: string) {
    const sync = await this.pmsSync.syncInvoices(practiceId);

    const orphans = await this.prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.findMany({ where: { agreementId: null }, orderBy: { serviceDate: 'asc' } }),
    );

    let captured = 0;
    let suppressed = 0;
    const suppressedByReason: ReasonTally = {};
    for (const record of orphans) {
      const outcome = await this.captureForServiceRecord(practiceId, record.id);
      if (outcome.captured) captured += 1;
      else if ('reason' in outcome) {
        suppressed += 1;
        suppressedByReason[outcome.reason] = (suppressedByReason[outcome.reason] ?? 0) + 1;
      }
    }

    this.logger.log(
      `Auto-capture after invoice sync for ${practiceId}: ${captured} patient(s) asked, ${suppressed} suppressed.`,
    );
    return { ...sync, captured, suppressed, suppressedByReason };
  }

  /**
   * One orphan service record → a post-agreement the patient is asked to
   * approve, or a recorded reason why not.
   */
  async captureForServiceRecord(practiceId: string, serviceRecordId: string): Promise<Outcome> {
    // PHASE 1 — decide, and commit. Everything that follows must be able to
    // see the assignor this creates.
    const plan = await this.prisma.withPractice(practiceId, async (tx) => {
      const record = await tx.serviceRecord.findFirst({ where: { id: serviceRecordId } });
      if (!record) throw new NotFoundException('Service record not found.');
      if (record.agreementId) return { go: false as const, outcome: { captured: false as const, alreadyLinked: record.agreementId } };

      const suppress = async (reason: AutoCaptureSuppressionReason, extra: Record<string, unknown> = {}) => ({
        go: false as const,
        outcome: await this.suppress(tx, practiceId, { type: 'ServiceRecord', id: record.id }, reason, {
          serviceDate: record.serviceDate.toISOString().slice(0, 10),
          ...extra,
        }),
      });

      // REQ-CHASE-08 first: past the window the item is unbillable, permanently,
      // and a message about it is cost with no possible return.
      const daysRemaining = daysRemainingInLodgementWindow(record.serviceDate);
      if (chaseBandFor(daysRemaining).band === 'expired') return suppress('window_closed', { daysRemaining });

      const patient = record.patientId ? await tx.patient.findFirst({ where: { id: record.patientId } }) : null;
      if (!patient) return suppress('patient_unresolved');
      const provider = record.providerId ? await tx.provider.findFirst({ where: { id: record.providerId } }) : null;
      if (!provider) return suppress('provider_unresolved');

      // REQ-CHASE-03: no outbound contact of any kind.
      if (patient.confidentialityFlag) return suppress('confidentiality_flag');

      // Already covered — an episodic agreement would be a second consent for
      // a service the enduring one already assigns. Link it so the item leaves
      // the reconciliation queue, and say so.
      const coverage = await this.enduring.coverage(practiceId, { patientId: patient.id, providerId: provider.id });
      if (coverage.covered) {
        await tx.serviceRecord.update({ where: { id: record.id }, data: { agreementId: coverage.agreementIds[0] } });
        return suppress('enduring_covered', { coveringAgreementId: coverage.agreementIds[0] });
      }

      // D7 — is the patient their own assignor? Only when that is not a choice.
      const decision = autoAssignorDecision({ dateOfBirth: patient.dateOfBirth, at: new Date() });
      if (!decision.auto) return suppress('assignor_needs_human', { why: decision.reason });

      // And can we reach them? A draft nobody could act on would only hide the
      // item from the queue where a person would otherwise see it.
      const channel = remoteChannelFor(patient);
      if (!channel) return suppress('no_contact_channel');

      const assignor = await this.selfAssignorFor(tx, practiceId, patient);
      const practice = await tx.practice.findFirst({});
      return {
        go: true as const,
        record,
        patient,
        provider,
        channel,
        assignorId: assignor.id,
        practiceName: practice?.name ?? 'your practice',
      };
    });
    if (!plan.go) return plan.outcome;

    // PHASE 2 — the draft, through the service that owns the guards.
    const draft = await this.agreements.createDraft(practiceId, {
      type: 'episodic_post',
      providerId: plan.provider.id,
      patientId: plan.patient.id,
      assignorId: plan.assignorId,
      assignorIsPatient: true,
    });

    // PHASE 3 — link AT ONCE. From here a crash leaves a record with an
    // agreement and the resend path, never one that gets drafted twice.
    await this.prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.update({ where: { id: plan.record.id }, data: { agreementId: draft.id } }),
    );

    // PHASE 4 — open the request, and queue the message that carries it.
    const opened = await this.capture.open(practiceId, { agreementId: draft.id, channel: plan.channel });
    if (!opened.token) throw new Error('A remote capture request was opened without a token.');

    await this.prisma.withPractice(practiceId, (tx) =>
      this.links.sendPostAgreementLink(tx, {
        practiceId,
        practiceName: plan.practiceName,
        patient: plan.patient,
        providerName: plan.provider.name,
        serviceDate: plan.record.serviceDate,
        mbsItemNumbers: plan.record.mbsItemNumbers,
        captureRequestId: opened.captureRequestId,
        channel: plan.channel,
        token: opened.token!,
        expiresAt: opened.expiresAt,
      }),
    );

    return { captured: true, agreementId: draft.id };
  }

  // -------------------------------------------------------------------------
  // PRE-consultation: an appointment on the book
  // -------------------------------------------------------------------------

  /**
   * Today's appointments → a pre-agreement waiting for each patient before
   * they arrive, queued for the kiosk to pick up.
   *
   * Idempotent on the PMS's own appointment key: the morning list and an
   * arrival slip for the same patient are the same appointment, and one
   * appointment never opens two requests.
   */
  async syncAppointments(practiceId: string, date?: IsoDate) {
    if (!this.adapter.capabilities.readAppointments) {
      throw new NotFoundException('The connected PMS adapter does not expose appointments.');
    }
    const day = date ?? (new Date().toISOString().slice(0, 10) as IsoDate);
    const appointments = await this.adapter.readAppointments(day);

    let created = 0;
    let captured = 0;
    let suppressed = 0;
    let alreadyKnown = 0;
    const suppressedByReason: ReasonTally = {};

    for (const appointment of appointments) {
      const outcome = await this.captureForAppointment(practiceId, appointment);
      if (outcome === 'known') {
        alreadyKnown += 1;
        continue;
      }
      created += 1;
      if (outcome.captured) captured += 1;
      else if ('reason' in outcome) {
        suppressed += 1;
        suppressedByReason[outcome.reason] = (suppressedByReason[outcome.reason] ?? 0) + 1;
      }
    }

    this.logger.log(
      `Appointment sync for ${practiceId} on ${day}: ${appointments.length} read, ${created} new, ` +
        `${captured} pre-agreement(s) queued for the kiosk, ${suppressed} suppressed, ${alreadyKnown} already known.`,
    );
    return { date: day, total: appointments.length, created, captured, suppressed, suppressedByReason, alreadyKnown };
  }

  private async captureForAppointment(
    practiceId: string,
    appointment: { pmsAppointmentKey: string; patientLinkageKey: string; providerLinkageKey: string; date: IsoDate; time?: string },
  ): Promise<Outcome | 'known'> {
    // PHASE 1 — mirror, record the appointment, decide; commit.
    const plan = await this.prisma.withPractice(practiceId, async (tx) => {
      const existing = await tx.appointment.findFirst({
        where: { practiceId, pmsAppointmentKey: appointment.pmsAppointmentKey },
      });
      if (existing) return { go: false as const, outcome: 'known' as const };

      const patient = await this.pmsSync.ensurePatient(tx, practiceId, appointment.patientLinkageKey);
      const provider = await this.pmsSync.ensureProvider(tx, practiceId, appointment.providerLinkageKey);

      const row = await tx.appointment.create({
        data: {
          practiceId,
          pmsAppointmentKey: appointment.pmsAppointmentKey,
          patientId: patient?.id ?? null,
          providerId: provider?.id ?? null,
          date: new Date(appointment.date),
          time: appointment.time ?? null,
        },
      });

      const suppress = async (reason: AutoCaptureSuppressionReason, extra: Record<string, unknown> = {}) => ({
        go: false as const,
        outcome: await this.suppress(tx, practiceId, { type: 'Appointment', id: row.id }, reason, {
          appointmentDate: appointment.date,
          ...extra,
        }),
      });

      if (!patient) return suppress('patient_unresolved');
      if (!provider) return suppress('provider_unresolved');
      // A flagged patient is not asked at the desk either — the kiosk showing
      // their name to whoever walks up is the exposure the flag exists to prevent.
      if (patient.confidentialityFlag) return suppress('confidentiality_flag');

      const coverage = await this.enduring.coverage(practiceId, { patientId: patient.id, providerId: provider.id });
      if (coverage.covered) {
        await tx.appointment.update({ where: { id: row.id }, data: { agreementId: coverage.agreementIds[0] } });
        return suppress('enduring_covered', { coveringAgreementId: coverage.agreementIds[0] });
      }

      const decision = autoAssignorDecision({ dateOfBirth: patient.dateOfBirth, at: new Date() });
      if (!decision.auto) return suppress('assignor_needs_human', { why: decision.reason });

      const assignor = await this.selfAssignorFor(tx, practiceId, patient);
      return { go: true as const, row, patient, provider, assignorId: assignor.id };
    });
    if (!plan.go) return plan.outcome;

    // PHASE 2 — the draft, through the service that owns the guards.
    const draft = await this.agreements.createDraft(practiceId, {
      type: 'episodic_pre',
      providerId: plan.provider.id,
      patientId: plan.patient.id,
      assignorId: plan.assignorId,
      assignorIsPatient: true,
    });

    // PHASE 3 — link at once, for the same reason as the invoice path.
    await this.prisma.withPractice(practiceId, (tx) =>
      tx.appointment.update({ where: { id: plan.row.id }, data: { agreementId: draft.id } }),
    );

    // PHASE 4 — the in-practice request, and the kiosk's copy of it.
    const opened = await this.capture.open(practiceId, { agreementId: draft.id, channel: 'in_practice' });

    /*
     * FOR THE KIOSK. The outbound queue already has a channel for exactly
     * this: `device` — "addressed to whichever tablet at that practice comes
     * for it", pulled rather than pushed, no destination up front. The payload
     * is what a screen needs to show a name and start the ceremony, and
     * nothing more: no DOB, no address, no identifiers.
     */
    const patientName = `${plan.patient.givenNames} ${plan.patient.familyName}`;
    await this.prisma.withPractice(practiceId, (tx) =>
      this.outbound.enqueue(tx, {
        practiceId,
        channel: 'device',
        destination: null,
        mediaType: 'json',
        subjectType: 'CaptureRequest',
        subjectId: opened.captureRequestId,
        recipientType: 'patient',
        recipientId: plan.patient.id,
        recipientName: patientName,
        payload: {
          kind: 'pre_agreement',
          agreementId: draft.id,
          captureRequestId: opened.captureRequestId,
          appointmentId: plan.row.id,
          patientName,
          providerName: plan.provider.name,
          appointmentDate: appointment.date,
          appointmentTime: appointment.time ?? null,
        },
      }),
    );

    return { captured: true, agreementId: draft.id };
  }

  // -------------------------------------------------------------------------

  /**
   * The patient as their own assignor — found if one already exists for this
   * person, created otherwise. `Assignor` has no link to `Patient` (an
   * assignor is often NOT the patient), so "the same person" is name plus
   * date of birth plus `authorityBasis: 'self'` within the practice.
   */
  private async selfAssignorFor(
    tx: Prisma.TransactionClient,
    practiceId: string,
    patient: { givenNames: string; familyName: string; dateOfBirth: Date },
  ) {
    const name = `${patient.givenNames} ${patient.familyName}`;
    const existing = await tx.assignor.findFirst({
      where: { practiceId, authorityBasis: 'self', name, dateOfBirth: patient.dateOfBirth },
    });
    if (existing) return existing;
    return tx.assignor.create({
      data: { practiceId, name, dateOfBirth: patient.dateOfBirth, authorityBasis: 'self' },
    });
  }

  private async suppress(
    tx: Prisma.TransactionClient,
    practiceId: string,
    subject: { type: string; id: string },
    reason: AutoCaptureSuppressionReason,
    detail: Record<string, unknown>,
  ): Promise<{ captured: false; reason: AutoCaptureSuppressionReason }> {
    await enqueueVaultEvent(tx, {
      type: 'capture.suppressed',
      actor: SYSTEM_ACTOR,
      subject,
      payload: { reason, practiceId, ...detail },
    });
    return { captured: false, reason };
  }
}
