import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { OutboundService } from './outbound.service';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../messaging/gateway';

/**
 * Drains the outbound queue.
 *
 * WITHOUT THIS THE QUEUE IS A DRAWER. Items were being enqueued correctly and
 * nothing was taking them out, which from a practice's point of view is
 * identical to the bug it was meant to fix: no email arrives.
 *
 * DELIBERATELY DULL. It claims a small batch, tries each one, and records what
 * happened. All the interesting decisions — backoff, attempt budget, what
 * counts as permanent, when a lease expires — live in the domain where they
 * are tested. This loop should stay boring enough that nobody needs to read it
 * twice.
 *
 * ⚠ THIS IS THE SINGLE-PROCESS SHAPE. It sweeps practices one at a time,
 * which is correct up to a few thousand practices and will not hold at the
 * volume Carl models. At 750,000 notices a day the right shape is N workers
 * claiming across practices with a bounded batch each — and the claim query
 * already supports that, because SKIP LOCKED does not care how many workers
 * there are. What has to change is only how work is DISTRIBUTED, not how it is
 * claimed. Recorded here rather than in a document nobody opens.
 *
 * PUSH CHANNELS ONLY. `device` items are pulled by a kiosk and must never be
 * drained here — a worker "delivering" them would mark as sent something no
 * screen ever showed anybody.
 */
@Injectable()
export class OutboundWorkerService {
  private readonly logger = new Logger(OutboundWorkerService.name);
  private readonly workerId = `core:${process.pid}`;
  /** Guards against a slow sweep overlapping the next tick. */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbound: OutboundService,
    @Optional() @Inject(MESSAGING_GATEWAY) private readonly gateway?: MessagingGateway,
  ) {}

  @Interval(15_000)
  async sweep(): Promise<void> {
    if (this.running) return;
    if (!this.gateway) return; // No gateway configured: nothing can be sent, so nothing is claimed.
    this.running = true;
    try {
      /*
       * Which practices have work.
       *
       * THROUGH A SECURITY DEFINER FUNCTION, and this is not incidental. RLS
       * on outbound_items is fail-closed and FORCEd, so a query with no
       * app.practice_id returns ZERO ROWS — which is precisely what happened
       * when this swept directly: it saw nothing, every notice sat pending,
       * and the practice waited for an email that was never going to come.
       *
       * The alternative was to let the worker run unscoped, which would mean
       * weakening RLS on the table holding the CONTENT of patient notices.
       * That is the worst table in the system to open up, so it stays closed
       * and this narrow function is the only way through. It returns practice
       * ids and counts — never a payload, destination or subject — and every
       * line after it runs inside withPractice() like the rest of the system.
       */
      const practices = await this.prisma.$queryRaw<Array<{ practiceId: string }>>`
        SELECT "practiceId" FROM core.outbound_due_practices(200)
      `;

      for (const { practiceId } of practices) {
        for (const channel of ['email', 'sms', 'webhook']) {
          const items = await this.outbound.claim(practiceId, channel, this.workerId, 25);
          for (const item of items) {
            await this.deliver(practiceId, item);
          }
        }
      }
    } catch (err) {
      // A sweep that throws must not kill the interval; the next one retries.
      this.logger.error(`Outbound sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async deliver(
    practiceId: string,
    item: { id: string; channel: string; destination: string | null; payload: unknown },
  ): Promise<void> {
    try {
      if (item.channel !== 'email') {
        /*
         * Not built yet, and it says so rather than pretending. Marked
         * permanently failed so it stops immediately instead of retrying eight
         * times to discover the same thing — and so the dead row is a visible
         * request for the channel rather than a silent backlog.
         */
        await this.outbound.markFailed(
          practiceId,
          item.id,
          `The ${item.channel} channel has no gateway yet.`,
          true,
        );
        return;
      }
      if (!item.destination) {
        await this.outbound.markFailed(practiceId, item.id, 'No destination.', true);
        return;
      }

      const payload = (item.payload ?? {}) as Record<string, unknown>;
      /*
       * THE PAYLOAD IS ALREADY A COMPOSED EMAIL. Composition happens at
       * enqueue time, where the caller knows what the message is about and
       * has the composer to hand. The worker deliberately knows nothing about
       * wording — it moves bytes.
       */
      const result = await this.gateway!.dispatch({
        channel: 'email',
        to: item.destination,
        subject: String(payload.subject ?? 'AoBPlatform'),
        body: String(payload.body ?? ''),
        html: typeof payload.html === 'string' ? payload.html : undefined,
      });

      if (result.accepted) {
        await this.outbound.markSent(practiceId, item.id, result.gatewayMessageId);
      } else {
        /*
         * A 5xx-shaped refusal is worth retrying; a rejected address is not.
         * Without the gateway telling us which, the safe default is transient
         * — a wrongly-retried message costs eight attempts, a wrongly-dead one
         * loses a statutory notice.
         */
        await this.outbound.markFailed(
          practiceId,
          item.id,
          result.failureReason ?? 'Refused by the gateway.',
          result.failureCode === 'invalid_address',
        );
      }
    } catch (err) {
      await this.outbound.markFailed(practiceId, item.id, (err as Error).message);
    }
  }
}
