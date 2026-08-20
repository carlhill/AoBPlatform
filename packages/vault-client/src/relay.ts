import type { VaultClient, VaultEventInput, VaultEventType } from '@aobplatform/contracts';
import type { RelayLogger, VaultOutboxRelayClient } from './outbox';

export const DEFAULT_BATCH_SIZE = 25;

/**
 * Retry policy constants — exported so callers test against the real numbers
 * rather than hard-coding copies (copies drift; that is how ReferralPlatform
 * ended up with two different broken relay policies).
 */
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 5 * 60 * 1000;
/** Attempts after which a still-failing row is reported at error level rather than warn. */
export const ESCALATE_AFTER_ATTEMPTS = 8;

export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);
}

export interface RelayOptions {
  prisma: VaultOutboxRelayClient;
  vaultClient: VaultClient;
  logger: RelayLogger;
  batchSize?: number;
}

/**
 * Publishes one batch of queued vault events to the Evidence Vault service.
 *
 * THE RETRY POLICY: exponential backoff, and **no permanent give-up**. A row
 * that keeps failing is reported at error level once it passes
 * `ESCALATE_AFTER_ATTEMPTS`, but it stays queued and keeps being retried.
 * For an evidence chain a late entry does not break non-repudiation, whereas a
 * lost one does — so retrying for hours must always beat discarding. Do not
 * reintroduce a give-up threshold without deciding, explicitly and in writing,
 * that losing evidence events is acceptable. (Policy inherited verbatim from
 * the ReferralPlatform relay, where a capped retry budget was measured — on
 * 2026-08-17, not theorised — destroying audit records across an ordinary
 * deploy.)
 *
 * Framework-agnostic on purpose: scheduling, DI, and the
 * skip-if-already-running guard live in apps/core's thin NestJS wrapper, so
 * this package needs no NestJS dependency and stays directly unit-testable.
 */
export async function relayPendingVaultEvents(options: RelayOptions): Promise<void> {
  const { prisma, vaultClient, logger, batchSize = DEFAULT_BATCH_SIZE } = options;
  const now = new Date();

  const pending = await prisma.vaultOutbox.findMany({
    // No attempts cap: a row is eligible once its backoff window has elapsed.
    // `nextAttemptAt: null` is the state every freshly-enqueued row starts in.
    where: {
      publishedAt: null,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { occurredAt: 'asc' },
    take: batchSize,
  });

  for (const row of pending) {
    try {
      const event: VaultEventInput = {
        type: row.type as VaultEventType,
        actor: row.actor as VaultEventInput['actor'],
        subject: { type: row.subjectType, id: row.subjectId },
        payload: row.payload as VaultEventInput['payload'],
      };
      await vaultClient.append(event);
      await prisma.vaultOutbox.update({
        where: { id: row.id },
        data: { publishedAt: new Date() },
      });
    } catch (err) {
      const message = (err as Error).message ?? 'unknown error';
      const attempts = row.attempts + 1;
      const delay = backoffMs(attempts);

      await prisma.vaultOutbox.update({
        where: { id: row.id },
        data: {
          attempts: { increment: 1 },
          lastError: message.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + delay),
        },
      });

      const detail = `vault outbox row ${row.id} (${row.type}) failed attempt ${attempts}, retrying in ${Math.round(
        delay / 1000,
      )}s: ${message}`;
      if (attempts >= ESCALATE_AFTER_ATTEMPTS) {
        logger.error(`Persistently failing ${detail}`);
      } else {
        logger.warn(`Failed to relay ${detail}`);
      }
    }
  }
}
