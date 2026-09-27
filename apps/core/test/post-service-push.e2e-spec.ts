import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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
    // The default every tablet has: it would offer Begin to somebody who walked
    // up. Irrelevant to a pushed session, and stated so it is not read as a
    // fixture that happens to be off.
    acceptsWalkUps: true,
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
      // The DB4 Print Records this suite seeded for the push-time check.
      await tx.inboundPrintJob.deleteMany({});
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

  /* -------------------------------------------------------------------------
   * THE PRINT-RECORD CHECK AT THE DESK (Carl, 27 September 2026, from a live
   * tablet: *"If no $ do not allow the approval to progress. Check all details
   * when the reception pushes to the tablet."*).
   *
   * WHY THESE ARE E2E. `db4-form-view.spec.ts` proves the check over an
   * envelope. Only a real push proves the two things that matter here: that an
   * agreement with NO print record is not asked the question at all, and that
   * a refusal ends a screen and changes nothing on the agreement (hard rule 8).
   * ---------------------------------------------------------------------- */

  /** A DB4 Print Record on the queue table, exactly as the driver leaves one. */
  async function seedPrintRecord(services: Prisma.InputJsonValue[]): Promise<string> {
    return seedPrintRecordWithPatient(services, {
      patientRecordNumber: 'POST-PRINTED',
      givenNames: 'Jo',
      familyName: 'Postvisit',
      // FAKE AND INVALID BY CONSTRUCTION — 2 999 99999 9 weights to 353, so
      // the printed check digit is wrong (CLAUDE.md §7).
      // eslint-disable-next-line no-restricted-syntax -- the fixture's own field.
      medicareCardNumber: '2999 99999 9',
      irn: '1',
    });
  }

  /**
   * THE SAME RECORD WITH THE PATIENT BLOCK SPELLED OUT — for the checks that
   * are ABOUT that block (Carl, 27 September 2026: the card number read
   * without its IRN). The default above delegates here, so there is one
   * fixture and the card-and-IRN case is a parameter rather than a copy.
   */
  async function seedPrintRecordWithPatient(
    services: Prisma.InputJsonValue[],
    patient: Prisma.InputJsonValue,
  ): Promise<string> {
    return prisma.withPractice(practiceId, async (tx) => {
      const job = await tx.inboundPrintJob.create({
        data: {
          practiceId,
          documentType: 'db4_assignment',
          lane: 'critical',
          pms: 'pracsoft3',
          parserTemplateVersion: 'pracsoft3-db4-2026-09-1',
          sourceSha256: randomUUID().replace(/-/g, '').padEnd(64, '0'),
          payload: {
            documentType: 'db4_assignment',
            form: { formCode: 'DB4', formReference: `PSP-${randomUUID().slice(0, 8)}`, serviceDate: today() },
            patient,
            providers: [
              { role: 'servicing', name: 'Dr Sample GP', providerNumber: gpProviderNumber },
              { role: 'payee', name: 'Dr Sample GP', providerNumber: gpProviderNumber },
            ],
            services,
          },
        },
      });
      return job.id;
    });
  }

  /** A post-service agreement with who-is-signing answered, ready to push. */
  async function draftReadyToPush(recordNumber: string): Promise<string> {
    await seedPatient(recordNumber);
    const res = await postService(service({ pmsPatientRecordNumber: recordNumber })).expect(201);
    currentPrincipal = { ...RECEPTIONIST, practiceId };
    await request(app.getHttpServer())
      .post(`/agreements/${res.body.agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({ assignorIsPatient: true })
      .expect(201);
    return res.body.agreementId as string;
  }

  it('a_push_with_no_print_record_is_unaffected', async () => {
    /*
     * D-2026-09-27-02 — THE NEW PATH DOES NOT RUN, rather than running and
     * producing the same answer. A walk-up at a practice with no PMS has no
     * printed form to have read wrongly, so there is nothing to check and no
     * read is made. Every other push in this suite is this case; this one says
     * so out loud, so that a future change tightening the check cannot quietly
     * start refusing practices that have no DB4 at all.
     */
    const agreementId = await draftReadyToPush('POST-NOPRINT');

    const agreement = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    expect(agreement?.sourcePrintJobId).toBeNull();

    await request(app.getHttpServer())
      .post(`/devices/${deviceId}/push`)
      .set('x-practice-id', practiceId)
      .send({ agreementId })
      .expect(201);
  });

  it('a_push_from_a_print_record_with_no_amount_is_refused_at_the_desk', async () => {
    /*
     * CARL'S RULING. A real PracSoft DB4 for a bulk-bill claim prints a
     * benefit against its rows, so a print record carrying none most likely
     * means AOBPRINTER's template did not read the form. This is a CONFIDENCE
     * check on our own reproduction and NOT a statutory one — no dollar amount
     * is in the s 65C data set (hard rule 4), and the agreement itself is
     * complete and stays exactly as it was.
     *
     * NOTHING UPSTREAM CATCHES THIS. Ingest gates the chart number, the
     * servicing provider's number, the service date and the item numbers; it
     * never looks at an amount, and nothing else may compute one.
     */
    const agreementId = await draftReadyToPush('POST-NOAMOUNT');
    const jobId = await seedPrintRecord([
      { serviceDate: today(), mbsItemNumber: '23', description: 'Level B' },
    ]);
    await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.updateMany({ where: { id: agreementId }, data: { sourcePrintJobId: jobId } }),
    );

    /*
     * THE AGREEMENT AS IT STANDS BEFORE THE REFUSAL, read rather than assumed.
     * A post-service draft is LOCKED AT DRAFT TIME, so it already sits at
     * `awaiting_signature` with its particulars sealed — the state this test
     * is about is "unchanged", not any particular word.
     */
    const before = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );

    const refused = await request(app.getHttpServer())
      .post(`/devices/${deviceId}/push`)
      .set('x-practice-id', practiceId)
      .send({ agreementId })
      .expect(409);

    // THE CODE IS THE CONTRACT, and every failed check rides with it so
    // reception fixes the form once (CLAUDE.md §7).
    expect(refused.body.reason).toBe('print_record_incomplete');
    expect(refused.body.checks).toEqual(['print_record_benefit_missing']);

    /*
     * AND IT NAMES WHICH FORM (Carl, 27 September 2026: *"some unique id to
     * identify the print ... we must have some unique ref from AOBPrinter
     * which we must be storing for audit"*). "Reprint it" is not an
     * instruction a practice that prints all morning can act on until the
     * refusal says which page — so the identity is part of the answer, not a
     * decoration on it.
     */
    expect(refused.body.print.printJobId).toBe(jobId);
    // AOBPRINTER'S OWN REF, and the row's audit key
    // (`@@unique([practiceId, documentType, sourceSha256])`).
    expect(refused.body.print.sourceSha256).toHaveLength(64);
    // The reference PRINTED ON THE PAGE — what reception matches the paper on.
    expect(refused.body.print.formReference).toMatch(/^PSP-/);
    expect(refused.body.print.parserTemplateVersion).toBe('pracsoft3-db4-2026-09-1');
    /*
     * TIMESTAMPS TO THE SECOND, and this is load-bearing rather than tidy:
     * `...T13:20:54.953Z` contains "54.953", which the hard-rule-4 assertion
     * below reads as a dollar amount. The data loses a precision nobody
     * wanted rather than that guard being taught to make exceptions.
     */
    expect(refused.body.print.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    /*
     * HARD RULE 9 — the refusal names a FIELD and never a value. Asserted on
     * the serialised body, because that is what crossed the wire.
     */
    expect(refused.text).not.toContain('Postvisit');
    expect(refused.text).not.toContain('POST-PRINTED');
    expect(refused.text).not.toContain('2999');
    expect(refused.text).not.toContain(gpProviderNumber);
    // HARD RULE 4 — no amount in the refusal either, in any direction.
    expect(refused.text).not.toMatch(/\d+\.\d{2}/);

    /*
     * HARD RULE 8 — THE REFUSAL ENDS A SCREEN, NOT AN AGREEMENT. No session
     * was opened, the agreement did not move, and reception carries on to
     * paper or to a later capture. The patient is seen and billed either way.
     */
    await prisma.withPractice(practiceId, async (tx) => {
      expect(await tx.tabletSession.count({ where: { agreementId } })).toBe(0);
      const after = await tx.agreement.findFirst({ where: { id: agreementId } });
      // Not one field moved — the status, the lock and the particulars are
      // exactly what they were. A refused push is a screen that never opened.
      expect(after).toEqual(before);
    });
  });

  it('a_push_from_a_print_record_with_a_card_number_and_no_irn_is_refused_at_the_desk', async () => {
    /*
     * CARL, 27 SEPTEMBER 2026, FROM A LIVE TABLET: *"if a medicare# is
     * provided then the IRN must also be provided. Check this on button 'Send
     * to tablet' at reception"*.
     *
     * WHAT HE WAS LOOKING AT. The tablet drew a masked Medicare number with
     * the note underneath telling the patient to check *"the IRN beside your
     * name"* — and no IRN row, because `ParticularsScreen` draws that row only
     * when there is a value. The screen asked somebody to check a field it had
     * not shown them.
     *
     * NOT AN IDENTITY CHECK (hard rule 1, REQ-VER-02). Presence of a parsed
     * field. Nothing reads the digit, and the card identifies nobody.
     */
    const agreementId = await draftReadyToPush('POST-NOIRN');
    const jobId = await seedPrintRecordWithPatient(
      [{ serviceDate: today(), mbsItemNumber: '23', description: 'Level B', benefitAssigned: '45.05' }],
      // A card number read, its IRN not. FAKE AND INVALID BY CONSTRUCTION.
      {
        patientRecordNumber: 'POST-PRINTED',
        givenNames: 'Jo',
        familyName: 'Postvisit',
        // eslint-disable-next-line no-restricted-syntax -- the fixture's own field, invalid by construction.
        medicareCardNumber: '2999 99999 9',
      },
    );
    await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.updateMany({ where: { id: agreementId }, data: { sourcePrintJobId: jobId } }),
    );

    const refused = await request(app.getHttpServer())
      .post(`/devices/${deviceId}/push`)
      .set('x-practice-id', practiceId)
      .send({ agreementId })
      .expect(409);

    expect(refused.body.reason).toBe('print_record_incomplete');
    expect(refused.body.checks).toEqual(['print_record_irn_missing']);
    // HARD RULE 9 — a field is named, never a value. The card number that WAS
    // read must not travel in the refusal that says its IRN did not.
    expect(refused.text).not.toContain('2999');
    expect(refused.text).not.toContain('Postvisit');

    // HARD RULE 8 — a screen was stopped, not a patient. Nothing moved.
    await prisma.withPractice(practiceId, async (tx) => {
      expect(await tx.tabletSession.count({ where: { agreementId } })).toBe(0);
    });
  });

  it('a_push_from_a_print_record_with_no_card_number_at_all_is_not_asked_for_an_irn', async () => {
    /*
     * CONDITIONAL, EXACTLY AS CARL PUT IT: *"IF a medicare# is provided"*. He
     * tested the no-card-number record minutes earlier and reported it
     * working — the tablet draws neither field and no note refers to either,
     * so nothing contradicts anything and there is nothing to refuse.
     */
    const agreementId = await draftReadyToPush('POST-NOCARD');
    const jobId = await seedPrintRecordWithPatient(
      [{ serviceDate: today(), mbsItemNumber: '23', description: 'Level B', benefitAssigned: '45.05' }],
      { patientRecordNumber: 'POST-PRINTED', givenNames: 'Jo', familyName: 'Postvisit' },
    );
    await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.updateMany({ where: { id: agreementId }, data: { sourcePrintJobId: jobId } }),
    );

    await request(app.getHttpServer())
      .post(`/devices/${deviceId}/push`)
      .set('x-practice-id', practiceId)
      .send({ agreementId })
      .expect(201);
  });

  it('the_desk_row_says_the_form_needs_reprinting_before_anybody_presses_send', async () => {
    /*
     * CARL, 27 SEPTEMBER 2026, AT A LIVE DESK: *"the agreement needs to have a
     * status of PMS Data Error or something"*, settled as *"blocked state on
     * the row - 'Form needs reprinting'"*.
     *
     * THE DEFECT THIS CLOSES. The check ran only at the push, so a row that
     * was about to be refused looked exactly like one that would go —
     * reception found out by pressing Send with a patient in front of them.
     * CLAUDE.md §7: every blocked, wrong or waiting message names its
     * specific reason, and it has to do that BEFORE the press.
     *
     * IT IS A BLOCKED ROW, NOT A STATUS ON THE AGREEMENT. The agreement is
     * complete and untouched — asserted below — because no dollar amount is
     * in the s 65C data set (hard rule 4) and what we doubt is our own
     * reading of the form.
     */
    const agreementId = await draftReadyToPush('POST-ROWBLOCK');
    const jobId = await seedPrintRecord([
      { serviceDate: today(), mbsItemNumber: '23', description: 'Level B' },
    ]);
    await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.updateMany({ where: { id: agreementId }, data: { sourcePrintJobId: jobId } }),
    );
    /*
     * SNAPSHOT AFTER THE LINK, BECAUSE THE LINK IS THE TEST'S OWN SETUP. What
     * this asserts is that READING THE LIST writes nothing — not that the
     * fixture never touched the row.
     */
    const before = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );

    const list = await request(app.getHttpServer())
      .get('/tablet-sessions/pushable')
      .set('x-practice-id', practiceId)
      .expect(200);

    const row = (list.body as { agreementId: string }[]).find((r) => r.agreementId === agreementId);
    expect(row).toBeDefined();
    const blocked = row as unknown as {
      pushable: boolean;
      blockedReason: string;
      printRecord: { checks: string[]; print: { printJobId: string; sourceSha256: string } } | null;
    };
    expect(blocked.pushable).toBe(false);
    expect(blocked.blockedReason).toBe('print_record_incomplete');
    // THE SAME TWO FIELDS THE REFUSAL CARRIES, so the band reads identically
    // whether reception met it here or by pressing Send.
    expect(blocked.printRecord?.checks).toEqual(['print_record_benefit_missing']);
    expect(blocked.printRecord?.print.printJobId).toBe(jobId);
    expect(blocked.printRecord?.print.sourceSha256).toHaveLength(64);

    // HARD RULE 9 — the list names fields, never values off the form.
    expect(list.text).not.toContain('2999');
    // HARD RULE 4 — and no amount reaches the desk list in any direction.
    expect(JSON.stringify(blocked.printRecord)).not.toMatch(/\d+\.\d{2}/);

    // AND THE AGREEMENT DID NOT MOVE. This is a computed fact about a print
    // record, not a status written on a valid instrument.
    await prisma.withPractice(practiceId, async (tx) => {
      expect(await tx.agreement.findFirst({ where: { id: agreementId } })).toEqual(before);
    });
  });

  it('a_readable_print_record_leaves_the_row_sendable', async () => {
    // The other side of the same gate, at the LIST rather than the push: the
    // pass cannot be working by blocking everything with a print record.
    const agreementId = await draftReadyToPush('POST-ROWOK');
    const jobId = await seedPrintRecord([
      { serviceDate: today(), mbsItemNumber: '23', description: 'Level B', benefitAssigned: '45.05' },
    ]);
    await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.updateMany({ where: { id: agreementId }, data: { sourcePrintJobId: jobId } }),
    );

    const list = await request(app.getHttpServer())
      .get('/tablet-sessions/pushable')
      .set('x-practice-id', practiceId)
      .expect(200);
    const row = (list.body as { agreementId: string; pushable: boolean; printRecord: unknown }[]).find(
      (r) => r.agreementId === agreementId,
    );
    expect(row?.pushable).toBe(true);
    // AND NOTHING IS SAID ABOUT A RECORD THAT READS CORRECTLY.
    expect(row?.printRecord).toBeNull();
  });

  it('a_push_from_a_complete_print_record_goes_through', async () => {
    // The other side of the same gate: a record with everything on it is not
    // refused, so the check cannot be passing by refusing everything.
    const agreementId = await draftReadyToPush('POST-PRINTOK');
    const jobId = await seedPrintRecord([
      // `0.00` IS AN AMOUNT THE PRACTICE PRINTED. Treating a zero as "no
      // amount" would be AoB forming an opinion about a figure (hard rule 4).
      { serviceDate: today(), mbsItemNumber: '23', description: 'Level B', benefitAssigned: '0.00' },
    ]);
    await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.updateMany({ where: { id: agreementId }, data: { sourcePrintJobId: jobId } }),
    );

    await request(app.getHttpServer())
      .post(`/devices/${deviceId}/push`)
      .set('x-practice-id', practiceId)
      .send({ agreementId })
      .expect(201);
  });

  it('a_print_record_that_cannot_be_read_refuses_nothing', async () => {
    /*
     * HARD RULE 8, THE OTHER WAY ROUND. An agreement pointing at a print job
     * row that is not there — deleted, or a link written before the row
     * committed — is OUR fault, not the form's, and a platform fault must
     * never stop a push. The cost of being wrong is the right way round: a
     * form we could not check reaches a tablet, where the patient reads it and
     * can say it is wrong; failing closed would stop a working practice over
     * an infrastructure problem they cannot see.
     */
    const agreementId = await draftReadyToPush('POST-NOJOBROW');
    await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.updateMany({ where: { id: agreementId }, data: { sourcePrintJobId: randomUUID() } }),
    );

    await request(app.getHttpServer())
      .post(`/devices/${deviceId}/push`)
      .set('x-practice-id', practiceId)
      .send({ agreementId })
      .expect(201);
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

  it('tablet_runs_the_details_check_for_every_agreement_even_after_a_same_day_session', async () => {
    /*
     * CARL'S RULING, 27 SEPTEMBER 2026, FROM A LIVE TABLET: *"force the patient
     * to step1 for each agreement - this is a better rule"*. It SUPERSEDES the
     * ruling of 11 September that this test was written for, and the assertion
     * at the foot of it is inverted rather than the test deleted, so the
     * reversal is on the record where the original behaviour was.
     *
     * WHAT THE OLD RULE DID. The skip matched on the PATIENT: any session for
     * any agreement of theirs, confirmed today at this practice and disputing
     * nothing, meant the next push went straight past K-P1. The intent was
     * kindness — a second agreement for the same visit should not ask a patient
     * the same five questions twice.
     *
     * WHY IT LOSES. Each agreement is its own consent ceremony and its own
     * signature, and the details check is part of that ceremony rather than a
     * fact about the person's day. Carrying an answer across from a DIFFERENT
     * agreement records a confirmation the patient never gave for THIS one.
     * It also opened the ceremony on "Step 2", with no step one, which is what
     * put Carl onto it.
     *
     * WHAT IS KEPT. The scope is now the AGREEMENT, so a resumed or re-pushed
     * session for an agreement whose details are already answered still skips —
     * the patient is resuming their own ceremony, not starting a new one.
     */
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
    /*
     * WAS `'confirmed_today'` UNTIL 27 SEPTEMBER 2026. A DIFFERENT agreement of
     * the same patient's, confirmed earlier today, no longer answers for this
     * one: this ceremony runs its own step one.
     */
    expect(payload.session?.detailsCheck).toBe('required');
    expect(payload.session?.patientId).toBe(patientId);
  });

  it('a_reload_mid_ceremony_does_not_ask_the_patient_the_same_questions_again', async () => {
    /*
     * THE HALF OF THE OLD RULE THAT SURVIVES, AND ITS BOUNDARY IS THE SESSION.
     *
     * THIS TEST ASSERTED THE AGREEMENT UNTIL 27 SEPTEMBER 2026, and it was
     * wrong within the hour. Scoped to the agreement, an EARLIER session's
     * answer suppressed K-P1 on every later push of the same agreement, so
     * Carl watched a fresh push open on "Step 2" with no step one:
     * *"Still jumps to step 2 sometimes."* A re-push is a new ceremony and
     * must run its own step one.
     *
     * WHAT IS LEFT IS THE CASE THE SKIP IS ACTUALLY FOR: the tablet reloads
     * mid-ceremony — dev rebuild, dropped wifi, a patient who idled out and
     * came back — and polls for the session it is already in. The answer is
     * this session's, given minutes ago by the person still standing there,
     * and asking again would be the device forgetting what it was just told.
     */
    await seedPatient('POST-CHECKSAME');
    const only = await postService(service({ pmsPatientRecordNumber: 'POST-CHECKSAME' })).expect(201);

    currentPrincipal = { ...RECEPTIONIST, practiceId };
    await request(app.getHttpServer())
      .post(`/agreements/${only.body.agreementId}/assignor`)
      .set('x-practice-id', practiceId)
      .send({ assignorIsPatient: true })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/devices/${deviceId}/push`)
      .set('x-practice-id', practiceId)
      .send({ agreementId: only.body.agreementId })
      .expect(201);

    // THE FRESH PUSH ASKS. Nothing has been answered in this session yet.
    const sessions = app.get(TabletSessionsService);
    const first = await sessions.currentFor(asResolvedDevice());
    expect(first.session?.detailsCheck).toBe('required');

    /*
     * THE PATIENT ANSWERS, ON THIS SESSION — written straight onto the row the
     * push created, because what the skip turns on is the FACT that they were
     * answered here, not how the ceremony drove it.
     */
    const sessionId = first.session?.id;
    expect(sessionId).toBeTruthy();
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.tabletSession.update({
        where: { id: sessionId },
        data: {
          detailsConfirmedTypes: ['name', 'date_of_birth', 'address'],
          detailsConfirmedAt: new Date(),
        },
      });
    });

    // THE RELOAD. Same session, same device, and it is not asked again.
    const afterReload = await sessions.currentFor(asResolvedDevice());
    expect(afterReload.session?.id).toBe(sessionId);
    expect(afterReload.session?.detailsCheck).toBe('confirmed_today');
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
