import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ValidationResponse } from '@aobplatform/contracts';
import { ASSIGNOR_RELATIONSHIPS_VERSION, VISIT_POLICY_VERSION } from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';
import { createServicingProvider, deleteSeededAnchors } from './anchor';

const passingRules = {
  validate: async (): Promise<ValidationResponse> => ({
    valid: true,
    /*
     * C8 IS ANSWERED, NOT MERELY OMITTED (REQ-65C-01). `changeAssignor`
     * asserts D7 on the payload AS PERSISTED and treats SILENCE AS A FAILURE —
     * a rule set that returns no C8 verdict has not been asked the question
     * that endpoint exists to answer, and it raises rather than assuming. So a
     * mock standing in for a passing rule set has to actually say so, or the
     * one path in this suite that re-points an assignor (W2's "someone else is
     * signing") would fail for a reason that has nothing to do with the code
     * under test.
     */
    results: [{ rule: 'C8', outcome: 'pass', message: 'D7 is complete.', citation: 's 65C(4)' }],
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
/**
 * The receptionist who sets the practice default, when one is needed.
 *
 * `null` for every other test in this suite: an arrival is a machine-to-machine
 * push from the PMS connector and carries no signed-in person, which is
 * precisely why the default exists.
 */
const RECEPTIONIST = {
  sub: '00000000-0000-4000-8000-0000000d6a02',
  principalType: 'staff',
  roles: [],
  preferredUsername: 'mai.frontdesk',
  raw: {},
};
let currentPrincipal: Record<string, unknown> | null = null;

describe('arrivals — the PMS push, our side (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const practiceId = randomUUID();
  const otherPracticeId = randomUUID();
  /** A practice that has NOT chosen a default D6a. See the B10 test below. */
  const noDefaultPracticeId = randomUUID();
  /**
   * THE ANCHORS. From 7 September 2026 an arrival names the practitioner at a
   * LOCATION, so these are affiliation ids — and `gpAtSecondSite` is the same
   * PERSON at the practice's other location, which is what
   * `enduring_coverage_is_per_practitioner_across_locations` turns on.
   */
  let gpAffiliationId: string;
  let gpPractitionerId: string;
  let gpSecondSiteAffiliationId: string;
  let alliedAffiliationId: string;
  let alliedProviderId: string;
  let noDefaultAffiliationId: string;

  const arrival = (over: Record<string, unknown> = {}) => ({
    pmsPatientRecordNumber: 'ARR-0001',
    familyName: 'Arrival',
    givenNames: 'Robin',
    dateOfBirth: '1968-04-11',
    address: '4 Example Street, Sampletown NSW 2000',
    mobile: '+61400000901',
    email: 'robin.arrival@example.invalid',
    affiliationId: alliedAffiliationId,
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
    // Middleware runs before the guards and cannot be forged by a client — the
    // same seam the service-descriptions and acting-as suites use. Every
    // arrival below runs with no principal, as a connector push does.
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      if (currentPrincipal) req.principal = currentPrincipal;
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({
        data: { id: practiceId, name: 'Arrivals Test Practice', defaultServiceDescription: D6A },
      });
      const gp = await createServicingProvider(tx, practiceId, {
        name: 'Dr Sample GP',
        providerType: 'general_practitioner',
        providerNumber: '2222222A',
        locationCode: 'Main',
      });
      gpAffiliationId = gp.affiliationId;
      gpPractitionerId = gp.practitionerId;
      /*
       * THE SAME DOCTOR AT THE PRACTICE'S OTHER SITE. One practitioner, two
       * affiliations, two provider numbers — which is how the numbers are
       * actually issued (FR-1.8) and the shape hard rule 6 has to survive.
       */
      gpSecondSiteAffiliationId = (
        await createServicingProvider(tx, practiceId, {
          name: 'Dr Sample GP',
          providerType: 'general_practitioner',
          providerNumber: '2222222B',
          practitionerId: gp.practitionerId,
          suburb: 'Otherville',
          locationCode: 'After Hours',
        })
      ).affiliationId;
      /*
       * A NON-GP, and it is the workhorse of this suite rather than a corner
       * case. Enduring is GP-only (hard rule 6, REQ-END-01a), so an allied
       * health provider is the one whose arrivals produce the episodic
       * pre-agreement the rest of the platform can currently lock and push —
       * the s 65C rule set has no enduring path yet (CLAUDE.md §7).
       */
      const allied = await createServicingProvider(tx, practiceId, {
        name: 'Sam Sample',
        providerType: 'allied_health',
      });
      alliedAffiliationId = allied.affiliationId;
      // The legacy `providers` row for the same person, which the deprecated
      // `providerId` field on the contract is still resolved through.
      alliedProviderId = allied.providerId;
    });
    await prisma.withPractice(otherPracticeId, async (tx) => {
      await tx.practice.create({ data: { id: otherPracticeId, name: 'Another Practice' } });
    });

    // NO `defaultServiceDescription`, and its own provider — the B10 test needs
    // a practice that has genuinely not chosen one, not one whose default this
    // suite quietly cleared out from under the other tests.
    await prisma.withPractice(noDefaultPracticeId, async (tx) => {
      await tx.practice.create({ data: { id: noDefaultPracticeId, name: 'No Default Yet Medical' } });
      noDefaultAffiliationId = (
        await createServicingProvider(tx, noDefaultPracticeId, { name: 'Kim Sample', providerType: 'allied_health' })
      ).affiliationId;
    });
  });

  beforeEach(() => {
    // An arrival is a connector push and carries nobody. Tests that need a
    // signed-in staff member say so.
    currentPrincipal = null;
  });

  afterAll(async () => {
    for (const scope of [practiceId, otherPracticeId, noDefaultPracticeId]) {
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
        await deleteSeededAnchors(tx);
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
    /*
     * ON THE QUEUE, AND WAITING TO BE ASKED WHO IS SIGNING (Carl, 7 Sep 2026).
     *
     * A CONNECTOR CANNOT ANSWER THAT QUESTION. The arrival names the patient as
     * their own assignor because that is the default every agreement is drafted
     * with, and a machine push has nobody standing at a desk to confirm it. So
     * the row arrives complete in every other respect and blocked on the one
     * thing only a person can supply — which is the workflow Carl asked for:
     * who is signing, then choose a tablet, then Send.
     */
    expect(row.pushable).toBe(false);
    expect(row.blockedReason).toBe('assignor_not_confirmed');
    expect(row.assignorConfirmedAt).toBeNull();

    // ONE PRESS AND IT CAN GO. Nothing else about the row changes.
    await request(app.getHttpServer())
      .post(`/agreements/${res.body.agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({ assignorIsPatient: true })
      .expect(201);
    const confirmed = (
      await request(app.getHttpServer())
        .get('/tablet-sessions/pushable')
        .set('x-practice-id', practiceId)
        .expect(200)
    ).body.find((r: { agreementId: string }) => r.agreementId === res.body.agreementId);
    expect(confirmed.pushable).toBe(true);
    expect(confirmed.blockedReason).toBeNull();
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
      arrival({ pmsPatientRecordNumber: 'ARR-GP', affiliationId: gpAffiliationId }),
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
          affiliationId: gpAffiliationId,
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
        affiliationId: gpAffiliationId,
      }),
    ).expect(201);

    expect(res.body.decision).toEqual({ type: 'none', reason: 'already_covered_by_an_enduring_agreement' });
    expect(res.body.agreementId).toBeNull();

    /*
     * THE SAME DOCTOR, THE PRACTICE'S OTHER SITE — STILL COVERED (hard rule 6,
     * REQ-END-01; `enduring_coverage_is_per_practitioner_across_locations`).
     *
     * The two sites are two affiliations with two provider numbers, because
     * that is how the numbers are issued (FR-1.8). Matching coverage on the
     * affiliation would make one doctor look like two and ask this patient to
     * sign a second ongoing agreement for services the first already assigns.
     * Coverage is asked about the PERSON.
     */
    const secondSite = await post(
      arrival({
        pmsPatientRecordNumber: record,
        familyName: 'Covered',
        givenNames: 'Sam',
        dateOfBirth: '1959-02-02',
        affiliationId: gpSecondSiteAffiliationId,
      }),
    ).expect(201);
    expect(secondSite.body.decision.type).toBe('none');
    expect(secondSite.body.agreementId).toBeNull();
    await prisma.withPractice(practiceId, async (tx) => {
      // And the arrival records WHICH site they actually walked into, even
      // though nothing was drafted — the visit happened somewhere.
      const row = await tx.arrival.findFirst({ where: { id: secondSite.body.arrivalId } });
      expect(row?.affiliationId).toBe(gpSecondSiteAffiliationId);
      const affiliation = await tx.affiliation.findFirst({ where: { id: row!.affiliationId! } });
      expect(affiliation?.practitionerId).toBe(gpPractitionerId);
    });
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
        affiliationId: alliedAffiliationId,
      }),
    ).expect(201);
    expect(elsewhere.body.decision.type).toBe('episodic_pre');
  });

  /**
   * THE DEPRECATED DOOR, FOR ONE MORE RELEASE (Carl, 7 Sep 2026). A connector
   * that has not been updated still names a `providers` row; the server
   * resolves it to the practitioner at a location and the agreement is
   * anchored there, so nothing a practice already runs stops working on the
   * day this landed (hard rule 8 — the platform never blocks care).
   */
  it('still accepts a deprecated providerId and resolves it to the affiliation', async () => {
    const res = await post(
      arrival({ pmsPatientRecordNumber: 'ARR-LEGACY', providerId: alliedProviderId, affiliationId: undefined }),
    ).expect(201);
    expect(res.body.decision.type).toBe('episodic_pre');

    await prisma.withPractice(practiceId, async (tx) => {
      const row = await tx.arrival.findFirst({ where: { id: res.body.arrivalId } });
      // BOTH, while both exist: the anchor it resolved to, and the row it came
      // in by — so the record says which door was used.
      expect(row?.affiliationId).toBe(alliedAffiliationId);
      expect(row?.providerId).toBe(alliedProviderId);

      const agreement = await tx.agreement.findFirst({ where: { id: res.body.agreementId } });
      expect(agreement?.affiliationId).toBe(alliedAffiliationId);
    });
  });

  // -------------------------------------------------------------------------
  // RECEPTION TYPES IT BY HAND — PMS_to_AoB_Workflow.md case 4, row W2
  // (Carl, 7 Sep 2026: "go").
  //
  // THE FORM IS AN ARRIVAL TYPED BY HAND, and these tests exist to pin exactly
  // that: same pipeline, same visit policy, same guards, same lock, same queue
  // — differing only in what the evidence says about who spoke.
  // -------------------------------------------------------------------------
  describe('reception types the arrival (W2)', () => {
    /**
     * A NAME THE PRACTICE-STAFF BLOCK MUST HIT (REQ-VUL-04). Obviously fake,
     * and deliberately not one of the names any other test in this file uses.
     */
    const STAFF_MEMBER_NAME = 'Mai Frontdesk';
    /** Somebody who cannot be the provider on an agreement — the preview's refusal. */
    let nurseAffiliationId: string;

    /**
     * THE RECEPTIONIST, WITH THE PRACTICE'S OWN CLAIM ON THEIR TOKEN.
     *
     * `POST /arrivals` is `@PracticeScoped` — the practice's own act, which a
     * platform operator may perform only by acting AS the practice — so a
     * token with no practice claim is refused with a 403 before any of this
     * runs. That refusal is right and is asserted elsewhere in this suite; a
     * receptionist typing a walk-in has the claim, and this is what one looks
     * like.
     */
    const DESK = { ...RECEPTIONIST, practiceId };

    beforeAll(async () => {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.staffMember.create({
          data: { practiceId, name: STAFF_MEMBER_NAME, role: 'front_desk' },
        });
        nurseAffiliationId = (
          await createServicingProvider(tx, practiceId, {
            name: 'Kit Practicenurse',
            providerType: 'nurse',
            billingRole: 'works_under_provider',
          })
        ).affiliationId;
      });
    });

    afterAll(async () => {
      await prisma.withPractice(practiceId, (tx) =>
        tx.staffMember.deleteMany({ where: { name: STAFF_MEMBER_NAME } }),
      );
    });

    /**
     * THE NAMED TEST. Identical inputs through the two doors produce an
     * identical draft, an identical lock and an identical queue row — the only
     * differences being the ones that SHOULD differ: the source, and the
     * person the evidence names.
     *
     * WHY IT MATTERS MORE THAN IT LOOKS. Case 4 is what a practice falls back
     * to when its practice management system is down, which is the moment a
     * second, subtly different code path would do the most damage. There is one
     * pipeline, or there are two answers to "what does this visit need".
     */
    it('reception_arrival_runs_the_same_pipeline_as_a_pms_arrival', async () => {
      const serviceDate = new Date().toISOString().slice(0, 10);

      const byMachine = await post(
        arrival({ pmsPatientRecordNumber: 'ARR-W2-PMS', source: 'dev' }),
      ).expect(201);

      currentPrincipal = DESK;
      const byHand = await post(
        arrival({ pmsPatientRecordNumber: 'ARR-W2-DESK', source: 'reception', serviceDate }),
      ).expect(201);
      currentPrincipal = null;

      // The decision, the reason and the version that produced them.
      expect(byHand.body.decision).toEqual(byMachine.body.decision);
      expect(byHand.body.policyVersion).toBe(byMachine.body.policyVersion);
      expect(byHand.body.agreementId).toBeTruthy();

      await prisma.withPractice(practiceId, async (tx) => {
        const typed = await tx.agreement.findFirst({ where: { id: byHand.body.agreementId } });
        const pushed = await tx.agreement.findFirst({ where: { id: byMachine.body.agreementId } });

        // Same instrument, same particulars, same lock (hard rule 2).
        expect(typed?.type).toBe(pushed?.type);
        expect(typed?.serviceDescription).toBe(D6A);
        expect(pushed?.serviceDescription).toBe(D6A);
        expect(typed?.status).toBe('awaiting_signature');
        expect(typed?.particularsLockedAt).not.toBeNull();
        // D7 explicit and never inferred (CLAUDE.md §3) — the patient signs for
        // themselves unless the desk said otherwise.
        expect(typed?.assignorIsPatient).toBe(true);
        expect(typed?.affiliationId).toBe(pushed?.affiliationId);
      });

      // Queue-visible by the read the queue itself uses, and pushable on the
      // same terms — not by a query written for this test.
      const pushable = await request(app.getHttpServer())
        .get('/tablet-sessions/pushable')
        .set('x-practice-id', practiceId)
        .expect(200);
      const typedRow = pushable.body.find(
        (r: { agreementId: string }) => r.agreementId === byHand.body.agreementId,
      );
      const pushedRow = pushable.body.find(
        (r: { agreementId: string }) => r.agreementId === byMachine.body.agreementId,
      );
      /*
       * THE SAME ANSWER FROM BOTH DOORS, which is what this test is about.
       * Neither has been asked who is signing yet — the receptionist typed an
       * arrival, they did not answer for the signature — so both wait on the
       * same one press (Carl, 7 Sep 2026).
       */
      expect(typedRow.pushable).toBe(false);
      expect(typedRow.blockedReason).toBe('assignor_not_confirmed');
      expect(typedRow.pushable).toBe(pushedRow.pushable);
      expect(typedRow.serviceDescription).toBe(pushedRow.serviceDescription);
      expect(typedRow.blockedReason).toBe(pushedRow.blockedReason);
    });

    /**
     * WHO SPOKE, AND WHOSE HANDS TYPED IT — the one thing that SHOULD differ.
     *
     * A connector arrival is the practice's software speaking and names nobody;
     * a typed one is an act a named staff member performed, and the row and the
     * vault event both say so. The id from the signed token, never a name
     * (REQ-LOG-08) — asserted below, along with no patient value of any kind.
     */
    it('reception_arrival_records_source_and_principal', async () => {
      currentPrincipal = DESK;
      const res = await post(
        arrival({ pmsPatientRecordNumber: 'ARR-W2-WHO', source: 'reception' }),
      ).expect(201);
      currentPrincipal = null;

      await prisma.withPractice(practiceId, async (tx) => {
        const row = await tx.arrival.findFirst({ where: { id: res.body.arrivalId } });
        expect(row?.source).toBe('reception');
        expect(row?.receivedByPrincipalId).toBe(RECEPTIONIST.sub);
      });

      const events = await prisma.vaultOutbox.findMany({
        where: { type: 'arrival.received', subjectId: res.body.arrivalId },
      });
      expect(events).toHaveLength(1);
      const payload = events[0].payload as Record<string, unknown>;
      expect(payload.source).toBe('reception');
      expect(payload.receivedBy).toBe(RECEPTIONIST.sub);
      expect(payload.receivedByType).toBe('staff');
      // IDS AND FACTS, NEVER A NAME OR A VALUE (REQ-LOG-08, REQ-VER-04).
      expect(JSON.stringify(payload)).not.toContain(RECEPTIONIST.preferredUsername);
      expect(JSON.stringify(payload)).not.toContain('Robin');
      expect(JSON.stringify(payload)).not.toContain('Example Street');

      // And a machine push still names nobody — the null is the fact, and the
      // database refuses any other combination
      // (`arrivals_principal_only_when_typed`).
      const machine = await post(arrival({ pmsPatientRecordNumber: 'ARR-W2-NOBODY' })).expect(201);
      await prisma.withPractice(practiceId, async (tx) => {
        const row = await tx.arrival.findFirst({ where: { id: machine.body.arrivalId } });
        expect(row?.receivedByPrincipalId).toBeNull();
      });
    });

    /**
     * THE THREE FIELDS ONLY A PERSON MAY SEND, refused out loud from anything
     * else — the same posture the Medicare and agreement-type fences take.
     *
     * A connector has nobody to ask which day, which description or who is
     * signing, which is exactly why the practice's default D6a exists and why
     * the patient is their own assignor on a machine push (D7, hard rule 10).
     */
    it('reception_only_fields_are_refused_from_a_connector', async () => {
      const extras: Array<Record<string, unknown>> = [
        { serviceDate: '2026-09-01' },
        { serviceDescription: D6A },
        {
          assignor: {
            name: 'Sam Sampleton',
            relationship: 'Mother',
            authorityBasis: 'parent',
            declaresEighteenOrOver: true,
            mobile: '0400 000 111',
          },
        },
      ];
      for (const extra of extras) {
        const res = await post(
          arrival({ pmsPatientRecordNumber: 'ARR-W2-FENCE', source: 'connector', ...extra }),
        ).expect(400);
        expect(res.body.message).toMatch(/answers a person at the desk gives/i);
      }
      await prisma.withPractice(practiceId, async (tx) => {
        expect(await tx.arrival.count({ where: { pmsPatientRecordNumber: 'ARR-W2-FENCE' } })).toBe(0);
        expect(await tx.patient.count({ where: { patientRecordNumber: 'ARR-W2-FENCE' } })).toBe(0);
      });
    });

    /**
     * SOMEBODY ELSE IS SIGNING, SET BEFORE THE LOCK — because who signs is one
     * of the locked particulars (hard rule 2, REQ-REG-06) and is never EDITED
     * afterwards. Said after the arrival it still works, since 7 Sep 2026, but
     * by superseding: a second agreement, a second render, a second row in the
     * evidence, for a fact reception already knew. This pins that it lands on
     * the FIRST one.
     */
    it('reception_arrival_sets_who_is_signing_before_the_particulars_lock', async () => {
      currentPrincipal = DESK;
      const res = await post(
        arrival({
          pmsPatientRecordNumber: 'ARR-W2-PARTY',
          source: 'reception',
          assignor: {
            name: 'Alex Notstaff',
            relationship: 'Mother',
            relationshipsVersion: ASSIGNOR_RELATIONSHIPS_VERSION,
            authorityBasis: 'parent',
            declaresEighteenOrOver: true,
            mobile: '0400 000 111',
          },
        }),
      ).expect(201);
      currentPrincipal = null;

      await prisma.withPractice(practiceId, async (tx) => {
        const agreement = await tx.agreement.findFirst({ where: { id: res.body.agreementId } });
        expect(agreement?.assignorIsPatient).toBe(false);
        expect(agreement?.particularsLockedAt).not.toBeNull();
        const assignor = await tx.assignor.findFirst({ where: { id: agreement!.assignorId } });
        expect(assignor?.name).toBe('Alex Notstaff');
        expect(assignor?.authorityBasis).toBe('parent');
        expect(assignor?.relationshipToPatient).toBe('Mother');
        // A DECLARATION, recorded and never verified — and no date of birth is
        // stored for the assignor anywhere (REQ-AGE-01, REQ-VUL-02).
        expect(assignor?.declaredOfFullAgeAt).not.toBeNull();
        expect(assignor?.dateOfBirth).toBeNull();
      });

      /*
       * AND THE EVENT NAMES THE RECEPTIONIST, NOT THE PLATFORM (found in
       * review, 7 Sep 2026). D7 is a particular of a contract, so an
       * `agreement.assignor_changed` saying "the platform did this" about an
       * act a named staff member performed would be evidence with the witness
       * removed — the same reasoning `arrival.received` already follows.
       *
       * IDS AND FACTS, NEVER A NAME. The payload is asserted to carry neither
       * the assignor's name nor a contact value (REQ-LOG-08, REQ-VER-04).
       */
      const events = await prisma.vaultOutbox.findMany({
        where: { type: 'agreement.assignor_changed', subjectId: res.body.agreementId },
      });
      expect(events).toHaveLength(1);
      expect(events[0].actor as Record<string, unknown>).toMatchObject({
        principalType: 'staff',
        id: RECEPTIONIST.sub,
      });
      const payload = events[0].payload as Record<string, unknown>;
      expect(payload.assignorIsPatient).toBe(false);
      expect(payload.authorityBasis).toBe('parent');
      expect(JSON.stringify(payload)).not.toContain('Alex Notstaff');
      expect(JSON.stringify(payload)).not.toContain('0400 000 111');
    });

    /**
     * HARD RULE 10, AT THIS DOOR TOO — and refused BEFORE anything is written,
     * so the desk fixes one field and sends the same walk-in again rather than
     * leaving a half-made arrival behind it.
     *
     * NEITHER RULE IS RE-IMPLEMENTED HERE: the arrival calls the same
     * `buildAssignorForAnother` the assignor endpoint does, which is why the
     * refusals read identically at both doors.
     */
    it('reception_arrival_blocks_practice_staff_and_the_under_age_from_signing', async () => {
      currentPrincipal = DESK;

      // REQ-VUL-04 — a name matching practice staff is hard-blocked, fail closed.
      const staff = await post(
        arrival({
          pmsPatientRecordNumber: 'ARR-W2-STAFF',
          source: 'reception',
          assignor: {
            name: STAFF_MEMBER_NAME,
            relationship: 'Carer',
            authorityBasis: 'other_with_note',
            note: 'Carer',
            declaresEighteenOrOver: true,
            mobile: '0400 000 222',
          },
        }),
      ).expect(400);
      expect(staff.body.message).toMatch(/REQ-VUL-04/);

      // REQ-AGE-01 — the declaration must be present AND true.
      const young = await post(
        arrival({
          pmsPatientRecordNumber: 'ARR-W2-AGE',
          source: 'reception',
          assignor: {
            name: 'Jo Notstaff',
            relationship: 'Friend',
            authorityBasis: 'other_with_note',
            note: 'Friend',
            declaresEighteenOrOver: false,
            mobile: '0400 000 333',
          },
        }),
      ).expect(400);
      expect(young.body.message).toMatch(/REQ-AGE-01/);

      currentPrincipal = null;

      // NOTHING WAS WRITTEN by either refusal — no mirror row, no assignor, no
      // arrival, no draft. The desk fixes the field and sends the same walk-in.
      await prisma.withPractice(practiceId, async (tx) => {
        for (const record of ['ARR-W2-STAFF', 'ARR-W2-AGE']) {
          expect(await tx.arrival.count({ where: { pmsPatientRecordNumber: record } })).toBe(0);
          expect(await tx.patient.count({ where: { patientRecordNumber: record } })).toBe(0);
        }
        expect(await tx.assignor.count({ where: { name: STAFF_MEMBER_NAME } })).toBe(0);
      });
    });

    /**
     * THE LIVE READ THE FORM SHOWS ABOVE SUBMIT — the same answer, and nothing
     * written.
     *
     * Reception does not CHOOSE what the visit needs; the versioned visit
     * policy does (hard rules 6 and 14). The form shows the answer before
     * Submit so nobody discovers it afterwards, and this pins that the preview
     * and the pipeline give one answer and that the preview leaves no trace.
     */
    it('arrival_preview_gives_the_pipelines_answer_and_writes_nothing', async () => {
      const preview = (body: Record<string, unknown>, scope = practiceId) =>
        request(app.getHttpServer()).post('/arrivals/preview').set('x-practice-id', scope).send(body);

      const gp = await preview({
        pmsPatientRecordNumber: 'ARR-W2-PREVIEW',
        affiliationId: gpAffiliationId,
      }).expect(201);
      expect(gp.body.decision).toEqual({ type: 'enduring', reason: 'gp_with_no_active_enduring' });
      expect(gp.body.policyVersion).toBe(VISIT_POLICY_VERSION);
      expect(gp.body.providerName).toBe('Dr Sample GP');
      expect(gp.body.blocked).toBeNull();

      const allied = await preview({
        pmsPatientRecordNumber: 'ARR-W2-PREVIEW',
        affiliationId: alliedAffiliationId,
      }).expect(201);
      expect(allied.body.decision).toEqual({ type: 'episodic_pre', reason: 'enduring_is_gp_only' });

      // A NURSE COMES BACK AS AN ANSWER, NOT AN ERROR: the pipeline's own
      // reason code, for the console to map to words and a destination.
      const nurse = await preview({
        pmsPatientRecordNumber: 'ARR-W2-PREVIEW',
        affiliationId: nurseAffiliationId,
      }).expect(201);
      expect(nurse.body.decision).toBeNull();
      expect(nurse.body.blocked.reason).toBe('provider_not_servicing');

      // NOTHING WAS WRITTEN by any of the three.
      await prisma.withPractice(practiceId, async (tx) => {
        expect(await tx.arrival.count({ where: { pmsPatientRecordNumber: 'ARR-W2-PREVIEW' } })).toBe(0);
        expect(await tx.patient.count({ where: { patientRecordNumber: 'ARR-W2-PREVIEW' } })).toBe(0);
      });

      // And the answer the pipeline then gives is the answer the preview gave.
      const real = await post(
        arrival({ pmsPatientRecordNumber: 'ARR-W2-PREVIEW', affiliationId: alliedAffiliationId }),
      ).expect(201);
      expect(real.body.decision).toEqual(allied.body.decision);
      expect(real.body.policyVersion).toBe(allied.body.policyVersion);
    });

    /**
     * EVERY NEW READ FAILS CLOSED ACROSS PRACTICES — by RLS, not by a filter.
     * The preview and the patient search are both new doors into a practice's
     * own records, and neither may be opened with somebody else's id.
     */
    it('the new reads fail closed across practices', async () => {
      // The preview: another practice's affiliation is not visible, so it is
      // not found — the answer that admits least.
      await request(app.getHttpServer())
        .post('/arrivals/preview')
        .set('x-practice-id', otherPracticeId)
        .send({ pmsPatientRecordNumber: 'ARR-W2-SCOPE', affiliationId: alliedAffiliationId })
        .expect(404);

      // The patient search: this practice's patient exists under this
      // practice's scope and simply is not there under another's.
      await post(arrival({ pmsPatientRecordNumber: 'ARR-W2-FIND', familyName: 'Findable' })).expect(201);

      const mine = await request(app.getHttpServer())
        .get('/patients/search?q=Findable')
        .set('x-practice-id', practiceId)
        .expect(200);
      expect(mine.body.map((r: { familyName: string }) => r.familyName)).toContain('Findable');
      // FIVE KEYS AND NO MORE. Not a patient directory (REQ-DATA-10), and
      // never a Medicare number, which has no column here (hard rule 1).
      expect(Object.keys(mine.body[0]).sort()).toEqual([
        'dateOfBirth',
        'familyName',
        'givenNames',
        'patientId',
        'patientRecordNumber',
      ]);
      expect(JSON.stringify(mine.body)).not.toMatch(/medicare/i);
      expect(JSON.stringify(mine.body)).not.toContain('Example Street');

      const theirs = await request(app.getHttpServer())
        .get('/patients/search?q=Findable')
        .set('x-practice-id', otherPracticeId)
        .expect(200);
      expect(theirs.body).toEqual([]);

      // AND THERE IS NO QUERY THAT RETURNS EVERYBODY. A short term is refused
      // rather than answered broadly.
      await request(app.getHttpServer())
        .get('/patients/search?q=')
        .set('x-practice-id', practiceId)
        .expect(400);
      await request(app.getHttpServer())
        .get('/patients/search?q=F')
        .set('x-practice-id', practiceId)
        .expect(400);
    });
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
    delete (body as Record<string, unknown>).affiliationId;
    const res = await post(body).expect(400);
    expect(res.body.message).toMatch(/must name the practitioner/i);
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

  /**
   * D6a, THE PRACTICE DEFAULT, END TO END (GA-PLAN B10; Carl, 5 Sep 2026) —
   * the console control's other half, asserted through the endpoint the console
   * actually calls.
   *
   * WHAT IT PINS. Before a practice chooses one, an arrival draft is honestly
   * stuck: no default means no D6a, no D6a means no lock (hard rule 2 —
   * particulars complete and locked before signature), and the queue says
   * exactly why rather than presenting a tablet with a blank particular. After
   * a NAMED staff member sets one, the next arrival is locked and pushable with
   * no further human act.
   *
   * AND IT PINS THE THING THE CONSOLE DELIBERATELY DOES NOT DO: saving a default
   * does not reach back into the draft that was already waiting. Sweeping it
   * would be the platform deciding a particular of a contract already drafted
   * for a named patient, with nobody's identity on the decision — which is the
   * entire reason D6a moved to a staff surface. That draft stays on the queue
   * until somebody sets it on the row.
   */
  it('arrival_locks_with_the_practice_default_d6a_once_set', async () => {
    const arriveHere = (record: string) =>
      request(app.getHttpServer())
        .post('/arrivals')
        .set('x-practice-id', noDefaultPracticeId)
        .send(arrival({ pmsPatientRecordNumber: record, affiliationId: noDefaultAffiliationId }));
    const pushableHere = () =>
      request(app.getHttpServer())
        .get('/tablet-sessions/pushable')
        .set('x-practice-id', noDefaultPracticeId);

    // --- No default. The draft exists, and it is blocked, and it says why.
    const before = await arriveHere('ARR-B10-BEFORE').expect(201);
    expect(before.body.decision.type).toBe('episodic_pre');

    await prisma.withPractice(noDefaultPracticeId, async (tx) => {
      const agreement = await tx.agreement.findFirst({ where: { id: before.body.agreementId } });
      expect(agreement?.serviceDescription).toBeNull();
      // NOT LOCKED, and not moved to `awaiting_signature` either — an unlocked
      // agreement sitting at that status is the shape hard rule 2 forbids. It
      // waits at `verification_pending`, where the in-practice capture request
      // left it.
      expect(agreement?.particularsLockedAt).toBeNull();
      expect(agreement?.status).not.toBe('awaiting_signature');
    });

    const blockedRow = (await pushableHere().expect(200)).body.find(
      (r: { agreementId: string }) => r.agreementId === before.body.agreementId,
    );
    expect(blockedRow.pushable).toBe(false);
    expect(blockedRow.blockedReason).toBe('service_description_missing');

    // --- The console's own call. Refused without a signed-in person, because a
    // setting that decides a particular of every future agreement is recorded
    // against whoever changed it.
    await request(app.getHttpServer())
      .put('/service-descriptions/default')
      .set('x-practice-id', noDefaultPracticeId)
      .send({ description: D6A })
      .expect(403);

    currentPrincipal = RECEPTIONIST;
    const saved = await request(app.getHttpServer())
      .put('/service-descriptions/default')
      .set('x-practice-id', noDefaultPracticeId)
      .send({ description: D6A })
      .expect(200);
    expect(saved.body.defaultDescription).toBe(D6A);
    currentPrincipal = null;

    // --- The next arrival, from a connector carrying nobody, is locked and
    // ready with no further human act.
    const after = await arriveHere('ARR-B10-AFTER').expect(201);
    await prisma.withPractice(noDefaultPracticeId, async (tx) => {
      const agreement = await tx.agreement.findFirst({ where: { id: after.body.agreementId } });
      expect(agreement?.serviceDescription).toBe(D6A);
      expect(agreement?.particularsLockedAt).not.toBeNull();
      expect(agreement?.status).toBe('awaiting_signature');
      // THE PLATFORM DID IT, and the record says so rather than naming a staff
      // member who was not standing there.
      expect(agreement?.serviceDescriptionSetBy).toBeNull();

      // The earlier draft was NOT swept up by the new default.
      const earlier = await tx.agreement.findFirst({ where: { id: before.body.agreementId } });
      expect(earlier?.serviceDescription).toBeNull();
    });

    const rows = (await pushableHere().expect(200)).body;
    const readyRow = rows.find((r: { agreementId: string }) => r.agreementId === after.body.agreementId);
    /*
     * LOCKED AND READY, WAITING ONLY TO BE ASKED WHO IS SIGNING — which is a
     * person's answer and not a practice setting (Carl, 7 Sep 2026). What this
     * test is about is D6a, and D6a is now the one thing NOT in the way.
     */
    expect(readyRow.blockedReason).toBe('assignor_not_confirmed');
    expect(readyRow.serviceDescription).toBe(D6A);
    await request(app.getHttpServer())
      .post(`/agreements/${after.body.agreementId}/assignor`)
      .set('x-practice-id', noDefaultPracticeId)
      .send({ assignorIsPatient: true })
      .expect(201);
    const askedRow = (await pushableHere().expect(200)).body.find(
      (r: { agreementId: string }) => r.agreementId === after.body.agreementId,
    );
    expect(askedRow.pushable).toBe(true);
    // And the one that was already waiting is still waiting, with its reason.
    const stillBlocked = rows.find((r: { agreementId: string }) => r.agreementId === before.body.agreementId);
    expect(stillBlocked.blockedReason).toBe('service_description_missing');
  });

  // -------------------------------------------------------------------------
  // The billing role (Carl, 5–7 Sep 2026; TODO.md "Billing role on the
  // affiliation"). The provider on an agreement is the SERVICING PROVIDER
  // whose provider number goes on the claim, never (of itself) the person who
  // delivered the service.
  // -------------------------------------------------------------------------

  describe('who may be the provider on an agreement', () => {
    /*
     * A PRACTICE NURSE, WIRED UP THE WAY THE PLATFORM CAN ACTUALLY SEE IT.
     * The arrival names the practitioner at a location outright, and the
     * billing role is read off that same row — no matching, no keys, nothing
     * to guess. That is what retiring `providers` as the anchor bought
     * (Carl, 7 Sep 2026).
     */
    /*
     * UNIQUE PER RUN. `practitioners` is a PLATFORM table, not a practice one —
     * one identity across every practice they work at — so it survives this
     * suite's practice-scoped teardown, and a fixed number makes the second
     * run of the suite fail on the unique index. Cleaned up below as well.
     */
    let nurseAffiliationId: string;
    let nursePractitionerId: string;

    afterAll(async () => {
      /*
       * `practitioners` IS A PLATFORM TABLE, not a practice one — one identity
       * across every practice somebody works at — so it survives this suite's
       * practice-scoped teardown and has to be cleaned up by hand.
       */
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.affiliation.deleteMany({ where: { practitionerId: nursePractitionerId } });
      });
      await prisma.practitioner.deleteMany({ where: { id: nursePractitionerId } });
    });

    beforeAll(async () => {
      await prisma.withPractice(practiceId, async (tx) => {
        const nurse = await createServicingProvider(tx, practiceId, {
          name: 'Nurse Example',
          // Nothing in the provider TYPE says "practice nurse" — which is
          // exactly why the role had to be recorded rather than inferred.
          providerType: 'other',
          billingRole: 'works_under_provider',
        });
        nurseAffiliationId = nurse.affiliationId;
        nursePractitionerId = nurse.practitionerId;
      });
    });

    /**
     * CARL'S FIRST RULING. An arrival naming a nurse is refused, and reception
     * picks the provider the claim will go under — the alternative, taking a
     * `supervisingProviderId` from the PMS, would have the practice's software
     * deciding whose name goes on a contract.
     */
    it('arrival_naming_a_non_servicing_provider_is_refused_with_the_reason', async () => {
      const refused = await post(
        arrival({ pmsPatientRecordNumber: 'ARR-NURSE', affiliationId: nurseAffiliationId }),
      ).expect(422);

      expect(refused.body.reason).toBe('provider_not_servicing');
      expect(refused.body.billingRole).toBe('works_under_provider');
      expect(refused.body.message).toMatch(/Nurse Example/);
      expect(refused.body.message).toMatch(/provider number/i);

      await prisma.withPractice(practiceId, async (tx) => {
        // NOTHING ABOUT THE PATIENT MOVED. No mirror row, no assignor, no
        // draft, nothing on reception's queue.
        expect(await tx.patient.count({ where: { patientRecordNumber: 'ARR-NURSE' } })).toBe(0);

        const row = await tx.arrival.findFirst({ where: { pmsPatientRecordNumber: 'ARR-NURSE' } });
        expect(row?.outcome).toBe('refused');
        expect(row?.refusedReason).toBe('provider_not_servicing');
        expect(row?.agreementId).toBeNull();
        expect(row?.assignorId).toBeNull();
        expect(row?.visitDecision).toBeNull();

        // The refusal and its event committed together (hard rule 11).
        const events = await prisma.vaultOutbox.findMany({
          where: { type: 'arrival.refused', subjectId: row!.id },
        });
        expect(events).toHaveLength(1);
        const payload = events[0].payload as Record<string, unknown>;
        expect(payload.billingRole).toBe('works_under_provider');
        // Ids, a reason and a role — no patient value of any kind.
        expect(JSON.stringify(payload)).not.toContain('Robin');
        expect(JSON.stringify(payload)).not.toContain('Example Street');
      });

      // And it is on the desk's list, with the reason and the role on it.
      const waiting = await request(app.getHttpServer())
        .get('/arrivals/needing-a-provider')
        .set('x-practice-id', practiceId)
        .expect(200);
      const line = waiting.body.find(
        (r: { pmsPatientRecordNumber: string }) => r.pmsPatientRecordNumber === 'ARR-NURSE',
      );
      expect(line.reason).toBe('provider_not_servicing');
      expect(line.providerName).toBe('Nurse Example');
      expect(line.billingRole).toBe('works_under_provider');
      // The platform had never seen this person, so there is no name to show —
      // the practice's own record number stands in, and no other detail does.
      expect(line.patientName).toBeNull();
      expect(JSON.stringify(line)).not.toContain('1968-04-11');
    });

    /** The picker cannot offer the person who was just refused. */
    it('the provider picker offers servicing providers only', async () => {
      const choices = await request(app.getHttpServer())
        .get('/arrivals/servicing-providers')
        .set('x-practice-id', practiceId)
        .expect(200);
      const ids = choices.body.map((c: { affiliationId: string }) => c.affiliationId);
      expect(ids).toContain(alliedAffiliationId);
      expect(ids).not.toContain(nurseAffiliationId);
      // Two sites, one doctor: both are offered, and each says which site, so
      // reception is never picking between two identical lines.
      const gpLines = choices.body.filter((c: { name: string }) => c.name === 'Dr Sample GP');
      expect(gpLines).toHaveLength(2);
      expect(new Set(gpLines.map((c: { locationLabel: string }) => c.locationLabel)).size).toBe(2);
    });

    /**
     * RECEPTION'S FIX, AND IT IS ONE CLICK. The same walk-in comes back under
     * the same idempotency key with a servicing provider named, so the retry
     * SUPERSEDES the refusal rather than putting one person on the queue twice.
     */
    it('refused_arrival_can_be_resubmitted_with_a_servicing_provider', async () => {
      const key = `arr-resubmit-${randomUUID()}`;
      const refused = await post(
        arrival({ pmsPatientRecordNumber: 'ARR-REDO', affiliationId: nurseAffiliationId, idempotencyKey: key }),
      ).expect(422);
      expect(refused.body.reason).toBe('provider_not_servicing');

      const arrivalId = await prisma.withPractice(practiceId, async (tx) => {
        const row = await tx.arrival.findFirst({ where: { idempotencyKey: key } });
        return row!.id;
      });

      const fixed = await request(app.getHttpServer())
        .post(`/arrivals/${arrivalId}/provider`)
        .set('x-practice-id', practiceId)
        .send({ affiliationId: alliedAffiliationId })
        .expect(201);

      expect(fixed.body.arrivalId).toBe(arrivalId);
      expect(fixed.body.decision.type).toBe('episodic_pre');
      expect(fixed.body.agreementId).toBeTruthy();

      await prisma.withPractice(practiceId, async (tx) => {
        // ONE ROW, not two — the same walk-in.
        expect(await tx.arrival.count({ where: { idempotencyKey: key } })).toBe(1);
        const row = await tx.arrival.findFirst({ where: { id: arrivalId } });
        expect(row?.outcome).toBe('received');
        expect(row?.refusedReason).toBeNull();
        // THE HELD MESSAGE IS GONE. From here the patient row IS the record.
        expect(row?.refusedPayload).toBeNull();
        expect(row?.affiliationId).toBe(alliedAffiliationId);

        // The details that landed on the mirror are the PMS's own, replayed.
        const patient = await tx.patient.findFirst({ where: { patientRecordNumber: 'ARR-REDO' } });
        expect(patient?.givenNames).toBe('Robin');
        expect(patient?.address).toBe('4 Example Street, Sampletown NSW 2000');
      });

      // Off the "needs a provider" list, and on reception's queue instead.
      const waiting = await request(app.getHttpServer())
        .get('/arrivals/needing-a-provider')
        .set('x-practice-id', practiceId)
        .expect(200);
      expect(
        waiting.body.some((r: { arrivalId: string }) => r.arrivalId === arrivalId),
      ).toBe(false);

      const pushable = await request(app.getHttpServer())
        .get('/tablet-sessions/pushable')
        .set('x-practice-id', practiceId)
        .expect(200);
      expect(
        pushable.body.some((r: { agreementId: string }) => r.agreementId === fixed.body.agreementId),
      ).toBe(true);
    });

    /**
     * THE SAME RULE AT THE OTHER DOORS. An arrival is the commonest way an
     * agreement gets a provider; it is not the only one. Drafting by hand goes
     * through `AgreementsService`, which owns the guards.
     */
    it('nurse_cannot_be_the_provider_on_an_agreement', async () => {
      const setUp = await post(arrival({ pmsPatientRecordNumber: 'ARR-MANUAL' })).expect(201);

      const manual = await request(app.getHttpServer())
        .post('/agreements')
        .set('x-practice-id', practiceId)
        .send({
          type: 'episodic_pre',
          affiliationId: nurseAffiliationId,
          patientId: setUp.body.patientId,
          assignorId: await prisma.withPractice(practiceId, async (tx) => {
            const assignor = await tx.assignor.findFirst({ where: { authorityBasis: 'self' } });
            return assignor!.id;
          }),
          assignorIsPatient: true,
        })
        .expect(400);
      expect(manual.body.message).toMatch(/servicing provider/i);
    });
  });
});
