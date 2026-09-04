import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ValidationResponse } from '@aobplatform/contracts';
import { VISIT_POLICY_VERSION } from '@aobplatform/domain';
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

/** Exact string from the current mapping — anything else and C6 refuses the lock. */
const D6A = 'General practitioner attendance';
const nowIso = () => new Date().toISOString();

/**
 * THE ARRIVAL CONTRACT — "this patient has just walked up to reception to see
 * this provider" (Carl, 4 Sep 2026; TODO.md "Reception-centric" §2, GA-PLAN B4).
 *
 * WHAT THESE TESTS PIN, and each is a failure that would otherwise be found by
 * a practice rather than by us:
 *
 *  - The sequence the dev staging script performs by hand — patient, the
 *    patient's own assignor, a draft, an in-practice request, the D6a and the
 *    lock — happens from ONE message, and the patient is then on reception's
 *    queue by the read that queue actually uses.
 *  - A retry is a retry. A connector on a practice's ADSL sends the same
 *    arrival twice and one person appears once.
 *  - The PMS is the master of WHO the patient is and NOT of what the visit
 *    needs. Both halves are asserted, because getting the second wrong is the
 *    expensive mistake (hard rules 6 and 14).
 *  - No Medicare number gets in, at the one place a caller can reach with a
 *    JSON body no compiler sees (hard rule 1).
 *  - Another practice's arrival is invisible, by RLS, not by a filter.
 */
describe('arrivals — the PMS push, our side (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const practiceId = randomUUID();
  const otherPracticeId = randomUUID();
  let gpProviderId: string;
  let alliedProviderId: string;

  const arrival = (over: Record<string, unknown> = {}) => ({
    pmsPatientRecordNumber: 'ARR-0001',
    familyName: 'Arrival',
    givenNames: 'Robin',
    dateOfBirth: '1968-04-11',
    address: '4 Example Street, Sampletown NSW 2000',
    mobile: '+61400000901',
    email: 'robin.arrival@example.invalid',
    providerId: alliedProviderId,
    arrivedAt: nowIso(),
    source: 'dev',
    idempotencyKey: `arr-${randomUUID()}`,
    ...over,
  });

  const post = (body: Record<string, unknown>, scope = practiceId) =>
    request(app.getHttpServer()).post('/arrivals').set('x-practice-id', scope).send(body);

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
      await tx.practice.create({
        data: { id: practiceId, name: 'Arrivals Test Practice', defaultServiceDescription: D6A },
      });
      gpProviderId = (
        await tx.provider.create({
          data: { practiceId, name: 'Dr Sample GP', providerType: 'general_practitioner', providerNumber: '2222222A' },
        })
      ).id;
      /*
       * A NON-GP, and it is the workhorse of this suite rather than a corner
       * case. Enduring is GP-only (hard rule 6, REQ-END-01a), so an allied
       * health provider is the one whose arrivals produce the episodic
       * pre-agreement the rest of the platform can currently lock and push —
       * the s 65C rule set has no enduring path yet (CLAUDE.md §7).
       */
      alliedProviderId = (
        await tx.provider.create({
          data: { practiceId, name: 'Sam Sample', providerType: 'allied_health' },
        })
      ).id;
    });
    await prisma.withPractice(otherPracticeId, async (tx) => {
      await tx.practice.create({ data: { id: otherPracticeId, name: 'Another Practice' } });
    });
  });

  afterAll(async () => {
    for (const scope of [practiceId, otherPracticeId]) {
      await prisma.withPractice(scope, async (tx) => {
        await tx.arrival.deleteMany({});
        await tx.outboundItem.deleteMany({});
        await tx.tabletSession.deleteMany({});
        await tx.captureRequest.deleteMany({});
        await tx.verificationChallenge.deleteMany({});
        await tx.enduringDetail.deleteMany({});
        await tx.agreement.deleteMany({});
        await tx.assignor.deleteMany({});
        await tx.patient.deleteMany({});
        await tx.provider.deleteMany({});
        await tx.practice.deleteMany({});
      });
    }
    await prisma.vaultOutbox.deleteMany({});
    await app?.close();
  });

  // -------------------------------------------------------------------------

  it('one message produces the whole staging sequence, and the patient is on the queue', async () => {
    const body = arrival({ pmsPatientRecordNumber: 'ARR-QUEUE' });
    const res = await post(body).expect(201);

    expect(res.body.decision).toEqual({ type: 'episodic_pre', reason: 'enduring_is_gp_only' });
    expect(res.body.policyVersion).toBe(VISIT_POLICY_VERSION);
    expect(res.body.agreementId).toBeTruthy();
    expect(res.body.repeat).toBe(false);

    await prisma.withPractice(practiceId, async (tx) => {
      const patient = await tx.patient.findFirst({ where: { patientRecordNumber: 'ARR-QUEUE' } });
      expect(patient?.id).toBe(res.body.patientId);
      expect(patient?.address).toBe(body.address);

      // The patient's OWN assignor record — D7 stays explicit even when they
      // sign for themselves.
      const assignor = await tx.assignor.findFirst({
        where: { name: 'Robin Arrival', authorityBasis: 'self' },
      });
      expect(assignor).toBeTruthy();

      const agreement = await tx.agreement.findFirst({ where: { id: res.body.agreementId } });
      expect(agreement?.type).toBe('episodic_pre');
      expect(agreement?.assignorIsPatient).toBe(true);
      expect(agreement?.status).toBe('awaiting_signature');
      expect(agreement?.particularsLockedAt).not.toBeNull();
      expect(agreement?.serviceDescription).toBe(D6A);

      const captureRequest = await tx.captureRequest.findFirst({
        where: { agreementId: res.body.agreementId, channel: 'in_practice' },
      });
      expect(captureRequest?.status).toBe('open');
    });

    // Queue-visible by the read the queue itself uses, not by a query written
    // for this test — two answers to "who is waiting" is how two screens come
    // to disagree in front of a patient.
    const pushable = await request(app.getHttpServer())
      .get('/tablet-sessions/pushable')
      .set('x-practice-id', practiceId)
      .expect(200);
    const row = pushable.body.find((r: { agreementId: string }) => r.agreementId === res.body.agreementId);
    expect(row).toBeTruthy();
    expect(row.patientName).toBe('Robin Arrival');
    expect(row.serviceDescription).toBe(D6A);
    expect(row.pushable).toBe(true);
  });

  it('is idempotent: the same arrival twice is one patient, one draft and one row', async () => {
    const body = arrival({ pmsPatientRecordNumber: 'ARR-IDEM', idempotencyKey: 'arr-fixed-key' });
    const first = await post(body).expect(201);
    const second = await post(body).expect(201);

    expect(second.body.arrivalId).toBe(first.body.arrivalId);
    expect(second.body.agreementId).toBe(first.body.agreementId);
    expect(second.body.repeat).toBe(true);

    await prisma.withPractice(practiceId, async (tx) => {
      expect(await tx.arrival.count({ where: { idempotencyKey: 'arr-fixed-key' } })).toBe(1);
      const patient = await tx.patient.findFirst({ where: { patientRecordNumber: 'ARR-IDEM' } });
      expect(await tx.agreement.count({ where: { patientId: patient!.id } })).toBe(1);
    });
  });

  /**
   * REQ-DATA-10 — the PMS is the source of truth for who the patient is, and an
   * arrival is the moment it says so. What is recorded about the change is the
   * TYPE, never the value, old or new (REQ-VER-04).
   */
  it('updates the mirror when the PMS details changed, recording types and never values', async () => {
    const record = 'ARR-MOVED';
    await post(arrival({ pmsPatientRecordNumber: record, address: '1 Old Road, Sampletown NSW 2000' })).expect(201);

    const moved = await post(
      arrival({
        pmsPatientRecordNumber: record,
        address: '2 New Road, Sampletown NSW 2000',
        mobile: '+61400000902',
      }),
    ).expect(201);

    await prisma.withPractice(practiceId, async (tx) => {
      const patient = await tx.patient.findFirst({ where: { patientRecordNumber: record } });
      expect(patient?.address).toBe('2 New Road, Sampletown NSW 2000');
      expect(patient?.mobile).toBe('+61400000902');

      const row = await tx.arrival.findFirst({ where: { id: moved.body.arrivalId } });
      expect([...row!.detailsChanged].sort()).toEqual(['address', 'mobile']);
      // The row holds no detail VALUE at all — a second copy of the five
      // details would be a second answer to "what is this person's address".
      expect(JSON.stringify(row)).not.toContain('New Road');
      expect(JSON.stringify(row)).not.toContain('Robin');
    });

    const events = await prisma.vaultOutbox.findMany({
      where: { subjectType: 'Arrival', subjectId: moved.body.arrivalId },
    });
    expect(events).toHaveLength(1);
    const payload = events[0].payload as Record<string, unknown>;
    expect(payload.detailTypesChanged).toBe('address,mobile');
    expect(payload.policyVersion).toBe(VISIT_POLICY_VERSION);
    expect(payload.decidedBy).toBe('visit_policy');
    expect(JSON.stringify(payload)).not.toContain('New Road');
    expect(JSON.stringify(payload)).not.toContain('Robin');
  });

  it('writes the arrival row and its vault event together, or not at all', async () => {
    const res = await post(arrival({ pmsPatientRecordNumber: 'ARR-EVENT' })).expect(201);
    const events = await prisma.vaultOutbox.findMany({
      where: { type: 'arrival.received', subjectId: res.body.arrivalId },
    });
    expect(events).toHaveLength(1);
    expect(events[0].subjectType).toBe('Arrival');
  });

  /**
   * THE NAMED TEST (TODO.md §2). The sender does not decide. A body claiming
   * the agreement type is refused out loud rather than silently stripped — the
   * connector's author has a mental model that needs correcting once — and the
   * same arrival without the claim gets the type the rule set chose, which for
   * a GP with the practice's default on is the OTHER one.
   */
  it('arrival_type_is_decided_by_the_rule_set_not_the_pms', async () => {
    const claimed = await post(
      arrival({ pmsPatientRecordNumber: 'ARR-CLAIM', agreementType: 'enduring' }),
    ).expect(400);
    expect(claimed.body.message).toMatch(/does not decide what the visit needs/i);

    // Same practice, same day. A GP arrival and a non-GP arrival get different
    // answers, and neither sender said anything about it (hard rule 6).
    const gp = await post(
      arrival({ pmsPatientRecordNumber: 'ARR-GP', providerId: gpProviderId }),
    ).expect(201);
    expect(gp.body.decision.type).toBe('enduring');
    expect(gp.body.decision.reason).toBe('gp_with_no_active_enduring');

    const allied = await post(arrival({ pmsPatientRecordNumber: 'ARR-ALLIED' })).expect(201);
    expect(allied.body.decision.type).toBe('episodic_pre');
    expect(allied.body.decision.reason).toBe('enduring_is_gp_only');

    await prisma.withPractice(practiceId, async (tx) => {
      const agreement = await tx.agreement.findFirst({ where: { id: gp.body.agreementId } });
      expect(agreement?.type).toBe('enduring');
      // GP-only is enforced at the draft too, so the two can never disagree.
      expect(agreement?.enduringPathway).toBe('mymedicare');
    });
  });

  /**
   * REQ-END-01 — coverage is per practitioner × patient. A patient with a live
   * enduring agreement for this provider is asked for nothing, and the arrival
   * says why rather than leaving a silence.
   */
  it('drafts nothing when an ongoing agreement already covers this provider and patient', async () => {
    const record = 'ARR-COVERED';
    let patientId = '';
    await prisma.withPractice(practiceId, async (tx) => {
      const patient = await tx.patient.create({
        data: {
          practiceId,
          familyName: 'Covered',
          givenNames: 'Sam',
          dateOfBirth: new Date('1959-02-02'),
          address: '9 Example Street, Sampletown NSW 2000',
          patientRecordNumber: record,
        },
      });
      patientId = patient.id;
      const assignor = await tx.assignor.create({
        data: { practiceId, name: 'Sam Covered', authorityBasis: 'self', dateOfBirth: new Date('1959-02-02') },
      });
      const agreement = await tx.agreement.create({
        data: {
          practiceId,
          type: 'enduring',
          anchorKind: 'provider',
          providerId: gpProviderId,
          patientId: patient.id,
          assignorId: assignor.id,
          assignorIsPatient: true,
          enduringPathway: 'mymedicare',
          status: 'active',
        },
      });
      await tx.enduringDetail.create({
        data: {
          practiceId,
          agreementId: agreement.id,
          notificationMethod: 'email',
          terminationMethod: 'email',
          scopeType: 'category',
          scopeValues: ['1'],
          enteredIntoAt: new Date(),
        },
      });
    });

    const res = await post(
      arrival({
        pmsPatientRecordNumber: record,
        familyName: 'Covered',
        givenNames: 'Sam',
        dateOfBirth: '1959-02-02',
        providerId: gpProviderId,
      }),
    ).expect(201);

    expect(res.body.decision).toEqual({ type: 'none', reason: 'already_covered_by_an_enduring_agreement' });
    expect(res.body.agreementId).toBeNull();
    await prisma.withPractice(practiceId, async (tx) => {
      // The enduring agreement, and nothing new beside it.
      expect(await tx.agreement.count({ where: { patientId } })).toBe(1);
    });

    // The SAME patient, the SAME day, a DIFFERENT provider: coverage is per
    // practitioner, never per practice (hard rule 6).
    const elsewhere = await post(
      arrival({
        pmsPatientRecordNumber: record,
        familyName: 'Covered',
        givenNames: 'Sam',
        dateOfBirth: '1959-02-02',
        providerId: alliedProviderId,
      }),
    ).expect(201);
    expect(elsewhere.body.decision.type).toBe('episodic_pre');
  });

  /** Hard rule 1 / REQ-VER-02 — refused out loud, at the door. */
  it('arrival_rejects_a_medicare_number', async () => {
    for (const field of ['medicareNumber', 'medicare_card', 'patientMedicareIrn']) {
      const res = await post(arrival({ pmsPatientRecordNumber: 'ARR-MC', [field]: '2951 33333 1' })).expect(400);
      expect(res.body.message).toMatch(/not an identity identifier/i);
    }
    await prisma.withPractice(practiceId, async (tx) => {
      expect(await tx.arrival.count({ where: { pmsPatientRecordNumber: 'ARR-MC' } })).toBe(0);
      expect(await tx.patient.count({ where: { patientRecordNumber: 'ARR-MC' } })).toBe(0);
    });
  });

  it('refuses an arrival that names no provider — enduring is per practitioner (REQ-END-01)', async () => {
    const body = arrival({ pmsPatientRecordNumber: 'ARR-NOPROV' });
    delete (body as Record<string, unknown>).providerId;
    const res = await post(body).expect(400);
    expect(res.body.message).toMatch(/must name the provider/i);
  });

  /** RLS, not a filter: another practice's arrival simply is not there. */
  it('fails closed across practices', async () => {
    const res = await post(arrival({ pmsPatientRecordNumber: 'ARR-SCOPE' })).expect(201);

    await request(app.getHttpServer())
      .get(`/arrivals/${res.body.arrivalId}`)
      .set('x-practice-id', otherPracticeId)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/arrivals/${res.body.arrivalId}`)
      .set('x-practice-id', practiceId)
      .expect(200);

    // And an arrival pointed at another practice's provider finds nothing
    // rather than reaching across.
    await post(arrival({ pmsPatientRecordNumber: 'ARR-SCOPE-2' }), otherPracticeId).expect(404);
  });
});
