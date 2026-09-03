import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('M7 reconciliation queue (e2e, real Postgres + mock adapter)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const practiceId = randomUUID();
  let patientId: string;
  let confidentialPatientId: string;
  let providerId: string;
  let assignorId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'Reconciliation Test Practice' } });
      providerId = (
        await tx.provider.create({
          data: { practiceId, name: 'Dr Example Provider', providerType: 'general_practitioner', pmsLinkageKey: 'mock-prov-001' },
        })
      ).id;
      patientId = (
        await tx.patient.create({
          data: {
            practiceId,
            familyName: 'Testpatient',
            givenNames: 'Alex',
            dateOfBirth: new Date('1957-03-14'),
            pmsLinkageKey: 'mock-pat-001',
          },
        })
      ).id;
      confidentialPatientId = (
        await tx.patient.create({
          data: {
            practiceId,
            familyName: 'Quietpatient',
            givenNames: 'Jordan',
            dateOfBirth: new Date('2010-01-15'),
            confidentialityFlag: true,
          },
        })
      ).id;
      assignorId = (
        await tx.assignor.create({ data: { practiceId, name: 'Alex Testpatient', authorityBasis: 'self' } })
      ).id;
    });

    // Pull the mock adapter's three fixture invoices (standard / urgent / expired bands).
    await request(app.getHttpServer()).post('/pms/sync').set('x-practice-id', practiceId).expect(201);
  });

  afterAll(async () => {
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.captureRequest.deleteMany({});
      await tx.verificationChallenge.deleteMany({});
      await tx.serviceRecord.deleteMany({});
      await tx.agreement.deleteMany({});
      await tx.assignor.deleteMany({});
      await tx.patient.deleteMany({});
      await tx.provider.deleteMany({});
      await tx.practice.deleteMany({});
    });
    await prisma.vaultOutbox.deleteMany({});
    await app.close();
  });

  it('outstanding_queue_ranked_by_lodgement_urgency (REQ-REC-01/REQ-CHASE-05) — most urgent first, banded', async () => {
    const res = await request(app.getHttpServer())
      .get('/reconciliation/outstanding')
      .set('x-practice-id', practiceId)
      .expect(200);
    expect(res.body).toHaveLength(3);
    const bands = res.body.map((i: { band: string }) => i.band);
    expect(bands).toEqual(['expired', 'urgent', 'standard']); // ascending days remaining
    const daysRemaining = res.body.map((i: { daysRemaining: number }) => i.daysRemaining);
    expect([...daysRemaining].sort((a, b) => a - b)).toEqual(daysRemaining);
    expect(res.body[0].revenueForgone).toBe(true);
    expect(res.body.every((i: { needsAgreement: boolean }) => i.needsAgreement)).toBe(true);
    // The queue screen shows a person, not an id — initial and family name, as the wireframe draws it.
    expect(res.body.every((i: { patientName: string }) => i.patientName === 'A. Testpatient')).toBe(true);
    expect(res.body.every((i: { providerName: string }) => i.providerName === 'Dr Example Provider')).toBe(true);
  });

  it('one item in full — what was tried, what the band allows, what comes next (queue wireframe R-2)', async () => {
    const queue = await request(app.getHttpServer()).get('/reconciliation/outstanding').set('x-practice-id', practiceId).expect(200);
    const standard = queue.body.find((i: { band: string }) => i.band === 'standard');
    const res = await request(app.getHttpServer())
      .get(`/reconciliation/${standard.serviceRecordId}`)
      .set('x-practice-id', practiceId)
      .expect(200);
    expect(res.body.band).toBe('standard');
    expect(res.body.patient.name).toBe('Alex Testpatient');
    expect(res.body.policy.escalation).toEqual(['ai', 'ai', 'human']);
    expect(res.body.attemptsMade).toBe(0);
    expect(res.body.nextStep).toBe('ai');
    expect(res.body.attemptAllowed).toBe(true);
    expect(res.body.attempts).toEqual([]);

    const expired = queue.body.find((i: { band: string }) => i.band === 'expired');
    const dead = await request(app.getHttpServer())
      .get(`/reconciliation/${expired.serviceRecordId}`)
      .set('x-practice-id', practiceId)
      .expect(200);
    expect(dead.body.nextStep).toBeNull(); // REQ-CHASE-08
    expect(dead.body.attemptAllowed).toBe(false);
  });

  it('never_chase_past_the_deadline (REQ-CHASE-08) — resend on an expired item is refused', async () => {
    const queue = await request(app.getHttpServer())
      .get('/reconciliation/outstanding')
      .set('x-practice-id', practiceId)
      .expect(200);
    const expired = queue.body.find((i: { band: string }) => i.band === 'expired');
    const res = await request(app.getHttpServer())
      .post(`/reconciliation/${expired.serviceRecordId}/resend`)
      .set('x-practice-id', practiceId)
      .send({ channel: 'sms_link' })
      .expect(400);
    expect(res.body.message).toContain('REQ-CHASE-08');
  });

  it('confidentiality_flag_suppresses_outbound_chase (REQ-CHASE-03)', async () => {
    // A service record for the confidentiality-flagged patient, well inside the window.
    const recordId = randomUUID();
    await prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.create({
        data: {
          id: recordId,
          practiceId,
          pmsInvoiceKey: 'confidential-inv-001',
          patientId: confidentialPatientId,
          providerId,
          serviceDate: new Date(Date.now() - 30 * 86_400_000),
          mbsItemNumbers: ['23'],
        },
      }),
    );
    const queue = await request(app.getHttpServer())
      .get('/reconciliation/outstanding')
      .set('x-practice-id', practiceId)
      .expect(200);
    const item = queue.body.find((i: { serviceRecordId: string }) => i.serviceRecordId === recordId);
    expect(item.outboundChaseSuppressed).toBe(true);

    const res = await request(app.getHttpServer())
      .post(`/reconciliation/${recordId}/resend`)
      .set('x-practice-id', practiceId)
      .send({ channel: 'sms_link' })
      .expect(400);
    expect(res.body.message).toContain('REQ-CHASE-03');
  });

  it('one-click resend opens a capture request when an agreement exists in a chaseable band', async () => {
    const draft = await request(app.getHttpServer())
      .post('/agreements')
      .set('x-practice-id', practiceId)
      .send({ type: 'episodic_post', providerId, patientId, assignorId, assignorIsPatient: true })
      .expect(201);
    // Link the urgent-band record to this agreement.
    const queue = await request(app.getHttpServer())
      .get('/reconciliation/outstanding')
      .set('x-practice-id', practiceId)
      .expect(200);
    const urgent = queue.body.find((i: { band: string }) => i.band === 'urgent');
    await prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.update({ where: { id: urgent.serviceRecordId }, data: { agreementId: draft.body.id } }),
    );

    const res = await request(app.getHttpServer())
      .post(`/reconciliation/${urgent.serviceRecordId}/resend`)
      .set('x-practice-id', practiceId)
      .send({ channel: 'sms_link' })
      .expect(201);
    expect(res.body.token).toBeDefined();
  });

  it('metrics expose band counts, capture rate, and the verbal countdown (REQ-MON-01 subset)', async () => {
    const res = await request(app.getHttpServer())
      .get('/reconciliation/metrics')
      .set('x-practice-id', practiceId)
      .expect(200);
    expect(res.body.byBand.expired).toBe(1);
    expect(res.body.byBand.urgent).toBeGreaterThanOrEqual(1);
    expect(res.body.revenueForgoneCount).toBe(1);
    expect(res.body.verbalUsage.daysUntilVerbalFallbackEnds).toBeGreaterThan(0);
    expect(res.body.outstanding).toBeGreaterThanOrEqual(3);
  });
});
