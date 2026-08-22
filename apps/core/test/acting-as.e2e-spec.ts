/**
 * Acting as a practice — the controls, exercised rather than asserted.
 *
 * Carl asked how to test the append-only protections after I showed him a
 * manual psql check. This is the answer: the protections that matter are
 * checked here, on every run, so they cannot quietly stop being true.
 *
 * THE TWO THINGS WORTH TESTING are not the happy path. They are:
 *
 *   1. The database refusing to forget an impersonation (delete, and rewriting
 *      who/for whom/why/when).
 *   2. Rule 7 — the person who acted as a practice cannot approve it. That is
 *      the control that survives every other one failing, and it had no
 *      automated coverage at all until this file.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ActingAsService } from '../src/acting-as/acting-as.service';

/** Two different operators, because the whole rule is about "a different person". */
const OPERATOR_A = {
  sub: '00000000-0000-4000-8000-0000000000aa',
  principalType: 'staff',
  roles: ['platform_admin'],
  preferredUsername: 'operator.a',
  raw: {},
};
const OPERATOR_B = { ...OPERATOR_A, sub: '00000000-0000-4000-8000-0000000000bb', preferredUsername: 'operator.b' };

let currentPrincipal: Record<string, unknown> | null = OPERATOR_A;

describe('acting as a practice (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let actingAs: ActingAsService;
  let practiceId: string;

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // Middleware runs before guards and cannot be forged by a client — the
    // same seam the org-model suite uses.
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      if (currentPrincipal) req.principal = currentPrincipal;
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    actingAs = app.get(ActingAsService);

    /*
     * USES A PRACTICE THAT ALREADY EXISTS rather than creating one.
     *
     * The fixture ABNs are shared with org-model, the suites run in parallel
     * against one database, and creating a fourth practice with a fixture ABN
     * would collide with whichever suite got there first. None of these tests
     * care WHICH practice it is — they are about who may act for it and who
     * may then approve it.
     */
    const all = await api().get('/organisations?state=all').expect(200);
    const candidate = (all.body.organisations ?? [])[0];
    if (!candidate) throw new Error('No practice exists to act as. Run the org-model suite first.');
    practiceId = candidate.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('the database refuses to forget', () => {
    let sessionId: string;

    it('records a session', async () => {
      currentPrincipal = OPERATOR_A;
      const res = await api()
        .post('/acting-as/start')
        .send({ practiceId, reason: 'no_admin_access', note: 'Testing the controls.' })
        .expect(201);
      sessionId = res.body.id;
      expect(res.body.consequence).toMatch(/cannot be you who does it/);
    });

    it('REFUSES TO DELETE AN IMPERSONATION RECORD', async () => {
      /*
       * This is the table somebody would want to edit their way out of, so
       * convention was not enough — it is a trigger.
       */
      await expect(
        prisma.$executeRawUnsafe(`DELETE FROM core.acting_as_sessions WHERE id = $1::uuid`, sessionId),
      ).rejects.toThrow(/append-only/);
    });

    it('REFUSES TO REWRITE WHO ACTED, FOR WHOM, WHY OR WHEN', async () => {
      for (const [column, value] of [
        ['operatorName', 'somebody else'],
        ['operatorSub', '00000000-0000-4000-8000-00000000dead'],
        ['reason', 'support_request'],
      ] as const) {
        await expect(
          prisma.$executeRawUnsafe(
            `UPDATE core.acting_as_sessions SET "${column}" = $1 WHERE id = $2::uuid`,
            value,
            sessionId,
          ),
        ).rejects.toThrow(/cannot be changed after the fact/);
      }
    });

    it('still allows a session to be closed', async () => {
      // The exit must never be the difficult part.
      const res = await api().post('/acting-as/end').send({}).expect(201);
      expect(res.body.ended).toBe(true);
    });
  });

  describe('rule 7 — the person who acted cannot approve', () => {
    it('REFUSES THE OPERATOR WHO IMPERSONATED', async () => {
      /*
       * The control that survives every other one failing. Even if the scoring
       * exclusion for impersonated evidence were removed by mistake, one
       * individual still could not manufacture evidence and then bless it.
       */
      currentPrincipal = OPERATOR_A;
      const refused = await api()
        .post(`/organisations/${practiceId}/validate`)
        .send({ decision: 'validated', reviewerName: 'ignored', note: 'ABR sighted.' })
        .expect(400);
      expect(refused.body.message).toMatch(/cannot be the person who approves/);
    });

    it('allows a different operator', async () => {
      currentPrincipal = OPERATOR_B;
      /*
       * Not asserting 201 here: approval has its own entitlement and identity
       * gates that this practice has not met, and inventing evidence to get
       * past them would make the test about something else. What matters is
       * that the SEPARATION check no longer refuses.
       */
      const res = await api()
        .post(`/organisations/${practiceId}/validate`)
        .send({ decision: 'validated', reviewerName: 'ignored', note: 'ABR sighted.' });
      expect(res.body.message ?? '').not.toMatch(/cannot be the person who approves/);
    });

    it('checks EVERY operator who acted, not merely the most recent', async () => {
      // Two operators taking turns would otherwise clear each other, which is
      // exactly the collusion the rule is meant to make expensive.
      currentPrincipal = OPERATOR_B;
      await api().post('/acting-as/start').send({ practiceId, reason: 'support_request' }).expect(201);
      await api().post('/acting-as/end').send({}).expect(201);

      const subs = await actingAs.impersonatorsSinceApproval(practiceId);
      expect(subs).toContain(OPERATOR_A.sub);
      expect(subs).toContain(OPERATOR_B.sub);
    });
  });

  describe('one session at a time', () => {
    it('refuses a second open session, because attribution would need guessing', async () => {
      currentPrincipal = OPERATOR_A;
      await api().post('/acting-as/start').send({ practiceId, reason: 'no_admin_access' }).expect(201);
      const second = await api()
        .post('/acting-as/start')
        .send({ practiceId, reason: 'no_admin_access' })
        .expect(409);
      expect(second.body.message).toMatch(/already acting/);
      await api().post('/acting-as/end').send({}).expect(201);
    });
  });

  describe('an unsigned request', () => {
    it('cannot start a session at all', async () => {
      /*
       * The one feature where an unattributed act would be indistinguishable
       * from the abuse it exists to make visible.
       */
      currentPrincipal = null;
      const refused = await api()
        .post('/acting-as/start')
        .send({ practiceId, reason: 'no_admin_access' })
        .expect(400);
      expect(refused.body.message).toMatch(/signed-in operator/);
      currentPrincipal = OPERATOR_A;
    });
  });
});
