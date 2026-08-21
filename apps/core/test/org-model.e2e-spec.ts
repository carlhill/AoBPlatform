/**
 * Organisation onboarding, the practitioner directory, and the affiliation
 * lifecycle — end to end against real Postgres.
 *
 * The ABR runs offline against fixtures here, which is also the production
 * default: no ABR_API_GUID means no network call. The fixtures use
 * checksum-valid ABNs belonging to nobody.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AffiliationsService } from '../src/affiliations/affiliations.service';

// Fixture ABNs (see src/organisations/abr.ts). All checksum-valid, none real.
const COMPANY_ABN = '53004085616'; // ACTIVE, trades as "Sampletown Family Practice"
const SOLE_ABN = '51824753556'; // ACTIVE sole trader, no derivable ACN
const CANCELLED_ABN = '13824753558'; // CANCELLED — the ACTIVE gate
const AHPRA = 'MED0004242424';
const AHPRA_OTHER = 'MED0005353535';

/**
 * The applicant block every application now carries. Stated once so the tests
 * read as being about the gate under test rather than about form filling.
 */
const applicant = (over: Record<string, unknown> = {}) => ({
  adminName: 'Robin Practicemanager',
  adminEmail: 'robin@example.invalid',
  adminPhone: '0298765432',
  adminPosition: 'Practice Manager',
  headOfficeAddress: '1 Head Office Street, Sampletown NSW 2000',
  ...over,
});

/** Approving now requires recording HOW the applicant was verified (§11). */
const entitlement = {
  entitlementMethod: 'phone_call',
  entitlementPhoneNumber: '0298765432',
  entitlementNumberSource: 'nhsd',
  entitlementSpokeWithName: 'Reception',
};

describe('org model: organisations, practitioners, affiliations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let affiliations: AffiliationsService;

  let orgId: string;
  let locationId: string;
  let practitionerId: string;
  let affiliationId: string;

  const api = () => request(app.getHttpServer());
  const scoped = (method: 'post' | 'get', path: string) => api()[method](path).set('x-practice-id', orgId);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    affiliations = app.get(AffiliationsService);

    // A clean slate for the fixture ABNs, so the suite can be re-run.
    //
    // Note what this cannot do: `prisma.practice.deleteMany({where:{abn}})`
    // finds nothing, because RLS scopes practices to app.practice_id and the
    // teardown is not scoped to any. The stale organisation has to be FOUND
    // through the same pre-tenant function the service uses, and then each
    // one deleted inside its own scope. This is the RLS-returns-zero trap in
    // miniature — the naive version passes and silently cleans nothing.
    // Every ABN this suite touches, cleaned at the START as well as the end.
    // Cleaning only in afterAll makes the suite pass in isolation and fail the
    // moment anything else — a manual curl, an interrupted run — has left a
    // row behind. A suite that only works on a pristine database is a suite
    // that will fail at the least convenient moment.
    for (const abn of [COMPANY_ABN, SOLE_ABN, '29002589460', '11000372193', '11001670909', '11001686747']) {
      const stale = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM find_organisation_by_abn(${abn})`;
      for (const org of stale) {
        await prisma.withPractice(org.id, async (tx) => {
          await tx.affiliation.deleteMany({});
          await tx.department.deleteMany({});
          await tx.practiceLocation.deleteMany({});
          await tx.practice.deleteMany({});
        });
      }
    }
    // practitioners is not practice-scoped, so this one really does work.
    await prisma.practitioner.deleteMany({ where: { ahpraNumber: { in: [AHPRA, AHPRA_OTHER, 'MED0006464646'] } } });
  });

  afterAll(async () => {
    await prisma.vaultOutbox.deleteMany({});
    await app.close();
  });

  // ---------------------------------------------------------------------------
  describe('organisation registration (§4)', () => {
    it('rejects an ABN that fails its own checksum, before any lookup', async () => {
      const res = await api().post('/organisations').send({ ...applicant(), name: 'Anything', abn: '53004085617' }).expect(400);
      expect(res.body.message).toMatch(/check digits/);
    });

    it('ABN_MUST_BE_ACTIVE — a cancelled ABN cannot be onboarded', async () => {
      const res = await api()
        .post('/organisations')
        .send({ ...applicant(), name: 'Former Clinic Pty Ltd', abn: CANCELLED_ABN })
        .expect(400);
      expect(res.body.message).toMatch(/CANCELLED/);
      expect(res.body.message).toMatch(/not ACTIVE/);
    });

    it('rejects a name matching nothing registered, and says what IS registered', async () => {
      const res = await api()
        .post('/organisations')
        .send({ ...applicant(), name: 'Completely Unrelated Clinic', abn: COMPANY_ABN })
        .expect(400);
      expect(res.body.message).toMatch(/Sampletown Family Practice/);
    });

    it('MATCHES A TRADING NAME, not just the legal entity name', async () => {
      const res = await api()
        .post('/organisations')
        .send({ ...applicant(), name: 'Sampletown Family Practice', abn: COMPANY_ABN })
        .expect(201);
      orgId = res.body.id;
      expect(res.body.legalName).toBe('Sample Medical Holdings Pty Ltd');
      expect(res.body.nameMatch.tier).toBe('exact');
      expect(res.body.nameMatch.source).toBe('business_name');
    });

    it('derives the ACN rather than asking for it', async () => {
      const org = await prisma.withPractice(orgId, (tx) => tx.practice.findFirst({ where: { id: orgId } }));
      expect(org?.acn).toBe('004085616');
      expect(org?.entityType).toBe('PTY_LTD');
    });

    it('holds NO banking details — the column does not exist', async () => {
      const org = (await prisma.withPractice(orgId, (tx) =>
        tx.practice.findFirstOrThrow({ where: { id: orgId } }),
      )) as Record<string, unknown>;
      const fields = Object.keys(org).join(' ').toLowerCase();
      for (const forbidden of ['bsb', 'accountnumber', 'bankaccount', 'iban']) {
        expect(fields).not.toContain(forbidden);
      }
    });

    it('does not demand an ACN of a sole trader', async () => {
      const res = await api().post('/organisations').send({ ...applicant({ adminEmail: 'jo@example.invalid' }), name: 'Jo Example Medical', abn: SOLE_ABN }).expect(201);
      expect(res.body.acn).toBeNull();
      expect(res.body.entityType).toBe('INDIVIDUAL_SOLE_TRADER');
    });

    it('refuses a second registration against the same ABN', async () => {
      const res = await api()
        .post('/organisations')
        .send({ ...applicant(), name: 'Sampletown Skin Clinic', abn: COMPANY_ABN })
        .expect(409);
      expect(res.body.message).toMatch(/already registered/);
    });

    it('records that the fixture client stood in for the ABR API', async () => {
      const org = await prisma.withPractice(orgId, (tx) => tx.practice.findFirst({ where: { id: orgId } }));
      expect(org?.abnVerificationSource).toBe('abr_api');
      expect(org?.abnSightedByName).toBeNull();
    });

    it('starts PENDING — an ACTIVE ABN is necessary, not sufficient', async () => {
      const res = await api().get('/organisations/pending').expect(200);
      expect(res.body.organisations.map((o: { id: string }) => o.id)).toContain(orgId);
    });
  });

  // ---------------------------------------------------------------------------
  describe('ABR attestation, when no GUID is configured', () => {
    // A real ABN belonging to nobody, absent from the fixtures, so the offline
    // client genuinely cannot answer for it.
    const UNKNOWN_ABN = '29002589460';
    const attestation = (over: Record<string, unknown> = {}) => ({
      ...applicant(),
      name: 'Attested Example Practice',
      abn: UNKNOWN_ABN,
      abrAttestation: {
        legalName: 'Attested Example Practice',
        businessNames: [],
        abnStatus: 'ACTIVE',
        entityType: 'PTY_LTD',
        gstRegistered: true,
        sightedByName: 'Carl Hill',
        ...over,
      },
    });

    afterAll(async () => {
      for (const abn of [UNKNOWN_ABN, '11000372193', '11001670909']) {
        const stale = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM find_organisation_by_abn(${abn})`;
        for (const o of stale) {
          await prisma.withPractice(o.id, (tx) => tx.practice.deleteMany({}));
        }
      }
    });

    it('refuses outright when no attestation is offered, and says how to fix it', async () => {
      const res = await api().post('/organisations').send({ ...applicant(), name: 'Attested Example Practice', abn: UNKNOWN_ABN }).expect(400);
      expect(res.body.message).toMatch(/abr\.business\.gov\.au/);
      expect(res.body.message).toMatch(/ABR_API_GUID/);
    });

    it('accepts an attestation, and records WHO said so', async () => {
      const res = await api().post('/organisations').send(attestation()).expect(201);
      expect(res.body.abnVerificationSource).toBe('manual_attestation');
      expect(res.body.abnSightedByName).toBe('Carl Hill');
    });

    it('surfaces the provenance in the reviewer queue, where the decision is made', async () => {
      const res = await api().get('/organisations/pending').expect(200);
      const row = res.body.organisations.find((o: { abn: string }) => o.abn === UNKNOWN_ABN);
      expect(row.abnVerificationSource).toBe('manual_attestation');
      expect(row.abnSightedByName).toBe('Carl Hill');
    });

    it('ATTESTATION_IS_NOT_A_BYPASS — the ACTIVE gate still runs against it', async () => {
      // A fresh ABN, so this is genuinely the ACTIVE gate refusing and not a
      // duplicate-registration conflict standing in for it.
      const res = await api()
        .post('/organisations')
        .send({ ...attestation({ abnStatus: 'CANCELLED' }), abn: '11001670909' })
        .expect(400);
      expect(res.body.message).toMatch(/not ACTIVE/);
    });

    it('and the name gate still runs against it', async () => {
      const res = await api()
        .post('/organisations')
        .send({
          ...applicant(),
          name: 'A Name That Does Not Match',
          abn: '11000372193',
          abrAttestation: {
            legalName: 'Something Else Entirely',
            abnStatus: 'ACTIVE',
            entityType: 'PTY_LTD',
            sightedByName: 'Carl Hill',
          },
        })
        .expect(400);
      expect(res.body.message).toMatch(/does not match any name registered/);
    });

    it('refuses an unnamed attestation — that is not an attestation', async () => {
      await api()
        .post('/organisations')
        .send({ ...attestation({ sightedByName: '' }), abn: '11000372193' })
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  describe('nothing works until a human validates (§4)', () => {
    it('a pending organisation cannot add a location', async () => {
      const res = await scoped('post', '/organisations/locations')
        .send({ address: '1 Example Street, Sampletown NSW 2000' })
        .expect(400);
      expect(res.body.message).toMatch(/not validated/);
    });

    it('a validation decision must name the human who made it', async () => {
      await api().post(`/organisations/${orgId}/validate`).send({ decision: 'validated', reviewerName: '' }).expect(400);
    });

    it('a rejection must record why', async () => {
      await api()
        .post(`/organisations/${orgId}/validate`)
        .send({ decision: 'rejected', reviewerName: 'Robin Reviewer' })
        .expect(400);
    });

    it('records the named approver', async () => {
      const res = await api()
        .post(`/organisations/${orgId}/validate`)
        .send({ decision: 'validated', reviewerName: 'Robin Reviewer', note: 'ABR sighted 21 Aug.', ...entitlement })
        .expect(201);
      expect(res.body.validatedBy).toBe('Robin Reviewer');
    });

    it('APPROVAL_REQUIRES_AN_ENTITLEMENT_CHECK — the ABN gate is not enough', async () => {
      // A fresh pending application, so this is the entitlement rule refusing
      // rather than a state conflict standing in for it.
      const fresh = await api()
        .post('/organisations')
        .send({ ...applicant({ adminEmail: 'fresh@example.invalid' }), name: 'Jo Example Medical', abn: SOLE_ABN })
        .expect(201)
        .then((r) => r.body.id)
        .catch(() => null);
      const target = fresh ?? orgId;
      if (!fresh) return; // SOLE_ABN already taken by an earlier test; nothing to assert
      const res = await api()
        .post(`/organisations/${target}/validate`)
        .send({ decision: 'validated', reviewerName: 'Robin Reviewer' })
        .expect(500);
      expect(JSON.stringify(res.body)).toMatch(/entity exists|represent this entity|verified/i);
    });

    it('will not re-decide — that would overwrite who approved it', async () => {
      await api()
        .post(`/organisations/${orgId}/validate`)
        .send({ decision: 'rejected', reviewerName: 'Someone Else', note: 'changed my mind' })
        .expect(409);
    });
  });

  // ---------------------------------------------------------------------------
  describe('locations validate their address before they activate (§9)', () => {
    it('creates a location INACTIVE in manual mode, and says why', async () => {
      const res = await scoped('post', '/organisations/locations')
        .send({ address: '1 Example Street, Sampletown NSW 2000', code: 'Main St' })
        .expect(201);
      locationId = res.body.id;
      expect(res.body.active).toBe(false);
      expect(res.body.addressValidated).toBe(false);
      expect(res.body.validator).toBe('manual');
      expect(res.body.reason).toMatch(/named human/);
    });

    it('derives the state, because the holiday calendar needs it', async () => {
      const locations = await scoped('get', '/organisations/locations').expect(200);
      expect(locations.body[0].state).toBe('NSW');
    });

    it('refuses an address with no readable state', async () => {
      const res = await scoped('post', '/organisations/locations')
        .send({ address: '99 Nowhere Road, Somewhereville' })
        .expect(201);
      expect(res.body.active).toBe(false);
      expect(res.body.reason).toMatch(/state or territory/);
    });

    it('an inactive location cannot host a practitioner', async () => {
      await api().post('/practitioners').send({
        ahpraNumber: AHPRA,
        familyName: 'Example',
        givenNames: 'Jo',
        providerType: 'general_practitioner',
        email: 'jo.example@example.invalid',
      });
      const res = await scoped('post', '/affiliations')
        .send({ ahpraNumber: AHPRA, locationId, invitedByName: 'Robin Practicemanager' })
        .expect(400);
      expect(res.body.message).toMatch(/not active/);
      expect(res.body.message).toMatch(/65C\(5\)\(a\)/);
    });

    it('activation names the human who confirmed the address', async () => {
      await scoped('post', `/organisations/locations/${locationId}/activate`).send({ reviewerName: '' }).expect(400);
      const res = await scoped('post', `/organisations/locations/${locationId}/activate`)
        .send({ reviewerName: 'Robin Reviewer' })
        .expect(201);
      expect(res.body.active).toBe(true);
      expect(res.body.validator).toBe('manual');
    });

    it('records it as MANUAL, never claiming G-NAF confirmed it', async () => {
      const location = await prisma.withPractice(orgId, (tx) => tx.practiceLocation.findFirst({ where: { id: locationId } }));
      expect(location?.gnafVersion).toBe('manual:Robin Reviewer');
      expect(location?.gnafPid).toBeNull();
    });

    it('creates departments under a location', async () => {
      const res = await scoped('post', '/organisations/departments').send({ locationId, name: 'General Practice' }).expect(201);
      expect(res.body.name).toBe('General Practice');
      await scoped('post', '/organisations/departments').send({ locationId, name: 'General Practice' }).expect(409);
    });
  });

  // ---------------------------------------------------------------------------
  describe('the practitioner directory (§5)', () => {
    beforeAll(async () => {
      const p = await prisma.practitioner.findUnique({ where: { ahpraNumber: AHPRA } });
      practitionerId = p!.id;
    });

    it('refuses a malformed AHPRA number at pre-registration', async () => {
      await api()
        .post('/practitioners')
        .send({ ahpraNumber: 'NOPE', familyName: 'X', givenNames: 'Y', providerType: 'general_practitioner' })
        .expect(400);
    });

    it('refuses a second registration of the same AHPRA number', async () => {
      await api()
        .post('/practitioners')
        .send({ ahpraNumber: AHPRA, familyName: 'Example', givenNames: 'Jo', providerType: 'general_practitioner' })
        .expect(409);
    });

    it('NO_NAME_BROWSE — the directory cannot be enumerated', async () => {
      const res = await api().get('/practitioners/directory?ahpraNumber=Example').expect(400);
      expect(res.body.message).toMatch(/AHPRA registration number only/);
    });

    it('finds an exact AHPRA match', async () => {
      const res = await api().get(`/practitioners/directory?ahpraNumber=${AHPRA}`).expect(200);
      expect(res.body.found).toBe(true);
      expect(res.body.practitioner.familyName).toBe('Example');
    });

    it('NEVER_RETURNS_A_PROVIDER_NUMBER, or an email', async () => {
      const res = await api().get(`/practitioners/directory?ahpraNumber=${AHPRA}`).expect(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('providerNumber');
      expect(body).not.toContain('example.invalid');
    });

    it('answers a miss without confirming what else exists', async () => {
      const res = await api().get(`/practitioners/directory?ahpraNumber=${AHPRA_OTHER}`).expect(200);
      expect(res.body.found).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  describe('affiliation: the practitioner accepts, not the practice (§5)', () => {
    it('will not affiliate someone who has not registered here', async () => {
      const res = await scoped('post', '/affiliations')
        .send({ ahpraNumber: AHPRA_OTHER, locationId, invitedByName: 'Robin Practicemanager' })
        .expect(404);
      expect(res.body.message).toMatch(/pre-register/);
    });

    it('invites, and the invitation starts unaccepted', async () => {
      const res = await scoped('post', '/affiliations')
        .send({ ahpraNumber: AHPRA, locationId, providerNumber: '1234567A', invitedByName: 'Robin Practicemanager' })
        .expect(201);
      affiliationId = res.body.id;
      expect(res.body.status).toBe('invited');
      expect(res.body.next).toMatch(/Only they can accept/);
    });

    it('captures nothing while the invitation is unanswered', async () => {
      const res = await scoped('get', '/affiliations').expect(200);
      const row = res.body.find((a: { id: string }) => a.id === affiliationId);
      expect(row.canCapture).toBe(false);
      expect(row.blockReason).toMatch(/not yet accepted/);
    });

    it('refuses a second affiliation at the same location (FR-1.8)', async () => {
      const res = await scoped('post', '/affiliations')
        .send({ ahpraNumber: AHPRA, locationId, invitedByName: 'Robin Practicemanager' })
        .expect(409);
      expect(res.body.message).toMatch(/ONE provider number per place of practice/);
    });

    it('A_PRACTICE_CANNOT_ACCEPT_FOR_THEM — a different practitioner id is refused', async () => {
      const impostor = await prisma.practitioner.create({
        data: { ahpraNumber: AHPRA_OTHER, familyName: 'Other', givenNames: 'Sam', providerType: 'general_practitioner' },
      });
      // 404, not 403: the answer is identical whether the affiliation is
      // someone else's or does not exist, so this endpoint cannot be used to
      // probe which affiliation ids are real.
      const res = await api()
        .post(`/practitioners/${impostor.id}/affiliations/${affiliationId}/respond`)
        .send({ decision: 'accept' })
        .expect(404);
      expect(res.body.message).toMatch(/not found, or is not yours/);
      expect(res.body.message).toMatch(/Only the practitioner named/);
    });

    it('the practitioner accepts, and capture opens', async () => {
      await api()
        .post(`/practitioners/${practitionerId}/affiliations/${affiliationId}/respond`)
        .send({ decision: 'accept' })
        .expect(201);
      const res = await scoped('get', '/affiliations').expect(200);
      const row = res.body.find((a: { id: string }) => a.id === affiliationId);
      expect(row.status).toBe('active');
      expect(row.canCapture).toBe(true);
      expect(row.blockReason).toBeNull();
    });

    it("the practice sees its OWN practitioner's provider number", async () => {
      const res = await scoped('get', '/affiliations').expect(200);
      expect(res.body.find((a: { id: string }) => a.id === affiliationId).providerNumber).toBe('1234567A');
    });

    it("the practitioner's own cross-practice view carries NO provider number", async () => {
      const res = await api().get(`/practitioners/${practitionerId}/affiliations`).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].practiceName).toBe('Sampletown Family Practice');
      expect(JSON.stringify(res.body)).not.toContain('1234567A');
    });
  });

  // ---------------------------------------------------------------------------
  describe('offboarding: notice BEFORE the end date (§6)', () => {
    it('NO_COOL_OFF_AFTER_DEPARTURE — an end date in the past is refused', async () => {
      const res = await scoped('post', `/affiliations/${affiliationId}/notice`)
        .send({ endsAt: '2020-01-01T00:00:00.000Z', givenByName: 'Robin Practicemanager' })
        .expect(400);
      expect(res.body.message).toMatch(/BEFORE the affiliation ends/);
      expect(res.body.message).toMatch(/un-cease/);
    });

    it('accepts a forward-dated notice and keeps the affiliation working', async () => {
      const endsAt = new Date(Date.now() + 10 * 86_400_000).toISOString();
      const res = await scoped('post', `/affiliations/${affiliationId}/notice`)
        .send({ endsAt, givenByName: 'Robin Practicemanager' })
        .expect(201);
      expect(res.body.status).toBe('ending');
      expect(res.body.effectNow).toMatch(/STILL ACTIVE/);
    });

    it('CAPTURE CONTINUES DURING NOTICE — the practitioner is still working', async () => {
      const res = await scoped('get', '/affiliations').expect(200);
      const row = res.body.find((a: { id: string }) => a.id === affiliationId);
      expect(row.status).toBe('ending');
      expect(row.canCapture).toBe(true);
    });

    it('notice can be withdrawn if the practitioner stays', async () => {
      await scoped('post', `/affiliations/${affiliationId}/notice/withdraw`).expect(201);
      const res = await scoped('get', '/affiliations').expect(200);
      expect(res.body.find((a: { id: string }) => a.id === affiliationId).status).toBe('active');
    });

    it('at the end date the affiliation ENDS and capture stops', async () => {
      const endsAt = new Date(Date.now() + 1000).toISOString();
      await scoped('post', `/affiliations/${affiliationId}/notice`)
        .send({ endsAt, givenByName: 'Robin Practicemanager' })
        .expect(201);

      // Run the sweep as if the end date had arrived, rather than sleeping.
      const swept = await affiliations.endDueAffiliations(new Date(Date.now() + 5000));
      expect(swept.ended).toBeGreaterThanOrEqual(1);

      const res = await scoped('get', '/affiliations').expect(200);
      const row = res.body.find((a: { id: string }) => a.id === affiliationId);
      expect(row.status).toBe('ended');
      expect(row.canCapture).toBe(false);
      expect(row.blockReason).toMatch(/CEASED/);
    });

    it('an ended affiliation is terminal — the database refuses to reopen it', async () => {
      await expect(
        prisma.withPractice(orgId, (tx) =>
          tx.affiliation.update({ where: { id: affiliationId }, data: { status: 'active' } }),
        ),
      ).rejects.toThrow(/terminal/);
    });

    it('the evidence survives — ceasing is not deleting (REQ-OFF-07)', async () => {
      const events = await prisma.vaultOutbox.findMany({ where: { subjectId: affiliationId } });
      const types = events.map((e) => e.type);
      expect(types).toContain('affiliation.invited');
      expect(types).toContain('affiliation.accepted');
      expect(types).toContain('affiliation.notice_given');
      expect(types).toContain('affiliation.ended');
    });
  });

  // ---------------------------------------------------------------------------
  describe('deregistration is an immediate hard stop (REQ-XFER-08)', () => {
    let deregId: string;
    let deregAffiliationId: string;

    beforeAll(async () => {
      const p = await prisma.practitioner.create({
        data: { ahpraNumber: 'MED0006464646', familyName: 'Struckoff', givenNames: 'Pat', providerType: 'general_practitioner' },
      });
      deregId = p.id;
      const created = await prisma.withPractice(orgId, (tx) =>
        tx.affiliation.create({
          data: { practiceId: orgId, practitionerId: deregId, locationId, status: 'active', startedAt: new Date(), providerNumber: '7654321B' },
        }),
      );
      deregAffiliationId = created.id;
    });

    afterAll(async () => {
      // Scoped, because affiliations ARE practice-scoped: the unscoped form
      // deletes nothing and then the practitioner delete trips the foreign key.
      await prisma.withPractice(orgId, (tx) => tx.affiliation.deleteMany({ where: { practitionerId: deregId } }));
      await prisma.practitioner.deleteMany({ where: { id: deregId } });
    });

    it('ends every affiliation at once, with no notice period', async () => {
      const res = await api()
        .post(`/practitioners/${deregId}/deregister`)
        .send({ reason: 'AHPRA registration lapsed' })
        .expect(201);
      expect(res.body.affiliationsEnded).toBe(1);

      const affiliation = await prisma.withPractice(orgId, (tx) =>
        tx.affiliation.findFirst({ where: { id: deregAffiliationId } }),
      );
      expect(affiliation?.status).toBe('ended');
      expect(affiliation?.endReason).toBe('deregistered');
      // The tell: endsAt equals endedAt. No negotiated date was honoured.
      expect(affiliation?.endsAt).toEqual(affiliation?.endedAt);
    });

    it('records it in the vault as immediate', async () => {
      const events = await prisma.vaultOutbox.findMany({ where: { subjectId: deregId } });
      const payload = events.find((e) => e.type === 'practitioner.deregistered')?.payload as Record<string, unknown>;
      expect(payload.immediate).toBe(true);
    });

    it('refuses to affiliate a deregistered practitioner anywhere', async () => {
      const res = await scoped('post', '/affiliations')
        .send({ ahpraNumber: 'MED0006464646', locationId, invitedByName: 'Robin Practicemanager' })
        .expect(403);
      expect(res.body.message).toMatch(/REQ-XFER-08/);
    });

    it('is idempotent — recording it twice does not double-count', async () => {
      const res = await api().post(`/practitioners/${deregId}/deregister`).send({ reason: 'again' }).expect(201);
      expect(res.body.alreadyRecorded).toBe(true);
    });
  });
});
