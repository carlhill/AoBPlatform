import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboundService } from '../src/outbound/outbound.service';
import { PractitionerEmailService } from '../src/identity/practitioner-email.service';
import { RetentionSweepService } from '../src/retention/retention-sweep.service';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../src/messaging/gateway';

/**
 * Retention sweep — two years, soft (CONSULTATION-CAPTURE-PLAN.md Part 5,
 * build-order item 6).
 *
 * WHAT THIS PINS. A due agreement reaches the terminal state and the event
 * says how its clock was anchored; due correspondence loses its text but keeps
 * its row; due artefact bytes go through the tombstone path; a legal hold is
 * untouched in every case; every removal is a vault event; and a second sweep
 * finds nothing left to do.
 */
describe('retention sweep (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let outbound: OutboundService;
  let practitionerEmail: PractitionerEmailService;
  let sweep: RetentionSweepService;
  const practiceId = randomUUID();
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
  const nextYear = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const fakeSha = (seed: string) => seed.repeat(64).slice(0, 64);
  let patientId: string;
  let practitionerId: string;
  let dueAgreementId: string;
  let heldAgreementId: string;
  let futureAgreementId: string;
  let dueCorrespondenceId: string;
  let heldCorrespondenceId: string;
  let personalCorrespondenceId: string;
  let dueArtefactId: string;
  let heldArtefactId: string;

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
    sweep = app.get(RetentionSweepService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'Retention Test Practice' } });
      const providerId = (
        await tx.provider.create({ data: { practiceId, name: 'Dr Retention', providerType: 'general_practitioner' } })
      ).id;
      patientId = (
        await tx.patient.create({
          data: {
            practiceId,
            familyName: 'Expiry',
            givenNames: 'Pat',
            dateOfBirth: new Date('1970-01-01'),
            email: 'pat@example.invalid',
          },
        })
      ).id;
      const assignorId = (
        await tx.assignor.create({
          data: { practiceId, name: 'Pat Expiry', authorityBasis: 'self', dateOfBirth: new Date('1970-01-01') },
        })
      ).id;
      const agreement = (status: string, retentionExpiryDate: Date, legalHold = false) =>
        tx.agreement.create({
          data: {
            practiceId,
            type: 'episodic_pre',
            anchorKind: 'provider',
            providerId,
            patientId,
            assignorId,
            assignorIsPatient: true,
            status,
            retentionExpiryDate,
            legalHold,
          },
        });
      dueAgreementId = (await agreement('stored', yesterday)).id;
      heldAgreementId = (await agreement('claim_linked', yesterday, true)).id;
      futureAgreementId = (await agreement('stored', nextYear)).id;
      // The clock on the due agreement was defaulted to the service date (REQ-INT-04).
      await tx.serviceRecord.create({
        data: {
          practiceId,
          pmsInvoiceKey: `ret-${Date.now()}`,
          serviceDate: yesterday,
          mbsItemNumbers: ['23'],
          agreementId: dueAgreementId,
          retentionClockSource: 'conservative_default',
        },
      });

      const artefact = (seed: string, legalHold: boolean) =>
        tx.artefact.create({
          data: {
            practiceId,
            sha256: fakeSha(seed),
            sizeBytes: 4,
            detectedContentType: 'text/plain',
            filename: `${seed}.txt`,
            purpose: 'other',
            uploadedByName: 'Test',
            storageKey: `${practiceId}/${fakeSha(seed)}`,
            retentionExpiryDate: yesterday,
            legalHold,
          },
        });
      dueArtefactId = (await artefact('a', false)).id;
      heldArtefactId = (await artefact('b', true)).id;
    });

    const enqueue = () =>
      prisma.withPractice(practiceId, (tx) =>
        outbound.enqueue(tx, {
          practiceId,
          channel: 'email',
          destination: 'pat@example.invalid',
          subjectType: 'Agreement',
          subjectId: randomUUID(),
          recipientType: 'patient',
          recipientId: patientId,
          recipientName: 'Pat Expiry',
          payload: { subject: 'Your agreement', body: 'The text.', html: '<p>The text.</p>' },
        }),
      );
    const dueItem = await enqueue();
    const heldItem = await enqueue();
    await prisma.withPractice(practiceId, async (tx) => {
      dueCorrespondenceId = (
        await tx.correspondence.update({
          where: { outboundItemId: dueItem.id },
          data: { retentionExpiryDate: yesterday },
        })
      ).id;
      heldCorrespondenceId = (
        await tx.correspondence.update({
          where: { outboundItemId: heldItem.id },
          data: { retentionExpiryDate: yesterday, legalHold: true },
        })
      ).id;
    });

    // A practitioner's personal message has no practice; it is scoped on the person.
    practitionerId = (
      await prisma.practitioner.create({
        data: {
          ahpraNumber: `RET${Date.now().toString().slice(-8)}`,
          familyName: 'Expiry',
          givenNames: 'Dr',
          providerType: 'general_practitioner',
          email: 'dr.expiry@example.invalid',
        },
      })
    ).id;
    await practitionerEmail.setBackup(practitionerId, 'dr.backup@example.invalid');
    await prisma.withPractitioner(practitionerId, async (tx) => {
      const personal = await tx.correspondence.findFirst({ where: { recipientId: practitionerId, practiceId: null } });
      personalCorrespondenceId = personal!.id;
      await tx.correspondence.update({ where: { id: personal!.id }, data: { retentionExpiryDate: yesterday } });
    });
  });

  afterAll(async () => {
    await prisma.withPractice(practiceId, async (tx) => {
      await tx.correspondence.deleteMany({});
      await tx.outboundItem.deleteMany({});
      await tx.serviceRecord.deleteMany({});
      await tx.agreement.deleteMany({});
      await tx.assignor.deleteMany({});
      await tx.patient.deleteMany({});
      await tx.provider.deleteMany({});
      // Artefact rows cannot be deleted by design (artefacts_no_delete); they stay tombstoned.
      await tx.practice.deleteMany({});
    });
    if (practitionerId) {
      await prisma.withPractitioner(practitionerId, async (tx) => {
        await tx.correspondence.deleteMany({ where: { recipientId: practitionerId } });
        await tx.outboundItem.deleteMany({ where: { recipientId: practitionerId } });
      });
      await prisma.practitioner.deleteMany({ where: { id: practitionerId } });
    }
    await prisma.vaultOutbox.deleteMany({
      where: {
        subjectId: {
          in: [
            dueAgreementId,
            heldAgreementId,
            futureAgreementId,
            dueCorrespondenceId,
            heldCorrespondenceId,
            personalCorrespondenceId,
            dueArtefactId,
            heldArtefactId,
          ].filter(Boolean),
        },
      },
    });
    await app?.close();
  });

  it('runs both passes and reports what it did', async () => {
    const result = await sweep.run();
    expect(result.agreementsScheduled).toBeGreaterThanOrEqual(1);
    expect(result.correspondenceRemoved).toBeGreaterThanOrEqual(2);
    expect(result.artefactsRemoved).toBeGreaterThanOrEqual(1);
  });

  it('a due agreement reaches retention_expiry_scheduled and the event says how the clock was anchored', async () => {
    const a = await prisma.withPractice(practiceId, (tx) => tx.agreement.findFirst({ where: { id: dueAgreementId } }));
    expect(a!.status).toBe('retention_expiry_scheduled');
    const events = await prisma.vaultOutbox.findMany({
      where: { type: 'retention.expiry_scheduled', subjectId: dueAgreementId },
    });
    expect(events).toHaveLength(1);
    const payload = events[0].payload as Record<string, unknown>;
    expect(payload.retentionClockSource).toBe('conservative_default');
    expect(payload.clockDefaulted).toBe(true);
    expect(payload.retentionExpiryDate).toBe(yesterday.toISOString().slice(0, 10));
  });

  it('legalHold wins: the held agreement, and one not yet due, are untouched', async () => {
    const [held, future] = await prisma.withPractice(practiceId, (tx) =>
      Promise.all([
        tx.agreement.findFirst({ where: { id: heldAgreementId } }),
        tx.agreement.findFirst({ where: { id: futureAgreementId } }),
      ]),
    );
    expect(held!.status).toBe('claim_linked');
    expect(future!.status).toBe('stored');
  });

  it('due correspondence loses its text; the row, subject and provenance survive; the removal is evidenced', async () => {
    const row = await prisma.withPractice(practiceId, (tx) =>
      tx.correspondence.findFirst({ where: { id: dueCorrespondenceId } }),
    );
    expect(row).not.toBeNull();
    expect(row!.bodyText).toBeNull();
    expect(row!.bodyHtml).toBeNull();
    expect(row!.contentRemovedAt).not.toBeNull();
    expect(row!.subject).toBe('Your agreement');
    expect(row!.to).toBe('pat@example.invalid');
    const events = await prisma.vaultOutbox.findMany({
      where: { type: 'retention.crypto_shredded', subjectId: dueCorrespondenceId },
    });
    expect(events).toHaveLength(1);
    expect((events[0].payload as Record<string, unknown>).action).toBe('content_removed');
  });

  it('held correspondence keeps its text', async () => {
    const row = await prisma.withPractice(practiceId, (tx) =>
      tx.correspondence.findFirst({ where: { id: heldCorrespondenceId } }),
    );
    expect(row!.bodyText).toBe('The text.');
    expect(row!.contentRemovedAt).toBeNull();
    expect(await prisma.vaultOutbox.count({ where: { subjectId: heldCorrespondenceId } })).toBe(0);
  });

  it("a practitioner's personal message is swept under the person's scope", async () => {
    const row = await prisma.withPractitioner(practitionerId, (tx) =>
      tx.correspondence.findFirst({ where: { id: personalCorrespondenceId } }),
    );
    expect(row!.bodyText).toBeNull();
    expect(row!.contentRemovedAt).not.toBeNull();
  });

  it('due artefact bytes go through the tombstone path; the held one does not', async () => {
    const [due, held] = await prisma.withPractice(practiceId, (tx) =>
      Promise.all([
        tx.artefact.findFirst({ where: { id: dueArtefactId } }),
        tx.artefact.findFirst({ where: { id: heldArtefactId } }),
      ]),
    );
    expect(due!.deletedAt).not.toBeNull();
    expect(due!.sha256).toBe(fakeSha('a'));
    expect(held!.deletedAt).toBeNull();
    const events = await prisma.vaultOutbox.findMany({
      where: { type: 'retention.crypto_shredded', subjectId: dueArtefactId },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actor).toMatchObject({ principalType: 'system' });
  });

  it('a second sweep finds nothing left to do', async () => {
    const before = await prisma.vaultOutbox.count({
      where: { type: { in: ['retention.crypto_shredded', 'retention.expiry_scheduled'] } },
    });
    const again = await sweep.run();
    expect(again).toEqual({ agreementsScheduled: 0, correspondenceRemoved: 0, artefactsRemoved: 0 });
    expect(
      await prisma.vaultOutbox.count({
        where: { type: { in: ['retention.crypto_shredded', 'retention.expiry_scheduled'] } },
      }),
    ).toBe(before);
  });
});
