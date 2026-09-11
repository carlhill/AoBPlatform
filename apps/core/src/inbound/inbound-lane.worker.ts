import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { PrintJobEnvelope } from '@aobplatform/contracts';
import { LANE_POLICIES, type InboundLane } from '@aobplatform/domain';
import { InboundPrintJobsService } from './inbound-print-jobs.service';
import { InboundPrintJobsProcessor } from './inbound-print-jobs.processor';

/**
 * One worker per lane — CONSULTATION-CAPTURE-PLAN.md 9.3.
 *
 * SEPARATE WORKERS, NOT A PRIORITY SORT. A single loop that sorts critical
 * first still spends its time on the bulk lane once the critical lane is
 * empty, and is therefore busy with a 200-row appointment list at the exact
 * moment an arrival slip lands. Three loops, each reading only its own lane,
 * make starvation impossible by construction: the critical worker can never
 * be holding a bulk job. The claim query names the lane and nothing else.
 *
 * CADENCE FROM THE DOMAIN. `LANE_POLICIES` says how often each lane is looked
 * at; the critical lane every second, which puts this hop well inside its
 * five-second SLO. LISTEN/NOTIFY would make it milliseconds and is the
 * recorded upgrade — it needs a raw `pg` connection, a dependency this
 * codebase does not carry, and adding one is a deliberate change rather than a
 * side effect of this item.
 *
 * THE SAME SHAPE AS OutboundWorkerService, including its stated limit: this
 * sweeps practices one at a time and is the single-process form. SKIP LOCKED
 * already allows N workers; only the distribution has to change at volume.
 */
@Injectable()
export class InboundLaneWorkerService {
  private readonly logger = new Logger(InboundLaneWorkerService.name);
  private readonly workerId = `core:${process.pid}`;
  private readonly running: Record<InboundLane, boolean> = { critical: false, standard: false, fyi: false };

  constructor(
    private readonly jobs: InboundPrintJobsService,
    private readonly processor: InboundPrintJobsProcessor,
  ) {}

  // The decorator wants literals; the numbers are the same ones the domain
  // declares, and the test below the policies pins that they agree.
  @Interval(1_000)
  async critical(): Promise<void> {
    await this.sweep('critical');
  }

  @Interval(15_000)
  async standard(): Promise<void> {
    await this.sweep('standard');
  }

  @Interval(60_000)
  async fyi(): Promise<void> {
    await this.sweep('fyi');
  }

  /** One pass over one lane. Public so a test can drive it without waiting on a timer. */
  async sweep(lane: InboundLane): Promise<{ processed: number; failed: number }> {
    if (this.running[lane]) return { processed: 0, failed: 0 };
    this.running[lane] = true;
    let processed = 0;
    let failed = 0;
    try {
      const practices = await this.jobs.duePractices(lane);
      for (const practiceId of practices) {
        const batch = await this.jobs.claim(practiceId, lane, this.workerId, LANE_POLICIES[lane].batch);
        for (const job of batch) {
          try {
            const outcome = await this.processor.process(practiceId, job.payload as unknown as PrintJobEnvelope);
            await this.jobs.markDone(practiceId, job.id, outcome as unknown as Record<string, unknown>);
            processed += 1;
          } catch (err) {
            failed += 1;
            await this.jobs.markFailed(practiceId, job.id, (err as Error).message, isPermanent(err));
          }
        }
      }
    } catch (err) {
      // A sweep that throws must not kill the interval; the next one retries.
      this.logger.error(`Inbound ${lane} sweep failed: ${(err as Error).message}`);
    } finally {
      this.running[lane] = false;
    }
    return { processed, failed };
  }
}

/**
 * A payload that can never work is not retried. The signal is Prisma refusing
 * a value — an invalid date, a string where a UUID belongs — which no amount
 * of waiting changes. Everything else is treated as transient, because a
 * wrongly-retried job costs eight attempts and a wrongly-dead one loses a
 * patient's appointment.
 */
function isPermanent(err: unknown): boolean {
  const message = (err as Error)?.message ?? '';
  return /Invalid value|Invalid `|Expected ISO-8601|invalid input syntax|Invalid Date/i.test(message);
}
