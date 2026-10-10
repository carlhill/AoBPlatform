import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { SERVICE_DESCRIPTIONS } from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TabletSessionsService } from '../src/tablet-sessions/tablet-sessions.service';
import { createServicingProvider, deleteSeededAnchors, type SeededAnchor } from './anchor';

/**
 * THE DESK'S DAY IS THE PRACTICE'S OWN LOCAL DAY (D-2026-10-10-03).
 *
 * THE DEFECT. `tablet-sessions.service.ts` worked "today" out two ways: the UTC
 * date, compared with an appointment's calendar date, and the server's local
 * midnight. In Sydney under daylight saving (UTC+11) the UTC date is still
 * yesterday until 11am, so every morning today's appointment-linked agreements
 * were missing from the desk and yesterday's still showed. Production runs on
 * UTC, so it was not a development-only fault.
 *
 * THE CLOCK IS INJECTED, NOT FAKED. The neighbouring specs never needed a
 * particular hour, so none controls "now". This one sets
 * `TabletSessionsService.clock` — the smallest seam the service allows — and
 * every instant below is named, so the suite says the same thing on a laptop
 * in Sydney and on a UTC runner (wow.md §2 item 6). The dates are after
 * daylight saving started in Sydney on 4 October 2026, so Sydney is +11,
 * Brisbane +10, Perth +8.
 *
 * Two practices: one on the default `Australia/Sydney`, one on
 * `Australia/Perth`.
 */

const RECEPTIONIST = {
  sub: '00000000-0000-4000-8000-0000000e4b01',
  principalType: 'staff',
  roles: [],
  preferredUsername: 'mai.frontdesk',
  raw: {},
};
let currentPrincipal: Record<string, unknown> | null = null;
function signedInAt(practiceId: string): void {
  currentPrincipal = { ...RECEPTIONIST, practiceId };
}

/** 8:30am AEDT on Wednesday 7 October 2026 — and still the 6th in UTC. */
const SYDNEY_MORNING = new Date('2026-10-06T21:30:00Z');

interface Anchors {
  anchor: SeededAnchor;
  patientId: string;
  assignorId: string;
}

describe('the desk turns at the practice\'s own midnight (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tablet: TabletSessionsService;
  let realClock: () => Date;

  const sydney = randomUUID();
  const perth = randomUUID();
  const anchors = new Map<string, Anchors>();

  const http = () => request(app.getHttpServer());
  const at = (instant: string | Date) => {
    const fixed = new Date(instant);
    tablet.clock = () => new Date(fixed);
  };

  async function onDesk(practiceId: string): Promise<string[]> {
    signedInAt(practiceId);
    const res = await http().get('/tablet-sessions/pushable').set('x-practice-id', practiceId).expect(200);
    return (res.body as { agreementId: string }[]).map((r) => r.agreementId);
  }

  async function earlier(practiceId: string): Promise<{ agreementId: string; forDate: string }[]> {
    signedInAt(practiceId);
    const res = await http().get('/tablet-sessions/unsigned-earlier').set('x-practice-id', practiceId).expect(200);
    return res.body.rows as { agreementId: string; forDate: string }[];
  }

  async function draft(practiceId: string, createdAt: string, appointmentDate?: string): Promise<string> {
    const a = anchors.get(practiceId)!;
    return prisma.withPractice(practiceId, async (tx) => {
      const row = await tx.agreement.create({
        data: {
          practiceId,
          type: 'episodic_pre',
          anchorKind: 'provider',
          affiliationId: a.anchor.id,
          patientId: a.patientId,
          assignorId: a.assignorId,
          assignorIsPatient: true,
          status: 'draft',
          serviceDescription: SERVICE_DESCRIPTIONS[0],
          assignorConfirmedAt: new Date(createdAt),
          createdAt: new Date(createdAt),
        },
      });
      if (appointmentDate) {
        await tx.appointment.create({
          data: {
            practiceId,
            pmsAppointmentKey: `boundary-${randomUUID()}`,
            patientId: a.patientId,
            date: new Date(appointmentDate),
            agreementId: row.id,
          },
        });
      }
      return row.id;
    });
  }

  async function seed(practiceId: string, name: string, timezone?: string): Promise<void> {
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name, ...(timezone ? { timezone } : {}) } });
      const anchor = await createServicingProvider(tx, practiceId, {
        name: 'Dr Example Provider',
        providerType: 'general_practitioner',
      });
      const patient = await tx.patient.create({
        data: {
          practiceId,
          familyName: 'Sampleton',
          givenNames: 'Jamie',
          dateOfBirth: new Date('1957-03-14'),
          address: '12 Example Street, Exampletown NSW 2000',
        },
      });
      const assignor = await tx.assignor.create({
        data: { practiceId, name: 'Jamie Sampleton', authorityBasis: 'self' },
      });
      anchors.set(practiceId, { anchor, patientId: patient.id, assignorId: assignor.id });
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // The same unforgeable seam the tablet-sessions suite uses.
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      if (currentPrincipal) req.principal = currentPrincipal;
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tablet = app.get(TabletSessionsService);
    realClock = tablet.clock;

    await seed(sydney, 'Day Boundary Practice (Sydney)');
    await seed(perth, 'Day Boundary Practice (Perth)', 'Australia/Perth');
  });

  afterEach(async () => {
    tablet.clock = realClock;
    for (const practiceId of [sydney, perth]) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.appointment.deleteMany({});
        await tx.agreement.deleteMany({});
      });
    }
  });

  afterAll(async () => {
    for (const practiceId of [sydney, perth]) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.appointment.deleteMany({});
        await tx.captureRequest.deleteMany({});
        await tx.agreement.deleteMany({});
        await tx.assignor.deleteMany({});
        await tx.patient.deleteMany({});
        await tx.provider.deleteMany({});
        await deleteSeededAnchors(tx);
        await tx.vaultOutbox.deleteMany({ where: { subjectId: practiceId } });
        await tx.practice.deleteMany({});
      });
    }
    await app?.close();
  });

  it('a_new_practice_is_on_sydney_time_by_default', async () => {
    const row = await prisma.withPractice(sydney, (tx) => tx.practice.findFirst({ select: { timezone: true } }));
    expect(row?.timezone).toBe('Australia/Sydney');
  });

  it('an_appointment_today_shows_on_the_desk_before_11am_sydney_time', async () => {
    // Drafted at 8am local for today's (7 October's) appointment.
    const today = await draft(sydney, '2026-10-06T21:00:00Z', '2026-10-07');
    at(SYDNEY_MORNING);

    expect(await onDesk(sydney)).toContain(today);
    expect((await earlier(sydney)).map((r) => r.agreementId)).not.toContain(today);
  });

  it('yesterdays_unsigned_agreement_is_not_on_todays_desk_after_local_midnight', async () => {
    // Booked for 6 October; it is now half past midnight on the 7th in Sydney,
    // and still mid-afternoon on the 6th in UTC.
    const yesterdays = await draft(sydney, '2026-10-05T22:00:00Z', '2026-10-06');
    at('2026-10-06T13:30:00Z');

    expect(await onDesk(sydney)).not.toContain(yesterdays);
    const row = (await earlier(sydney)).find((r) => r.agreementId === yesterdays);
    expect(row?.forDate).toBe('2026-10-06');
  });

  it('a_draft_with_no_appointment_created_just_after_local_midnight_is_todays', async () => {
    // 00:05 AEDT on 7 October, which is 13:05 UTC on the 6th.
    const justAfter = await draft(sydney, '2026-10-06T13:05:00Z');
    // 23:55 AEDT on 6 October: yesterday's, by ten minutes.
    const justBefore = await draft(sydney, '2026-10-06T12:55:00Z');
    at(SYDNEY_MORNING);

    const desk = await onDesk(sydney);
    expect(desk).toContain(justAfter);
    expect(desk).not.toContain(justBefore);
    const row = (await earlier(sydney)).find((r) => r.agreementId === justBefore);
    // Its day is the practice's day, not the UTC date or the server's.
    expect(row?.forDate).toBe('2026-10-06');
  });

  it('a_perth_practice_uses_perth_midnight', async () => {
    // 10am AWST on 6 October, booked for the 6th and drafted without a booking.
    const booked = await draft(perth, '2026-10-06T02:00:00Z', '2026-10-06');
    const walkIn = await draft(perth, '2026-10-06T02:00:00Z');
    // The same moment's draft in Sydney, for contrast.
    const sydneyWalkIn = await draft(sydney, '2026-10-06T02:00:00Z');

    // 11:30pm AWST on the 6th — and already 2:30am on the 7th in Sydney.
    at('2026-10-06T15:30:00Z');
    expect(await onDesk(perth)).toEqual(expect.arrayContaining([booked, walkIn]));
    expect(await onDesk(sydney)).not.toContain(sydneyWalkIn);

    // 00:30 AWST on the 7th: both of Perth's are now an earlier day's.
    at('2026-10-06T16:30:00Z');
    const desk = await onDesk(perth);
    expect(desk).not.toContain(booked);
    expect(desk).not.toContain(walkIn);
    const rows = await earlier(perth);
    expect(rows.find((r) => r.agreementId === booked)?.forDate).toBe('2026-10-06');
    expect(rows.find((r) => r.agreementId === walkIn)?.forDate).toBe('2026-10-06');
  });

  it('unsigned_earlier_days_agrees_with_the_desk_on_the_same_boundary', async () => {
    const ids = [
      await draft(sydney, '2026-10-05T22:00:00Z', '2026-10-06'),
      await draft(sydney, '2026-10-06T21:00:00Z', '2026-10-07'),
      await draft(sydney, '2026-10-06T12:55:00Z'),
      await draft(sydney, '2026-10-06T13:05:00Z'),
    ];
    at(SYDNEY_MORNING);

    const desk = await onDesk(sydney);
    const before = (await earlier(sydney)).map((r) => r.agreementId);
    // Every row is on exactly one of the two: none on both, none on neither.
    for (const id of ids) {
      expect([desk.includes(id), before.includes(id)].filter(Boolean)).toHaveLength(1);
    }
    expect(desk).toEqual(expect.arrayContaining([ids[1], ids[3]]));
    expect(before).toEqual(expect.arrayContaining([ids[0], ids[2]]));
  });
});

describe('a practice admin sets the practice timezone (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const practiceId = randomUUID();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.withPractice(practiceId, (tx) =>
      tx.practice.create({ data: { id: practiceId, name: 'Timezone Setting Practice' } }),
    );
  });

  afterAll(async () => {
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.vaultOutbox.deleteMany({ where: { subjectId: practiceId } });
      await tx.practice.deleteMany({});
    });
    await app?.close();
  });

  const patch = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).patch(`/practices/${practiceId}/config`).set('x-practice-id', practiceId).send(body);

  const events = () =>
    prisma.withPractice(practiceId, (tx) =>
      tx.vaultOutbox.findMany({
        where: { type: 'practice.timezone_set', subjectId: practiceId },
        orderBy: { occurredAt: 'asc' },
      }),
    );

  it('a_timezone_change_writes_its_vault_event', async () => {
    const res = await patch({ timezone: 'Australia/Perth' }).expect(200);
    expect(res.body.timezone).toBe('Australia/Perth');

    const written = await events();
    expect(written).toHaveLength(1);
    expect(written[0].payload).toMatchObject({
      timezone: 'Australia/Perth',
      previous: 'Australia/Sydney',
      timezonesVersion: expect.stringMatching(/^practice-timezones-/),
    });

    // A whole-form save that does not move it writes nothing more.
    await patch({ timezone: 'Australia/Perth' }).expect(200);
    expect(await events()).toHaveLength(1);
  });

  it('a_timezone_outside_the_list_is_refused_by_the_dto', async () => {
    await patch({ timezone: 'Pacific/Auckland' }).expect(400);
    await patch({ timezone: '+10:00' }).expect(400);
    const row = await prisma.withPractice(practiceId, (tx) => tx.practice.findFirst({ select: { timezone: true } }));
    expect(row?.timezone).not.toBe('Pacific/Auckland');
  });

  it('a_timezone_outside_the_list_is_refused_by_the_check', async () => {
    await expect(
      prisma.withPractice(practiceId, (tx) =>
        tx.practice.update({ where: { id: practiceId }, data: { timezone: 'Pacific/Auckland' } }),
      ),
    ).rejects.toThrow(/practices_timezone_check/);
  });
});
