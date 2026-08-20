import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { PmsAdapter } from '@aobplatform/contracts';
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

        let patient = await tx.patient.findFirst({ where: { pmsLinkageKey: invoice.patientLinkageKey } });
        if (!patient && this.adapter.capabilities.readPatient) {
          const pmsPatient = await this.adapter.readPatient(invoice.patientLinkageKey);
          if (pmsPatient) {
            patient = await tx.patient.create({
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
        }

        let provider = await tx.provider.findFirst({ where: { pmsLinkageKey: invoice.providerLinkageKey } });
        if (!provider) {
          const pmsProviders = await this.adapter.readProviders();
          const match = pmsProviders.find((p) => p.pmsProviderKey === invoice.providerLinkageKey);
          if (match) {
            provider = await tx.provider.create({
              data: {
                practiceId,
                name: match.name,
                // Provider type is not observable from the PMS invoice feed —
                // defaulted and corrected at onboarding (FR-1.8). 'other' can
                // never unlock enduring (GP-only is checked at draft time).
                providerType: 'other',
                placeOfPracticeAddress: match.locationAddress,
                providerNumber: match.providerNumber,
                pmsLinkageKey: match.pmsProviderKey,
              },
            });
          }
        }

        // An already-stored agreement for practitioner × patient × day links up.
        const serviceDate = new Date(invoice.serviceDate);
        const agreement =
          patient && provider
            ? await tx.agreement.findFirst({
                where: {
                  patientId: patient.id,
                  providerId: provider.id,
                  status: 'stored',
                },
              })
            : null;

        const existing = await tx.serviceRecord.findFirst({ where: { pmsInvoiceKey: invoice.pmsInvoiceKey } });
        if (existing) {
          await tx.serviceRecord.update({
            where: { id: existing.id },
            data: { agreementId: existing.agreementId ?? agreement?.id ?? null },
          });
          updated += 1;
        } else {
          await tx.serviceRecord.create({
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
          created += 1;
        }
      });
    }
    this.logger.log(`PMS sync for practice ${practiceId}: ${created} created, ${updated} updated`);
    return { created, updated, total: invoices.length };
  }
}
