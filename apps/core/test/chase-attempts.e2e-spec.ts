import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * The human half of the chase ladder (Carl, 3 Sep 2026): "we need an
 * audit-trail to show that a practice-user called the Patient, sent SMS /
 * email and so on ... The Practice will chase as they will not get paid
 * otherwise."
 */

/** The receptionist who rings. Null = nobody signed in. */
const RECEPTIONIST = {
  sub: '00000000-0000-4000-8000-0000000cha5e',
  principalType: 'staff',
  roles: [],
  preferredUsername: 'jo.reception',
  raw: {},
};
let currentPrincipal: Record<string, unknown> | null = null;

describe('chase attempts — what a PERSON at the practice did (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const practiceId = randomUUID();
  const otherPracticeId = randomUUID();
  let patientId: string;
  let providerId: string;
  let assignorId: string;
  let standardRecordId: string;
  let expiredRecordId: string;
  let agreementId: string;

  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // Middleware, not a header: `request.principal` is a property on the
    // Express request, so nothing a client sends can produce one.
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      if (currentPrincipal) req.principal = currentPrincipal;
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'Chase Trail Test Practice' } });
      providerId = (
        await tx.provider.create({
          data: {
            practiceId,
            name: 'Dr Chase Example',
            providerType: 'general_practitioner',
            pmsLinkageKey: `chase-prov-${practiceId.slice(0, 8)}`,
          },
        })
      ).id;
      patientId = (
        await tx.patient.create({
          data: {
            practiceId,
            familyName: 'Unreachable',
            givenNames: 'Robin',
            dateOfBirth: new Date('1962-11-02'),
            pmsLinkageKey: `chase-pat-${practiceId.slice(0, 8)}`,
          },
        })
      ).id;
      assignorId = (await tx.assignor.create({ data: { practiceId, name: 'Robin Unreachable', authorityBasis: 'self' } })).id;
      standardRecordId = (
        await tx.serviceRecord.create({
          data: {
            practiceId,
            pmsInvoiceKey: `chase-inv-standard-${practiceId.slice(0, 8)}`,
            patientId,
            providerId,
            serviceDate: daysAgo(20), // ~345 days remaining — standard band
            mbsItemNumbers: ['23'],
          },
        })
      ).id;
      expiredRecordId = (
        await tx.serviceRecord.create({
          data: {
            practiceId,
            pmsInvoiceKey: `chase-inv-expired-${practiceId.slice(0, 8)}`,
            patientId,
            providerId,
            serviceDate: daysAgo(400), // past the twelve-month lodgement window
            mbsItemNumbers: ['23'],
          },
        })
      ).id;
    });

    await prisma.withPractice(otherPracticeId, async (tx) => {
      await tx.practice.create({ data: { id: otherPracticeId, name: 'Another Practice Entirely' } });
    });
  });

  afterAll(async () => {
    // chase_attempts is append-only and the runtime role holds no DELETE on
    // it, so the rows this suite writes stay — as evidence should. Everything
    // they point at stays with them.
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.captureRequest.deleteMany({});
      await tx.agreement.deleteMany({});
      await tx.assignor.deleteMany({});
    });
    await prisma.vaultOutbox.deleteMany({ where: { subjectId: { in: [standardRecordId, expiredRecordId] } } });
    await app.close();
  });

  it('needs a signed-in person — an attempt attributed to nobody is not evidence', async () => {
    currentPrincipal = null;
    const res = await request(app.getHttpServer())
      .post('/chase-attempts')
      .set('x-practice-id', practiceId)
      .send({ subjectType: 'ServiceRecord', subjectId: standardRecordId, channel: 'phone', outcome: 'no_answer' })
      .expect(400);
    expect(res.body.message).toMatch(/signed-in person/);
  });

  it('acting_person_comes_from_the_session_not_the_body', async () => {
    currentPrincipal = RECEPTIONIST;
    const res = await request(app.getHttpServer())
      .post('/chase-attempts')
      .set('x-practice-id', practiceId)
      .send({
        subjectType: 'ServiceRecord',
        subjectId: standardRecordId,
        channel: 'phone',
        outcome: 'left_message',
        contactedPartyType: 'patient',
        note: 'Left a voicemail asking them to call back about the bulk-billing form.',
        // Everything below is a lie a client can tell. None of it may land.
        attemptedBy: 'Dr Somebody Else',
        attemptedById: '11111111-1111-4111-8111-111111111111',
        by: 'Not Me',
      })
      .expect(201);
    expect(res.body.by).toBe('jo.reception');
    expect(res.body.byId).toBe(RECEPTIONIST.sub);
    expect(res.body.channel).toBe('phone');
    expect(res.body.outcome).toBe('left_message');
    expect(res.body.attemptOrdinal).toBe(1);
    expect(res.body.band).toBe('standard');

    const row = await prisma.withPractice(practiceId, (tx) => tx.chaseAttempt.findFirst({ where: { id: res.body.id } }));
    expect(row?.attemptedBy).toBe('jo.reception');
    expect(row?.attemptedById).toBe(RECEPTIONIST.sub);
  });

  it('writes its vault event through the outbox, carrying types and outcomes but no note text (rule 11, REQ-VER-04)', async () => {
    const events = await prisma.vaultOutbox.findMany({ where: { type: 'chase.attempted', subjectId: standardRecordId } });
    expect(events).toHaveLength(1);
    const payload = events[0].payload as Record<string, unknown>;
    expect(events[0].subjectType).toBe('ServiceRecord');
    expect(payload.channel).toBe('phone');
    expect(payload.outcome).toBe('left_message');
    expect(payload.contactedPartyType).toBe('patient');
    expect(payload.by).toBe('human');
    expect(payload.noteRecorded).toBe(true);
    // The note itself never travels, and neither does anything that could
    // identify the patient by content.
    expect(JSON.stringify(payload)).not.toContain('voicemail');
    expect(JSON.stringify(payload)).not.toContain('Unreachable');
  });

  it('the trail counts automated and human attempts on ONE ladder (REQ-CHASE-05)', async () => {
    currentPrincipal = RECEPTIONIST;
    const draft = await request(app.getHttpServer())
      .post('/agreements')
      .set('x-practice-id', practiceId)
      .send({ type: 'episodic_post', providerId, patientId, assignorId, assignorIsPatient: true })
      .expect(201);
    agreementId = draft.body.id;
    await prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.update({ where: { id: standardRecordId }, data: { agreementId } }),
    );
    // One automated attempt: a capture link.
    await request(app.getHttpServer())
      .post(`/reconciliation/${standardRecordId}/resend`)
      .set('x-practice-id', practiceId)
      .send({ channel: 'sms_link' })
      .expect(201);

    const trail = await request(app.getHttpServer())
      .get(`/chase-attempts/ServiceRecord/${standardRecordId}`)
      .set('x-practice-id', practiceId)
      .expect(200);
    expect(trail.body.humanAttempts).toBe(1);
    expect(trail.body.automatedAttempts).toBe(1);
    expect(trail.body.attemptsMade).toBe(2);
    expect(trail.body.band).toBe('standard');
    expect(trail.body.policy.escalation).toEqual(['ai', 'ai', 'human']);
    expect(trail.body.nextStep).toBe('human'); // third rung on the standard band
    expect(trail.body.attemptAllowed).toBe(true);
    expect(trail.body.attempts).toHaveLength(1);
    expect(trail.body.attempts[0].by).toBe('jo.reception');
  });

  it('stops at the band cap, using the same rule as the automated cascade (REQ-CHASE-09)', async () => {
    currentPrincipal = RECEPTIONIST;
    // Two attempts on the ladder already; this is the third and last.
    await request(app.getHttpServer())
      .post('/chase-attempts')
      .set('x-practice-id', practiceId)
      .send({ subjectType: 'ServiceRecord', subjectId: standardRecordId, channel: 'in_person', outcome: 'reached' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/chase-attempts')
      .set('x-practice-id', practiceId)
      .send({ subjectType: 'ServiceRecord', subjectId: standardRecordId, channel: 'post', outcome: 'no_answer' })
      .expect(400);
    expect(res.body.message).toMatch(/attempts are used up/);
  });

  it('never_chase_past_the_deadline (REQ-CHASE-08) — the expired band records no attempt at all', async () => {
    currentPrincipal = RECEPTIONIST;
    const res = await request(app.getHttpServer())
      .post('/chase-attempts')
      .set('x-practice-id', practiceId)
      .send({ subjectType: 'ServiceRecord', subjectId: expiredRecordId, channel: 'phone', outcome: 'no_answer' })
      .expect(400);
    expect(res.body.message).toMatch(/REQ-CHASE-08/);
  });

  it('eightynineAA_notice_can_never_be_chased (rule 7, REQ-CHASE-02, REQ-END-05)', async () => {
    currentPrincipal = RECEPTIONIST;
    // 1. The DTO will not take the subject type at all.
    const viaApi = await request(app.getHttpServer())
      .post('/chase-attempts')
      .set('x-practice-id', practiceId)
      .send({ subjectType: 'Notice', subjectId: randomUUID(), channel: 'phone', outcome: 'no_answer' })
      .expect(400);
    expect(JSON.stringify(viaApi.body.message)).toMatch(/subjectType/);

    // 2. Nor will reading a trail for one.
    await request(app.getHttpServer())
      .get(`/chase-attempts/Notice/${randomUUID()}`)
      .set('x-practice-id', practiceId)
      .expect(400);

    // 3. And the DATABASE refuses it, so no future code path can slip one in.
    await expect(
      prisma.withPractice(practiceId, (tx) =>
        tx.chaseAttempt.create({
          data: {
            practiceId,
            subjectType: 'Notice',
            subjectId: randomUUID(),
            channel: 'phone',
            outcome: 'no_answer',
            attemptedBy: 'jo.reception',
            attemptedById: RECEPTIONIST.sub,
            band: 'standard',
            daysRemaining: 300,
            attemptOrdinal: 1,
          },
        }),
      ),
    ).rejects.toThrow(/chase_attempts_subject_never_a_notice|violates check constraint/);
  });

  it('is append-only, enforced by the database — a correction is a new row', async () => {
    const [existing] = await prisma.withPractice(practiceId, (tx) =>
      tx.chaseAttempt.findMany({ where: { subjectId: standardRecordId }, orderBy: { occurredAt: 'asc' } }),
    );
    // No UPDATE: the runtime role does not hold the privilege, and a trigger
    // refuses it even for a role that does.
    await expect(
      prisma.withPractice(practiceId, (tx) =>
        tx.chaseAttempt.update({ where: { id: existing.id }, data: { outcome: 'reached' } }),
      ),
    ).rejects.toThrow(/append-only|permission denied/);
    // No DELETE either.
    await expect(
      prisma.withPractice(practiceId, (tx) => tx.chaseAttempt.delete({ where: { id: existing.id } })),
    ).rejects.toThrow(/append-only|permission denied/);

    // The supported way: supersede, with a reason, and both rows stay visible.
    currentPrincipal = RECEPTIONIST;
    const correction = await request(app.getHttpServer())
      .post('/chase-attempts')
      .set('x-practice-id', practiceId)
      .send({
        subjectType: 'ServiceRecord',
        subjectId: standardRecordId,
        channel: 'phone',
        outcome: 'wrong_contact',
        note: 'Recorded as a voicemail; it was the wrong number and the message was left with a stranger.',
        supersedesId: existing.id,
      })
      .expect(201);
    expect(correction.body.supersedesId).toBe(existing.id);

    const trail = await request(app.getHttpServer())
      .get(`/chase-attempts/ServiceRecord/${standardRecordId}`)
      .set('x-practice-id', practiceId)
      .expect(200);
    const superseded = trail.body.attempts.find((a: { id: string }) => a.id === existing.id);
    expect(superseded.superseded).toBe(true);
    expect(superseded.outcome).toBe('left_message'); // the original claim survives, untouched
    expect(trail.body.attempts.some((a: { id: string }) => a.id === correction.body.id)).toBe(true);
    // A correction replaces a rung rather than adding one.
    expect(trail.body.humanAttempts).toBe(2);
  });

  it('a correction without a reason is refused', async () => {
    currentPrincipal = RECEPTIONIST;
    const [existing] = await prisma.withPractice(practiceId, (tx) =>
      tx.chaseAttempt.findMany({ where: { subjectId: standardRecordId, supersedesId: null }, orderBy: { occurredAt: 'desc' } }),
    );
    const res = await request(app.getHttpServer())
      .post('/chase-attempts')
      .set('x-practice-id', practiceId)
      .send({ subjectType: 'ServiceRecord', subjectId: standardRecordId, channel: 'phone', outcome: 'reached', supersedesId: existing.id })
      .expect(400);
    expect(res.body.message).toMatch(/what was wrong with it/);
  });

  it('cross_practice_chase_trail_fails_closed (RLS)', async () => {
    currentPrincipal = RECEPTIONIST;
    // Another practice cannot read this practice's trail...
    await request(app.getHttpServer())
      .get(`/chase-attempts/ServiceRecord/${standardRecordId}`)
      .set('x-practice-id', otherPracticeId)
      .expect(404);
    // ...nor write an attempt onto its record.
    await request(app.getHttpServer())
      .post('/chase-attempts')
      .set('x-practice-id', otherPracticeId)
      .send({ subjectType: 'ServiceRecord', subjectId: standardRecordId, channel: 'phone', outcome: 'no_answer' })
      .expect(404);
    // ...and not even the raw table shows the rows.
    const leaked = await prisma.withPractice(otherPracticeId, (tx) =>
      tx.chaseAttempt.findMany({ where: { subjectId: standardRecordId } }),
    );
    expect(leaked).toEqual([]);
  });

  it('refuses an outcome the channel cannot produce, and an amount is not a field', async () => {
    currentPrincipal = RECEPTIONIST;
    const res = await request(app.getHttpServer())
      .post('/chase-attempts')
      .set('x-practice-id', practiceId)
      .send({ subjectType: 'ServiceRecord', subjectId: expiredRecordId, channel: 'post', outcome: 'left_message' })
      .expect(400);
    expect(JSON.stringify(res.body.message)).toMatch(/cannot end in/);

    // Whitelisted validation drops anything the DTO does not name — there is
    // no benefit amount on this record, and no contact detail either (rule 4,
    // REQ-VER-04).
    const trail = await request(app.getHttpServer())
      .get(`/chase-attempts/ServiceRecord/${standardRecordId}`)
      .set('x-practice-id', practiceId)
      .expect(200);
    const serialised = JSON.stringify(trail.body);
    expect(serialised).not.toMatch(/amountCents|benefitAmount|\$\d/);
    expect(Object.keys(trail.body.attempts[0])).not.toContain('to');
  });
});
