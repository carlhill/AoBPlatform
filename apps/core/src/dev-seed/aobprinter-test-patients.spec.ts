import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AOBPRINTER_TEST_PATIENTS, DevSeedController } from './dev-seed.controller';
import type { PrismaService } from '../prisma/prisma.service';
import type { DevicesService } from '../devices/devices.service';
import type { ServiceDescriptionsService } from '../service-descriptions/service-descriptions.service';

/**
 * `POST /dev/aobprinter-test-patients` — the patients the AOBPRINTER test
 * tool's "Load test agreements" button prints against.
 *
 * What matters: it never exists in production, it needs a practice, a second
 * press creates nothing, and a practice a DB4 could not place in is refused
 * with the reason that is TRUE of it (wow.md §13) before anything is written.
 */
describe('POST /dev/aobprinter-test-patients', () => {
  const PRACTICE = '11111111-1111-4111-8111-111111111111';
  const original = process.env.NODE_ENV;

  type Aff = { providerNumber: string | null; billingRole: string };

  /** A practice in memory: the rows the endpoint reads, and the patients it writes. */
  function controller(opts: { practiceExists?: boolean; affiliations?: Aff[] } = {}) {
    const patients: Array<{ patientRecordNumber: string; data: Record<string, unknown> }> = [];
    const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      patients.push({ patientRecordNumber: data.patientRecordNumber as string, data });
      return data;
    });
    const tx = {
      practice: {
        findFirst: jest.fn(async () => (opts.practiceExists === false ? null : { id: PRACTICE })),
      },
      affiliation: {
        findMany: jest.fn(async () =>
          (opts.affiliations ?? [{ providerNumber: '9999999X', billingRole: 'servicing_provider' }]).filter(
            (a) => a.providerNumber !== null,
          ),
        ),
      },
      patient: {
        findMany: jest.fn(async ({ where }: { where: { patientRecordNumber: { in: string[] } } }) =>
          patients
            .filter((p) => where.patientRecordNumber.in.includes(p.patientRecordNumber))
            .map((p) => ({ patientRecordNumber: p.patientRecordNumber })),
        ),
        create,
      },
    };
    const withPractice = jest.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx));
    const prisma = { withPractice } as unknown as PrismaService;
    const c = new DevSeedController(prisma, {} as DevicesService, {} as ServiceDescriptionsService);
    return { c, create, withPractice, patients };
  }

  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it('dev_aobprinter_test_patients_do_not_exist_in_production', async () => {
    process.env.NODE_ENV = 'production';
    const { c, withPractice } = controller();
    await expect(c.aobPrinterTestPatients(PRACTICE)).rejects.toBeInstanceOf(ForbiddenException);
    expect(withPractice).not.toHaveBeenCalled();
  });

  it('refuses without a practice', async () => {
    process.env.NODE_ENV = 'test';
    const { c, withPractice } = controller();
    await expect(c.aobPrinterTestPatients(undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.aobPrinterTestPatients('   ')).rejects.toBeInstanceOf(BadRequestException);
    expect(withPractice).not.toHaveBeenCalled();
  });

  it('refuses a practice it cannot see, by name, and writes nothing', async () => {
    process.env.NODE_ENV = 'test';
    const { c, create } = controller({ practiceExists: false });
    const err = await c.aobPrinterTestPatients(PRACTICE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ reason: 'practice_not_found' });
    expect(create).not.toHaveBeenCalled();
  });

  it('creates the five fake patients and returns the servicing provider numbers', async () => {
    process.env.NODE_ENV = 'test';
    const { c, patients } = controller({
      affiliations: [
        { providerNumber: '9999999X', billingRole: 'servicing_provider' },
        { providerNumber: null, billingRole: 'servicing_provider' },
      ],
    });
    const res = await c.aobPrinterTestPatients(PRACTICE);
    expect(res.created).toBe(AOBPRINTER_TEST_PATIENTS.length);
    expect(res.servicingProviderNumbers).toEqual(['9999999X']);
    expect(res.patients.map((p) => p.patientRecordNumber)).toEqual(
      AOBPRINTER_TEST_PATIENTS.map((p) => p.patientRecordNumber),
    );
    // No Medicare-format number and no contact details on any of them (hard rule 1; CLAUDE.md §7c).
    for (const p of patients) {
      expect(Object.keys(p.data)).not.toEqual(expect.arrayContaining(['ihi', 'email', 'mobile']));
      expect(JSON.stringify(p.data)).not.toMatch(/\b\d{4}\s?\d{5}\s?\d\b/);
    }
  });

  it('is idempotent: a second call creates nothing new', async () => {
    process.env.NODE_ENV = 'test';
    const { c, create } = controller();
    await c.aobPrinterTestPatients(PRACTICE);
    const callsAfterFirst = create.mock.calls.length;
    const second = await c.aobPrinterTestPatients(PRACTICE);
    expect(second.created).toBe(0);
    expect(create.mock.calls.length).toBe(callsAfterFirst);
    expect(second.patients).toHaveLength(AOBPRINTER_TEST_PATIENTS.length);
  });

  it('refuses with no_active_affiliation_with_provider_number when no active affiliation has one', async () => {
    process.env.NODE_ENV = 'test';
    const { c, create } = controller({ affiliations: [{ providerNumber: null, billingRole: 'servicing_provider' }] });
    const err = await c.aobPrinterTestPatients(PRACTICE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      reason: 'no_active_affiliation_with_provider_number',
    });
    // Asked before a patient is written: the refusal leaves the practice as it was.
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses with no_active_affiliation_may_be_provider when every numbered role may not be the provider', async () => {
    process.env.NODE_ENV = 'test';
    const { c, create } = controller({ affiliations: [{ providerNumber: '7777777Z', billingRole: 'not_a_role' }] });
    const err = await c.aobPrinterTestPatients(PRACTICE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      reason: 'no_active_affiliation_may_be_provider',
    });
    expect(create).not.toHaveBeenCalled();
  });
});
