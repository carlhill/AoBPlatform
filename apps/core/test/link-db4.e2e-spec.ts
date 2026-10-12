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
 * RECEPTION SENDS AN UNSIGNED DB4 TO THE PATIENT'S PHONE, AND IT IS SIGNED
 * THERE EXACTLY AS IT WOULD BE ON THE TABLET (TELEHEALTH-PLAN §8 step 1,
 * 12 Oct 2026; D-2026-10-11-07, D-2026-10-11-08 scenario B "by link only").
 *
 * THE WHOLE PATH, IN ORDER, against real Postgres:
 *   1. A DB4 Print Record becomes a locked post-service agreement.
 *   2. Reception presses resend on the reconciliation queue; the message goes
 *      to the contact ON FILE and nowhere else.
 *   3. The link names nobody until three identifiers are typed (REQ-VER-03,
 *      REQ-CHILD-04) — even though the DB4 is already at the signing step.
 *   4. The read carries the tablet's own DB4 view: masked card number, the
 *      amount exactly as printed, no practitioner signature.
 *   5. A drawn signature with every tick: stored, the Signed-DB4 rendered and
 *      hashed, the vault events written through the outbox, and the form on
 *      the write-back listing AOBPRINTER collects from.
 *   6. Five wrong guesses at a forwarded link lock the LINK and leave the DB4
 *      signable at the desk (hard rule 8).
 *
 * FAKE IDENTITIES THROUGHOUT. The card number below is not in the Medicare
 * format at all, and must never appear in anything the link returns.
 */

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

/** Not a Medicare-format number in any reading: letters, and four digits. */
const FAKE_CARD = 'FAKE-CARD-1234';
const SERVICING_NUMBER = '5745385T';
const PAYEE_NUMBER = '0636678W';
const PRINTED_AMOUNT = '45.05';
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const PATIENT = {
  chart: '00790',
  formReference: 'TST0790012102026120300',
  familyName: 'Fakename',
  givenNames: 'Linky',
  dob: '1966-06-06',
  address: '22 Example Street, Sampletown NSW 2000',
  email: 'linky.fakename@example.invalid',
};
const LOCKED_PATIENT = {
  chart: '00791',
  formReference: 'TST0791012102026120300',
  familyName: 'Fakename',
  givenNames: 'Forwarded',
  dob: '1977-07-07',
  address: '24 Example Street, Sampletown NSW 2000',
  mobile: '+61400000791',
};

const passingRules = {
  validate: async (): Promise<ValidationResponse> => ({
    valid: true,
    results: [{ rule: 'C8', outcome: 'pass', message: 'D7 is complete.', citation: 's 65C(4)' }],
    ruleSetVersion: 'test-rules-1',
    mappingVersion: 'test-mapping-1',
  }),
};

type Json = Record<string, unknown>;

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

/** The example's SHAPE, this suite's values — the same move `db4-assignment.e2e-spec.ts` makes. */
function db4Record(who: { chart: string; formReference: string; familyName: string; givenNames: string; address: string }, sourceSha256: string): Json {
  const example = withoutComments(
    JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'DB4-print.example.json'), 'utf8')),
  ) as Json;
  const patient = example.patient as Json;
  const providers = example.providers as Json[];
  const services = example.services as Json[];
  return {
    ...example,
    sourceSha256,
    capturedAt: new Date().toISOString(),
    form: { ...(example.form as Json), formReference: who.formReference, serviceDate: today() },
    servicingLocation: {
      ...(example.servicingLocation as Json),
      name: 'Example Family Medical Practice',
      addressLines: ['1 EXAMPLE STREET'],
      suburb: 'Sampletown',
      postcode: '2000',
    },
    patient: {
      ...patient,
      pmsLinkageKey: `chart:${who.chart}`,
      patientRecordNumber: who.chart,
      // eslint-disable-next-line no-restricted-syntax -- the fixture must name the field to replace it.
      medicareCardNumber: FAKE_CARD,
      givenNames: who.givenNames,
      familyName: who.familyName,
      address: who.address,
    },
    providers: [
      { ...providers[0], name: 'Dr Fake Servicing' },
      { ...providers[1], name: 'Dr Fake Payee' },
    ],
    services: services.slice(0, 1).map((s) => ({ ...s, serviceDate: today(), benefitAssigned: PRINTED_AMOUNT })),
  };
}

describe('the link page shows the DB4 sheets (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: InboundLaneWorkerService;
  const practiceId = randomUUID();

  let agreementId: string;
  let serviceRecordId: string;
  let token: string;
  let captureRequestId: string;
  let deskVerificationEventId: string | null;

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
      await tx.practice.create({
        data: { id: practiceId, name: 'Link DB4 Test Practice', documentFolderKey: 'patient_record_number' },
      });
      const servicing = await createServicingProvider(tx, practiceId, {
        name: 'Dr Fake Servicing',
        providerType: 'general_practitioner',
        providerNumber: SERVICING_NUMBER,
      });
      await createServicingProvider(tx, practiceId, {
        name: 'Dr Fake Payee',
        providerType: 'general_practitioner',
        providerNumber: PAYEE_NUMBER,
        locationId: servicing.locationId,
      });
      await tx.patient.create({
        data: {
          practiceId,
          patientRecordNumber: PATIENT.chart,
          familyName: PATIENT.familyName,
          givenNames: PATIENT.givenNames,
          dateOfBirth: new Date(PATIENT.dob),
          address: PATIENT.address,
          email: PATIENT.email,
        },
      });
      await tx.patient.create({
        data: {
          practiceId,
          patientRecordNumber: LOCKED_PATIENT.chart,
          familyName: LOCKED_PATIENT.familyName,
          givenNames: LOCKED_PATIENT.givenNames,
          dateOfBirth: new Date(LOCKED_PATIENT.dob),
          address: LOCKED_PATIENT.address,
          mobile: LOCKED_PATIENT.mobile,
        },
      });
    });
  });

  afterAll(async () => {
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.inboundPrintJob.deleteMany({});
      await tx.outboundItem.deleteMany({});
      await tx.captureRequest.deleteMany({});
      await tx.verificationChallenge.deleteMany({});
      await tx.serviceRecord.deleteMany({});
      // Artefacts are append-only by design (hard rule 11); they outlive the test.
      await tx.agreement.deleteMany({});
      await tx.assignor.deleteMany({});
      await tx.patient.deleteMany({});
      await tx.provider.deleteMany({});
      await deleteSeededAnchors(tx);
      await tx.practice.deleteMany({});
    });
    await prisma.vaultOutbox.deleteMany({});
    await app?.close();
  });

  async function printDb4(who: typeof PATIENT | typeof LOCKED_PATIENT, seed: string) {
    const sourceSha256 = sha(seed);
    await request(app.getHttpServer())
      .post('/inbound/print-jobs')
      .set('x-practice-id', practiceId)
      .send(db4Record(who, sourceSha256))
      .expect(202);
    for (let i = 0; i < 25; i++) {
      await worker.sweep('critical');
      const job = await prisma.withPractice(practiceId, (tx) => tx.inboundPrintJob.findFirst({ where: { sourceSha256 } }));
      if (job && (job.state === 'done' || job.state === 'dead')) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const record = await prisma.withPractice(practiceId, (tx) =>
      tx.serviceRecord.findFirst({ where: { pmsInvoiceKey: `db4:${who.formReference}` } }),
    );
    expect(record?.agreementId).toBeTruthy();
    return record!;
  }

  async function resend(recordId: string, channel: 'email_link' | 'sms_link') {
    const res = await request(app.getHttpServer())
      .post(`/reconciliation/${recordId}/resend`)
      .set('x-practice-id', practiceId)
      .send({ channel })
      .expect(201);
    return res.body as { captureRequestId: string; token: string };
  }

  it('a DB4 Print Record becomes a locked agreement waiting for a signature', async () => {
    const record = await printDb4(PATIENT, 'link-db4-first');
    serviceRecordId = record.id;
    agreementId = record.agreementId!;
    const agreement = await prisma.withPractice(practiceId, (tx) => tx.agreement.findFirst({ where: { id: agreementId } }));
    expect(agreement?.status).toBe('awaiting_signature');
    expect(agreement?.sourcePrintJobId).not.toBeNull();
    expect(agreement?.particularsLockedAt).not.toBeNull();
    deskVerificationEventId = agreement?.verificationEventId ?? null;
  });

  it('reception_sends_the_unsigned_db4_to_the_contact_on_file', async () => {
    const queue = await request(app.getHttpServer())
      .get('/reconciliation/outstanding')
      .set('x-practice-id', practiceId)
      .expect(200);
    const row = (queue.body as Array<{ serviceRecordId: string; agreementId: string | null; patientHasEmail: boolean }>).find(
      (item) => item.serviceRecordId === serviceRecordId,
    );
    expect(row?.agreementId).toBe(agreementId);
    expect(row?.patientHasEmail).toBe(true);

    const opened = await resend(serviceRecordId, 'email_link');
    token = opened.token;
    captureRequestId = opened.captureRequestId;
    expect(token).toBeTruthy();

    const messages = await prisma.withPractice(practiceId, (tx) =>
      tx.outboundItem.findMany({ where: { subjectType: 'CaptureRequest', subjectId: captureRequestId } }),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].channel).toBe('email');
    // The address the practice's system holds, and no other.
    expect(messages[0].destination).toBe(PATIENT.email);
    const body = JSON.stringify(messages[0].payload);
    expect(body).toContain(`/patient/agree/${token}`);
    expect(body).not.toContain(FAKE_CARD);
    expect(body).not.toContain(PRINTED_AMOUNT);
  });

  it('a_db4_link_shows_nothing_before_three_identifiers', async () => {
    const opened = await request(app.getHttpServer()).get(`/capture/link/${token}`).expect(200);
    expect(opened.body.identifierTypes).toHaveLength(3);
    // Hard rule 1: the Medicare number is never one of the types asked for.
    for (const type of opened.body.identifierTypes as string[]) expect(type).not.toMatch(/medicare/i);
    expect(JSON.stringify(opened.body)).not.toContain(PATIENT.givenNames);

    const early = await request(app.getHttpServer()).get(`/agree/${token}`).expect(409);
    expect(JSON.stringify(early.body)).not.toContain(PATIENT.givenNames);
    expect(JSON.stringify(early.body)).not.toContain(PATIENT.address);
  });

  it('a_db4_link_cannot_be_signed_before_three_identifiers', async () => {
    await request(app.getHttpServer())
      .post(`/agree/${token}/approve`)
      .send({ method: 'tap_to_approve', affirmations: [] })
      .expect(409);
    const agreement = await prisma.withPractice(practiceId, (tx) => tx.agreement.findFirst({ where: { id: agreementId } }));
    expect(agreement?.status).toBe('awaiting_signature');
    expect(agreement?.signatureEventId).toBeNull();
  });

  it('medicare_number_rejected_as_identifier', async () => {
    // Stating only a card number passes nothing; the challenge wants the approved types.
    const res = await request(app.getHttpServer())
      .post(`/capture/link/${token}/verify`)
      .send({ stated: { medicare_number: FAKE_CARD } });
    expect(res.status).toBeLessThan(500);
    expect(res.body.outcome).not.toBe('passed');
  });

  it('three identifiers pass, and the link’s own check is bound without inventing a transition', async () => {
    const verified = await request(app.getHttpServer())
      .post(`/capture/link/${token}/verify`)
      .send({ stated: { name: `${PATIENT.familyName} ${PATIENT.givenNames}`, date_of_birth: PATIENT.dob, address: PATIENT.address } })
      .expect(201);
    expect(verified.body.outcome).toBe('passed');

    const agreement = await prisma.withPractice(practiceId, (tx) => tx.agreement.findFirst({ where: { id: agreementId } }));
    expect(agreement?.status).toBe('awaiting_signature');
    expect(agreement?.verificationEventId).toBe(verified.body.verificationEventId);
    expect(agreement?.verificationEventId).not.toBe(deskVerificationEventId);

    /*
     * The vault says what happened: the status did not move, the verification
     * did. Only the event this verification wrote is read — the inbound lock
     * made a real `verification_pending → awaiting_signature` transition of
     * its own earlier, and that one is true.
     */
    const events = await prisma.vaultOutbox.findMany({
      where: { subjectType: 'Agreement', subjectId: agreementId, type: 'agreement.status_changed' },
    });
    const fromThisLink = events
      .map((e) => e.payload as Json)
      .filter((p) => p.verificationEventId === verified.body.verificationEventId);
    expect(fromThisLink).toEqual([
      { from: 'awaiting_signature', to: 'awaiting_signature', verificationEventId: verified.body.verificationEventId, channel: 'link' },
    ]);
  });

  let statementKeys: string[] = [];

  it('the_link_shows_the_db4_sheets — masked number, amount as printed, no practitioner signature', async () => {
    const before = await prisma.withPractice(practiceId, (tx) => tx.agreement.findFirst({ where: { id: agreementId } }));
    const res = await request(app.getHttpServer()).get(`/agree/${token}`).expect(200);
    const body = res.body as Json;
    const form = body.db4Form as Json;
    expect(form).toBeTruthy();
    // Hard rule 1: the masked string only; the value itself is nowhere in the response.
    // eslint-disable-next-line no-restricted-syntax -- reading the MASKED string is the assertion.
    expect((form.patient as Json).medicareCardNumberMasked).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain(FAKE_CARD);
    // Hard rule 4 as narrowed (D-2026-09-14-02): verbatim, never computed.
    expect(((form.services as Json[])[0] as Json).benefitAssigned).toBe(PRINTED_AMOUNT);
    // Hard rule 3: no practitioner signature field on anything the page draws.
    expect(JSON.stringify(body).toLowerCase()).not.toContain('practitionersignature');
    // Hard rule 2: the gate facts the page enables its control from.
    const gate = body.gate as Json;
    expect(gate.status).toBe('awaiting_signature');
    expect(gate.particularsLockedAt).toEqual(expect.any(String));
    expect(gate.ruleSetVersion).toBe('test-rules-1');
    // Hard rule 13: showing it moved nothing — the hash is the one taken at the lock.
    expect(gate.renderedArtefactHash).toBe(before?.renderedArtefactHash);
    statementKeys = (body.statements as Array<{ key: string }>).map((s) => s.key);
    expect(statementKeys.length).toBeGreaterThan(0);
  });

  it('link_takes_a_drawing_only_on_a_db4 — and refuses one with nothing drawn in it', async () => {
    await request(app.getHttpServer())
      .post(`/agree/${token}/approve`)
      .send({ method: 'drawn', affirmations: statementKeys })
      .expect(400);
  });

  it('the_link_signs_the_db4_and_the_signed_db4_is_produced_vaulted_and_listed_for_write_back', async () => {
    const signed = await request(app.getHttpServer())
      .post(`/agree/${token}/approve`)
      .send({
        method: 'drawn',
        affirmations: statementKeys,
        signature: {
          vector: [{ points: [{ x: 10, y: 40, t: 0 }, { x: 60, y: 80, t: 22, p: 0.35 }] }],
          rasterPngBase64: TINY_PNG,
          padWidth: 600,
          padHeight: 200,
        },
      })
      .expect(201);
    expect(signed.body.approved).toBe(true);
    expect(signed.body.status).toBe('stored');

    const agreement = await prisma.withPractice(practiceId, (tx) => tx.agreement.findFirst({ where: { id: agreementId } }));
    expect(agreement?.status).toBe('stored');
    expect(agreement?.signedDb4Sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(agreement?.signedDb4ArtefactId).not.toBeNull();

    const event = await prisma.withPractice(practiceId, (tx) =>
      tx.signatureEvent.findFirst({ where: { id: agreement!.signatureEventId! } }),
    );
    expect(event?.method).toBe('drawn');
    expect(event?.channel).toBe('email_link');
    expect(event?.verificationEventId).toBe(agreement?.verificationEventId);

    // This link's request completed; the tablet's in-practice request closed with it (FR-2.7).
    const requests = await prisma.withPractice(practiceId, (tx) => tx.captureRequest.findMany({ where: { agreementId } }));
    expect(requests.find((r) => r.id === captureRequestId)?.status).toBe('completed');
    expect(requests.filter((r) => r.status === 'open')).toHaveLength(0);

    // Hard rule 11: the evidence went through the outbox, and carries no value.
    const outbox = await prisma.vaultOutbox.findMany({ where: { subjectId: { in: [agreementId, captureRequestId] } } });
    const types = outbox.map((e) => e.type);
    expect(types).toContain('capture.completed');
    expect(
      outbox.some((e) => e.type === 'agreement.rendered' && (e.payload as Json).kind === 'signed_db4'),
    ).toBe(true);
    const serialised = JSON.stringify(outbox.map((e) => e.payload));
    expect(serialised).not.toContain(FAKE_CARD);
    expect(serialised).not.toContain(PATIENT.givenNames);

    // Written back exactly as from the tablet: on AOBPRINTER's collection list.
    const list = await request(app.getHttpServer())
      .get('/inbound/print-jobs/signed')
      .set('x-practice-id', practiceId)
      .expect(200);
    const row = (list.body as Array<Record<string, string>>).find((r) => r.agreementId === agreementId);
    expect(row?.sha256).toBe(agreement?.signedDb4Sha256);
    expect(row?.patientRecordNumber).toBe(PATIENT.chart);
  });

  it('a used DB4 link is a dead link', async () => {
    await request(app.getHttpServer()).get(`/agree/${token}`).expect(410);
  });

  it('a_locked_link_leaves_a_signable_db4_signable (hard rule 8)', async () => {
    const record = await printDb4(LOCKED_PATIENT, 'link-db4-forwarded');
    const lockedAgreementId = record.agreementId!;
    const opened = await resend(record.id, 'sms_link');
    const sms = await prisma.withPractice(practiceId, (tx) =>
      tx.outboundItem.findFirst({ where: { subjectType: 'CaptureRequest', subjectId: opened.captureRequestId } }),
    );
    expect(sms?.destination).toBe(LOCKED_PATIENT.mobile);

    await request(app.getHttpServer()).get(`/capture/link/${opened.token}`).expect(200);
    let outcome = '';
    for (let i = 0; i < 10 && outcome !== 'locked_out'; i++) {
      const res = await request(app.getHttpServer())
        .post(`/capture/link/${opened.token}/verify`)
        .send({ stated: { name: 'Wrong Person', date_of_birth: '1900-01-01', address: 'Nowhere' } });
      outcome = res.body.outcome;
    }
    expect(outcome).toBe('locked_out');

    await request(app.getHttpServer()).get(`/agree/${opened.token}`).expect(423);
    const agreement = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: lockedAgreementId } }),
    );
    expect(agreement?.status).toBe('awaiting_signature');
    // The tablet's in-practice request is still open: the desk can still hand the tablet over.
    const inPractice = await prisma.withPractice(practiceId, (tx) =>
      tx.captureRequest.findFirst({ where: { agreementId: lockedAgreementId, channel: 'in_practice' } }),
    );
    expect(inPractice?.status).toBe('open');
  });
});
