import type { PrintJobEnvelope } from '@aobplatform/contracts';
import { AgreementsService } from './agreements.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PrintRecordsService } from '../inbound/print-records.service';

/**
 * THE SEND-TO-TABLET CHECK COMPARES THE PRINTED NAME WITH THE PATIENT ON
 * RECORD, ON BOTH PATHS (D-2026-10-11-06).
 *
 * `checkDb4PrintRecord` is tested in `db4-form-view.spec.ts`; this proves the
 * two callers actually hand it the patient — the single push and the desk
 * list — because a caller that forgot would silently never ask the question.
 * The fake Prisma answers only the reads these two methods make.
 */
const PRINTED: PrintJobEnvelope = {
  documentType: 'db4_assignment',
  sourceSha256: 'f'.repeat(64),
  parserTemplateVersion: 'pracsoft3-db4-2026-10-1',
  pms: 'pracsoft3',
  capturedAt: '2026-10-11T00:00:00Z',
  form: { formReference: 'TEST0000000000000000002', serviceDate: '2026-09-12' },
  patient: { patientRecordNumber: 'DESK-TEST-0001', givenNames: 'Fern2', familyName: 'Fakename' },
  providers: [{ role: 'servicing', name: 'Dr Ficticia Nonperson', providerNumber: '9999999X' }],
  services: [{ serviceDate: '2026-09-12', mbsItemNumber: '23', benefitAssigned: '$45.05' }],
} as unknown as PrintJobEnvelope;

function serviceWith(onRecord: { givenNames: string; familyName: string }): AgreementsService {
  const tx = {
    agreement: {
      findMany: async () => [{ id: 'agreement-1', sourcePrintJobId: 'job-1', patient: onRecord }],
    },
    patient: { findFirst: async () => onRecord },
  };
  const prisma = { withPractice: async (_p: string, fn: (t: typeof tx) => unknown) => fn(tx) };
  const identity = { printJobId: 'job-1', sourceSha256: 'f'.repeat(64), receivedAt: '2026-10-11T00:00:01Z' };
  const printRecords = {
    recordFor: async () => ({ envelope: PRINTED, identity }),
    recordsFor: async () => new Map([['job-1', { envelope: PRINTED, identity }]]),
  };
  const none = undefined as never;
  return new AgreementsService(
    prisma as unknown as PrismaService,
    none, none, none, none, none, none, none, none,
    printRecords as unknown as PrintRecordsService,
  );
}

describe('AgreementsService — the printed name against the patient on record', () => {
  it('the_push_refuses_a_printed_name_that_differs_from_the_patient_on_record', async () => {
    const answer = await serviceWith({ givenNames: 'Emin', familyName: 'Fakename' }).db4PrintRecordChecks(
      'practice-1',
      { id: 'agreement-1', sourcePrintJobId: 'job-1', patientId: 'patient-1' },
    );
    expect(answer.checks).toEqual(['print_record_patient_name_differs']);
  });

  it('the_desk_list_refuses_the_same_record_the_same_way', async () => {
    const answers = await serviceWith({ givenNames: 'Emin', familyName: 'Fakename' }).db4PrintRecordChecksForMany(
      'practice-1',
      ['agreement-1'],
    );
    expect(answers.get('agreement-1')?.checks).toEqual(['print_record_patient_name_differs']);
  });

  it('a_matching_name_passes_on_both_paths', async () => {
    const same = serviceWith({ givenNames: 'FERN2', familyName: 'Fakename' });
    const one = await same.db4PrintRecordChecks('practice-1', {
      id: 'agreement-1',
      sourcePrintJobId: 'job-1',
      patientId: 'patient-1',
    });
    expect(one.checks).toEqual([]);
    const many = await same.db4PrintRecordChecksForMany('practice-1', ['agreement-1']);
    expect(many.get('agreement-1')?.checks).toEqual([]);
  });
});
