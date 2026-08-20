import type { VaultClient, VaultEventRecord } from '@aobplatform/contracts';
import type { VaultOutboxDbRow, VaultOutboxRelayClient } from './outbox';
import {
  backoffMs,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  ESCALATE_AFTER_ATTEMPTS,
  relayPendingVaultEvents,
} from './relay';

function makeRow(overrides: Partial<VaultOutboxDbRow> = {}): VaultOutboxDbRow {
  return {
    id: 'row-1',
    type: 'agreement.created',
    actor: { principalType: 'system', id: 'core' },
    subjectType: 'Agreement',
    subjectId: 'agr-1',
    payload: { channel: 'in_practice' },
    occurredAt: new Date('2026-08-20T00:00:00Z'),
    attempts: 0,
    ...overrides,
  };
}

function makeVaultClient(appendImpl: () => Promise<VaultEventRecord>): VaultClient {
  return {
    append: jest.fn(appendImpl),
    getChainSegment: jest.fn(),
    verifyArtefactHash: jest.fn(),
  } as unknown as VaultClient;
}

function makePrisma(rows: VaultOutboxDbRow[]): VaultOutboxRelayClient & { updates: any[] } {
  const updates: any[] = [];
  return {
    updates,
    vaultOutbox: {
      findMany: jest.fn(async () => rows),
      update: jest.fn(async (args: any) => {
        updates.push(args);
        return {};
      }),
    },
  };
}

const silentLogger = { warn: jest.fn(), error: jest.fn() };

describe('backoffMs', () => {
  it('grows exponentially from the base and caps at the max', () => {
    expect(backoffMs(1)).toBe(BACKOFF_BASE_MS);
    expect(backoffMs(2)).toBe(BACKOFF_BASE_MS * 2);
    expect(backoffMs(3)).toBe(BACKOFF_BASE_MS * 4);
    expect(backoffMs(100)).toBe(BACKOFF_MAX_MS);
  });
});

describe('relayPendingVaultEvents', () => {
  it('publishes pending rows and marks them published', async () => {
    const prisma = makePrisma([makeRow()]);
    const vaultClient = makeVaultClient(async () => ({}) as VaultEventRecord);

    await relayPendingVaultEvents({ prisma, vaultClient, logger: silentLogger });

    expect(vaultClient.append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agreement.created',
        subject: { type: 'Agreement', id: 'agr-1' },
      }),
    );
    expect(prisma.updates).toHaveLength(1);
    expect(prisma.updates[0].data.publishedAt).toBeInstanceOf(Date);
  });

  it('never gives up on a failing row — increments attempts, sets backoff, keeps it queued', async () => {
    const prisma = makePrisma([makeRow({ attempts: 3 })]);
    const vaultClient = makeVaultClient(async () => {
      throw new Error('vault down');
    });

    await relayPendingVaultEvents({ prisma, vaultClient, logger: silentLogger });

    const update = prisma.updates[0];
    expect(update.data.attempts).toEqual({ increment: 1 });
    expect(update.data.publishedAt).toBeUndefined(); // still queued
    expect(update.data.nextAttemptAt).toBeInstanceOf(Date);
    expect(update.data.lastError).toContain('vault down');
  });

  it('escalates to error level after the escalation threshold, but still retries', async () => {
    const logger = { warn: jest.fn(), error: jest.fn() };
    const prisma = makePrisma([makeRow({ attempts: ESCALATE_AFTER_ATTEMPTS - 1 })]);
    const vaultClient = makeVaultClient(async () => {
      throw new Error('still down');
    });

    await relayPendingVaultEvents({ prisma, vaultClient, logger });

    expect(logger.error).toHaveBeenCalled();
    expect(prisma.updates[0].data.publishedAt).toBeUndefined();
  });

  it('selects only unpublished rows whose backoff window has elapsed, oldest first', async () => {
    const prisma = makePrisma([]);
    const vaultClient = makeVaultClient(async () => ({}) as VaultEventRecord);

    await relayPendingVaultEvents({ prisma, vaultClient, logger: silentLogger, batchSize: 10 });

    expect(prisma.vaultOutbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ publishedAt: null }),
        orderBy: { occurredAt: 'asc' },
        take: 10,
      }),
    );
  });
});
