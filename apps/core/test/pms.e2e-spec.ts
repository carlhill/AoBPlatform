import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ValidationResponse } from '@aobplatform/contracts';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';

const passingRules = {
  validate: async (): Promise<ValidationResponse> => ({
    valid: true,
    results: [],
    ruleSetVersion: 'test-rules-1',
    mappingVersion: 'test-mapping-1',
  }),
};

describe('M9 PMS wiring (e2e, real Postgres + mock adapter)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const practiceId = randomUUID();
  let providerId: string;
  let patientId: string;
  let assignorId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RULES_CLIENT)
      .useValue(passingRules)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'PMS Wiring Test Practice' } });
      providerId = (
        await tx.provider.create({
          data: {
            practiceId,
            name: 'Dr Example Provider',
            providerType: 'general_practitioner',
            pmsLinkageKey: 'mock-prov-001',
          },
        })
      ).id;
      patientId = (
        await tx.patient.create({
          data: {
            practiceId,
            familyName: 'Testpatient',
            givenNames: 'Alex',
            dateOfBirth: new Date('1957-03-14'),
            // The mirror address is DELIBERATELY stale — ADR A-08 says the
            // live PMS value wins at challenge time.
            address: '99 Stale Mirror Road, Oldtown VIC 3000',
            pmsLinkageKey: 'mock-pat-001',
          },
        })
      ).id;
      assignorId = (
        await tx.assignor.create({ data: { practiceId, name: 'Alex Testpatient', authorityBasis: 'self' } })
      ).id;
    });
  });

  afterAll(async () => {
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.serviceRecord.deleteMany({});
      await tx.captureRequest.deleteMany({});
      await tx.verificationChallenge.deleteMany({});
      await tx.agreement.deleteMany({});
      await tx.assignor.deleteMany({});
      await tx.patient.deleteMany({});
      await tx.provider.deleteMany({});
      await tx.practice.deleteMany({});
    });
    await prisma.vaultOutbox.deleteMany({});
    await app.close();
  });

  it('verification_matches_pms_at_challenge_time (ADR A-08) — live values beat the stale mirror', async () => {
    const start = await request(app.getHttpServer())
      .post('/verification/challenges')
      .set('x-practice-id', practiceId)
      .send({ patientId, channel: 'in_practice', identifierTypes: ['name', 'date_of_birth', 'address'] })
      .expect(201);

    // Stating the LIVE PMS address passes even though the mirror holds a stale one.
    const res = await request(app.getHttpServer())
      .post(`/verification/challenges/${start.body.challengeId}/attempt`)
      .set('x-practice-id', practiceId)
      .send({
        stated: {
          name: 'Testpatient Alex',
          date_of_birth: '1957-03-14',
          address: '1 Example Street, Sampletown NSW 2000',
        },
      })
      .expect(201);
    expect(res.body.outcome).toBe('passed');
  });

  it('pms_sync_creates_service_records from adapter invoices, idempotently', async () => {
    const first = await request(app.getHttpServer()).post('/pms/sync').set('x-practice-id', practiceId).expect(201);
    expect(first.body.created).toBe(3);

    const second = await request(app.getHttpServer()).post('/pms/sync').set('x-practice-id', practiceId).expect(201);
    expect(second.body.created).toBe(0);
    expect(second.body.updated).toBe(3);

    const records = await prisma.withPractice(practiceId, (tx) => tx.serviceRecord.findMany({}));
    expect(records).toHaveLength(3);
    expect(records.every((r) => r.retentionClockSource === 'conservative_default')).toBe(true); // REQ-INT-04
    expect(records.every((r) => r.patientId === patientId)).toBe(true); // linked by pmsLinkageKey
  });

  it('write_back_lands_the_artefact_in_the_pms (REQ-INT-02) and is evidenced', async () => {
    const draft = await request(app.getHttpServer())
      .post('/agreements')
      .set('x-practice-id', practiceId)
      .send({ type: 'episodic_pre', providerId, patientId, assignorId, assignorIsPatient: true })
      .expect(201);
    const agreementId = draft.body.id;
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/transition`)
      .set('x-practice-id', practiceId)
      .send({ to: 'awaiting_signature' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/particulars`)
      .set('x-practice-id', practiceId)
      .send({ serviceDate: '2026-08-21', basicServiceDescription: 'General practitioner attendance' })
      .expect(201);
    const signed = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/sign`)
      .set('x-practice-id', practiceId)
      /*
       * TAP-TO-APPROVE, because this suite is about WRITE-BACK and not about
       * the mark. A `drawn` signature must now arrive with the strokes and the
       * image it produced (REQ-SIG-01/-02) and is refused without them, which
       * would make this a test of the signature payload by accident.
       */
      .send({ method: 'tap_to_approve', channel: 'in_practice' })
      .expect(201);

    expect(signed.body.status).toBe('stored');
    expect(signed.body.writtenBackAt).toBeTruthy();
    expect(signed.body.pmsDocumentKey).toMatch(/^mock-doc-/);

    const events = await prisma.vaultOutbox.findMany({
      where: { type: 'agreement.written_back', subjectId: agreementId },
    });
    expect(events).toHaveLength(1);
  });

  it('write_back_sweep_retries_unwritten_stored_agreements (FR-9.3)', async () => {
    // Simulate an agreement stored while the PMS was down: clear the write-back marker.
    const agreements = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findMany({ where: { status: 'stored' } }),
    );
    expect(agreements.length).toBeGreaterThan(0);
    await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.update({
        where: { id: agreements[0].id },
        data: { writtenBackAt: null, pmsDocumentKey: null },
      }),
    );

    const { WriteBackService } = await import('../src/pms/write-back.service');
    await app.get(WriteBackService).sweep();

    const after = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreements[0].id } }),
    );
    expect(after?.writtenBackAt).toBeTruthy();
  });
});
