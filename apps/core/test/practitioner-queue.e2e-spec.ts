import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { WaitingList } from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PractitionerQueueService } from '../src/practitioner-queue/practitioner-queue.service';
import type { Actor } from '../src/auth/actor.decorator';
import { createServicingProvider, deleteSeededAnchors } from './anchor';

/**
 * WHO IS WAITING FOR ME, AND IS THEIR PAPERWORK DONE
 * (PRACTITIONER-QUEUE-PAGE.md §7; Carl, 12 September 2026).
 *
 * WHAT THIS SUITE IS FOR. The page's two dangerous properties are both
 * properties of the QUERY, not of the screen: whose patients come back, and
 * what comes back about them. §4.2 requires the scoping to be *"enforced at the
 * query"*, so it is asserted here rather than through a component that could be
 * rendering a list somebody else's request already assembled.
 *
 * THE PRACTITIONER'S OWN MODE IS DRIVEN THROUGH THE SERVICE, not the route.
 * `AUTH_ENFORCE` is off in e2e, so no verified token reaches the controller and
 * there is no principal for `@SessionActor` to read — the HTTP layer therefore
 * exercises only the practice-wide mode. Calling the service with an actor is
 * the honest way to test the branch a real practitioner's token takes, and it
 * tests the thing that matters: the filter, not the decorator.
 *
 * FAKE IDENTITIES ONLY, and no Medicare-format number exists anywhere in it
 * because there is no column for one (hard rule 1).
 */
describe('the practitioner queue — who is waiting for me (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let queue: PractitionerQueueService;

  const practiceId = randomUUID();
  const otherPracticeId = randomUUID();

  let gp: Awaited<ReturnType<typeof createServicingProvider>>;
  let secondGp: Awaited<ReturnType<typeof createServicingProvider>>;
  let nurse: Awaited<ReturnType<typeof createServicingProvider>>;
  let phlebotomist: Awaited<ReturnType<typeof createServicingProvider>>;
  let otherPracticeGp: Awaited<ReturnType<typeof createServicingProvider>>;

  /** The actor a practitioner's token produces. Nothing else about them matters here. */
  const asPractitioner = (practitionerId: string): Actor => ({
    id: `keycloak-${practitionerId}`,
    name: 'A practitioner',
    principalType: 'user',
    roles: ['provider'],
    practitionerId,
  });

  const namesIn = (list: WaitingList): string[] =>
    list.groups.flatMap((group) => group.rows.map((row) => row.patientName));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    queue = app.get(PractitionerQueueService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'Waiting List Test Practice' } });

      gp = await createServicingProvider(tx, practiceId, { name: 'Dr Sample Chen' });
      secondGp = await createServicingProvider(tx, practiceId, {
        name: 'Dr Other Sampleton',
        locationId: gp.locationId,
      });
      // A nurse: works under a provider, so the claim goes under the GP and
      // the nurse may never be named on the agreement (hard rule 6 territory).
      nurse = await createServicingProvider(tx, practiceId, {
        name: 'Nurse Sample Patel',
        providerType: 'registered_nurse',
        billingRole: 'works_under_provider',
        locationId: gp.locationId,
      });
      // A phlebotomist: no Medicare claim at all, so no agreement, ever.
      phlebotomist = await createServicingProvider(tx, practiceId, {
        name: 'Sample Ray',
        providerType: 'registered_nurse',
        billingRole: 'not_billable',
        locationId: gp.locationId,
      });

      const patient = async (givenNames: string, familyName: string) =>
        (
          await tx.patient.create({
            data: {
              practiceId,
              givenNames,
              familyName,
              dateOfBirth: new Date('1970-01-01'),
              address: '3 Example Street, Sampletown NSW 2000',
              patientRecordNumber: `PQ-${randomUUID().slice(0, 8)}`,
            },
          })
        ).id;

      const assignorFor = async (name: string) =>
        (await tx.assignor.create({ data: { practiceId, name, authorityBasis: 'self' } })).id;

      const agreementFor = async (
        patientId: string,
        affiliationId: string,
        over: { status?: string; signatureEventId?: string } = {},
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

      const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

      /*
       * TYPED RATHER THAN `Record<string, unknown>`. A loose spread compiles
       * against Prisma's required fields by accident — `arrivedAt` is not
       * optional, and the spread hid that from `tsc` while the runtime happened
       * to supply it. CI typechecks the test folder, so the looser helper broke
       * the build without breaking a single assertion.
       */
      type ArrivalSeed = Omit<
        Parameters<typeof tx.arrival.create>[0]['data'],
        'practiceId' | 'pmsPatientRecordNumber' | 'source' | 'idempotencyKey' | 'outcome'
      >;
      const arrive = (over: ArrivalSeed) =>
        tx.arrival.create({
          data: {
            practiceId,
            pmsPatientRecordNumber: `PQ-ARR-${randomUUID().slice(0, 8)}`,
            source: 'dev',
            idempotencyKey: `pq-${randomUUID()}`,
            outcome: 'received',
            ...over,
          },
        });

      // -------- Dr Chen's morning ------------------------------------------
      // Signed and stored: the only thing that may read "Done".
      const signedPatient = await patient('Jamie', 'Signedalready');
      await arrive({
        patientId: signedPatient,
        affiliationId: gp.affiliationId,
        seeingAffiliationId: gp.affiliationId,
        arrivedAt: minutesAgo(50),
        visitDecision: 'episodic_pre',
        decisionReason: 'episodic_for_this_visit',
        policyVersion: 'visit-policy-3',
        agreementId: await agreementFor(signedPatient, gp.affiliationId, {
          status: 'stored',
          signatureEventId: randomUUID(),
        }),
      });

      // Drafted, unsigned, nobody holding a tablet: "Not yet".
      const waitingPatient = await patient('Casey', 'Notsignedyet');
      await arrive({
        patientId: waitingPatient,
        affiliationId: gp.affiliationId,
        seeingAffiliationId: gp.affiliationId,
        arrivedAt: minutesAgo(30),
        visitDecision: 'episodic_pre',
        decisionReason: 'episodic_for_this_visit',
        policyVersion: 'visit-policy-3',
        agreementId: await agreementFor(waitingPatient, gp.affiliationId),
      });

      // -------- Dr Sampleton's morning, which Dr Chen must never see -------
      const otherDoctorsPatient = await patient('Robin', 'Someoneelses');
      await arrive({
        patientId: otherDoctorsPatient,
        affiliationId: secondGp.affiliationId,
        seeingAffiliationId: secondGp.affiliationId,
        arrivedAt: minutesAgo(20),
        visitDecision: 'episodic_pre',
        decisionReason: 'episodic_for_this_visit',
        policyVersion: 'visit-policy-3',
        agreementId: await agreementFor(otherDoctorsPatient, secondGp.affiliationId),
      });

      // -------- The nurse's patient: seen by the nurse, billed to the GP ---
      const nursePatient = await patient('Alex', 'Nursevisit');
      await arrive({
        patientId: nursePatient,
        affiliationId: gp.affiliationId,
        seeingAffiliationId: nurse.affiliationId,
        arrivedAt: minutesAgo(15),
        visitDecision: 'episodic_pre',
        decisionReason: 'episodic_for_this_visit',
        policyVersion: 'visit-policy-3',
        agreementId: await agreementFor(nursePatient, gp.affiliationId),
      });

      // -------- The phlebotomist's patient: no claim, no agreement ---------
      const bloodsPatient = await patient('Sam', 'Bloodsonly');
      await arrive({
        patientId: bloodsPatient,
        affiliationId: null,
        seeingAffiliationId: phlebotomist.affiliationId,
        arrivedAt: minutesAgo(10),
        visitDecision: 'none',
        decisionReason: 'seen_by_a_practitioner_who_does_not_bill',
        policyVersion: 'visit-policy-3',
        agreementId: null,
      });
    });

    await prisma.withPractice(otherPracticeId, async (tx) => {
      await tx.practice.create({ data: { id: otherPracticeId, name: 'Somebody Else Medical' } });
      otherPracticeGp = await createServicingProvider(tx, otherPracticeId, { name: 'Dr Elsewhere Sample' });
      const theirs = await tx.patient.create({
        data: {
          practiceId: otherPracticeId,
          givenNames: 'Pat',
          familyName: 'Otherpractice',
          dateOfBirth: new Date('1970-01-01'),
          patientRecordNumber: 'PQ-OTHER-1',
        },
      });
      await tx.arrival.create({
        data: {
          practiceId: otherPracticeId,
          patientId: theirs.id,
          pmsPatientRecordNumber: 'PQ-OTHER-1',
          affiliationId: otherPracticeGp.affiliationId,
          seeingAffiliationId: otherPracticeGp.affiliationId,
          arrivedAt: new Date(),
          source: 'dev',
          idempotencyKey: `pq-other-${randomUUID()}`,
          outcome: 'received',
        },
      });
    });
  });

  afterAll(async () => {
    for (const scope of [practiceId, otherPracticeId]) {
      await prisma.withPractice(scope, async (tx) => {
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

  it('the_waiting_list_shows_only_this_practitioners_patients', async () => {
    /*
     * §4.2: *"Never show another practitioner's list. Scoped to the signed-in
     * practitioner, enforced at the query, with a cross-practice and
     * cross-practitioner test that fails closed."* Both halves are here.
     */
    const mine = await queue.waiting(asPractitioner(gp.practitionerId), practiceId);
    expect(mine.scope).toBe('mine');

    // Dr Chen's own two, and the nurse's patient is NOT one of them: that
    // person came to see the nurse, whatever the claim says (§6a).
    expect(namesIn(mine).sort()).toEqual(['Casey Notsignedyet', 'Jamie Signedalready']);

    const said = JSON.stringify(mine);
    for (const notMine of ['Someoneelses', 'Nursevisit', 'Bloodsonly', 'Otherpractice']) {
      expect(said).not.toContain(notMine);
    }
  });

  it('the_waiting_list_across_a_practice_boundary_finds_nothing', async () => {
    /*
     * FAILS CLOSED TWICE OVER. A practitioner naming a practice they do not
     * work at is refused before the RLS scope is even opened — and the refusal
     * names no practice, because a message that confirmed one would be a small
     * directory of practices for anybody with a practitioner account.
     */
    await expect(queue.waiting(asPractitioner(gp.practitionerId), otherPracticeId)).rejects.toThrow(
      /do not work at the practice/i,
    );

    // And the other practice's own request, over HTTP, sees only its own row —
    // by RLS rather than by a filter.
    const theirs = await request(app.getHttpServer())
      .get('/practitioner-queue/waiting')
      .set('x-practice-id', otherPracticeId)
      .expect(200);
    expect(JSON.stringify(theirs.body)).not.toContain('Signedalready');
    expect(JSON.stringify(theirs.body)).toContain('Otherpractice');
  });

  it('a_nurse_sees_only_the_patients_here_to_see_them', async () => {
    /*
     * §6a. The nurse's patient is billed under the GP, and before
     * `seeingAffiliationId` existed that fact was the only one recorded — so
     * the nurse had no queue at all. Now the two facts are separate and each
     * list is right.
     */
    const theirs = await queue.waiting(asPractitioner(nurse.practitionerId), practiceId);
    expect(namesIn(theirs)).toEqual(['Alex Nursevisit']);
  });

  it('a_nurses_page_names_whose_agreement_it_is', async () => {
    /*
     * §6a: *"'Dr Chen's agreement — done' is honest; 'your agreement' would not
     * be."* And it is named ONLY where it differs: on the GP's own list the
     * field is null, because saying "Dr Chen's agreement" to Dr Chen is noise.
     */
    const nurses = await queue.waiting(asPractitioner(nurse.practitionerId), practiceId);
    expect(nurses.groups[0]!.rows[0]!.agreementProviderName).toBe('Dr Sample Chen');

    const gps = await queue.waiting(asPractitioner(gp.practitionerId), practiceId);
    for (const row of gps.groups.flatMap((group) => group.rows)) {
      expect(row.agreementProviderName).toBeNull();
    }
  });

  it('a_phlebotomists_patient_is_not_shown_as_outstanding', async () => {
    /*
     * ARRIVAL-WHO-IS-SEEN.md §3: a patient who came only for a specimen
     * collection generates no claim, so there is nothing to sign and `none` is
     * a complete answer. "Not yet" against them would be a permanent false
     * alarm on the one page that exists to say whether anything is
     * outstanding. Flagged for Carl: §3 of the queue plan named three words
     * and this is a fourth.
     */
    const theirs = await queue.waiting(asPractitioner(phlebotomist.practitionerId), practiceId);
    expect(namesIn(theirs)).toEqual(['Sam Bloodsonly']);
    expect(theirs.groups[0]!.rows[0]!.paperwork).toBe('nothing_to_sign');
  });

  it('paperwork_reads_done_only_when_it_is_signed_and_stored', async () => {
    // Driven from real rows rather than from the flattening function, so the
    // claim covers the READ as well as the mapping: the one with a signature
    // event says Done and the one without does not.
    const mine = await queue.waiting(asPractitioner(gp.practitionerId), practiceId);
    const rows = new Map(mine.groups.flatMap((g) => g.rows).map((r) => [r.patientName, r.paperwork]));

    expect(rows.get('Jamie Signedalready')).toBe('done');
    expect(rows.get('Casey Notsignedyet')).toBe('not_yet');
  });

  it('the_waiting_list_carries_no_clinical_detail', async () => {
    /*
     * §2. Asserted on the SHAPE rather than by spot-checking absences: a field
     * added to this row is a field on a screen, and the boundary this page must
     * not cross is exactly "it quietly became a second waiting room".
     */
    const mine = await queue.waiting(asPractitioner(gp.practitionerId), practiceId);
    for (const row of mine.groups.flatMap((group) => group.rows)) {
      expect(Object.keys(row).sort()).toEqual([
        'agreementProviderName',
        'arrivalId',
        'paperwork',
        'patientName',
        'waitingSince',
      ]);
    }

    const said = JSON.stringify(mine);
    expect(said).not.toMatch(/reason|triage|duration|note|appointmentStatus|serviceDescription/i);
  });

  it('the_waiting_list_carries_no_identifier_values', async () => {
    /*
     * Hard rules 1 and 9. No Medicare number (there is no column for one), no
     * date of birth, no address, no patient record number, no amount (hard
     * rule 4). The patient's own id does not travel either — the row is
     * identified by its arrival.
     */
    const said = JSON.stringify(await queue.waiting(asPractitioner(gp.practitionerId), practiceId));

    expect(said).not.toMatch(/medicare|ihi|dateOfBirth|patientRecordNumber|amount|benefit/i);
    expect(said).not.toContain('1970-01-01');
    expect(said).not.toContain('Example Street');
    // No ten-digit run anywhere: a Medicare card number is ten digits, and the
    // surest way to prove there is not one is that there is no room for one.
    expect(said).not.toMatch(/\d{10}/);
  });

  it('reception_sees_every_practitioners_list_grouped', async () => {
    /*
     * Carl, 12 Sep 2026, widening §3: an administrator, a manager or a
     * receptionist sees ALL of them, grouped by practitioner, because knowing
     * who is waiting for whom is the front desk's job. Over HTTP with a
     * practice header and no practitioner claim, which is exactly what a
     * practice user's token produces.
     */
    const res = await request(app.getHttpServer())
      .get('/practitioner-queue/waiting')
      .set('x-practice-id', practiceId)
      .expect(200);

    const body = res.body as WaitingList;
    expect(body.scope).toBe('practice');

    const byPractitioner = new Map(
      body.groups.map((group) => [group.practitionerName, group.rows.map((row) => row.patientName)]),
    );
    expect(byPractitioner.get('Dr Sample Chen')!.sort()).toEqual(['Casey Notsignedyet', 'Jamie Signedalready']);
    expect(byPractitioner.get('Dr Other Sampleton')).toEqual(['Robin Someoneelses']);
    expect(byPractitioner.get('Nurse Sample Patel')).toEqual(['Alex Nursevisit']);
    expect(byPractitioner.get('Sample Ray')).toEqual(['Sam Bloodsonly']);
  });

  it('the_waiting_list_is_ordered_by_who_arrived_first', async () => {
    // §3: reception's order — arrival order. Nothing on this page re-sorts it,
    // and it is not a countdown and not a target.
    const res = await request(app.getHttpServer())
      .get('/practitioner-queue/waiting')
      .set('x-practice-id', practiceId)
      .expect(200);

    const body = res.body as WaitingList;
    const times = body.groups.flatMap((group) => group.rows.map((row) => Date.parse(row.waitingSince)));
    expect(times.length).toBeGreaterThan(0);
    for (const time of times) expect(Number.isNaN(time)).toBe(false);

    const chen = body.groups.find((group) => group.practitionerName === 'Dr Sample Chen')!;
    expect(chen.rows.map((row) => row.patientName)).toEqual(['Jamie Signedalready', 'Casey Notsignedyet']);
  });
});
