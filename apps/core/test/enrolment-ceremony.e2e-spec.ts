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
import { createServicingProvider, deleteSeededAnchors } from './anchor';

describe('REQ-PKI-01 enrolment ceremony gate (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const practiceId = randomUUID();
  let providerId: string;
  let createdUsers = 0;

  /*
   * A STUB THAT REMEMBERS, since 12 Sep 2026 (PRACTICE-SCOPED-LOGIN.md §3
   * property 2). Account naming now asks the realm "does this account already
   * exist?" before it asks "what would this be called today", because a
   * passkey is bound to a username and recomputing one orphans the credential.
   * A stub that forgot every account could not exercise that at all — and a
   * re-enrolment (the tests below) is exactly the path that depends on it.
   */
  const accounts = new Map<string, { id: string; username: string }>();
  const fakeKeycloak = {
    createPasskeyOnlyUser: async (input: { username: string }) => {
      const existing = accounts.get(input.username);
      if (existing) return existing;
      createdUsers += 1;
      const user = { id: randomUUID(), username: input.username };
      accounts.set(user.username, user);
      return user;
    },
    sendPasskeyEnrolment: async () => undefined,
    setEnabled: async () => undefined,
    findByUsername: async (username: string) => accounts.get(username) ?? null,
    findById: async (id: string) => [...accounts.values()].find((u) => u.id === id) ?? null,
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
        await createServicingProvider(tx, practiceId, { name: 'Dr Ceremony Test', providerType: 'general_practitioner' })
      ).providerId;
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
      await deleteSeededAnchors(tx);
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

    it('an_account_named_for_an_address_is_refused_when_there_is_no_address', async () => {
      /*
       * A person's account is named for their email (PRACTICE-SCOPED-LOGIN.md
       * §3a), so without one there is no name to give it — and no invitation to
       * send, which is the same fact wearing a different hat. The old scheme
       * fell back to a slug of the person's NAME, which is how an account key
       * ended up able to change when somebody married.
       *
       * The ceremony recorded above is NOT consumed by a refusal, so the test
       * that follows still has one to spend.
       */
      const res = await request(app.getHttpServer())
        .post(`/identity/providers/${providerId}/invite`)
        .set('x-practice-id', practiceId)
        .send({})
        .expect(400);
      expect(res.body.message).toContain('email address');
      expect(res.body.message).toContain('PRACTICE-SCOPED-LOGIN.md');
      expect(accounts.size).toBe(0);
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

    it('permits it on an explicitly stepped-up ceremony, on the SAME account', async () => {
      await recordCeremony(goodCeremony({ steppedUp: true })).expect(201);
      const before = createdUsers;
      const previousUsername = [...accounts.keys()][0];
      const res = await invite().expect(201);

      /*
       * NO SECOND ACCOUNT, and this assertion was reversed on 12 Sep 2026.
       *
       * It read `before + 1`, which was never the real behaviour — it was an
       * artefact of a stub that forgot every account and handed back a fresh
       * id each time. `createPasskeyOnlyUser` is idempotent and returns the
       * existing account when the username matches.
       *
       * Under PRACTICE-SCOPED-LOGIN.md §3 property 2 the reverse is now a
       * REQUIREMENT rather than an incidental truth: recovery issues a new
       * credential on the account the person already holds. A second account
       * would mean a second username, and the passkey they are re-enrolling is
       * bound to the first one.
       */
      expect(createdUsers).toBe(before);
      expect(res.body.username).toBe(previousUsername);
      expect(accounts.size).toBe(1);

      const events = await prisma.vaultOutbox.findMany({ where: { subjectId: providerId } });
      const reEnrolment = events
        .map((e) => e.payload as Record<string, unknown>)
        .filter((p) => p.reEnrolment === true);
      expect(reEnrolment.length).toBeGreaterThan(0);
    });
  });
});
