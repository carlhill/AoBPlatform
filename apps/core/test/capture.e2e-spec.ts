import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('M2 capture cascade (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const practiceId = randomUUID();
  let providerId: string;
  let patientId: string;
  let assignorId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'Capture Test Practice' } });
      providerId = (
        await tx.provider.create({
          data: { practiceId, name: 'Dr GP Test', providerType: 'general_practitioner' },
        })
      ).id;
      patientId = (
        await tx.patient.create({
          data: {
            practiceId,
            familyName: 'Testpatient',
            givenNames: 'Alex',
            dateOfBirth: new Date('1957-03-14'),
            address: '1 Example Street, Sampletown NSW 2000',
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

  async function createDraft(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/agreements')
      .set('x-practice-id', practiceId)
      .send({ type: 'episodic_pre', providerId, patientId, assignorId, assignorIsPatient: true })
      .expect(201);
    return res.body.id;
  }

  it('remote link journey: open → content-blind landing → verify → awaiting_signature', async () => {
    const agreementId = await createDraft();
    const opened = await request(app.getHttpServer())
      .post('/capture')
      .set('x-practice-id', practiceId)
      .send({ agreementId, channel: 'sms_link' })
      .expect(201);
    expect(opened.body.token).toBeDefined();

    // Landing is content-blind (REQ-CHILD-04): no patient, provider or practice names.
    const landing = await request(app.getHttpServer()).get(`/capture/link/${opened.body.token}`).expect(200);
    expect(landing.body.identifierTypes).toEqual(['name', 'date_of_birth', 'address']);
    const landingBody = JSON.stringify(landing.body);
    expect(landingBody).not.toContain('Testpatient');
    expect(landingBody).not.toContain('Dr GP Test');
    expect(landingBody).not.toContain('Capture Test Practice');

    const verified = await request(app.getHttpServer())
      .post(`/capture/link/${opened.body.token}/verify`)
      .send({
        stated: {
          name: 'Testpatient Alex',
          date_of_birth: '1957-03-14',
          address: '1 Example Street, Sampletown NSW 2000',
        },
      })
      .expect(201);
    expect(verified.body.outcome).toBe('passed');

    const agreement = await request(app.getHttpServer())
      .get(`/agreements/${agreementId}`)
      .set('x-practice-id', practiceId)
      .expect(200);
    expect(agreement.body.status).toBe('awaiting_signature');
    expect(agreement.body.verificationEventId).toBeDefined();
  });

  it('capture_tokens_non_enumerable — a guessed or malformed token is a plain 404', async () => {
    await request(app.getHttpServer()).get('/capture/link/not-a-token').expect(404);
    const fakePractice = Buffer.from(randomUUID(), 'utf8').toString('base64url');
    await request(app.getHttpServer())
      .get(`/capture/link/${fakePractice}.${'a'.repeat(43)}`)
      .expect(404);
  });

  it('capture_tokens_never_stored_raw — only the hash exists in the database', async () => {
    const agreementId = await createDraft();
    const opened = await request(app.getHttpServer())
      .post('/capture')
      .set('x-practice-id', practiceId)
      .send({ agreementId, channel: 'email_link' })
      .expect(201);
    const secret = (opened.body.token as string).split('.')[1];
    const rows = await prisma.withPractice(practiceId, (tx) =>
      tx.captureRequest.findMany({ where: { agreementId } }),
    );
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('one_open_request_per_channel — duplicate channel refused, second channel allowed (FR-2.7, C3.2)', async () => {
    const agreementId = await createDraft();
    await request(app.getHttpServer())
      .post('/capture')
      .set('x-practice-id', practiceId)
      .send({ agreementId, channel: 'sms_link' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/capture')
      .set('x-practice-id', practiceId)
      .send({ agreementId, channel: 'sms_link' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/capture')
      .set('x-practice-id', practiceId)
      .send({ agreementId, channel: 'email_link' })
      .expect(201);
  });

  it('first_completed_channel_wins — completing one cancels every other open request (C3.2)', async () => {
    const agreementId = await createDraft();
    const sms = await request(app.getHttpServer())
      .post('/capture')
      .set('x-practice-id', practiceId)
      .send({ agreementId, channel: 'sms_link' })
      .expect(201);
    const email = await request(app.getHttpServer())
      .post('/capture')
      .set('x-practice-id', practiceId)
      .send({ agreementId, channel: 'email_link' })
      .expect(201);

    const completed = await request(app.getHttpServer())
      .post(`/capture/${sms.body.captureRequestId}/complete`)
      .set('x-practice-id', practiceId)
      .expect(201);
    expect(completed.body.cancelled).toContain(email.body.captureRequestId);

    const used = await request(app.getHttpServer()).get(`/capture/link/${sms.body.token}`).expect(410);
    expect(used.body.message).toContain('used');
  });

  it('expired_links_close_and_are_evidenced — the sweep expires overdue links (single-use, short-lived)', async () => {
    const agreementId = await createDraft();
    const opened = await request(app.getHttpServer())
      .post('/capture')
      .set('x-practice-id', practiceId)
      .send({ agreementId, channel: 'sms_link' })
      .expect(201);
    await prisma.withPractice(practiceId, (tx) =>
      tx.captureRequest.update({
        where: { id: opened.body.captureRequestId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      }),
    );
    const { CaptureService } = await import('../src/capture/capture.service');
    await app.get(CaptureService).expireSweep();
    await request(app.getHttpServer()).get(`/capture/link/${opened.body.token}`).expect(410);
    const events = await prisma.vaultOutbox.findMany({
      where: { type: 'capture.expired', subjectId: opened.body.captureRequestId },
    });
    expect(events).toHaveLength(1);
  });

  it('lockout marks the agreement verification_failed', async () => {
    const agreementId = await createDraft();
    const opened = await request(app.getHttpServer())
      .post('/capture')
      .set('x-practice-id', practiceId)
      .send({ agreementId, channel: 'sms_link' })
      .expect(201);
    await request(app.getHttpServer()).get(`/capture/link/${opened.body.token}`).expect(200);
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post(`/capture/link/${opened.body.token}/verify`)
        .send({ stated: { name: 'Wrong', date_of_birth: '1900-01-01', address: 'nowhere' } })
        .expect(201);
    }
    const agreement = await request(app.getHttpServer())
      .get(`/agreements/${agreementId}`)
      .set('x-practice-id', practiceId)
      .expect(200);
    expect(agreement.body.status).toBe('verification_failed');
  });
});
