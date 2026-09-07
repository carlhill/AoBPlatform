import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PmsAdapter, PmsInvoice, PmsPatientRecord, PmsProvider } from '@aobplatform/contracts';
import type { IsoDate } from '@aobplatform/domain';
import { PrismaService } from '../prisma/prisma.service';
import { PMS_ADAPTER } from './pms.tokens';

/** How far back the invoice sync reaches — past the 12-month lodgement window with margin. */
const SYNC_LOOKBACK_DAYS = 400;

@Injectable()
export class PmsSyncService {
  private readonly logger = new Logger(PmsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PMS_ADAPTER) private readonly adapter: PmsAdapter,
  ) {}

  /**
   * Pulls invoices from the PMS into service records (M7's raw material) and
   * links any already-stored agreement matching practitioner × patient × day
   * (REQ-SCOPE-01). Patients/providers are matched by PMS linkage key and
   * created as minimal mirror rows where absent — the PMS stays the source
   * of truth for who they are (REQ-DATA-10).
   */
  async syncInvoices(practiceId: string): Promise<{ created: number; updated: number; total: number }> {
    if (!this.adapter.capabilities.readInvoices) {
      throw new NotFoundException('The connected PMS adapter does not expose invoices.');
    }
    const since = new Date(Date.now() - SYNC_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10) as IsoDate;
    const invoices = await this.adapter.readInvoices(since);

    let created = 0;
    let updated = 0;
    for (const invoice of invoices) {
      await this.prisma.withPractice(practiceId, async (tx) => {
        const practice = await tx.practice.findFirst({});
        if (!practice) throw new NotFoundException('Practice not found.');

        const patient = await this.ensurePatient(tx, practiceId, invoice.patientLinkageKey);
        const provider = await this.ensureProvider(tx, practiceId, invoice.providerLinkageKey);

        const result = await this.upsertServiceRecord(tx, practiceId, invoice, patient, provider);
        if (result.created) created += 1;
        else updated += 1;
      });
    }
    this.logger.log(`PMS sync for practice ${practiceId}: ${created} created, ${updated} updated`);
    return { created, updated, total: invoices.length };
  }

  /**
   * The mirror row for a PMS patient, created from the live record if absent.
   *
   * EXTRACTED, NOT COPIED, when the appointment sync needed the same thing:
   * two mirrors of "who is this patient" that could drift would defeat the
   * point of the PMS being the source of truth (REQ-DATA-10).
   */
  async ensurePatient(
    tx: Prisma.TransactionClient,
    practiceId: string,
    pmsLinkageKey: string,
    /**
     * The record as the caller already holds it — a print job carries the
     * patient's fields with it (Part 8), so there is nothing to read from a
     * PMS. Used only when no mirror row exists yet.
     */
    known?: PmsPatientRecord,
  ) {
    const existing = await tx.patient.findFirst({ where: { pmsLinkageKey } });
    if (existing) return existing;
    const pmsPatient =
      known ?? (this.adapter.capabilities.readPatient ? await this.adapter.readPatient(pmsLinkageKey) : null);
    if (!pmsPatient) return null;
    return tx.patient.create({
      data: {
        practiceId,
        familyName: pmsPatient.familyName,
        givenNames: pmsPatient.givenNames,
        dateOfBirth: new Date(pmsPatient.dateOfBirth),
        genderAsIdentified: pmsPatient.genderAsIdentified,
        address: pmsPatient.address,
        patientRecordNumber: pmsPatient.patientRecordNumber,
        ihi: pmsPatient.ihi,
        preferredLanguage: pmsPatient.preferredLanguage,
        mobile: pmsPatient.mobile,
        email: pmsPatient.email,
        pmsLinkageKey: pmsPatient.pmsLinkageKey,
      },
    });
  }

  /** The mirror row for a PMS provider, created from the provider list if absent. */
  async ensureProvider(
    tx: Prisma.TransactionClient,
    practiceId: string,
    providerLinkageKey: string,
    known?: PmsProvider,
  ) {
    const existing = await tx.provider.findFirst({ where: { pmsLinkageKey: providerLinkageKey } });
    if (existing) return existing;
    const match =
      known ?? (await this.adapter.readProviders()).find((p) => p.pmsProviderKey === providerLinkageKey);
    if (!match) return null;
    return tx.provider.create({
      data: {
        practiceId,
        name: match.name,
        // Provider type is not observable from the PMS feed — defaulted and
        // corrected at onboarding (FR-1.8). 'other' can never unlock enduring
        // (GP-only is checked at draft time).
        providerType: 'other',
        placeOfPracticeAddress: match.locationAddress,
        providerNumber: match.providerNumber,
        pmsLinkageKey: match.pmsProviderKey,
      },
    });
  }

  /**
   * One invoice → its service record (M7's raw material), created or brought
   * up to date, and linked to an already-stored agreement for practitioner ×
   * patient where one exists (REQ-SCOPE-01).
   *
   * Extracted from the sync loop when print jobs needed the same thing, so an
   * invoice means the same service record whichever way it arrived.
   */
  async upsertServiceRecord(
    tx: Prisma.TransactionClient,
    practiceId: string,
    invoice: PmsInvoice,
    patient: { id: string } | null,
    provider: { id: string } | null,
  ): Promise<{ id: string; created: boolean }> {
    const serviceDate = new Date(invoice.serviceDate);
    const agreement =
      patient && provider
        ? await tx.agreement.findFirst({
            where: { patientId: patient.id, providerId: provider.id, status: 'stored' },
          })
        : null;

    const existing = await tx.serviceRecord.findFirst({ where: { pmsInvoiceKey: invoice.pmsInvoiceKey } });
    if (existing) {
      await tx.serviceRecord.update({
        where: { id: existing.id },
        data: { agreementId: existing.agreementId ?? agreement?.id ?? null },
      });
      return { id: existing.id, created: false };
    }
    const row = await tx.serviceRecord.create({
      data: {
        practiceId,
        pmsInvoiceKey: invoice.pmsInvoiceKey,
        patientId: patient?.id ?? null,
        providerId: provider?.id ?? null,
        serviceDate,
        mbsItemNumbers: [...invoice.mbsItemNumbers],
        agreementId: agreement?.id ?? null,
        // claimEvents unobservable on this adapter — clock defaults
        // conservatively to the service date (REQ-INT-04).
        retentionClockSource: this.adapter.capabilities.claimEvents ? 'observed_claim' : 'conservative_default',
      },
    });
    return { id: row.id, created: true };
  }
}
