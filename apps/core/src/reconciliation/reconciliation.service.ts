import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  attemptAllowed,
  chaseBandFor,
  chaseNextStep,
  daysRemainingInLodgementWindow,
  VERBAL_FALLBACK_END_DATE,
  type ChaseBand,
} from '@aobplatform/domain';
import { PrismaService } from '../prisma/prisma.service';
import { CaptureService } from '../capture/capture.service';

export interface OutstandingItem {
  serviceRecordId: string;
  serviceDate: string;
  mbsItemNumbers: string[];
  daysRemaining: number;
  band: ChaseBand;
  agreementId: string | null;
  agreementStatus: string | null;
  patientId: string | null;
  /** "P. Nguyen" — initial and family name, as the queue wireframe shows it. Never the full given names in a list. */
  patientName: string | null;
  providerName: string | null;
  /** Which channels could carry a link. The screen picks email first; neither means nobody can be sent anything. */
  patientHasEmail: boolean;
  patientHasMobile: boolean;
  needsAgreement: boolean;
  /**
   * Why the cascade left this to a person (AutoCaptureSuppressionReason), if it
   * did. The word beside the item — "under 14", "no way to reach", "window
   * closed" — so the queue says what is left to do rather than only that
   * something is.
   */
  captureSuppressedReason: string | null;
  captureSuppressedAt: string | null;
  /** REQ-CHASE-03: confidentiality-flagged patients are excluded from ALL outbound chase. */
  outboundChaseSuppressed: boolean;
  /** Band expired — unbillable, permanently. Close and record, never contact (REQ-CHASE-08). */
  revenueForgone: boolean;
}

function shortName(patient: { givenNames: string; familyName: string } | undefined): string | null {
  if (!patient) return null;
  const initial = patient.givenNames.trim().charAt(0);
  return initial ? `${initial}. ${patient.familyName}` : patient.familyName;
}

/**
 * M7 — the core operational screen (REQ-REC-01): every service without a
 * stored agreement, ranked by days remaining on the twelve-month lodgement
 * window, banded per REQ-CHASE-05.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capture: CaptureService,
  ) {}

  async outstanding(practiceId: string): Promise<OutstandingItem[]> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const records = await tx.serviceRecord.findMany({});
      const agreementIds = records.map((r) => r.agreementId).filter((id): id is string => id !== null);
      const agreements = agreementIds.length
        ? await tx.agreement.findMany({ where: { id: { in: agreementIds } } })
        : [];
      const agreementById = new Map(agreements.map((a) => [a.id, a]));
      const patientIds = [...new Set(records.map((r) => r.patientId).filter((id): id is string => id !== null))];
      const patients = patientIds.length ? await tx.patient.findMany({ where: { id: { in: patientIds } } }) : [];
      const patientById = new Map(patients.map((p) => [p.id, p]));
      const providerIds = [...new Set(records.map((r) => r.providerId).filter((id): id is string => id !== null))];
      const providers = providerIds.length ? await tx.provider.findMany({ where: { id: { in: providerIds } } }) : [];
      const providerById = new Map(providers.map((p) => [p.id, p]));

      const items: OutstandingItem[] = [];
      for (const record of records) {
        const agreement = record.agreementId ? agreementById.get(record.agreementId) : undefined;
        if (agreement && agreement.status === 'stored') continue; // covered — not outstanding
        const daysRemaining = daysRemainingInLodgementWindow(record.serviceDate);
        const band = chaseBandFor(daysRemaining).band;
        const patient = record.patientId ? patientById.get(record.patientId) : undefined;
        const provider = record.providerId ? providerById.get(record.providerId) : undefined;
        items.push({
          serviceRecordId: record.id,
          serviceDate: record.serviceDate.toISOString().slice(0, 10),
          mbsItemNumbers: record.mbsItemNumbers,
          daysRemaining,
          band,
          agreementId: agreement?.id ?? null,
          agreementStatus: agreement?.status ?? null,
          patientId: record.patientId,
          patientName: shortName(patient),
          providerName: provider?.name ?? null,
          patientHasEmail: Boolean(patient?.email?.trim()),
          patientHasMobile: Boolean(patient?.mobile?.trim()),
          needsAgreement: !agreement,
          captureSuppressedReason: agreement ? null : record.captureSuppressedReason,
          captureSuppressedAt: agreement ? null : (record.captureSuppressedAt?.toISOString() ?? null),
          outboundChaseSuppressed: patient?.confidentialityFlag ?? false,
          revenueForgone: band === 'expired',
        });
      }
      // Most urgent first — a practice must never discover a lost item from
      // the report alone (REQ-CHASE-12).
      return items.sort((a, b) => a.daysRemaining - b.daysRemaining);
    });
  }

  /**
   * One-click resend (REQ-REC-01). Hard stops, in order: never past the
   * deadline (REQ-CHASE-08); never for a confidentiality-flagged patient
   * (REQ-CHASE-03); and an item with no agreement needs a staff decision
   * about the assignor, not an automatic send.
   */
  async resend(practiceId: string, serviceRecordId: string, channel: string) {
    const record = await this.prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.findFirst({ where: { id: serviceRecordId } }),
    );
    if (!record) throw new NotFoundException('Service record not found.');

    const daysRemaining = daysRemainingInLodgementWindow(record.serviceDate);
    if (chaseBandFor(daysRemaining).band === 'expired') {
      throw new BadRequestException(
        'REQ-CHASE-08: the twelve-month lodgement window has closed — this item is unbillable, permanently. ' +
          'Record it as revenue forgone; a further contact is cost with no possible return.',
      );
    }
    if (record.patientId) {
      const patient = await this.prisma.withPractice(practiceId, (tx) =>
        tx.patient.findFirst({ where: { id: record.patientId! } }),
      );
      if (patient?.confidentialityFlag) {
        throw new BadRequestException(
          'REQ-CHASE-03: confidentiality-flagged patients are excluded from all outbound chase.',
        );
      }
    }
    if (!record.agreementId) {
      throw new BadRequestException(
        'No agreement exists for this service yet — create one (choosing the assignor) before sending a capture link.',
      );
    }
    return this.capture.open(practiceId, { agreementId: record.agreementId, channel });
  }

  /** REQ-MON-01 subset — grows with the metric families as modules land. Exportable by shape (REQ-MON-02). */
  async metrics(practiceId: string) {
    const items = await this.outstanding(practiceId);
    const byBand: Record<ChaseBand, number> = { standard: 0, compressed: 0, urgent: 0, last_chance: 0, expired: 0 };
    for (const item of items) byBand[item.band] += 1;

    return this.prisma.withPractice(practiceId, async (tx) => {
      const storedCount = await tx.agreement.count({ where: { status: 'stored' } });
      const verbalCount = await tx.agreement.count({ where: { status: 'verbal_recorded' } });
      const serviceCount = await tx.serviceRecord.count({});
      const daysToVerbalEnd = Math.ceil(
        (new Date(VERBAL_FALLBACK_END_DATE).getTime() - Date.now()) / 86_400_000,
      );
      return {
        outstanding: items.length,
        byBand,
        revenueForgoneCount: byBand.expired,
        storedAgreements: storedCount,
        serviceRecords: serviceCount,
        captureRate: serviceCount === 0 ? null : Number(((serviceCount - items.length) / serviceCount).toFixed(3)),
        verbalUsage: { count: verbalCount, daysUntilVerbalFallbackEnds: daysToVerbalEnd },
      };
    });
  }

  /**
   * One item, in full — the queue wireframe's R-2: what has been tried, what
   * the band allows, and what comes next.
   *
   * ATTEMPTS ARE WHAT THE RECORDS SAY, not a counter. Every capture request
   * opened for the agreement is an attempt, and every correspondence row
   * about it says whether the message left, arrived or failed. The ladder
   * (REQ-CHASE-05) is read off the band's policy against that count, so the
   * "next step" shown is derived from evidence rather than asserted.
   */
  async detail(practiceId: string, serviceRecordId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const record = await tx.serviceRecord.findFirst({ where: { id: serviceRecordId } });
      if (!record) throw new NotFoundException('Service record not found.');
      const patient = record.patientId ? await tx.patient.findFirst({ where: { id: record.patientId } }) : null;
      const provider = record.providerId ? await tx.provider.findFirst({ where: { id: record.providerId } }) : null;
      const agreement = record.agreementId ? await tx.agreement.findFirst({ where: { id: record.agreementId } }) : null;

      const daysRemaining = daysRemainingInLodgementWindow(record.serviceDate);
      const policy = chaseBandFor(daysRemaining);

      const requests = agreement
        ? await tx.captureRequest.findMany({ where: { agreementId: agreement.id }, orderBy: { createdAt: 'asc' } })
        : [];
      const correspondence = requests.length
        ? await tx.correspondence.findMany({
            where: { subjectType: 'CaptureRequest', subjectId: { in: requests.map((r) => r.id) } },
            orderBy: { queuedAt: 'asc' },
          })
        : [];
      const byRequest = new Map<string, typeof correspondence>();
      for (const c of correspondence) byRequest.set(c.subjectId, [...(byRequest.get(c.subjectId) ?? []), c]);

      const attemptsMade = requests.length;
      return {
        serviceRecordId: record.id,
        serviceDate: record.serviceDate.toISOString().slice(0, 10),
        mbsItemNumbers: record.mbsItemNumbers,
        daysRemaining,
        band: policy.band,
        patient: patient
          ? { id: patient.id, name: `${patient.givenNames} ${patient.familyName}`, hasEmail: Boolean(patient.email), hasMobile: Boolean(patient.mobile), confidentialityFlag: patient.confidentialityFlag }
          : null,
        provider: provider ? { id: provider.id, name: provider.name } : null,
        agreement: agreement
          ? { id: agreement.id, type: agreement.type, status: agreement.status, particularsLocked: agreement.particularsLockedAt !== null, signed: agreement.signatureEventId !== null }
          : null,
        captureSuppressedReason: agreement ? null : record.captureSuppressedReason,
        captureSuppressedAt: agreement ? null : (record.captureSuppressedAt?.toISOString() ?? null),
        policy: {
          band: policy.band,
          attempts: policy.attempts,
          attemptWindowHours: policy.attemptWindowHours,
          escalation: policy.escalation,
          handback: policy.handback,
        },
        attemptsMade,
        attemptAllowed: attemptAllowed({ attemptsMade, daysRemaining }),
        nextStep: chaseNextStep(policy, attemptsMade),
        attempts: requests.map((r) => ({
          captureRequestId: r.id,
          channel: r.channel,
          status: r.status,
          openedAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt?.toISOString() ?? null,
          completedAt: r.completedAt?.toISOString() ?? null,
          messages: (byRequest.get(r.id) ?? []).map((c) => ({
            id: c.id,
            channel: c.channel,
            to: c.to,
            state: c.state,
            subject: c.subject,
            queuedAt: c.queuedAt.toISOString(),
            sentAt: c.sentAt?.toISOString() ?? null,
            deliveredAt: c.deliveredAt?.toISOString() ?? null,
            failedAt: c.failedAt?.toISOString() ?? null,
            failureReason: c.failureReason,
          })),
        })),
      };
    });
  }
}
