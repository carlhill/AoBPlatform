import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS,
  KIOSK_IDLE_TIMEOUT_MAX_SECONDS,
  KIOSK_IDLE_TIMEOUT_MIN_SECONDS,
} from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * RETURN TO THE START WHEN THE TABLET IS UNTOUCHED — the server half
 * (Carl, 4 September 2026).
 *
 * The tablet's own behaviour is tested in `apps/web`; what has to be true HERE
 * is that the number the tablet counts down is the PRACTICE'S, that it reaches
 * the device on the call the device already makes, and that nobody can set it
 * to something that would make the kiosk unusable in either direction.
 *
 * WHY THE BOUNDS ARE A TEST AND NOT A COMMENT. Below a minute the screen
 * resets under somebody who is still reading, so the ceremony can never be
 * completed at that tablet — which is hard rule 8 broken by a settings field
 * (REQ-REC-04, the platform never blocks care). Above half an hour the tablet
 * is not "between patients", it is left out on a counter with somebody's name,
 * date of birth and address on it, which is the disclosure the whole feature
 * exists to close. Both ends are refused by the DTO, not merely by the input's
 * `min` and `max`.
 */

/** The practice administrator saving the settings page. Null = nobody signed in. */
const ADMIN = {
  sub: '00000000-0000-4000-8000-00000000dev9',
  principalType: 'staff',
  roles: [],
  preferredUsername: 'robin.admin',
  raw: {},
};
let currentPrincipal: Record<string, unknown> | null = null;

describe('the kiosk inactivity reset (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const practiceId = randomUUID();

  const http = () => request(app.getHttpServer());

  /** Register a tablet as the signed-in administrator, then pair it as the tablet does. */
  async function pairATablet(label: string): Promise<string> {
    currentPrincipal = { ...ADMIN, practiceId };
    const registered = await http()
      .post('/devices')
      .set('x-practice-id', practiceId)
      .send({ label })
      .expect(201);
    currentPrincipal = null;
    const paired = await http().post('/devices/pair').send({ code: registered.body.code }).expect(201);
    return paired.body.credential as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // The same seam every other suite uses: middleware runs before the guards
    // and cannot be forged by a client.
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      if (currentPrincipal) req.principal = currentPrincipal;
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceId, (tx) =>
      tx.practice.create({ data: { id: practiceId, name: 'Idle Timeout Test Practice' } }),
    );
  });

  afterAll(async () => {
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.device.deleteMany({});
      await tx.practice.deleteMany({});
    });
    await prisma.vaultOutbox.deleteMany({});
    currentPrincipal = null;
    await app.close();
  });

  it('kiosk_me_carries_the_practice_idle_timeout', async () => {
    const credential = await pairATablet('Idle timeout tablet');

    /*
     * THE DEFAULT ARRIVES WITHOUT ANYBODY SETTING IT. A practice that has
     * never opened the settings page still has a tablet that clears itself —
     * "no setting" must never mean "no timeout".
     */
    const before = await http().get('/kiosk/me').set('x-device-credential', credential).expect(200);
    expect(before.body.kioskIdleTimeoutSeconds).toBe(KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS);

    currentPrincipal = { ...ADMIN, practiceId };
    const saved = await http()
      .patch(`/practices/${practiceId}/config`)
      .set('x-practice-id', practiceId)
      .send({ kioskIdleTimeoutSeconds: 120 })
      .expect(200);
    currentPrincipal = null;
    expect(saved.body.kioskIdleTimeoutSeconds).toBe(120);

    /*
     * AND IT REACHES THE TABLET ON THE CALL IT ALREADY MAKES. No re-pairing, no
     * reload, no settings endpoint of its own — a device with settings of its
     * own is a device somebody can configure at the tablet.
     */
    const after = await http().get('/kiosk/me').set('x-device-credential', credential).expect(200);
    expect(after.body.kioskIdleTimeoutSeconds).toBe(120);

    /*
     * THE CHANGE IS EVIDENCED, through the outbox, in the same transaction as
     * the row (hard rule 11). The payload carries the new value and the old
     * one — seconds are not PII, and "somebody changed it" without "to what"
     * is not evidence of anything.
     */
    const events = await prisma.vaultOutbox.findMany({
      where: { subjectId: practiceId, type: 'practice.kiosk_idle_timeout_set' },
    });
    expect(events).toHaveLength(1);
    const payload = events[0].payload as Record<string, unknown>;
    expect(payload.kioskIdleTimeoutSeconds).toBe(120);
    expect(payload.previousSeconds).toBe(KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS);
    // No patient anywhere in it, and no identifier value (REQ-LOG-08, rule 9).
    expect(JSON.stringify(payload)).not.toMatch(/medicare|date_of_birth|\$\s?\d/i);

    /*
     * SAVING THE SAME NUMBER AGAIN WRITES NOTHING. This is a whole-form save
     * and the console posts every field on every press; an event per save
     * would make the trail say "somebody changed the timeout" on the morning
     * somebody ticked the sender-ID box.
     */
    currentPrincipal = { ...ADMIN, practiceId };
    await http()
      .patch(`/practices/${practiceId}/config`)
      .set('x-practice-id', practiceId)
      .send({ kioskIdleTimeoutSeconds: 120, linkExpiryHours: 24 })
      .expect(200);
    currentPrincipal = null;
    const again = await prisma.vaultOutbox.findMany({
      where: { subjectId: practiceId, type: 'practice.kiosk_idle_timeout_set' },
    });
    expect(again).toHaveLength(1);
  });

  /**
   * WHICH AGREEMENT THE PRE-STEP OFFERS FIRST (Carl, 4 Sep 2026; GA-PLAN B6).
   * The same surface, the same whole-form save, and the same treatment of a
   * setting that changes what patients are asked: evidenced when it moves,
   * silent when it does not.
   */
  it('enduring_by_default_is_a_practice_setting_and_its_change_is_evidenced', async () => {
    /*
     * TRUE WITHOUT ANYBODY SETTING IT. For a GP practice the strongest answer
     * at the desk is an ongoing agreement -- sign once, nothing post-service
     * ever -- so that is the default. It is a DEFAULT rather than a
     * permission: enduring stays GP-only and per practitioner x patient
     * however this is set (hard rule 6, REQ-END-01/-01a).
     */
    const before = await http().get(`/practices/${practiceId}`).set('x-practice-id', practiceId).expect(200);
    expect(before.body.enduringByDefault).toBe(true);

    currentPrincipal = { ...ADMIN, practiceId };
    const saved = await http()
      .patch(`/practices/${practiceId}/config`)
      .set('x-practice-id', practiceId)
      .send({ enduringByDefault: false })
      .expect(200);
    expect(saved.body.enduringByDefault).toBe(false);

    const events = await prisma.vaultOutbox.findMany({
      where: { subjectId: practiceId, type: 'practice.enduring_by_default_set' },
    });
    expect(events).toHaveLength(1);
    const payload = events[0].payload as Record<string, unknown>;
    expect(payload.enduringByDefault).toBe(false);
    expect(payload.previous).toBe(true);
    // A boolean and a name. No patient, no identifier value, no amount.
    expect(JSON.stringify(payload)).not.toMatch(/medicare|date_of_birth|\$\s?\d/i);

    // SAVING THE SAME ANSWER AGAIN WRITES NOTHING -- a whole-form save must
    // not make the trail say somebody changed this on the morning they
    // changed something else.
    await http()
      .patch(`/practices/${practiceId}/config`)
      .set('x-practice-id', practiceId)
      .send({ enduringByDefault: false, linkExpiryHours: 24 })
      .expect(200);
    currentPrincipal = null;
    const again = await prisma.vaultOutbox.findMany({
      where: { subjectId: practiceId, type: 'practice.enduring_by_default_set' },
    });
    expect(again).toHaveLength(1);
  });

  it('idle_timeout_is_bounded', async () => {
    currentPrincipal = { ...ADMIN, practiceId };
    for (const refused of [0, 1, 30, KIOSK_IDLE_TIMEOUT_MIN_SECONDS - 1, KIOSK_IDLE_TIMEOUT_MAX_SECONDS + 1, 86_400]) {
      await http()
        .patch(`/practices/${practiceId}/config`)
        .set('x-practice-id', practiceId)
        .send({ kioskIdleTimeoutSeconds: refused })
        .expect(400);
    }
    // Not a whole number of seconds is not a setting either.
    await http()
      .patch(`/practices/${practiceId}/config`)
      .set('x-practice-id', practiceId)
      .send({ kioskIdleTimeoutSeconds: 90.5 })
      .expect(400);

    // Both ends of the range are legitimate, and are accepted.
    for (const accepted of [KIOSK_IDLE_TIMEOUT_MIN_SECONDS, KIOSK_IDLE_TIMEOUT_MAX_SECONDS]) {
      const res = await http()
        .patch(`/practices/${practiceId}/config`)
        .set('x-practice-id', practiceId)
        .send({ kioskIdleTimeoutSeconds: accepted })
        .expect(200);
      expect(res.body.kioskIdleTimeoutSeconds).toBe(accepted);
    }
    currentPrincipal = null;
  });
});
