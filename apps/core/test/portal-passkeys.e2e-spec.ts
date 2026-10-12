import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PORTAL_SESSION_COOKIE } from '@aobplatform/contracts';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PortalPasskeyService } from '../src/portal/portal-passkey.service';
import {
  PORTAL_WEBAUTHN,
  type PortalAuthenticationVerification,
  type PortalRegistrationVerification,
  type PortalWebAuthn,
} from '../src/portal/portal-webauthn';

/**
 * FR-8.2 — PASSKEYS FOR THE PATIENT PORTAL (Carl, 4 Sep 2026: "Implement";
 * D-2026-09-04-02). Real Postgres, real RLS, real service.
 *
 * WHAT IS FAKED AND WHY IT IS THE RIGHT LINE. `PORTAL_WEBAUTHN` — the four
 * cryptographic primitives — is replaced. NOTHING ELSE IS. Every rule this
 * suite pins is ours rather than the library's:
 *
 *   - a challenge is spent ONCE (`passkey_challenge_cannot_be_replayed`)
 *   - a challenge dies after five minutes
 *   - a registration challenge is not a sign-in challenge and vice versa
 *   - registration is unreachable without a bootstrapped session
 *     (`passkey_registration_requires_a_bootstrapped_session`)
 *   - a counter that went backwards is refused, an event is written, and the
 *     stored counter does NOT move (`passkey_counter_regression_is_refused`)
 *   - a credential signs its own account in and no other
 *
 * Building a software authenticator to test the above would mean writing a
 * large amount of new cryptography whose bugs would look like ours, in order to
 * re-run `@simplewebauthn/server`'s own test suite. The library's job is to
 * verify a signature; this suite's job is everything the library does not do.
 */
describe('M8 portal passkeys (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passkeys: PortalPasskeyService;

  const practiceA = randomUUID();
  const practiceB = randomUUID();
  let patientA = '';
  let patientB = '';

  /**
   * THE FAKE. It decides nothing: it hands back what the test told it to hand
   * back, and RECORDS what the service asked it — so "was the right challenge
   * passed to verification" is an assertion rather than a hope.
   */
  interface FakeWebAuthn extends PortalWebAuthn {
    /** Every challenge this fake has minted, newest last. */
    minted: string[];
    /** What each verifier was actually handed — asserted, not assumed. */
    lastRegistrationChallenge: string | null;
    lastAuthenticationChallenge: string | null;
    nextRegistration: PortalRegistrationVerification;
    nextAuthentication: PortalAuthenticationVerification;
  }

  const webauthn: FakeWebAuthn = {
    minted: [],
    lastRegistrationChallenge: null,
    lastAuthenticationChallenge: null,

    nextRegistration: {
      verified: true,
      credentialId: '',
      publicKey: new Uint8Array([1, 2, 3, 4]),
      counter: 0,
      transports: ['internal', 'hybrid'],
      aaguid: '00000000-0000-0000-0000-000000000000',
    },

    nextAuthentication: { verified: true, newCounter: 1 },

    async registrationOptions(): Promise<Record<string, unknown>> {
      const challenge = `reg-${randomUUID()}`;
      this.minted.push(challenge);
      return { challenge, rp: { id: 'localhost' } };
    },
    async verifyRegistration(input: { expectedChallenge: string }): Promise<PortalRegistrationVerification> {
      this.lastRegistrationChallenge = input.expectedChallenge;
      return this.nextRegistration;
    },
    async authenticationOptions(): Promise<Record<string, unknown>> {
      const challenge = `auth-${randomUUID()}`;
      this.minted.push(challenge);
      return { challenge, rpId: 'localhost' };
    },
    async verifyAuthentication(input: { expectedChallenge: string }): Promise<PortalAuthenticationVerification> {
      this.lastAuthenticationChallenge = input.expectedChallenge;
      return this.nextAuthentication;
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PORTAL_WEBAUTHN)
      .useValue(webauthn)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    passkeys = app.get(PortalPasskeyService);

    await prisma.withPractice(practiceA, async (tx) => {
      await tx.practice.create({ data: { id: practiceA, name: 'Passkey Test Practice', state: 'NSW' } });
      const patient = await tx.patient.create({
        data: {
          practiceId: practiceA,
          familyName: 'Sampleton',
          givenNames: 'Jamie',
          dateOfBirth: new Date('1962-11-02'),
          address: '2 Example Street, Sampletown NSW 2000',
        },
      });
      patientA = patient.id;
    });

    await prisma.withPractice(practiceB, async (tx) => {
      await tx.practice.create({ data: { id: practiceB, name: 'Other Passkey Practice', state: 'VIC' } });
      const patient = await tx.patient.create({
        data: {
          practiceId: practiceB,
          familyName: 'Otherperson',
          givenNames: 'Robin',
          dateOfBirth: new Date('1970-01-01'),
          address: '9 Other Road, Elsewhere VIC 3000',
        },
      });
      patientB = patient.id;
    });
  });

  afterAll(async () => {
    for (const practiceId of [practiceA, practiceB]) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.patient.deleteMany({});
        await tx.practice.deleteMany({});
      });
    }
    await prisma.$executeRawUnsafe('DELETE FROM portal_passkey_challenges');
    await prisma.$executeRawUnsafe('DELETE FROM portal_credentials');
    await prisma.$executeRawUnsafe('DELETE FROM portal_sessions');
    await prisma.$executeRawUnsafe('DELETE FROM portal_account_patients');
    await prisma.$executeRawUnsafe('DELETE FROM portal_accounts');
    await prisma.vaultOutbox.deleteMany({});
    await app.close();
  });

  beforeEach(() => {
    webauthn.nextRegistration = {
      verified: true,
      credentialId: `cred-${randomUUID().replace(/-/g, '')}`,
      publicKey: new Uint8Array([1, 2, 3, 4]),
      counter: 0,
      transports: ['internal'],
      aaguid: '00000000-0000-0000-0000-000000000000',
    };
    webauthn.nextAuthentication = { verified: true, newCounter: 1 };
    // One suite's rate-limit failures must not lock out the next test.
    passkeys.resetRateLimit();
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function cookieFrom(res: request.Response): string {
    const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
    const found = (raw ?? []).find((c) => c.startsWith(`${PORTAL_SESSION_COOKIE}=`));
    if (!found) throw new Error('no portal cookie was set');
    return found.split(';')[0];
  }

  /**
   * A BOOTSTRAPPED SESSION, through the dev seam.
   *
   * The real front door is `POST /portal/activate` and it is exercised in
   * `portal.e2e-spec.ts`; what this suite is about is what a session ALLOWS,
   * not how it was obtained. The seam writes the same `portal.accessed` event
   * the real path does, so nothing about the session is different.
   */
  async function devSession(patientId: string, practiceId: string): Promise<{ cookie: string; accountId: string }> {
    const res = await request(app.getHttpServer())
      .post('/dev/portal-session')
      .send({ patientIds: [patientId], practiceIds: [practiceId] })
      .expect(201);
    return { cookie: cookieFrom(res), accountId: res.body.accountId };
  }

  /** Enrol one passkey inside a live session. Returns the row id and its credential id. */
  async function enrol(cookie: string, label?: string): Promise<{ passkeyId: string; credentialId: string }> {
    const options = await request(app.getHttpServer())
      .post('/portal/passkeys/registration/options')
      .set('Cookie', cookie)
      .expect(201);

    /*
     * A FRESH CREDENTIAL ID PER ENROLMENT. The column is UNIQUE across the whole
     * table — which is the property a discoverable sign-in depends on — so a
     * test that enrols twice with one id is asserting against the wrong thing.
     */
    webauthn.nextRegistration = {
      ...webauthn.nextRegistration,
      credentialId: `cred-${randomUUID().replace(/-/g, '')}`,
    };
    const credentialId = webauthn.nextRegistration.credentialId;
    const verified = await request(app.getHttpServer())
      .post('/portal/passkeys/registration/verify')
      .set('Cookie', cookie)
      .send({ challengeId: options.body.challengeId, response: { id: credentialId }, ...(label ? { label } : {}) })
      .expect(201);

    return { passkeyId: verified.body.passkey.id, credentialId };
  }

  /**
   * Read or write a portal_* row from the test, under the RLS key that row
   * needs.
   *
   * THE SUITE HAS TO DO THIS BECAUSE THE FENCE IS REAL. Prisma connects as
   * `aob_app`, which holds neither SUPERUSER nor BYPASSRLS, so a bare
   * `SELECT ... FROM portal_credentials` from a test returns nothing at all —
   * the same nothing an attacker would get. Setting the key explicitly is the
   * test saying which row it is entitled to look at, and it is a good sign
   * rather than an inconvenience: a suite that could read these tables freely
   * would not be exercising the policies it claims to.
   */
  function scoped<T>(key: string, value: string, fn: (tx: unknown) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('${key}', $1, true)`, value);
      return fn(tx);
    });
  }

  async function eventsOfType(type: string): Promise<Array<Record<string, unknown>>> {
    const rows = await prisma.vaultOutbox.findMany({ where: { type } });
    return rows.map((row) => row.payload as Record<string, unknown>);
  }

  // -------------------------------------------------------------------------
  // Registration needs the bootstrap
  // -------------------------------------------------------------------------

  it('passkey_registration_requires_a_bootstrapped_session', async () => {
    /*
     * THE RULE THIS FEATURE RESTS ON. A credential enrolled without a session
     * is bound to whoever was holding the phone — the family-phone failure
     * (REQ-VUL, addendum v4) with a cryptographic key on the end of it. Both
     * halves of the ceremony refuse, and so does the list.
     */
    await request(app.getHttpServer()).post('/portal/passkeys/registration/options').expect(401);
    await request(app.getHttpServer())
      .post('/portal/passkeys/registration/verify')
      .send({ challengeId: randomUUID(), response: { id: 'anything' } })
      .expect(401);
    await request(app.getHttpServer()).get('/portal/passkeys').expect(401);

    // And an expired or forged cookie is no better than none.
    await request(app.getHttpServer())
      .post('/portal/passkeys/registration/options')
      .set('Cookie', `${PORTAL_SESSION_COOKIE}=${randomUUID()}`)
      .expect(401);
  });

  it('enrols inside a session, lists it, and writes the event', async () => {
    const { cookie, accountId } = await devSession(patientA, practiceA);
    const { passkeyId } = await enrol(cookie, 'My phone');

    // The service passed the challenge it stored, not one from the request.
    expect(webauthn.lastRegistrationChallenge).toBe(webauthn.minted[webauthn.minted.length - 1]);

    const list = await request(app.getHttpServer()).get('/portal/passkeys').set('Cookie', cookie).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id: passkeyId, label: 'My phone', lastUsedAt: null });

    const events = await eventsOfType('portal.passkey_registered');
    expect(events.length).toBeGreaterThan(0);
    const payloads = JSON.stringify(events);
    // TYPES AND OUTCOMES, NEVER VALUES (REQ-LOG-08, hard rule 9). No credential
    // id, no public key, no label — the label is a boolean.
    expect(payloads).not.toContain('My phone');
    expect(payloads).not.toContain(webauthn.nextRegistration.credentialId);
    expect(events.some((p) => p.labelled === true)).toBe(true);
    expect(accountId).toBeTruthy();
  });

  it('a blank label is stored as no label rather than as an empty one', async () => {
    const { cookie } = await devSession(patientA, practiceA);
    const options = await request(app.getHttpServer())
      .post('/portal/passkeys/registration/options')
      .set('Cookie', cookie)
      .expect(201);

    // `whitelist: true` plus the DTO's MinLength refuses a blank string outright
    // rather than letting an empty label into a column that forbids one.
    await request(app.getHttpServer())
      .post('/portal/passkeys/registration/verify')
      .set('Cookie', cookie)
      .send({ challengeId: options.body.challengeId, response: { id: 'x' }, label: '' })
      .expect(400);
  });

  // -------------------------------------------------------------------------
  // The challenge
  // -------------------------------------------------------------------------

  it('passkey_challenge_cannot_be_replayed', async () => {
    const { cookie } = await devSession(patientA, practiceA);

    const options = await request(app.getHttpServer())
      .post('/portal/passkeys/registration/options')
      .set('Cookie', cookie)
      .expect(201);

    const body = { challengeId: options.body.challengeId, response: { id: webauthn.nextRegistration.credentialId } };

    await request(app.getHttpServer())
      .post('/portal/passkeys/registration/verify')
      .set('Cookie', cookie)
      .send(body)
      .expect(201);

    /*
     * THE SECOND USE IS THE WHOLE POINT. Captured traffic replayed a second
     * later is refused, and the refusal is the same 401 an unknown challenge
     * gets — a caller cannot tell "already used" from "never existed".
     */
    await request(app.getHttpServer())
      .post('/portal/passkeys/registration/verify')
      .set('Cookie', cookie)
      .send({ ...body, response: { id: `cred-${randomUUID().replace(/-/g, '')}` } })
      .expect(401);

    // And exactly one credential exists, not two.
    const list = await request(app.getHttpServer()).get('/portal/passkeys').set('Cookie', cookie).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('a challenge older than its five minutes is refused', async () => {
    const { cookie } = await devSession(patientA, practiceA);
    const options = await request(app.getHttpServer())
      .post('/portal/passkeys/registration/options')
      .set('Cookie', cookie)
      .expect(201);

    /*
     * AGED IN PLACE rather than waiting five minutes. `createdAt` moves too,
     * because the CHECK insists an expiry is after a creation — a row that
     * expired before it existed is not the state being tested. The predicate
     * that matters is `expiresAt > now` inside the conditional update.
     */
    await scoped('app.portal_challenge_id', options.body.challengeId, async (tx) => {
      const updated = await (tx as { $executeRawUnsafe: (q: string, ...a: unknown[]) => Promise<number> })
        .$executeRawUnsafe(
          `UPDATE portal_passkey_challenges
             SET "createdAt" = now() - interval '10 minutes', "expiresAt" = now() - interval '5 minutes'
           WHERE id = $1::uuid`,
          options.body.challengeId,
        );
      // The fence is live; if this ever silently updates nothing, the test
      // below would pass for the wrong reason.
      expect(updated).toBe(1);
    });

    await request(app.getHttpServer())
      .post('/portal/passkeys/registration/verify')
      .set('Cookie', cookie)
      .send({ challengeId: options.body.challengeId, response: { id: 'x' } })
      .expect(401);
  });

  it('a registration challenge cannot be presented to the sign-in verifier', async () => {
    const { cookie } = await devSession(patientA, practiceA);
    const options = await request(app.getHttpServer())
      .post('/portal/passkeys/registration/options')
      .set('Cookie', cookie)
      .expect(201);

    // One nonce, one job. The purpose is part of the predicate that spends it.
    await request(app.getHttpServer())
      .post('/portal/passkeys/authentication/verify')
      .send({ challengeId: options.body.challengeId, response: { id: 'x' } })
      .expect(401);
  });

  it('a registration challenge minted in one session cannot be finished in another', async () => {
    const first = await devSession(patientA, practiceA);
    const second = await devSession(patientA, practiceA);

    const options = await request(app.getHttpServer())
      .post('/portal/passkeys/registration/options')
      .set('Cookie', first.cookie)
      .expect(201);

    /*
     * BOUND TO THE SESSION, NOT ONLY TO THE ACCOUNT. Binding to the account
     * alone would let a challenge minted in a session the patient has since
     * abandoned still enrol a credential — which is the state somebody creates
     * when they sign out because they think something is wrong.
     */
    await request(app.getHttpServer())
      .post('/portal/passkeys/registration/verify')
      .set('Cookie', second.cookie)
      .send({ challengeId: options.body.challengeId, response: { id: 'x' } })
      .expect(401);
  });

  // -------------------------------------------------------------------------
  // Signing in
  // -------------------------------------------------------------------------

  it('signs in without a username and lands on the credential’s own account', async () => {
    const { cookie, accountId } = await devSession(patientA, practiceA);
    const { credentialId } = await enrol(cookie);

    const options = await request(app.getHttpServer())
      .post('/portal/passkeys/authentication/options')
      .expect(201);
    // No credential list, so the endpoint cannot answer "does this person have
    // an account here".
    expect(options.body.options.allowCredentials).toBeUndefined();

    const signedIn = await request(app.getHttpServer())
      .post('/portal/passkeys/authentication/verify')
      .send({ challengeId: options.body.challengeId, response: { id: credentialId } })
      .expect(201);

    expect(signedIn.body).toMatchObject({ signedIn: true, accountId });
    const fresh = cookieFrom(signedIn);

    // The new session is a real one, and it sees the same one practice.
    const session = await request(app.getHttpServer()).get('/portal/session').set('Cookie', fresh).expect(200);
    expect(session.body.accountId).toBe(accountId);
    expect(session.body.links).toHaveLength(1);
    expect(session.body.links[0].practiceId).toBe(practiceA);

    // Both events: the door-agnostic access event and the one that says which door.
    expect((await eventsOfType('portal.passkey_signed_in')).length).toBeGreaterThan(0);
    const accessed = await prisma.vaultOutbox.findMany({ where: { type: 'portal.accessed' } });
    expect(accessed.some((row) => (row.payload as Record<string, unknown>).reason === 'passkey')).toBe(true);

    // And the credential now records that it has been used.
    const list = await request(app.getHttpServer()).get('/portal/passkeys').set('Cookie', fresh).expect(200);
    expect(list.body[0].lastUsedAt).not.toBeNull();
  });

  it('passkey_counter_regression_is_refused', async () => {
    const { cookie } = await devSession(patientA, practiceA);
    const { credentialId, passkeyId } = await enrol(cookie);

    // Move the stored counter up first — the check is "went backwards, having
    // previously moved", because most platform authenticators pin theirs at
    // zero forever and refusing "no increase" would refuse every iPhone.
    const first = await request(app.getHttpServer()).post('/portal/passkeys/authentication/options').expect(201);
    webauthn.nextAuthentication = { verified: true, newCounter: 9 };
    await request(app.getHttpServer())
      .post('/portal/passkeys/authentication/verify')
      .send({ challengeId: first.body.challengeId, response: { id: credentialId } })
      .expect(201);

    /*
     * NOW THE CLONE. The signature VERIFIES — that is exactly what makes it
     * worth refusing. A counter that has gone backwards is an authenticator
     * that has been copied.
     */
    const second = await request(app.getHttpServer()).post('/portal/passkeys/authentication/options').expect(201);
    webauthn.nextAuthentication = { verified: true, newCounter: 4 };
    const refused = await request(app.getHttpServer())
      .post('/portal/passkeys/authentication/verify')
      .send({ challengeId: second.body.challengeId, response: { id: credentialId } })
      .expect(401);
    expect(refused.headers['set-cookie']).toBeUndefined();

    const rejected = await eventsOfType('portal.passkey_rejected');
    expect(rejected.some((p) => p.reason === 'counter_regression' && p.presentedCounter === 4)).toBe(true);

    // THE STORED COUNTER DID NOT MOVE. A rejected assertion must not advance
    // the state it was rejected against.
    const stored = await scoped('app.portal_credential_id', credentialId, (tx) =>
      (tx as { $queryRawUnsafe: (q: string, ...a: unknown[]) => Promise<Array<{ counter: bigint }>> }).$queryRawUnsafe(
        'SELECT "counter" FROM portal_credentials WHERE id = $1::uuid',
        passkeyId,
      ),
    );
    expect(Number(stored[0].counter)).toBe(9);

    // A standstill at the same value is refused too, on the same reasoning.
    const third = await request(app.getHttpServer()).post('/portal/passkeys/authentication/options').expect(201);
    webauthn.nextAuthentication = { verified: true, newCounter: 9 };
    await request(app.getHttpServer())
      .post('/portal/passkeys/authentication/verify')
      .send({ challengeId: third.body.challengeId, response: { id: credentialId } })
      .expect(401);
  });

  it('a signature that does not verify yields no session and no event', async () => {
    const { cookie } = await devSession(patientA, practiceA);
    const { credentialId } = await enrol(cookie);
    const before = (await eventsOfType('portal.passkey_signed_in')).length;

    const options = await request(app.getHttpServer()).post('/portal/passkeys/authentication/options').expect(201);
    webauthn.nextAuthentication = { verified: false, newCounter: 99 };
    const res = await request(app.getHttpServer())
      .post('/portal/passkeys/authentication/verify')
      .send({ challengeId: options.body.challengeId, response: { id: credentialId } })
      .expect(401);

    expect(res.headers['set-cookie']).toBeUndefined();
    expect((await eventsOfType('portal.passkey_signed_in')).length).toBe(before);
  });

  it('one account’s credential never opens another account’s record', async () => {
    const a = await devSession(patientA, practiceA);
    const b = await devSession(patientB, practiceB);
    const credA = await enrol(a.cookie);
    const credB = await enrol(b.cookie);

    /*
     * THE SESSION FOLLOWS THE CREDENTIAL, NOT THE REQUEST. Signing in with B's
     * credential lands on B's account and sees B's practice — there is no field
     * in the request that could say otherwise, because who is signing in is
     * decided by which credential signed.
     */
    const options = await request(app.getHttpServer()).post('/portal/passkeys/authentication/options').expect(201);
    const signedIn = await request(app.getHttpServer())
      .post('/portal/passkeys/authentication/verify')
      .send({ challengeId: options.body.challengeId, response: { id: credB.credentialId } })
      .expect(201);

    expect(signedIn.body.accountId).toBe(b.accountId);
    expect(signedIn.body.accountId).not.toBe(a.accountId);
    const bCookie = cookieFrom(signedIn);

    const details = await request(app.getHttpServer()).get('/portal/details').set('Cookie', bCookie).expect(200);
    expect(details.body.every((row: { practiceId: string }) => row.practiceId === practiceB)).toBe(true);

    // B's list holds B's credential and nothing of A's.
    const list = await request(app.getHttpServer()).get('/portal/passkeys').set('Cookie', bCookie).expect(200);
    expect(list.body.map((p: { id: string }) => p.id)).toEqual([credB.passkeyId]);

    // And B cannot revoke A's — a 404 indistinguishable from a passkey that
    // never existed, at the application layer and under RLS beneath it.
    await request(app.getHttpServer())
      .post(`/portal/passkeys/${credA.passkeyId}/revoke`)
      .set('Cookie', bCookie)
      .expect(404);

    // A's is untouched.
    const stillThere = await request(app.getHttpServer()).get('/portal/passkeys').set('Cookie', a.cookie).expect(200);
    expect(stillThere.body.map((p: { id: string }) => p.id)).toContain(credA.passkeyId);
  });

  // -------------------------------------------------------------------------
  // Taking one away
  // -------------------------------------------------------------------------

  it('revoking the last passkey is allowed, and a revoked one cannot sign in', async () => {
    const { cookie } = await devSession(patientA, practiceA);
    const { passkeyId, credentialId } = await enrol(cookie);

    /*
     * REQ-PORT-08 IN ONE ASSERTION. The portal is never a precondition, so a
     * patient wiping a phone they are selling is not made to keep a credential
     * in order to be permitted to remove the others. Re-entry is a fresh
     * invitation at the practice and the bootstrap again.
     */
    const revoked = await request(app.getHttpServer())
      .post(`/portal/passkeys/${passkeyId}/revoke`)
      .set('Cookie', cookie)
      .expect(201);
    expect(revoked.body).toMatchObject({ revoked: true, passkeyId, noPasskeysRemain: true });

    const list = await request(app.getHttpServer()).get('/portal/passkeys').set('Cookie', cookie).expect(200);
    expect(list.body).toHaveLength(0);

    const options = await request(app.getHttpServer()).post('/portal/passkeys/authentication/options').expect(201);
    const res = await request(app.getHttpServer())
      .post('/portal/passkeys/authentication/verify')
      .send({ challengeId: options.body.challengeId, response: { id: credentialId } })
      .expect(401);
    expect(res.headers['set-cookie']).toBeUndefined();

    // Revoking twice is a 404, not a second event.
    await request(app.getHttpServer())
      .post(`/portal/passkeys/${passkeyId}/revoke`)
      .set('Cookie', cookie)
      .expect(404);

    const events = await eventsOfType('portal.passkey_revoked');
    expect(events.filter((p) => p.lastOne === true).length).toBeGreaterThan(0);
  });

  it('no passkey event ever carries a credential id, a public key or a label', async () => {
    /*
     * ONE SWEEP OVER THE WHOLE OUTBOX (REQ-LOG-08, hard rule 9). Written as a
     * search rather than as four field assertions, because the failure this
     * guards against is somebody ADDING a field, not changing one.
     */
    const rows = await prisma.vaultOutbox.findMany({ where: { type: { startsWith: 'portal.passkey_' } } });
    expect(rows.length).toBeGreaterThan(0);
    const dump = JSON.stringify(rows.map((row) => ({ actor: row.actor, payload: row.payload })));

    expect(dump).not.toContain('cred-');
    expect(dump).not.toContain('My phone');
    expect(dump).not.toMatch(/publicKey/i);
    expect(dump).not.toMatch(/credentialId/i);
  });
});
