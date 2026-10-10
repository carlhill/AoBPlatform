import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  SERVICE_DESCRIPTIONS,
  UNSIGNED_DRAFT_CLOSURE_VERSION,
  addCalendarDays,
  practiceDayWindow,
  practiceToday,
} from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { UnsignedDraftClosureSweep } from '../src/unsigned-drafts/unsigned-draft-closure.sweep';
import { createServicingProvider, deleteSeededAnchors, type SeededAnchor } from './anchor';

/**
 * UNSIGNED AGREEMENTS WITH NO SERVICE ARE CLOSED AFTER N DAYS
 * (D-2026-10-10-09, option 3; Carl: "N is 7 days - make N a configurable
 * setting").
 *
 * WHAT THIS SUITE PINS:
 *  - a draft closes on day N, not day N-1, as `expired` with the reason, the
 *    content version and the N applied, and two vault events;
 *  - a practice's own N overrides the default, and setting it is bounded,
 *    evidenced and reversible to the default;
 *  - nothing that could still be claimed is closed: signed, linked,
 *    associated, matched by a service, superseded, on a tablet, a live remote
 *    link, on legal hold, younger than N;
 *  - a rerun closes nothing twice;
 *  - one practice's sweep never touches another's drafts;
 *  - the practice-local day decides, across the daylight-saving change;
 *  - a closed draft drops off the tablet's "Unsigned from earlier days".
 *
 * THE CLOCK IS A PARAMETER (wow.md §2 item 6): every sweep is run at a
 * pinned instant, and every draft's creation time is pinned to a day.
 */

const MANAGER = {
  sub: '00000000-0000-4000-8000-0000000c1051',
  principalType: 'staff',
  roles: [],
  preferredUsername: 'mai.manager',
  raw: {},
};
let currentPrincipal: Record<string, unknown> | null = null;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const dayAgo = (n: number) => practiceToday(new Date(Date.now() - n * DAY_MS));
/** An instant at `hour` o'clock, practice-local, on `day`. */
const at = (day: string, hour = 12) => new Date(practiceDayWindow(day).from.getTime() + hour * HOUR_MS);

interface Fixture {
  practiceId: string;
  anchor: SeededAnchor;
  patientId: string;
  assignorId: string;
}

describe('unsigned draft closure after N days (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sweep: UnsignedDraftClosureSweep;
  const practices: string[] = [];

  async function practice(closureDays: number | null = null): Promise<Fixture> {
    const practiceId = randomUUID();
    practices.push(practiceId);
    return prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({
        data: { id: practiceId, name: 'Closure Practice', unsignedDraftClosureDays: closureDays },
      });
      const anchor = await createServicingProvider(tx, practiceId, { name: 'Dr Example Provider' });
      const patient = await tx.patient.create({
        data: { practiceId, familyName: 'Sampleton', givenNames: 'Robin', dateOfBirth: new Date('1970-01-01') },
      });
      const assignor = await tx.assignor.create({
        data: { practiceId, name: 'Robin Sampleton', authorityBasis: 'self', dateOfBirth: new Date('1970-01-01') },
      });
      return { practiceId, anchor, patientId: patient.id, assignorId: assignor.id };
    });
  }

  async function draft(
    f: Fixture,
    createdAt: Date,
    over: { status?: string; signatureEventId?: string; supersedesAgreementId?: string; legalHold?: boolean } = {},
  ): Promise<string> {
    return prisma.withPractice(f.practiceId, async (tx) => {
      const row = await tx.agreement.create({
        data: {
          practiceId: f.practiceId,
          type: 'episodic_pre',
          anchorKind: 'provider',
          affiliationId: f.anchor.id,
          patientId: f.patientId,
          assignorId: f.assignorId,
          assignorIsPatient: true,
          status: over.status ?? 'draft',
          signatureEventId: over.signatureEventId ?? null,
          supersedesAgreementId: over.supersedesAgreementId ?? null,
          legalHold: over.legalHold ?? false,
          serviceDescription: SERVICE_DESCRIPTIONS[0],
          createdAt,
        },
      });
      return row.id;
    });
  }

  const agreement = (f: Fixture, id: string) =>
    prisma.withPractice(f.practiceId, (tx) => tx.agreement.findFirstOrThrow({ where: { id } }));
  const closureEvents = (id: string) =>
    prisma.vaultOutbox.findMany({ where: { subjectId: id, type: 'agreement.closed_unsigned' } });

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
    sweep = app.get(UnsignedDraftClosureSweep);
  });

  afterEach(() => {
    currentPrincipal = null;
  });

  afterAll(async () => {
    for (const practiceId of practices) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.tabletSession.deleteMany({});
        await tx.captureRequest.deleteMany({});
        await tx.preAgreementAssociation.deleteMany({});
        await tx.serviceRecord.deleteMany({});
        await tx.agreement.deleteMany({});
        await tx.assignor.deleteMany({});
        await tx.patient.deleteMany({});
        await tx.provider.deleteMany({});
        await deleteSeededAnchors(tx);
        await tx.practice.deleteMany({});
      });
    }
    await prisma.vaultOutbox.deleteMany({
      where: {
        type: { in: ['agreement.closed_unsigned', 'practice.unsigned_draft_closure_days_set'] },
      },
    });
    await app?.close();
  });

  it('closes_at_n_days_not_n_minus_one_and_records_the_version_and_n', async () => {
    const f = await practice();
    const day = dayAgo(30);
    const id = await draft(f, at(day));

    expect((await sweep.closeForPractice(f.practiceId, at(addCalendarDays(day, 6)))).closed).toBe(0);
    expect((await agreement(f, id)).status).toBe('draft');

    const closeAt = at(addCalendarDays(day, 7), 9);
    expect((await sweep.closeForPractice(f.practiceId, closeAt)).closed).toBe(1);
    expect(await agreement(f, id)).toMatchObject({
      status: 'expired',
      closedReason: 'no_service_recorded',
      closureRuleVersion: UNSIGNED_DRAFT_CLOSURE_VERSION,
      closureDays: 7,
      closureDaysSource: 'content_default',
      closedAt: closeAt,
    });

    const events = await closureEvents(id);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      reason: 'no_service_recorded',
      ruleVersion: UNSIGNED_DRAFT_CLOSURE_VERSION,
      closureDays: 7,
      closureDaysSource: 'content_default',
      forDay: day,
      closedOn: addCalendarDays(day, 7),
    });
    expect(JSON.stringify(events[0]!.payload)).not.toContain('Sampleton');
    const statusEvents = await prisma.vaultOutbox.findMany({ where: { subjectId: id, type: 'agreement.status_changed' } });
    expect(statusEvents.map((e) => e.payload)).toContainEqual(expect.objectContaining({ from: 'draft', to: 'expired' }));
  });

  it('a_practice_value_overrides_the_default_and_setting_it_is_bounded_and_evidenced', async () => {
    const f = await practice();
    const patch = (body: Record<string, unknown>) =>
      request(app.getHttpServer()).patch(`/practices/${f.practiceId}/config`).set('x-practice-id', f.practiceId).send(body);
    currentPrincipal = { ...MANAGER, practiceId: f.practiceId };

    await patch({ unsignedDraftClosureDays: 0 }).expect(400);
    await patch({ unsignedDraftClosureDays: 91 }).expect(400);
    await patch({ unsignedDraftClosureDays: 2.5 }).expect(400);
    await patch({ unsignedDraftClosureDays: 3 }).expect(200);

    const set = await prisma.vaultOutbox.findMany({
      where: { subjectId: f.practiceId, type: 'practice.unsigned_draft_closure_days_set' },
    });
    expect(set).toHaveLength(1);
    expect(set[0]!.payload).toMatchObject({ unsignedDraftClosureDays: 3, previous: 'content_default', contentVersion: UNSIGNED_DRAFT_CLOSURE_VERSION });
    // The same value again is not a change, and is not evidenced as one.
    await patch({ unsignedDraftClosureDays: 3 }).expect(200);
    expect(
      await prisma.vaultOutbox.count({ where: { subjectId: f.practiceId, type: 'practice.unsigned_draft_closure_days_set' } }),
    ).toBe(1);

    const day = dayAgo(30);
    const id = await draft(f, at(day));
    expect((await sweep.closeForPractice(f.practiceId, at(addCalendarDays(day, 2)))).closed).toBe(0);
    expect((await sweep.closeForPractice(f.practiceId, at(addCalendarDays(day, 3)))).closed).toBe(1);
    expect(await agreement(f, id)).toMatchObject({ status: 'expired', closureDays: 3, closureDaysSource: 'practice' });

    // Back to the default: NULL, evidenced as the default.
    await patch({ unsignedDraftClosureDays: null }).expect(200);
    const practiceRow = await prisma.withPractice(f.practiceId, (tx) => tx.practice.findFirstOrThrow({}));
    expect(practiceRow.unsignedDraftClosureDays).toBeNull();
    const last = await prisma.vaultOutbox.findMany({
      where: { subjectId: f.practiceId, type: 'practice.unsigned_draft_closure_days_set' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(last[0]!.payload).toMatchObject({ unsignedDraftClosureDays: 'content_default', previous: 3 });
  });

  it('never_closes_signed_linked_associated_matched_superseded_on_tablet_live_link_held_or_young', async () => {
    const f = await practice();
    const day = dayAgo(30);
    const old = at(day);
    const sweepAt = at(addCalendarDays(day, 20));

    const signed = await draft(f, old, { status: 'signed', signatureEventId: randomUUID() });
    const linked = await draft(f, old);
    const associated = await draft(f, at(dayAgo(29)));
    const matched = await draft(f, at(dayAgo(28)));
    const replaced = await draft(f, at(dayAgo(27)));
    await draft(f, at(dayAgo(27), 13), { supersedesAgreementId: replaced, status: 'expired' });
    const onTablet = await draft(f, at(dayAgo(26)));
    const liveLink = await draft(f, at(dayAgo(25)));
    const held = await draft(f, at(dayAgo(24)), { legalHold: true });
    const young = await draft(f, at(addCalendarDays(day, 15)));

    await prisma.withPractice(f.practiceId, async (tx) => {
      const service = (serviceDay: string, agreementId: string | null) =>
        tx.serviceRecord.create({
          data: {
            practiceId: f.practiceId,
            pmsInvoiceKey: `closure-${randomUUID()}`,
            patientId: f.patientId,
            providerId: f.anchor.providerId,
            serviceDate: new Date(`${serviceDay}T00:00:00Z`),
            mbsItemNumbers: ['23'],
            agreementId,
          },
        });
      await service(day, linked);
      const forAssociation = await service(dayAgo(29), null);
      await tx.preAgreementAssociation.create({
        data: { practiceId: f.practiceId, agreementId: associated, serviceRecordId: forAssociation.id, how: 'automatic', candidateCount: 1 },
      });
      // A service for the visit that nothing is linked or associated to: a service WAS recorded.
      await service(dayAgo(28), null);
      await tx.tabletSession.create({
        data: { practiceId: f.practiceId, deviceId: randomUUID(), agreementId: onTablet, pushedBy: 'Mai', pushedById: MANAGER.sub },
      });
      await tx.captureRequest.create({
        data: {
          practiceId: f.practiceId,
          agreementId: liveLink,
          channel: 'sms_link',
          tokenHash: `closure-${randomUUID()}`,
          expiresAt: new Date(sweepAt.getTime() + DAY_MS),
        },
      });
    });

    const result = await sweep.closeForPractice(f.practiceId, sweepAt);
    expect(result.closed).toBe(0);
    expect(result.skipped).toMatchObject({
      linked: 1,
      associated: 1,
      service_matches_visit: 1,
      superseded: 1,
      on_tablet: 1,
      live_remote_link: 1,
    });
    for (const id of [linked, associated, matched, replaced, onTablet, liveLink, held, young]) {
      expect((await agreement(f, id)).status).toBe('draft');
    }
    expect((await agreement(f, signed)).status).toBe('signed');
  });

  it('a_rerun_closes_nothing_twice', async () => {
    const f = await practice();
    const day = dayAgo(30);
    const id = await draft(f, at(day));
    const when = at(addCalendarDays(day, 8));

    expect((await sweep.closeForPractice(f.practiceId, when)).closed).toBe(1);
    expect((await sweep.closeForPractice(f.practiceId, when)).closed).toBe(0);
    await sweep.run(when);
    expect(await closureEvents(id)).toHaveLength(1);
  });

  it('cross_practice_closure_touches_only_its_own_practice', async () => {
    const mine = await practice();
    const theirs = await practice(30);
    const day = dayAgo(30);
    const myDraft = await draft(mine, at(day));
    const theirDraft = await draft(theirs, at(day));
    const when = at(addCalendarDays(day, 10));

    expect((await sweep.closeForPractice(mine.practiceId, when)).closed).toBe(1);
    expect((await agreement(theirs, theirDraft)).status).toBe('draft');

    // The platform-wide run applies each practice's own N: 30 days has not passed for theirs.
    await sweep.run(when);
    expect((await agreement(mine, myDraft)).status).toBe('expired');
    expect((await agreement(theirs, theirDraft)).status).toBe('draft');
  });

  it('local_day_boundary_across_the_daylight_saving_change', async () => {
    const f = await practice();
    // 23:30 on Saturday 3 October 2026 in Sydney (AEST, +10): the night before clocks go forward.
    const lateOnTheThird = new Date('2026-10-03T13:30:00Z');
    const id = await draft(f, lateOnTheThird);

    // 23:45 on 9 October in Sydney (AEDT, +11) is still day 6.
    expect((await sweep.closeForPractice(f.practiceId, new Date('2026-10-09T12:45:00Z'))).closed).toBe(0);
    // 00:15 on 10 October in Sydney, though still 9 October in UTC, is day 7.
    expect((await sweep.closeForPractice(f.practiceId, new Date('2026-10-09T13:15:00Z'))).closed).toBe(1);
    expect((await closureEvents(id))[0]!.payload).toMatchObject({ forDay: '2026-10-03', closedOn: '2026-10-10' });
  });

  it('a_closed_draft_drops_off_the_tablets_unsigned_from_earlier_days', async () => {
    const f = await practice();
    const day = dayAgo(20);
    const id = await draft(f, at(day));
    const listed = async () =>
      (
        (await request(app.getHttpServer()).get('/tablet-sessions/unsigned-earlier').set('x-practice-id', f.practiceId).expect(200))
          .body.rows as { agreementId: string }[]
      ).some((r) => r.agreementId === id);

    expect(await listed()).toBe(true);
    await sweep.closeForPractice(f.practiceId, at(addCalendarDays(day, 7)));
    expect(await listed()).toBe(false);
  });
});
