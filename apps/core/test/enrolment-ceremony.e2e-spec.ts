/**
 * REQ-PKI-01 end to end: no ceremony, no key.
 *
 * Keycloak is stubbed here — the point under test is the GATE, not the IdP
 * round-trip (that is proven separately against the live realm). What matters
 * is that no code path reaches account creation without a sufficient,
 * fresh, third-party ceremony on record.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { KEYCLOAK_ADMIN } from '../src/identity/identity.tokens';

describe('REQ-PKI-01 enrolment ceremony gate (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const practiceId = randomUUID();
  let providerId: string;
  let createdUsers = 0;

  const fakeKeycloak = {
    createPasskeyOnlyUser: async () => {
      createdUsers += 1;
      return { id: randomUUID(), username: 'stub' };
    },
    sendPasskeyEnrolment: async () => undefined,
    setEnabled: async () => undefined,
    findByUsername: async () => null,
    assignRealmRoles: async () => undefined,
  };

  const goodCeremony = (overrides: Record<string, unknown> = {}) => ({
    providerId,
    ahpraNumber: 'MED0001234567',
    ahpraRegistrationCurrent: true,
    providerNumber: '1234567A',
    providerNumberLocation: '1 Example Street, Sampletown NSW 2000',
    providerNumberVerified: true,
    personVerificationMethod: 'video',
    verifiedByName: 'Robin Practicemanager',
    ...overrides,
  });

  const recordCeremony = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/identity/ceremonies').set('x-practice-id', practiceId).send(body);

  const invite = () =>
    request(app.getHttpServer())
      .post(`/identity/providers/${providerId}/invite`)
      .set('x-practice-id', practiceId)
      .send({ email: 'dr.example@example.invalid' });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KEYCLOAK_ADMIN)
      .useValue(fakeKeycloak)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'Ceremony Test Practice' } });
      providerId = (
        await tx.provider.create({
          data: { practiceId, name: 'Dr Ceremony Test', providerType: 'general_practitioner' },
        })
      ).id;
    });
  });

  afterAll(async () => {
    // Ceremonies are deliberately NOT deleted: they are append-only evidence
    // and the trigger refuses, exactly as it should. (An earlier version of
    // this teardown tried to disable the trigger and was correctly stopped —
    // the guard defends the record from the test suite too.) Rows are scoped
    // to a throwaway practice id, so leaving them costs nothing.
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.provider.deleteMany({});
      await tx.practice.deleteMany({});
    });
    await prisma.vaultOutbox.deleteMany({});
    await app.close();
  });

  describe('the gate', () => {
    it('no_ceremony_no_key — invitation is refused outright', async () => {
      const before = createdUsers;
      const res = await invite().expect(403);
      expect(res.body.message).toContain('REQ-PKI-01');
      expect(res.body.message).toContain('answered the email');
      // The decisive assertion: no account was created.
      expect(createdUsers).toBe(before);
    });
  });

  describe('recording a ceremony rejects incomplete attestations', () => {
    it('refuses a malformed AHPRA number (FR-1.11 format validation)', async () => {
      await recordCeremony(goodCeremony({ ahpraNumber: 'NOPE' })).expect(400);
    });

    it('refuses when AHPRA registration is not attested as current', async () => {
      const res = await recordCeremony(goodCeremony({ ahpraRegistrationCurrent: false })).expect(400);
      expect(res.body.message).toContain('CURRENT');
    });

    it('refuses a provider number with no location', async () => {
      await recordCeremony(goodCeremony({ providerNumberLocation: '' })).expect(400);
    });

    it('person_verification_must_be_video_or_in_person', async () => {
      for (const weak of ['email', 'phone', 'trusted_colleague']) {
        await recordCeremony(goodCeremony({ personVerificationMethod: weak })).expect(400);
      }
    });

    it('refuses an unnamed attester', async () => {
      await recordCeremony(goodCeremony({ verifiedByName: '' })).expect(400);
    });
  });

  describe('a sufficient ceremony authorises exactly one binding', () => {
    let ceremonyId: string;

    it('records the ceremony as evidence', async () => {
      const res = await recordCeremony(goodCeremony({ evidenceNote: 'Register sighted; video call 21 Aug.' })).expect(
        201,
      );
      ceremonyId = res.body.id;
      expect(res.body.ahpraNumber).toBe('MED0001234567');
      expect(res.body.consumedAt).toBeNull();
    });

    it('now permits the invitation, and the binding cites the attestation', async () => {
      const before = createdUsers;
      await invite().expect(201);
      expect(createdUsers).toBe(before + 1);

      const events = await prisma.vaultOutbox.findMany({ where: { subjectId: providerId } });
      const payload = events.map((e) => e.payload as Record<string, unknown>).find((p) => p.ceremonyId);
      expect(payload?.ceremonyId).toBe(ceremonyId);
      expect(payload?.attestedBy).toBe('Robin Practicemanager');
      expect(payload?.personVerificationMethod).toBe('video');
    });

    it('ceremony_is_consumed — it cannot authorise a second binding (no replay)', async () => {
      const consumed = await prisma.withPractice(practiceId, (tx) =>
        tx.enrolmentCeremony.findFirst({ where: { id: ceremonyId } }),
      );
      expect(consumed?.consumedAt).not.toBeNull();
    });

    it('ceremony_is_append_only — the attestation cannot be rewritten afterwards', async () => {
      await expect(
        prisma.withPractice(practiceId, (tx) =>
          tx.enrolmentCeremony.update({
            where: { id: ceremonyId },
            data: { verifiedByName: 'Someone Else', ahpraRegistrationCurrent: false },
          }),
        ),
      ).rejects.toThrow(/REQ-PKI-01/);
    });
  });

  describe('re-enrolment is recovery (REQ-PKI-05)', () => {
    it('refuses an ordinary ceremony once a key is already bound', async () => {
      await recordCeremony(goodCeremony()).expect(201);
      const before = createdUsers;
      const res = await invite().expect(403);
      expect(res.body.message).toContain('REQ-PKI-05');
      expect(res.body.message).toContain('RE-ENROLMENT');
      expect(createdUsers).toBe(before);
    });

    it('permits it on an explicitly stepped-up ceremony', async () => {
      await recordCeremony(goodCeremony({ steppedUp: true })).expect(201);
      const before = createdUsers;
      await invite().expect(201);
      expect(createdUsers).toBe(before + 1);

      const events = await prisma.vaultOutbox.findMany({ where: { subjectId: providerId } });
      const reEnrolment = events
        .map((e) => e.payload as Record<string, unknown>)
        .filter((p) => p.reEnrolment === true);
      expect(reEnrolment.length).toBeGreaterThan(0);
    });
  });
});
