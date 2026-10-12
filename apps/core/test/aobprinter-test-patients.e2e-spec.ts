import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import type { ValidationResponse } from '@aobplatform/contracts';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../src/messaging/gateway';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';
import { InboundLaneWorkerService } from '../src/inbound/inbound-lane.worker';
import { createServicingProvider, deleteSeededAnchors } from './anchor';

/**
 * THE AOBPRINTER TEST TOOL'S "LOAD TEST AGREEMENTS", END TO END.
 *
 * The button asks `POST /dev/aobprinter-test-patients` for patients and a
 * servicing provider number, then prints one DB4 per patient through
 * `POST /inbound/print-jobs`. The unit spec proves the endpoint's own rules;
 * this proves the claim the button's copy makes — that what it returns
 * actually PLACES: every DB4 printed against it becomes an agreement on the
 * desk, through the same door a real driver uses.
 *
 * FAKE IDENTITIES THROUGHOUT, and the Medicare number fails its own checksum
 * (CLAUDE.md §7c). It rides on the DB4 only because the form prints it.
 */

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);
/** 2 999 99999 9 — invalid by construction. */
const FAKE_MEDICARE = '2999 99999 9';
const SERVICING_NUMBER = '9999999X';

const passingRules = {
  validate: async (): Promise<ValidationResponse> => ({
    valid: true,
    results: [{ rule: 'C8', outcome: 'pass', message: 'D7 is complete.', citation: 's 65C(4)' }],
    ruleSetVersion: 'test-rules-1',
    mappingVersion: 'test-mapping-1',
  }),
};

type Json = Record<string, unknown>;

function withoutComments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutComments);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Json)
        .filter(([key]) => !key.startsWith('$'))
        .map(([key, v]) => [key, withoutComments(v)]),
    );
  }
  return value;
}

/** The example's SHAPE, the returned patient's values, the returned provider number. */
function db4For(
  patient: { patientRecordNumber: string; givenNames: string; familyName: string; dateOfBirth: string },
  providerNumber: string,
  formReference: string,
): Json {
  const example = withoutComments(
    JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'DB4-print.example.json'), 'utf8')),
  ) as Json;
  const providers = example.providers as Json[];
  return {
    ...example,
    sourceSha256: sha(`load-test-agreements:${formReference}`),
    capturedAt: new Date().toISOString(),
    form: { ...(example.form as Json), formReference, serviceDate: today() },
    patient: {
      ...(example.patient as Json),
      pmsLinkageKey: `chart:${patient.patientRecordNumber}`,
      patientRecordNumber: patient.patientRecordNumber,
      givenNames: patient.givenNames,
      familyName: patient.familyName,
      dateOfBirth: patient.dateOfBirth,
      address: '3 Example Street, Sampletown NSW 2000',
      // eslint-disable-next-line no-restricted-syntax -- the DB4's decided exception (D-2026-09-14-03); invalid-checksum fake.
      medicareCardNumber: FAKE_MEDICARE,
    },
    providers: [
      { ...providers[0], name: 'Dr Fake Servicing', providerNumber, pmsProviderKey: `provider:${providerNumber}` },
      { ...providers[1], name: 'Dr Fake Payee' },
    ],
    services: (example.services as Json[]).map((s) => ({ ...s, serviceDate: today() })),
  };
}

describe('load test agreements (e2e, real Postgres)', () => {
  // Five placements through the real lane on a cold application: the 5 s default measured the
  // machine, not the code (the first run took 1.3 s, the second 5 s+ on the same commit).
  jest.setTimeout(30_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: InboundLaneWorkerService;
  const practiceId = randomUUID();
  const unnumberedPracticeId = randomUUID();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_GATEWAY)
      .useValue({ mode: 'test', dispatch: async () => ({ accepted: true }) } as MessagingGateway)
      .overrideProvider(RULES_CLIENT)
      .useValue(passingRules)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    worker = app.get(InboundLaneWorkerService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'Load Test Agreements Practice' } });
      await createServicingProvider(tx, practiceId, {
        name: 'Dr Fake Servicing',
        providerType: 'general_practitioner',
        providerNumber: SERVICING_NUMBER,
      });
    });
    // A practice whose only practitioner has no provider number: a DB4 could name nobody here.
    await prisma.withPractice(unnumberedPracticeId, async (tx) => {
      await tx.practice.create({ data: { id: unnumberedPracticeId, name: 'No Provider Number Practice' } });
      await createServicingProvider(tx, unnumberedPracticeId, { name: 'Dr No Number', providerNumber: null });
    });
  });

  afterAll(async () => {
    for (const scope of [practiceId, unnumberedPracticeId]) {
      await prisma.withPractice(scope, async (tx) => {
        await tx.inboundPrintJob.deleteMany({});
        await tx.outboundItem.deleteMany({});
        await tx.captureRequest.deleteMany({});
        await tx.verificationChallenge.deleteMany({});
        await tx.serviceRecord.deleteMany({});
        await tx.agreement.deleteMany({});
        await tx.assignor.deleteMany({});
        await tx.patient.deleteMany({});
        await tx.provider.deleteMany({});
        await deleteSeededAnchors(tx);
        await tx.practice.deleteMany({});
      });
    }
    await prisma.vaultOutbox.deleteMany({});
    await app?.close();
  });

  const loadPatients = (scope: string) =>
    request(app.getHttpServer()).post('/dev/aobprinter-test-patients').set('x-practice-id', scope).send({});

  async function settle(shas: string[]) {
    for (let i = 0; i < 40; i++) {
      await worker.sweep('critical');
      const rows = await prisma.withPractice(practiceId, (tx) =>
        tx.inboundPrintJob.findMany({ where: { sourceSha256: { in: shas } } }),
      );
      if (rows.length === shas.length && rows.every((r) => r.state === 'done' || r.state === 'dead')) return rows;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`DB4 jobs did not settle: ${shas.join(', ')}`);
  }

  it('every_returned_test_patient_places_an_agreement_through_the_print_job_door', async () => {
    const res = await loadPatients(practiceId).expect(201);
    expect(res.body.created).toBe(5);
    expect(res.body.servicingProviderNumbers).toEqual([SERVICING_NUMBER]);
    const patients = res.body.patients as Array<{
      patientRecordNumber: string;
      givenNames: string;
      familyName: string;
      dateOfBirth: string;
    }>;
    expect(patients).toHaveLength(5);

    const stamp = Date.now().toString(36).toUpperCase();
    const bodies = patients.map((p, i) => db4For(p, res.body.servicingProviderNumbers[0], `LOAD-${stamp}-${i + 1}`));
    for (const body of bodies) {
      await request(app.getHttpServer())
        .post('/inbound/print-jobs')
        .set('x-practice-id', practiceId)
        .send(body)
        .expect(202);
    }

    const rows = await settle(bodies.map((b) => b.sourceSha256 as string));
    for (const row of rows) {
      const db4 = (row.outcome as { db4: { placed: boolean; reason: string | null; agreementId: string | null } }).db4;
      expect({ placed: db4.placed, reason: db4.reason }).toEqual({ placed: true, reason: null });
      const agreement = await prisma.withPractice(practiceId, (tx) =>
        tx.agreement.findFirst({ where: { id: db4.agreementId! } }),
      );
      expect(agreement?.type).toBe('episodic_post');
      expect(agreement?.sourcePrintJobId).toBe(row.id);
    }

    // One agreement per test patient, and each on a different patient.
    const agreements = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findMany({ where: { type: 'episodic_post' }, select: { patientId: true } }),
    );
    expect(new Set(agreements.map((a) => a.patientId)).size).toBe(5);
  });

  it('a second press creates no patients, and its fresh form references place five more agreements', async () => {
    const res = await loadPatients(practiceId).expect(201);
    expect(res.body.created).toBe(0);

    const stamp = `${Date.now().toString(36).toUpperCase()}B`;
    const bodies = (res.body.patients as Parameters<typeof db4For>[0][]).map((p, i) =>
      db4For(p, res.body.servicingProviderNumbers[0], `LOAD-${stamp}-${i + 1}`),
    );
    for (const body of bodies) {
      await request(app.getHttpServer()).post('/inbound/print-jobs').set('x-practice-id', practiceId).send(body).expect(202);
    }
    const rows = await settle(bodies.map((b) => b.sourceSha256 as string));
    for (const row of rows) {
      const db4 = (row.outcome as { db4: { placed: boolean; reason: string | null } }).db4;
      expect({ placed: db4.placed, reason: db4.reason }).toEqual({ placed: true, reason: null });
    }

    const count = await prisma.withPractice(practiceId, (tx) => tx.patient.count({}));
    expect(count).toBe(5);
    const agreements = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.count({ where: { type: 'episodic_post' } }),
    );
    expect(agreements).toBe(10);
  });

  it('a practice with no numbered active affiliation is refused by name, and gains no patient', async () => {
    const res = await loadPatients(unnumberedPracticeId).expect(409);
    expect(res.body.reason).toBe('no_active_affiliation_with_provider_number');
    const count = await prisma.withPractice(unnumberedPracticeId, (tx) => tx.patient.count({}));
    expect(count).toBe(0);
  });
});
