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
import { SIGNED_DB4_CONTENT_VERSION } from '@aobplatform/domain';
import { SignedDb4Service } from '../src/agreements/signed-db4.service';
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
/**
 * A ONE-PIXEL PNG, base64 — the smallest thing the signature pad could
 * plausibly have produced, and enough for the renderer to composite and for
 * the artefact store to detect as `image/png`. The MARK is not the subject of
 * these tests; that it reaches the page is.
 */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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
        /*
         * THE SIGNED-DB4 AND THE DRAWN MARK ARE DELIBERATELY NOT CLEANED UP,
         * the same call `signature.e2e-spec.ts` makes and for the same reason:
         * `artefacts` is append-only and the database says so — a DELETE
         * raises "Artefacts are not deleted. Tombstone the row." Evidence
         * outliving its subject is the design (hard rule 11), and a test that
         * could delete it would be a test proving the opposite of what the
         * table promises.
         */
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
      /*
       * THE LINK BACK TO THE FORM, AND IT IS A COLUMN (D-2026-09-14-02). The
       * Signed-DB4 is rendered from the DB4 Print Record — the headings, the
       * patient block, the service rows with their amounts — none of which is
       * in the particulars, so the producer has to find the print job. Before
       * this the only routes were unindexed JSON on the queue row pointing the
       * wrong way, and a `pmsInvoiceKey` string convention.
       */
      expect(agreement?.sourcePrintJobId).toBe(job.id);
      // And nothing has been produced from it yet: the agreement is not signed.
      expect(agreement?.signedDb4Sha256).toBeNull();

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

      /*
       * AND THE ONE AGREEMENT STILL POINTS AT THE FIRST PRINT. A reprint must
       * not re-point the link: the record the Signed-DB4 is rendered from is
       * the one that made the agreement, and swapping it silently would change
       * the provenance of a document already in the folder.
       */
      const first = await jobRow(FIRST_SHA);
      const agreement = await prisma.withPractice(practiceId, (tx) =>
        tx.agreement.findFirst({ where: { type: 'episodic_post', patientId } }),
      );
      expect(agreement?.sourcePrintJobId).toBe(first?.id);
      expect(agreement?.sourcePrintJobId).not.toBe(job.id);
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

  /*
   * THE DB4 THE PATIENT READS ON THE TABLET (D-2026-09-27-01: *"patient sees
   * the db4 with the cost on it"*, *"mask on the tablet, full on the form"*).
   *
   * WHY THESE ARE E2E AND NOT UNIT TESTS. `db4-form-view.spec.ts` proves the
   * projection and the mask; it cannot prove what reached the WIRE. The one
   * assertion that does is against a serialised response body, and it is the
   * assertion hard rule 1 actually needs: a full number masked in the markup
   * is not masked, because it still sits in the payload, in the network tab
   * and in the React tree of a tablet that is handed to strangers all day.
   *
   * BEFORE THE SIGNED-DB4 BLOCK, which signs this agreement and moves it out
   * of `awaiting_signature` — the state the tablet reads it in.
   */
  describe('the DB4 the patient reads on the tablet', () => {
    /** The agreement the handler made from the first print, as the tablet fetches it. */
    async function tabletSees(scope = practiceId) {
      const first = await jobRow(FIRST_SHA);
      const agreement = await prisma.withPractice(practiceId, (tx) =>
        tx.agreement.findFirst({ where: { sourcePrintJobId: first!.id } }),
      );
      return {
        agreement: agreement!,
        response: await request(app.getHttpServer())
          .get(`/agreements/${agreement!.id}`)
          .set('x-practice-id', scope),
      };
    }

    it('the_tablet_never_receives_an_unmasked_medicare_number', async () => {
      const { response } = await tabletSees();
      expect(response.status).toBe(200);

      /*
       * THE SERIALISED BODY, NOT THE PARSED ONE. `res.text` is the bytes that
       * crossed the wire, which is the only thing that proves the value did
       * not travel — an assertion on an object could be satisfied by a field
       * nobody looked at.
       */
      expect(response.text).not.toContain(FAKE_MEDICARE);
      expect(response.text).not.toContain(FAKE_MEDICARE.replace(/ /g, ''));
      // The key itself cannot be there either. Quoted so that the MASKED
      // field, whose name contains it, does not satisfy the check.
      expect(response.text).not.toContain('"medicareCardNumber"');

      // And what the patient does see: enough to recognise the card as
      // theirs, not enough for the person three seats away to use.
      const form = response.body.db4Form;
      // eslint-disable-next-line no-restricted-syntax -- the MASKED field, which is the only one the tablet is given.
      expect(form.patient.medicareCardNumberMasked).toBe('•••• ••999 9');
      expect(form.patient.irn).toBe('1');
      expect(form.patient.patientRecordNumber).toBe(CHART_NUMBER);

      // The number is still in full where it belongs — the practice's own
      // form on the job row, which the Signed-DB4 is drawn from.
      const job = await jobRow(FIRST_SHA);
      expect(JSON.stringify(job!.payload)).toContain(FAKE_MEDICARE);
    });

    it('the_tablet_shows_the_amount_pracsoft_printed_and_never_one_we_computed', async () => {
      const { response } = await tabletSees();
      const services = response.body.db4Form.services as { benefitAssigned: unknown }[];
      // VERBATIM STRINGS, in the order the form prints them (hard rule 4 as
      // narrowed by D-2026-09-14-02: AoB never originates a figure).
      expect(services.map((service) => service.benefitAssigned)).toEqual(PRINTED_AMOUNTS);
      for (const service of services) expect(typeof service.benefitAssigned).toBe('string');
      // NO TOTAL ANYWHERE. 45.05 + 22.40 is a figure we would have computed.
      expect(response.text).not.toContain('67.45');
      expect(response.text.toLowerCase()).not.toContain('"total"');
    });

    it('the_pathology_offer_is_filtered_from_the_tablet_as_it_is_from_the_form', async () => {
      const { response } = await tabletSees();
      const statements = response.body.db4Form.statements as { key: string }[];
      /*
       * ONE STATEMENT WHERE THE PRACTICE'S PAPER HAS TWO, and the same one
       * `SignedDb4Renderer.drawAssignment` keeps — s 65C(4) items 1–4 are out
       * of scope (CLAUDE.md §8), and the patient's mark must not sit under an
       * assignment this product does not validate, store or write back.
       */
      expect(statements.map((statement) => statement.key)).toEqual(['assign_to_health_professional']);
      expect(response.text).not.toContain('Approved Pathology Practitioner');
      // The form's own heading and the servicing location, so the screen is
      // recognisably the page the practice printed.
      expect(response.body.db4Form.headingLines[1]).toBe('BULK BILL ASSIGNMENT OF BENEFIT FORM');
      expect(response.body.db4Form.formReference).toBe(FORM_REFERENCE);
    });

    it('the_db4_form_view_is_display_data_and_moves_no_stored_byte', async () => {
      // HARD RULE 13. The block rides on a response and dies with it: it is
      // not a particular, it is not hashed, and it is not stored.
      const { agreement, response } = await tabletSees();
      expect(response.body.db4Form).toBeDefined();

      const after = await prisma.withPractice(practiceId, (tx) =>
        tx.agreement.findFirst({ where: { id: agreement.id } }),
      );
      expect(after!.renderedArtefactHash).toBe(agreement.renderedArtefactHash);
      expect(after!.particularsLockedAt).toEqual(agreement.particularsLockedAt);
      expect(JSON.stringify(after)).not.toContain('db4Form');
      expect(JSON.stringify(after!.particulars)).not.toContain('45.05');
    });

    it('a_db4_form_view_never_crosses_a_practice_boundary', async () => {
      // RLS fails closed: another practice cannot read the agreement at all,
      // so there is no path to its form either.
      const { response } = await tabletSees(otherPracticeId);
      expect(response.status).toBe(404);
      expect(response.text).not.toContain(FAKE_MEDICARE);
    });

    /*
     * THE LOCK'S OWN RESPONSE — the seam D-2026-09-27-01 names, exercised on
     * an agreement that is still a draft.
     *
     * A HAND-MADE PRINT JOB AND A HAND-MADE DRAFT, on purpose. The handler
     * locks a real DB4 the moment it captures it, so the agreement it makes
     * can never be locked twice; and a second draft pointed at the FIRST job
     * would be found by the Signed-DB4 block's `findFirst` on
     * `sourcePrintJobId` and signed instead of the real one.
     */
    describe('the lock response', () => {
      let draftId: string;
      const OWN_SHA = sha('db4-for-the-lock-response');

      beforeAll(async () => {
        await prisma.withPractice(practiceId, async (tx) => {
          const job = await tx.inboundPrintJob.create({
            data: {
              practiceId,
              documentType: 'db4_assignment',
              lane: 'critical',
              pms: 'pracsoft3',
              parserTemplateVersion: 'pracsoft3-db4-2026-09-1',
              sourceSha256: OWN_SHA,
              payload: db4Record({ sourceSha256: OWN_SHA, formReference: 'HSS0610012092026999999' }) as never,
              // `inbound_print_jobs_done_has_time`: a job that says it is done
              // says when.
              state: 'done',
              processedAt: new Date(),
            },
          });
          const assignor = await tx.assignor.findFirst({});
          const draft = await tx.agreement.create({
            data: {
              practiceId,
              type: 'episodic_post',
              anchorKind: 'provider',
              affiliationId: servicingAffiliationId,
              patientId,
              assignorId: assignor!.id,
              assignorIsPatient: true,
              status: 'draft',
              sourcePrintJobId: job.id,
            },
          });
          draftId = draft.id;
        });
      });

      it('the_lock_response_carries_the_form_the_patient_is_about_to_sign', async () => {
        const locked = await request(app.getHttpServer())
          .post(`/agreements/${draftId}/particulars`)
          .set('x-practice-id', practiceId)
          .send({ serviceDate: today(), mbsItemNumbers: ['23'] })
          .expect(201);

        // The lock is unchanged — it still returns the agreement it always
        // returned — and the form view rides beside it.
        expect(locked.body.particularsLockedAt).not.toBeNull();
        expect(locked.body.renderedArtefactHash).toMatch(/^[0-9a-f]{64}$/);
        // eslint-disable-next-line no-restricted-syntax -- the MASKED field, which is the only one the tablet is given.
        expect(locked.body.db4Form.patient.medicareCardNumberMasked).toBe('•••• ••999 9');
        expect(locked.text).not.toContain(FAKE_MEDICARE);
        // And none of it entered the particulars that were validated, hashed
        // and stored (hard rules 4 and 13).
        expect(JSON.stringify(locked.body.particulars)).not.toContain('45.05');
      });

      it('a_missing_print_record_never_blocks_the_ceremony', async () => {
        /*
         * HARD RULE 8, REQ-REC-04. A form view that cannot be built costs the
         * patient a picture of their form and nothing else: the lock still
         * succeeds, the agreement is still signable, and the block is simply
         * absent. Nobody fails to sign because a page could not be drawn.
         */
        const orphanId = await prisma.withPractice(practiceId, async (tx) => {
          const assignor = await tx.assignor.findFirst({});
          const draft = await tx.agreement.create({
            data: {
              practiceId,
              type: 'episodic_post',
              anchorKind: 'provider',
              affiliationId: servicingAffiliationId,
              patientId,
              assignorId: assignor!.id,
              assignorIsPatient: true,
              status: 'draft',
              // A job id that resolves to nothing: deleted, never written, or
              // another practice's row.
              sourcePrintJobId: randomUUID(),
            },
          });
          return draft.id;
        });

        const locked = await request(app.getHttpServer())
          .post(`/agreements/${orphanId}/particulars`)
          .set('x-practice-id', practiceId)
          .send({ serviceDate: today(), mbsItemNumbers: ['23'] })
          .expect(201);
        expect(locked.body.particularsLockedAt).not.toBeNull();
        expect(locked.body.db4Form).toBeUndefined();

        const fetched = await request(app.getHttpServer())
          .get(`/agreements/${orphanId}`)
          .set('x-practice-id', practiceId)
          .expect(200);
        expect(fetched.body.db4Form).toBeUndefined();
      });

      it('an_agreement_that_never_came_from_a_db4_carries_no_block_at_all', async () => {
        /*
         * D-2026-09-27-02: the discriminator is the SESSION, not the practice.
         * A walk-up at a practice with no PMS has no print record, so the new
         * path does not run at all rather than running and producing the same
         * answer — and the tablet draws exactly what it drew before.
         */
        const walkUpId = await prisma.withPractice(practiceId, async (tx) => {
          const assignor = await tx.assignor.findFirst({});
          const draft = await tx.agreement.create({
            data: {
              practiceId,
              type: 'episodic_post',
              anchorKind: 'provider',
              affiliationId: servicingAffiliationId,
              patientId,
              assignorId: assignor!.id,
              assignorIsPatient: true,
              status: 'draft',
            },
          });
          return draft.id;
        });

        const fetched = await request(app.getHttpServer())
          .get(`/agreements/${walkUpId}`)
          .set('x-practice-id', practiceId)
          .expect(200);
        expect(fetched.body.sourcePrintJobId).toBeNull();
        expect(fetched.body.db4Form).toBeUndefined();
      });
    });
  });

  /*
   * THE SIGNED-DB4 — THE WHOLE PATH, AGAINST REAL POSTGRES (D-2026-09-14-02/-03).
   *
   * LAST, AND DELIBERATELY SO: this block signs the agreement the earlier
   * tests examine, which moves it out of `awaiting_signature`. Nothing below
   * it depends on that state.
   *
   * WHY IT HAS TO BE AN E2E AND NOT ANOTHER UNIT TEST. The unit specs mock
   * Prisma, so they prove the service's logic and nothing about whether the
   * database will accept what it writes. The first version of this build
   * added `signed_db4` to the domain's `ARTEFACT_PURPOSES` and not to the
   * `artefacts_purpose_known` CHECK — and because a failed Signed-DB4 render
   * is swallowed on purpose (hard rule 8: nothing may block care), every
   * practice would have signed DB4s, seen no form in the folder, and read one
   * log line. `artefact-purposes.spec.ts` now catches that class at the
   * bench; this catches everything else the database has an opinion about.
   */
  describe('the Signed-DB4', () => {
    /*
     * CARRIED BETWEEN THE THREE TESTS RATHER THAN RE-FOUND. By the time this
     * block runs the patient has TWO `episodic_post` agreements — the rules
     * refusal above made a second one — so a `findFirst` on the type would
     * pick whichever the planner returned and pass or fail by accident.
     */
    let signedAgreementId: string;

    it('a_signed_db4_is_produced_and_stored_when_the_patient_signs', async () => {
      const first = await jobRow(FIRST_SHA);
      const before = await prisma.withPractice(practiceId, (tx) =>
        tx.agreement.findFirst({ where: { sourcePrintJobId: first!.id } }),
      );
      expect(before).not.toBeNull();
      signedAgreementId = before!.id;
      expect(before?.status).toBe('awaiting_signature');
      expect(before?.sourcePrintJobId).not.toBeNull();
      expect(before?.signedDb4Sha256).toBeNull();

      /*
       * THE STATEMENT KEYS COME OFF THE STORED DOCUMENT, never a literal here
       * (hard rule 14): the words are versioned content and a test that
       * hard-coded them would go green against wording nobody ships.
       */
      const document = before?.renderPayload as unknown as {
        template: { statements: { key: string }[] };
      };
      const affirmations = document.template.statements.map((s) => s.key);

      const capture = await prisma.withPractice(practiceId, (tx) =>
        tx.captureRequest.findFirst({ where: { agreementId: before!.id, status: 'open' } }),
      );

      const signed = await request(app.getHttpServer())
        .post(`/agreements/${before!.id}/sign`)
        .set('x-practice-id', practiceId)
        .send({
          method: 'drawn',
          channel: 'in_practice',
          captureRequestId: capture?.id,
          affirmations,
          signature: {
            vector: [{ points: [{ x: 10, y: 40, t: 0 }, { x: 60, y: 80, t: 22, p: 0.35 }] }],
            rasterPngBase64: TINY_PNG,
            padWidth: 600,
            padHeight: 200,
          },
        })
        .expect(201);
      expect(signed.body.status).toBe('stored');

      const after = await prisma.withPractice(practiceId, (tx) =>
        tx.agreement.findFirst({ where: { id: before!.id } }),
      );
      // The form exists, is hashed, and says what made it (hard rules 13/14).
      expect(after?.signedDb4Sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(after?.signedDb4RendererVersion).toBe('signed-db4-1');
      expect(after?.signedDb4ContentVersion).toBe(SIGNED_DB4_CONTENT_VERSION);
      expect(after?.signedDb4ArtefactId).not.toBeNull();
      expect(after?.signedDb4RenderedAt).not.toBeNull();
      // And the signed agreement itself is untouched by it.
      expect(after?.renderedArtefactHash).toBe(before?.renderedArtefactHash);
      expect(after?.signatureEventId).toBe(signed.body.signatureEventId);

      /*
       * THE BYTES ARE REALLY STORED, UNDER A PURPOSE THE DATABASE ACCEPTS.
       * This assertion is the one that would have failed on the missing CHECK.
       */
      const artefact = await prisma.withPractice(practiceId, (tx) =>
        tx.artefact.findFirst({ where: { id: after!.signedDb4ArtefactId! } }),
      );
      expect(artefact?.purpose).toBe('signed_db4');
      expect(artefact?.detectedContentType).toBe('application/pdf');
      expect(artefact?.sha256).toBe(after?.signedDb4Sha256);
      expect(artefact?.subjectId).toBe(before!.id);
      // No name, no chart number, no card number in a filename.
      expect(artefact?.filename).toBe(`signed-db4-${before!.id}.pdf`);
    });

    it('the_signed_db4_is_recorded_in_the_vault_with_no_pii', async () => {
      const agreement = await prisma.withPractice(practiceId, (tx) =>
        tx.agreement.findFirst({ where: { id: signedAgreementId } }),
      );
      const events = await prisma.vaultOutbox.findMany({
        where: { subjectType: 'Agreement', subjectId: agreement!.id, type: 'agreement.rendered' },
      });
      const reproduction = events
        .map((e) => e.payload as Record<string, unknown>)
        .filter((p) => p.kind === 'signed_db4');
      expect(reproduction).toHaveLength(1);
      expect(reproduction[0].artefactSha256).toBe(agreement!.signedDb4Sha256);
      expect(reproduction[0].sourcePrintJobId).toBe(agreement!.sourcePrintJobId);

      /*
       * HARD RULES 1 AND 9. The card number and the amounts are ON the page
       * and in NOTHING that describes it — not this event, not any other.
       * The same assertion `the_medicare_number_never_reaches_the_agreement_
       * or_an_event` makes, re-made now that a page carrying the number
       * exists.
       */
      const everything = JSON.stringify(
        await prisma.vaultOutbox.findMany({ where: { subjectId: agreement!.id } }),
      );
      expect(everything).not.toContain(FAKE_MEDICARE);
      expect(everything).not.toContain('45.05');
    });

    it('asking again produces no second document', async () => {
      const agreement = await prisma.withPractice(practiceId, (tx) =>
        tx.agreement.findFirst({ where: { id: signedAgreementId } }),
      );
      const outcome = await app.get(SignedDb4Service).produce(practiceId, agreement!.id);
      expect(outcome).toEqual({ produced: false, reason: 'already_produced' });

      const artefacts = await prisma.withPractice(practiceId, (tx) =>
        tx.artefact.count({ where: { purpose: 'signed_db4', subjectId: agreement!.id } }),
      );
      expect(artefacts).toBe(1);
    });
  });
});
