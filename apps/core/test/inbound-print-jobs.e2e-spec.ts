import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../src/messaging/gateway';
import { InboundLaneWorkerService } from '../src/inbound/inbound-lane.worker';

/**
 * The print channel's queue — CONSULTATION-CAPTURE-PLAN.md Part 8 (8.4) and
 * Part 9, build-order item 3.
 *
 * WHAT THIS PINS. A print job is accepted in one write and processed by the
 * worker for ITS lane; the lane comes from the document type and never from
 * the caller; the same document twice is one job; a payload that can never
 * work fails permanently instead of retrying for six hours; and what the job
 * did is written onto the row. The workers are driven directly rather than
 * waited on, because a test that sleeps for a timer is a test of the clock.
 */

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);

describe('inbound print jobs (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: InboundLaneWorkerService;
  const practiceId = randomUUID();

  const provider = { pmsProviderKey: 'pj-prov-1', name: 'Dr Printed Provider', locationAddress: '2 Print Lane, Sampletown NSW 2000' };
  const adult = {
    pmsLinkageKey: 'pj-pat-adult',
    familyName: 'Printed',
    givenNames: 'Pat',
    dateOfBirth: '1965-04-02',
    email: 'pat.printed@example.invalid',
    mobile: '+61400000009',
  };

  const base = (documentType: string, seed: string) => ({
    documentType,
    sourceSha256: sha(seed),
    parserTemplateVersion: 'best_practice/arrival_slip@3',
    pms: 'best_practice',
    capturedAt: new Date().toISOString(),
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_GATEWAY)
      .useValue({ mode: 'test', dispatch: async () => ({ accepted: true }) } as MessagingGateway)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    worker = app.get(InboundLaneWorkerService);

    await prisma.withPractice(practiceId, (tx) => tx.practice.create({ data: { id: practiceId, name: 'Print Channel Test Practice' } }));
  });

  afterAll(async () => {
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.inboundPrintJob.deleteMany({});
      await tx.outboundItem.deleteMany({});
      await tx.appointment.deleteMany({});
      await tx.captureRequest.deleteMany({});
      await tx.verificationChallenge.deleteMany({});
      await tx.serviceRecord.deleteMany({});
      await tx.agreement.deleteMany({});
      await tx.assignor.deleteMany({});
      await tx.patient.deleteMany({});
      await tx.provider.deleteMany({});
      await tx.practice.deleteMany({});
    });
    await prisma.vaultOutbox.deleteMany({});
    await app?.close();
  });

  const post = (body: object) => request(app.getHttpServer()).post('/inbound/print-jobs').set('x-practice-id', practiceId).send(body);

  /**
   * Drive the lane until these jobs are terminal. The worker's real
   * `@Interval` is running in this app too — the critical lane every second —
   * so "how many did THIS sweep process" is a race, and asserting on it would
   * be a test of timing. What matters is the state the jobs end in.
   */
  async function settle(lane: 'critical' | 'standard' | 'fyi', shas: string[]) {
    for (let i = 0; i < 25; i++) {
      await worker.sweep(lane);
      const rows = await prisma.withPractice(practiceId, (tx) =>
        tx.inboundPrintJob.findMany({ where: { sourceSha256: { in: shas } } }),
      );
      if (rows.length === shas.length && rows.every((r) => r.state === 'done' || r.state === 'dead')) return rows;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Jobs on the ${lane} lane did not settle: ${shas.join(', ')}`);
  }

  describe('the door', () => {
    it('accepts an arrival slip with 202 on the CRITICAL lane — the patient is at the desk', async () => {
      const res = await post({
        ...base('arrival_slip', 'slip-1'),
        patients: [adult],
        providers: [provider],
        appointments: [{ pmsAppointmentKey: 'pj-appt-1', patientLinkageKey: adult.pmsLinkageKey, providerLinkageKey: provider.pmsProviderKey, date: today(), time: '09:10' }],
      }).expect(202);
      expect(res.body.lane).toBe('critical');
      expect(res.body.duplicate).toBe(false);
      expect(res.body.id).toBeDefined();
    });

    it('treats the same document printed twice as the same job — not an error, and not a second row', async () => {
      const again = await post({
        ...base('arrival_slip', 'slip-1'),
        patients: [adult],
        providers: [provider],
        appointments: [{ pmsAppointmentKey: 'pj-appt-1', patientLinkageKey: adult.pmsLinkageKey, providerLinkageKey: provider.pmsProviderKey, date: today() }],
      }).expect(202);
      expect(again.body.duplicate).toBe(true);
      const rows = await prisma.withPractice(practiceId, (tx) => tx.inboundPrintJob.count({ where: { documentType: 'arrival_slip' } }));
      expect(rows).toBe(1);
    });

    it('puts an invoice on the critical lane and the morning list on the standard lane — the caller never chooses', async () => {
      const inv = await post({
        ...base('invoice', 'inv-1'),
        patients: [adult],
        providers: [provider],
        invoices: [{ pmsInvoiceKey: 'pj-inv-1', patientLinkageKey: adult.pmsLinkageKey, providerLinkageKey: provider.pmsProviderKey, serviceDate: daysAgo(3), mbsItemNumbers: ['23'] }],
      }).expect(202);
      expect(inv.body.lane).toBe('critical');

      const list = await post({
        ...base('appointment_list', 'list-1'),
        patients: [adult],
        providers: [provider],
        appointments: [
          { pmsAppointmentKey: 'pj-appt-2', patientLinkageKey: adult.pmsLinkageKey, providerLinkageKey: provider.pmsProviderKey, date: today(), time: '10:00' },
          { pmsAppointmentKey: 'pj-appt-1', patientLinkageKey: adult.pmsLinkageKey, providerLinkageKey: provider.pmsProviderKey, date: today(), time: '09:10' },
        ],
      }).expect(202);
      expect(list.body.lane).toBe('standard');
    });

    it('refuses what is not a declared document, a malformed hash, and strips fields that have no business arriving', async () => {
      await post({ ...base('clinical_notes', 'x') }).expect(400);
      await post({ ...base('invoice', 'y'), sourceSha256: 'not-a-hash' }).expect(400);

      // A Medicare number has no field to land in. `whitelist: true` strips it at the door.
      const smuggled = await post({
        ...base('invoice', 'inv-smuggle'),
        patients: [{ ...adult, pmsLinkageKey: 'pj-pat-smuggle', medicareNumber: '2123 45670 1' }],
        providers: [provider],
        invoices: [{ pmsInvoiceKey: 'pj-inv-smuggle', patientLinkageKey: 'pj-pat-smuggle', providerLinkageKey: provider.pmsProviderKey, serviceDate: daysAgo(2), mbsItemNumbers: ['23'] }],
      }).expect(202);
      const row = await prisma.withPractice(practiceId, (tx) => tx.inboundPrintJob.findFirst({ where: { id: smuggled.body.id } }));
      expect(JSON.stringify(row!.payload)).not.toContain('medicareNumber');
      expect(JSON.stringify(row!.payload)).not.toContain('2123');
    });
  });

  describe('the lanes', () => {
    it('the critical lane turns the arrival slip and the invoice into consequences', async () => {
      const rows = await settle('critical', [sha('slip-1'), sha('inv-1'), sha('inv-smuggle')]);
      expect(rows.every((r) => r.state === 'done')).toBe(true);

      // The arrival slip became a pre-agreement waiting for the kiosk.
      const appointment = await prisma.withPractice(practiceId, (tx) => tx.appointment.findFirst({ where: { pmsAppointmentKey: 'pj-appt-1' } }));
      expect(appointment?.agreementId).toBeTruthy();
      const device = await prisma.withPractice(practiceId, (tx) => tx.outboundItem.findFirst({ where: { channel: 'device' } }));
      expect(device).not.toBeNull();

      // The invoice became a post-agreement with a link on its way.
      const record = await prisma.withPractice(practiceId, (tx) => tx.serviceRecord.findFirst({ where: { pmsInvoiceKey: 'pj-inv-1' } }));
      expect(record?.agreementId).toBeTruthy();
      const email = await prisma.withPractice(practiceId, (tx) => tx.outboundItem.findFirst({ where: { channel: 'email', subjectType: 'CaptureRequest' } }));
      expect(email?.destination).toBe(adult.email);

      // What the job did is on the row.
      const slip = await prisma.withPractice(practiceId, (tx) => tx.inboundPrintJob.findFirst({ where: { documentType: 'arrival_slip' } }));
      expect(slip?.state).toBe('done');
      expect(slip?.processedAt).not.toBeNull();
      expect((slip?.outcome as { appointments: { captured: number } }).appointments.captured).toBe(1);
    });

    it('the standard lane processes the morning list, and the appointment it shares with the slip is already known', async () => {
      await settle('standard', [sha('list-1')]);
      const list = await prisma.withPractice(practiceId, (tx) => tx.inboundPrintJob.findFirst({ where: { documentType: 'appointment_list' } }));
      expect(list?.state).toBe('done');
      const outcome = list?.outcome as { appointments: { total: number; captured: number; alreadyKnown: number } };
      expect(outcome.appointments.total).toBe(2);
      expect(outcome.appointments.alreadyKnown).toBe(1); // pj-appt-1 — the slip got there first
      expect(outcome.appointments.captured).toBe(1); // pj-appt-2
      const pre = await prisma.withPractice(practiceId, (tx) => tx.agreement.count({ where: { type: 'episodic_pre' } }));
      expect(pre).toBe(2);
    });

    it('a payload that can never work dies at once instead of retrying for six hours', async () => {
      await post({
        ...base('invoice', 'inv-bad-date'),
        patients: [adult],
        providers: [provider],
        invoices: [{ pmsInvoiceKey: 'pj-inv-bad', patientLinkageKey: adult.pmsLinkageKey, providerLinkageKey: provider.pmsProviderKey, serviceDate: 'yesterday-ish', mbsItemNumbers: ['23'] }],
      }).expect(202);

      const [job] = await settle('critical', [sha('inv-bad-date')]);
      expect(job.state).toBe('dead');
      expect(job.attempts).toBe(1); // once — not eight times over six hours
      expect(job.lastError).toBeTruthy();
    });

    it('reports depth, age and dead count per lane', async () => {
      const res = await request(app.getHttpServer()).get('/inbound/print-jobs/metrics').set('x-practice-id', practiceId).expect(200);
      expect(res.body.byLane.critical.done).toBe(3);
      expect(res.body.byLane.critical.dead).toBe(1);
      expect(res.body.byLane.standard.done).toBe(1);
    });
  });
});
