import { BadRequestException } from '@nestjs/common';
import { AGREEMENT_CLOSED_UNSIGNED, lockAndRefuseIfClosed } from './closed-unsigned-guard';

/**
 * A CLOSED AGREEMENT IS REFUSED BY NAME UNDER THE ROW LOCK (review of
 * D-2026-10-10-09): never by `agreements_closure_all_or_none`.
 */
describe('lockAndRefuseIfClosed', () => {
  const txReturning = (rows: unknown[]) => ({ $queryRaw: jest.fn(async () => rows) });

  it('a_closed_agreement_is_refused_with_its_code_the_day_and_n', async () => {
    const tx = txReturning([
      { status: 'expired', closedReason: 'no_service_recorded', closedAt: new Date('2026-10-09T23:00:00Z'), closureDays: 7 },
    ]);
    const refusal = await lockAndRefuseIfClosed(tx as never, 'agreement-under-test').catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(BadRequestException);
    const body = (refusal as BadRequestException).getResponse() as { reason: string; message: string };
    expect(body.reason).toBe(AGREEMENT_CLOSED_UNSIGNED);
    // 23:00 UTC on 9 Oct is 10 Oct in Sydney.
    expect(body.message).toContain('closed on 2026-10-10');
    expect(body.message).toContain('within 7 days');
  });

  it('an_open_agreement_returns_the_status_read_under_the_lock', async () => {
    const tx = txReturning([{ status: 'awaiting_signature', closedReason: null, closedAt: null, closureDays: null }]);
    await expect(lockAndRefuseIfClosed(tx as never, 'agreement-under-test')).resolves.toEqual({ status: 'awaiting_signature' });
  });

  it('an_agreement_outside_the_practice_scope_locks_nothing', async () => {
    await expect(lockAndRefuseIfClosed(txReturning([]) as never, 'agreement-under-test')).resolves.toBeNull();
  });
});
