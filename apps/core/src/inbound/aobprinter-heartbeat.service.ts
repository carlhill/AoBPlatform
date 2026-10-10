import { Injectable } from '@nestjs/common';
import type {
  AobPrinterFiledUnconfirmedRow,
  AobPrinterFiledUnconfirmedVerdict,
  AobPrinterHeartbeat,
  AobPrinterHeartbeatReply,
  AobPrinterHostException,
} from '@aobplatform/contracts';
import { AobPrinterHostsService } from '../aobprinter-hosts/aobprinter-hosts.service';
import { InboundPrintJobsService } from './inbound-print-jobs.service';
import { WriteBackCollectionService } from './write-back-collection.service';

/**
 * ONE AOBPRINTER HEARTBEAT (PRINTER-HEARTBEAT.md §3, D-2026-10-10-02).
 *
 * Asks the services that own print jobs and agreements what the platform
 * knows of the prints and returns the host named, records the host (and
 * judges its chain) through `AobPrinterHostsService`, and answers.
 *
 * THE PATIENT IS RESOLVED HERE AND STORED FOR THE CONSOLE, NEVER SENT BACK.
 * A return's exception and a filed-but-unconfirmed return link to their
 * patient on the console (decision 13); the reply to the host carries the
 * agreement id it already had, and nothing more.
 */
@Injectable()
export class AobPrinterHeartbeatService {
  constructor(
    private readonly hosts: AobPrinterHostsService,
    private readonly jobs: InboundPrintJobsService,
    private readonly collection: WriteBackCollectionService,
  ) {}

  async receive(practiceId: string, beat: AobPrinterHeartbeat): Promise<AobPrinterHeartbeatReply> {
    const now = new Date();
    const exceptionAgreements = beat.openExceptions
      .filter((e) => e.direction === 'in' && e.agreementId)
      .map((e) => e.agreementId as string);

    const [jobs, returns, patientOf] = await Promise.all([
      this.jobs.outcomesForHost(practiceId, beat.awaitingOutcome),
      this.collection.statusForHost(practiceId, beat.filedUnconfirmed),
      this.collection.patientsOfAgreements(practiceId, exceptionAgreements),
    ]);

    const exceptions: AobPrinterHostException[] = beat.openExceptions.map((e) => {
      const patientId = e.direction === 'in' && e.agreementId ? patientOf.get(e.agreementId) : undefined;
      return {
        direction: e.direction,
        stage: e.stage,
        reason: e.reason,
        since: e.since,
        ...(e.sourceSha256 ? { sourceSha256: e.sourceSha256 } : {}),
        ...(e.agreementId ? { agreementId: e.agreementId } : {}),
        ...(patientId ? { patientId } : {}),
      };
    });
    /*
     * WRITTEN BACK IS TWO VERDICTS. The host confirms a return only when the
     * platform wrote back the same file (`sha256Matches`); otherwise it keeps
     * it filed (heartbeat.ts `applyReply`). So "reconciles on the next report"
     * is true only of the first, and a different file is said as itself.
     */
    const filedUnconfirmed: AobPrinterFiledUnconfirmedRow[] = beat.filedUnconfirmed.map((f, i) => {
      const status = returns[i];
      const verdict: AobPrinterFiledUnconfirmedVerdict = status.writtenBack
        ? status.sha256Matches
          ? 'written_back'
          : 'written_back_different_file'
        : status.listed
          ? 'offered'
          : 'not_offered';
      return {
        agreementId: f.agreementId,
        sha256: f.sha256,
        verdict,
        patientId: status.patientId,
      };
    });

    const chain = await this.hosts.record(practiceId, { beat, exceptions, filedUnconfirmed }, now);

    return {
      receivedAt: now.toISOString(),
      chain,
      jobs,
      returns: returns.map((r) => ({
        agreementId: r.agreementId,
        writtenBack: r.writtenBack,
        sha256Matches: r.sha256Matches,
        listed: r.listed,
      })),
    };
  }
}
