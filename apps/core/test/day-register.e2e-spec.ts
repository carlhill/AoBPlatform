import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PRACTICE_TIMEZONE } from '@aobplatform/domain';
import type { DayRegister } from '@aobplatform/contracts';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createServicingProvider, deleteSeededAnchors } from './anchor';

/**
 * THE PRACTICE'S DAY REGISTER (Carl, 12 September 2026, on
 * `/practice/frontdesk`: *"Add a button here with a link to show all Patients
 * seen at this practice today. You could put a filter on this to search for any
 * day. Default to today."*).
 *
 * WHY IT IS AN E2E SUITE AND NOT A UNIT ONE. The two things most likely to be
 * wrong here are both properties of the QUERY: which day's rows come back, and
 * whose. Neither can be proved against a mock — the day boundary is a
 * comparison the database makes against a `timestamptz`, and the practice
 * boundary is RLS, which does not exist outside Postgres.
 *
 * EVERY ARRIVAL IS SEEDED AT A NAMED INSTANT. Nothing here depends on the day
 * the suite is run, on the hour, or on the host's timezone (wow.md §2 item 6) —
 * which matters more than usual, because the defect being guarded against is
 * INVISIBLE on a UTC host and CI is one.
 *
 * FAKE IDENTITIES ONLY, and there is no Medicare-format number anywhere in it
 * because there is no field for one at either end (hard rule 1).
 */
describe('the day register — who came in, on one day (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const practiceId = randomUUID();
  const otherPracticeId = randomUUID();

  let gp: Awaited<ReturnType<typeof createServicingProvider>>;
  let nurse: Awaited<ReturnType<typeof createServicingProvider>>;

  /**
   * THE DAY THIS SUITE IS ABOUT, and the three instants that define it.
   *
   * 12 September 2026 in Sydney is AEST (+10), so the practice's day runs from
   * 14:00 UTC on the 11th to 14:00 UTC on the 12th. `EARLY_MORNING` is 01:00 in
   * the practice's clock — a time at which the UTC date still reads as the
   * ELEVENTH, which is the whole point of the boundary test.
   */
  const DAY = '2026-09-12';
  const DAY_BEFORE = '2026-09-11';
  /** 2026-09-12 01:00 in Sydney. UTC still calls this the 11th. */
  const EARLY_MORNING = new Date('2026-09-11T15:00:00.000Z');
  /** 2026-09-12 09:30 in Sydney. */
  const MID_MORNING = new Date('2026-09-12T00:30:00.000Z');
  /** 2026-09-12 12:00 in Sydney. */
  const MIDDAY = new Date('2026-09-12T02:00:00.000Z');
  /** 2026-09-12 23:30 in Sydney — the last half hour of the practice's day. */
  const LATE_NIGHT = new Date('2026-09-12T13:30:00.000Z');
  /** 2026-09-11 09:00 in Sydney: yesterday, and it must never appear under DAY. */
  const YESTERDAY_MORNING = new Date('2026-09-10T23:00:00.000Z');

  let signedArrivalId: string;
  let correctedArrivalId: string;
  let supersededAgreementId: string;
  let successorAgreementId: string;
  let unresolvedArrivalId: string;

  const register = async (query: string, practice = practiceId): Promise<DayRegister> => {
    const res = await request(app.getHttpServer())
      .get(`/arrivals/day${query}`)
      .set('x-practice-id', practice)
      .expect(200);
    return res.body as DayRegister;
  };

  const namesIn = (body: DayRegister) => body.rows.map((row) => row.patientName);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'Day Register Test Practice' } });

      gp = await createServicingProvider(tx, practiceId, { name: 'Dr Sample Chen' });
      nurse = await createServicingProvider(tx, practiceId, {
        name: 'Nurse Sample Patel',
        providerType: 'registered_nurse',
        billingRole: 'works_under_provider',
        locationId: gp.locationId,
      });

      const patient = async (givenNames: string, familyName: string, recordNumber: string) =>
        (
          await tx.patient.create({
            data: {
              practiceId,
              givenNames,
              familyName,
              dateOfBirth: new Date('1970-01-01'),
              address: '3 Example Street, Sampletown NSW 2000',
              patientRecordNumber: recordNumber,
            },
          })
        ).id;

      const assignorFor = async (name: string) =>
        (await tx.assignor.create({ data: { practiceId, name, authorityBasis: 'self' } })).id;

      const agreementFor = async (
        patientId: string,
        affiliationId: string,
        over: { status?: string; signatureEventId?: string; supersedesAgreementId?: string } = {},
      ) =>
        (
          await tx.agreement.create({
            data: {
              practiceId,
              type: 'episodic_pre',
              anchorKind: 'provider',
              affiliationId,
              patientId,
              assignorId: await assignorFor('Sample Assignor'),
              assignorIsPatient: true,
              ...over,
            },
          })
        ).id;

      type ArrivalSeed = Omit<
        Parameters<typeof tx.arrival.create>[0]['data'],
        'practiceId' | 'source' | 'idempotencyKey' | 'outcome'
      >;
      const arrive = (over: ArrivalSeed) =>
        tx.arrival.create({
          data: {
            practiceId,
            source: 'dev',
            idempotencyKey: `dr-${randomUUID()}`,
            outcome: 'received',
            ...over,
          },
        });

      // -------- 01:00 by the practice's clock. UTC says yesterday. ----------
      const early = await patient('Jamie', 'Earlybird', 'DR-EARLY-1');
      signedArrivalId = (
        await arrive({
          patientId: early,
          pmsPatientRecordNumber: 'DR-EARLY-1',
          affiliationId: gp.affiliationId,
          seeingAffiliationId: gp.affiliationId,
          arrivedAt: EARLY_MORNING,
          visitDecision: 'episodic_pre',
          decisionReason: 'episodic_for_this_visit',
          policyVersion: 'visit-policy-3',
          agreementId: await agreementFor(early, gp.affiliationId, {
            status: 'stored',
            signatureEventId: randomUUID(),
          }),
        })
      ).id;

      // -------- The nurse's patient, billed under the GP (§6a) --------------
      const nursed = await patient('Alex', 'Nursevisit', 'DR-NURSE-1');
      await arrive({
        patientId: nursed,
        pmsPatientRecordNumber: 'DR-NURSE-1',
        affiliationId: gp.affiliationId,
        seeingAffiliationId: nurse.affiliationId,
        arrivedAt: MID_MORNING,
        visitDecision: 'episodic_pre',
        decisionReason: 'episodic_for_this_visit',
        policyVersion: 'visit-policy-3',
        agreementId: await agreementFor(nursed, gp.affiliationId),
      });

      // -------- Corrected mid-visit: the arrival names the SUPERSEDED row ---
      const corrected = await patient('Casey', 'Correctedaddress', 'DR-CORRECT-1');
      supersededAgreementId = await agreementFor(corrected, gp.affiliationId);
      successorAgreementId = await agreementFor(corrected, gp.affiliationId, {
        status: 'stored',
        signatureEventId: randomUUID(),
        supersedesAgreementId: supersededAgreementId,
      });
      correctedArrivalId = (
        await arrive({
          patientId: corrected,
          pmsPatientRecordNumber: 'DR-CORRECT-1',
          affiliationId: gp.affiliationId,
          seeingAffiliationId: gp.affiliationId,
          arrivedAt: LATE_NIGHT,
          visitDecision: 'episodic_pre',
          decisionReason: 'episodic_for_this_visit',
          policyVersion: 'visit-policy-3',
          agreementId: supersededAgreementId,
        })
      ).id;

      // -------- Never resolved to a patient record --------------------------
      unresolvedArrivalId = (
        await arrive({
          patientId: null,
          pmsPatientRecordNumber: 'DR-UNKNOWN-9',
          affiliationId: gp.affiliationId,
          seeingAffiliationId: gp.affiliationId,
          arrivedAt: MIDDAY,
        })
      ).id;

      // -------- Refused: a message that bounced, not somebody who came in ---
      const bounced = await patient('Robin', 'Refusedarrival', 'DR-REFUSED-1');
      await tx.arrival.create({
        data: {
          practiceId,
          patientId: bounced,
          pmsPatientRecordNumber: 'DR-REFUSED-1',
          affiliationId: nurse.affiliationId,
          seeingAffiliationId: nurse.affiliationId,
          arrivedAt: MID_MORNING,
          source: 'dev',
          idempotencyKey: `dr-refused-${randomUUID()}`,
          outcome: 'refused',
          refusedReason: 'provider_not_servicing',
        },
      });

      // -------- Yesterday --------------------------------------------------
      const yesterday = await patient('Sam', 'Yesterdayvisit', 'DR-YESTERDAY-1');
      await arrive({
        patientId: yesterday,
        pmsPatientRecordNumber: 'DR-YESTERDAY-1',
        affiliationId: gp.affiliationId,
        seeingAffiliationId: gp.affiliationId,
        arrivedAt: YESTERDAY_MORNING,
        visitDecision: 'episodic_pre',
        decisionReason: 'episodic_for_this_visit',
        policyVersion: 'visit-policy-3',
        agreementId: await agreementFor(yesterday, gp.affiliationId),
      });

      // Where the visit got to, on the corrected row only — so a null on every
      // other row proves the register does not invent one.
      await tx.visitState.create({
        data: {
          practiceId,
          arrivalId: correctedArrivalId,
          state: 'completed',
          statesVersion: 'visit-states-1',
          setByPrincipalId: 'test',
          setByPrincipalType: 'system',
        },
      });
    });

    await prisma.withPractice(otherPracticeId, async (tx) => {
      await tx.practice.create({ data: { id: otherPracticeId, name: 'Somebody Else Medical' } });
      const theirGp = await createServicingProvider(tx, otherPracticeId, { name: 'Dr Elsewhere Sample' });
      const theirs = await tx.patient.create({
        data: {
          practiceId: otherPracticeId,
          givenNames: 'Pat',
          familyName: 'Otherpractice',
          dateOfBirth: new Date('1970-01-01'),
          patientRecordNumber: 'DR-OTHER-1',
        },
      });
      await tx.arrival.create({
        data: {
          practiceId: otherPracticeId,
          patientId: theirs.id,
          pmsPatientRecordNumber: 'DR-OTHER-1',
          affiliationId: theirGp.affiliationId,
          seeingAffiliationId: theirGp.affiliationId,
          arrivedAt: MID_MORNING,
          source: 'dev',
          idempotencyKey: `dr-other-${randomUUID()}`,
          outcome: 'received',
        },
      });
    });
  });

  afterAll(async () => {
    for (const scope of [practiceId, otherPracticeId]) {
      await prisma.withPractice(scope, async (tx) => {
        await tx.visitState.deleteMany({});
        await tx.arrival.deleteMany({});
        await tx.agreement.deleteMany({});
        await tx.assignor.deleteMany({});
        await tx.patient.deleteMany({});
        await deleteSeededAnchors(tx);
        await tx.provider.deleteMany({});
        await tx.practice.deleteMany({});
      });
    }
    await app?.close();
  });

  // -------------------------------------------------------------------------

  it('the_day_register_lists_everybody_who_came_in_in_arrival_order', async () => {
    const body = await register(`?date=${DAY}`);

    expect(body.date).toBe(DAY);
    expect(body.timezone).toBe(PRACTICE_TIMEZONE);

    /*
     * ARRIVAL ORDER, WHICH IS RECEPTION'S ORDER, and the finished are still
     * here: a register is not a queue, so a signed and stored agreement does
     * not take somebody off it.
     */
    expect(namesIn(body)).toEqual([
      'Jamie Earlybird', // 01:00 — the row a UTC boundary loses
      'Alex Nursevisit', // 09:30
      null, // 12:00 — an arrival that never resolved to a record
      'Casey Correctedaddress', // 23:30 — the row an hour-out boundary loses
    ]);

    // Yesterday's visit and the refused message are both absent.
    const said = JSON.stringify(body);
    expect(said).not.toContain('Yesterdayvisit');
    expect(said).not.toContain('Refusedarrival');

    const signed = body.rows.find((row) => row.arrivalId === signedArrivalId)!;
    expect(signed.patientRecordNumber).toBe('DR-EARLY-1');
    expect(signed.seenByName).toBe('Dr Sample Chen');
    expect(signed.agreementSigned).toBe(true);
    expect(signed.agreementStatus).toBe('stored');
    // Nobody said where this visit got to, so the register does not say either.
    expect(signed.visitState).toBeNull();
  });

  it('the_day_register_day_boundary_is_the_practices_clock_not_utc', async () => {
    /*
     * THE ONE TEST THIS ENDPOINT EXISTS TO PASS. `Jamie Earlybird` arrived at
     * 15:00 UTC on the 11th, which is 1am on the 12th in Sydney. A register
     * built on `toISOString().slice(0, 10)` — the defect in `today()` — would
     * file that visit under the 11th and leave the 12th's register missing its
     * first patient. And `Sam Yesterdayvisit`, at 09:00 on the 11th in Sydney,
     * must be on the 11th and nowhere near the 12th.
     */
    const theTwelfth = await register(`?date=${DAY}`);
    expect(namesIn(theTwelfth)).toContain('Jamie Earlybird');
    expect(namesIn(theTwelfth)).not.toContain('Sam Yesterdayvisit');

    const theEleventh = await register(`?date=${DAY_BEFORE}`);
    expect(namesIn(theEleventh)).toEqual(['Sam Yesterdayvisit']);
    expect(namesIn(theEleventh)).not.toContain('Jamie Earlybird');

    /*
     * AND THE LAST HALF HOUR OF THE PRACTICE'S DAY IS STILL ITS OWN DAY. Casey
     * arrived at 13:30 UTC on the 12th — 23:30 in Sydney — so a UTC window
     * would keep them and a window an hour out would lose them. Neither the
     * 13th nor the 11th may claim them.
     */
    expect(namesIn(theTwelfth)).toContain('Casey Correctedaddress');
    expect(namesIn(await register('?date=2026-09-13'))).toEqual([]);
  });

  it('the_day_register_shows_the_newest_agreement_in_the_chain', async () => {
    /*
     * The arrival names the SUPERSEDED row; the successor is what was signed.
     * Reading the arrival's own agreement would report an unsigned draft for
     * somebody who signed the correction.
     */
    const body = await register(`?date=${DAY}`);
    const row = body.rows.find((r) => r.arrivalId === correctedArrivalId)!;

    expect(row.agreementId).toBe(successorAgreementId);
    expect(row.agreementId).not.toBe(supersededAgreementId);
    expect(row.agreementSigned).toBe(true);
    expect(row.visitState).toBe('completed');
  });

  it('the_day_register_names_the_agreement_provider_only_when_it_differs', async () => {
    const body = await register(`?date=${DAY}`);

    // The nurse's patient: seen by the nurse, agreement anchored on the GP.
    const nursed = body.rows.find((r) => r.patientName === 'Alex Nursevisit')!;
    expect(nursed.seenByName).toBe('Nurse Sample Patel');
    expect(nursed.agreementProviderName).toBe('Dr Sample Chen');

    // An ordinary GP visit: the two are one person, so nothing is said twice.
    const ordinary = body.rows.find((r) => r.arrivalId === signedArrivalId)!;
    expect(ordinary.agreementProviderName).toBeNull();
  });

  it('the_day_register_lists_an_arrival_that_never_resolved_to_a_patient', async () => {
    /*
     * A REGISTER THAT QUIETLY OMITTED THEM WOULD BE WRONG WITHOUT SAYING SO.
     * `Arrival.patientId` is null only where resolution failed; somebody still
     * walked in, and the practice's own handle is what reception has.
     */
    const body = await register(`?date=${DAY}`);
    const row = body.rows.find((r) => r.arrivalId === unresolvedArrivalId)!;

    expect(row.patientId).toBeNull();
    expect(row.patientName).toBeNull();
    expect(row.patientRecordNumber).toBe('DR-UNKNOWN-9');
    expect(row.agreementId).toBeNull();
    expect(row.agreementSigned).toBe(false);
  });

  it('the_day_register_across_a_practice_boundary_finds_nothing', async () => {
    /*
     * BY RLS, NOT BY A FILTER. The other practice's own request sees only its
     * own row, and this practice's sees none of theirs — neither request is
     * refused, and neither can be widened by anything in the query string.
     */
    const theirs = await register(`?date=${DAY}`, otherPracticeId);
    expect(namesIn(theirs)).toEqual(['Pat Otherpractice']);

    const ours = await register(`?date=${DAY}`);
    expect(JSON.stringify(ours)).not.toContain('Otherpractice');
  });

  it('the_day_register_carries_no_medicare_number_and_no_amount', async () => {
    /*
     * HARD RULES 1, 4 AND 9. There is no field on `DayRegisterRow` for a
     * Medicare card number, a date of birth, an address or an amount — the
     * absence of the field is the enforcement, and this asserts the wire agrees
     * with the type. The patient record number IS an approved identifier
     * (REQ-VER-02) and is deliberately present.
     */
    const body = await register(`?date=${DAY}`);
    const said = JSON.stringify(body);

    expect(said).not.toMatch(/medicare/i);
    expect(said).not.toMatch(/dateOfBirth|date_of_birth/i);
    expect(said).not.toMatch(/\bamount\b|\bbenefit\b|\$/i);
    expect(said).not.toContain('Example Street');

    for (const row of body.rows) {
      expect(Object.keys(row).sort()).toEqual(
        [
          'agreementId',
          'agreementProviderName',
          'agreementSigned',
          'agreementStatus',
          'arrivalId',
          'arrivedAt',
          'patientId',
          'patientName',
          'patientRecordNumber',
          'seenByName',
          'visitState',
        ].sort(),
      );
    }
  });

  it('the_day_register_defaults_to_today_and_refuses_a_date_that_is_not_a_day', async () => {
    /*
     * NO DATE IS THE ORDINARY CASE and means today by the practice's clock —
     * the SERVER's answer, so it cannot be asserted against a literal without
     * making this suite fail tomorrow (wow.md §2 item 6). What is assertable is
     * the shape and the zone.
     */
    const today = await register('');
    expect(today.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(today.timezone).toBe(PRACTICE_TIMEZONE);

    // And a date that is not a day is refused out loud rather than nudged.
    for (const bad of ['12%2F09%2F2026', 'yesterday', '2026-02-31', '2026-13-01']) {
      await request(app.getHttpServer()).get(`/arrivals/day?date=${bad}`).set('x-practice-id', practiceId).expect(400);
    }
  });
});
