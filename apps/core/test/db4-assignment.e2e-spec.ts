import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import type { ValidationResponse } from '@aobplatform/contracts';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../src/messaging/gateway';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';
import { InboundLaneWorkerService } from '../src/inbound/inbound-lane.worker';
import { createServicingProvider, deleteSeededAnchors } from './anchor';

/**
 * A DB4 PRINTED TO AOBPRINTER BECOMES A POST-SERVICE AGREEMENT
 * (DB4-AND-AOBL.md §13a piece 1; D-2026-09-14-02/-03/-04).
 *
 * WHAT THESE TESTS PIN, each a failure the first customer would otherwise find:
 *
 *  - The DB4 Print Record SURVIVES THE DOOR. Until this build
 *    `ValidationPipe({ whitelist: true })` stripped every field below the
 *    envelope, so a posted DB4 was stored as five fields and a discarded form.
 *    The round-trip below reads `DB4-print.example.json` itself, so the day the
 *    example gains a field the DTO does not declare, this fails.
 *  - A DB4 produces ONE post-service agreement, locked before a signature is
 *    possible, on the SERVICING provider — never the payee.
 *  - A REPRINT is the same form. The spool bytes differ (the driver stamps a
 *    creation id) so the queue's sha dedup cannot see it; `form.formReference`
 *    can, and does.
 *  - The generic cascade never touches it: a DB4 names two providers, and the
 *    content-shape dispatch would have mirrored both into the practice.
 *  - The Medicare number and the printed amounts stay on the job row, which is
 *    the practice's own form, and reach no agreement and no vault event
 *    (hard rules 1, 4 and 9; D-2026-09-14-03).
 *  - A form the platform cannot place is RECORDED, not thrown and not retried
 *    (hard rule 8).
 *
 * FAKE IDENTITIES THROUGHOUT, and the Medicare number below fails its own
 * checksum on purpose (CLAUDE.md §7). The example's SHAPE is the authority; its
 * values are the scanned form's and never travel into a fixture.
 */

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

/** 2 999 99999 9 — weighted sum 353, so the printed check digit 9 is wrong. Invalid by construction. */
const FAKE_MEDICARE = '2999 99999 9';
const CHART_NUMBER = '00680';
const SERVICING_NUMBER = '5745385T';
const PAYEE_NUMBER = '0636678W';
const FORM_REFERENCE = 'HSS0610012092026120300';
const IDEMPOTENCY_KEY = `db4:${FORM_REFERENCE}`;
const PRINTED_AMOUNTS = ['45.05', '22.40'];

/**
 * THE RULES ENGINE, AND A SWITCH TO MAKE IT DECLINE. Human-authored zone
 * (CLAUDE.md §7), stubbed here — but a stub that can only ever pass would leave
 * the whole "the platform refused after the service record existed" branch
 * untested, which is exactly the branch a practice meets when PracSoft prints
 * an item this platform does not map.
 */
let rulesDecline = false;
const passingRules = {
  validate: async (): Promise<ValidationResponse> =>
    rulesDecline
      ? {
          valid: false,
          results: [{ rule: 'C7', outcome: 'fail', message: 'That item number is not mapped.', citation: 's 65C(4)' }],
          ruleSetVersion: 'test-rules-1',
          mappingVersion: 'test-mapping-1',
        }
      : {
          valid: true,
          results: [{ rule: 'C8', outcome: 'pass', message: 'D7 is complete.', citation: 's 65C(4)' }],
          ruleSetVersion: 'test-rules-1',
          mappingVersion: 'test-mapping-1',
        },
};

type Json = Record<string, unknown>;

/** `$comment` keys are the example's own annotations and are stripped at the door by design. */
function withoutComments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutComments);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Json)
        .filter(([key]) => !key.startsWith('$'))
        .map(([key, v]) => [key, withoutComments(v)]),
    );
  }
  return value;
}

/**
 * THE EXAMPLE'S SHAPE, THE FIXTURE'S VALUES. Read from the repo root so the
 * key set is the real one; every identity replaced so no scanned patient, no
 * real provider number and no valid Medicare number is ever posted by a test.
 */
function db4Record(over: { sourceSha256: string; formReference?: string; patientRecordNumber?: string }): Json {
  const example = withoutComments(
    JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'DB4-print.example.json'), 'utf8')),
  ) as Json;

  const patient = example.patient as Json;
  const form = example.form as Json;
  const providers = example.providers as Json[];
  const services = example.services as Json[];
  const location = example.servicingLocation as Json;
  const recordNumber = over.patientRecordNumber ?? CHART_NUMBER;

  return {
    ...example,
    sourceSha256: over.sourceSha256,
    capturedAt: new Date().toISOString(),
    form: { ...form, formReference: over.formReference ?? FORM_REFERENCE, serviceDate: today() },
    servicingLocation: { ...location, name: 'Example Family Medical Practice', addressLines: ['1 EXAMPLE STREET'], suburb: 'Sampletown', postcode: '2000' },
    patient: {
      ...patient,
      pmsLinkageKey: `chart:${recordNumber}`,
      patientRecordNumber: recordNumber,
      // The scanned example's number is replaced with an invalid-checksum fake
      // here; the fixture must name the field to do it (D-2026-09-14-03).
      // eslint-disable-next-line no-restricted-syntax
      medicareCardNumber: FAKE_MEDICARE,
      givenNames: 'Testy',
      familyName: 'Fakename',
      address: '18 Example Street, Sampletown NSW 2000',
      mobile: '+61400000680',
    },
    providers: [
      { ...providers[0], name: 'Dr Fake Servicing' },
      { ...providers[1], name: 'Dr Fake Payee' },
    ],
    services: services.map((s) => ({ ...s, serviceDate: today() })),
  };
}

describe('the DB4 print record (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: InboundLaneWorkerService;

  const practiceId = randomUUID();
  const otherPracticeId = randomUUID();
  let servicingAffiliationId: string;
  let payeeAffiliationId: string;
  let patientId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_GATEWAY)
      .useValue({ mode: 'test', dispatch: async () => ({ accepted: true }) } as MessagingGateway)
      .overrideProvider(RULES_CLIENT)
      .useValue(passingRules)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    worker = app.get(InboundLaneWorkerService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'DB4 Test Practice' } });
      const servicing = await createServicingProvider(tx, practiceId, {
        name: 'Dr Fake Servicing',
        providerType: 'general_practitioner',
        providerNumber: SERVICING_NUMBER,
      });
      servicingAffiliationId = servicing.affiliationId;
      /*
       * THE PAYEE IS A REAL PRACTITIONER HERE TOO, AND THAT IS THE POINT. If
       * the handler anchored on the payee the agreement would still be created
       * and nothing would look wrong — so the test that says the servicing
       * provider anchors the visit needs the wrong answer to be available.
       */
      const payee = await createServicingProvider(tx, practiceId, {
        name: 'Dr Fake Payee',
        providerType: 'general_practitioner',
        providerNumber: PAYEE_NUMBER,
        locationId: servicing.locationId,
      });
      payeeAffiliationId = payee.affiliationId;

      const patient = await tx.patient.create({
        data: {
          practiceId,
          patientRecordNumber: CHART_NUMBER,
          familyName: 'Fakename',
          givenNames: 'Testy',
          dateOfBirth: new Date('1965-10-10'),
          address: '18 Example Street, Sampletown NSW 2000',
          mobile: '+61400000680',
          email: 'testy.fakename@example.invalid',
        },
      });
      patientId = patient.id;
    });
    await prisma.withPractice(otherPracticeId, (tx) =>
      tx.practice.create({ data: { id: otherPracticeId, name: 'A Different Practice' } }),
    );
  });

  afterAll(async () => {
    for (const scope of [practiceId, otherPracticeId]) {
      await prisma.withPractice(scope, async (tx) => {
        await tx.inboundPrintJob.deleteMany({});
        await tx.outboundItem.deleteMany({});
        await tx.captureRequest.deleteMany({});
        await tx.verificationChallenge.deleteMany({});
        await tx.serviceRecord.deleteMany({});
        await tx.agreement.deleteMany({});
        await tx.assignor.deleteMany({});
        await tx.patient.deleteMany({});
        await tx.provider.deleteMany({});
        await deleteSeededAnchors(tx);
        await tx.practice.deleteMany({});
      });
    }
    await prisma.vaultOutbox.deleteMany({});
    await app?.close();
  });

  const post = (body: object, scope = practiceId) =>
    request(app.getHttpServer()).post('/inbound/print-jobs').set('x-practice-id', scope).send(body);

  /** Drive the lane until these jobs are terminal — a test that sleeps for a timer is a test of the clock. */
  async function settle(shas: string[]) {
    for (let i = 0; i < 25; i++) {
      await worker.sweep('critical');
      const rows = await prisma.withPractice(practiceId, (tx) =>
        tx.inboundPrintJob.findMany({ where: { sourceSha256: { in: shas } } }),
      );
      if (rows.length === shas.length && rows.every((r) => r.state === 'done' || r.state === 'dead')) return rows;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`DB4 jobs did not settle: ${shas.join(', ')}`);
  }

  const jobRow = (sourceSha256: string) =>
    prisma.withPractice(practiceId, (tx) => tx.inboundPrintJob.findFirst({ where: { sourceSha256 } }));

  type Db4Outcome = {
    idempotencyKey: string | null;
    patientMatched: boolean;
    servicingProviderNumber: string | null;
    payeeProviderNumber: string | null;
    serviceRecordId: string | null;
    repeat: boolean;
    decision: string | null;
    policyVersion: string | null;
    agreementId: string | null;
    placed: boolean;
    reason: string | null;
    refusedStatus: number | null;
  };
  const db4Outcome = (row: { outcome: unknown }) =>
    (row.outcome as { db4: Db4Outcome; providersMirrored: number; patientsMirrored: number }) ?? null;

  const FIRST_SHA = sha('db4-first-print');
  const REPRINT_SHA = sha('db4-same-form-reprinted');
  const UNKNOWN_SHA = sha('db4-unknown-chart');

  describe('the door', () => {
    it('a_db4_record_survives_the_validation_pipe', async () => {
      const body = db4Record({ sourceSha256: FIRST_SHA });
      const res = await post(body).expect(202);
      expect(res.body.lane).toBe('critical');

      const row = await jobRow(FIRST_SHA);
      /*
       * FIELD FOR FIELD, not a spot check. The DTO and the contract type are
       * hand-kept in step with nothing watching, so the only honest guard is
       * the example itself: anything the pipe strips shows up here as a missing
       * key rather than as a quiet absence six weeks later.
       */
      expect(row!.payload).toEqual(body);

      // Including what only a DB4 may carry — this IS the practice's own form.
      const stored = row!.payload as Json;
      // The one place a test may name the field: proving it arrived is the
      // point, and the suite below proves it goes no further (D-2026-09-14-03).
      // eslint-disable-next-line no-restricted-syntax
      expect((stored.patient as Json).medicareCardNumber).toBe(FAKE_MEDICARE);
      expect((stored.services as Json[])[0]!.benefitAssigned).toBe(PRINTED_AMOUNTS[0]);
      expect((stored.assignment as Json).statements).toHaveLength(2);
      expect((stored.referral as Json).lspn).toBeNull();
    });
  });

  describe('the handler', () => {
    it('a_db4_print_record_becomes_a_post_service_agreement', async () => {
      const [job] = await settle([FIRST_SHA]);
      expect(job.state).toBe('done');

      const outcome = db4Outcome(job);
      expect(outcome.db4.placed).toBe(true);
      expect(outcome.db4.patientMatched).toBe(true);
      expect(outcome.db4.idempotencyKey).toBe(IDEMPOTENCY_KEY);
      expect(outcome.db4.decision).toBe('episodic_post');
      expect(outcome.db4.policyVersion).toBeTruthy();
      expect(outcome.db4.reason).toBeNull();

      // THE SERVICING PROVIDER ANCHORS THE VISIT; the payee is recorded only.
      expect(outcome.db4.servicingProviderNumber).toBe(SERVICING_NUMBER);
      expect(outcome.db4.payeeProviderNumber).toBe(PAYEE_NUMBER);

      const record = await prisma.withPractice(practiceId, (tx) =>
        tx.serviceRecord.findFirst({ where: { pmsInvoiceKey: IDEMPOTENCY_KEY } }),
      );
      expect(record?.patientId).toBe(patientId);
      expect(record?.affiliationId).toBe(servicingAffiliationId);
      expect(record?.affiliationId).not.toBe(payeeAffiliationId);
      expect(record?.mbsItemNumbers).toEqual(['23', '75870']);
      expect(record?.agreementId).toBe(outcome.db4.agreementId);

      const agreement = await prisma.withPractice(practiceId, (tx) =>
        tx.agreement.findFirst({ where: { id: outcome.db4.agreementId! } }),
      );
      expect(agreement?.type).toBe('episodic_post');
      expect(agreement?.affiliationId).toBe(servicingAffiliationId);

      const capture = await prisma.withPractice(practiceId, (tx) =>
        tx.captureRequest.findFirst({ where: { agreementId: outcome.db4.agreementId! } }),
      );
      expect(capture?.channel).toBe('in_practice');
      expect(capture?.status).toBe('open');
    });

    it('the_particulars_are_locked_before_the_signature_is_possible', async () => {
      const agreement = await prisma.withPractice(practiceId, (tx) =>
        tx.agreement.findFirst({ where: { type: 'episodic_post', patientId } }),
      );
      // Hard rule 2, REQ-REG-06 — the lock happens on the SERVER before any
      // device sees anything, so a tablet structurally cannot hold a draft.
      expect(agreement?.particularsLockedAt).not.toBeNull();
      expect(agreement?.status).toBe('awaiting_signature');
      const particulars = agreement?.particulars as Json;
      expect(particulars.serviceDate).toBe(today());
      expect(particulars.mbsItemNumbers).toEqual(['23', '75870']);
    });

    it('a_db4_never_mirrors_a_provider_into_the_practice', async () => {
      const job = await jobRow(FIRST_SHA);
      const outcome = db4Outcome(job!);
      expect(outcome.providersMirrored).toBe(0);
      expect(outcome.patientsMirrored).toBe(0);

      // The content-shape cascade would have created one row per printed
      // provider, keyed on `pmsProviderKey`. Neither exists.
      const smuggled = await prisma.withPractice(practiceId, (tx) =>
        tx.provider.count({ where: { pmsLinkageKey: { in: [`provider:${SERVICING_NUMBER}`, `provider:${PAYEE_NUMBER}`] } } }),
      );
      expect(smuggled).toBe(0);
      // Only the two the suite seeded, and only the one patient it seeded.
      const providers = await prisma.withPractice(practiceId, (tx) => tx.provider.count({}));
      expect(providers).toBe(2);
      const patients = await prisma.withPractice(practiceId, (tx) => tx.patient.count({}));
      expect(patients).toBe(1);
    });

    it('the_same_form_printed_twice_creates_one_agreement', async () => {
      /*
       * A REPRINT SPOOLS DIFFERENT BYTES — the driver stamps a creation id — so
       * the queue's own sha dedup cannot see it and a second job row is
       * correct. `form.formReference` is what makes it the same FORM.
       */
      const again = await post(db4Record({ sourceSha256: REPRINT_SHA })).expect(202);
      expect(again.body.duplicate).toBe(false);

      const [job] = await settle([REPRINT_SHA]);
      expect(job.state).toBe('done');
      const outcome = db4Outcome(job);
      expect(outcome.db4.idempotencyKey).toBe(IDEMPOTENCY_KEY);
      expect(outcome.db4.repeat).toBe(true);

      const records = await prisma.withPractice(practiceId, (tx) =>
        tx.serviceRecord.count({ where: { pmsInvoiceKey: IDEMPOTENCY_KEY } }),
      );
      expect(records).toBe(1);
      const agreements = await prisma.withPractice(practiceId, (tx) =>
        tx.agreement.count({ where: { type: 'episodic_post', patientId } }),
      );
      expect(agreements).toBe(1);
    });

    it('a_db4_for_an_unknown_chart_number_is_recorded_not_thrown', async () => {
      await post(
        db4Record({ sourceSha256: UNKNOWN_SHA, formReference: 'HSS0610099999999999999', patientRecordNumber: '99999' }),
      ).expect(202);

      const [job] = await settle([UNKNOWN_SHA]);
      // DONE, not dead and not failed: a form the platform cannot place never
      // retry-storms the lane that serves the patient at the desk (hard rule 8).
      expect(job.state).toBe('done');
      expect(job.attempts).toBe(0);
      expect(job.lastError).toBeNull();

      const outcome = db4Outcome(job);
      expect(outcome.db4.placed).toBe(false);
      expect(outcome.db4.patientMatched).toBe(false);
      expect(outcome.db4.reason).toBe('unknown_chart_number');
      expect(outcome.db4.agreementId).toBeNull();

      const agreements = await prisma.withPractice(practiceId, (tx) => tx.agreement.count({}));
      expect(agreements).toBe(1);
    });
  });

  describe('what never leaves the job row', () => {
    /** Everything the agreement path wrote, as text, for the two absence checks below. */
    async function agreementSurfaces(): Promise<string> {
      const rows = await prisma.withPractice(practiceId, async (tx) => ({
        agreements: await tx.agreement.findMany({}),
        records: await tx.serviceRecord.findMany({}),
        assignors: await tx.assignor.findMany({}),
        captures: await tx.captureRequest.findMany({}),
      }));
      const events = await prisma.vaultOutbox.findMany({});
      return JSON.stringify({ ...rows, events });
    }

    it('the_medicare_number_never_reaches_the_agreement_or_an_event', async () => {
      const surfaces = await agreementSurfaces();
      /*
       * Hard rule 1, as D-2026-09-14-03 states it exactly: the number is
       * content on the practice's own form and lives on the job row. It is
       * never used to verify, never used to match, and never in an event —
       * so neither its printed spelling nor its bare digits appear here.
       */
      expect(surfaces).not.toContain(FAKE_MEDICARE);
      expect(surfaces).not.toContain(FAKE_MEDICARE.replace(/ /g, ''));
      /*
       * THE FIELD, NOT THE WORD. "Medicare" appears in the agreement copy and
       * must — the template is titled "Assignment of Medicare Benefit" and the
       * statement assigns a right to the Medicare benefit. What may never
       * appear is a place the NUMBER could sit, so the keys are what is
       * asserted, and `"irn"` is quoted because three bare letters are a run
       * an unrelated word can produce (wow.md §2.6).
       */
      expect(surfaces.toLowerCase()).not.toContain('medicarecardnumber');
      expect(surfaces.toLowerCase()).not.toContain('medicarenumber');
      expect(surfaces).not.toContain('"irn"');

      // And it IS still on the job row, which is the practice's own form.
      const job = await jobRow(FIRST_SHA);
      expect(JSON.stringify(job!.payload)).toContain(FAKE_MEDICARE);
    });

    it('no_dollar_amount_reaches_the_agreement_or_an_event', async () => {
      const surfaces = await agreementSurfaces();
      /*
       * QUOTED, DELIBERATELY. A bare `45.05` is a run an ISO timestamp's
       * seconds-and-milliseconds can produce by chance (`...T09:12:45.052Z`),
       * and a hard-rule test that flakes on the clock is a hard-rule test
       * somebody eventually deletes (wow.md §2.6). An amount that leaked would
       * be a JSON string value or a key, and both are caught here.
       */
      for (const amount of PRINTED_AMOUNTS) expect(surfaces).not.toContain(`"${amount}"`);
      expect(surfaces.toLowerCase()).not.toContain('benefitassigned');
      expect(surfaces.toLowerCase()).not.toContain('"benefit"');
      expect(surfaces.toLowerCase()).not.toContain('"amount"');

      const job = await jobRow(FIRST_SHA);
      expect(JSON.stringify(job!.payload)).toContain(PRINTED_AMOUNTS[0]);
    });
  });

  describe('practice scoping', () => {
    it('a_db4_from_another_practice_is_never_visible', async () => {
      // RLS is FORCE and fails closed: the same reads, under a different
      // practice's scope, see nothing at all — job row, service record or
      // agreement.
      const seen = await prisma.withPractice(otherPracticeId, async (tx) => ({
        jobs: await tx.inboundPrintJob.count({ where: { sourceSha256: { in: [FIRST_SHA, REPRINT_SHA, UNKNOWN_SHA] } } }),
        records: await tx.serviceRecord.count({ where: { pmsInvoiceKey: IDEMPOTENCY_KEY } }),
        agreements: await tx.agreement.count({}),
        patients: await tx.patient.count({ where: { patientRecordNumber: CHART_NUMBER } }),
      }));
      expect(seen).toEqual({ jobs: 0, records: 0, agreements: 0, patients: 0 });

      /*
       * AND THE SAME FORM POSTED BY THE OTHER PRACTICE IS ITS OWN. It holds no
       * patient with that chart number, so it places nothing — and it must not
       * reach across into the first practice's patient to do so.
       */
      const crossSha = sha('db4-other-practice');
      await post(db4Record({ sourceSha256: crossSha }), otherPracticeId).expect(202);
      for (let i = 0; i < 25; i++) {
        await worker.sweep('critical');
        const row = await prisma.withPractice(otherPracticeId, (tx) =>
          tx.inboundPrintJob.findFirst({ where: { sourceSha256: crossSha } }),
        );
        if (row && (row.state === 'done' || row.state === 'dead')) {
          expect(row.state).toBe('done');
          expect(db4Outcome(row).db4.reason).toBe('unknown_chart_number');
          expect(db4Outcome(row).db4.placed).toBe(false);
          return;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error('The other practice’s DB4 did not settle.');
    });
  });

  /*
   * LAST, AND ON PURPOSE. This one leaves an unlocked agreement behind — that
   * is what the refusal means — and the counts asserted above are taken before
   * it runs.
   */
  describe('a refusal the status code cannot explain', () => {
    it('a_rules_refusal_is_recorded_as_itself_not_as_a_provider_fault', async () => {
      const refusedSha = sha('db4-rules-decline');
      rulesDecline = true;
      try {
        await post(
          db4Record({ sourceSha256: refusedSha, formReference: 'HSS0610012092026999999' }),
        ).expect(202);
        const [job] = await settle([refusedSha]);
        expect(job.state).toBe('done');

        /*
         * THE SERVICE RECORD IS WHAT TELLS THEM APART. `lockParticulars` refuses
         * with a 400, exactly as an ambiguous provider number does — but this
         * one happened after phase 1 committed, so the provider plainly
         * resolved. A mapping that read the status alone would file "the rules
         * engine declined the particulars" as "two practitioners hold that
         * provider number" and send whoever diagnoses it to the wrong screen.
         */
        const outcome = db4Outcome(job);
        expect(outcome.db4.reason).toBe('refused_after_service_record');
        expect(outcome.db4.reason).not.toBe('provider_number_ambiguous');
        expect(outcome.db4.refusedStatus).toBe(400);
        expect(outcome.db4.placed).toBe(false);
        expect(outcome.db4.serviceRecordId).not.toBeNull();
        expect(outcome.db4.decision).toBe('episodic_post');

        /*
         * NOTHING WAS LOCKED, SO NOTHING CAN BE SIGNED (hard rule 2,
         * REQ-REG-06). `serviceRendered` moves the agreement to
         * `awaiting_signature` and THEN locks, so the status alone is not the
         * gate and is not asserted here: `AgreeService.signature` requires the
         * status AND `particularsLockedAt`, and the render that a signature is
         * taken against never happened either.
         */
        const agreement = await prisma.withPractice(practiceId, (tx) =>
          tx.agreement.findFirst({ where: { id: outcome.db4.agreementId! } }),
        );
        expect(agreement?.particularsLockedAt).toBeNull();
        expect(agreement?.renderedArtefactHash).toBeNull();
      } finally {
        rulesDecline = false;
      }
    });
  });
});
