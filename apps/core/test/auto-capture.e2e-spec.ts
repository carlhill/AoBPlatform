import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { MockPmsAdapter } from '@aobplatform/connector';
import type { PmsAppointment, PmsInvoice, PmsPatientRecord } from '@aobplatform/contracts';
import type { IsoDate } from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PMS_ADAPTER } from '../src/pms/pms.tokens';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../src/messaging/gateway';

/**
 * The capture cascade run by the platform — CONSULTATION-CAPTURE-PLAN.md
 * Parts 2 and 3, items 1 and 2 of the build order.
 *
 * WHAT THIS PINS. Until now an invoice with no agreement behind it reached the
 * reconciliation queue and stopped: `resend` refused it with "create one
 * yourself". And a remote capture request minted a token that nothing ever
 * sent. So the tests are written against those two failures: a patient we can
 * reach IS asked, with a message that actually leaves; and every patient we
 * decide NOT to ask has that decision recorded with its reason, never left as
 * a silence.
 */

const daysAgo = (days: number): IsoDate =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10) as IsoDate;
const today = (): IsoDate => new Date().toISOString().slice(0, 10) as IsoDate;
const yearsAgo = (years: number): string => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - 1); // safely past the birthday
  return d.toISOString().slice(0, 10);
};

const PATIENTS: PmsPatientRecord[] = [
  {
    pmsLinkageKey: 'ac-adult',
    familyName: 'Reachable',
    givenNames: 'Robin',
    dateOfBirth: '1957-03-14',
    mobile: '+61400000001',
    email: 'robin.reachable@example.invalid',
  },
  // Fifteen: old enough to be their own assignor (14 in Australia), mobile only.
  { pmsLinkageKey: 'ac-teen', familyName: 'Fifteen', givenNames: 'Taylor', dateOfBirth: yearsAgo(15), mobile: '+61400000002' },
  // Eleven: a parent may need to sign, and choosing who is not ours to do.
  { pmsLinkageKey: 'ac-child', familyName: 'Eleven', givenNames: 'Casey', dateOfBirth: yearsAgo(11), email: 'parent@example.invalid' },
  // No way to reach them at all.
  { pmsLinkageKey: 'ac-nocontact', familyName: 'Unreachable', givenNames: 'Morgan', dateOfBirth: '1970-06-01' },
  // Already covered by an enduring agreement (set up in beforeAll).
  { pmsLinkageKey: 'ac-covered', familyName: 'Covered', givenNames: 'Sam', dateOfBirth: '1960-09-09', email: 'sam.covered@example.invalid' },
];

/** The mock adapter, with appointments and a spread of invoices this cascade has to decide about. */
class CascadeFixtureAdapter extends MockPmsAdapter {
  override async readPatient(key: string): Promise<PmsPatientRecord | null> {
    return PATIENTS.find((p) => p.pmsLinkageKey === key) ?? null;
  }

  override async readInvoices(): Promise<readonly PmsInvoice[]> {
    const prov = 'mock-prov-001';
    return [
      { pmsInvoiceKey: 'ac-inv-adult', patientLinkageKey: 'ac-adult', providerLinkageKey: prov, serviceDate: daysAgo(14), mbsItemNumbers: ['23'] },
      { pmsInvoiceKey: 'ac-inv-teen', patientLinkageKey: 'ac-teen', providerLinkageKey: prov, serviceDate: daysAgo(20), mbsItemNumbers: ['36'] },
      { pmsInvoiceKey: 'ac-inv-child', patientLinkageKey: 'ac-child', providerLinkageKey: prov, serviceDate: daysAgo(30), mbsItemNumbers: ['23'] },
      { pmsInvoiceKey: 'ac-inv-nocontact', patientLinkageKey: 'ac-nocontact', providerLinkageKey: prov, serviceDate: daysAgo(30), mbsItemNumbers: ['23'] },
      { pmsInvoiceKey: 'ac-inv-old', patientLinkageKey: 'ac-adult', providerLinkageKey: prov, serviceDate: daysAgo(400), mbsItemNumbers: ['23'] },
      { pmsInvoiceKey: 'ac-inv-covered', patientLinkageKey: 'ac-covered', providerLinkageKey: prov, serviceDate: daysAgo(10), mbsItemNumbers: ['23'] },
    ];
  }

  override async readAppointments(date: IsoDate): Promise<readonly PmsAppointment[]> {
    const prov = 'mock-prov-001';
    return [
      { pmsAppointmentKey: 'ac-appt-adult', patientLinkageKey: 'ac-adult', providerLinkageKey: prov, date, time: '09:00' },
      { pmsAppointmentKey: 'ac-appt-child', patientLinkageKey: 'ac-child', providerLinkageKey: prov, date, time: '09:15' },
      { pmsAppointmentKey: 'ac-appt-covered', patientLinkageKey: 'ac-covered', providerLinkageKey: prov, date, time: '09:30' },
    ];
  }
}

describe('the platform-run capture cascade (e2e, real Postgres + fixture adapter)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const practiceId = randomUUID();
  let providerId: string;
  let coveredPatientId: string;
  let enduringAgreementId: string;

  const sent: { to: string; channel: string }[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PMS_ADAPTER)
      .useValue(new CascadeFixtureAdapter())
      .overrideProvider(MESSAGING_GATEWAY)
      .useValue({
        mode: 'test',
        dispatch: async (m) => {
          sent.push({ to: m.to, channel: m.channel });
          return { accepted: true };
        },
      } as MessagingGateway)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'Cascade Test Practice' } });
      providerId = (
        await tx.provider.create({
          data: { practiceId, name: 'Dr Example Provider', providerType: 'general_practitioner', pmsLinkageKey: 'mock-prov-001' },
        })
      ).id;

      // The covered patient exists BEFORE the sync, with a live enduring
      // agreement — the one case the cascade must recognise and not ask about.
      coveredPatientId = (
        await tx.patient.create({
          data: {
            practiceId,
            familyName: 'Covered',
            givenNames: 'Sam',
            dateOfBirth: new Date('1960-09-09'),
            email: 'sam.covered@example.invalid',
            pmsLinkageKey: 'ac-covered',
          },
        })
      ).id;
      const assignor = await tx.assignor.create({
        data: { practiceId, name: 'Sam Covered', authorityBasis: 'self', dateOfBirth: new Date('1960-09-09') },
      });
      enduringAgreementId = (
        await tx.agreement.create({
          data: {
            practiceId,
            type: 'enduring',
            anchorKind: 'provider',
            providerId,
            patientId: coveredPatientId,
            assignorId: assignor.id,
            assignorIsPatient: true,
            enduringPathway: 'mymedicare',
            /*
             * ACTIVE, NOT STORED — deliberately. `PmsSyncService.syncInvoices`
             * already links any agreement in status `stored` for the same
             * patient × provider, so a `stored` fixture would be linked by the
             * mirror step and never reach the cascade at all. An enduring
             * agreement in force has moved on (lifecycle.ts: stored → active →
             * claim_linked / registered), and THAT is the case the sync misses
             * and `coverage()` exists to catch.
             */
            status: 'active',
          },
        })
      ).id;
      await tx.enduringDetail.create({
        data: {
          practiceId,
          agreementId: enduringAgreementId,
          notificationMethod: 'email',
          terminationMethod: 'email',
          scopeType: 'category',
          scopeValues: ['1'],
          enteredIntoAt: new Date(),
        },
      });
    });
  });

  afterAll(async () => {
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.outboundItem.deleteMany({});
      await tx.appointment.deleteMany({});
      await tx.captureRequest.deleteMany({});
      await tx.verificationChallenge.deleteMany({});
      await tx.serviceRecord.deleteMany({});
      await tx.enduringDetail.deleteMany({});
      await tx.agreement.deleteMany({});
      await tx.assignor.deleteMany({});
      await tx.patient.deleteMany({});
      await tx.provider.deleteMany({});
      await tx.practice.deleteMany({});
    });
    await prisma.vaultOutbox.deleteMany({});
    await app?.close();
  });

  /*
   * Suppression reasons are asserted from the RESPONSE, not from the vault
   * outbox: the vault relay runs on an interval in this app and ships outbox
   * rows away, so a test that counts them races the relay. The tally in the
   * response is derived from the same decisions that write the events.
   */
  describe('POST-consultation — an invoice with nothing behind it', () => {
    it('asks the patients it can, and records why it did not ask the others', async () => {
      const res = await request(app.getHttpServer()).post('/pms/sync').set('x-practice-id', practiceId).expect(201);

      // The mirror step, unchanged.
      expect(res.body.created).toBe(6);
      // The new step: two asked (adult by email, fifteen-year-old by SMS), four not.
      expect(res.body.captured).toBe(2);
      expect(res.body.suppressed).toBe(4);
      expect(res.body.suppressedByReason).toEqual({
        window_closed: 1, // ac-inv-old, 400 days — REQ-CHASE-08
        assignor_needs_human: 1, // the eleven-year-old
        no_contact_channel: 1, // no email, no mobile
        enduring_covered: 1, // Sam Covered
      });
    });

    it('drafts an episodic_post with the patient as their own assignor, and opens a capture request', async () => {
      const drafts = await prisma.withPractice(practiceId, (tx) =>
        tx.agreement.findMany({ where: { type: 'episodic_post' }, orderBy: { createdAt: 'asc' } }),
      );
      expect(drafts).toHaveLength(2);
      expect(drafts.every((d) => d.assignorIsPatient)).toBe(true);
      // Opening a capture request moves a draft on (existing behaviour).
      expect(drafts.every((d) => d.status === 'verification_pending')).toBe(true);

      const requests = await prisma.withPractice(practiceId, (tx) =>
        tx.captureRequest.findMany({ where: { agreementId: { in: drafts.map((d) => d.id) } } }),
      );
      expect(requests.map((r) => r.channel).sort()).toEqual(['email_link', 'sms_link']);
      // Only the hash is ever stored (REQ-VER-05).
      expect(requests.every((r) => r.tokenHash && r.tokenHash.length === 64)).toBe(true);
    });

    it('THE MESSAGE ACTUALLY LEAVES — queued and recorded, with the approval link, no dollar amounts', async () => {
      const items = await prisma.withPractice(practiceId, (tx) =>
        tx.outboundItem.findMany({ where: { subjectType: 'CaptureRequest', channel: { in: ['email', 'sms'] } } }),
      );
      expect(items).toHaveLength(2);

      const email = items.find((i) => i.channel === 'email')!;
      const emailPayload = email.payload as { subject: string; body: string; html: string };
      expect(email.destination).toBe('robin.reachable@example.invalid');
      expect(email.recipientType).toBe('patient');
      expect(emailPayload.html).toContain('/agree/');
      expect(emailPayload.body).toContain('/agree/');
      expect(emailPayload.body).toContain('23'); // the item number is fine to state
      expect(emailPayload.body).not.toMatch(/\$\s?\d/); // Rule 4: never a dollar figure

      const sms = items.find((i) => i.channel === 'sms')!;
      const smsPayload = sms.payload as { body: string };
      expect(sms.destination).toBe('+61400000002');
      expect(smsPayload.body).toContain('/agree/');
    });

    it('links the covered service to the enduring agreement so it leaves the queue, rather than asking twice', async () => {
      const record = await prisma.withPractice(practiceId, (tx) =>
        tx.serviceRecord.findFirst({ where: { pmsInvoiceKey: 'ac-inv-covered' } }),
      );
      expect(record?.agreementId).toBe(enduringAgreementId);
    });

    it('leaves the ones it would not decide for a person — still outstanding, still needing an agreement', async () => {
      const queue = await request(app.getHttpServer())
        .get('/reconciliation/outstanding')
        .set('x-practice-id', practiceId)
        .expect(200);
      const needing = queue.body.filter((i: { needsAgreement: boolean }) => i.needsAgreement);
      // child + nocontact + the expired one; the covered and the two asked are no longer "needs agreement".
      expect(needing).toHaveLength(3);
    });

    it('is idempotent — a second sync asks nobody again and drafts nothing new', async () => {
      const before = await prisma.withPractice(practiceId, (tx) => tx.agreement.count({}));
      const res = await request(app.getHttpServer()).post('/pms/sync').set('x-practice-id', practiceId).expect(201);
      expect(res.body.created).toBe(0);
      expect(res.body.captured).toBe(0);
      const after = await prisma.withPractice(practiceId, (tx) => tx.agreement.count({}));
      expect(after).toBe(before);
      const items = await prisma.withPractice(practiceId, (tx) =>
        tx.outboundItem.count({ where: { subjectType: 'CaptureRequest', channel: { in: ['email', 'sms'] } } }),
      );
      expect(items).toBe(2);
    });
  });

  describe('PRE-consultation — the appointment book', () => {
    it('drafts a pre-agreement for each patient it may ask, and queues it for the kiosk', async () => {
      const res = await request(app.getHttpServer())
        .post('/pms/sync-appointments')
        .set('x-practice-id', practiceId)
        .send({ date: today() })
        .expect(201);
      expect(res.body.total).toBe(3);
      expect(res.body.created).toBe(3);
      expect(res.body.captured).toBe(1); // the adult
      expect(res.body.suppressed).toBe(2); // the child, and the covered patient
      expect(res.body.suppressedByReason).toEqual({ assignor_needs_human: 1, enduring_covered: 1 });

      const appointments = await prisma.withPractice(practiceId, (tx) => tx.appointment.findMany({}));
      expect(appointments).toHaveLength(3);

      const pre = await prisma.withPractice(practiceId, (tx) => tx.agreement.findMany({ where: { type: 'episodic_pre' } }));
      expect(pre).toHaveLength(1);

      const inPractice = await prisma.withPractice(practiceId, (tx) =>
        tx.captureRequest.findFirst({ where: { agreementId: pre[0].id, channel: 'in_practice' } }),
      );
      expect(inPractice).not.toBeNull();

      // The kiosk's feed: the outbound queue's existing `device` channel —
      // pulled by whichever tablet comes for it, so no destination up front.
      const device = await prisma.withPractice(practiceId, (tx) =>
        tx.outboundItem.findFirst({ where: { channel: 'device', subjectId: inPractice!.id } }),
      );
      expect(device).not.toBeNull();
      expect(device!.destination).toBeNull();
      expect(device!.mediaType).toBe('json');
      const payload = device!.payload as Record<string, unknown>;
      expect(payload.kind).toBe('pre_agreement');
      expect(payload.patientName).toBe('Robin Reachable');
      // What a screen needs and nothing more — no DOB, no address.
      expect(payload).not.toHaveProperty('dateOfBirth');
      expect(payload).not.toHaveProperty('address');
    });

    it('records the covered appointment against the enduring agreement, rather than asking twice', async () => {
      const covered = await prisma.withPractice(practiceId, (tx) =>
        tx.appointment.findFirst({ where: { pmsAppointmentKey: 'ac-appt-covered' } }),
      );
      expect(covered?.agreementId).toBe(enduringAgreementId);
    });

    it('is idempotent on the PMS appointment key — the arrival slip is the same appointment as the morning list', async () => {
      const res = await request(app.getHttpServer())
        .post('/pms/sync-appointments')
        .set('x-practice-id', practiceId)
        .send({ date: today() })
        .expect(201);
      expect(res.body.created).toBe(0);
      expect(res.body.alreadyKnown).toBe(3);
      const pre = await prisma.withPractice(practiceId, (tx) => tx.agreement.count({ where: { type: 'episodic_pre' } }));
      expect(pre).toBe(1);
    });
  });
});
