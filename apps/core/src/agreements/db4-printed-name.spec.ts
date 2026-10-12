/**
 * THE PRINTED NAME AGAINST THE PATIENT RECORD, AT THE DESK (D-2026-10-10-11).
 *
 * `db4PrintRecordChecksForMany` now also answers "does the name printed on
 * the DB4 match the patient record the chart number found?", and the desk
 * list carries the answer as a WARNING: the row stays sendable, nothing is
 * written, and no name reaches a log.
 *
 * Fixture names are obviously fake; no test name carries one.
 */
import { Logger } from '@nestjs/common';
import { DB4_PRINTED_NAME_DIFFERS_CODE } from '@aobplatform/contracts';
import { AgreementsService } from './agreements.service';
import { TabletSessionsService, type PushableRow } from '../tablet-sessions/tablet-sessions.service';

const PRACTICE = '00000000-0000-4000-8000-0000000000aa';
const RECORDED = { givenNames: 'Testa', familyName: 'Fakename' };

const identity = (printJobId: string) => ({
  printJobId,
  sourceSha256: 'a'.repeat(64),
  formReference: `FAKE-${printJobId}`,
  receivedAt: '2026-10-10T09:00:00Z',
});

const envelope = (patient: Record<string, unknown>) => ({
  documentType: 'db4_assignment',
  patient: { patientRecordNumber: 'FAKE-1', ...patient },
  services: [{ mbsItemNumber: '23', serviceDate: '2026-10-10', benefitAssigned: '1.00' }],
  providers: [{ role: 'servicing', name: 'Dr Fake', providerNumber: '0000000A', pmsProviderKey: 'fake' }],
  form: { formReference: 'FAKE-1', serviceDate: '2026-10-10' },
});

/** An AgreementsService with only what the desk read touches. */
function agreementsWith(printed: Record<string, Record<string, unknown>>, logger: { error: jest.Mock }) {
  const findMany = jest.fn(async () =>
    Object.keys(printed).map((id) => ({ id, sourcePrintJobId: `job-${id}`, patient: RECORDED })),
  );
  const withPractice = jest.fn(async (_practiceId: string, fn: (tx: unknown) => unknown) =>
    fn({ agreement: { findMany } }),
  );
  const recordsFor = jest.fn(async () => {
    const map = new Map();
    for (const [id, patient] of Object.entries(printed)) {
      map.set(`job-${id}`, { envelope: envelope(patient), identity: identity(`job-${id}`) });
    }
    return map;
  });
  const service = Object.create(AgreementsService.prototype) as AgreementsService;
  Object.assign(service, { prisma: { withPractice }, printRecords: { recordsFor }, logger });
  return { service, withPractice, findMany };
}

describe('the printed DB4 name against the patient record, at the desk', () => {
  let logger: { error: jest.Mock; warn: jest.Mock; log: jest.Mock };
  beforeEach(() => {
    logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
    jest.spyOn(Logger.prototype, 'error').mockImplementation(logger.error);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(logger.warn);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(logger.log);
  });
  afterEach(() => jest.restoreAllMocks());

  it('an exact match, or one differing only in case and spacing, carries no warning', async () => {
    const { service } = agreementsWith(
      { a: RECORDED, b: { givenNames: '  TESTA ', familyName: 'fakename' } },
      logger,
    );
    const answers = await service.db4PrintRecordChecksForMany(PRACTICE, ['a', 'b']);
    expect(answers.get('a')?.nameDiffers ?? null).toBeNull();
    expect(answers.get('b')?.nameDiffers ?? null).toBeNull();
  });

  it('a different given name is a warning carrying both names, and the same comparison refuses the push', async () => {
    const { service } = agreementsWith({ a: { givenNames: 'Otherly', familyName: 'Fakename' } }, logger);
    const answer = (await service.db4PrintRecordChecksForMany(PRACTICE, ['a'])).get('a');
    expect(answer?.nameDiffers).toEqual({
      code: DB4_PRINTED_NAME_DIFFERS_CODE,
      parts: ['given_names'],
      printed: { givenNames: 'Otherly', familyName: 'Fakename' },
      recorded: RECORDED,
    });
    /*
     * AND A REFUSAL, SINCE 11 OCTOBER 2026. This line used to assert an empty
     * `checks` — "it is not a refusal check" — which was D-2026-10-10-11's
     * rule. Carl chose to stop Send to tablet as well (D-2026-10-11-06), and
     * to decide both from this one comparison, so the band and the refusal
     * cannot disagree. The warning is unchanged; the refusal is new.
     */
    expect(answer?.checks).toEqual(['print_record_patient_name_differs']);
  });

  it('reads the patient name through the practice-scoped read, for that practice only', async () => {
    const { service, withPractice, findMany } = agreementsWith({ a: { familyName: 'Differentname' } }, logger);
    await service.db4PrintRecordChecksForMany(PRACTICE, ['a']);
    expect(withPractice).toHaveBeenCalledWith(PRACTICE, expect.any(Function));
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ patient: { select: { givenNames: true, familyName: true } } }),
      }),
    );
  });

  it('never puts a name in a log line, on success or on failure', async () => {
    const { service } = agreementsWith({ a: { givenNames: 'Otherly', familyName: 'Differentname' } }, logger);
    await service.db4PrintRecordChecksForMany(PRACTICE, ['a']);
    const failing = Object.create(AgreementsService.prototype) as AgreementsService;
    Object.assign(failing, {
      prisma: { withPractice: jest.fn(async () => { throw new Error('Otherly Differentname Testa Fakename'); }) },
      printRecords: { recordsFor: jest.fn() },
      logger: new Logger('AgreementsService'),
    });
    await expect(failing.db4PrintRecordChecksForMany(PRACTICE, ['a'])).resolves.toEqual(new Map());
    const logged = JSON.stringify([logger.error.mock.calls, logger.warn.mock.calls, logger.log.mock.calls]);
    for (const value of ['Otherly', 'Differentname', 'Testa', 'Fakename']) {
      expect(logged).not.toContain(value);
    }
  });

  it('the warning field alone decides nothing; the refusal arrives through checks, and the warning stays beside it', async () => {
    const answers = new Map([
      [
        'a',
        {
          checks: [] as string[],
          identity: identity('job-a'),
          nameDiffers: {
            code: DB4_PRINTED_NAME_DIFFERS_CODE,
            parts: ['family_name' as const],
            printed: { givenNames: 'Testa', familyName: 'Differentname' },
            recorded: RECORDED,
          },
        },
      ],
    ]);
    const tablet = Object.create(TabletSessionsService.prototype) as TabletSessionsService;
    Object.assign(tablet, { agreements: { db4PrintRecordChecksForMany: jest.fn(async () => answers) } });
    const row = { agreementId: 'a', pushable: true, blockedReason: null, printRecord: null, printedNameDiffers: null } as unknown as PushableRow;
    const blocked = { ...row, agreementId: 'b', pushable: false, blockedReason: 'patient_confidential' } as unknown as PushableRow;
    answers.set('b', { ...answers.get('a')! });
    const [sendable, other] = await (
      tablet as unknown as { markUnreadablePrintRecords: (p: string, r: PushableRow[]) => Promise<PushableRow[]> }
    ).markUnreadablePrintRecords(PRACTICE, [row, blocked]);
    expect(sendable!.pushable).toBe(true);
    expect(sendable!.blockedReason).toBeNull();
    expect(sendable!.printedNameDiffers?.parts).toEqual(['family_name']);
    // A row blocked for another reason keeps that reason and still shows the warning.
    expect(other!.blockedReason).toBe('patient_confidential');
    expect(other!.printedNameDiffers?.parts).toEqual(['family_name']);

    /*
     * THE REAL CASE (D-2026-10-11-06). In production the comparison that sets
     * `nameDiffers` also puts `print_record_patient_name_differs` in
     * `checks`: the row is then blocked as a print-record refusal, and the
     * warning still names both names beside it.
     */
    answers.set('c', { ...answers.get('a')!, checks: ['print_record_patient_name_differs'] });
    const refused = { ...row, agreementId: 'c' } as unknown as PushableRow;
    const [stopped] = await (
      tablet as unknown as { markUnreadablePrintRecords: (p: string, r: PushableRow[]) => Promise<PushableRow[]> }
    ).markUnreadablePrintRecords(PRACTICE, [refused]);
    expect(stopped!.pushable).toBe(false);
    expect(stopped!.blockedReason).toBe('print_record_incomplete');
    expect(stopped!.printRecord?.checks).toEqual(['print_record_patient_name_differs']);
    expect(stopped!.printedNameDiffers?.parts).toEqual(['family_name']);
  });
});

/*
 * THE TABLET NEVER CARRIES THE COMPARISON. Checked by `tsc` (this file is in
 * `apps/core/tsconfig.json`; ts-jest here runs with isolatedModules and does
 * not typecheck): if `TabletSessionPayload` ever gains a field for the
 * printed-vs-record name, `NoComparisonOnTheTablet` stops being `true` and
 * the typecheck fails.
 */
type ForbiddenOnTablet = 'printedNameDiffers' | 'nameDiffers' | 'printedName';
type NoComparisonOnTheTablet =
  Extract<keyof import('@aobplatform/domain').TabletSessionPayload, ForbiddenOnTablet> extends never ? true : false;
const noComparisonOnTheTablet: NoComparisonOnTheTablet = true;

describe('the kiosk payload', () => {
  it('has no field for the printed-vs-record name comparison', () => {
    expect(noComparisonOnTheTablet).toBe(true);
  });
});
