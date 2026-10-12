import { PrintRecordsService } from './print-records.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * THE REFUSAL'S IDENTITY BLOCK CARRIES THE UNREAD-LINE COUNT (D-2026-10-11-05).
 *
 * `print_record_service_lines_unread` names the fault; the count and the form
 * reference ride on `Db4PrintRecordIdentity`, so the band can say how many
 * lines on which form. A fake Prisma is enough: the read is one `findFirst`
 * and the thing under test is what `describe()` makes of the row.
 */
function serviceFor(payload: Record<string, unknown>): PrintRecordsService {
  const row = {
    id: 'job-1',
    payload: {
      documentType: 'db4_assignment',
      sourceSha256: 'e'.repeat(64),
      parserTemplateVersion: 'pracsoft3-db4-2026-10-1',
      pms: 'pracsoft3',
      capturedAt: '2026-10-11T01:02:03.456Z',
      form: { formReference: 'TEST0000000000000000001' },
      ...payload,
    },
    documentType: 'db4_assignment',
    sourceSha256: 'e'.repeat(64),
    parserTemplateVersion: 'pracsoft3-db4-2026-10-1',
    receivedAt: new Date('2026-10-11T01:02:04.000Z'),
  };
  const tx = { inboundPrintJob: { findFirst: async () => row, findMany: async () => [row] } };
  const prisma = { withPractice: async (_p: string, fn: (t: typeof tx) => unknown) => fn(tx) };
  return new PrintRecordsService(prisma as unknown as PrismaService);
}

describe('PrintRecordsService — the identity a refusal carries', () => {
  it('the_refusal_identity_carries_the_unparsed_service_line_count', async () => {
    const found = await serviceFor({ unparsedServiceLines: 2 }).recordFor('practice-1', 'job-1');
    expect(found!.identity.unparsedServiceLines).toBe(2);
    expect(found!.identity.formReference).toBe('TEST0000000000000000001');
    const batch = await serviceFor({ unparsedServiceLines: 2 }).recordsFor('practice-1', ['job-1']);
    expect(batch.get('job-1')!.identity.unparsedServiceLines).toBe(2);
  });

  it('a_record_without_a_count_carries_none_rather_than_a_guessed_zero', async () => {
    const found = await serviceFor({}).recordFor('practice-1', 'job-1');
    expect('unparsedServiceLines' in found!.identity).toBe(false);
    // And a count in any other shape is not a count.
    const odd = await serviceFor({ unparsedServiceLines: '2' }).recordFor('practice-1', 'job-1');
    expect('unparsedServiceLines' in odd!.identity).toBe(false);
  });
});
