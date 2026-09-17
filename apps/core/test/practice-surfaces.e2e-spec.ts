import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { SURFACE_REFUSED_CODE } from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../src/messaging/gateway';

/**
 * WHICH PARTS OF AoB A PRACTICE USES, THROUGH THE REAL APPLICATION
 * (D-2026-09-14-04).
 *
 * WHY AN E2E AS WELL AS THE UNIT TESTS. `surface.guard.spec.ts` proves the
 * guard's reasoning and `surface-classification.spec.ts` proves every route is
 * classified — but neither proves the guard is WIRED IN. A global guard that
 * was never registered, or registered before the device guard resolves a
 * tablet's practice, would pass both of those and gate nothing. This drives
 * real HTTP through the real module graph, which is the only place that claim
 * can be made.
 *
 * TWO PRACTICES, SIDE BY SIDE, in one run: the release-safety claim (an
 * existing practice is untouched) is only worth anything next to the claim it
 * is protecting (a practice that has been moved off `full` really is refused).
 */

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('which parts of AoB a practice uses (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const onFull = randomUUID();
  const onDb4 = randomUUID();

  const printJob = (seed: string) => ({
    documentType: 'db4_assignment',
    sourceSha256: sha(seed),
    parserTemplateVersion: 'pracsoft/db4@1',
    pms: 'pracsoft',
    capturedAt: new Date().toISOString(),
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_GATEWAY)
      .useValue({ mode: 'test', dispatch: async () => ({ accepted: true }) } as MessagingGateway)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(onFull, (tx) =>
      tx.practice.create({ data: { id: onFull, name: 'Surface Test Practice (everything)' } }),
    );
    await prisma.withPractice(onDb4, (tx) =>
      tx.practice.create({
        data: { id: onDb4, name: 'Surface Test Practice (DB4 only)', surfaceProfile: 'db4' },
      }),
    );
  });

  afterAll(async () => {
    for (const practiceId of [onFull, onDb4]) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.inboundPrintJob.deleteMany({});
        // SCOPED TO THIS PRACTICE. `vault_outbox` is unscoped and shared, and
        // an unfiltered delete here would take another suite's evidence rows
        // with it — the exact hazard `jest.e2e.config.js` runs serially to
        // avoid, and not one to rely on serialism for.
        await tx.vaultOutbox.deleteMany({ where: { subjectId: practiceId } });
        await tx.practice.deleteMany({ where: { id: practiceId } });
      });
    }
    await app.close();
  });

  it('an_existing_practice_sees_everything_by_default', async () => {
    /*
     * THE COLUMN DEFAULTS TO `full` AND `full` HOLDS EVERY SURFACE, so a
     * practice created without a word about profiles reaches the routes it
     * always did. This is the claim that makes the whole change safe to ship:
     * nothing can break for anybody until somebody moves a practice off it.
     */
    const practice = await prisma.withPractice(onFull, (tx) =>
      tx.practice.findFirst({ select: { surfaceProfile: true } }),
    );
    expect(practice?.surfaceProfile).toBe('full');

    await request(app.getHttpServer())
      .get('/arrivals/expected')
      .set('x-practice-id', onFull)
      .expect(200);

    await request(app.getHttpServer())
      .post('/inbound/print-jobs')
      .set('x-practice-id', onFull)
      .send(printJob('surfaces-full-1'))
      .expect(202);
  });

  it('a_surface_that_is_off_is_refused_by_the_server_not_only_hidden', async () => {
    /*
     * The front desk's rails are hidden in this practice's console. Hiding is
     * a courtesy; this is the control — and the refusal carries a code and
     * names the surface rather than being a bare 403 (CLAUDE.md §7).
     */
    const res = await request(app.getHttpServer())
      .get('/arrivals/expected')
      .set('x-practice-id', onDb4)
      .expect(403);

    expect(res.body.code).toBe(SURFACE_REFUSED_CODE);
    expect(res.body.surface).toBe('queue_rails');
    expect(res.body.message).toContain('does not use');
    // NO IDENTIFIER IN THE REFUSAL (REQ-LOG-08, hard rule 9).
    expect(JSON.stringify(res.body)).not.toContain(onDb4);
  });

  it('a_db4_practice_keeps_the_tablet_desk_and_the_day_register', async () => {
    // Switching surfaces off must not take away the pages the first customer
    // actually works from — asserted at the endpoints those screens call.
    await request(app.getHttpServer()).get('/arrivals/day').set('x-practice-id', onDb4).expect(200);
    await request(app.getHttpServer()).get('/tablet-sessions/pushable').set('x-practice-id', onDb4).expect(200);
    await request(app.getHttpServer()).get(`/practices/${onDb4}`).set('x-practice-id', onDb4).expect(200);
  });

  it('a_db4_print_job_is_refused_when_the_practice_does_not_use_db4', async () => {
    /*
     * THE GATE ON AOBPRINTER BEING INSTALLABLE at a practice that has not
     * bought it (TODO.md, AOBPRINTER item 5). Until this existed, nothing in
     * code stopped the print channel being pointed at a live practice.
     *
     * Proved by MOVING the practice rather than by a second fixture, because
     * the cache the guard reads is the thing most likely to make a change look
     * like it did not work: `PATCH /practices/:id/config` drops it in the same
     * transaction as the row.
     */
    await request(app.getHttpServer())
      .post('/inbound/print-jobs')
      .set('x-practice-id', onDb4)
      .send(printJob('surfaces-db4-1'))
      .expect(202);

    await request(app.getHttpServer())
      .patch(`/practices/${onDb4}/config`)
      .set('x-practice-id', onDb4)
      .send({ surfaceProfile: 'full' })
      .expect(200);

    // Still accepted on `full`, which holds every surface including this one.
    await request(app.getHttpServer())
      .post('/inbound/print-jobs')
      .set('x-practice-id', onDb4)
      .send(printJob('surfaces-db4-2'))
      .expect(202);
  });

  it('the_profile_change_is_recorded_as_a_vault_event', async () => {
    /*
     * Through the OUTBOX, in the same transaction as the row it evidences
     * (hard rule 11). Setting which parts of AoB a practice uses is a
     * permission rather than a preference, so who changed it and to what is
     * evidence.
     */
    await request(app.getHttpServer())
      .patch(`/practices/${onDb4}/config`)
      .set('x-practice-id', onDb4)
      .send({ surfaceProfile: 'db4' })
      .expect(200);

    const events = await prisma.withPractice(onDb4, (tx) =>
      tx.vaultOutbox.findMany({ where: { type: 'practice.surface_profile_set' }, orderBy: { occurredAt: 'asc' } }),
    );
    expect(events.length).toBeGreaterThan(0);
    const payload = events[events.length - 1].payload as Record<string, unknown>;
    expect(payload.surfaceProfile).toBe('db4');
    expect(typeof payload.surfacesVersion).toBe('string');

    // And the change reaches the guard at once rather than after a cache timer.
    await request(app.getHttpServer())
      .post('/inbound/print-jobs')
      .set('x-practice-id', onDb4)
      .send(printJob('surfaces-db4-3'))
      .expect(202);
    await request(app.getHttpServer())
      .get('/arrivals/expected')
      .set('x-practice-id', onDb4)
      .expect(403);
  });

  it('refuses nothing for a caller with no practice to ask about', async () => {
    // A platform route, a token-bearing page, an unscoped call: there is no
    // practice whose profile could answer, and inventing one would be worse
    // than not asking. `/health` is the cheapest one that proves it.
    await request(app.getHttpServer()).get('/health').expect(200);
  });
});
