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
import { randomUUID } from 'node:crypto';
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

  /**
   * WHAT THE PRACTICE IS TOLD, both ends of the session. Carl's ask, verbatim:
   * bold the acting-as-id in both the start notice and a new stop notice, and
   * have the stop notice say what changed. Read from `outbound_items` rather
   * than mocking the messaging gateway — every message is queued there
   * regardless of whether delivery succeeds, and this file already prefers
   * reading real state over mocking collaborators.
   */
  describe('what the practice is told, start and stop', () => {
    let notifiedPracticeId: string;

    beforeAll(async () => {
      notifiedPracticeId = randomUUID();
      await prisma.withPractice(notifiedPracticeId, (tx) =>
        tx.practice.create({
          data: {
            id: notifiedPracticeId,
            name: 'Acting-As Notice Test Practice',
            validationState: 'validated',
            adminEmail: 'admin@notice-test.invalid',
            groupEmail: 'reception@notice-test.invalid',
            website: 'https://old.example.invalid',
          },
        }),
      );
    });

    afterAll(async () => {
      await prisma.withPractice(notifiedPracticeId, async (tx) => {
        await tx.outboundItem.deleteMany({ where: { practiceId: notifiedPracticeId } });
        await tx.reviewTask.deleteMany({ where: { practiceId: notifiedPracticeId } });
        // acting_as_sessions is append-only (a database trigger, not merely a
        // convention) — an impersonation record can never be deleted, so this
        // fixture practice's sessions outlive the test on purpose.
        await tx.practice.deleteMany({ where: { id: notifiedPracticeId } });
      });
    });

    function outboundEmails() {
      return prisma.withPractice(notifiedPracticeId, (tx) =>
        tx.outboundItem.findMany({ where: { practiceId: notifiedPracticeId, subjectType: 'ActingAsSession' } }),
      );
    }

    it('bolds the session id in the start notice', async () => {
      currentPrincipal = OPERATOR_A;
      /*
       * `req.principal = currentPrincipal` shares ONE object across every
       * request, and `ActingAsInterceptor` writes `principal.practiceId`
       * onto whatever it is given — so OPERATOR_A carries the practiceId
       * from every session it has opened earlier in this file, permanently.
       * The interceptor's own guard is "a principal that already has a
       * practiceId is a practice user, not somebody acting for one" — true
       * for a real token, false here, where it is leftover mutation. Cleared
       * so the acting-as wrapping (and the vault tagging this test depends
       * on) actually engages for the request below, the way it would for an
       * operator's genuinely first session.
       */
      delete (currentPrincipal as Record<string, unknown>).practiceId;
      const started = await api()
        .post('/acting-as/start')
        .send({ practiceId: notifiedPracticeId, reason: 'no_admin_access' })
        .expect(201);
      const sessionId = started.body.id as string;

      const [item] = await outboundEmails();
      const html = (item.payload as { html: string }).html;
      expect(html).toContain(`<strong>${sessionId}</strong>`);

      // Made a real change while acting-as, so the stop notice below has
      // something genuine to report.
      await api()
        .patch(`/organisations/${notifiedPracticeId}`)
        .send({ website: 'https://new.example.invalid', reason: 'Testing the acting-as stop notice.' })
        .expect(200);

      await api().post('/acting-as/end').send({}).expect(201);
    });

    it('tells the practice the session stopped, what changed, and bolds the id again', async () => {
      const items = await outboundEmails();
      const stopped = items.find((i) => (i.payload as { subject: string }).subject.includes('finished acting'));
      expect(stopped).toBeTruthy();

      const { html, body } = stopped!.payload as { html: string; body: string; subject: string };
      // The id, set apart in the HTML part...
      expect(html).toMatch(/<strong>[0-9a-f-]{36}<\/strong>/);
      // ...and named as such in the text part, since plain text has no bold.
      expect(body).toMatch(/Session reference:/);
      // The session's own start/end are not reported as "changes" — only the
      // amendment made while it was open is.
      expect(body).toMatch(/contact detail was changed/i);
      expect(body).not.toMatch(/acting_as/i);
    });
  });
});
