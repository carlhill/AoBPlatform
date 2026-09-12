import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ArrivalMoveResult, ValidationResponse } from '@aobplatform/contracts';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';
import { createServicingProvider, deleteSeededAnchors } from './anchor';

/**
 * MOVING A PRACTITIONER'S LIST TO SOMEBODY ELSE — the sick-doctor morning
 * (Carl, 12 September 2026; TODO.md "Moving a practitioner's whole list").
 *
 * WHAT THIS SUITE IS FOR. Every dangerous property of this feature is a
 * property of the WRITE, not of the screen: whether a locked agreement is
 * edited rather than superseded (HARD-02, hard rule 2), whether a signed one is
 * touched (hard rule 11), whether somebody who cannot bill can be handed a list
 * (REQ-REG-02), whether the visit policy is re-asked or the old answer carried
 * across (hard rules 6 and 14), whether a partial failure is silent, and
 * whether any of it crosses a practice boundary. All of them are asserted here.
 *
 * THE PRACTICE DOES NOT OFFER ONGOING AGREEMENTS BY DEFAULT, deliberately. It
 * puts the ordinary GP-to-GP move on the EPISODIC path, which is the one the
 * platform can currently validate, lock and render — the s 65C rule set has no
 * enduring path yet (`enduring_rules_not_authored`, a human-authored zone,
 * CLAUDE.md §7). The re-asking of the policy is proved by the coverage row
 * instead, which needs no rule set at all.
 *
 * FAKE IDENTITIES ONLY, and no Medicare-format number appears anywhere because
 * there is nowhere in this domain for one (hard rule 1).
 */

/** Waves the payload through: this suite is not about C8. */
const passingRules = {
  validate: async (): Promise<ValidationResponse> => ({
    valid: true,
    results: [{ rule: 'C8', outcome: 'pass', message: 'D7 is complete.', citation: 's 65C(4)' }],
    ruleSetVersion: 'test-rules-1',
    mappingVersion: 'test-mapping-1',
  }),
};

/** Exact string from the current mapping — anything else and C6 refuses the lock. */
const D6A = 'General practitioner attendance';

/**
 * Ids and timestamps out, so "no ten-digit run" means what it says: a UUID's
 * last group is twelve hex characters that are sometimes all digits, and an
 * assertion a re-run can flip is worse than no assertion (wow.md §2 item 6).
 */
function withoutIdsAndTimes(said: string): string {
  return said
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<at>');
}

describe('moving a practitioner’s patients to somebody else (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const practiceId = randomUUID();
  const otherPracticeId = randomUUID();

  let sick: Awaited<ReturnType<typeof createServicingProvider>>;
  let cover: Awaited<ReturnType<typeof createServicingProvider>>;
  let nurse: Awaited<ReturnType<typeof createServicingProvider>>;
  let elsewhere: Awaited<ReturnType<typeof createServicingProvider>>;
  let theirGp: Awaited<ReturnType<typeof createServicingProvider>>;

  /** One arrival per test — these mutate, so nothing may be shared. */
  const arrivals: Record<string, string> = {};
  const agreements: Record<string, string> = {};
  let coveredPatientId: string;
  let theirArrivalId: string;

  const move = (arrivalIds: string[], toAffiliationId: string, scope = practiceId) =>
    request(app.getHttpServer())
      .post('/arrivals/move')
      .set('x-practice-id', scope)
      .send({ arrivalIds, toAffiliationId });

  const agreementRow = (id: string) =>
    prisma.withPractice(practiceId, (tx) => tx.agreement.findFirst({ where: { id } }));

  const arrivalRow = (id: string, scope = practiceId) =>
    prisma.withPractice(scope, (tx) => tx.arrival.findFirst({ where: { id } }));

  const successorOf = (id: string) =>
    prisma.withPractice(practiceId, (tx) => tx.agreement.findFirst({ where: { supersedesAgreementId: id } }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RULES_CLIENT)
      .useValue(passingRules)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({
        data: {
          id: practiceId,
          name: 'Sick Doctor Test Practice',
          defaultServiceDescription: D6A,
          // See the header: it keeps the ordinary move on the episodic path.
          enduringByDefault: false,
        },
      });

      sick = await createServicingProvider(tx, practiceId, { name: 'Dr Sample Away', locationCode: 'Main' });
      cover = await createServicingProvider(tx, practiceId, {
        name: 'Dr Sample Cover',
        locationId: sick.locationId,
      });
      // Works under a provider: the claim goes under somebody else's number, so
      // a list can never be handed to them (REQ-REG-02).
      nurse = await createServicingProvider(tx, practiceId, {
        name: 'Nurse Sample Patel',
        providerType: 'registered_nurse',
        billingRole: 'works_under_provider',
        locationId: sick.locationId,
      });
      // A GP of this practice — at the OTHER site. D4 is the person AND the
      // place (D-2026-09-12-09).
      elsewhere = await createServicingProvider(tx, practiceId, {
        name: 'Dr Sample Otherside',
        suburb: 'Otherville',
        locationCode: 'After Hours',
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
              patientRecordNumber: `MV-${randomUUID().slice(0, 8)}`,
            },
          })
        ).id;

      const assignorFor = async (name: string) =>
        (await tx.assignor.create({ data: { practiceId, name, authorityBasis: 'self' } })).id;

      const agreementFor = async (
        patientId: string,
        affiliationId: string,
        over: Record<string, unknown> = {},
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
        'practiceId' | 'pmsPatientRecordNumber' | 'source' | 'idempotencyKey' | 'outcome' | 'arrivedAt'
      > & { arrivedAt?: Date };
      const arrive = async (key: string, over: ArrivalSeed) => {
        arrivals[key] = (
          await tx.arrival.create({
            data: {
              practiceId,
              pmsPatientRecordNumber: `MV-ARR-${randomUUID().slice(0, 8)}`,
              source: 'dev',
              idempotencyKey: `mv-${randomUUID()}`,
              outcome: 'received',
              ...over,
              arrivedAt: over.arrivedAt ?? new Date(),
            },
          })
        ).id;
      };

      /** Dr Away's morning: one unsigned, two signed, one for the partial test. */
      const seat = async (key: string, name: [string, string], over: Record<string, unknown> = {}) => {
        const patientId = await patient(name[0], name[1]);
        const assignorId = await assignorFor(`${name[0]} ${name[1]}`);
        agreements[key] = await agreementFor(patientId, sick.affiliationId, over);
        await arrive(key, {
          patientId,
          assignorId,
          affiliationId: sick.affiliationId,
          seeingAffiliationId: sick.affiliationId,
          visitDecision: 'episodic_pre',
          decisionReason: 'episodic_for_this_visit',
          policyVersion: 'visit-policy-3',
          agreementId: agreements[key],
        });
        return patientId;
      };

      const signed = {
        status: 'stored',
        signatureEventId: randomUUID(),
        particularsLockedAt: new Date(),
        serviceDescription: D6A,
        particulars: { serviceDate: new Date().toISOString().slice(0, 10), basicServiceDescription: D6A },
      };

      await seat('unsigned', ['Casey', 'Notsignedyet']);
      await seat('signed', ['Jamie', 'Signedalready'], signed);
      await seat('signedAgain', ['Robin', 'Alsosigned'], signed);
      await seat('partial', ['Frankie', 'Partialmove']);
      await seat('nurseTarget', ['Alex', 'Nursecase']);
      await seat('otherSite', ['Sam', 'Wrongsite']);
      await seat('retry', ['Jules', 'Halfmoved']);

      /*
       * AND A PATIENT WHO ALREADY HOLDS A LIVE ONGOING AGREEMENT WITH THE
       * COVERING GP. Moving them is the case hard rule 6 describes from the
       * other side: what the visit needs has to be re-asked, and the answer for
       * this pair is "nothing".
       */
      coveredPatientId = await seat('covered', ['Alexis', 'Alreadycovered']);
      const enduringId = await agreementFor(coveredPatientId, cover.affiliationId, {
        type: 'enduring',
        enduringPathway: 'mymedicare',
        status: 'stored',
        signatureEventId: randomUUID(),
      });
      await tx.enduringDetail.create({
        data: {
          practiceId,
          agreementId: enduringId,
          notificationMethod: 'sms',
          terminationMethod: 'sms',
          scopeType: 'category',
          scopeValues: ['1'],
          enteredIntoAt: new Date('2026-01-05'),
        },
      });

      /** Already with the covering GP: moving them there again moves nobody. */
      const alreadyThere = await patient('Pat', 'Alreadythere');
      await arrive('alreadyThere', {
        patientId: alreadyThere,
        affiliationId: cover.affiliationId,
        seeingAffiliationId: cover.affiliationId,
        visitDecision: 'episodic_pre',
        decisionReason: 'episodic_for_this_visit',
        policyVersion: 'visit-policy-3',
      });
    });

    await prisma.withPractice(otherPracticeId, async (tx) => {
      await tx.practice.create({ data: { id: otherPracticeId, name: 'Somebody Else Medical' } });
      theirGp = await createServicingProvider(tx, otherPracticeId, { name: 'Dr Elsewhere Sample' });
      const theirs = await tx.patient.create({
        data: {
          practiceId: otherPracticeId,
          givenNames: 'Pat',
          familyName: 'Otherpractice',
          dateOfBirth: new Date('1970-01-01'),
          patientRecordNumber: 'MV-OTHER-1',
        },
      });
      theirArrivalId = (
        await tx.arrival.create({
          data: {
            practiceId: otherPracticeId,
            patientId: theirs.id,
            pmsPatientRecordNumber: 'MV-OTHER-1',
            affiliationId: theirGp.affiliationId,
            seeingAffiliationId: theirGp.affiliationId,
            arrivedAt: new Date(),
            source: 'dev',
            idempotencyKey: `mv-other-${randomUUID()}`,
            outcome: 'received',
          },
        })
      ).id;
    });
  });

  afterAll(async () => {
    for (const scope of [practiceId, otherPracticeId]) {
      await prisma.withPractice(scope, async (tx) => {
        await tx.visitState.deleteMany({});
        await tx.captureRequest.deleteMany({});
        await tx.enduringDetail.deleteMany({});
        await tx.arrival.deleteMany({});
        await tx.artefact.deleteMany({});
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

  it('moving_a_patient_supersedes_an_unsigned_agreement_and_never_edits_it', async () => {
    /*
     * HARD-02 and hard rule 2. D4 is the provider's name and place of practice
     * (s 65C(5)(a)) and it is a PARTICULAR: an agreement made for Dr Away does
     * not describe a service by Dr Cover, and the correction is a NEW agreement
     * rather than a field moved underneath the old one.
     */
    const before = await agreementRow(agreements.unsigned!);
    const res = await move([arrivals.unsigned!], cover.affiliationId).expect(201);
    const body = res.body as ArrivalMoveResult;

    expect(body.movedCount).toBe(1);
    expect(body.refusedCount).toBe(0);
    expect(body.outcomes[0]!.moved).toBe(true);
    expect(body.outcomes[0]!.supersededAgreementId).toBe(agreements.unsigned);
    expect(body.outcomes[0]!.newAgreementId).not.toBe(agreements.unsigned);

    // THE PARENT IS NOT EDITED. Every column it had, it still has.
    expect(await agreementRow(agreements.unsigned!)).toEqual(before);

    // AND THE SUCCESSOR NAMES THE NEW PRACTITIONER.
    const successor = await successorOf(agreements.unsigned!);
    expect(successor!.id).toBe(body.outcomes[0]!.newAgreementId);
    expect(successor!.affiliationId).toBe(cover.affiliationId);
    expect(successor!.supersedesAgreementId).toBe(agreements.unsigned);
    expect(successor!.patientId).toBe(before!.patientId);

    // AND THE ARRIVAL SAYS SO: both who they came to see and who bills.
    const arrival = await arrivalRow(arrivals.unsigned!);
    expect(arrival!.seeingAffiliationId).toBe(cover.affiliationId);
    expect(arrival!.affiliationId).toBe(cover.affiliationId);
  });

  it('a_move_writes_one_vault_event_per_patient_with_ids_and_no_name', async () => {
    /*
     * Hard rule 11 / FR-11.2: the arrival's re-pointing and its event commit
     * together or not at all. Hard rules 1, 4 and 9: ids, the two affiliations
     * and who did it — never a name, an identifier value or an amount.
     */
    await move([arrivals.partial!], cover.affiliationId).expect(201);

    const events = await prisma.withPractice(practiceId, (tx) =>
      tx.vaultOutbox.findMany({ where: { type: 'arrival.practitioner_changed', subjectId: arrivals.partial } }),
    );
    expect(events).toHaveLength(1);
    const payload = events[0]!.payload as Record<string, unknown>;
    expect(events[0]!.subjectType).toBe('Arrival');
    expect(payload.fromAffiliationId).toBe(sick.affiliationId);
    expect(payload.toAffiliationId).toBe(cover.affiliationId);
    expect(payload.fromPractitionerId).toBe(sick.practitionerId);
    expect(payload.toPractitionerId).toBe(cover.practitionerId);
    expect(payload.newAgreementId).toBeTruthy();

    const said = JSON.stringify(events[0]);
    expect(said).not.toMatch(/Frankie|Partialmove|1970-01-01|Example Street|amount|benefit|medicare|ihi/i);
    expect(withoutIdsAndTimes(said)).not.toMatch(/\d{10}/);
  });

  it('a_signed_agreement_is_left_untouched_and_the_move_supersedes_it', async () => {
    /*
     * Carl, 12 September 2026: *"the patient will have to resign a new
     * agreement when they come in."* Supersession never writes to the parent —
     * which is exactly why it is the right tool and why hard rule 11 is not in
     * tension with this. The signed agreement keeps its signature event, its
     * particulars and its status: a true record of what was agreed before the
     * day overtook it. Nothing is voided, cancelled or annotated.
     */
    const before = await agreementRow(agreements.signed!);
    expect(before!.signatureEventId).toBeTruthy();

    const res = await move([arrivals.signed!], cover.affiliationId).expect(201);
    const body = res.body as ArrivalMoveResult;
    expect(body.outcomes[0]!.moved).toBe(true);

    // BYTE FOR BYTE THE SAME ROW — signature event, status, particulars, hash.
    expect(await agreementRow(agreements.signed!)).toEqual(before);

    const successor = await successorOf(agreements.signed!);
    expect(successor).toBeTruthy();
    expect(successor!.affiliationId).toBe(cover.affiliationId);
    expect(successor!.signatureEventId).toBeNull();
  });

  it('a_patient_who_had_signed_is_shown_as_needing_a_new_signature', async () => {
    /*
     * The desk has to be able to act on it: this patient has signed for the
     * practitioner they are leaving and must sign again for the one who will
     * actually see them — AT THE DESK when they come in. No message goes out
     * (D-2026-09-12-03; TODO.md item 1), and the count is what the summary
     * says out loud.
     */
    const res = await move([arrivals.signedAgain!, arrivals.nurseTarget!], cover.affiliationId).expect(201);
    const body = res.body as ArrivalMoveResult;

    const hadSigned = body.outcomes.find((o) => o.arrivalId === arrivals.signedAgain)!;
    const hadNot = body.outcomes.find((o) => o.arrivalId === arrivals.nurseTarget)!;
    expect(hadSigned.needsANewSignature).toBe(true);
    expect(hadNot.needsANewSignature).toBe(false);
    expect(body.needsANewSignatureCount).toBe(1);
  });

  it('a_practitioner_who_cannot_bill_cannot_receive_a_list', async () => {
    /*
     * REQ-REG-02: the provider on an assignment of benefit is the servicing
     * provider whose number goes on the claim. A nurse working under a provider
     * is not one, and a bulk action may not widen `mayBeProviderOnAgreement`.
     */
    const before = await arrivalRow(arrivals.otherSite!);
    const res = await move([arrivals.otherSite!], nurse.affiliationId).expect(201);
    const body = res.body as ArrivalMoveResult;

    expect(body.movedCount).toBe(0);
    expect(body.outcomes[0]!.refusedReason).toBe('target_cannot_be_a_provider');
    // Nothing moved and nothing was superseded.
    expect(await arrivalRow(arrivals.otherSite!)).toEqual(before);
    expect(await successorOf(agreements.otherSite!)).toBeNull();
  });

  it('a_target_without_an_affiliation_at_that_location_is_refused', async () => {
    /*
     * D4 is the person AND the place of practice, and billing identity is
     * practice × location × practitioner (D-2026-09-12-09). Dr Otherside is a
     * servicing GP of this practice and still cannot take this list, because
     * they do not work where the patient walked in.
     */
    const before = await arrivalRow(arrivals.otherSite!);
    const res = await move([arrivals.otherSite!], elsewhere.affiliationId).expect(201);
    const body = res.body as ArrivalMoveResult;

    expect(body.movedCount).toBe(0);
    expect(body.outcomes[0]!.refusedReason).toBe('target_not_at_that_location');
    expect(await arrivalRow(arrivals.otherSite!)).toEqual(before);
  });

  it('a_partial_move_reports_every_refusal_and_applies_the_rest', async () => {
    /*
     * TODO.md §5: *"Moving fifteen patients where three are refused has to say
     * which three and why, and leave the twelve moved."* Each refusal carries a
     * reason CODE the console maps to words and a destination (CLAUDE.md §7) —
     * never a bare failure and never a silent one.
     */
    const res = await move(
      [arrivals.otherSite!, theirArrivalId, arrivals.alreadyThere!, randomUUID()],
      cover.affiliationId,
    ).expect(201);
    const body = res.body as ArrivalMoveResult;

    expect(body.movedCount).toBe(1);
    expect(body.refusedCount).toBe(3);
    const by = Object.fromEntries(body.outcomes.map((o) => [o.arrivalId, o]));
    expect(by[arrivals.otherSite!]!.moved).toBe(true);
    expect(by[theirArrivalId]!.refusedReason).toBe('arrival_not_found');
    expect(by[arrivals.alreadyThere!]!.refusedReason).toBe('already_with_that_practitioner');
    // And every refusal names a reason: an unexplained failure is the defect.
    for (const outcome of body.outcomes) {
      expect(outcome.moved ? outcome.refusedReason === null : Boolean(outcome.refusedReason)).toBe(true);
    }
  });

  it('a_move_across_a_practice_boundary_finds_nothing', async () => {
    /*
     * RLS, not a filter: another practice's arrival is INVISIBLE, so the row
     * reads "no such visit" and says nothing about whose it was — and the
     * target must belong to the caller's practice too.
     */
    const before = await arrivalRow(theirArrivalId, otherPracticeId);

    const res = await move([theirArrivalId], cover.affiliationId).expect(201);
    expect((res.body as ArrivalMoveResult).outcomes[0]!.refusedReason).toBe('arrival_not_found');
    expect(await arrivalRow(theirArrivalId, otherPracticeId)).toEqual(before);

    // And their practitioner is not a target this practice can name at all.
    await move([arrivals.covered!], theirGp.affiliationId).expect(404);
  });

  it('a_move_whose_row_was_not_written_is_settled_by_pressing_move_again', async () => {
    /*
     * THE HALF-DONE STATE, AND THE RETRY THAT SETTLES IT (found in review, 12
     * Sep 2026). A move is two commits — the supersession, then the visit's own
     * row — and if the second fails they disagree about who the patient is
     * seeing. This stages that exactly: the agreement is superseded onto the
     * covering practitioner while the arrival still names the one they are
     * leaving.
     *
     * PRESSING MOVE AGAIN MUST NOT MAKE A SECOND CONTRACT. The chain already
     * names the target, so nothing further is superseded — one visit, one
     * agreement — and only the row is written.
     */
    const parent = agreements.retry!;
    await prisma.withPractice(practiceId, async (tx) => {
      const before = await tx.agreement.findFirstOrThrow({ where: { id: parent } });
      await tx.agreement.create({
        data: {
          practiceId,
          type: before.type,
          anchorKind: 'provider',
          affiliationId: cover.affiliationId,
          patientId: before.patientId,
          assignorId: before.assignorId,
          assignorIsPatient: true,
          supersedesAgreementId: parent,
        },
      });
    });

    const res = await move([arrivals.retry!], cover.affiliationId).expect(201);
    const body = res.body as ArrivalMoveResult;
    expect(body.outcomes[0]!.moved).toBe(true);
    // Nothing further was superseded: the successor that already existed is the
    // one this visit now has.
    expect(body.outcomes[0]!.supersededAgreementId).toBeNull();
    const successors = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findMany({ where: { supersedesAgreementId: parent } }),
    );
    expect(successors).toHaveLength(1);
    expect(body.outcomes[0]!.newAgreementId).toBe(successors[0]!.id);

    const arrival = await arrivalRow(arrivals.retry!);
    expect(arrival!.seeingAffiliationId).toBe(cover.affiliationId);
    expect(arrival!.affiliationId).toBe(cover.affiliationId);
  });

  it('the_visit_policy_is_re_asked_after_a_move', async () => {
    /*
     * Hard rule 6: an ongoing agreement is per practitioner × patient and does
     * NOT travel with the patient. This one is moved to a GP who already holds
     * a live one with them, so the versioned policy's answer changes from
     * `episodic_pre` to `none` — and a move that carried the old answer across
     * would have drafted a second agreement for a service already covered.
     */
    const before = await agreementRow(agreements.covered!);
    const res = await move([arrivals.covered!], cover.affiliationId).expect(201);
    const body = res.body as ArrivalMoveResult;

    expect(body.outcomes[0]!.moved).toBe(true);
    expect(body.outcomes[0]!.visitDecision).toBe('none');
    expect(body.outcomes[0]!.newAgreementId).toBeNull();
    expect(body.outcomes[0]!.policyVersion).toBe('visit-policy-3');

    // Nothing was drafted for the covered visit, and the old agreement is still
    // exactly as it was (hard rule 11) — only its open capture request closed.
    expect(await successorOf(agreements.covered!)).toBeNull();
    const after = await agreementRow(agreements.covered!);
    expect(after).toEqual(before);

    const arrival = await arrivalRow(arrivals.covered!);
    expect(arrival!.visitDecision).toBe('none');
    expect(arrival!.decisionReason).toBe('already_covered_by_an_enduring_agreement');
  });
});
