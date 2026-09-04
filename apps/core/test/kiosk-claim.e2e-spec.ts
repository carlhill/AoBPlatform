import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DevicesService } from '../src/devices/devices.service';
import { GENERIC_MISMATCH_MESSAGE } from '../src/verification/verification.service';
import { CLAIM_ATTEMPT_LIMIT } from '../src/kiosk/claim-rate-limit';

/**
 * `POST /kiosk/claim` — the walk-up front door (Carl, 4 Sep 2026).
 *
 * THE RULING THIS SUITE EXISTS FOR. "Remove the 'x people ready to sign' text
 * — this is a security feature. Then on the next page do not show the list. Go
 * straight to 'Confirm your details', match these details to the list on
 * AoBPlatform and then go to the next page." So the tablet stopped showing who
 * is here and started asking who YOU are: the patient types their name, date
 * of birth and address, and the server finds the one waiting row of that
 * practice matching all three.
 *
 * WHAT IT IS WRITTEN AGAINST, in the order the failures would hurt:
 *
 *  1. A response that leaks somebody else. One row comes back and it is the
 *     matched one; no other patient's name is reachable from any answer this
 *     endpoint gives, successful or not.
 *  2. A refusal that distinguishes "nobody by that name" from "two people
 *     here match". Both are facts about OTHER people, and a walk-up tablet may
 *     disclose neither — so both are the same sentence, and both spend an
 *     attempt.
 *  3. A value reaching the evidence. The verification event records TYPES and
 *     an outcome; the vault payload records types, counts and a device id. No
 *     date of birth, no address, no name anywhere in either (REQ-VER-04, hard
 *     rule 9).
 *  4. Another practice's waiting room being searchable from this tablet.
 *
 * THE FIXTURE IDENTITIES ARE OBVIOUSLY FAKE and no Medicare-format number
 * appears anywhere in this file, because there is no Medicare field to put one
 * in (REQ-VER-02, hard rule 1).
 */
describe('the kiosk claim (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const practiceA = randomUUID();
  const practiceB = randomUUID();

  /** The one patient a correct claim must find. */
  const RILEY = {
    givenNames: 'Riley',
    familyName: 'Claimant',
    dateOfBirth: '1988-03-09',
    address: '7 Sample Road, Sampletown NSW 2000',
  };

  /** A second patient of the same practice whose details are entirely different. */
  const MORGAN = {
    givenNames: 'Morgan',
    familyName: 'Bystander',
    dateOfBirth: '1954-11-21',
    address: '19 Other Avenue, Sampletown NSW 2000',
  };

  /** Practice B's patient — never reachable from practice A's tablet. */
  const ALEX = {
    givenNames: 'Alex',
    familyName: 'Elsewhere',
    dateOfBirth: '1971-06-02',
    address: '3 Distant Street, Farville NSW 2000',
  };

  let rileyRequestId: string;
  let rileyAgreementId: string;
  let rileyPatientId: string;

  const statedFor = (p: { givenNames: string; familyName: string; dateOfBirth: string; address: string }) => ({
    // Composed as the tablet composes it — given then family. `nameMatches`
    // handles either order, which is the point of sending one string.
    name: `${p.givenNames} ${p.familyName}`,
    date_of_birth: p.dateOfBirth,
    address: p.address,
  });

  /**
   * A paired tablet. `showsWaitingList` is left FALSE — this is a walk-up
   * tablet, which is the only kind a real practice has, and claim must work
   * without the list ever having been shown.
   */
  async function pairTablet(practiceId: string, label: string): Promise<string> {
    const devices = app.get(DevicesService);
    const { code } = await devices.registerForDev(practiceId, label);
    const { credential } = await devices.pair(code, `kiosk-claim-${label}`);
    return credential;
  }

  /** One waiting `episodic_pre` draft with an open in-practice capture request. */
  async function seedWaitingPatient(
    practiceId: string,
    person: { givenNames: string; familyName: string; dateOfBirth: string; address: string },
  ) {
    return prisma.withPractice(practiceId, async (tx) => {
      const provider = await tx.provider.findFirst({});
      const patient = await tx.patient.create({
        data: {
          practiceId,
          familyName: person.familyName,
          givenNames: person.givenNames,
          dateOfBirth: new Date(person.dateOfBirth),
          address: person.address,
        },
      });
      const assignor = await tx.assignor.create({
        data: {
          practiceId,
          name: `${person.givenNames} ${person.familyName}`,
          authorityBasis: 'self',
          dateOfBirth: new Date(person.dateOfBirth),
        },
      });
      const agreement = await tx.agreement.create({
        data: {
          practiceId,
          type: 'episodic_pre',
          anchorKind: 'provider',
          providerId: provider!.id,
          patientId: patient.id,
          assignorId: assignor.id,
          assignorIsPatient: true,
          status: 'verification_pending',
        },
      });
      const captureRequest = await tx.captureRequest.create({
        data: { practiceId, agreementId: agreement.id, channel: 'in_practice' },
      });
      return { patientId: patient.id, agreementId: agreement.id, captureRequestId: captureRequest.id };
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    for (const [practiceId, name] of [
      [practiceA, 'Claim Test Practice A'],
      [practiceB, 'Claim Test Practice B'],
    ] as const) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.practice.create({ data: { id: practiceId, name } });
        await tx.provider.create({
          data: { practiceId, name: 'Dr Example Provider', providerType: 'general_practitioner' },
        });
      });
    }

    const riley = await seedWaitingPatient(practiceA, RILEY);
    rileyRequestId = riley.captureRequestId;
    rileyAgreementId = riley.agreementId;
    rileyPatientId = riley.patientId;

    await seedWaitingPatient(practiceA, MORGAN);
    await seedWaitingPatient(practiceB, ALEX);
  });

  afterAll(async () => {
    for (const practiceId of [practiceA, practiceB]) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.devicePairingCode.deleteMany({ where: { practiceId } });
        await tx.device.deleteMany({});
        await tx.captureRequest.deleteMany({});
        /*
         * `verification_events` IS NOT SWEPT UP HERE, and cannot be: a
         * database trigger refuses the delete with "verification events are
         * append-only evidence (REQ-VER-04)". That is the right answer and it
         * is worth leaving the reader — the rows this suite wrote are evidence
         * of checks that really happened against fixture patients, and the
         * store that holds them does not have a delete.
         */
        await tx.verificationChallenge.deleteMany({});
        await tx.agreement.deleteMany({});
        await tx.assignor.deleteMany({});
        await tx.patient.deleteMany({});
        await tx.provider.deleteMany({});
        await tx.practice.deleteMany({});
      });
    }
    await prisma.vaultOutbox.deleteMany({});
    await app?.close();
  });

  it('claim_matches_exactly_one_waiting_row_of_this_practice', async () => {
    const tablet = await pairTablet(practiceA, 'claim-match');

    const res = await request(app.getHttpServer())
      .post('/kiosk/claim')
      .set('x-device-credential', tablet)
      .send({ stated: statedFor(RILEY) })
      .expect(201);

    expect(res.body.outcome).toBe('passed');
    expect(typeof res.body.verificationEventId).toBe('string');
    expect(res.body.row).toMatchObject({
      captureRequestId: rileyRequestId,
      agreementId: rileyAgreementId,
      patientId: rileyPatientId,
      patientName: 'Riley Claimant',
      agreementType: 'episodic_pre',
      // Seeded with no D6a and unlocked, so the ceremony will hand over by
      // name rather than march the patient through K-3 for nothing
      // (TODO.md, "Two rulings from pairing day").
      signable: false,
      blockedReason: 'service_description_missing',
    });

    /*
     * THE AGREEMENT POINTS AT THE EVENT THAT VERIFIED IT — the same binding
     * the remote link makes, and what REQ-SIG-02 folds into the signature.
     */
    const agreement = await prisma.withPractice(practiceA, (tx) =>
      tx.agreement.findFirst({ where: { id: rileyAgreementId } }),
    );
    expect(agreement?.verificationEventId).toBe(res.body.verificationEventId);
  });

  it('claim_never_returns_other_rows', async () => {
    const tablet = await pairTablet(practiceA, 'claim-no-other-rows');

    const res = await request(app.getHttpServer())
      .post('/kiosk/claim')
      .set('x-device-credential', tablet)
      .send({ stated: statedFor(RILEY) })
      .expect(201);

    const body = JSON.stringify(res.body);
    // The OTHER waiting patient of the same practice. She is on the list this
    // search walked, and nothing about her may come back out of it.
    expect(body).not.toContain('Morgan');
    expect(body).not.toContain('Bystander');
    expect(body).not.toContain(MORGAN.address);
    // One row, not an array of candidates.
    expect(Array.isArray(res.body.row)).toBe(false);
    expect(res.body.waiting).toBeUndefined();
    // And no count of who else is here — the count was the first disclosure
    // Carl removed.
    expect(body).not.toMatch(/"(count|waitingCount|candidateCount|matchCount)"/);
  });

  it('claim_failure_is_generic_for_none_and_for_many', async () => {
    /*
     * NONE. A real patient of this practice with one detail wrong. The answer
     * must not distinguish "we have no such person", "that person is not
     * waiting today" and "three of your details, one of them wrong".
     */
    const noneTablet = await pairTablet(practiceA, 'claim-none');
    const none = await request(app.getHttpServer())
      .post('/kiosk/claim')
      .set('x-device-credential', noneTablet)
      .send({ stated: { ...statedFor(RILEY), date_of_birth: '1988-03-10' } })
      .expect(201);

    expect(none.body.outcome).toBe('failed');
    expect(none.body.message).toBe(GENERIC_MISMATCH_MESSAGE);
    expect(none.body.row).toBeUndefined();
    expect(none.body.verificationEventId).toBeUndefined();

    /*
     * MANY. A twin: the same name, date of birth and address, waiting at the
     * same practice. Two rows match and the tablet must not be told which — or
     * even that there were two, which would tell whoever is standing there
     * that they guessed a real person correctly.
     */
    const twin = await seedWaitingPatient(practiceA, RILEY);
    const manyTablet = await pairTablet(practiceA, 'claim-many');
    const many = await request(app.getHttpServer())
      .post('/kiosk/claim')
      .set('x-device-credential', manyTablet)
      .send({ stated: statedFor(RILEY) })
      .expect(201);

    expect(many.body.outcome).toBe('failed');
    // THE SAME SENTENCE, character for character. Two different words here
    // would be an oracle.
    expect(many.body.message).toBe(none.body.message);
    expect(many.body.row).toBeUndefined();
    expect(JSON.stringify(many.body)).not.toContain('Riley');

    await prisma.withPractice(practiceA, async (tx) => {
      await tx.captureRequest.deleteMany({ where: { id: twin.captureRequestId } });
      await tx.agreement.deleteMany({ where: { id: twin.agreementId } });
      await tx.patient.deleteMany({ where: { id: twin.patientId } });
    });
  });

  it('claim_records_types_not_values', async () => {
    const tablet = await pairTablet(practiceA, 'claim-evidence');
    await prisma.vaultOutbox.deleteMany({});

    const res = await request(app.getHttpServer())
      .post('/kiosk/claim')
      .set('x-device-credential', tablet)
      .send({ stated: statedFor(RILEY) })
      .expect(201);
    expect(res.body.outcome).toBe('passed');

    const event = await prisma.withPractice(practiceA, (tx) =>
      tx.verificationEvent.findFirst({ where: { id: res.body.verificationEventId } }),
    );
    expect(event?.outcome).toBe('passed');
    expect(event?.channel).toBe('in_practice');
    expect(event?.identifierTypes).toEqual(['name', 'date_of_birth', 'address']);

    /*
     * NOT ONE VALUE, ANYWHERE IN THE EVIDENCE. The event row and every vault
     * payload the claim produced are searched for the exact strings the
     * patient typed. Types and outcomes only (REQ-VER-04, hard rule 9).
     */
    const outbox = await prisma.vaultOutbox.findMany({});
    const written = JSON.stringify([event, outbox]);
    expect(written).not.toContain(RILEY.dateOfBirth);
    expect(written).not.toContain(RILEY.address);
    expect(written).not.toContain('Riley');
    expect(written).not.toContain('Claimant');
    // The device fingerprint IS recorded — it is the walk-up path's substitute
    // for a staff identity, and it names a tablet rather than a person.
    expect(written).toContain('kiosk.claim_matched');
    expect(written).toContain('"identifierTypes":"address,date_of_birth,name"');
  });

  it('claim_locks_out_after_three_per_device', async () => {
    const tablet = await pairTablet(practiceA, 'claim-lockout');
    const wrong = { stated: { ...statedFor(RILEY), date_of_birth: '1900-01-01' } };

    for (let attempt = 1; attempt < CLAIM_ATTEMPT_LIMIT; attempt += 1) {
      const res = await request(app.getHttpServer())
        .post('/kiosk/claim')
        .set('x-device-credential', tablet)
        .send(wrong)
        .expect(201);
      expect(res.body.outcome).toBe('failed');
    }

    // The third failure is the last one this tablet gets.
    const third = await request(app.getHttpServer())
      .post('/kiosk/claim')
      .set('x-device-credential', tablet)
      .send(wrong)
      .expect(201);
    expect(third.body.outcome).toBe('locked_out');

    /*
     * AND A CORRECT CLAIM AFTER THE LOCKOUT IS STILL REFUSED. A ladder that
     * the right answer walks straight past is not a ladder — and the copy
     * still points at reception, who can finish this in person.
     */
    const afterwards = await request(app.getHttpServer())
      .post('/kiosk/claim')
      .set('x-device-credential', tablet)
      .send({ stated: statedFor(RILEY) })
      .expect(201);
    expect(afterwards.body.outcome).toBe('locked_out');
    expect(afterwards.body.row).toBeUndefined();
    expect(afterwards.body.message).toContain('reception');

    /*
     * IT IS KEYED PER DEVICE, NOT PER PRACTICE. A second tablet in the same
     * waiting room is unaffected — otherwise one person mistyping their
     * address three times would take the practice's whole floor of tablets
     * down, which is a flow that blocks care (hard rule 8).
     */
    const otherTablet = await pairTablet(practiceA, 'claim-lockout-neighbour');
    const neighbour = await request(app.getHttpServer())
      .post('/kiosk/claim')
      .set('x-device-credential', otherTablet)
      .send({ stated: statedFor(RILEY) })
      .expect(201);
    expect(neighbour.body.outcome).toBe('passed');
  });

  it('cross_practice_claim_fails_closed — practice B\'s tablet cannot find practice A\'s patient', async () => {
    const tabletB = await pairTablet(practiceB, 'claim-cross-practice');

    const res = await request(app.getHttpServer())
      .post('/kiosk/claim')
      .set('x-device-credential', tabletB)
      .send({ stated: statedFor(RILEY) })
      .expect(201);

    // The same generic refusal — B's tablet is not told that Riley exists
    // somewhere, which is exactly as much as it should learn.
    expect(res.body.outcome).toBe('failed');
    expect(res.body.message).toBe(GENERIC_MISMATCH_MESSAGE);
    expect(JSON.stringify(res.body)).not.toContain('Riley');

    // And B's own patient IS findable from B's own tablet, so the refusal
    // above is scope and not a broken endpoint.
    const own = await request(app.getHttpServer())
      .post('/kiosk/claim')
      .set('x-device-credential', tabletB)
      .send({ stated: statedFor(ALEX) })
      .expect(201);
    expect(own.body.outcome).toBe('passed');
    expect(own.body.row.patientName).toBe('Alex Elsewhere');
  });

  it('refuses a claim from no device at all — a public route is not a public search', async () => {
    await request(app.getHttpServer())
      .post('/kiosk/claim')
      .send({ stated: statedFor(RILEY) })
      .expect(401);

    // And a practice id in a header buys nothing: the guard deletes it on
    // `/kiosk/*` before anything reads it.
    const withHeader = await request(app.getHttpServer())
      .post('/kiosk/claim')
      .set('x-practice-id', practiceA)
      .send({ stated: statedFor(RILEY) })
      .expect(401);
    expect(withHeader.body.row).toBeUndefined();
  });
});
