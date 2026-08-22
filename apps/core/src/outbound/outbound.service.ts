import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  MAX_PAYLOAD_BYTES,
  OutboundQueueError,
  afterFailure,
  afterPermanentFailure,
  assertQueueable,
  idempotencyKey,
  isPullChannel,
  leaseSecondsFor,
} from '@aobplatform/domain';
import type { Prisma } from '@prisma/client';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../auth/actor.decorator';

/**
 * The outbound queue.
 *
 * READ THE HEADER OF packages/domain/src/outbound-queue.ts for why this
 * exists. In one line: a notice is evidence, and evidence must not evaporate
 * because a provider was down for twenty minutes.
 *
 * THE ENQUEUE TAKES A TRANSACTION, and that is the single most important thing
 * about this class. A caller writes its Notice row and enqueues the dispatch
 * in the SAME transaction, so it is impossible to end up with a notice nobody
 * sent, or a send with no notice behind it. Every other design — a broker, a
 * job server, an in-memory list — reintroduces both failures and then needs an
 * outbox table to fix them, which is exactly this table.
 */
@Injectable()
export class OutboundService {
  private readonly logger = new Logger(OutboundService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Queue something to leave the platform.
   *
   * TAKES THE TRANSACTION rather than opening its own. See the class comment —
   * this is the whole point, not a convenience.
   *
   * IDEMPOTENT BY CONSTRUCTION. The unique key means a caller that retries
   * after a crash — or two racing requests — produce one row, not two. Re-sending
   * a statutory notice is not a duplicate email; it is a second assertion that
   * notice was given.
   */
  async enqueue(
    tx: Prisma.TransactionClient,
    input: {
      practiceId: string;
      channel: string;
      destination?: string | null;
      subjectType: string;
      subjectId: string;
      payload: Record<string, unknown>;
      /** Distinguishes a deliberate re-send from a retry of the same send. */
      attemptGroup?: string;
      /** Hold it until this time. Used for scheduled reminders. */
      availableAt?: Date;
    },
  ) {
    const serialised = JSON.stringify(input.payload ?? {});
    let channel;
    try {
      channel = assertQueueable({
        channel: input.channel,
        payloadBytes: Buffer.byteLength(serialised, 'utf8'),
        destination: input.destination,
      });
    } catch (err) {
      if (err instanceof OutboundQueueError) throw new BadRequestException(err.message);
      throw err;
    }

    const key = idempotencyKey({
      practiceId: input.practiceId,
      channel,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      attemptGroup: input.attemptGroup,
    });

    /*
     * upsert rather than create, so a caller retrying a whole transaction does
     * not fail on the unique key. The update is deliberately EMPTY: an item
     * already queued must not be reset, rescheduled or have its attempt count
     * cleared by a duplicate enqueue.
     */
    return tx.outboundItem.upsert({
      where: { practiceId_idempotencyKey: { practiceId: input.practiceId, idempotencyKey: key } },
      create: {
        practiceId: input.practiceId,
        channel,
        destination: input.destination ?? null,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        payload: input.payload as Prisma.InputJsonValue,
        idempotencyKey: key,
        availableAt: input.availableAt ?? new Date(),
      },
      update: {},
    });
  }

  /**
   * Take up to `limit` items for this channel, leasing them.
   *
   * `FOR UPDATE SKIP LOCKED` is what makes this safe with many workers and no
   * coordinator. Each transaction locks the rows it selects and SKIPS any
   * another worker already holds, so two workers never take the same item and
   * neither waits for the other. It is the reason this queue needs no broker.
   *
   * A LEASED ROW WHOSE LEASE HAS EXPIRED IS INCLUDED, which is the recovery
   * path for a worker that died mid-send. Nothing detects the death; the lease
   * simply stops being true. The consequence — an item may be sent twice if
   * the first send succeeded and the worker died before recording it — is why
   * this is honestly at-least-once, and why the payload carries an idempotency
   * key for the provider.
   */
  async claim(practiceId: string, channel: string, workerId: string, limit = 50) {
    const leaseSeconds = leaseSecondsFor(channel);
    return this.prisma.withPractice(practiceId, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE core.outbound_items SET
          "state" = 'leased',
          "leasedBy" = ${workerId},
          "leaseExpiresAt" = now() + make_interval(secs => ${leaseSeconds}::double precision)
        WHERE "id" IN (
          SELECT "id" FROM core.outbound_items
          WHERE "practiceId" = ${practiceId}::uuid
            AND "channel" = ${channel}
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
      return tx.outboundItem.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
    });
  }

  /** It went. Records when, and the provider's reference if there was one. */
  async markSent(practiceId: string, id: string, providerRef?: string) {
    return this.prisma.withPractice(practiceId, (tx) =>
      tx.outboundItem.update({
        where: { id },
        data: {
          state: 'sent',
          sentAt: new Date(),
          providerRef: providerRef ?? null,
          leasedBy: null,
          leaseExpiresAt: null,
          lastError: null,
        },
      }),
    );
  }

  /**
   * It did not go.
   *
   * `permanent` separates a bad address from a provider hiccup. Eight retries
   * against an address with a typo is six hours of pointless load and six
   * hours before a human is told the thing they need to fix.
   */
  async markFailed(practiceId: string, id: string, error: string, permanent = false) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const item = await tx.outboundItem.findFirst({ where: { id } });
      if (!item) return null;

      const outcome = permanent ? afterPermanentFailure(item) : afterFailure(item, new Date());
      const updated = await tx.outboundItem.update({
        where: { id },
        data: {
          state: outcome.state,
          attempts: outcome.attempts,
          availableAt: outcome.availableAt ?? item.availableAt,
          lastError: error.slice(0, 2000),
          leasedBy: null,
          leaseExpiresAt: null,
        },
      });

      if (outcome.exhausted) {
        /*
         * Loud, because this is the platform failing to deliver a statutory
         * notice. The row is KEPT — it is the record that we tried and could
         * not, which is precisely what somebody will need to explain later.
         */
        this.logger.error(
          `ALERT: outbound ${item.channel} item ${id} for ${item.subjectType} ${item.subjectId} is DEAD after ` +
            `${outcome.attempts} attempts. Last error: ${error.slice(0, 200)}`,
        );
      }
      return updated;
    });
  }

  /**
   * What a kiosk or tablet asks for.
   *
   * Same leasing, longer window — a tablet may be picked up, carried to a
   * patient and put down again before it confirms. Refuses a push channel
   * outright: a device asking for the email queue would be reading the content
   * of notices addressed to people.
   */
  async pullForDevice(practiceId: string, deviceId: string, limit = 20) {
    if (!isPullChannel('device')) throw new BadRequestException('Device pull is not enabled.');
    return this.claim(practiceId, 'device', `device:${deviceId}`, limit);
  }

  /**
   * The queue, for a screen.
   *
   * REQUIRES A PRACTICE. There is deliberately no all-practices listing: these
   * payloads carry patient names and consent details, and a screen that
   * renders every practice at once is a cross-tenant disclosure waiting for
   * one missing WHERE clause. A platform operator picks a practice and looks
   * at that practice, which is also how they actually work.
   *
   * PAYLOADS ARE NOT RETURNED HERE. A list of two hundred emails would ship
   * two hundred patient-bearing bodies to a browser in order to render a table
   * that shows none of them. The viewer fetches one at a time.
   */
  async list(
    practiceId: string | undefined,
    filter: { mediaType?: string; state?: string; channel?: string; search?: string; take?: number },
  ) {
    if (!practiceId) {
      throw new BadRequestException(
        'Choose a practice first. The queue is read one practice at a time, because these messages carry ' +
          'patient details.',
      );
    }
    return this.prisma.withPractice(practiceId, async (tx) => {
      const where: Record<string, unknown> = { practiceId };
      if (filter.mediaType) where.mediaType = filter.mediaType;
      if (filter.state) where.state = filter.state;
      if (filter.channel) where.channel = filter.channel;
      if (filter.search?.trim()) {
        /*
         * Destination and subject only. NOT the payload — searching inside
         * message bodies would let somebody trawl for a patient name across a
         * practice, which is a different capability from operating a queue and
         * should not arrive as a side effect of a search box.
         */
        where.OR = [
          { destination: { contains: filter.search.trim(), mode: 'insensitive' } },
          { subjectType: { contains: filter.search.trim(), mode: 'insensitive' } },
        ];
      }

      const items = await tx.outboundItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filter.take ?? 50,
        select: {
          id: true,
          channel: true,
          mediaType: true,
          destination: true,
          subjectType: true,
          subjectId: true,
          state: true,
          attempts: true,
          availableAt: true,
          lastError: true,
          createdAt: true,
          sentAt: true,
          artefactId: true,
        },
      });
      return { items, count: items.length };
    });
  }

  /**
   * One item WITH its payload, for the viewer.
   *
   * Reading a queued message is reading something written about a patient, so
   * it is logged exactly as opening evidence is. An operator browsing notice
   * contents should leave the same trail as one opening a document — otherwise
   * the queue becomes the unaudited way to read what the audited path protects.
   */
  async item(practiceId: string | undefined, id: string, actor?: Actor) {
    if (!practiceId) throw new BadRequestException('Choose a practice first.');
    return this.prisma.withPractice(practiceId, async (tx) => {
      const found = await tx.outboundItem.findFirst({ where: { id } });
      if (!found) throw new NotFoundException('That queued item is not in this practice.');

      await enqueueVaultEvent(tx, {
        type: 'access.read',
        actor: { principalType: 'staff', id: actor?.id ?? practiceId },
        subject: { type: 'OutboundItem', id },
        payload: {
          readBy: actor?.name ?? 'unattributed',
          mediaType: found.mediaType,
          about: `${found.subjectType}:${found.subjectId}`,
        },
      });

      return found;
    });
  }

  /** What an operator wants to see: what is stuck, and how badly. */
  async health(practiceId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const rows = await tx.outboundItem.groupBy({
        by: ['state', 'channel'],
        where: { practiceId },
        _count: { _all: true },
      });
      const oldestPending = await tx.outboundItem.findFirst({
        where: { practiceId, state: { in: ['pending', 'failed'] } },
        orderBy: { availableAt: 'asc' },
        select: { availableAt: true, channel: true },
      });
      return {
        counts: rows.map((r) => ({ state: r.state, channel: r.channel, count: r._count._all })),
        oldestWaiting: oldestPending?.availableAt ?? null,
        oldestWaitingChannel: oldestPending?.channel ?? null,
        maxPayloadBytes: MAX_PAYLOAD_BYTES,
      };
    });
  }

  /**
   * Remove sent items older than `days`.
   *
   * SAFE ONLY BECAUSE THIS IS NOT THE EVIDENCE STORE. `Notice` and
   * `NoticeDeliveryEvent` hold what was sent and what happened to it, for the
   * full statutory period. This row's job ended when the item left.
   *
   * It is also necessary rather than tidy: at the modelled volume the table
   * gains 274 million rows a year, and a queue that is never pruned stops
   * being a queue.
   *
   * DEAD ITEMS ARE NEVER PRUNED HERE. They are the record of a delivery we
   * could not make.
   */
  async pruneSent(practiceId: string, days = 30) {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    return this.prisma.withPractice(practiceId, async (tx) => {
      const result = await tx.outboundItem.deleteMany({
        where: { practiceId, state: 'sent', sentAt: { lt: cutoff } },
      });
      return { removed: result.count, olderThan: cutoff };
    });
  }
}
