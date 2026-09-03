import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { buildMessageLog, mayChase, purposeOf } from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboundService } from '../src/outbound/outbound.service';
import { PractitionerEmailService } from '../src/identity/practitioner-email.service';
import { CorrespondenceService } from '../src/correspondence/correspondence.service';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../src/messaging/gateway';

/**
 * Correspondence — what was sent, as evidence (CONSULTATION-CAPTURE-PLAN.md
 * Part 4, build-order item 5).
 *
 * WHAT THIS PINS. Every send leaves a durable twin in the same transaction;
 * a retried enqueue leaves one row, not two; the transport's fate (sent,
 * failed, dead) is projected onto it; a practitioner's personal message with
 * no practice is theirs and only theirs; a practice sees its own and nobody
 * else's; and every row carries the retention expiry it was written under.
 */
describe('correspondence (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let outbound: OutboundService;
  let practitionerEmail: PractitionerEmailService;
  let correspondence: CorrespondenceService;
  const practiceId = randomUUID();
  const otherPracticeId = randomUUID();
  let patientId: string;
  let practitionerId: string;
  let sentItemId: string;
  let deadItemId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_GATEWAY)
      .useValue({ mode: 'test', dispatch: async () => ({ accepted: true }) } as MessagingGateway)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    outbound = app.get(OutboundService);
    practitionerEmail = app.get(PractitionerEmailService);
    correspondence = app.get(CorrespondenceService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'Correspondence Test Practice' } });
      patientId = (
        await tx.patient.create({
          data: { practiceId, familyName: 'Letters', givenNames: 'Pat', dateOfBirth: new Date('1970-01-01'), email: 'pat@example.invalid' },
        })
      ).id;
    });
    await prisma.withPractice(otherPracticeId, (tx) =>
      tx.practice.create({ data: { id: otherPracticeId, name: 'Somebody Else' } }),
    );
    practitionerId = (
      await prisma.practitioner.create({
        data: {
          ahpraNumber: `CORR${Date.now().toString().slice(-8)}`,
          familyName: 'Letters',
          givenNames: 'Dr',
          providerType: 'general_practitioner',
          email: 'dr.letters@example.invalid',
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.correspondence.deleteMany({});
      await tx.outboundItem.deleteMany({});
      await tx.captureRequest.deleteMany({});
      await tx.patient.deleteMany({});
      await tx.practice.deleteMany({});
    });
    await prisma.withPractice(otherPracticeId, (tx) => tx.practice.deleteMany({}));
    if (practitionerId) {
      await prisma.withPractitioner(practitionerId, async (tx) => {
        await tx.correspondence.deleteMany({ where: { recipientId: practitionerId } });
        await tx.outboundItem.deleteMany({ where: { recipientId: practitionerId } });
      });
      await prisma.practitioner.deleteMany({ where: { id: practitionerId } });
    }
    await app?.close();
  });

  const enqueueToPatient = (subjectId: string, attemptGroup?: string) =>
    prisma.withPractice(practiceId, (tx) =>
      outbound.enqueue(tx, {
        practiceId,
        channel: 'email',
        destination: 'pat@example.invalid',
        subjectType: 'CaptureRequest',
        subjectId,
        recipientType: 'patient',
        recipientId: patientId,
        recipientName: 'Pat Letters',
        attemptGroup,
        payload: { subject: 'Please confirm your agreement', body: 'Open the link.', html: '<p>Open the link.</p>' },
      }),
    );

  it('every enqueue leaves a durable twin, in the same transaction, with the retention expiry it was written under', async () => {
    const subjectId = randomUUID();
    const item = await enqueueToPatient(subjectId);
    sentItemId = item.id;

    const row = await prisma.withPractice(practiceId, (tx) => tx.correspondence.findFirst({ where: { outboundItemId: item.id } }));
    expect(row).not.toBeNull();
    expect(row!.subject).toBe('Please confirm your agreement');
    expect(row!.bodyText).toBe('Open the link.');
    expect(row!.bodyHtml).toBe('<p>Open the link.</p>');
    expect(row!.to).toBe('pat@example.invalid');
    expect(row!.recipientType).toBe('patient');
    expect(row!.recipientId).toBe(patientId);
    expect(row!.subjectType).toBe('CaptureRequest');
    expect(row!.state).toBe('queued');
    // Two years, the configured default, stamped at write time.
    expect(row!.retentionExpiryDate!.getUTCFullYear()).toBe(new Date().getUTCFullYear() + 2);
    expect(row!.legalHold).toBe(false);
  });

  it('a retried enqueue is one row, not two', async () => {
    const before = await prisma.withPractice(practiceId, (tx) => tx.correspondence.count({}));
    const again = await enqueueToPatient((await prisma.withPractice(practiceId, (tx) => tx.outboundItem.findFirst({ where: { id: sentItemId } })))!.subjectId);
    expect(again.id).toBe(sentItemId);
    const after = await prisma.withPractice(practiceId, (tx) => tx.correspondence.count({}));
    expect(after).toBe(before);
  });

  it("projects the transport's fate: sent, and dead", async () => {
    await outbound.markSent(practiceId, sentItemId, 'gw-123');
    const sent = await prisma.withPractice(practiceId, (tx) => tx.correspondence.findFirst({ where: { outboundItemId: sentItemId } }));
    expect(sent!.state).toBe('sent');
    expect(sent!.sentAt).not.toBeNull();

    deadItemId = (await enqueueToPatient(randomUUID(), 'second')).id;
    await outbound.markFailed(practiceId, deadItemId, 'Mailbox does not exist.', true);
    const dead = await prisma.withPractice(practiceId, (tx) => tx.correspondence.findFirst({ where: { outboundItemId: deadItemId } }));
    expect(dead!.state).toBe('dead');
    expect(dead!.failureReason).toBe('Mailbox does not exist.');
    expect(dead!.failedAt).not.toBeNull();
  });

  it("a practitioner's personal message has no practice, and is theirs alone", async () => {
    // setBackup sends the backup address a confirmation and records it as a
    // personal outbound row (practiceId NULL). That path must leave a twin too.
    await practitionerEmail.setBackup(practitionerId, 'dr.backup@example.invalid');

    const rows = await correspondence.forPractitioner(practitionerId);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].practiceName).toBe('AoBPlatform'); // no practice behind it
    expect(rows[0].channel).toBe('email');
    expect(rows[0].subject).toBeTruthy();

    // Invisible to a practice: the practice-scoped list cannot see a practice-less row.
    const practiceView = await correspondence.listForPractice(practiceId);
    expect(practiceView.some((r) => r.recipientId === practitionerId)).toBe(false);
  });

  it('a practice sees its own correspondence and nobody else’s (RLS)', async () => {
    const mine = await request(app.getHttpServer()).get('/correspondence').set('x-practice-id', practiceId).expect(200);
    expect(mine.body.length).toBeGreaterThanOrEqual(2);
    expect(mine.body.every((r: { recipientId: string }) => r.recipientId === patientId)).toBe(true);
    expect(mine.body.map((r: { state: string }) => r.state).sort()).toEqual(expect.arrayContaining(['dead', 'sent']));

    const theirs = await request(app.getHttpServer()).get('/correspondence').set('x-practice-id', otherPracticeId).expect(200);
    expect(theirs.body).toHaveLength(0);
  });

  /*
   * ONE LOG, TWO AUDIENCES — the design handoff's M-1 and the P-1 Messages
   * tab. The rows below are what both screens read; the shaping is
   * `@aobplatform/domain`'s, so the tests exercise the same functions the
   * screens do rather than a copy of the reasoning.
   */
  describe('the log both screens read (design handoff M-1 / P-1)', () => {
    let agreementId: string;

    it('tells a capture link from the chases that followed it', async () => {
      agreementId = randomUUID();
      const requests = await prisma.withPractice(practiceId, async (tx) => [
        await tx.captureRequest.create({ data: { practiceId, agreementId, channel: 'email_link' } }),
        await tx.captureRequest.create({ data: { practiceId, agreementId, channel: 'sms_link' } }),
      ]);
      for (const r of requests) await enqueueToPatient(r.id);

      const rows = await correspondence.listForPractice(practiceId, 500);
      const first = rows.find((r) => r.subjectId === requests[0].id)!;
      const second = rows.find((r) => r.subjectId === requests[1].id)!;
      expect(first.attempt).toBe(1);
      expect(second.attempt).toBe(2);
      expect(purposeOf({ subjectType: first.subjectType, attempt: first.attempt })).toBe('capture');
      expect(purposeOf({ subjectType: second.subjectType, attempt: second.attempt })).toBe('reminder');
    });

    /**
     * CLAUDE.md rule 7, REQ-END-05 / REQ-CHASE-02. A reg 89AA notice appears on
     * the log as a record and carries no chase action on any surface. Named
     * after the rule so that removing it is a deliberate act.
     */
    it('eightynineAA_rows_have_no_chase_action', async () => {
      const noticeId = randomUUID();
      await prisma.withPractice(practiceId, (tx) =>
        correspondence.recordForNotice(tx, {
          noticeId,
          practiceId,
          patientId,
          patientName: 'Pat Letters',
          to: 'pat@example.invalid',
          channel: 'email',
          subject: 'A service was billed to Medicare',
          bodyText: 'Nothing is needed from you.',
          accepted: true,
          at: new Date(),
        }),
      );

      const rows = await request(app.getHttpServer()).get('/correspondence?limit=500').set('x-practice-id', practiceId).expect(200);
      const notice = (rows.body as Array<{ subjectType: string; attempt: number | null; subjectId: string }>).find(
        (r) => r.subjectId === noticeId,
      )!;
      expect(purposeOf(notice)).toBe('notice');
      expect(mayChase(purposeOf(notice))).toBe(false);

      // And every other row on the same list still may be chased, so this is a
      // property of the notice rather than of the screen being read-only.
      const log = buildMessageLog({
        dispatches: rows.body as Parameters<typeof buildMessageLog>[0]['dispatches'],
      });
      expect(log.find((e) => e.id === notice.subjectId || e.purpose === 'notice')!.chaseable).toBe(false);
      expect(log.some((e) => e.chaseable)).toBe(true);
    });

    it('the patient sees their own half of it, and nobody else’s', async () => {
      const otherPatientId = await prisma.withPractice(practiceId, async (tx) =>
        (
          await tx.patient.create({
            data: { practiceId, familyName: 'Elsewhere', givenNames: 'Someone', dateOfBirth: new Date('1980-01-01') },
          })
        ).id,
      );
      await prisma.withPractice(practiceId, (tx) =>
        outbound.enqueue(tx, {
          practiceId,
          channel: 'email',
          destination: 'someone@example.invalid',
          subjectType: 'CaptureRequest',
          subjectId: randomUUID(),
          recipientType: 'patient',
          recipientId: otherPatientId,
          recipientName: 'Someone Elsewhere',
          payload: { subject: 'Not for Pat', body: 'Not for Pat.' },
        }),
      );

      const mine = await correspondence.listForPatient(practiceId, patientId, 500);
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((r) => r.recipientId === patientId)).toBe(true);
      // Same rows as the practice's list, filtered to one person — one log.
      const practiceView = await correspondence.listForPractice(practiceId, 500);
      expect(practiceView.some((r) => r.recipientId === otherPatientId)).toBe(true);
      expect(mine.some((r) => r.recipientId === otherPatientId)).toBe(false);
    });

    it('a message whose text retention removed stays a row, and says so', async () => {
      const item = await enqueueToPatient(randomUUID());
      const removed = await prisma.withPractice(practiceId, async (tx) => {
        const row = await tx.correspondence.findFirst({ where: { outboundItemId: item.id } });
        await correspondence.tombstone(tx, row!.id, new Date());
        return row!.id;
      });

      const rows = await correspondence.listForPractice(practiceId, 500);
      const row = rows.find((r) => r.id === removed)!;
      expect(row.bodyText).toBeNull();
      expect(row.contentRemovedAt).not.toBeNull();
      const [entry] = buildMessageLog({ dispatches: [{ ...row, queuedAt: row.queuedAt.toISOString() } as never] });
      expect(entry.contentRemoved).toBe(true);
    });
  });
});
