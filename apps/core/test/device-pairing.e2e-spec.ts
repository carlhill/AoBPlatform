import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * DEVICE PAIRING — the one credential the zero-footprint rule allows on a
 * tablet (CLAUDE.md §7; TODO.md "Zero-footprint kiosk").
 *
 * WHAT THIS SUITE PINS, and each of them is a way the feature could look
 * finished and not be:
 *
 *  - `/kiosk/*` answers ONLY a paired device. The header that used to scope it
 *    is not merely ignored, it is refused — a public URL that took a practice
 *    id from whoever sent one is what this whole feature exists to close.
 *  - A pairing code works once and dies in ten minutes.
 *  - Revoking a tablet closes it on the very next request, with no data in the
 *    body — not "eventually", not "when the session expires".
 *  - The credential is never stored in clear, anywhere, and the database
 *    refuses a row that holds one.
 *  - Every act writes its vault event in the same transaction as the row it
 *    evidences (hard rule 11), and no event carries the credential or the code.
 *  - None of it crosses a practice boundary, and a wrong scope fails closed.
 */

/** The practice administrator registering tablets. Null = nobody signed in. */
const ADMIN = {
  sub: '00000000-0000-4000-8000-00000000dev1',
  principalType: 'staff',
  roles: [],
  preferredUsername: 'robin.admin',
  raw: {},
};
let currentPrincipal: Record<string, unknown> | null = null;

/**
 * Signed in AT a practice. The console endpoints are `@PracticeScoped`, for
 * the same reason `practice-users` is: handing out the credential that opens a
 * practice's waiting list is the practice's own act, and a platform operator
 * reaches it only by acting as them.
 */
function signedInAt(practiceId: string): void {
  currentPrincipal = { ...ADMIN, practiceId };
}

describe('device pairing (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const practiceA = randomUUID();
  const practiceB = randomUUID();

  const http = () => request(app.getHttpServer());

  /**
   * Retry a read until it answers, for the ONE thing on this feature that is
   * written outside the request that caused it. Bounded and short: a second is
   * far longer than the write takes, and failing after it is a real failure
   * rather than a slow machine.
   */
  async function waitFor<T>(read: () => Promise<T | null>, attempts = 20): Promise<T | null> {
    for (let i = 0; i < attempts; i += 1) {
      const value = await read();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return read();
  }

  /** Register a tablet as the signed-in administrator and hand back its code. */
  async function registerDevice(
    practiceId: string,
    label: string,
  ): Promise<{ deviceId: string; code: string }> {
    signedInAt(practiceId);
    const res = await http()
      .post('/devices')
      .set('x-practice-id', practiceId)
      .send({ label })
      .expect(201);
    currentPrincipal = null;
    return { deviceId: res.body.deviceId, code: res.body.code };
  }

  /** The public exchange, exactly as a tablet performs it. */
  async function pair(code: string): Promise<string> {
    const res = await http().post('/devices/pair').send({ code }).expect(201);
    return res.body.credential as string;
  }

  async function registerAndPair(practiceId: string, label: string) {
    const { deviceId, code } = await registerDevice(practiceId, label);
    return { deviceId, credential: await pair(code) };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // The same seam the service-description and acting-as suites use:
    // middleware runs before the guards and cannot be forged by a client.
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      if (currentPrincipal) req.principal = currentPrincipal;
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    for (const [practiceId, name] of [
      [practiceA, 'Device Test Practice A'],
      [practiceB, 'Device Test Practice B'],
    ] as const) {
      await prisma.withPractice(practiceId, (tx) => tx.practice.create({ data: { id: practiceId, name } }));
    }
  });

  afterAll(async () => {
    for (const practiceId of [practiceA, practiceB]) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.devicePairingCode.deleteMany({ where: { practiceId } });
        await tx.device.deleteMany({});
        await tx.captureRequest.deleteMany({});
        await tx.agreement.deleteMany({});
        await tx.assignor.deleteMany({});
        await tx.patient.deleteMany({});
        await tx.provider.deleteMany({});
        await tx.practice.deleteMany({});
      });
    }
    await prisma.vaultOutbox.deleteMany({ where: { subjectType: 'Device' } });
    currentPrincipal = null;
    await app?.close();
  });

  beforeEach(() => {
    currentPrincipal = null;
  });

  describe('registering a tablet', () => {
    it('refuses an unattributed registration rather than filing it as nobody', async () => {
      // This is the act that hands out the credential which opens a practice's
      // waiting list. An audit line naming nobody is worse than a refusal.
      await http()
        .post('/devices')
        .set('x-practice-id', practiceA)
        .send({ label: 'Nobody’s tablet' })
        .expect(403);
    });

    it('returns the pairing code exactly once and never stores it', async () => {
      const { deviceId, code } = await registerDevice(practiceA, 'Reception tablet 1');
      expect(code).toMatch(/^[A-HJ-NP-TV-Z2-9]{8}$/);

      // Nothing anywhere holds the code itself — only its sha256.
      const rows = await prisma.devicePairingCode.findMany({ where: { deviceId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0].codeHash).not.toBe(code);
      expect(JSON.stringify(rows[0])).not.toContain(code);

      // And there is no endpoint that would give it back: the list carries an
      // expiry, never a code.
      signedInAt(practiceA);
      const list = await http().get('/devices').set('x-practice-id', practiceA).expect(200);
      const row = list.body.devices.find((d: { id: string }) => d.id === deviceId);
      expect(row.state).toBe('awaiting_pairing');
      expect(row.pairingExpiresAt).toEqual(expect.any(String));
      expect(JSON.stringify(list.body)).not.toContain(code);
    });
  });

  describe('the pairing exchange', () => {
    it('pairing_code_is_single_use_and_expires', async () => {
      const { deviceId, code } = await registerDevice(practiceA, 'Single-use tablet');

      // Once.
      const first = await http().post('/devices/pair').send({ code }).expect(201);
      expect(first.body.credential).toEqual(expect.any(String));
      expect(first.body.practiceName).toBe('Device Test Practice A');

      // And never again — the same code, the same shape of refusal.
      await http().post('/devices/pair').send({ code }).expect(401);
      // Hyphenated and lower-cased is the same code, and is equally spent.
      await http()
        .post('/devices/pair')
        .send({ code: `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase() })
        .expect(401);

      // AND IT EXPIRES. Ten minutes is the policy; this ages the row rather
      // than waiting for it, which is the only honest way to test a clock.
      const { deviceId: staleDeviceId, code: staleCode } = await registerDevice(practiceA, 'Stale tablet');
      await prisma.devicePairingCode.updateMany({
        where: { deviceId: staleDeviceId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await http().post('/devices/pair').send({ code: staleCode }).expect(401);

      // The expired code left the device unpaired, not half-paired.
      const stale = await prisma.withPractice(practiceA, (tx) =>
        tx.device.findFirst({ where: { id: staleDeviceId } }),
      );
      expect(stale?.pairedAt).toBeNull();
      expect(stale?.credentialHash).toBeNull();

      // A wrong code is refused with the same sentence as an expired one:
      // telling a caller their code was right but stale is telling them their
      // guess was right.
      const wrong = await http().post('/devices/pair').send({ code: 'ZZZZZZZZ' }).expect(401);
      const spent = await http().post('/devices/pair').send({ code }).expect(401);
      expect(wrong.body.message).toBe(spent.body.message);

      // Housekeeping for the suite's own later assertions.
      expect(deviceId).toEqual(expect.any(String));
    });

    it('credential_never_stored_in_clear', async () => {
      const { deviceId, credential } = await registerAndPair(practiceA, 'Clear-text tablet');

      const device = await prisma.withPractice(practiceA, (tx) =>
        tx.device.findFirst({ where: { id: deviceId } }),
      );
      expect(device?.credentialHash).toMatch(/^[0-9a-f]{64}$/);
      expect(device?.credentialHash).not.toBe(credential);
      // The whole row, serialised — nothing on it contains the credential or
      // its secret half.
      const secret = credential.slice(credential.indexOf('.') + 1);
      expect(JSON.stringify(device)).not.toContain(credential);
      expect(JSON.stringify(device)).not.toContain(secret);

      // Nor does anything in the vault outbox, which is the other place a
      // secret would leak if a payload were assembled carelessly.
      const events = await prisma.vaultOutbox.findMany({ where: { subjectId: deviceId } });
      expect(events.length).toBeGreaterThan(0);
      expect(JSON.stringify(events)).not.toContain(secret);

      // AND THE DATABASE ITSELF REFUSES ONE. The CHECK constraint says the
      // column is sha256 hex, so a future code path that tried to store the
      // credential could not — this is the structural half of the rule.
      await expect(
        prisma.withPractice(practiceA, (tx) =>
          tx.device.update({ where: { id: deviceId }, data: { credentialHash: credential } }),
        ),
      ).rejects.toBeDefined();
    });

    it('pairing_emits_vault_event_in_same_transaction', async () => {
      const { deviceId, code } = await registerDevice(practiceA, 'Evidenced tablet');

      // Registration is already evidence, and it names the person.
      const registered = await prisma.vaultOutbox.findFirst({
        where: { subjectId: deviceId, type: 'device.registered' },
      });
      expect(registered).toBeTruthy();
      expect((registered!.actor as { id: string }).id).toBe(ADMIN.sub);
      expect((registered!.payload as { label: string }).label).toBe('Evidenced tablet');

      // A FAILED pairing writes neither a credential nor an event: the two
      // move together, which is what "same transaction" buys.
      await http().post('/devices/pair').send({ code: 'ZZZZZZZZ' }).expect(401);
      expect(
        await prisma.vaultOutbox.count({ where: { subjectId: deviceId, type: 'device.paired' } }),
      ).toBe(0);

      await pair(code);

      const paired = await prisma.vaultOutbox.findFirst({
        where: { subjectId: deviceId, type: 'device.paired' },
      });
      expect(paired).toBeTruthy();
      expect(paired!.subjectType).toBe('Device');
      // The actor is the DEVICE. Nobody signed in to type a code into a
      // tablet; who made it possible is on `device.registered`.
      expect((paired!.actor as { principalType: string }).principalType).toBe('device');
      expect(JSON.stringify(paired!.payload)).not.toContain(code);

      // And the row it evidences is really paired.
      const device = await prisma.withPractice(practiceA, (tx) =>
        tx.device.findFirst({ where: { id: deviceId } }),
      );
      expect(device?.pairedAt).toBeTruthy();
      expect(device?.credentialHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('the kiosk routes', () => {
    it('kiosk_routes_require_device_credential', async () => {
      // No credential at all.
      await http().get('/kiosk/waiting-list').expect(401);
      await http().get('/kiosk/me').expect(401);

      /*
       * THE HEADER IS NOT MERELY IGNORED, IT IS REFUSED. This is the exact
       * request that used to work: a practice id in a header, on a public
       * route, returning that practice's waiting room. It is the reason the
       * route could not be deployed anywhere reachable.
       */
      const withHeader = await http()
        .get('/kiosk/waiting-list')
        .set('x-practice-id', practiceA)
        .expect(401);
      expect(JSON.stringify(withHeader.body)).not.toContain('waiting');

      // A credential that is not one, and one that is well-shaped but unknown.
      await http().get('/kiosk/waiting-list').set('x-device-credential', 'nonsense').expect(401);
      await http()
        .get('/kiosk/waiting-list')
        .set(
          'x-device-credential',
          `${Buffer.from(practiceA, 'utf8').toString('base64url')}.${'a'.repeat(64)}`,
        )
        .expect(401);

      // With one, it answers — and the scope is the SERVER's answer, not the
      // caller's: a contradictory header changes nothing.
      const { credential } = await registerAndPair(practiceA, 'Answering tablet');
      const ok = await http()
        .get('/kiosk/waiting-list')
        .set('x-device-credential', credential)
        .set('x-practice-id', practiceB)
        .expect(200);
      expect(ok.body.practiceId).toBe(practiceA);
    });

    it('tells the tablet who it is, and nothing configurable', async () => {
      const { deviceId, credential } = await registerAndPair(practiceA, 'Reception tablet 2');
      const me = await http().get('/kiosk/me').set('x-device-credential', credential).expect(200);
      expect(me.body).toMatchObject({
        deviceId,
        deviceLabel: 'Reception tablet 2',
        practiceId: practiceA,
        practiceName: 'Device Test Practice A',
        reload: false,
      });
      // TYPES, never values (REQ-VER-04) — and there is no Medicare card
      // number among them, non-configurably (hard rule 1).
      expect(me.body.identifierTypes).toEqual(['name', 'date_of_birth', 'address']);
      expect(JSON.stringify(me.body)).not.toMatch(/medicare/i);
    });

    it('records the tablet’s build, and answers reload once the practice moves the floor', async () => {
      const { deviceId, credential } = await registerAndPair(practiceA, 'Rollback tablet');

      await http()
        .get('/kiosk/me')
        .set('x-device-credential', credential)
        .set('x-kiosk-build', '2026.09.03-1')
        .expect(200)
        .expect((res) => expect(res.body.reload).toBe(false));

      signedInAt(practiceA);
      await http()
        .put('/devices/minimum-build')
        .set('x-practice-id', practiceA)
        .send({ build: '2026.09.03-2' })
        .expect(200);
      currentPrincipal = null;

      const stale = await http()
        .get('/kiosk/waiting-list')
        .set('x-device-credential', credential)
        .set('x-kiosk-build', '2026.09.03-1')
        .expect(200);
      expect(stale.body.reload).toBe(true);

      const fresh = await http()
        .get('/kiosk/waiting-list')
        .set('x-device-credential', credential)
        .set('x-kiosk-build', '2026.09.03-2')
        .expect(200);
      expect(fresh.body.reload).toBe(false);
      // The reload flag is INSIDE the fingerprint, so a rolled-back tablet
      // cannot be told 304 and left on the old build.
      expect(fresh.headers.etag).not.toBe(stale.headers.etag);

      /*
       * Support can read the build back without touching the device.
       *
       * POLLED, NOT READ ONCE, and the reason is in the guard: the heartbeat
       * is deliberately fire-and-forget (`void ... .catch()`) so that a slow
       * or failing write can never fail a request for a patient standing at a
       * tablet (REQ-REC-04). A test that read the row the instant the response
       * came back was therefore racing the write it was asserting — it passed
       * most of the time, which is the worst kind of flake.
       */
      const device = await waitFor(async () => {
        const row = await prisma.withPractice(practiceA, (tx) =>
          tx.device.findFirst({ where: { id: deviceId } }),
        );
        return row?.lastKioskBuild === '2026.09.03-2' ? row : null;
      });
      expect(device?.lastKioskBuild).toBe('2026.09.03-2');
      expect(device?.lastSeenAt).toBeTruthy();

      signedInAt(practiceA);
      await http()
        .put('/devices/minimum-build')
        .set('x-practice-id', practiceA)
        .send({ build: null })
        .expect(200);
      currentPrincipal = null;
    });
  });

  describe('revoke and rotate', () => {
    it('revoked_device_gets_401_and_no_data', async () => {
      const { deviceId, credential } = await registerAndPair(practiceA, 'Lost tablet');
      await http().get('/kiosk/waiting-list').set('x-device-credential', credential).expect(200);

      signedInAt(practiceA);
      await http()
        .post(`/devices/${deviceId}/revoke`)
        .set('x-practice-id', practiceA)
        .send({ reason: 'Left in a taxi' })
        .expect(201);
      currentPrincipal = null;

      // THE VERY NEXT REQUEST. Not eventually, not when something expires.
      const refused = await http()
        .get('/kiosk/waiting-list')
        .set('x-device-credential', credential)
        .expect(401);
      expect(JSON.stringify(refused.body)).not.toContain('waiting');
      await http().get('/kiosk/me').set('x-device-credential', credential).expect(401);

      // The credential is GONE rather than flagged: a flag is a thing a future
      // query can forget to check.
      const device = await prisma.withPractice(practiceA, (tx) =>
        tx.device.findFirst({ where: { id: deviceId } }),
      );
      expect(device?.credentialHash).toBeNull();
      expect(device?.revokedAt).toBeTruthy();
      expect(device?.revokedBy).toBeTruthy();

      const event = await prisma.vaultOutbox.findFirst({
        where: { subjectId: deviceId, type: 'device.revoked' },
      });
      expect(event).toBeTruthy();
      expect((event!.actor as { id: string }).id).toBe(ADMIN.sub);
    });

    it('rotate kills the old credential immediately and issues a fresh code', async () => {
      const { deviceId, credential } = await registerAndPair(practiceA, 'Rotating tablet');

      signedInAt(practiceA);
      const rotated = await http()
        .post(`/devices/${deviceId}/rotate`)
        .set('x-practice-id', practiceA)
        .send({})
        .expect(201);
      currentPrincipal = null;

      // The old one stops working NOW, not when somebody gets to the tablet.
      await http().get('/kiosk/waiting-list').set('x-device-credential', credential).expect(401);

      const next = await pair(rotated.body.code);
      expect(next).not.toBe(credential);
      await http().get('/kiosk/waiting-list').set('x-device-credential', next).expect(200);

      // Same device, so its history stays attached to the tablet on the desk —
      // which is what REQ-SIG-02's device fingerprint depends on.
      expect(rotated.body.deviceId).toBe(deviceId);
      expect(
        await prisma.vaultOutbox.count({ where: { subjectId: deviceId, type: 'device.rotated' } }),
      ).toBe(1);
    });

    it('refuses an unattributed revoke or rotate', async () => {
      const { deviceId } = await registerAndPair(practiceA, 'Unattributed tablet');
      await http().post(`/devices/${deviceId}/revoke`).set('x-practice-id', practiceA).send({}).expect(403);
      await http().post(`/devices/${deviceId}/rotate`).set('x-practice-id', practiceA).send({}).expect(403);
    });
  });

  describe('tenancy', () => {
    it('cross_practice_device_access_fails_closed', async () => {
      const mine = await registerAndPair(practiceA, 'Practice A tablet');
      const theirs = await registerAndPair(practiceB, 'Practice B tablet');

      // A's tablet sees A, B's sees B, and neither sees the other's list.
      const a = await http().get('/kiosk/me').set('x-device-credential', mine.credential).expect(200);
      const b = await http().get('/kiosk/me').set('x-device-credential', theirs.credential).expect(200);
      expect(a.body.practiceId).toBe(practiceA);
      expect(b.body.practiceId).toBe(practiceB);
      expect(JSON.stringify(b.body)).not.toContain('Device Test Practice A');

      // B's console cannot see A's devices...
      signedInAt(practiceB);
      const list = await http().get('/devices').set('x-practice-id', practiceB).expect(200);
      expect(list.body.devices.map((d: { id: string }) => d.id)).not.toContain(mine.deviceId);

      // ...and cannot revoke one. RLS filters on the transaction-local scope,
      // so this fails closed as a 404 rather than admitting it exists.
      await http()
        .post(`/devices/${mine.deviceId}/revoke`)
        .set('x-practice-id', practiceB)
        .send({})
        .expect(404);
      currentPrincipal = null;

      // And A's tablet is untouched by the attempt.
      await http().get('/kiosk/waiting-list').set('x-device-credential', mine.credential).expect(200);
    });

    it('a credential whose practice segment was tampered with resolves to nothing', async () => {
      const { credential } = await registerAndPair(practiceA, 'Tampered tablet');
      const secret = credential.slice(credential.indexOf('.') + 1);
      // Re-pointed at practice B. The hash is looked up INSIDE B's scope, so
      // there is nothing to find — the practice segment is routing, and it
      // cannot be used to reach across a boundary.
      const forged = `${Buffer.from(practiceB, 'utf8').toString('base64url')}.${secret}`;
      await http().get('/kiosk/waiting-list').set('x-device-credential', forged).expect(401);
    });
  });
});
