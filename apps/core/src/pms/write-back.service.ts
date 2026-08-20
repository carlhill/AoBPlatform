import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { PmsAdapter } from '@aobplatform/contracts';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { PMS_ADAPTER } from './pms.tokens';
import { RendererRegistry } from '../render/renderer-registry';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;
/** FR-9.3: alert on any stored artefact not in the PMS after this long. */
export const WRITE_BACK_ALERT_AFTER_MS = 4 * 3600 * 1000;
export const WRITE_BACK_SWEEP_INTERVAL_MS = 60_000;

/**
 * Write-back is the product (REQ-INT-02): the signed artefact lands in the
 * PMS patient record. Attempted inline at storage; the sweep retries
 * anything unwritten (idempotent by artefact hash) and alerts on staleness.
 */
@Injectable()
export class WriteBackService {
  private readonly logger = new Logger(WriteBackService.name);
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PMS_ADAPTER) private readonly adapter: PmsAdapter,
    private readonly renderers: RendererRegistry,
  ) {}

  /** Attempts write-back for one stored agreement. Failure is non-fatal — the sweep retries. */
  async attempt(practiceId: string, agreementId: string): Promise<boolean> {
    if (!this.adapter.capabilities.writeArtefact) return false;
    try {
      return await this.prisma.withPractice(practiceId, async (tx) => {
        const agreement = await tx.agreement.findFirst({ where: { id: agreementId } });
        if (!agreement || agreement.status !== 'stored' || agreement.writtenBackAt) return false;
        if (!agreement.particulars || !agreement.renderedArtefactHash) return false;
        const patient = await tx.patient.findFirst({ where: { id: agreement.patientId } });
        if (!patient?.pmsLinkageKey) {
          // No linkage into the PMS record — cannot land the artefact where
          // an auditor looks. Left unwritten; surfaced by the staleness alert.
          return false;
        }
        // Rule 13: re-render with the version that produced the artefact; refuse on hash mismatch.
        const renderer = this.renderers.get(agreement.rendererVersion);
        if (!renderer) {
          this.logger.error(`Renderer ${agreement.rendererVersion} not registered — write-back refused.`);
          return false;
        }
        const rendered = await renderer.render(
          agreement.particulars as Record<string, unknown>,
          agreement.renderedLanguages,
        );
        if (rendered.sha256 !== agreement.renderedArtefactHash) {
          this.logger.error(`Render determinism violation on agreement ${agreementId} — write-back refused.`);
          return false;
        }
        const result = await this.adapter.writeArtefact({
          patientLinkageKey: patient.pmsLinkageKey,
          artefact: new Uint8Array(rendered.bytes),
          artefactSha256: rendered.sha256,
          filename: `aob-agreement-${agreementId}${rendered.mediaType === 'application/pdf' ? '.pdf' : '.json'}`,
          description: 'Signed Assignment of Benefit agreement (AoBPlatform)',
        });
        await tx.agreement.update({
          where: { id: agreementId },
          data: { writtenBackAt: new Date(), pmsDocumentKey: result.pmsDocumentKey ?? null },
        });
        await enqueueVaultEvent(tx, {
          type: 'agreement.written_back',
          actor: SYSTEM_ACTOR,
          subject: { type: 'Agreement', id: agreementId },
          payload: { pms: this.adapter.pms, artefactSha256: rendered.sha256, deduplicated: !result.written },
        });
        return true;
      });
    } catch (err) {
      this.logger.warn(`Write-back failed for agreement ${agreementId}: ${(err as Error).message}`);
      return false;
    }
  }

  /** Retry sweep + staleness alert (FR-9.3). Cross-practice via the narrow SECURITY DEFINER function. */
  @Interval(WRITE_BACK_SWEEP_INTERVAL_MS)
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const rows = await this.prisma.$queryRaw<Array<{ id: string; practiceId: string; createdAt: Date }>>`
        SELECT * FROM list_unwritten_stored_agreements(50)`;
      for (const row of rows) {
        const written = await this.attempt(row.practiceId, row.id);
        if (!written && Date.now() - row.createdAt.getTime() > WRITE_BACK_ALERT_AFTER_MS) {
          this.logger.error(
            `ALERT (FR-9.3): stored agreement ${row.id} has not reached the PMS for over ` +
              `${Math.round(WRITE_BACK_ALERT_AFTER_MS / 3600000)}h.`,
          );
        }
      }
    } finally {
      this.sweeping = false;
    }
  }
}
