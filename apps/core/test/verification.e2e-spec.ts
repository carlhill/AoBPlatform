import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { LOCKOUT_AFTER_ATTEMPTS } from '../src/verification/verification.service';

describe('M3 verification (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const practiceId = randomUUID();
  let patientId: string;

  const statedCorrect = {
    name: 'Testpatient Alex',
    date_of_birth: '1957-03-14',
    address: '1 Example Street, Sampletown NSW 2000',
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'Verification Test Practice' } });
      const patient = await tx.patient.create({
        data: {
          practiceId,
          familyName: 'Testpatient',
          givenNames: 'Alex',
          dateOfBirth: new Date('1957-03-14'),
          address: '1 Example Street, Sampletown NSW 2000',
        },
      });
      patientId = patient.id;
    });
  });

  afterAll(async () => {
    // Verification events are deliberately NOT deleted — the append-only
    // trigger forbids it, which is the behaviour under test. Evidence stays.
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.verificationChallenge.deleteMany({});
      await tx.patient.deleteMany({});
      await tx.practice.deleteMany({});
    });
    await prisma.vaultOutbox.deleteMany({});
    await app.close();
  });

  async function startChallenge(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/verification/challenges')
      .set('x-practice-id', practiceId)
      .send({ patientId, channel: 'sms_link', identifierTypes: ['name', 'date_of_birth', 'address'] })
      .expect(201);
    return res.body.challengeId;
  }

  it('medicare_number_rejected_as_identifier — challenge config cannot include it, non-configurably', async () => {
    const res = await request(app.getHttpServer())
      .post('/verification/challenges')
      .set('x-practice-id', practiceId)
      .send({ patientId, channel: 'sms_link', identifierTypes: ['name', 'date_of_birth', 'medicare_number'] })
      .expect(400);
    expect(res.body.message).toContain('not an approved patient identifier');
  });

  it('rejects fewer than three identifiers (REQ-VER-01 floor)', async () => {
    await request(app.getHttpServer())
      .post('/verification/challenges')
      .set('x-practice-id', practiceId)
      .send({ patientId, channel: 'sms_link', identifierTypes: ['name', 'date_of_birth'] })
      .expect(400);
  });

  it('passes a correct three-identifier statement and issues a verification event', async () => {
    const challengeId = await startChallenge();
    const res = await request(app.getHttpServer())
      .post(`/verification/challenges/${challengeId}/attempt`)
      .set('x-practice-id', practiceId)
      .send({ stated: statedCorrect })
      .expect(201);
    expect(res.body.outcome).toBe('passed');
    expect(res.body.verificationEventId).toBeDefined();
  });

  it('no_partial_match_disclosure — a failed attempt never says which identifier failed (REQ-SEC-07)', async () => {
    const challengeId = await startChallenge();
    const res = await request(app.getHttpServer())
      .post(`/verification/challenges/${challengeId}/attempt`)
      .set('x-practice-id', practiceId)
      .send({ stated: { ...statedCorrect, date_of_birth: '1990-01-01' } })
      .expect(201);
    expect(res.body.outcome).toBe('failed');
    const body = JSON.stringify(res.body).toLowerCase();
    expect(body).not.toContain('date');
    expect(body).not.toContain('birth');
    expect(body).not.toContain('name');
    expect(body).not.toContain('address');
  });

  it('verification_logs_store_types_not_values — no stated or held value reaches the DB or the vault outbox', async () => {
    const challengeId = await startChallenge();
    await request(app.getHttpServer())
      .post(`/verification/challenges/${challengeId}/attempt`)
      .set('x-practice-id', practiceId)
      .send({ stated: statedCorrect })
      .expect(201);

    const events = await prisma.withPractice(practiceId, (tx) =>
      tx.verificationEvent.findMany({ where: { challengeId } }),
    );
    const serialisedEvents = JSON.stringify(events);
    expect(serialisedEvents).toContain('name'); // the TYPE is recorded…
    expect(serialisedEvents).not.toContain('Testpatient'); // …the VALUE never is
    expect(serialisedEvents).not.toContain('1957-03-14');
    expect(serialisedEvents).not.toContain('Example Street');

    const outbox = await prisma.vaultOutbox.findMany({ where: { type: { startsWith: 'verification.' } } });
    const serialisedOutbox = JSON.stringify(outbox);
    expect(serialisedOutbox).not.toContain('Testpatient');
    expect(serialisedOutbox).not.toContain('1957-03-14');
    expect(serialisedOutbox).not.toContain('Example Street');
  });

  it(`lockout_after_${LOCKOUT_AFTER_ATTEMPTS}_failed_attempts — then locked, even with correct details`, async () => {
    const challengeId = await startChallenge();
    for (let i = 0; i < LOCKOUT_AFTER_ATTEMPTS; i++) {
      await request(app.getHttpServer())
        .post(`/verification/challenges/${challengeId}/attempt`)
        .set('x-practice-id', practiceId)
        .send({ stated: { ...statedCorrect, name: 'Wrong Person' } })
        .expect(201);
    }
    const locked = await request(app.getHttpServer())
      .post(`/verification/challenges/${challengeId}/attempt`)
      .set('x-practice-id', practiceId)
      .send({ stated: statedCorrect })
      .expect(201);
    expect(locked.body.outcome).toBe('locked_out');
  });

  it('verification_events_append_only — the DB trigger rejects updates to evidence', async () => {
    const events = await prisma.withPractice(practiceId, (tx) => tx.verificationEvent.findMany({ take: 1 }));
    expect(events.length).toBeGreaterThan(0);
    await expect(
      prisma.withPractice(practiceId, (tx) =>
        tx.verificationEvent.update({ where: { id: events[0].id }, data: { outcome: 'passed' } }),
      ),
    ).rejects.toThrow(/append-only/);
  });
});
