import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import type { Notice } from '@prisma/client';
import {
  assertMethodFidelity,
  assertNoticeContentComplete,
  dispatchedWithinWindow,
  escalationLevel,
  isWithinNoticeWindow,
  MethodFidelityError,
  noticeDeadline,
  NoticeContentError,
  requiresPostClaimNotice,
  type EnduringPathway,
  type NoticeContent,
  type NoticeDeliveryState,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../messaging/gateway';
import { correctionBody, noticeBody, noticeSubject } from './notice-template';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;

export interface ClaimEventInput {
  agreementId: string;
  claimReference: string;
  /** The 24-hour clock starts HERE. Defaults to now for practice-asserted lodgement. */
  claimLodgedAt?: string;
  serviceDate: string;
  benefitAmountCents: number;
  serviceRecordId?: string;
}

@Injectable()
export class NoticesService {
  private readonly logger = new Logger(NoticesService.name);
  private dispatching = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MESSAGING_GATEWAY) private readonly gateway: MessagingGateway,
  ) {}

  /**
   * Claim intake (FR-6.1). Composes a notice for MyMedicare enduring claims
   * ONLY — aged-care and ACCHO pathways are suppressed by regulation
   * (REQ-END-05), and an episodic claim has no notice obligation at all.
   */
  async recordClaim(practiceId: string, input: ClaimEventInput): Promise<{ noticeRequired: boolean; noticeId?: string }> {
    const claimLodgedAt = input.claimLodgedAt ? new Date(input.claimLodgedAt) : new Date();

    return this.prisma.withPractice(practiceId, async (tx) => {
      const agreement = await tx.agreement.findFirst({ where: { id: input.agreementId } });
      if (!agreement) throw new NotFoundException('Agreement not found.');
      if (agreement.type !== 'enduring') {
        return { noticeRequired: false }; // episodic claims carry no 89AA obligation
      }
      if (!requiresPostClaimNotice(agreement.enduringPathway as EnduringPathway)) {
        // Suppressed by regulation — recorded as a decision, not a silence.
        await enqueueVaultEvent(tx, {
          type: 'notice.composed',
          actor: SYSTEM_ACTOR,
          subject: { type: 'Agreement', id: agreement.id },
          payload: { suppressed: true, reason: 'pathway_not_mymedicare', pathway: agreement.enduringPathway ?? '' },
        });
        return { noticeRequired: false };
      }

      const detail = await tx.enduringDetail.findFirst({ where: { agreementId: agreement.id } });
      if (!detail) throw new BadRequestException('Enduring detail missing — cannot determine the notification method.');
      if (detail.ceasedAt) {
        // Claiming against a ceased agreement is the silent failure mode
        // (Addendum v2 §3.3). Loud, not silent.
        throw new BadRequestException(
          'This enduring agreement has ceased — a claim against it was never validly assigned. Do not notify; investigate.',
        );
      }

      const patient = await tx.patient.findFirst({ where: { id: agreement.patientId } });
      const provider = agreement.providerId
        ? await tx.provider.findFirst({ where: { id: agreement.providerId } })
        : null;

      const content: Partial<NoticeContent> = {
        practitionerName: provider?.name,
        patientName: patient ? `${patient.givenNames} ${patient.familyName}` : undefined,
        serviceDate: input.serviceDate,
        benefitAmountCents: input.benefitAmountCents,
      };
      try {
        assertNoticeContentComplete(content);
      } catch (err) {
        if (err instanceof NoticeContentError) throw new BadRequestException(err.message);
        throw err;
      }

      const notice = await tx.notice.create({
        data: {
          practiceId,
          agreementId: agreement.id,
          serviceRecordId: input.serviceRecordId ?? null,
          claimReference: input.claimReference,
          claimLodgedAt,
          practitionerName: content.practitionerName,
          patientName: content.patientName,
          serviceDate: new Date(input.serviceDate),
          benefitAmountCents: input.benefitAmountCents,
          agreementMethod: detail.notificationMethod,
          payloadHash: createHash('sha256')
            .update(JSON.stringify({ ...content, claimReference: input.claimReference }))
            .digest('hex'),
        },
      });
      await this.recordState(tx, practiceId, notice.id, 'composed', null, {
        deadline: noticeDeadline(claimLodgedAt).toISOString(),
      });
      await enqueueVaultEvent(tx, {
        type: 'notice.composed',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Notice', id: notice.id },
        payload: { agreementId: agreement.id, method: detail.notificationMethod, elementsPresent: 4 },
      });
      return { noticeRequired: true, noticeId: notice.id };
    });
  }

  /** Appends one immutable delivery-evidence row (REQ-DEL-01). */
  private async recordState(
    tx: { noticeDeliveryEvent: { create: (args: any) => Promise<unknown> } },
    practiceId: string,
    noticeId: string,
    state: NoticeDeliveryState,
    channel: string | null,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    await tx.noticeDeliveryEvent.create({
      data: { practiceId, noticeId, state, channel, detail: detail ?? {} },
    });
  }

  /**
   * Dispatches one composed notice. Method fidelity is checked FIRST: sending
   * by any channel other than the one the agreement names breaches reg 89AA
   * even if it arrives (REQ-DEL-02).
   */
  async dispatch(practiceId: string, noticeId: string): Promise<Notice> {
    const prepared = await this.prisma.withPractice(practiceId, async (tx) => {
      const notice = await tx.notice.findFirst({ where: { id: noticeId } });
      if (!notice) throw new NotFoundException('Notice not found.');
      if (notice.dispatchedAt) throw new BadRequestException('Notice already dispatched (REQ-DEL-06).');
      const practice = await tx.practice.findFirst({});
      const patient = await tx.patient.findFirst({ where: { id: (await tx.agreement.findFirst({ where: { id: notice.agreementId } }))!.patientId } });
      return { notice, practiceName: practice?.name ?? 'your practice', patient };
    });

    const { notice, practiceName, patient } = prepared;
    const channel = notice.agreementMethod; // fidelity by construction; asserted below regardless
    try {
      assertMethodFidelity(notice.agreementMethod, channel);
    } catch (err) {
      if (err instanceof MethodFidelityError) throw new BadRequestException(err.message);
      throw err;
    }

    const content: NoticeContent = {
      practitionerName: notice.practitionerName,
      patientName: notice.patientName,
      serviceDate: notice.serviceDate.toISOString().slice(0, 10),
      benefitAmountCents: notice.benefitAmountCents,
    };
    const to = channel === 'email' ? (patient?.email ?? '') : (patient?.mobile ?? '');
    const result = await this.gateway.dispatch({
      channel,
      to,
      subject: noticeSubject(content),
      body: notice.correctionReason
        ? correctionBody(content, practiceName, notice.correctionReason)
        : noticeBody(content, practiceName),
    });

    return this.prisma.withPractice(practiceId, async (tx) => {
      if (!result.accepted) {
        const updated = await tx.notice.update({
          where: { id: noticeId },
          data: {
            failedAt: new Date(),
            failureCode: result.failureCode,
            failureReason: result.failureReason,
            attempts: { increment: 1 },
          },
        });
        await this.recordState(tx, practiceId, noticeId, 'failed', channel, { code: result.failureCode ?? '' });
        await enqueueVaultEvent(tx, {
          type: 'notice.failed',
          actor: SYSTEM_ACTOR,
          subject: { type: 'Notice', id: noticeId },
          payload: { channel, code: result.failureCode ?? '' },
        });
        return updated;
      }

      const dispatchedAt = new Date();
      const updated = await tx.notice.update({
        where: { id: noticeId },
        data: {
          dispatchedAt,
          dispatchChannel: channel,
          gatewayMessageId: result.gatewayMessageId,
          attempts: { increment: 1 },
          failedAt: null,
          failureCode: null,
          failureReason: null,
        },
      });
      await this.recordState(tx, practiceId, noticeId, 'dispatched', channel, {
        gatewayMessageId: result.gatewayMessageId ?? '',
        withinWindow: dispatchedWithinWindow(notice.claimLodgedAt, dispatchedAt),
      });
      await enqueueVaultEvent(tx, {
        type: 'notice.dispatched',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Notice', id: noticeId },
        payload: {
          channel,
          withinWindow: dispatchedWithinWindow(notice.claimLodgedAt, dispatchedAt),
          methodMatchesAgreement: true,
        },
      });
      return updated;
    });
  }

  /** Carrier/SMTP receipt (REQ-DEL-01 'delivered'). */
  async recordDelivered(practiceId: string, noticeId: string): Promise<Notice> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const notice = await tx.notice.findFirst({ where: { id: noticeId } });
      if (!notice) throw new NotFoundException('Notice not found.');
      const updated = await tx.notice.update({ where: { id: noticeId }, data: { deliveredAt: new Date() } });
      await this.recordState(tx, practiceId, noticeId, 'delivered', notice.dispatchChannel, {});
      await enqueueVaultEvent(tx, {
        type: 'notice.delivered',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Notice', id: noticeId },
        payload: { channel: notice.dispatchChannel ?? '' },
      });
      return updated;
    });
  }

  /**
   * Open/read signal. Recorded because it is useful colour; NEVER used to
   * measure compliance (REQ-DEL-07) — see the metrics method, which reports
   * dispatch-within-window and delivery, and leaves read out of the rate.
   */
  async recordRead(practiceId: string, noticeId: string): Promise<Notice> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const notice = await tx.notice.findFirst({ where: { id: noticeId } });
      if (!notice) throw new NotFoundException('Notice not found.');
      const updated = await tx.notice.update({ where: { id: noticeId }, data: { readAt: new Date() } });
      await this.recordState(tx, practiceId, noticeId, 'read', notice.dispatchChannel, {});
      return updated;
    });
  }

  /**
   * REQ-DEL-06 — corrections SUPERSEDE. The original notice is never edited
   * (the database trigger refuses); a new, linked notice carries the
   * corrected content and its own 24-hour clock from awareness.
   */
  async correct(
    practiceId: string,
    noticeId: string,
    input: { reason: string; benefitAmountCents?: number; serviceDate?: string; practitionerName?: string },
  ): Promise<Notice> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const original = await tx.notice.findFirst({ where: { id: noticeId } });
      if (!original) throw new NotFoundException('Notice not found.');
      if (!original.dispatchedAt) {
        throw new BadRequestException('Only a dispatched notice needs correcting — this one has not gone out.');
      }
      const correction = await tx.notice.create({
        data: {
          practiceId,
          agreementId: original.agreementId,
          serviceRecordId: original.serviceRecordId,
          claimReference: original.claimReference,
          // The correction's own window runs from awareness (reg 89AA:
          // "within 24 hours of becoming aware").
          claimLodgedAt: new Date(),
          practitionerName: input.practitionerName ?? original.practitionerName,
          patientName: original.patientName,
          serviceDate: input.serviceDate ? new Date(input.serviceDate) : original.serviceDate,
          benefitAmountCents: input.benefitAmountCents ?? original.benefitAmountCents,
          agreementMethod: original.agreementMethod,
          payloadHash: createHash('sha256')
            .update(JSON.stringify({ supersedes: original.id, reason: input.reason, at: Date.now() }))
            .digest('hex'),
          supersedesNoticeId: original.id,
          correctionReason: input.reason,
        },
      });
      await this.recordState(tx, practiceId, correction.id, 'composed', null, { supersedes: original.id });
      await enqueueVaultEvent(tx, {
        type: 'notice.corrected',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Notice', id: correction.id },
        payload: { supersedes: original.id, reason: input.reason },
      });
      return correction;
    });
  }

  /**
   * Dispatch sweep with in-window fallback (REQ-DEL-04) and escalation at
   * 12/18 hours (REQ-DEL-03). Never lets the window expire silently.
   */
  @Interval(30_000)
  async dispatchSweep(): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const rows = await this.prisma.$queryRaw<Array<{ id: string; practiceId: string; claimLodgedAt: Date }>>`
        SELECT * FROM list_undispatched_notices(50)`;
      for (const row of rows) {
        const level = escalationLevel(row.claimLodgedAt);
        const stillOpen = isWithinNoticeWindow(row.claimLodgedAt);
        try {
          await this.dispatch(row.practiceId, row.id);
        } catch (err) {
          this.logger.warn(`Notice ${row.id} dispatch attempt failed: ${(err as Error).message}`);
        }
        if (!stillOpen) {
          this.logger.error(
            `BREACH (reg 89AA): notice ${row.id} passed its 24-hour window undispatched. ` +
              'This is a compliance exposure, not a revenue one — the claim stands.',
          );
        } else if (level !== null) {
          this.logger.warn(`Notice ${row.id} is ${level}h into its 24-hour window and still undispatched.`);
        }
      }
    } finally {
      this.dispatching = false;
    }
  }

  /**
   * REQ-DEL-08/-09 — the Notification Compliance Pack. This is what a
   * practice hands an auditor: every claim under an enduring agreement, its
   * notice, the delivery evidence, and elapsed time against the 24-hour
   * requirement. Note what the rate is built from: DISPATCH WITHIN WINDOW,
   * never read (REQ-DEL-07).
   */
  async compliancePack(practiceId: string, from?: string, to?: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const notices = await tx.notice.findMany({
        where: {
          claimLodgedAt: {
            gte: from ? new Date(from) : undefined,
            lte: to ? new Date(to) : undefined,
          },
        },
        orderBy: { claimLodgedAt: 'asc' },
      });
      const events = await tx.noticeDeliveryEvent.findMany({
        where: { noticeId: { in: notices.map((n) => n.id) } },
        orderBy: { occurredAt: 'asc' },
      });
      const eventsByNotice = new Map<string, typeof events>();
      for (const event of events) {
        eventsByNotice.set(event.noticeId, [...(eventsByNotice.get(event.noticeId) ?? []), event]);
      }

      const entries = notices.map((notice) => {
        const onTime = dispatchedWithinWindow(notice.claimLodgedAt, notice.dispatchedAt);
        return {
          noticeId: notice.id,
          claimReference: notice.claimReference,
          claimLodgedAt: notice.claimLodgedAt,
          deadline: noticeDeadline(notice.claimLodgedAt),
          dispatchedAt: notice.dispatchedAt,
          elapsedHoursToDispatch: notice.dispatchedAt
            ? Number(((notice.dispatchedAt.getTime() - notice.claimLodgedAt.getTime()) / 3600_000).toFixed(2))
            : null,
          dispatchedWithinWindow: onTime,
          delivered: notice.deliveredAt !== null,
          // Present as colour, explicitly excluded from the rate below.
          readAtEvidentialOnly: notice.readAt,
          failed: notice.failedAt !== null,
          failureCode: notice.failureCode,
          supersedesNoticeId: notice.supersedesNoticeId,
          methodNamedInAgreement: notice.agreementMethod,
          dispatchChannel: notice.dispatchChannel,
          methodFidelityHeld: notice.dispatchChannel === null || notice.dispatchChannel === notice.agreementMethod,
          deliveryEvidence: (eventsByNotice.get(notice.id) ?? []).map((e) => ({
            state: e.state,
            occurredAt: e.occurredAt,
          })),
        };
      });

      const onTimeCount = entries.filter((e) => e.dispatchedWithinWindow).length;
      return {
        practiceId,
        generatedAt: new Date().toISOString(),
        noticeCount: entries.length,
        // REQ-DEL-09: dispatched-within-24h as a percentage. Read rates are
        // deliberately absent — a system scoring itself on reads would report
        // full compliance as failure.
        dispatchedWithinWindowRate: entries.length === 0 ? null : Number((onTimeCount / entries.length).toFixed(3)),
        breaches: entries.filter((e) => !e.dispatchedWithinWindow).map((e) => e.noticeId),
        entries,
      };
    });
  }
}
