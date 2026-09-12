import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { REASSIGNMENT_TASK_KIND, VISIT_STATES_VERSION, type WaitingList } from '@aobplatform/domain';
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

  /*
   * THE ARRIVALS THE STATE TESTS ACT ON. Held by id because §3a's write is
   * addressed by the ARRIVAL — a visit is one patient on one day — and because
   * a test that re-found them by name would be a test that could find the
   * wrong one after a re-seed.
   */
  let signedArrivalId: string;
  let waitingArrivalId: string;
  let otherDoctorsArrivalId: string;
  let bloodsArrivalId: string;
  let otherPracticeArrivalId: string;
  let nurseArrivalId: string;
  let signedPatientId: string;
  let waitingPatientId: string;

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
      signedPatientId = signedPatient;
      signedArrivalId = (await arrive({
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
      })).id;

      // Drafted, unsigned, nobody holding a tablet: "Not yet".
      const waitingPatient = await patient('Casey', 'Notsignedyet');
      waitingPatientId = waitingPatient;
      waitingArrivalId = (await arrive({
        patientId: waitingPatient,
        affiliationId: gp.affiliationId,
        seeingAffiliationId: gp.affiliationId,
        arrivedAt: minutesAgo(30),
        visitDecision: 'episodic_pre',
        decisionReason: 'episodic_for_this_visit',
        policyVersion: 'visit-policy-3',
        agreementId: await agreementFor(waitingPatient, gp.affiliationId),
      })).id;

      // -------- Dr Sampleton's morning, which Dr Chen must never see -------
      const otherDoctorsPatient = await patient('Robin', 'Someoneelses');
      otherDoctorsArrivalId = (await arrive({
        patientId: otherDoctorsPatient,
        affiliationId: secondGp.affiliationId,
        seeingAffiliationId: secondGp.affiliationId,
        arrivedAt: minutesAgo(20),
        visitDecision: 'episodic_pre',
        decisionReason: 'episodic_for_this_visit',
        policyVersion: 'visit-policy-3',
        agreementId: await agreementFor(otherDoctorsPatient, secondGp.affiliationId),
      })).id;

      // -------- The nurse's patient: seen by the nurse, billed to the GP ---
      const nursePatient = await patient('Alex', 'Nursevisit');
      nurseArrivalId = (await arrive({
        patientId: nursePatient,
        affiliationId: gp.affiliationId,
        seeingAffiliationId: nurse.affiliationId,
        arrivedAt: minutesAgo(15),
        visitDecision: 'episodic_pre',
        decisionReason: 'episodic_for_this_visit',
        policyVersion: 'visit-policy-3',
        agreementId: await agreementFor(nursePatient, gp.affiliationId),
      })).id;

      // -------- The phlebotomist's patient: no claim, no agreement ---------
      const bloodsPatient = await patient('Sam', 'Bloodsonly');
      bloodsArrivalId = (await arrive({
        patientId: bloodsPatient,
        affiliationId: null,
        seeingAffiliationId: phlebotomist.affiliationId,
        arrivedAt: minutesAgo(10),
        visitDecision: 'none',
        decisionReason: 'seen_by_a_practitioner_who_does_not_bill',
        policyVersion: 'visit-policy-3',
        agreementId: null,
      })).id;
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
      otherPracticeArrivalId = (await tx.arrival.create({
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
      })).id;
    });
  });

  afterAll(async () => {
    for (const scope of [practiceId, otherPracticeId]) {
      await prisma.withPractice(scope, async (tx) => {
        await tx.visitState.deleteMany({});
        await tx.reviewTask.deleteMany({});
        await tx.serviceRecord.deleteMany({});
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
        /*
         * §3a's addition, and the ONLY one. `visitState` is attendance — a
         * person was with a patient, or is no longer — and it says nothing
         * about why they were there or what was found. Everything §2 forbids
         * is still absent, and this assertion is what keeps it that way.
         */
        'visitState',
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

  // ---------------------------------------------------------------------------
  // §3a — A STATUS PER PATIENT, SET FROM THIS PAGE (Carl, 12 September 2026).
  // ---------------------------------------------------------------------------

  it('a_practitioner_may_set_a_state_only_on_their_own_patients', async () => {
    /*
     * §3a rule 2: *"A practitioner may set a state only on their own patients.
     * Reception may set any. Cross-practitioner and cross-practice writes fail
     * closed."*
     *
     * Driven through the SERVICE with a practitioner's actor, for the reason
     * this suite's own docstring gives: `AUTH_ENFORCE` is off in e2e, so no
     * verified token reaches the controller and the HTTP layer only ever
     * exercises the practice-wide mode. The filter is the thing that matters.
     */
    const mine = await queue.setState(
      asPractitioner(gp.practitionerId),
      practiceId,
      waitingArrivalId,
      'with_patient_now',
    );
    expect(mine.state).toBe('with_patient_now');

    // Dr Sampleton's patient is not Dr Chen's to mark, and the refusal names
    // nobody — a message that named the other practitioner would be a roster
    // leak to anybody with a practitioner account.
    await expect(
      queue.setState(asPractitioner(gp.practitionerId), practiceId, otherDoctorsArrivalId, 'completed'),
    ).rejects.toThrow(/did not come to see you/i);
    const refusal = await queue
      .setState(asPractitioner(gp.practitionerId), practiceId, otherDoctorsArrivalId, 'completed')
      .catch((err: Error) => err.message);
    expect(refusal).not.toMatch(/Sampleton|Robin|Someoneelses/);

    // Nothing was written for the refused one.
    const written = await prisma.withPractice(practiceId, (tx) =>
      tx.visitState.findMany({ where: { arrivalId: otherDoctorsArrivalId } }),
    );
    expect(written).toHaveLength(0);

    // And RECEPTION may set any — a clinician who forgot is the ordinary case
    // and the desk is who notices (VISIT-CHECKLIST.md §5).
    const desk = await queue.setState(undefined, practiceId, otherDoctorsArrivalId, 'with_patient_now');
    expect(desk.state).toBe('with_patient_now');
  });

  it('state_changes_across_a_practice_boundary_fail_closed', async () => {
    /*
     * TWICE OVER, as the read is. A practitioner naming a practice they do not
     * work at is refused before any RLS scope opens; and a practice-scoped
     * caller reaching for another practice's arrival finds nothing, because RLS
     * never returns the row — so the answer is "no such visit" and gives away
     * nothing about whose it was.
     */
    await expect(
      queue.setState(asPractitioner(gp.practitionerId), otherPracticeId, otherPracticeArrivalId, 'completed'),
    ).rejects.toThrow(/do not work at the practice/i);

    await expect(
      queue.setState(undefined, practiceId, otherPracticeArrivalId, 'completed'),
    ).rejects.toThrow(/no visit here/i);

    // Nothing was written in either practice.
    for (const scope of [practiceId, otherPracticeId]) {
      const rows = await prisma.withPractice(scope, (tx) =>
        tx.visitState.findMany({ where: { arrivalId: otherPracticeArrivalId } }),
      );
      expect(rows).toHaveLength(0);
    }
  });

  it('a_state_change_records_who_and_when_and_no_text', async () => {
    /*
     * §3a rule 1: *"It is attendance, not clinical documentation. Who, what
     * state, when — from the token. No free text anywhere."*
     *
     * Asserted on the ROW'S SHAPE as well as its values: a column added here is
     * a place for a clinical note to land, and the whole rule is that there is
     * nowhere for one to go.
     */
    const before = new Date();
    await queue.setState(asPractitioner(gp.practitionerId), practiceId, signedArrivalId, 'with_patient_now');

    const row = await prisma.withPractice(practiceId, (tx) =>
      tx.visitState.findFirst({ where: { arrivalId: signedArrivalId }, orderBy: { setAt: 'desc' } }),
    );
    expect(row).toBeTruthy();

    // WHO — the principal from the token, and never a typed name.
    expect(row!.setByPrincipalId).toBe(`keycloak-${gp.practitionerId}`);
    expect(row!.setByPrincipalType).toBe('user');
    // WHEN — the server's clock.
    expect(row!.setAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    // Hard rule 14 — which version of the list it was chosen from.
    expect(row!.statesVersion).toBe(VISIT_STATES_VERSION);

    // AND NO TEXT. No column named for a note, a reason or a person's name, and
    // no identifier value or amount anywhere in what was stored (hard rules 1,
    // 4 and 9).
    expect(Object.keys(row!).sort()).toEqual([
      'arrivalId',
      'id',
      'practiceId',
      'renderedOutcome',
      'reviewTaskId',
      'serviceRecordId',
      'setAt',
      'setByPrincipalId',
      'setByPrincipalType',
      'state',
      'statesVersion',
    ]);
    const said = JSON.stringify(row);
    expect(said).not.toMatch(/note|reason|comment|Jamie|Signedalready|amount|benefit|medicare/i);

    /*
     * `pending` IS REFUSED. §3a's table gives the starting state no setter, and
     * storing one would be a person moving a patient backwards into "not yet
     * seen" after the service-rendered signal had already gone.
     */
    await expect(
      queue.setState(asPractitioner(gp.practitionerId), practiceId, signedArrivalId, 'pending'),
    ).rejects.toThrow(/where every visit starts/i);
    await expect(
      queue.setState(asPractitioner(gp.practitionerId), practiceId, signedArrivalId, 'had_a_lovely_chat'),
    ).rejects.toThrow(/not a state anybody can set/i);
  });

  it('a_state_can_be_corrected_and_the_correction_is_kept', async () => {
    /*
     * §3a rule 6: *"Reversible and recorded. A wrong state is corrected, and
     * the correction is kept beside the original rather than over it."* So the
     * second press is an INSERT: two rows survive, the list reads the newer,
     * and the older one is still there to say what somebody thought at the time.
     */
    await queue.setState(undefined, practiceId, bloodsArrivalId, 'completed');
    await queue.setState(undefined, practiceId, bloodsArrivalId, 'with_patient_now');

    const rows = await prisma.withPractice(practiceId, (tx) =>
      tx.visitState.findMany({ where: { arrivalId: bloodsArrivalId }, orderBy: { setAt: 'asc' } }),
    );
    expect(rows.map((row) => row.state)).toEqual(['completed', 'with_patient_now']);

    // And the list reads the newer one.
    const list = await queue.waiting(asPractitioner(phlebotomist.practitionerId), practiceId);
    expect(list.groups[0]!.rows[0]!.visitState).toBe('with_patient_now');
  });

  it('an_unset_state_never_gates_a_consultation_or_a_bill', async () => {
    /*
     * §3a rule 5, hard rule 8, REQ-REC-04. An untouched visit reads `pending`,
     * and nothing anywhere reads that value to decide whether the patient may
     * be seen or billed — the paperwork answer is computed from the AGREEMENT
     * and is unchanged by any state.
     */
    const before = await queue.waiting(asPractitioner(secondGp.practitionerId), practiceId);
    const row = before.groups[0]!.rows[0]!;
    const paperworkBefore = row.paperwork;

    // Every state in turn, and the paperwork answer never moves.
    for (const state of ['with_patient_now', 'completed', 'reassign']) {
      await queue.setState(undefined, practiceId, otherDoctorsArrivalId, state);
      const after = await queue.waiting(asPractitioner(secondGp.practitionerId), practiceId);
      expect(after.groups[0]!.rows[0]!.paperwork).toBe(paperworkBefore);
      // And the patient is still ON the list — no state removes anybody.
      expect(after.groups[0]!.rows.map((r) => r.arrivalId)).toContain(otherDoctorsArrivalId);
    }
  });

  it('reassign_creates_a_front_desk_task_and_moves_nobody', async () => {
    /*
     * §3a rule 4: *"Reassign never reassigns. A practitioner pressing it says
     * 'not me'. Who the patient DOES see is reception's decision on the front
     * desk page, where the covering-doctor check runs before anything is
     * re-papered."*
     *
     * So this asserts BOTH halves, and the second is the one that matters: a
     * task exists, and NOTHING about the arrival, the agreement or the grouping
     * has moved.
     */
    const arrivalBefore = await prisma.withPractice(practiceId, (tx) =>
      tx.arrival.findUnique({ where: { id: waitingArrivalId } }),
    );

    const receipt = await queue.setState(
      asPractitioner(gp.practitionerId),
      practiceId,
      waitingArrivalId,
      'reassign',
    );
    expect(receipt.reviewTaskId).toBeTruthy();

    // A TASK FOR RECEPTION, on the existing queue, subject the PATIENT so it
    // lands on their own work page at the desk.
    const task = await prisma.withPractice(practiceId, (tx) =>
      tx.reviewTask.findUnique({ where: { id: receipt.reviewTaskId! } }),
    );
    expect(task!.kind).toBe(REASSIGNMENT_TASK_KIND);
    expect(task!.subjectType).toBe('Patient');
    expect(task!.subjectId).toBe(waitingPatientId);
    expect(task!.state).toBe('open');
    // The summary is OURS and fixed — no free text reached it (§3a rule 1).
    expect(task!.summary).toMatch(/Nobody has been moved/i);
    expect(JSON.stringify(task!.detail)).toContain(waitingArrivalId);
    // And no patient name or identifier value travelled onto it.
    expect(JSON.stringify(task)).not.toMatch(/Casey|Notsignedyet|1970-01-01|Example Street/);

    // AND NOBODY MOVED. Every field on the arrival is exactly as it was.
    const arrivalAfter = await prisma.withPractice(practiceId, (tx) =>
      tx.arrival.findUnique({ where: { id: waitingArrivalId } }),
    );
    expect(arrivalAfter).toEqual(arrivalBefore);

    // Still on the same practitioner's list, still grouped under them.
    const list = await queue.waiting(asPractitioner(gp.practitionerId), practiceId);
    const still = list.groups.flatMap((g) => g.rows).find((r) => r.arrivalId === waitingArrivalId);
    expect(still).toBeTruthy();
    expect(still!.visitState).toBe('reassign');
    expect(list.groups.find((g) => g.affiliationId === gp.affiliationId)).toBeTruthy();
  });

  it('completed_raises_the_post_service_agreement', async () => {
    /*
     * §3a rule 3 and VISIT-CHECKLIST.md §6: *"Completed is the service-rendered
     * signal. It is what raises the post-service agreement automatically."*
     *
     * WHAT THIS PAGE CANNOT SUPPLY, AND WHY THE TEST IS SHAPED LIKE THIS. A
     * post-service agreement's particulars include D6b — the MBS item
     * number(s) — and REQ-REG-01 sources them from the PMS INVOICE. A
     * practitioner pressing "Completed" does not know them and this platform
     * never invents a statutory particular (CLAUDE.md §7). So the signal is
     * passed through only where the practice's own software has ALREADY said
     * what was done, and the row below is what `PmsSyncService` writes from an
     * invoice: D5 and D6b, and no decision yet.
     */
    const invoiceKey = `pq-invoice-${randomUUID()}`;
    await prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.create({
        data: {
          practiceId,
          pmsInvoiceKey: invoiceKey,
          patientId: signedPatientId,
          affiliationId: gp.affiliationId,
          serviceDate: new Date(),
          // Obviously fake, and shape-valid: the point is that they came from
          // the PMS and not from this page.
          mbsItemNumbers: ['23'],
        },
      }),
    );

    const receipt = await queue.setState(
      asPractitioner(gp.practitionerId),
      practiceId,
      signedArrivalId,
      'completed',
    );

    // THE POST-SERVICE QUESTION WAS ASKED, and the versioned table answered it.
    expect(receipt.renderedOutcome).toBe('raised');
    const decided = await prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.findFirst({ where: { pmsInvoiceKey: invoiceKey } }),
    );
    expect(decided!.visitDecision).toBeTruthy();
    // Hard rule 14: the answer carries the version of the table that gave it.
    expect(decided!.policyVersion).toBeTruthy();
    /*
     * THIS PATIENT'S PRE-AGREEMENT WAS SIGNED TODAY, so the honest answer is
     * `covered` and NOTHING NEW IS DRAFTED — asking again would collect a
     * second consent for one service. The decision is the platform's, not this
     * page's, which is the whole point of reusing the path.
     */
    expect(decided!.visitDecision).toBe('covered');

    // The state row remembers which service record the signal came to, so
    // "why was this raised" is answerable later.
    const row = await prisma.withPractice(practiceId, (tx) =>
      tx.visitState.findFirst({ where: { arrivalId: signedArrivalId, state: 'completed' }, orderBy: { setAt: 'desc' } }),
    );
    expect(row!.serviceRecordId).toBe(decided!.id);
    expect(row!.renderedOutcome).toBe('raised');
  });

  it('completed_records_the_state_and_invents_no_item_numbers', async () => {
    /*
     * THE ORDINARY CASE TODAY, AND IT IS FOR CARL (wow.md §9). Nothing has told
     * us what was done: no invoice, no item numbers. A post-service agreement
     * cannot be drafted without D6b (REQ-REG-01) and the platform must never
     * infer a statutory particular (CLAUDE.md §7: *"Never invent regulatory
     * facts"*).
     *
     * So the state IS recorded — hard rule 8, the press is never refused and
     * care is never slowed — the reason is recorded beside it, and NOT ONE
     * AGREEMENT is drafted.
     */
    const agreementsBefore = await prisma.withPractice(practiceId, (tx) => tx.agreement.count());

    const receipt = await queue.setState(undefined, practiceId, waitingArrivalId, 'completed');

    expect(receipt.state).toBe('completed');
    expect(receipt.renderedOutcome).toBe('awaiting_item_numbers');

    // Nothing drafted, nothing invented.
    expect(await prisma.withPractice(practiceId, (tx) => tx.agreement.count())).toBe(agreementsBefore);
    const records = await prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.findMany({ where: { patientId: waitingPatientId } }),
    );
    expect(records).toHaveLength(0);

    // And the patient is still seen and still billable: nothing was blocked.
    const list = await queue.waiting(undefined, practiceId);
    expect(list.groups.flatMap((g) => g.rows).map((r) => r.arrivalId)).toContain(waitingArrivalId);
  });

  it('completed_never_attaches_to_a_service_from_another_day', async () => {
    /*
     * D5 IS THE DAY THE SERVICE WAS RENDERED (REQ-REG-01 D5) and a visit is one
     * patient on ONE DAY. A lookup anchored on "since midnight" with no upper
     * bound would let a `findFirst ... desc` pick up a record from a different
     * day — yesterday's undecided invoice, or a future-dated one — and attach
     * this consultation's signal to it. That would put D5 wrong on a contract,
     * which is the one mistake here that reaches a legal artefact.
     *
     * So the window is the ARRIVAL'S own day, bounded at both ends.
     */
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const staleKey = `pq-stale-${randomUUID()}`;
    await prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.create({
        data: {
          practiceId,
          pmsInvoiceKey: staleKey,
          patientId: waitingPatientId,
          affiliationId: gp.affiliationId,
          serviceDate: yesterday,
          mbsItemNumbers: ['23'],
        },
      }),
    );

    const receipt = await queue.setState(undefined, practiceId, waitingArrivalId, 'completed');

    // Yesterday's row is not this visit's, so nothing is raised against it.
    expect(receipt.renderedOutcome).toBe('awaiting_item_numbers');
    const stale = await prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.findFirst({ where: { pmsInvoiceKey: staleKey } }),
    );
    expect(stale!.visitDecision).toBeNull();
  });

  it('reassign_never_files_a_patient_task_over_an_arrival_that_has_no_patient', async () => {
    /*
     * `Arrival.patientId` is nullable — *"null only if resolution failed"*. A
     * task written as `subjectType: 'Patient'` over an ARRIVAL id would be a
     * row the patient work page can never resolve, and it would look exactly
     * like a task about somebody who does not exist.
     *
     * The request is still RECORDED, because refusing it would be blocking on a
     * missing join (hard rule 8). It simply says what it is about.
     */
    const orphan = await prisma.withPractice(practiceId, (tx) =>
      tx.arrival.create({
        data: {
          practiceId,
          patientId: null,
          pmsPatientRecordNumber: `PQ-ORPHAN-${randomUUID().slice(0, 8)}`,
          affiliationId: gp.affiliationId,
          seeingAffiliationId: gp.affiliationId,
          arrivedAt: new Date(),
          source: 'dev',
          idempotencyKey: `pq-orphan-${randomUUID()}`,
          outcome: 'received',
        },
      }),
    );

    const receipt = await queue.setState(undefined, practiceId, orphan.id, 'reassign');
    expect(receipt.state).toBe('reassign');

    const task = await prisma.withPractice(practiceId, (tx) =>
      tx.reviewTask.findUnique({ where: { id: receipt.reviewTaskId! } }),
    );
    expect(task!.subjectType).toBe('Arrival');
    expect(task!.subjectId).toBe(orphan.id);

    // And it is NOT on any patient's work page, because there is no patient.
    const patientTasks = await prisma.withPractice(practiceId, (tx) =>
      tx.reviewTask.findMany({ where: { kind: REASSIGNMENT_TASK_KIND, subjectType: 'Patient' } }),
    );
    expect(patientTasks.map((t) => t.subjectId)).not.toContain(orphan.id);
  });

  it('a_state_change_writes_its_vault_event_in_the_same_transaction', async () => {
    /*
     * Hard rule 11 and FR-11.2. A state with no record of having been set is
     * structurally impossible, so the event goes through the OUTBOX in the same
     * transaction as the row.
     *
     * AND THE EVENT CARRIES IDS AND A KEY, NOTHING ELSE (hard rules 1, 4 and
     * 9). No patient name, no identifier value, no reason, no amount.
     */
    await queue.setState(asPractitioner(nurse.practitionerId), practiceId, nurseArrivalId, 'with_patient_now');

    const event = await prisma.withPractice(practiceId, (tx) =>
      tx.vaultOutbox.findFirst({
        where: { type: 'visit.state_set', subjectId: nurseArrivalId },
        orderBy: { occurredAt: 'desc' },
      }),
    );
    expect(event).toBeTruthy();
    expect(event!.subjectType).toBe('Arrival');

    const payload = event!.payload as Record<string, unknown>;
    expect(payload.state).toBe('with_patient_now');
    expect(payload.statesVersion).toBe(VISIT_STATES_VERSION);
    expect(payload.arrivalId).toBe(nurseArrivalId);

    const said = JSON.stringify(event);
    expect(said).not.toMatch(/Alex|Nursevisit|1970-01-01|Example Street|amount|benefit|medicare|ihi/i);
    // No ten-digit run: a Medicare card number is ten digits, and the surest
    // proof there is not one is that there is nowhere for one to be.
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
