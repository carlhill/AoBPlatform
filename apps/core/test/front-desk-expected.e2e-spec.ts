import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * `GET /arrivals/expected` — WHO IS BOOKED FOR TODAY AND HAS NOT WALKED IN
 * (Carl, 12 Sep 2026; FRONT-DESK-PAGE.md §12.4).
 *
 * THE ONE NEW READ THE FRONT DESK PAGE IS ALLOWED, so it is worth pinning
 * exactly what it will and will not say:
 *
 *  - IT NAMES ONLY PEOPLE WHO HAVE NOT ARRIVED. An arrival today takes a
 *    person off it, whether that arrival was received or REFUSED — a refused
 *    arrival means the patient is standing at the counter and the connector
 *    named somebody who cannot be the provider, and calling them "expected"
 *    would send reception looking out of the window for somebody in front of
 *    them.
 *  - IT IS TODAY'S BOOK AND NOT THE WEEK'S.
 *  - IT CARRIES A NAME AND A TIME AND NOTHING ELSE. The rail it feeds stands
 *    at a counter facing a waiting room: no provider, no reason, no date of
 *    birth, no identifier of any kind (hard rules 1 and 9), no amount (hard
 *    rule 4).
 *  - IT FAILS CLOSED ACROSS PRACTICES, by RLS rather than by a filter.
 *  - AND IT IS EMPTY WHEN THERE IS NO APPOINTMENT FEED, which is every real
 *    practice today (blocker D-01). An empty array is a true answer; saying
 *    WHY is the console's job, and its own test.
 */
describe('front desk — who is expected today (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const practiceId = randomUUID();
  const otherPracticeId = randomUUID();

  /** Obviously fake identities. No Medicare-format number exists anywhere here. */
  let bookedId: string;
  let arrivedId: string;
  let refusedId: string;
  let tomorrowId: string;
  let hiddenId: string;

  const isoDay = (offsetDays = 0) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + offsetDays);
    return new Date(
      `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}T00:00:00.000Z`,
    );
  };

  const get = (scope = practiceId) =>
    request(app.getHttpServer()).get('/arrivals/expected').set('x-practice-id', scope);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'Front Desk Test Practice' } });

      const patient = async (givenNames: string, familyName: string, over: Record<string, unknown> = {}) =>
        (
          await tx.patient.create({
            data: {
              practiceId,
              givenNames,
              familyName,
              dateOfBirth: new Date('1970-01-01'),
              patientRecordNumber: `FD-${randomUUID().slice(0, 8)}`,
              ...over,
            },
          })
        ).id;

      bookedId = await patient('Alex', 'Booked');
      arrivedId = await patient('Jamie', 'Alreadyhere');
      refusedId = await patient('Casey', 'Refusedarrival');
      tomorrowId = await patient('Robin', 'Nextday');
      hiddenId = await patient('Sam', 'Confidential', { confidentialityFlag: true });

      const appointment = (patientId: string, key: string, date: Date, time: string | null) =>
        tx.appointment.create({
          data: { practiceId, pmsAppointmentKey: key, patientId, date, time },
        });

      // Today, in a deliberately unhelpful order — the endpoint orders by time.
      await appointment(arrivedId, 'FD-APPT-ARRIVED', isoDay(), '09:15');
      await appointment(bookedId, 'FD-APPT-BOOKED', isoDay(), '08:30');
      await appointment(refusedId, 'FD-APPT-REFUSED', isoDay(), '09:45');
      await appointment(hiddenId, 'FD-APPT-HIDDEN', isoDay(), '10:00');
      // Tomorrow's book is not today's work.
      await appointment(tomorrowId, 'FD-APPT-TOMORROW', isoDay(1), '08:00');

      const arrival = (patientId: string, key: string, outcome: string) =>
        tx.arrival.create({
          data: {
            practiceId,
            patientId,
            pmsPatientRecordNumber: key,
            arrivedAt: new Date(),
            source: 'dev',
            idempotencyKey: `fd-${randomUUID()}`,
            outcome,
            refusedReason: outcome === 'refused' ? 'provider_not_servicing' : null,
          },
        });

      await arrival(arrivedId, 'FD-ARR-1', 'received');
      /*
       * A REFUSED ARRIVAL IS STILL AN ARRIVAL. They are here; the connector
       * named somebody who cannot be the provider, and reception fixes that on
       * the "Needs a provider" list — not by waiting for them to walk in.
       */
      await arrival(refusedId, 'FD-ARR-2', 'refused');
    });

    await prisma.withPractice(otherPracticeId, async (tx) => {
      await tx.practice.create({ data: { id: otherPracticeId, name: 'Another Practice' } });
    });
  });

  afterAll(async () => {
    for (const scope of [practiceId, otherPracticeId]) {
      await prisma.withPractice(scope, async (tx) => {
        await tx.arrival.deleteMany({});
        await tx.appointment.deleteMany({});
        await tx.patient.deleteMany({});
        await tx.practice.deleteMany({});
      });
    }
    await app?.close();
  });

  // -------------------------------------------------------------------------

  it('front_desk_expected_lists_todays_bookings_that_have_not_arrived', async () => {
    const res = await get().expect(200);

    expect(res.body.map((row: { patientName: string }) => row.patientName)).toEqual(['Alex Booked']);
    expect(res.body[0].patientId).toBe(bookedId);
    expect(res.body[0].time).toBe('08:30');
    expect(res.body[0].appointmentId).toBeTruthy();

    // Not the person who has already arrived, not the refused arrival (who is
    // also here), not tomorrow's booking, and not a patient whose record is
    // flagged — a rail that faces the room does not name them.
    const named = JSON.stringify(res.body);
    for (const away of ['Alreadyhere', 'Refusedarrival', 'Nextday', 'Confidential']) {
      expect(named).not.toContain(away);
    }
  });

  it('front_desk_expected_carries_a_name_and_a_time_and_nothing_else', async () => {
    const res = await get().expect(200);

    /*
     * THE SHAPE IS THE SAFETY. A field added to this row is a field on a screen
     * the public can read over a shoulder, so the row is asserted exactly
     * rather than by spot-checking absences.
     */
    expect(Object.keys(res.body[0]).sort()).toEqual(['appointmentId', 'patientId', 'patientName', 'time']);

    const named = JSON.stringify(res.body);
    // No date of birth, no address, no contact detail, no amount, no reason.
    expect(named).not.toContain('1970');
    expect(named).not.toMatch(/dateOfBirth|address|mobile|email|medicare|amount|benefit|reason/i);
  });

  it('front_desk_expected_across_a_practice_boundary_shows_nothing', async () => {
    /*
     * RLS, NOT A FILTER. The other practice's request runs against the same
     * table and finds nothing, because the rows are not visible to it — and it
     * gets an empty list rather than an error, which is the same answer it
     * would get on a quiet morning.
     */
    const mine = await get().expect(200);
    expect(mine.body.length).toBeGreaterThan(0);

    const theirs = await get(otherPracticeId).expect(200);
    expect(theirs.body).toEqual([]);
  });
});
