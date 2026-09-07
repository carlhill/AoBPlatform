import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SandboxGateway } from '../src/messaging/gateway';

describe('M5 enduring lifecycle + M6 reg 89AA notices (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let gateway: SandboxGateway;
  const practiceId = randomUUID();
  let gpId: string;
  let specialistId: string;
  let patientId: string;
  let childId: string;
  let assignorId: string;

  const createAgreement = async (
    body: Record<string, unknown>,
  ): Promise<{ status: number; id?: string; message?: string }> => {
    const res = await request(app.getHttpServer()).post('/agreements').set('x-practice-id', practiceId).send(body);
    return { status: res.status, id: res.body.id, message: JSON.stringify(res.body) };
  };

  /**
   * Creates an enduring agreement on a given pathway, with detail.
   * The ACCHO/AMS pathway anchors to the ORGANISATION via its authorised
   * agent, not to an individual practitioner (Addendum v3 §1.1) — so the
   * anchor differs by pathway, and the platform enforces that.
   */
  async function makeEnduring(pathway: string, notificationMethod = 'email'): Promise<string> {
    const anchor =
      pathway === 'accho_ams' ? { organisationId: randomUUID() } : { providerId: gpId };
    const draft = await createAgreement({
      type: 'enduring',
      enduringPathway: pathway,
      ...anchor,
      patientId,
      assignorId,
      assignorIsPatient: true,
    });
    await request(app.getHttpServer())
      .post('/enduring')
      .set('x-practice-id', practiceId)
      .send({
        agreementId: draft.id,
        notificationMethod,
        terminationMethod: 'in_writing',
        scopeType: 'group',
        scopeValues: ['A1', 'A2'],
      })
      .expect(201);
    return draft.id!;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    gateway = app.get(SandboxGateway);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'Enduring Test Practice' } });
      gpId = (
        await tx.provider.create({
          data: { practiceId, name: 'Dr GP Test', providerType: 'general_practitioner' },
        })
      ).id;
      specialistId = (
        await tx.provider.create({ data: { practiceId, name: 'Dr Specialist Test', providerType: 'specialist' } })
      ).id;
      patientId = (
        await tx.patient.create({
          data: {
            practiceId,
            familyName: 'Testpatient',
            givenNames: 'Alex',
            dateOfBirth: new Date('1957-03-14'),
            email: 'alex.testpatient@example.invalid',
            mobile: '+61400000000',
          },
        })
      ).id;
      childId = (
        await tx.patient.create({
          data: {
            practiceId,
            familyName: 'Youngpatient',
            givenNames: 'Sam',
            // Turns 14 in ~10 days — inside the 30-day lead window.
            dateOfBirth: new Date(Date.now() - (14 * 365.25 - 10) * 86_400_000),
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
      await tx.notice.deleteMany({});
      await tx.enduringDetail.deleteMany({});
      await tx.agreement.deleteMany({});
      await tx.assignor.deleteMany({});
      await tx.patient.deleteMany({});
      await tx.provider.deleteMany({});
      await tx.practice.deleteMany({});
    });
    await prisma.vaultOutbox.deleteMany({});
    await app.close();
  });

  describe('M5 — enduring lifecycle', () => {
    it('enduring_is_gp_only — a specialist cannot hold one (REQ-END-01a)', async () => {
      const res = await createAgreement({
        type: 'enduring',
        enduringPathway: 'mymedicare',
        providerId: specialistId,
        patientId,
        assignorId,
        assignorIsPatient: true,
      });
      expect(res.status).toBe(400);
      expect(res.message).toContain('REQ-END-01a');
    });

    it('scope_preview_shows_the_commitment before signature (REQ-END-06a)', async () => {
      const agreementId = await makeEnduring('mymedicare');
      const res = await request(app.getHttpServer())
        .get(`/enduring/${agreementId}/scope-preview`)
        .set('x-practice-id', practiceId)
        .expect(200);
      expect(res.body.itemCount).toBe(2);
      expect(res.body.commitment).toContain('must bulk bill');
      expect(res.body.commitment).toContain('terminating this agreement');
    });

    it('termination_is_two_business_days and records which calendar produced it (REQ-END-06/REQ-OFF-03)', async () => {
      const agreementId = await makeEnduring('mymedicare');
      const res = await request(app.getHttpServer())
        .post(`/enduring/${agreementId}/terminate`)
        .set('x-practice-id', practiceId)
        // The patient may terminate even though they are not always the signer.
        .send({ initiatedBy: 'patient' })
        .expect(201);
      const notice = new Date(res.body.terminationNoticeAt);
      const effective = new Date(res.body.terminationEffectiveAt);
      expect(effective.getTime()).toBeGreaterThan(notice.getTime());
      // Never a weekend.
      expect([0, 6]).not.toContain(effective.getUTCDay());
      // Provenance recorded in the evidence: state, dataset version, and the
      // fact that the dataset is not yet human-verified.
      expect(res.body.terminationCalendarState).toContain('NSW');
      expect(res.body.terminationCalendarState).toContain('holidays-');
      expect(res.body.terminationCalendarState).toContain('UNVERIFIED');
    });

    it('hospital_admission_is_not_a_cessation_trigger (65CA(9))', async () => {
      const agreementId = await makeEnduring('residential_aged_care');
      await request(app.getHttpServer())
        .post(`/enduring/${agreementId}/cease`)
        .set('x-practice-id', practiceId)
        .send({ trigger: 'hospital_admission' })
        .expect(400); // not in the enum at all
    });

    it('cessation_triggers_respect_pathway — MyMedicare deregistration cannot cease an aged-care agreement', async () => {
      const agedCare = await makeEnduring('residential_aged_care');
      const res = await request(app.getHttpServer())
        .post(`/enduring/${agedCare}/cease`)
        .set('x-practice-id', practiceId)
        .send({ trigger: 'mymedicare_deregistered' })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('does not apply');
    });

    it('coverage_query_excludes_ceased_agreements (FR-5.5)', async () => {
      const agreementId = await makeEnduring('mymedicare');
      const before = await request(app.getHttpServer())
        .get('/enduring/coverage')
        .query({ patientId, providerId: gpId })
        .set('x-practice-id', practiceId)
        .expect(200);
      expect(before.body.covered).toBe(true);

      await request(app.getHttpServer())
        .post(`/enduring/${agreementId}/cease`)
        .set('x-practice-id', practiceId)
        .send({ trigger: 'mymedicare_deregistered' })
        .expect(201);

      const after = await request(app.getHttpServer())
        .get('/enduring/coverage')
        .query({ patientId, providerId: gpId })
        .set('x-practice-id', practiceId)
        .expect(200);
      expect(after.body.agreementIds).not.toContain(agreementId);
    });

    it('anniversary_fuse_pipeline surfaces unregistered agreements (65CA(8)(e), D-11)', async () => {
      const res = await request(app.getHttpServer())
        .get('/enduring/anniversary-pipeline')
        .set('x-practice-id', practiceId)
        .expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0].hasFuse).toBe(true);
      expect(res.body[0].registered).toBe(false);
      expect(res.body[0].registrationMechanism).toContain('D-11');
    });

    it('fourteenth_birthday_surfaces_before_the_birthday (REQ-OFF-13)', async () => {
      const draft = await createAgreement({
        type: 'enduring',
        enduringPathway: 'mymedicare',
        providerId: gpId,
        patientId: childId,
        assignorId,
        assignorIsPatient: false, // covered by someone else's agreement — this is what ceases
      });
      await request(app.getHttpServer())
        .post('/enduring')
        .set('x-practice-id', practiceId)
        .send({
          agreementId: draft.id,
          notificationMethod: 'email',
          terminationMethod: 'in_writing',
          scopeType: 'group',
          scopeValues: ['A1'],
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/enduring/fourteenth-birthday-due')
        .set('x-practice-id', practiceId)
        .expect(200);
      expect(res.body.map((r: { agreementId: string }) => r.agreementId)).toContain(draft.id);
    });
  });

  describe('M6 — reg 89AA notices', () => {
    it('notices_are_mymedicare_only — aged care and ACCHO are suppressed (REQ-END-05)', async () => {
      for (const pathway of ['residential_aged_care', 'accho_ams']) {
        const agreementId = await makeEnduring(pathway);
        const res = await request(app.getHttpServer())
          .post('/notices/claims')
          .set('x-practice-id', practiceId)
          .send({
            agreementId,
            claimReference: `claim-${pathway}`,
            serviceDate: '2026-08-21',
            benefitAmountCents: 6570,
          })
          .expect(201);
        expect(res.body.noticeRequired).toBe(false);
        expect(res.body.noticeId).toBeUndefined();
      }
    });

    it('episodic claims carry no notice obligation at all', async () => {
      const episodic = await createAgreement({
        type: 'episodic_post',
        providerId: gpId,
        patientId,
        assignorId,
        assignorIsPatient: true,
      });
      const res = await request(app.getHttpServer())
        .post('/notices/claims')
        .set('x-practice-id', practiceId)
        .send({ agreementId: episodic.id, claimReference: 'claim-ep', serviceDate: '2026-08-21', benefitAmountCents: 6570 })
        .expect(201);
      expect(res.body.noticeRequired).toBe(false);
    });

    it('composes with the four mandatory elements incl. the benefit amount — the one place it appears', async () => {
      const agreementId = await makeEnduring('mymedicare');
      const res = await request(app.getHttpServer())
        .post('/notices/claims')
        .set('x-practice-id', practiceId)
        .send({ agreementId, claimReference: 'claim-1', serviceDate: '2026-08-21', benefitAmountCents: 6570 })
        .expect(201);
      expect(res.body.noticeRequired).toBe(true);

      const notice = await prisma.withPractice(practiceId, (tx) =>
        tx.notice.findFirst({ where: { id: res.body.noticeId } }),
      );
      expect(notice?.practitionerName).toBe('Dr GP Test');
      expect(notice?.patientName).toBe('Alex Testpatient');
      expect(notice?.benefitAmountCents).toBe(6570);
      expect(notice?.agreementMethod).toBe('email');
    });

    it('five_delivery_states_each_evidenced, and read never counts toward compliance (REQ-DEL-01/-07)', async () => {
      const agreementId = await makeEnduring('mymedicare');
      const claim = await request(app.getHttpServer())
        .post('/notices/claims')
        .set('x-practice-id', practiceId)
        .send({ agreementId, claimReference: 'claim-2', serviceDate: '2026-08-21', benefitAmountCents: 4200 })
        .expect(201);
      const noticeId = claim.body.noticeId;

      await request(app.getHttpServer()).post(`/notices/${noticeId}/dispatch`).set('x-practice-id', practiceId).expect(201);
      await request(app.getHttpServer()).post(`/notices/${noticeId}/delivered`).set('x-practice-id', practiceId).expect(201);
      await request(app.getHttpServer()).post(`/notices/${noticeId}/read`).set('x-practice-id', practiceId).expect(201);

      const events = await prisma.withPractice(practiceId, (tx) =>
        tx.noticeDeliveryEvent.findMany({ where: { noticeId }, orderBy: { occurredAt: 'asc' } }),
      );
      expect(events.map((e) => e.state)).toEqual(['composed', 'dispatched', 'delivered', 'read']);

      // The notice keeps its statutory shape AND writes the evidence row that
      // lets one screen show it beside everything else (plan §4.1, Q5).
      const correspondence = await prisma.withPractice(practiceId, (tx) =>
        tx.correspondence.findFirst({ where: { noticeId } }),
      );
      expect(correspondence?.subjectType).toBe('Notice');
      expect(correspondence?.recipientType).toBe('patient');
      expect(correspondence?.state).toBe('delivered');
      expect(correspondence?.retentionExpiryDate).not.toBeNull();

      const pack = await request(app.getHttpServer())
        .get('/notices/compliance-pack')
        .set('x-practice-id', practiceId)
        .expect(200);
      const entry = pack.body.entries.find((e: { noticeId: string }) => e.noticeId === noticeId);
      expect(entry.dispatchedWithinWindow).toBe(true);
      // Read is present as colour but the rate is built from dispatch only.
      expect(entry.readAtEvidentialOnly).toBeTruthy();
      expect(JSON.stringify(pack.body)).not.toMatch(/readRate|openRate/);
    });

    it('method_fidelity_held — dispatch uses the method the agreement names (REQ-DEL-02)', async () => {
      const agreementId = await makeEnduring('mymedicare', 'sms');
      const claim = await request(app.getHttpServer())
        .post('/notices/claims')
        .set('x-practice-id', practiceId)
        .send({ agreementId, claimReference: 'claim-3', serviceDate: '2026-08-21', benefitAmountCents: 1000 })
        .expect(201);
      const dispatched = await request(app.getHttpServer())
        .post(`/notices/${claim.body.noticeId}/dispatch`)
        .set('x-practice-id', practiceId)
        .expect(201);
      expect(dispatched.body.dispatchChannel).toBe('sms');
      expect(dispatched.body.agreementMethod).toBe('sms');
    });

    it('notice_copy_carries_no_approval_semantics (FR-6.3) and states it cannot be opted out of', async () => {
      const sent = gateway.outbox();
      expect(sent.length).toBeGreaterThan(0);
      const body = sent[sent.length - 1].body.toLowerCase();
      for (const forbidden of ['approve', 'confirm', 'accept', 'respond', 'click here', 'unsubscribe']) {
        expect(body).not.toContain(forbidden);
      }
      expect(body).toContain('you do not need to do anything');
      expect(body).toContain('required by law');
    });

    it('dispatched_notice_is_immutable_at_db_layer; corrections supersede (REQ-DEL-06)', async () => {
      const agreementId = await makeEnduring('mymedicare');
      const claim = await request(app.getHttpServer())
        .post('/notices/claims')
        .set('x-practice-id', practiceId)
        .send({ agreementId, claimReference: 'claim-4', serviceDate: '2026-08-21', benefitAmountCents: 9999 })
        .expect(201);
      const noticeId = claim.body.noticeId;
      await request(app.getHttpServer()).post(`/notices/${noticeId}/dispatch`).set('x-practice-id', practiceId).expect(201);

      // The trigger refuses an edit to what was sent.
      await expect(
        prisma.withPractice(practiceId, (tx) =>
          tx.notice.update({ where: { id: noticeId }, data: { benefitAmountCents: 1 } }),
        ),
      ).rejects.toThrow(/REQ-DEL-06/);

      // The sanctioned path: a linked, superseding correction with its own window.
      const correction = await request(app.getHttpServer())
        .post(`/notices/${noticeId}/correct`)
        .set('x-practice-id', practiceId)
        .send({ reason: 'benefit amount was misstated', benefitAmountCents: 6570 })
        .expect(201);
      expect(correction.body.supersedesNoticeId).toBe(noticeId);
      expect(correction.body.benefitAmountCents).toBe(6570);
      expect(correction.body.dispatchedAt).toBeNull();
    });

    it('failed dispatch is evidenced and retried, never silently dropped (REQ-DEL-04)', async () => {
      const agreementId = await makeEnduring('mymedicare');
      const claim = await request(app.getHttpServer())
        .post('/notices/claims')
        .set('x-practice-id', practiceId)
        .send({ agreementId, claimReference: 'claim-5', serviceDate: '2026-08-21', benefitAmountCents: 2500 })
        .expect(201);

      gateway.failNext = true;
      const failed = await request(app.getHttpServer())
        .post(`/notices/${claim.body.noticeId}/dispatch`)
        .set('x-practice-id', practiceId)
        .expect(201);
      expect(failed.body.failedAt).toBeTruthy();
      expect(failed.body.dispatchedAt).toBeNull();

      const retried = await request(app.getHttpServer())
        .post(`/notices/${claim.body.noticeId}/dispatch`)
        .set('x-practice-id', practiceId)
        .expect(201);
      expect(retried.body.dispatchedAt).toBeTruthy();
      expect(retried.body.failedAt).toBeNull();
      expect(retried.body.attempts).toBe(2);
    });

    it('refuses to notify on a CEASED agreement — the silent failure mode, made loud', async () => {
      const agreementId = await makeEnduring('mymedicare');
      await request(app.getHttpServer())
        .post(`/enduring/${agreementId}/cease`)
        .set('x-practice-id', practiceId)
        .send({ trigger: 'mymedicare_deregistered' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/notices/claims')
        .set('x-practice-id', practiceId)
        .send({ agreementId, claimReference: 'claim-6', serviceDate: '2026-08-21', benefitAmountCents: 6570 })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('never validly assigned');
    });

    it('compliance pack reports dispatch-within-window and lists breaches (REQ-DEL-08/-09)', async () => {
      const res = await request(app.getHttpServer())
        .get('/notices/compliance-pack')
        .set('x-practice-id', practiceId)
        .expect(200);
      expect(res.body.noticeCount).toBeGreaterThan(0);
      expect(res.body.dispatchedWithinWindowRate).toBeGreaterThan(0);
      expect(Array.isArray(res.body.breaches)).toBe(true);
      for (const entry of res.body.entries) {
        expect(entry.methodFidelityHeld).toBe(true);
        expect(entry.deliveryEvidence.length).toBeGreaterThan(0);
      }
    });
  });
});
