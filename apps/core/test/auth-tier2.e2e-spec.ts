import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { SECOND_FACTOR_MAX_AGE_SECONDS } from '@aobplatform/domain';
import { PATH_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { FRESH_SECOND_FACTOR } from '../src/auth/fresh-second-factor.decorator';
import { PUBLIC_ENDPOINT } from '../src/auth/public.decorator';
import { PortalPasskeyController } from '../src/portal/portal-passkey.controller';

/**
 * TIER 2 AT THE API — AUTH-TIERS.md §5, D-2026-09-12-11.
 *
 * Authentication itself happens in Keycloak, and it is proved against a live
 * realm by `infra/keycloak/tier2-verify.mjs` and `tier2-verify-passkey.mjs`.
 * What THIS suite pins is the half that is ours: what core does with the
 * session once the token arrives.
 *
 *  - a high-stakes act refuses a session whose second factor has gone stale,
 *    and says WHICH problem it is rather than "forbidden"
 *  - the same act proceeds on a fresh one
 *  - "stale" is judged on when the person authenticated, not on when the token
 *    was minted, so a silent refresh does not launder an old session
 *  - a session that never had a second factor gets a different answer, because
 *    signing in again would not fix it
 *  - the patient portal is untouched by all of it (D-2026-09-04-02)
 *
 * THE SESSION IS SET BY MIDDLEWARE, not a header — `request.principal` is a
 * property on the Express request, so nothing a client sends can forge one.
 * The same seam every other suite in this directory uses.
 */

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A practice administrator who signed in with a password and a one-time code. */
function tier2Session(practiceId: string, authTimeSeconds: number): Record<string, unknown> {
  return {
    sub: '00000000-0000-4000-8000-0000000t1er2',
    principalType: 'staff',
    roles: [],
    preferredUsername: 'robin.admin',
    practiceId,
    // What the sandbox realm actually emits — read off a live token, not
    // copied from the specification (infra/keycloak/tier2-verify.mjs).
    amr: ['pwd', 'otp'],
    authTime: authTimeSeconds,
    raw: {},
  };
}

let currentPrincipal: Record<string, unknown> | null = null;

describe('tier 2 authentication at the API (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const practiceId = randomUUID();
  const http = () => request(app.getHttpServer());

  async function registerDevice(label: string): Promise<string> {
    currentPrincipal = tier2Session(practiceId, nowSeconds());
    const res = await http().post('/devices').set('x-practice-id', practiceId).send({ label }).expect(201);
    return res.body.deviceId as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      if (currentPrincipal) req.principal = currentPrincipal;
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.withPractice(practiceId, (tx) =>
      tx.practice.create({ data: { id: practiceId, name: 'Tier 2 Test Practice' } }),
    );
  });

  afterAll(async () => {
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.devicePairingCode.deleteMany({ where: { practiceId } });
      await tx.device.deleteMany({});
      await tx.practice.deleteMany({});
    });
    await prisma.vaultOutbox.deleteMany({ where: { subjectType: 'Device' } });
    currentPrincipal = null;
    await app?.close();
  });

  beforeEach(() => {
    currentPrincipal = null;
  });

  describe('a fresh second factor before a high-stakes act', () => {
    it('a_high_stakes_act_asks_for_the_second_factor_again', async () => {
      const deviceId = await registerDevice('Reception tablet — stale session');

      // Signed in this morning: a perfectly valid session, four hours old.
      currentPrincipal = tier2Session(practiceId, nowSeconds() - 4 * 60 * 60);
      const refused = await http()
        .post(`/devices/${deviceId}/revoke`)
        .set('x-practice-id', practiceId)
        .send({ reason: 'left in a taxi' })
        .expect(403);

      /*
       * THE CODE, NOT ONLY THE SENTENCE (CLAUDE.md §7). The console has to be
       * able to tell "confirm it's you" from "your account cannot do this",
       * and prose cannot be switched on.
       */
      expect(refused.body.reasonCode).toBe('reauthentication_required');
      expect(String(refused.body.message)).toMatch(/sign in again/i);

      // And the device is still there. A refusal must not half-perform the act.
      const device = await prisma.withPractice(practiceId, (tx) => tx.device.findUnique({ where: { id: deviceId } }));
      expect(device?.revokedAt ?? null).toBeNull();
    });

    it('the same act proceeds when the second factor is fresh', async () => {
      const deviceId = await registerDevice('Reception tablet — fresh session');
      currentPrincipal = tier2Session(practiceId, nowSeconds() - 30);
      await http()
        .post(`/devices/${deviceId}/revoke`)
        .set('x-practice-id', practiceId)
        .send({ reason: 'taken out of service' })
        .expect(201);
      const device = await prisma.withPractice(practiceId, (tx) => tx.device.findUnique({ where: { id: deviceId } }));
      expect(device?.revokedAt).not.toBeNull();
    });

    it('is judged on when the person authenticated, not on when the token was minted', async () => {
      /*
       * THE FAILURE THIS EXISTS FOR. A console tab open all afternoon renews
       * its access token every few minutes, so a check on the token's age
       * would call a four-hour-old session brand new. `auth_time` does not
       * move on a refresh, and it is what the guard reads.
       */
      const deviceId = await registerDevice('Reception tablet — refreshed token');
      currentPrincipal = {
        ...tier2Session(practiceId, nowSeconds() - SECOND_FACTOR_MAX_AGE_SECONDS - 60),
        // A token minted one second ago, carrying an old authentication.
        raw: { iat: nowSeconds() - 1 },
      };
      const refused = await http()
        .post(`/devices/${deviceId}/revoke`)
        .set('x-practice-id', practiceId)
        .send({})
        .expect(403);
      expect(refused.body.reasonCode).toBe('reauthentication_required');
    });

    it('a session with no second factor at all is told something different', async () => {
      const deviceId = await registerDevice('Reception tablet — password only');
      // No flow in this product produces one. If one ever does, the answer
      // must not be "sign in again", which would be an instruction to loop.
      currentPrincipal = { ...tier2Session(practiceId, nowSeconds()), amr: ['pwd'] };
      const refused = await http()
        .post(`/devices/${deviceId}/revoke`)
        .set('x-practice-id', practiceId)
        .send({})
        .expect(403);
      expect(refused.body.reasonCode).toBe('second_factor_required');
      expect(String(refused.body.message)).not.toMatch(/sign in again/i);
    });

    it('a session that cannot say when it authenticated is refused, not trusted', async () => {
      const deviceId = await registerDevice('Reception tablet — silent session');
      const session = tier2Session(practiceId, nowSeconds());
      delete session.authTime;
      currentPrincipal = session;
      const refused = await http()
        .post(`/devices/${deviceId}/revoke`)
        .set('x-practice-id', practiceId)
        .send({})
        .expect(403);
      expect(refused.body.reasonCode).toBe('reauthentication_required');
    });

    it('leaves the reversible acts on the same device alone', async () => {
      /*
       * Rotate keeps the tablet working and only changes its credential; the
       * disclosure switch is one click back. Gating them too would teach
       * people to re-authenticate reflexively, which is the habit a real-time
       * phishing attack needs.
       */
      const deviceId = await registerDevice('Reception tablet — rotate on a stale session');
      currentPrincipal = tier2Session(practiceId, nowSeconds() - 4 * 60 * 60);
      await http().post(`/devices/${deviceId}/rotate`).set('x-practice-id', practiceId).send({}).expect(201);
    });
  });

  describe('the patient portal is untouched', () => {
    it('a_patient_portal_sign_in_is_unaffected', async () => {
      /*
       * STRUCTURAL FIRST. Portal passkeys live in core, not Keycloak
       * (D-2026-09-04-02), and every route on the controller is `@Public()` —
       * so the guard returns before it can read a session at all, and no
       * portal route carries the tier 2 gate. Asserted rather than assumed,
       * because "we did not add it there" is exactly the kind of claim that
       * stops being true one commit later.
       */
      const handlers = Object.getOwnPropertyNames(PortalPasskeyController.prototype)
        .filter((name) => name !== 'constructor')
        .map((name) => (PortalPasskeyController.prototype as unknown as Record<string, unknown>)[name] as object)
        // ROUTES ONLY. The controller also has private helpers on its
        // prototype, which are not endpoints and carry no route metadata.
        .filter((handler) => Reflect.hasMetadata(PATH_METADATA, handler));
      expect(handlers.length).toBeGreaterThan(0);
      for (const handler of handlers) {
        expect(Reflect.getMetadata(FRESH_SECOND_FACTOR, handler)).toBeUndefined();
        expect(Reflect.getMetadata(PUBLIC_ENDPOINT, handler)).toBe(true);
      }

      /*
       * AND BEHAVIOURALLY, with the very session tier 2 would refuse for a
       * high-stakes act on the practice side. A patient's sign-in must not
       * change because a practice's did.
       */
      currentPrincipal = { ...tier2Session(practiceId, nowSeconds() - 4 * 60 * 60), amr: [] };
      const res = await http().post('/portal/passkeys/authentication/options').send({});
      expect(res.status).not.toBe(403);
      expect(res.body?.reasonCode).toBeUndefined();
    });
  });
});
