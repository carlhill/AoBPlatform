import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { parseRetentionYears, retentionExpiryFor } from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';

/** The transport row, as much of it as evidence needs. */
export interface OutboundLike {
  id: string;
  practiceId: string | null;
  channel: string;
  mediaType: string;
  destination: string | null;
  subjectType: string;
  subjectId: string;
  payload: unknown;
  recipientType: string | null;
  recipientId: string | null;
  recipientName: string | null;
  state: string;
  createdAt: Date;
  sentAt: Date | null;
}

/**
 * The evidence twin of every send — CONSULTATION-CAPTURE-PLAN.md Part 4.
 *
 * CALLED FROM INSIDE THE SENDER'S TRANSACTION, never after it. A message that
 * left with no record, or a record of a message that never left, are the two
 * failures this exists to rule out, and only "same transaction" rules out
 * both. Every method takes the caller's `tx`.
 *
 * IDEMPOTENT BY CONSTRUCTION: keyed on the transport row (`outboundItemId`)
 * or the notice (`noticeId`), both unique, and written with an upsert whose
 * update is empty — a retried enqueue produces one row, not two.
 *
 * WHAT IT COPIES. Subject, text and HTML as sent, the address at the time,
 * and the PERSON it was for (recipientId) so that a changed address does not
 * orphan history. The retention expiry is stamped at write time from the
 * configured `RETENTION_YEARS` (Part 5: parameterised, never inlined), so the
 * sweep never has to guess what the rule was when the row was made.
 */
@Injectable()
export class CorrespondenceService {
  private readonly logger = new Logger(CorrespondenceService.name);
  private readonly retentionYears: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const parsed = parseRetentionYears(config.get<string>('RETENTION_YEARS'));
    if (parsed.reason) {
      // A typo in an environment file must not quietly change what the platform keeps.
      this.logger.warn(`RETENTION_YEARS ignored (${parsed.reason}) — using ${parsed.years} years.`);
    }
    this.retentionYears = parsed.years;
  }

  /** Two years from now, as configured. Exposed so other writers stamp the same rule. */
  expiryFrom(anchor: Date): Date {
    return retentionExpiryFor(anchor, this.retentionYears);
  }

  /** Mirror a transport row that was just written. Same transaction as the enqueue. */
  async recordForOutbound(tx: Prisma.TransactionClient, item: OutboundLike) {
    const payload = (item.payload ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    const state = item.state === 'sent' ? 'sent' : item.state === 'dead' ? 'dead' : item.state === 'failed' ? 'failed' : 'queued';
    return tx.correspondence.upsert({
      where: { outboundItemId: item.id },
      create: {
        practiceId: item.practiceId,
        recipientType: item.recipientType,
        recipientId: item.recipientId,
        recipientName: item.recipientName,
        to: item.destination,
        channel: item.channel,
        mediaType: item.mediaType,
        // A kiosk payload has no subject; its kind is the nearest honest label.
        subject: str(payload.subject) ?? str(payload.kind),
        bodyText: str(payload.body),
        bodyHtml: str(payload.html),
        sentBy: str(payload.sentBy),
        subjectType: item.subjectType,
        subjectId: item.subjectId,
        outboundItemId: item.id,
        state,
        queuedAt: item.createdAt,
        sentAt: item.sentAt,
        retentionExpiryDate: this.expiryFrom(item.sentAt ?? item.createdAt),
      },
      update: {},
    });
  }

  /** The transport reports it went. */
  async markSent(tx: Prisma.TransactionClient, outboundItemId: string, at: Date) {
    await tx.correspondence.updateMany({
      where: { outboundItemId },
      data: { state: 'sent', sentAt: at, failedAt: null, failureReason: null },
    });
  }

  /** The transport reports it did not — this time (`failed`) or ever (`dead`). */
  async markFailed(tx: Prisma.TransactionClient, outboundItemId: string, reason: string, dead: boolean) {
    await tx.correspondence.updateMany({
      where: { outboundItemId },
      data: { state: dead ? 'dead' : 'failed', failedAt: new Date(), failureReason: reason.slice(0, 2000) },
    });
  }

  /**
   * Mirror a reg 89AA notice at dispatch. The notice keeps its own statutory
   * table; this is the row that lets one screen show it beside everything else.
   */
  async recordForNotice(
    tx: Prisma.TransactionClient,
    input: {
      noticeId: string;
      practiceId: string;
      patientId: string;
      patientName: string;
      to: string;
      channel: string;
      subject: string;
      bodyText: string;
      accepted: boolean;
      failureReason?: string | null;
      at: Date;
    },
  ) {
    return tx.correspondence.upsert({
      where: { noticeId: input.noticeId },
      create: {
        practiceId: input.practiceId,
        recipientType: 'patient',
        recipientId: input.patientId,
        recipientName: input.patientName,
        to: input.to,
        channel: input.channel,
        mediaType: input.channel === 'email' ? 'email' : 'text',
        subject: input.subject,
        bodyText: input.bodyText,
        sentBy: 'aobplatform',
        subjectType: 'Notice',
        subjectId: input.noticeId,
        noticeId: input.noticeId,
        state: input.accepted ? 'sent' : 'failed',
        queuedAt: input.at,
        sentAt: input.accepted ? input.at : null,
        failedAt: input.accepted ? null : input.at,
        failureReason: input.accepted ? null : (input.failureReason ?? null),
        retentionExpiryDate: this.expiryFrom(input.at),
      },
      // A retried dispatch after a failure: the row now says it went.
      update: input.accepted ? { state: 'sent', sentAt: input.at, failedAt: null, failureReason: null } : {},
    });
  }

  async markDeliveredForNotice(tx: Prisma.TransactionClient, noticeId: string, at: Date) {
    await tx.correspondence.updateMany({ where: { noticeId }, data: { state: 'delivered', deliveredAt: at } });
  }

  /**
   * Retention tombstone (Part 5): the text goes, the row stays — that a message
   * was sent, to whom and about what remains evidence. Caller owns the scope
   * (practice or practitioner). Refuses a hold; a no-op once already removed.
   */
  async tombstone(tx: Prisma.TransactionClient, id: string, now: Date): Promise<boolean> {
    const row = await tx.correspondence.findFirst({
      where: { id },
      select: { id: true, legalHold: true, contentRemovedAt: true, retentionExpiryDate: true, subjectType: true, subjectId: true },
    });
    if (!row || row.legalHold || row.contentRemovedAt) return false;
    await tx.correspondence.update({ where: { id }, data: { bodyText: null, bodyHtml: null, contentRemovedAt: now } });
    await enqueueVaultEvent(tx, {
      type: 'retention.crypto_shredded',
      actor: { principalType: 'system', id: 'core' },
      subject: { type: 'Correspondence', id },
      payload: {
        action: 'content_removed',
        reason: 'retention_expired',
        retentionExpiryDate: row.retentionExpiryDate?.toISOString().slice(0, 10) ?? '',
        // The clock is the send itself, an observed moment — never a defaulted one (REQ-INT-04).
        retentionClockSource: 'sent_at',
        aboutType: row.subjectType,
        aboutId: row.subjectId,
      },
    });
    return true;
  }

  private static readonly LIST_SELECT = {
    id: true,
    recipientType: true,
    recipientId: true,
    recipientName: true,
    to: true,
    channel: true,
    mediaType: true,
    subject: true,
    bodyText: true,
    sentBy: true,
    subjectType: true,
    subjectId: true,
    state: true,
    queuedAt: true,
    sentAt: true,
    deliveredAt: true,
    failedAt: true,
    failureReason: true,
    retentionExpiryDate: true,
    legalHold: true,
    contentRemovedAt: true,
  } as const;

  /**
   * WHICH ATTEMPT EACH CAPTURE MESSAGE WAS.
   *
   * The design's M-1 distinguishes "Capture link" from "Reminder 2" — the same
   * row type, told apart by how many went before it about the same agreement.
   * Nothing stores that, because nothing needs to: the correspondence rows are
   * the record and the ordinal is a reading of them.
   *
   * The join to capture_requests is a READ, inside the practice's own RLS
   * scope, exactly as `ReconciliationService` reads correspondence the other
   * way round. Rows about anything else get no ordinal.
   */
  private async withAttempts<T extends { subjectType: string; subjectId: string; queuedAt: Date }>(
    tx: Prisma.TransactionClient,
    rows: T[],
  ): Promise<Array<T & { attempt: number | null }>> {
    const captureIds = rows.filter((r) => r.subjectType === 'CaptureRequest').map((r) => r.subjectId);
    if (captureIds.length === 0) return rows.map((r) => ({ ...r, attempt: null }));

    const requests = await tx.captureRequest.findMany({
      where: { id: { in: captureIds } },
      select: { id: true, agreementId: true },
    });
    const agreementOf = new Map(requests.map((r) => [r.id, r.agreementId]));

    // Oldest first inside each agreement, so the first send is attempt 1.
    const ordinal = new Map<string, number>();
    const counted = new Map<string, number>();
    for (const row of [...rows].sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime())) {
      const agreementId = agreementOf.get(row.subjectId);
      if (!agreementId) continue;
      const next = (counted.get(agreementId) ?? 0) + 1;
      counted.set(agreementId, next);
      ordinal.set(`${row.subjectId}:${row.queuedAt.getTime()}`, next);
    }
    return rows.map((r) => ({ ...r, attempt: ordinal.get(`${r.subjectId}:${r.queuedAt.getTime()}`) ?? null }));
  }

  /** The practice's own correspondence — practice-scoped, newest first (plan §4.2). */
  async listForPractice(practiceId: string, limit = 100) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const rows = await tx.correspondence.findMany({
        orderBy: { queuedAt: 'desc' },
        take: limit,
        select: CorrespondenceService.LIST_SELECT,
      });
      return this.withAttempts(tx, rows);
    });
  }

  /**
   * The patient's half of the same log — the design's P-1 Messages tab.
   *
   * ONE QUERY, TWO AUDIENCES. Same table, same rows, same shaping; the only
   * difference is the WHERE. Scoped to the patient by their id inside the
   * practice's own RLS scope, so there is no cross-practice read here and no
   * SECURITY DEFINER function needed — the caller has already been resolved to
   * one practice by the token they hold.
   *
   * NO COST FIELD, and there would be nothing to send if there were: what a
   * message cost the practice is the practice's business (design, M-1).
   */
  async listForPatient(practiceId: string, patientId: string, limit = 100) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const rows = await tx.correspondence.findMany({
        where: { recipientType: 'patient', recipientId: patientId },
        orderBy: { queuedAt: 'desc' },
        take: limit,
        select: CorrespondenceService.LIST_SELECT,
      });
      return this.withAttempts(tx, rows);
    });
  }

  /**
   * A practitioner's messages across every practice — through the SECURITY
   * DEFINER function; the doctor's view (plan §4.2). Same row shape as the
   * outbound-backed function it replaces, so the screen does not change.
   */
  async forPractitioner(practitionerId: string, limit = 100) {
    return this.prisma.$queryRaw<
      Array<{
        id: string;
        practiceName: string;
        channel: string;
        mediaType: string;
        state: string;
        occurredAt: Date;
        sentAt: Date | null;
        subject: string | null;
        body: string | null;
        sentBy: string | null;
      }>
    >`SELECT * FROM core.practitioner_correspondence_detail(${practitionerId}::uuid, ${limit}::int)`;
  }
}
