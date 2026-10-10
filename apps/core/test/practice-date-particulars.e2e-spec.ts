import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { MockPmsAdapter } from '@aobplatform/connector';
import type { PmsAppointment, ValidationResponse } from '@aobplatform/contracts';
import { SERVICE_DESCRIPTIONS, type IsoDate } from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';
import { PMS_ADAPTER } from '../src/pms/pms.tokens';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../src/messaging/gateway';
import { AgreementsService } from '../src/agreements/agreements.service';
import { ServiceDescriptionsService } from '../src/service-descriptions/service-descriptions.service';
import { AutoCaptureService } from '../src/auto-capture/auto-capture.service';
import { PractitionerQueueService } from '../src/practitioner-queue/practitioner-queue.service';
import { createServicingProvider, deleteSeededAnchors, type SeededAnchor } from './anchor';

/**
 * A STATUTORY DATE IS THE PRACTICE'S OWN DATE (D-2026-09-12-17 item 2,
 * D-2026-10-10-03).
 *
 * THE DEFECT. When no date was passed, `lockParticulars` wrote D2 from
 * `new Date().toISOString().slice(0, 10)` — the UTC date. In Sydney under
 * daylight saving (UTC+11) that is still yesterday until 11am, so an agreement
 * locked at 8:30am carried yesterday's date as a statutory particular. The
 * superseding draft's D5 fallback, the service-description check's D2 and D5,
 * and the auto-capture default day had the same shape.
 *
 * THE CLOCK IS INJECTED, NOT FAKED — each service's `clock` field, the same
 * seam `TabletSessionsService` has (`practice-day-boundary.e2e-spec.ts`).
 * Every instant is named, so this says the same thing on a laptop in Sydney
 * and on a UTC runner. Dates are after Sydney's DST start on 4 October 2026:
 * Sydney +11, Perth +8.
 */

/** 8:30am AEDT on Wednesday 7 October 2026 — and still the 6th in UTC. */
const SYDNEY_MORNING = new Date('2026-10-06T21:30:00Z');
/** 1am AWST on 8 October in Perth — still the 7th in UTC. */
const PERTH_AFTER_MIDNIGHT = new Date('2026-10-07T17:00:00Z');
/** 10pm AWST on 7 October in Perth — already 1am on the 8th in Sydney. */
const PERTH_LATE_EVENING = new Date('2026-10-07T14:00:00Z');

const RECEPTIONIST = {
  sub: '00000000-0000-4000-8000-0000000d2d01',
  principalType: 'staff',
  roles: [],
  preferredUsername: 'mai.frontdesk',
  raw: {},
};
let currentPrincipal: Record<string, unknown> | null = null;

/**
 * Every payload the rules service was asked about, newest last. It passes
 * everything, with an explicit C8 verdict because the assignor change refuses
 * a rule set that is silent on D7 — this suite is about dates, not parties.
 */
const validated: Record<string, unknown>[] = [];
const recordingRules = {
  validate: async (req: { payload: Record<string, unknown> }): Promise<ValidationResponse> => {
    validated.push(req.payload);
    return {
      valid: true,
      results: [{ rule: 'C8', outcome: 'pass', message: 'D7 stated.', citation: 's 65C(6)(b); REQ-REG-01 D7' }],
      ruleSetVersion: 'test-rules-1',
      mappingVersion: 'test-mapping-1',
    };
  },
};

/** The day each appointment read was asked for. Returns none, so nothing cascades. */
const appointmentDaysAsked: string[] = [];
class DayRecordingAdapter extends MockPmsAdapter {
  override async readAppointments(date: IsoDate): Promise<readonly PmsAppointment[]> {
    appointmentDaysAsked.push(date);
    return [];
  }
}

interface Seeded {
  anchor: SeededAnchor;
  patientId: string;
  assignorId: string;
}

/** A desk practice: the GP an arrival names, and a second GP at the same site to move it to. */
interface Desk {
  gp: SeededAnchor;
  cover: SeededAnchor;
}

describe('statutory dates are the practice\'s own date (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agreements: AgreementsService;
  let descriptions: ServiceDescriptionsService;
  let autoCapture: AutoCaptureService;
  let queue: PractitionerQueueService;
  let realClocks: { agreements: () => Date; descriptions: () => Date; autoCapture: () => Date };

  const sydney = randomUUID();
  const perth = randomUUID();
  const seeded = new Map<string, Seeded>();
  /*
   * THE ARRIVAL PRACTICES, apart from the two above so a default D6a and the
   * episodic path change nothing the other tests rely on. Not offering ongoing
   * agreements by default puts a GP's arrival on the episodic path, the one the
   * platform can lock (the reason `arrival-move.e2e-spec.ts` gives).
   */
  const deskSydney = randomUUID();
  const deskPerth = randomUUID();
  const desks = new Map<string, Desk>();
  const http = () => request(app.getHttpServer());

  const at = (instant: Date) => {
    agreements.clock = () => new Date(instant);
    descriptions.clock = () => new Date(instant);
    autoCapture.clock = () => new Date(instant);
  };

  async function draft(practiceId: string): Promise<string> {
    const s = seeded.get(practiceId)!;
    const res = await http()
      .post('/agreements')
      .set('x-practice-id', practiceId)
      .send({ type: 'episodic_pre', affiliationId: s.anchor.id, patientId: s.patientId, assignorId: s.assignorId, assignorIsPatient: true })
      .expect(201);
    return res.body.id as string;
  }

  async function lock(practiceId: string, agreementId: string, extra: Record<string, unknown> = {}): Promise<void> {
    await http()
      .post(`/agreements/${agreementId}/particulars`)
      .set('x-practice-id', practiceId)
      .send({ serviceDate: '2026-10-07', basicServiceDescription: SERVICE_DESCRIPTIONS[0], ...extra })
      .expect(201);
  }

  /** An arrival as a connector (or, with `source: 'reception'`, the desk) sends it, at a named instant. */
  function arrival(practiceId: string, arrivedAt: Date, over: Record<string, unknown> = {}) {
    return http()
      .post('/arrivals')
      .set('x-practice-id', practiceId)
      .send({
        pmsPatientRecordNumber: `PDP-${randomUUID().slice(0, 8)}`,
        familyName: 'Arrivalton',
        givenNames: 'Robin',
        dateOfBirth: '1968-04-11',
        address: '4 Example Street, Sampletown NSW 2000',
        affiliationId: desks.get(practiceId)!.gp.affiliationId,
        arrivedAt: arrivedAt.toISOString(),
        source: 'dev',
        idempotencyKey: `pdp-${randomUUID()}`,
        ...over,
      });
  }

  async function seedDesk(practiceId: string, name: string, timezone?: string): Promise<void> {
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({
        data: {
          id: practiceId,
          name,
          defaultServiceDescription: SERVICE_DESCRIPTIONS[0],
          enduringByDefault: false,
          ...(timezone ? { timezone } : {}),
        },
      });
      const gp = await createServicingProvider(tx, practiceId, { name: 'Dr Sample Arrival', locationCode: 'Main' });
      const cover = await createServicingProvider(tx, practiceId, { name: 'Dr Sample Cover', locationId: gp.locationId });
      desks.set(practiceId, { gp, cover });
    });
  }

  /**
   * A WALK-IN AT A NAMED INSTANT, WITH THE PRACTICE'S SOFTWARE HAVING ALREADY
   * INVOICED A SERVICE ON EACH OF `serviceDays` — undecided rows carrying their
   * own D5 and D6b, which is what `PmsSyncService` writes. Then "Completed" is
   * pressed. A fresh patient each time, so no two calls share a service record.
   */
  async function completedAt(practiceId: string, arrivedAt: Date, serviceDays: string[]) {
    const { gp } = desks.get(practiceId)!;
    const recordNumber = `PDP-SR-${randomUUID().slice(0, 8)}`;
    const { arrivalId, patientId } = await prisma.withPractice(practiceId, async (tx) => {
      const patient = await tx.patient.create({
        data: { practiceId, familyName: 'Renderton', givenNames: 'Alex', dateOfBirth: new Date('1966-02-02'), patientRecordNumber: recordNumber },
      });
      for (const day of serviceDays) {
        await tx.serviceRecord.create({
          data: {
            practiceId,
            pmsInvoiceKey: `pdp-sr-${day}-${randomUUID()}`,
            patientId: patient.id,
            affiliationId: gp.affiliationId,
            serviceDate: new Date(day),
            mbsItemNumbers: ['23'],
          },
        });
      }
      const row = await tx.arrival.create({
        data: {
          practiceId,
          pmsPatientRecordNumber: recordNumber,
          source: 'dev',
          idempotencyKey: `pdp-sr-${randomUUID()}`,
          outcome: 'received',
          arrivedAt,
          patientId: patient.id,
          affiliationId: gp.affiliationId,
          seeingAffiliationId: gp.affiliationId,
        },
      });
      return { arrivalId: row.id, patientId: patient.id };
    });

    const receipt = await queue.setState(undefined, practiceId, arrivalId, 'completed');
    const records = await prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.findMany({ where: { patientId } }),
    );
    const byDay = new Map(records.map((r) => [r.serviceDate.toISOString().slice(0, 10), r]));
    return { receipt, byDay };
  }

  /** D5 on the agreement the service-rendered press raised. */
  async function renderedD5(practiceId: string, agreementId: string | null): Promise<unknown> {
    expect(agreementId).toBeTruthy();
    return (await particularsOf(practiceId, agreementId!)).serviceDate;
  }

  async function particularsOf(practiceId: string, agreementId: string): Promise<Record<string, unknown>> {
    const row = await prisma.withPractice(practiceId, (tx) => tx.agreement.findFirst({ where: { id: agreementId } }));
    return row!.particulars as Record<string, unknown>;
  }

  async function seed(practiceId: string, name: string, timezone?: string): Promise<void> {
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name, ...(timezone ? { timezone } : {}) } });
      const anchor = await createServicingProvider(tx, practiceId, {
        name: 'Dr Example Provider',
        providerType: 'general_practitioner',
        address: '1 Example Street, Exampletown NSW 2000',
      });
      const patient = await tx.patient.create({
        data: { practiceId, familyName: 'Sampleton', givenNames: 'Jamie', dateOfBirth: new Date('1957-03-14') },
      });
      const assignor = await tx.assignor.create({ data: { practiceId, name: 'Jamie Sampleton', authorityBasis: 'self' } });
      seeded.set(practiceId, { anchor, patientId: patient.id, assignorId: assignor.id });
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RULES_CLIENT)
      .useValue(recordingRules)
      .overrideProvider(PMS_ADAPTER)
      .useValue(new DayRecordingAdapter())
      .overrideProvider(MESSAGING_GATEWAY)
      .useValue({ mode: 'test', dispatch: async () => ({ accepted: true }) } as MessagingGateway)
      .compile();
    app = moduleRef.createNestApplication();
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      if (currentPrincipal) req.principal = currentPrincipal;
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    agreements = app.get(AgreementsService);
    descriptions = app.get(ServiceDescriptionsService);
    autoCapture = app.get(AutoCaptureService);
    queue = app.get(PractitionerQueueService);
    realClocks = { agreements: agreements.clock, descriptions: descriptions.clock, autoCapture: autoCapture.clock };

    await seed(sydney, 'Practice Date Practice (Sydney)');
    await seed(perth, 'Practice Date Practice (Perth)', 'Australia/Perth');
    await seedDesk(deskSydney, 'Practice Date Desk (Sydney)');
    await seedDesk(deskPerth, 'Practice Date Desk (Perth)', 'Australia/Perth');
  });

  afterEach(() => {
    agreements.clock = realClocks.agreements;
    descriptions.clock = realClocks.descriptions;
    autoCapture.clock = realClocks.autoCapture;
    currentPrincipal = null;
    validated.length = 0;
    appointmentDaysAsked.length = 0;
  });

  afterAll(async () => {
    for (const practiceId of [sydney, perth, deskSydney, deskPerth]) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.visitState.deleteMany({});
        await tx.serviceRecord.deleteMany({});
        await tx.arrival.deleteMany({});
        await tx.outboundItem.deleteMany({});
        await tx.tabletSession.deleteMany({});
        await tx.captureRequest.deleteMany({});
        await tx.verificationChallenge.deleteMany({});
        await tx.enduringDetail.deleteMany({});
        await tx.agreement.deleteMany({});
        await tx.assignor.deleteMany({});
        await tx.patient.deleteMany({});
        await tx.provider.deleteMany({});
        await deleteSeededAnchors(tx);
        await tx.vaultOutbox.deleteMany({});
        await tx.practice.deleteMany({});
      });
    }
    await app?.close();
  });

  // --- D2 at lock -----------------------------------------------------------

  it('d2_is_the_practice_date_when_locked_before_11am_sydney', async () => {
    const id = await draft(sydney);
    at(SYDNEY_MORNING);
    await lock(sydney, id);
    expect((await particularsOf(sydney, id)).agreementDate).toBe('2026-10-07');
  });

  it('d2_is_the_perth_date_for_a_perth_practice', async () => {
    // Not the UTC date: 1am on the 8th in Perth is still the 7th in UTC.
    const afterMidnight = await draft(perth);
    at(PERTH_AFTER_MIDNIGHT);
    await lock(perth, afterMidnight, { serviceDate: '2026-10-08' });
    expect((await particularsOf(perth, afterMidnight)).agreementDate).toBe('2026-10-08');

    // Not Sydney's date: 10pm on the 7th in Perth is already the 8th in Sydney.
    const lateEvening = await draft(perth);
    at(PERTH_LATE_EVENING);
    await lock(perth, lateEvening);
    expect((await particularsOf(perth, lateEvening)).agreementDate).toBe('2026-10-07');
  });

  it('an_explicit_agreement_date_is_never_replaced', async () => {
    const id = await draft(sydney);
    at(SYDNEY_MORNING);
    await lock(sydney, id, { agreementDate: '2026-10-05' });
    expect((await particularsOf(sydney, id)).agreementDate).toBe('2026-10-05');
  });

  // --- the superseding draft (D5 fallback, and its D2) ----------------------

  it('d5_of_a_superseding_draft_falls_back_to_the_practice_date_before_11am_sydney', async () => {
    const id = await draft(sydney);
    await lock(sydney, id);
    // A locked snapshot with no D5 — the fallback's only way in. Not signed,
    // so the immutability trigger does not apply.
    await prisma.withPractice(sydney, async (tx) => {
      const row = await tx.agreement.findFirst({ where: { id } });
      const { serviceDate: _dropped, ...rest } = row!.particulars as Record<string, unknown>;
      await tx.agreement.update({ where: { id }, data: { particulars: rest as object } });
    });

    at(SYDNEY_MORNING);
    const res = await http()
      .post(`/agreements/${id}/assignor`)
      .set('x-practice-id', sydney)
      .send({ assignorIsPatient: false, name: 'Sam Carer', authorityBasis: 'parent', declaresEighteenOrOver: true, mobile: '0400000111' })
      .expect(201);
    expect(res.body.supersedesAgreementId).toBe(id);

    const replacement = await particularsOf(sydney, res.body.id as string);
    expect(replacement.serviceDate).toBe('2026-10-07');
    expect(replacement.agreementDate).toBe('2026-10-07');
  });

  it('a_superseding_draft_keeps_the_explicit_d5_of_the_agreement_it_replaces', async () => {
    const id = await draft(sydney);
    await lock(sydney, id, { serviceDate: '2026-10-02' });
    at(SYDNEY_MORNING);
    const res = await http()
      .post(`/agreements/${id}/assignor`)
      .set('x-practice-id', sydney)
      .send({ assignorIsPatient: false, name: 'Sam Carer', authorityBasis: 'parent', declaresEighteenOrOver: true, mobile: '0400000111' })
      .expect(201);
    expect((await particularsOf(sydney, res.body.id as string)).serviceDate).toBe('2026-10-02');
  });

  // --- the service-description check --------------------------------------

  it('the_service_description_check_dates_d2_and_d5_on_the_practice_date_before_11am_sydney', async () => {
    const id = await draft(sydney);
    currentPrincipal = { ...RECEPTIONIST, practiceId: sydney };
    at(SYDNEY_MORNING);
    await http()
      .post(`/service-descriptions/agreements/${id}`)
      .set('x-practice-id', sydney)
      .send({ description: SERVICE_DESCRIPTIONS[0] })
      .expect(201);
    const payload = validated.at(-1)!;
    expect(payload.agreementDate).toBe('2026-10-07');
    expect(payload.serviceDate).toBe('2026-10-07');
  });

  it('the_service_description_check_uses_the_perth_date_for_a_perth_practice', async () => {
    const id = await draft(perth);
    currentPrincipal = { ...RECEPTIONIST, practiceId: perth };
    at(PERTH_AFTER_MIDNIGHT);
    await http()
      .post(`/service-descriptions/agreements/${id}`)
      .set('x-practice-id', perth)
      .send({ description: SERVICE_DESCRIPTIONS[0] })
      .expect(201);
    expect(validated.at(-1)!.agreementDate).toBe('2026-10-08');
  });

  it('the_service_description_check_keeps_an_appointment_date_as_d5', async () => {
    const id = await draft(sydney);
    await prisma.withPractice(sydney, (tx) =>
      tx.appointment.create({
        data: { practiceId: sydney, pmsAppointmentKey: `d5-${randomUUID()}`, patientId: seeded.get(sydney)!.patientId, date: new Date('2026-10-09'), agreementId: id },
      }),
    );
    currentPrincipal = { ...RECEPTIONIST, practiceId: sydney };
    at(SYDNEY_MORNING);
    await http()
      .post(`/service-descriptions/agreements/${id}`)
      .set('x-practice-id', sydney)
      .send({ description: SERVICE_DESCRIPTIONS[0] })
      .expect(201);
    expect(validated.at(-1)!.serviceDate).toBe('2026-10-09');
    await prisma.withPractice(sydney, (tx) => tx.appointment.deleteMany({}));
  });

  // --- the auto-capture default day ---------------------------------------

  it('the_auto_capture_default_day_is_the_practice_date_before_11am_sydney', async () => {
    at(SYDNEY_MORNING);
    const res = await http().post('/pms/sync-appointments').set('x-practice-id', sydney).send({}).expect(201);
    expect(appointmentDaysAsked).toEqual(['2026-10-07']);
    expect(res.body.date).toBe('2026-10-07');
  });

  it('the_auto_capture_default_day_is_the_perth_date_for_a_perth_practice', async () => {
    at(PERTH_AFTER_MIDNIGHT);
    await http().post('/pms/sync-appointments').set('x-practice-id', perth).send({}).expect(201);
    expect(appointmentDaysAsked).toEqual(['2026-10-08']);
  });

  it('an_explicit_auto_capture_day_is_never_replaced', async () => {
    at(SYDNEY_MORNING);
    await http().post('/pms/sync-appointments').set('x-practice-id', sydney).send({ date: '2026-10-01' }).expect(201);
    expect(appointmentDaysAsked).toEqual(['2026-10-01']);
  });

  // --- D5 on an arrival, and on the draft a practitioner move makes ---------

  it('an_arrival_before_11am_sydney_gets_the_practice_date_as_d5', async () => {
    at(SYDNEY_MORNING);
    const res = await arrival(deskSydney, SYDNEY_MORNING).expect(201);
    expect(res.body.agreementId).toBeTruthy();
    expect((await particularsOf(deskSydney, res.body.agreementId as string)).serviceDate).toBe('2026-10-07');
  });

  it('a_perth_arrival_gets_the_perth_date_as_d5', async () => {
    // Not the UTC date: 1am on the 8th in Perth is still the 7th in UTC.
    at(PERTH_AFTER_MIDNIGHT);
    const afterMidnight = await arrival(deskPerth, PERTH_AFTER_MIDNIGHT).expect(201);
    expect((await particularsOf(deskPerth, afterMidnight.body.agreementId as string)).serviceDate).toBe('2026-10-08');

    // Not Sydney's date: 10pm on the 7th in Perth is already the 8th in Sydney.
    at(PERTH_LATE_EVENING);
    const lateEvening = await arrival(deskPerth, PERTH_LATE_EVENING).expect(201);
    expect((await particularsOf(deskPerth, lateEvening.body.agreementId as string)).serviceDate).toBe('2026-10-07');
  });

  it('an_explicit_service_date_on_an_arrival_is_never_replaced', async () => {
    at(SYDNEY_MORNING);
    currentPrincipal = { ...RECEPTIONIST, practiceId: deskSydney };
    const res = await arrival(deskSydney, SYDNEY_MORNING, { source: 'reception', serviceDate: '2026-10-05' }).expect(201);
    expect((await particularsOf(deskSydney, res.body.agreementId as string)).serviceDate).toBe('2026-10-05');
  });

  it('a_practitioner_move_draft_gets_the_practice_date_of_arrival_as_d5', async () => {
    const { gp, cover } = desks.get(deskSydney)!;
    // An 8:30am AEDT walk-in whose draft states no D5 yet, so the move's own D5
    // is the only date the replacement can carry (a parent's D5 always wins).
    const { arrivalId, agreementId } = await prisma.withPractice(deskSydney, async (tx) => {
      const patient = await tx.patient.create({
        data: { practiceId: deskSydney, familyName: 'Moveton', givenNames: 'Casey', dateOfBirth: new Date('1970-01-01') },
      });
      const assignor = await tx.assignor.create({
        data: { practiceId: deskSydney, name: 'Casey Moveton', authorityBasis: 'self' },
      });
      const agreement = await tx.agreement.create({
        data: {
          practiceId: deskSydney,
          type: 'episodic_pre',
          anchorKind: 'provider',
          affiliationId: gp.affiliationId,
          patientId: patient.id,
          assignorId: assignor.id,
          assignorIsPatient: true,
        },
      });
      const row = await tx.arrival.create({
        data: {
          practiceId: deskSydney,
          pmsPatientRecordNumber: `PDP-MV-${randomUUID().slice(0, 8)}`,
          source: 'dev',
          idempotencyKey: `pdp-mv-${randomUUID()}`,
          outcome: 'received',
          arrivedAt: SYDNEY_MORNING,
          patientId: patient.id,
          assignorId: assignor.id,
          affiliationId: gp.affiliationId,
          seeingAffiliationId: gp.affiliationId,
          visitDecision: 'episodic_pre',
          decisionReason: 'episodic_for_this_visit',
          policyVersion: 'visit-policy-3',
          agreementId: agreement.id,
        },
      });
      return { arrivalId: row.id, agreementId: agreement.id };
    });

    at(SYDNEY_MORNING);
    await http()
      .post('/arrivals/move')
      .set('x-practice-id', deskSydney)
      .send({ arrivalIds: [arrivalId], toAffiliationId: cover.affiliationId })
      .expect(201);

    const successor = await prisma.withPractice(deskSydney, (tx) =>
      tx.agreement.findFirst({ where: { supersedesAgreementId: agreementId } }),
    );
    expect(successor).not.toBeNull();
    expect((successor!.particulars as Record<string, unknown>).serviceDate).toBe('2026-10-07');
  });

  // --- the practitioner queue's "Completed" (service rendered) ---------------

  it('service_rendered_before_11am_sydney_picks_todays_service_not_yesterdays', async () => {
    /*
     * At 8:30am AEDT on the 7th the UTC date is still the 6th, so a window
     * built from the SERVER's calendar on a UTC host (production, CI) picks
     * YESTERDAY's undecided invoice and raises today's press against it.
     *
     * WHAT THIS PINS, AND WHERE. The process zone cannot be switched inside a
     * Jest sandbox (its `process.env` is a copy, so V8 never re-reads TZ), and
     * on a host in Sydney the server's day and this practice's agree. So this
     * test catches the defect on a UTC host — CI, or `TZ=UTC npx jest ...` —
     * and the Perth test below catches it on either.
     */
    at(SYDNEY_MORNING);
    const { receipt, byDay } = await completedAt(deskSydney, SYDNEY_MORNING, ['2026-10-06', '2026-10-07']);

    expect(receipt.renderedOutcome).toBe('raised');
    expect(await renderedD5(deskSydney, byDay.get('2026-10-07')!.agreementId)).toBe('2026-10-07');
    // Yesterday's service is not this visit's, and is left undecided.
    expect(byDay.get('2026-10-06')!.visitDecision).toBeNull();
    expect(byDay.get('2026-10-06')!.agreementId).toBeNull();
  });

  it('a_perth_service_rendered_uses_the_perth_day', async () => {
    // Not the UTC date: 1am on the 8th in Perth is still the 7th in UTC.
    at(PERTH_AFTER_MIDNIGHT);
    const afterMidnight = await completedAt(deskPerth, PERTH_AFTER_MIDNIGHT, ['2026-10-07', '2026-10-08']);
    expect(afterMidnight.receipt.renderedOutcome).toBe('raised');
    expect(await renderedD5(deskPerth, afterMidnight.byDay.get('2026-10-08')!.agreementId)).toBe('2026-10-08');
    expect(afterMidnight.byDay.get('2026-10-07')!.visitDecision).toBeNull();

    // Not Sydney's date: 10pm on the 7th in Perth is already the 8th in Sydney.
    at(PERTH_LATE_EVENING);
    const lateEvening = await completedAt(deskPerth, PERTH_LATE_EVENING, ['2026-10-07', '2026-10-08']);
    expect(lateEvening.receipt.renderedOutcome).toBe('raised');
    expect(await renderedD5(deskPerth, lateEvening.byDay.get('2026-10-07')!.agreementId)).toBe('2026-10-07');
    expect(lateEvening.byDay.get('2026-10-08')!.visitDecision).toBeNull();
  });
});
