import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ValidationResponse } from '@aobplatform/contracts';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboundService } from '../src/outbound/outbound.service';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../src/messaging/gateway';

/**
 * The patient approves from a link — CONSULTATION-CAPTURE-PLAN.md §3.3,
 * build-order item 4.
 *
 * WHAT THIS PINS. Nothing about the agreement is readable before the person
 * has proved who they are (REQ-CHILD-04); what they then see is the LOCKED
 * particulars, with item numbers and without a dollar figure (Rule 4); one
 * tap signs, stores, closes the link and writes back; and a used link is a
 * dead link.
 */

const passingRules = {
  validate: async (): Promise<ValidationResponse> => ({
    valid: true,
    results: [],
    ruleSetVersion: 'test-rules-1',
    mappingVersion: 'test-mapping-1',
  }),
};

describe('approving an agreement from a link (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let outbound: OutboundService;
  const practiceId = randomUUID();
  let providerId: string;
  let patientId: string;
  let assignorId: string;
  let agreementId: string;
  let token: string;
  let captureRequestId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RULES_CLIENT)
      .useValue(passingRules)
      .overrideProvider(MESSAGING_GATEWAY)
      .useValue({ mode: 'test', dispatch: async () => ({ accepted: true }) } as MessagingGateway)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    outbound = app.get(OutboundService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'Agree Link Test Practice' } });
      providerId = (
        await tx.provider.create({
          data: { practiceId, name: 'Dr Example Provider', providerType: 'general_practitioner', pmsLinkageKey: 'mock-prov-001' },
        })
      ).id;
      // Linked to the mock adapter's fixture patient, because verification
      // compares the stated values against the LIVE PMS record (ADR A-08).
      patientId = (
        await tx.patient.create({
          data: {
            practiceId,
            familyName: 'Testpatient',
            givenNames: 'Alex',
            dateOfBirth: new Date('1957-03-14'),
            email: 'alex.testpatient@example.invalid',
            pmsLinkageKey: 'mock-pat-001',
          },
        })
      ).id;
      assignorId = (
        await tx.assignor.create({ data: { practiceId, name: 'Alex Testpatient', authorityBasis: 'self' } })
      ).id;
    });

    // The state item 1 leaves behind: a post-agreement draft, a service
    // record behind it, and an open email link.
    const draft = await request(app.getHttpServer())
      .post('/agreements')
      .set('x-practice-id', practiceId)
      .send({ type: 'episodic_post', providerId, patientId, assignorId, assignorIsPatient: true })
      .expect(201);
    agreementId = draft.body.id;
    await prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.create({
        data: {
          practiceId,
          pmsInvoiceKey: 'agree-inv-001',
          patientId,
          providerId,
          serviceDate: new Date('2026-08-20'),
          mbsItemNumbers: ['23', '10990'],
          agreementId,
        },
      }),
    );
    const opened = await request(app.getHttpServer())
      .post('/capture')
      .set('x-practice-id', practiceId)
      .send({ agreementId, channel: 'email_link' })
      .expect(201);
    token = opened.body.token;
    captureRequestId = opened.body.captureRequestId;
  });

  afterAll(async () => {
    await prisma.withPractice(practiceId, async (tx) => {
      // Signature events are NOT deleted: the database refuses ("append-only
      // evidence, REQ-SIG-02"), and that refusal is the feature. They stay,
      // as they would for any real signature.
      await tx.correspondence.deleteMany({});
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
    await app?.close();
  });

  it('shows NOTHING before the person has proved who they are (REQ-CHILD-04)', async () => {
    await request(app.getHttpServer()).get(`/agree/${token}`).expect(409);
    // Their message log names them and what was said to them, so it is closed
    // by the same rule (design P-1, Messages tab).
    await request(app.getHttpServer()).get(`/agree/${token}/messages`).expect(409);
  });

  it('a made-up token names nothing', async () => {
    await request(app.getHttpServer()).get('/agree/not-a-token').expect(404);
  });

  it('after the challenge is passed, shows the LOCKED agreement — item numbers, no dollar amount', async () => {
    const landing = await request(app.getHttpServer()).get(`/capture/link/${token}`).expect(200);
    expect(landing.body.identifierTypes).toEqual(['name', 'date_of_birth', 'address']);
    // Content-blind: the landing names nobody.
    expect(JSON.stringify(landing.body)).not.toContain('Testpatient');

    const verified = await request(app.getHttpServer())
      .post(`/capture/link/${token}/verify`)
      .send({ stated: { name: 'Testpatient Alex', date_of_birth: '1957-03-14', address: '1 Example Street, Sampletown NSW 2000' } })
      .expect(201);
    expect(verified.body.outcome).toBe('passed');

    const res = await request(app.getHttpServer()).get(`/agree/${token}`).expect(200);
    expect(res.body.state).toBe('ready');
    expect(res.body.particulars.practiceName).toBe('Agree Link Test Practice');
    expect(res.body.particulars.providerName).toBe('Dr Example Provider');
    expect(res.body.particulars.serviceDate).toBe('2026-08-20');
    expect(res.body.particulars.mbsItemNumbers).toEqual(['23', '10990']);
    expect(res.body.particulars.patientName).toBe('Alex Testpatient');
    // Rule 4: nothing about money, under any name.
    // Whole words, so a random id or hash containing the hex run "fee" (seen
    // in CI: ...bfee-...) cannot trip the guard. The rule it protects is real
    // (rule 4 — no benefit amount on any agreement artefact); the regex was not.
    expect(JSON.stringify(res.body)).not.toMatch(/\b(benefit|amount|cents|fee)\b|\$/i);
    // Locked and hashed on this read — what is shown is what will be signed.
    expect(res.body.particulars.artefactSha256).toMatch(/^[0-9a-f]{64}$/);
    const locked = await prisma.withPractice(practiceId, (tx) => tx.agreement.findFirst({ where: { id: agreementId } }));
    expect(locked?.particularsLockedAt).not.toBeNull();
    expect(locked?.status).toBe('awaiting_signature');
  });

  it('reading it again does not lock it again (HARD-02), and shows the same hash', async () => {
    const again = await request(app.getHttpServer()).get(`/agree/${token}`).expect(200);
    const first = await prisma.withPractice(practiceId, (tx) => tx.agreement.findFirst({ where: { id: agreementId } }));
    expect(again.body.particulars.artefactSha256).toBe(first?.renderedArtefactHash);
  });

  it('refuses any method but tap_to_approve from a link', async () => {
    await request(app.getHttpServer()).post(`/agree/${token}/approve`).send({ method: 'drawn' }).expect(400);
  });

  it('one tap: signed, validated, stored, the link closed, written back', async () => {
    const res = await request(app.getHttpServer())
      .post(`/agree/${token}/approve`)
      .send({ method: 'tap_to_approve' })
      .expect(201);
    expect(res.body.approved).toBe(true);
    expect(res.body.status).toBe('stored');
    // The copy landed at once here (the patient is linked to the PMS record).
    // The page reads this to say "has gone" rather than "will be placed".
    expect(res.body.writtenBack).toBe(true);

    const signature = await prisma.withPractice(practiceId, (tx) => tx.signatureEvent.findFirst({ where: { agreementId } }));
    expect(signature?.method).toBe('tap_to_approve');
    expect(signature?.channel).toBe('email_link'); // the channel the link actually came by
    expect(signature?.captureRequestId).toBe(captureRequestId);
    expect(signature?.verificationEventId).toBeTruthy(); // bound to the proof of identity

    const req = await prisma.withPractice(practiceId, (tx) => tx.captureRequest.findFirst({ where: { id: captureRequestId } }));
    expect(req?.status).toBe('completed');

    const stored = await prisma.withPractice(practiceId, (tx) => tx.agreement.findFirst({ where: { id: agreementId } }));
    expect(stored?.status).toBe('stored');
    expect(stored?.pmsDocumentKey).toMatch(/^mock-doc-/); // REQ-INT-02, via the mock adapter
  });

  it('a used link is a dead link', async () => {
    await request(app.getHttpServer()).get(`/agree/${token}`).expect(410);
    await request(app.getHttpServer()).post(`/agree/${token}/approve`).send({ method: 'tap_to_approve' }).expect(410);
  });

  /*
   * P-1, Messages tab — "the same rows for their own records ... one log with
   * two audiences, not two logs".
   *
   * Deliberately AFTER signing: reading what was sent to you is the one thing
   * that stays useful once the link has done its job, so a completed request
   * still answers here where `/agree/:token` is a dead link.
   */
  it('the patient reads their own half of the log, still, after signing — and only theirs', async () => {
    const otherPatientId = await prisma.withPractice(practiceId, async (tx) =>
      (
        await tx.patient.create({
          data: { practiceId, familyName: 'Notthem', givenNames: 'Someone', dateOfBirth: new Date('1980-01-01') },
        })
      ).id,
    );
    // Through the sender, because the database refuses a correspondence row
    // that mirrors no send — that constraint is the whole point of the table.
    await prisma.withPractice(practiceId, async (tx) => {
      await outbound.enqueue(tx, {
        practiceId,
        channel: 'email',
        destination: 'alex.testpatient@example.invalid',
        subjectType: 'CaptureRequest',
        subjectId: captureRequestId,
        recipientType: 'patient',
        recipientId: patientId,
        recipientName: 'Alex Testpatient',
        payload: { subject: 'Please confirm your bulk-billing agreement', body: 'Open the link.' },
      });
      await outbound.enqueue(tx, {
        practiceId,
        channel: 'email',
        destination: 'someone@example.invalid',
        subjectType: 'CaptureRequest',
        subjectId: randomUUID(),
        recipientType: 'patient',
        recipientId: otherPatientId,
        recipientName: 'Someone Notthem',
        payload: { subject: 'Not for Alex', body: 'Not for Alex.' },
      });
    });

    const res = await request(app.getHttpServer()).get(`/agree/${token}/messages`).expect(200);
    expect(res.body.practiceName).toBe('Agree Link Test Practice');
    expect(res.body.messages.length).toBeGreaterThan(0);
    expect(res.body.messages.every((m: { recipientId: string }) => m.recipientId === patientId)).toBe(true);
    // Not a word about anybody else, and not a cost.
    expect(JSON.stringify(res.body)).not.toContain('Notthem');
    expect(JSON.stringify(res.body)).not.toMatch(/cost|\$/i);
  });

  it('a made-up token reads nobody’s messages', async () => {
    await request(app.getHttpServer()).get('/agree/not-a-token/messages').expect(404);
  });
});
