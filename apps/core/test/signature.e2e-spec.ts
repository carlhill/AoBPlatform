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

const PARTICULARS = {
  patientName: 'Alex Testpatient',
  agreementDate: '2026-09-01',
  agreementType: 'episodic_pre',
  serviceDate: '2026-09-01',
  basicServiceDescription: 'General practitioner attendance',
  assignorIsPatient: true,
};

describe('signature capture — the full journey (e2e, real Postgres)', () => {
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
      await tx.practice.create({ data: { id: practiceId, name: 'Signature Test Practice' } });
      providerId = (
        await tx.provider.create({ data: { practiceId, name: 'Dr GP Test', providerType: 'general_practitioner' } })
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

  it('walks draft → remote verify → lock → sign → stored with full evidence binding', async () => {
    // Draft
    const draft = await request(app.getHttpServer())
      .post('/agreements')
      .set('x-practice-id', practiceId)
      .send({ type: 'episodic_pre', providerId, patientId, assignorId, assignorIsPatient: true })
      .expect(201);
    const agreementId = draft.body.id;

    // Remote capture + verification
    const opened = await request(app.getHttpServer())
      .post('/capture')
      .set('x-practice-id', practiceId)
      .send({ agreementId, channel: 'sms_link' })
      .expect(201);
    await request(app.getHttpServer()).get(`/capture/link/${opened.body.token}`).expect(200);
    await request(app.getHttpServer())
      .post(`/capture/link/${opened.body.token}/verify`)
      .send({
        stated: {
          name: 'Testpatient Alex',
          date_of_birth: '1957-03-14',
          address: '1 Example Street, Sampletown NSW 2000',
        },
      })
      .expect(201);

    // Lock → renders and hashes the artefact before signature can enable
    const locked = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/particulars`)
      .set('x-practice-id', practiceId)
      .send({ serviceDate: PARTICULARS.serviceDate, basicServiceDescription: PARTICULARS.basicServiceDescription })
      .expect(201);
    expect(locked.body.renderedArtefactHash).toMatch(/^[0-9a-f]{64}$/);

    // Sign
    const signed = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/sign`)
      .set('x-practice-id', practiceId)
      .send({
        method: 'tap_to_approve',
        channel: 'sms_link',
        captureRequestId: opened.body.captureRequestId,
        deviceFingerprint: 'test-device-1',
      })
      .expect(201);
    expect(signed.body.status).toBe('stored');
    expect(signed.body.signatureEventId).toBeDefined();

    // Signature event binds artefact hash + versions + verification event (REQ-SIG-02)
    const signatureEvents = await prisma.withPractice(practiceId, (tx) =>
      tx.signatureEvent.findMany({ where: { agreementId } }),
    );
    expect(signatureEvents).toHaveLength(1);
    const sig = signatureEvents[0];
    expect(sig.artefactHash).toBe(locked.body.renderedArtefactHash);
    expect(sig.ruleSetVersion).toBe('test-rules-1');
    expect(sig.mappingVersion).toBe('test-mapping-1');
    expect(sig.verificationEventId).toBeTruthy();
    expect(sig.deviceFingerprint).toBe('test-device-1');
    expect(sig.ipAddress).toBeTruthy();

    // Capture request completed
    const captureRows = await prisma.withPractice(practiceId, (tx) =>
      tx.captureRequest.findMany({ where: { agreementId } }),
    );
    expect(captureRows[0].status).toBe('completed');

    // Full evidence trail in the outbox
    const outbox = await prisma.vaultOutbox.findMany({ where: { subjectId: agreementId } });
    expect(outbox.map((r) => r.type)).toEqual(
      expect.arrayContaining([
        'agreement.created',
        'agreement.particulars_locked',
        'agreement.rendered',
        'agreement.signed',
        'agreement.validated',
        'agreement.stored',
      ]),
    );
  });

  // Renderer determinism is covered per-renderer in src/render/renderer.spec.ts.

  it('signing_requires_awaiting_signature_state — a draft cannot be signed', async () => {
    const draft = await request(app.getHttpServer())
      .post('/agreements')
      .set('x-practice-id', practiceId)
      .send({ type: 'episodic_pre', providerId, patientId, assignorId, assignorIsPatient: true })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/agreements/${draft.body.id}/sign`)
      .set('x-practice-id', practiceId)
      .send({ method: 'drawn', channel: 'in_practice' })
      .expect(400);
  });

  it('signature_events_append_only — the DB trigger rejects updates to signature evidence', async () => {
    const events = await prisma.withPractice(practiceId, (tx) => tx.signatureEvent.findMany({ take: 1 }));
    expect(events.length).toBeGreaterThan(0);
    await expect(
      prisma.withPractice(practiceId, (tx) =>
        tx.signatureEvent.update({ where: { id: events[0].id }, data: { method: 'drawn' } }),
      ),
    ).rejects.toThrow(/append-only/);
  });
});
