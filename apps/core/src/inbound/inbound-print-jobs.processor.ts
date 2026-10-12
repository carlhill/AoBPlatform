import { Injectable } from '@nestjs/common';
import type { Db4JobOutcome, PrintJobEnvelope } from '@aobplatform/contracts';
import type { AutoCaptureSuppressionReason } from '@aobplatform/domain';
import { PrismaService } from '../prisma/prisma.service';
import { PmsSyncService } from '../pms/pms-sync.service';
import { AutoCaptureService } from '../auto-capture/auto-capture.service';
import { Db4AssignmentHandler } from './db4-assignment.handler';

/** What a print job did, written onto the row so it is answerable later. */
export interface PrintJobOutcome {
  patientsMirrored: number;
  providersMirrored: number;
  appointments: { total: number; captured: number; alreadyKnown: number; suppressedByReason: Partial<Record<AutoCaptureSuppressionReason, number>> };
  invoices: { total: number; captured: number; alreadyLinked: number; suppressedByReason: Partial<Record<AutoCaptureSuppressionReason, number>> };
  /**
   * A `db4_assignment` JOB, AND ITS FOUR COUNTERS ABOVE ARE ALL ZERO. That is
   * not an omission: a DB4 never mirrors a person or a provider into the
   * practice, and the zeroes are the evidence
   * (`a_db4_never_mirrors_a_provider_into_the_practice`).
   */
  db4?: Db4JobOutcome;
}

/** A job that took the DB4 path, with its four generic counters honestly at nought. */
function nothingMirrored(): Omit<PrintJobOutcome, 'db4'> {
  return {
    patientsMirrored: 0,
    providersMirrored: 0,
    appointments: { total: 0, captured: 0, alreadyKnown: 0, suppressedByReason: {} },
    invoices: { total: 0, captured: 0, alreadyLinked: 0, suppressedByReason: {} },
  };
}

/**
 * Turns one accepted print job into consequences — the cascade
 * (AutoCaptureService) applied to what the document named.
 *
 * NO NEW DECISIONS HERE. Whether to ask a patient, whether they may be their
 * own assignor, whether they can be reached — all of that is the cascade's,
 * and it is the same cascade whether the appointment came from a PMS API, the
 * mock adapter, or a printed arrival slip. This class only unpacks the
 * envelope, mirrors the people it named, and hands each appointment and
 * invoice over. A print job is a delivery mechanism, not a new kind of truth.
 */
@Injectable()
export class InboundPrintJobsProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pmsSync: PmsSyncService,
    private readonly autoCapture: AutoCaptureService,
    private readonly db4: Db4AssignmentHandler,
  ) {}

  /**
   * ROUTED ON THE DOCUMENT TYPE FIRST, AND THAT SWITCH IS LOAD-BEARING.
   *
   * Everything below it dispatches on CONTENT SHAPE — it mirrors whatever
   * `patients` and `providers` hold and iterates whatever `appointments` and
   * `invoices` hold — which is right for the three generic document types and
   * catastrophic for a DB4: the form names a servicing provider and a payee, so
   * the generic cascade would create TWO provider rows in the practice out of a
   * printed form and then throw the form away. A DB4 goes to its own handler
   * and nowhere near that path.
   */
  async process(practiceId: string, envelope: PrintJobEnvelope, printJobId: string): Promise<PrintJobOutcome> {
    if (envelope.documentType === 'db4_assignment') {
      /*
       * THE JOB ID TRAVELS, and only the DB4 path uses it. The agreement a
       * form becomes records the row it arrived on, so the Signed-DB4 can
       * later be rendered from that very record (D-2026-09-14-02). The three
       * generic document types make no single artefact and have nothing to
       * point at.
       */
      return { ...nothingMirrored(), db4: await this.db4.handle(practiceId, envelope, printJobId) };
    }

    const knownPatients = new Map((envelope.patients ?? []).map((p) => [p.pmsLinkageKey, p]));
    const knownProviders = new Map((envelope.providers ?? []).map((p) => [p.pmsProviderKey, p]));

    // The people first, and committed, so everything after can see them.
    // A patient named on the document but absent from `patients` is still
    // resolved by linkage key if a mirror row already exists.
    let patientsMirrored = 0;
    let providersMirrored = 0;
    await this.prisma.withPractice(practiceId, async (tx) => {
      for (const [key, record] of knownPatients) {
        const before = await tx.patient.findFirst({ where: { pmsLinkageKey: key }, select: { id: true } });
        await this.pmsSync.ensurePatient(tx, practiceId, key, record);
        if (!before) patientsMirrored += 1;
      }
      for (const [key, record] of knownProviders) {
        const before = await tx.provider.findFirst({ where: { pmsLinkageKey: key }, select: { id: true } });
        await this.pmsSync.ensureProvider(tx, practiceId, key, record);
        if (!before) providersMirrored += 1;
      }
    });

    const outcome: PrintJobOutcome = {
      patientsMirrored,
      providersMirrored,
      appointments: { total: 0, captured: 0, alreadyKnown: 0, suppressedByReason: {} },
      invoices: { total: 0, captured: 0, alreadyLinked: 0, suppressedByReason: {} },
    };

    for (const appointment of envelope.appointments ?? []) {
      outcome.appointments.total += 1;
      const result = await this.autoCapture.captureForAppointment(practiceId, appointment, {
        patient: knownPatients.get(appointment.patientLinkageKey),
        provider: knownProviders.get(appointment.providerLinkageKey),
      });
      if (result === 'known') outcome.appointments.alreadyKnown += 1;
      else if (result.captured) outcome.appointments.captured += 1;
      else if ('reason' in result) {
        outcome.appointments.suppressedByReason[result.reason] =
          (outcome.appointments.suppressedByReason[result.reason] ?? 0) + 1;
      }
    }

    for (const invoice of envelope.invoices ?? []) {
      outcome.invoices.total += 1;
      const record = await this.prisma.withPractice(practiceId, async (tx) => {
        const patient = await this.pmsSync.ensurePatient(tx, practiceId, invoice.patientLinkageKey, knownPatients.get(invoice.patientLinkageKey));
        const provider = await this.pmsSync.ensureProvider(tx, practiceId, invoice.providerLinkageKey, knownProviders.get(invoice.providerLinkageKey));
        return this.pmsSync.upsertServiceRecord(tx, practiceId, invoice, patient, provider);
      });
      const recordId = record.id;
      // D-2026-10-10-09 option (b): after the commit, and never at the service's expense.
      if (record.created) await this.pmsSync.associateAfterCommit(practiceId, recordId);
      const result = await this.autoCapture.captureForServiceRecord(practiceId, recordId);
      if (result.captured) outcome.invoices.captured += 1;
      else if ('reason' in result) {
        outcome.invoices.suppressedByReason[result.reason] = (outcome.invoices.suppressedByReason[result.reason] ?? 0) + 1;
      } else outcome.invoices.alreadyLinked += 1;
    }

    return outcome;
  }
}
