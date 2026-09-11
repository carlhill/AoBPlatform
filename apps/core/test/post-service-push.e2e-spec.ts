import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ValidationResponse } from '@aobplatform/contracts';
import { VISIT_POLICY_VERSION } from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DevicesService } from '../src/devices/devices.service';
import { PostServiceChaseSweep } from '../src/arrivals/post-service-chase.sweep';
import { TabletSessionsService } from '../src/tablet-sessions/tablet-sessions.service';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';
import { createServicingProvider, deleteSeededAnchors } from './anchor';

/**
 * THE POST-SERVICE SECOND PUSH (Carl, 11 Sep 2026; TODO.md "Two front doors"
 * decision (b), "Still to build: Post-service push").
 *
 * WHAT THESE TESTS PIN, each a failure a practice would otherwise find:
 *
 *  - A rendered service with nothing covering it produces a LOCKED
 *    `episodic_post` on reception's desk, carrying D5 and D6b and no amount
 *    (hard rules 2 and 4).
 *  - A service today's signed pre-agreement covers drafts NOTHING, says which
 *    agreement covers it, and shows as a history line rather than a Send
 *    ("one signature per episodic visit, not two").
 *  - The push records a FRESH staff-verified event with the pushing staff
 *    member's identity (REQ-VER-03), because the second push is the same
 *    receptionist handing the tablet to the person they checked in an hour ago.
 *  - The details check is skipped for a patient who ticked their details in a
 *    pushed session at this practice today, and runs when nobody did.
 *  - No signature within thirty minutes enters the existing cascade, and never
 *    past the lodgement deadline (REQ-CHASE-05, REQ-CHASE-08).
 *  - No Medicare number and no dollar amount get in at the one place a caller
 *    reaches with a JSON body no compiler sees (hard rules 1 and 4).
 */
const passingRules = {
  validate: async (): Promise<ValidationResponse> => ({
    valid: true,
    results: [{ rule: 'C8', outcome: 'pass', message: 'D7 is complete.', citation: 's 65C(4)' }],
    ruleSetVersion: 'test-rules-1',
    mappingVersion: 'test-mapping-1',
  }),
};

const D6A = 'General practitioner attendance';
const today = () => new Date().toISOString().slice(0, 10);

const RECEPTIONIST = {
  sub: '00000000-0000-4000-8000-0000000p0501',
  principalType: 'staff',
  roles: [],
  preferredUsername: 'mai.frontdesk',
  raw: {},
};
let currentPrincipal: Record<string, unknown> | null = null;

describe('the post-service second push (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sweep: PostServiceChaseSweep;

  const practiceId = randomUUID();
  let gpAffiliationId: string;
  let gpPractitionerId: string;
  let gpProviderNumber: string;
  let deviceId: string;
  /** A second paired tablet, so an earlier session can exist without holding the first. */
  let secondDeviceId: string;

  const service = (over: Record<string, unknown> = {}) => ({
    pmsPatientRecordNumber: 'POST-0001',
    affiliationId: gpAffiliationId,
    serviceDate: today(),
    mbsItemNumbers: ['23'],
    source: 'dev',
    idempotencyKey: `svc-${randomUUID()}`,
    ...over,
  });

  const postService = (body: Record<string, unknown>, scope = practiceId) =>
    request(app.getHttpServer()).post('/arrivals/service-rendered').set('x-practice-id', scope).send(body);

    /**
   * THE DEVICE AS ITS PAIRING CREDENTIAL RESOLVES IT. `currentFor` takes a
   * `ResolvedDevice` — what the kiosk guard produces from an opaque credential —
   * and this suite asks it directly rather than driving `GET /kiosk/session`,
   * because the credential is minted inside `DevicesService.pair` and a test
   * that re-derived it would be testing the pairing rather than the payload.
   */
  const asResolvedDevice = () => ({
    deviceId,
    practiceId,
    label: 'Front desk tablet',
    // NOT a test device: the waiting list is the walk-up kiosk's surface and
    // has nothing to do with a pushed session.
    showsWaitingList: false,
  });

  /** A patient the practice already holds, as the arrival would have left them. */
  async function seedPatient(recordNumber: string, over: Record<string, unknown> = {}): Promise<string> {
    return prisma.withPractice(practiceId, async (tx) => {
      const patient = await tx.patient.create({
        data: {
          practiceId,
          patientRecordNumber: recordNumber,
          familyName: 'Postvisit',
          givenNames: 'Jo',
          dateOfBirth: new Date('1979-02-03'),
          address: '9 Example Street, Sampletown NSW 2000',
          mobile: '+61400000902',
          email: `${recordNumber.toLowerCase()}@example.invalid`,
          ...over,
        },
      });
      return patient.id;
    });
  }

  /**
   * A SIGNED pre-agreement for this patient, this practitioner and this day —
   * the thing that makes a later service `covered`. Written directly because
   * this suite is about what happens AFTER one exists, not about how it is made.
   */
  async function seedSignedPreAgreement(patientId: string, serviceDate: string): Promise<string> {
    return prisma.withPractice(practiceId, async (tx) => {
      const assignor = await tx.assignor.create({
        data: { practiceId, name: 'Jo Postvisit', dateOfBirth: new Date('1979-02-03'), authorityBasis: 'self' },
      });
      const agreement = await tx.agreement.create({
        data: {
          practiceId,
          type: 'episodic_pre',
          anchorKind: 'provider',
          affiliationId: gpAffiliationId,
          patientId,
          assignorId: assignor.id,
          assignorIsPatient: true,
          status: 'stored',
          particularsLockedAt: new Date(),
          particulars: { serviceDate, basicServiceDescription: D6A },
          signatureEventId: randomUUID(),
        },
      });
      return agreement.id;
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RULES_CLIENT)
      .useValue(passingRules)
      .compile();
    app = moduleRef.createNestApplication();
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      if (currentPrincipal) req.principal = currentPrincipal;
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    sweep = app.get(PostServiceChaseSweep);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({
        data: { id: practiceId, name: 'Post Service Test Practice', defaultServiceDescription: D6A },
      });
      const gp = await createServicingProvider(tx, practiceId, {
        name: 'Dr Sample GP',
        providerType: 'general_practitioner',
        providerNumber: '3333333A',
        locationCode: 'Main',
      });
      gpAffiliationId = gp.affiliationId;
      gpPractitionerId = gp.practitionerId;
      gpProviderNumber = gp.providerNumber!;
    });

    // A paired tablet, through the service that owns pairing — the same way the
    // enduring-push suite does it, so the device this test pushes to is the
    // device a real practice would have.
    const devices = app.get(DevicesService);
    const registered = await devices.registerForDev(practiceId, 'Front desk tablet');
    await devices.pair(registered.code, 'post-service-e2e');
    deviceId = registered.deviceId;
    const second = await devices.registerForDev(practiceId, 'Nurse station tablet');
    await devices.pair(second.code, 'post-service-e2e-2');
    secondDeviceId = second.deviceId;
  });

  beforeEach(() => {
    currentPrincipal = null;
  });

  /*
   * ONE SESSION PER DEVICE is a partial unique index, so a test that leaves a
   * tablet holding a session makes the NEXT test's push a 409 — which is the
   * product working and the suite being untidy. Ended here rather than in each
   * test's last line, so a failing assertion cannot strand a device.
   */
  afterEach(async () => {
    await prisma.withPractice(practiceId, (tx) =>
      tx.tabletSession.updateMany({
        where: { endedAt: null },
        data: { state: 'recalled', endedAt: new Date() },
      }),
    );
  });

  afterAll(async () => {
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.tabletSession.deleteMany({});
      await tx.device.deleteMany({});
      await tx.outboundItem.deleteMany({});
      await tx.captureRequest.deleteMany({});
      await tx.verificationChallenge.deleteMany({});
      // Verification events are APPEND-ONLY evidence (REQ-VER-04) and the
      // database refuses to delete them. They carry no value, only types and
      // outcomes, so they are left exactly as every other suite leaves them.
      await tx.serviceRecord.deleteMany({});
      await tx.agreement.deleteMany({});
      await tx.assignor.deleteMany({});
      await tx.patient.deleteMany({});
      await tx.provider.deleteMany({});
      await deleteSeededAnchors(tx);
      await tx.practice.deleteMany({});
    });
    await prisma.vaultOutbox.deleteMany({});
    await app?.close();
  });

  // -------------------------------------------------------------------------
  // The trigger and the decision
  // -------------------------------------------------------------------------

  it('post_service_push_drafts_an_episodic_post_from_the_rendered_service', async () => {
    await seedPatient('POST-DRAFT');
    const res = await postService(service({ pmsPatientRecordNumber: 'POST-DRAFT' })).expect(201);

    expect(res.body.decision).toEqual({
      outcome: 'episodic_post',
      reason: 'post_agreement_for_this_service',
    });
    expect(res.body.policyVersion).toBe(VISIT_POLICY_VERSION);
    expect(res.body.agreementId).toBeTruthy();
    expect(res.body.coveringAgreementId).toBeNull();

    await prisma.withPractice(practiceId, async (tx) => {
      const agreement = await tx.agreement.findFirst({ where: { id: res.body.agreementId } });
      expect(agreement?.type).toBe('episodic_post');
      expect(agreement?.affiliationId).toBe(gpAffiliationId);
      expect(agreement?.status).toBe('awaiting_signature');
      const capture = await tx.captureRequest.findFirst({
        where: { agreementId: res.body.agreementId, channel: 'in_practice' },
      });
      expect(capture?.status).toBe('open');
    });

    // On the desk, by the read the desk itself uses — two answers to "who is
    // waiting" is how two screens come to disagree in front of a patient.
    const pushable = await request(app.getHttpServer())
      .get('/tablet-sessions/pushable')
      .set('x-practice-id', practiceId)
      .expect(200);
    const row = pushable.body.find((r: { agreementId: string }) => r.agreementId === res.body.agreementId);
    expect(row).toBeTruthy();
    expect(row.agreementType).toBe('episodic_post');
    expect(row.serviceDate).toBe(today());
    expect(row.mbsItemNumbers).toEqual(['23']);
    // A new agreement owes its own confirmation (ASSIGNOR-RULES rule 1).
    expect(row.assignorConfirmedAt).toBeNull();
    expect(row.blockedReason).toBe('assignor_not_confirmed');
  });

  it('post_agreement_carries_d5_and_d6b_and_no_amount', async () => {
    await seedPatient('POST-D6B');
    const res = await postService(
      service({ pmsPatientRecordNumber: 'POST-D6B', mbsItemNumbers: ['23', '10990'] }),
    ).expect(201);

    const particulars = await prisma.withPractice(practiceId, async (tx) => {
      const agreement = await tx.agreement.findFirst({ where: { id: res.body.agreementId } });
      return agreement?.particulars as Record<string, unknown>;
    });

    expect(particulars.serviceDate).toBe(today());
    expect(particulars.mbsItemNumbers).toEqual(['23', '10990']);
    // D6a is a PRE-agreement particular (REQ-REG-01) and must not be assembled
    // onto a post-agreement even though the practice has a default set.
    expect(particulars.basicServiceDescription).toBeUndefined();
    // HARD RULE 4 — no benefit and no dollar amount anywhere on the artefact.
    const serialised = JSON.stringify(particulars);
    expect(serialised).not.toMatch(/amount|benefit|rebate|\$/i);
  });

  it('post_agreement_locked_before_the_tablet_can_sign', async () => {
    await seedPatient('POST-LOCK');
    const res = await postService(service({ pmsPatientRecordNumber: 'POST-LOCK' })).expect(201);

    await prisma.withPractice(practiceId, async (tx) => {
      const agreement = await tx.agreement.findFirst({ where: { id: res.body.agreementId } });
      /*
       * REQ-REG-06, hard rule 2: the particulars are complete, validated and
       * locked on the SERVER before any device can see anything, so a tablet
       * structurally cannot hold a draft. Signing a draft is the offence.
       */
      expect(agreement?.particularsLockedAt).not.toBeNull();
      expect(agreement?.ruleSetVersion).toBe('test-rules-1');
      expect(agreement?.renderedArtefactHash).toBeTruthy();
      expect(agreement?.signatureEventId).toBeNull();
    });
  });

  it('a_covered_service_drafts_nothing_and_says_so', async () => {
    const patientId = await seedPatient('POST-COVERED');
    const covering = await seedSignedPreAgreement(patientId, today());

    const res = await postService(service({ pmsPatientRecordNumber: 'POST-COVERED' })).expect(201);

    expect(res.body.decision).toEqual({ outcome: 'covered', reason: 'covered_by_todays_agreement' });
    expect(res.body.agreementId).toBeNull();
    expect(res.body.coveringAgreementId).toBe(covering);

    await prisma.withPractice(practiceId, async (tx) => {
      // Nothing new was drafted, and the old agreement was not touched (rule 13).
      const posts = await tx.agreement.findMany({ where: { patientId, type: 'episodic_post' } });
      expect(posts).toHaveLength(0);
      const old = await tx.agreement.findFirst({ where: { id: covering } });
      expect(old?.status).toBe('stored');
      expect(old?.particulars).toEqual({ serviceDate: today(), basicServiceDescription: D6A });
    });

    // A quiet history line, never a Send.
    const covered = await request(app.getHttpServer())
      .get('/tablet-sessions/covered')
      .set('x-practice-id', practiceId)
      .expect(200);
    const line = covered.body.find((r: { serviceRecordId: string }) => r.serviceRecordId === res.body.serviceRecordId);
    expect(line).toBeTruthy();
    expect(line.decision).toBe('covered');
    expect(line.reason).toBe('covered_by_todays_agreement');
    expect(line.coveringAgreementId).toBe(covering);
    expect(line.policyVersion).toBe(VISIT_POLICY_VERSION);

    const pushable = await request(app.getHttpServer())
      .get('/tablet-sessions/pushable')
      .set('x-practice-id', practiceId)
      .expect(200);
    expect(pushable.body.some((r: { patientId: string }) => r.patientId === patientId)).toBe(false);
  });

  it("yesterday's signed agreement does not cover today's service", async () => {
    const patientId = await seedPatient('POST-YESTERDAY');
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await seedSignedPreAgreement(patientId, yesterday);

    const res = await postService(service({ pmsPatientRecordNumber: 'POST-YESTERDAY' })).expect(201);
    expect(res.body.decision.outcome).toBe('episodic_post');
  });

  it('a retry of the same rendered service produces one agreement, not two', async () => {
    await seedPatient('POST-RETRY');
    const body = service({ pmsPatientRecordNumber: 'POST-RETRY' });
    const first = await postService(body).expect(201);
    const second = await postService(body).expect(201);

    expect(second.body.repeat).toBe(true);
    expect(second.body.serviceRecordId).toBe(first.body.serviceRecordId);
    expect(second.body.agreementId).toBe(first.body.agreementId);
  });

  // -------------------------------------------------------------------------
  // The door
  // -------------------------------------------------------------------------

  it('service_rendered_endpoint_rejects_a_medicare_number', async () => {
    await seedPatient('POST-CARD');
    /*
     * EVERY SPELLING, BECAUSE THE MISTAKE ARRIVES UNDER A NEW ONE EVERY TIME.
     * The fence matches on the field NAME rather than on a list of literals,
     * and the field names are built here rather than written as identifiers so
     * that the repo's own ESLint rule — which bans the identifier outright — is
     * not the thing under test (the arrivals suite does the same).
     */
    for (const field of ['medicareNumber', 'medicare_card', 'patientMedicareIrn']) {
      const body = { ...service({ pmsPatientRecordNumber: 'POST-CARD' }), [field]: '0000 00000 0' };
      const res = await postService(body).expect(400);
      expect(res.body.message).toMatch(/not an identity identifier/i);
    }

    await prisma.withPractice(practiceId, async (tx) => {
      // Nothing was written: the fence runs before any row moves.
      expect(await tx.serviceRecord.count({ where: { visitDecision: null } })).toBe(0);
    });
  });

  it('service_rendered_endpoint_rejects_an_amount', async () => {
    await seedPatient('POST-MONEY');
    const res = await postService(
      service({ pmsPatientRecordNumber: 'POST-MONEY', benefitAmount: '41.40' }),
    ).expect(400);
    expect(res.body.message).toMatch(/no benefit or dollar amount/i);
  });

  it('refuses a patient this practice has never seen, and names the fix', async () => {
    const res = await postService(service({ pmsPatientRecordNumber: 'POST-STRANGER' })).expect(404);
    expect(res.body.message).toMatch(/POST \/arrivals/);
  });

  it('refuses a service with no item numbers: D6b is what a post-agreement carries', async () => {
    await seedPatient('POST-NOITEM');
    await postService(service({ pmsPatientRecordNumber: 'POST-NOITEM', mbsItemNumbers: [] })).expect(400);
  });

  // -------------------------------------------------------------------------
  // The desk and the tablet
  // -------------------------------------------------------------------------

  it('post_push_records_a_fresh_staff_verified_event', async () => {
    const patientId = await seedPatient('POST-VERIFY');
    const res = await postService(service({ pmsPatientRecordNumber: 'POST-VERIFY' })).expect(201);

    const before = await prisma.withPractice(practiceId, (tx) =>
      tx.verificationEvent.count({ where: { patientId } }),
    );

    // Who is signing, answered once at the desk (ASSIGNOR-RULES rule 1).
    currentPrincipal = { ...RECEPTIONIST, practiceId };
    await request(app.getHttpServer())
      .post(`/agreements/${res.body.agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({ assignorIsPatient: true })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/devices/${deviceId}/push`)
      .set('x-practice-id', practiceId)
      .send({ agreementId: res.body.agreementId })
      .expect(201);

    await prisma.withPractice(practiceId, async (tx) => {
      const events = await tx.verificationEvent.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' } });
      expect(events.length).toBe(before + 1);
      const fresh = events[0];
      // The push's own channel and outcome — a staff check across the desk.
      expect(fresh.channel).toBe('in_practice');
      expect(fresh.outcome).toBe('passed');
      // REQ-VER-03 — the same staff identity that pushed.
      expect(fresh.verifiedByStaffId).toBe(RECEPTIONIST.sub);
      // REQ-VER-04 — identifier TYPES, and the Medicare card is never one of
      // them (hard rule 1, REQ-VER-02).
      expect(fresh.identifierTypes.length).toBeGreaterThan(0);
      expect(fresh.identifierTypes.join(',')).not.toMatch(/medicare/i);
      // REQ-VER-04 — identifier TYPES and an outcome, never a value.
      expect(JSON.stringify(fresh)).not.toMatch(/Postvisit|Example Street/);
    });
  });

  it('tablet_runs_the_details_check_when_nothing_was_verified_today', async () => {
    const patientId = await seedPatient('POST-CHECKRUN');
    const res = await postService(service({ pmsPatientRecordNumber: 'POST-CHECKRUN' })).expect(201);

    currentPrincipal = { ...RECEPTIONIST, practiceId };
    await request(app.getHttpServer())
      .post(`/agreements/${res.body.agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({ assignorIsPatient: true })
      .expect(201);
    const pushed = await request(app.getHttpServer())
      .post(`/devices/${deviceId}/push`)
      .set('x-practice-id', practiceId)
      .send({ agreementId: res.body.agreementId })
      .expect(201);

    const session = await prisma.withPractice(practiceId, (tx) =>
      tx.tabletSession.findFirst({ where: { id: pushed.body.id } }),
    );
    expect(session).toBeTruthy();
    const payload = await app.get(TabletSessionsService).currentFor(asResolvedDevice());
    expect(payload.session?.detailsCheck).toBe('required');
    expect(payload.session?.patientId).toBe(patientId);
  });

  it('tablet_skips_the_details_check_after_a_same_day_verified_session', async () => {
    const patientId = await seedPatient('POST-CHECKSKIP');
    /*
     * THE FIRST SESSION OF THE DAY — the pre-service push, where the patient
     * ticked their five details. Written directly onto a session for an
     * agreement of this patient's, because what the skip turns on is the FACT
     * that they were confirmed today, not how that session was driven.
     */
    const first = await postService(service({ pmsPatientRecordNumber: 'POST-CHECKSKIP' })).expect(201);
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.tabletSession.create({
        data: {
          practiceId,
          // A SECOND DEVICE, so the earlier session cannot be mistaken for the
          // one this test is about — and so the front-desk tablet stays free.
          deviceId: secondDeviceId,
          agreementId: first.body.agreementId,
          // ENDED, and ended the way a completed ceremony ends. The ticks
          // happened; the session is behind them.
          state: 'signed',
          pushedBy: 'Mai Frontdesk',
          pushedById: RECEPTIONIST.sub,
          detailsConfirmedTypes: ['name', 'date_of_birth', 'address'],
          detailsConfirmedAt: new Date(),
          endedAt: new Date(),
        },
      });
    });

    // The SECOND push, for a second rendered service the same day.
    const second = await postService(
      service({ pmsPatientRecordNumber: 'POST-CHECKSKIP', mbsItemNumbers: ['36'] }),
    ).expect(201);
    currentPrincipal = { ...RECEPTIONIST, practiceId };
    await request(app.getHttpServer())
      .post(`/agreements/${second.body.agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({ assignorIsPatient: true })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/devices/${deviceId}/push`)
      .set('x-practice-id', practiceId)
      .send({ agreementId: second.body.agreementId })
      .expect(201);

    const payload = await app.get(TabletSessionsService).currentFor(asResolvedDevice());
    expect(payload.session?.detailsCheck).toBe('confirmed_today');
    expect(payload.session?.patientId).toBe(patientId);
  });

  // -------------------------------------------------------------------------
  // The fallback
  // -------------------------------------------------------------------------

  it('no_signature_in_thirty_minutes_enters_the_cascade', async () => {
    await seedPatient('POST-CHASE');
    const res = await postService(service({ pmsPatientRecordNumber: 'POST-CHASE' })).expect(201);

    /*
     * NOT YET. Inside the thirty-minute grace period the DESK still owns the
     * visit — the patient is walking from the consulting room to reception, and
     * a message sent now would arrive while they are standing at the tablet.
     * Asserted through the sweep, because the grace period is the sweep's rule:
     * `startCascadeFor` is the mechanism and a future "chase now" console act
     * must be able to use it.
     */
    expect((await sweep.sweepPractice(practiceId)).started).toBe(0);

    // Thirty-one minutes later, with nobody having signed.
    await prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.update({
        where: { id: res.body.serviceRecordId },
        data: { serviceRenderedAt: new Date(Date.now() - 31 * 60 * 1000) },
      }),
    );
    const { started } = await sweep.sweepPractice(practiceId);
    expect(started).toBeGreaterThanOrEqual(1);

    await prisma.withPractice(practiceId, async (tx) => {
      const record = await tx.serviceRecord.findFirst({ where: { id: res.body.serviceRecordId } });
      expect(record?.chaseStartedAt).not.toBeNull();
      // The first rung is a REMOTE channel on the SAME agreement — one ladder.
      const remote = await tx.captureRequest.findMany({
        where: { agreementId: res.body.agreementId, channel: { in: ['email_link', 'sms_link'] } },
      });
      expect(remote.length).toBe(1);
      const queued = await tx.outboundItem.findMany({ where: { subjectId: remote[0].id } });
      expect(queued.length).toBe(1);
      // Hard rule 4 — nothing the platform sends carries a benefit figure.
      expect(JSON.stringify(queued[0].payload)).not.toMatch(/\$|benefit amount|rebate/i);
    });

    // And it is entered ONCE: a second sweep finds nothing to do.
    const again = await sweep.sweepPractice(practiceId);
    expect(again.started).toBe(0);
  });

  it('a signature at the desk means the cascade never starts', async () => {
    await seedPatient('POST-SIGNED');
    const res = await postService(service({ pmsPatientRecordNumber: 'POST-SIGNED' })).expect(201);
    await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.update({
        where: { id: res.body.agreementId },
        data: { signatureEventId: randomUUID() },
      }),
    );
    await prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.update({
        where: { id: res.body.serviceRecordId },
        data: { serviceRenderedAt: new Date(Date.now() - 31 * 60 * 1000) },
      }),
    );

    expect(await sweep.startCascadeFor(practiceId, res.body.serviceRecordId)).toBe('declined');
    await prisma.withPractice(practiceId, async (tx) => {
      const remote = await tx.captureRequest.findMany({
        where: { agreementId: res.body.agreementId, channel: { in: ['email_link', 'sms_link'] } },
      });
      expect(remote).toHaveLength(0);
    });
  });

  it('never chases a confidentiality-flagged patient (REQ-CHASE-03)', async () => {
    await seedPatient('POST-CONF', { confidentialityFlag: true });
    const res = await postService(service({ pmsPatientRecordNumber: 'POST-CONF' })).expect(201);
    await prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.update({
        where: { id: res.body.serviceRecordId },
        data: { serviceRenderedAt: new Date(Date.now() - 31 * 60 * 1000) },
      }),
    );

    expect(await sweep.startCascadeFor(practiceId, res.body.serviceRecordId)).toBe('declined');
    await prisma.withPractice(practiceId, async (tx) => {
      const remote = await tx.captureRequest.findMany({
        where: { agreementId: res.body.agreementId, channel: { in: ['email_link', 'sms_link'] } },
      });
      expect(remote).toHaveLength(0);
    });
  });

  it('never chases past the lodgement deadline (REQ-CHASE-08)', async () => {
    await seedPatient('POST-EXPIRED');
    const longAgo = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
    const res = await postService(
      service({ pmsPatientRecordNumber: 'POST-EXPIRED', serviceDate: longAgo }),
    ).expect(201);
    await prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.update({
        where: { id: res.body.serviceRecordId },
        data: { serviceRenderedAt: new Date(Date.now() - 31 * 60 * 1000) },
      }),
    );

    expect(await sweep.startCascadeFor(practiceId, res.body.serviceRecordId)).toBe('declined');
  });

  // -------------------------------------------------------------------------
  // Scope
  // -------------------------------------------------------------------------

  it('another practice cannot see this practice’s rendered services (RLS, fails closed)', async () => {
    await seedPatient('POST-RLS');
    await postService(service({ pmsPatientRecordNumber: 'POST-RLS' })).expect(201);

    const otherPracticeId = randomUUID();
    const covered = await request(app.getHttpServer())
      .get('/tablet-sessions/covered')
      .set('x-practice-id', otherPracticeId)
      .expect(200);
    expect(covered.body).toEqual([]);
  });

  it('the provider number names the practitioner and the place, exactly as an arrival does', async () => {
    await seedPatient('POST-BYNUMBER');
    const res = await postService(
      service({
        pmsPatientRecordNumber: 'POST-BYNUMBER',
        affiliationId: undefined,
        providerNumber: gpProviderNumber,
      }),
    ).expect(201);

    await prisma.withPractice(practiceId, async (tx) => {
      const record = await tx.serviceRecord.findFirst({ where: { id: res.body.serviceRecordId } });
      expect(record?.affiliationId).toBe(gpAffiliationId);
      const agreement = await tx.agreement.findFirst({ where: { id: res.body.agreementId } });
      expect(agreement?.affiliationId).toBe(gpAffiliationId);
    });
    expect(gpPractitionerId).toBeTruthy();
  });
});
