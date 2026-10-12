import { associateAfterCommit } from './associate-after-commit';

/**
 * HARD RULE 8 FOR THE ASSOCIATION (D-2026-10-10-09 option (b)): a failure is
 * caught and logged with its class, code and ids only, and never thrown at
 * the path that created the service record.
 */
describe('associateAfterCommit', () => {
  const ids = { practiceId: 'practice-under-test', serviceRecordId: 'service-under-test' };

  it('a_failed_association_is_swallowed_and_logged_without_its_message', async () => {
    const warn = jest.fn();
    class PrismaClientKnownRequestError extends Error {
      code = 'P2002';
    }
    const prisma = {
      withPractice: jest.fn(async () => {
        throw new PrismaClientKnownRequestError('Unique constraint failed: value Sampleperson');
      }),
    };

    const result = await associateAfterCommit(prisma as never, ids.practiceId, ids.serviceRecordId, { warn });

    expect(result).toEqual({ outcome: 'failed' });
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0]![0] as string;
    expect(line).toContain(ids.serviceRecordId);
    expect(line).toContain('PrismaClientKnownRequestError');
    expect(line).toContain('P2002');
    // Never the message: a Prisma message can quote a value.
    expect(line).not.toContain('Sampleperson');
  });

  it('a_missing_service_record_associates_nothing', async () => {
    const tx = { serviceRecord: { findFirst: jest.fn(async () => null) } };
    const prisma = { withPractice: jest.fn(async (_id: string, fn: (t: unknown) => unknown) => fn(tx)) };

    const result = await associateAfterCommit(prisma as never, ids.practiceId, ids.serviceRecordId, { warn: jest.fn() });

    expect(result).toEqual({ outcome: 'none', candidateCount: 0 });
  });
});
