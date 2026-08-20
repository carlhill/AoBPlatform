import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  chaseBandFor,
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
  needsAgreement: boolean;
  /** REQ-CHASE-03: confidentiality-flagged patients are excluded from ALL outbound chase. */
  outboundChaseSuppressed: boolean;
  /** Band expired — unbillable, permanently. Close and record, never contact (REQ-CHASE-08). */
  revenueForgone: boolean;
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

      const items: OutstandingItem[] = [];
      for (const record of records) {
        const agreement = record.agreementId ? agreementById.get(record.agreementId) : undefined;
        if (agreement && agreement.status === 'stored') continue; // covered — not outstanding
        const daysRemaining = daysRemainingInLodgementWindow(record.serviceDate);
        const band = chaseBandFor(daysRemaining).band;
        const patient = record.patientId ? patientById.get(record.patientId) : undefined;
        items.push({
          serviceRecordId: record.id,
          serviceDate: record.serviceDate.toISOString().slice(0, 10),
          mbsItemNumbers: record.mbsItemNumbers,
          daysRemaining,
          band,
          agreementId: agreement?.id ?? null,
          agreementStatus: agreement?.status ?? null,
          patientId: record.patientId,
          needsAgreement: !agreement,
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
}
