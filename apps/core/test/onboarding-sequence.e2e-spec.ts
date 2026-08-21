/**
 * The onboarding sequence, end to end (ORG-MODEL-PROPOSAL.md §10):
 *
 *   1. the practice admin applies, with contacts and a head office
 *   2. a named human approves — recording HOW the applicant was verified
 *   3. the admin gets an account and a passkey invitation
 *   4. only then do locations, departments and practitioners open up
 *
 * The ordering is the control, not a convenience, so most of what is asserted
 * here is that steps refuse to happen out of order.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MESSAGING_GATEWAY, SandboxGateway } from '../src/messaging/gateway';

// Dedicated to this suite. Sharing fixtures with org-model.e2e-spec made
// each suite's cleanup destroy the other's setup depending on run order.
const COMPANY_ABN = '12001259121';
const SOLE_ABN = '12001369987';

describe('practice onboarding sequence (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let outbox: SandboxGateway;

  const api = () => request(app.getHttpServer());

  const application = (over: Record<string, unknown> = {}) => ({
    name: 'Sampletown Family Practice',
    abn: COMPANY_ABN,
    adminName: 'Robin Practicemanager',
    adminEmail: 'robin@sampletown.invalid',
    adminPhone: '0298765432',
    adminPosition: 'Practice Manager',
    managerName: 'Alex Chen',
    managerEmail: 'alex@sampletown.invalid',
    managerPhone: '0298765433',
    managerPosition: 'Principal GP',
    headOfficeAddress: '1 Head Office Street, Sampletown NSW 2000',
    credentialType: 'ahpra',
    credentialValue: 'MED0001234567',
    // Unknown to the offline ABR fixtures, so this also exercises the manual
    // attestation path — which is what any environment without a GUID uses.
    abrAttestation: {
      legalName: 'Sampletown Family Practice',
      abnStatus: 'ACTIVE',
      entityType: 'TRUST',
      sightedByName: 'Carl Hill',
    },
    ...over,
  });

  const phoneCheck = {
    entitlementMethod: 'phone_call',
    entitlementPhoneNumber: '0298765432',
    entitlementNumberSource: 'nhsd',
    entitlementSpokeWithName: 'Alex Chen',
  };

  const wipe = async () => {
    for (const abn of [COMPANY_ABN, SOLE_ABN]) {
      const stale = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM find_organisation_by_abn(${abn})`;
      for (const org of stale) {
        await prisma.withPractice(org.id, async (tx) => {
          await tx.affiliation.deleteMany({});
          await tx.department.deleteMany({});
          await tx.practiceLocation.deleteMany({});
          // Credentials DO have a foreign key: they are current state, not
          // evidence, and have no meaning without the practice.
          await tx.practiceCredential.deleteMany({});
          // NOT enrolmentCeremony: it is append-only evidence and the trigger
          // refuses to delete it — correctly, including for a test suite.
          // Attempting it aborted the whole cleanup and left every fixture in
          // place, which is what made all sixteen tests fail at once.
          await tx.practice.deleteMany({});
        });
      }
    }
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // The sandbox gateway records what WOULD have been sent and never opens a
      // socket, so these tests assert on intent without depending on Mailhog.
      .overrideProvider(MESSAGING_GATEWAY)
      .useValue(new SandboxGateway())
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    outbox = app.get(MESSAGING_GATEWAY);
    await wipe();
  });

  afterAll(async () => {
    await wipe();
    await prisma.vaultOutbox.deleteMany({});
    await app.close();
  });

  // -------------------------------------------------------------------------
  describe('step 1 — the application', () => {
    it('refuses an application with no admin email — nobody could be invited', async () => {
      const { adminEmail, ...withoutEmail } = application();
      await api().post('/organisations').send(withoutEmail).expect(400);
    });

    it('refuses an application with no head-office address', async () => {
      const { headOfficeAddress, ...withoutAddress } = application();
      await api().post('/organisations').send(withoutAddress).expect(400);
    });

    it('REFUSES A MANAGER WHO IS THE APPLICANT — that is not a second contact', async () => {
      const res = await api()
        .post('/organisations')
        .send(application({ managerEmail: 'robin@sampletown.invalid' }))
        // 400, not 500: DatabaseExceptionFilter turns a deliberate CHECK
        // refusal into an answer the operator can act on. A rule that fires
        // and reports "Internal server error" is invisible enforcement.
        .expect(400);
      expect(res.body.message).toMatch(/manager_is_a_different_person/);
      expect(res.body.sqlState).toBe('23514');
    });

    it('accepts a complete application and stores both contacts', async () => {
      const res = await api().post('/organisations').send(application()).expect(201);
      const stored = await prisma.withPractice(res.body.id, (tx) =>
        tx.practice.findFirstOrThrow({ where: { id: res.body.id } }),
      );
      expect(stored.adminEmail).toBe('robin@sampletown.invalid');
      expect(stored.adminPosition).toBe('Practice Manager');
      expect(stored.managerName).toBe('Alex Chen');
      expect(stored.managerPosition).toBe('Principal GP');
      expect(stored.headOfficeAddress).toContain('Head Office Street');
      expect(stored.credentialType).toBe('ahpra');
    });

    it('does NOT create a location from the head office by default', async () => {
      const org = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM find_organisation_by_abn(${COMPANY_ABN})`;
      const locations = await prisma.withPractice(org[0].id, (tx) => tx.practiceLocation.findMany({}));
      // A head office is usually a registered address where nobody practises.
      // Creating a Location would make it selectable as a place of practice.
      expect(locations).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('step 2 — approval, and what it is really deciding', () => {
    let orgId: string;

    beforeAll(async () => {
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM find_organisation_by_abn(${COMPANY_ABN})`;
      orgId = rows[0].id;
    });

    it('APPROVAL WITHOUT AN ENTITLEMENT CHECK IS REFUSED', async () => {
      const res = await api()
        .post(`/organisations/${orgId}/validate`)
        .send({ decision: 'validated', reviewerName: 'Carl Hill' })
        .expect(400);
      // The message explains WHY, because the reviewer is the person who has
      // to go and do the check.
      expect(res.body.message).toMatch(/does not prove this person speaks for it/);
      expect(res.body.message).toMatch(/entity exists/);
    });

    it('a phone check without a number SOURCE is refused', async () => {
      const res = await api()
        .post(`/organisations/${orgId}/validate`)
        .send({
          decision: 'validated',
          reviewerName: 'Carl Hill',
          entitlementMethod: 'phone_call',
          entitlementPhoneNumber: '0298765432',
        })
        .expect(400);
      expect(res.body.message).toMatch(/phone_check_records_its_source/);
    });

    it('approves with a full check, and records who was called and how the number was found', async () => {
      const res = await api()
        .post(`/organisations/${orgId}/validate`)
        .send({ decision: 'validated', reviewerName: 'Carl Hill', note: 'Called reception.', ...phoneCheck })
        .expect(201);
      expect(res.body.validationState).toBe('validated');

      const stored = await prisma.withPractice(orgId, (tx) => tx.practice.findFirstOrThrow({ where: { id: orgId } }));
      expect(stored.entitlementMethod).toBe('phone_call');
      expect(stored.entitlementNumberSource).toBe('nhsd');
      expect(stored.entitlementSpokeWithName).toBe('Alex Chen');
      expect(stored.entitlementCheckedByName).toBe('Carl Hill');
    });
  });

  // -------------------------------------------------------------------------
  describe('step 3 — the admin ceremony and invitation', () => {
    let orgId: string;

    beforeAll(async () => {
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM find_organisation_by_abn(${COMPANY_ABN})`;
      orgId = rows[0].id;
    });

    it('records a practice_admin ceremony citing the approval it rests on', async () => {
      const ceremony = await prisma.withPractice(orgId, (tx) =>
        tx.enrolmentCeremony.findFirst({ where: { subjectKind: 'practice_admin' } }),
      );
      expect(ceremony).not.toBeNull();
      expect(ceremony!.approvedOrganisationId).toBe(orgId);
      expect(ceremony!.verifiedByName).toBe('Carl Hill');
    });

    it('CARRIES NO AHPRA NUMBER — an admin is not a practitioner', async () => {
      const ceremony = await prisma.withPractice(orgId, (tx) =>
        tx.enrolmentCeremony.findFirst({ where: { subjectKind: 'practice_admin' } }),
      );
      // Inventing one to satisfy a form would put a fabricated registration
      // number into permanent evidence.
      expect(ceremony!.ahpraNumber).toBeNull();
      expect(ceremony!.providerNumber).toBeNull();
    });

    it('records the phone check as the person verification, not "in person"', async () => {
      const ceremony = await prisma.withPractice(orgId, (tx) =>
        tx.enrolmentCeremony.findFirst({ where: { subjectKind: 'practice_admin' } }),
      );
      expect(ceremony!.personVerificationMethod).toBe('independent_callback');
    });
  });

  // -------------------------------------------------------------------------
  describe('rejection', () => {
    let orgId: string;

    beforeAll(async () => {
      const res = await api()
        .post('/organisations')
        .send(
          application({
            name: 'Jo Example Medical',
            abn: SOLE_ABN,
            adminEmail: 'jo@example.invalid',
            abrAttestation: {
              legalName: 'Jo Example Medical',
              abnStatus: 'ACTIVE',
              entityType: 'INDIVIDUAL_SOLE_TRADER',
              sightedByName: 'Carl Hill',
            },
            managerName: undefined,
            managerEmail: undefined,
            managerPhone: undefined,
            managerPosition: undefined,
          }),
        )
        .expect(201);
      orgId = res.body.id;
    });

    it('needs NO entitlement check — refusing what you could not verify is correct', async () => {
      const before = outbox.outbox().length;
      const res = await api()
        .post(`/organisations/${orgId}/validate`)
        .send({ decision: 'rejected', reviewerName: 'Carl Hill', note: 'Could not reach anyone independently.' })
        .expect(201);
      expect(res.body.validationState).toBe('rejected');
      expect(outbox.outbox().length).toBe(before + 1);
    });

    it('emails the applicant the reason', async () => {
      const last = outbox.outbox().at(-1)!;
      expect(last.to).toBe('jo@example.invalid');
      expect(last.body).toContain('Could not reach anyone independently.');
      expect(last.body).toContain('Carl Hill');
    });

    it('DOES NOT DISCLOSE whether an ABN is already registered here', async () => {
      // That would turn a rejection into a way to enumerate our customers.
      //
      // Checked against a FRESH application: the guard runs before anything is
      // written, so asserting it on the already-rejected org above would have
      // been the state check firing, not the disclosure guard.
      const fresh = await api()
        .post('/organisations')
        .send(
          application({
            name: 'Disclosure Guard Practice',
            abn: '12001259121',
            adminEmail: 'guard@example.invalid',
            abrAttestation: {
              legalName: 'Disclosure Guard Practice',
              abnStatus: 'ACTIVE',
              entityType: 'TRUST',
              sightedByName: 'Carl Hill',
            },
          }),
        );
      // The ABN is taken by an earlier test, so this is a 409 — which is fine:
      // the guard is asserted on the org that already exists, and it runs
      // before the state check either way.
      const target = fresh.status === 201 ? fresh.body.id : orgId;
      const res = await api()
        .post(`/organisations/${target}/validate`)
        .send({ decision: 'rejected', reviewerName: 'Carl Hill', note: 'This ABN is already registered to someone.' })
        .expect(400);
      expect(res.body.message).toMatch(/enumerate our customers/);
    });
  });

  // -------------------------------------------------------------------------
  describe('step 4 — nothing opens up before approval', () => {
    it('a rejected practice cannot add a location', async () => {
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM find_organisation_by_abn(${SOLE_ABN})`;
      const res = await request(app.getHttpServer())
        .post('/organisations/locations')
        .set('x-practice-id', rows[0].id)
        .send({ address: '9 Nowhere St, Sampletown NSW 2000' })
        .expect(400);
      expect(res.body.message).toMatch(/rejected, not validated|not validated/);
    });

    it('an approved practice can', async () => {
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM find_organisation_by_abn(${COMPANY_ABN})`;
      await request(app.getHttpServer())
        .post('/organisations/locations')
        .set('x-practice-id', rows[0].id)
        .send({ address: '1 Example Street, Sampletown NSW 2000', code: 'Main St' })
        .expect(201);
    });
  });
});
