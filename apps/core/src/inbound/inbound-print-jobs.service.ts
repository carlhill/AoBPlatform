import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrintJobAccepted, PrintJobEnvelope } from '@aobplatform/contracts';
import {
  LEASE_SECONDS,
  afterFailure,
  afterPermanentFailure,
  laneFor,
  type InboundLane,
  type IsoTimestamp,
} from '@aobplatform/domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The inbound queue — print jobs from a practice's desktop, waiting to be
 * turned into drafts and messages (CONSULTATION-CAPTURE-PLAN.md 8.4, 9.3).
 *
 * FAST-ACCEPT. `ingest` validates, dedups, writes one row and returns. Every
 * practice in the country prints its appointment list at eight o'clock; the
 * endpoint's job is to say "got it" in milliseconds and let the lane workers
 * do the work at the lane's pace. The desktop app's outbox is the other half
 * of that promise — it retries until it hears the 202.
 *
 * THE SAME QUEUE MECHANICS AS OUTBOUND, on purpose: claim with
 * `FOR UPDATE SKIP LOCKED`, lease with an expiry so a dead worker needs no
 * cleanup, backoff and attempt budget from the domain, and a `dead` state that
 * is kept rather than deleted — a print job we could not process is the
 * record that a practice told us something and we failed to act on it.
 */
@Injectable()
export class InboundPrintJobsService {
  private readonly logger = new Logger(InboundPrintJobsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Accept a job. The lane comes from the document type — declared in the
   * domain, never chosen by the caller, so a desktop cannot mark its own
   * bulk work urgent.
   *
   * A DUPLICATE IS NOT AN ERROR. The same document printed twice (a reprint,
   * a retry after a lost 202) is the same job, and the honest answer is "yes,
   * already have it" with the existing id — the outbox on the desktop can
   * then stop retrying.
   */
  async ingest(
    practiceId: string,
    envelope: PrintJobEnvelope,
    credential: { kind: 'device' | 'practice'; deviceId?: string | null } = { kind: 'practice' },
  ): Promise<PrintJobAccepted> {
    const lane: InboundLane = laneFor(envelope.documentType);
    const sourceSha256 = envelope.sourceSha256.toLowerCase();
    const where = { practiceId, documentType: envelope.documentType, sourceSha256 };

    const asAccepted = (row: { id: string; lane: string; receivedAt: Date }, duplicate: boolean): PrintJobAccepted => ({
      id: row.id,
      lane: row.lane as InboundLane,
      duplicate,
      receivedAt: row.receivedAt.toISOString() as IsoTimestamp,
    });

    // Look first. Cheap, and it answers the common reprint without an error.
    const existing = await this.prisma.withPractice(practiceId, (tx) => tx.inboundPrintJob.findFirst({ where }));
    if (existing) return asAccepted(existing, true);

    try {
      const row = await this.prisma.withPractice(practiceId, (tx) =>
        tx.inboundPrintJob.create({
          data: {
            practiceId,
            deviceId: credential.deviceId ?? null,
            credentialKind: credential.kind,
            documentType: envelope.documentType,
            lane,
            pms: envelope.pms,
            parserTemplateVersion: envelope.parserTemplateVersion,
            sourceSha256,
            payload: envelope as unknown as Prisma.InputJsonValue,
          },
        }),
      );
      return asAccepted(row, false);
    } catch (err) {
      /*
       * Two desktops racing on the same document: the unique index refuses the
       * second insert. Resolved in a FRESH transaction — Postgres aborts the
       * one the error happened in, and a query inside it would only throw
       * again ("current transaction is aborted").
       */
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.prisma.withPractice(practiceId, (tx) => tx.inboundPrintJob.findFirst({ where }));
        if (raced) return asAccepted(raced, true);
      }
      throw err;
    }
  }

  /** Practices with work on a lane — through the SECURITY DEFINER function; see the migration for why. */
  async duePractices(lane: InboundLane, limit = 200): Promise<string[]> {
    // Cast both arguments: overload resolution on a parameterised call is not
    // guaranteed to land on (text, integer), and a miss is a silent empty sweep.
    const rows = await this.prisma.$queryRaw<Array<{ practiceId: string }>>`
      SELECT "practiceId" FROM core.inbound_due_practices(${lane}::text, ${limit}::int)
    `;
    return rows.map((r) => r.practiceId);
  }

  /** Lease a batch on one lane for one practice. Identical in shape to OutboundService.claim. */
  async claim(practiceId: string, lane: InboundLane, workerId: string, limit: number) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE core.inbound_print_jobs SET
          "state" = 'leased',
          "leasedBy" = ${workerId},
          "leaseExpiresAt" = now() + make_interval(secs => ${LEASE_SECONDS}::double precision)
        WHERE "id" IN (
          SELECT "id" FROM core.inbound_print_jobs
          WHERE "practiceId" = ${practiceId}::uuid
            AND "lane" = ${lane}
            AND (
              ("state" IN ('pending', 'failed') AND "availableAt" <= now())
              OR ("state" = 'leased' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= now()))
            )
          ORDER BY "availableAt"
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        RETURNING "id"
      `;
      if (rows.length === 0) return [];
      return tx.inboundPrintJob.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
    });
  }

  async markDone(practiceId: string, id: string, outcome: Record<string, unknown>) {
    return this.prisma.withPractice(practiceId, (tx) =>
      tx.inboundPrintJob.update({
        where: { id },
        data: {
          state: 'done',
          processedAt: new Date(),
          outcome: outcome as Prisma.InputJsonValue,
          leasedBy: null,
          leaseExpiresAt: null,
          lastError: null,
        },
      }),
    );
  }

  /**
   * It could not be processed. `permanent` is for a payload that can never
   * work (a date that is not a date); everything else backs off and retries,
   * because the usual cause is the database or a dependency having a moment.
   */
  async markFailed(practiceId: string, id: string, error: string, permanent = false) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const job = await tx.inboundPrintJob.findFirst({ where: { id } });
      if (!job) return null;
      const outcome = permanent ? afterPermanentFailure(job) : afterFailure(job, new Date());
      const updated = await tx.inboundPrintJob.update({
        where: { id },
        data: {
          state: outcome.state,
          attempts: outcome.attempts,
          availableAt: outcome.availableAt ?? job.availableAt,
          lastError: error.slice(0, 2000),
          leasedBy: null,
          leaseExpiresAt: null,
        },
      });
      if (outcome.exhausted) {
        // Loud: a practice told us something and we could not act on it.
        this.logger.error(
          `ALERT: inbound ${job.documentType} job ${id} (lane ${job.lane}) for practice ${practiceId} is DEAD after ` +
            `${outcome.attempts} attempts. Last error: ${error.slice(0, 200)}`,
        );
      }
      return updated;
    });
  }

  /** Per-lane depth, age of the oldest waiting job, and dead count — REQ-MON-01 families (9.3). */
  async metrics(practiceId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const rows = await tx.inboundPrintJob.groupBy({
        by: ['lane', 'state'],
        _count: { _all: true },
        _min: { receivedAt: true },
      });
      const now = Date.now();
      const byLane: Record<string, { waiting: number; oldestWaitingSeconds: number | null; done: number; dead: number; failed: number }> =
        {};
      for (const r of rows) {
        const lane = (byLane[r.lane] ??= { waiting: 0, oldestWaitingSeconds: null, done: 0, dead: 0, failed: 0 });
        if (r.state === 'pending' || r.state === 'leased') {
          lane.waiting += r._count._all;
          if (r._min.receivedAt) {
            const age = Math.round((now - r._min.receivedAt.getTime()) / 1000);
            lane.oldestWaitingSeconds = Math.max(lane.oldestWaitingSeconds ?? 0, age);
          }
        } else if (r.state === 'done') lane.done += r._count._all;
        else if (r.state === 'dead') lane.dead += r._count._all;
        else if (r.state === 'failed') lane.failed += r._count._all;
      }
      return { byLane };
    });
  }
}
