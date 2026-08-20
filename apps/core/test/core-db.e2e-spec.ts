/**
 * Integration tests against the real Postgres (docker compose, port 21020; in
 * CI a postgres service container). These are the definition-of-done proofs
 * from CLAUDE.md §6: the cross-practice access test fails CLOSED, the HARD-01
 * and HARD-02 triggers fire at the database layer, and every domain write
 * leaves a vault outbox row in the same transaction.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ValidationResponse } from '@aobplatform/contracts';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';

const passingRules = {
  validate: async (): Promise<ValidationResponse> => ({
    valid: true,
    results: [],
    ruleSetVersion: 'test-rules-1',
    mappingVersion: 'test-mapping-1',
  }),
};

describe('core database layer (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const practiceA = randomUUID();
  const practiceB = randomUUID();
  let gpId: string;
  let specialistId: string;
  let patientAId: string;
  let assignorAId: string;
  let patientBId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RULES_CLIENT)
      .useValue(passingRules)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceA, async (tx) => {
      await tx.practice.create({ data: { id: practiceA, name: 'Practice A (test)' } });
      const gp = await tx.provider.create({
        data: { practiceId: practiceA, name: 'Dr GP Test', providerType: 'general_practitioner' },
      });
      gpId = gp.id;
      const specialist = await tx.provider.create({
        data: { practiceId: practiceA, name: 'Dr Specialist Test', providerType: 'specialist' },
      });
      specialistId = specialist.id;
      const patient = await tx.patient.create({
        data: {
          practiceId: practiceA,
          familyName: 'Testpatient',
          givenNames: 'Alex',
          dateOfBirth: new Date('1957-03-14'),
        },
      });
      patientAId = patient.id;
      const assignor = await tx.assignor.create({
        data: { practiceId: practiceA, name: 'Alex Testpatient', authorityBasis: 'self' },
      });
      assignorAId = assignor.id;
    });

    await prisma.withPractice(practiceB, async (tx) => {
      await tx.practice.create({ data: { id: practiceB, name: 'Practice B (test)' } });
      const patient = await tx.patient.create({
        data: {
          practiceId: practiceB,
          familyName: 'Otherpatient',
          givenNames: 'Sam',
          dateOfBirth: new Date('1980-01-01'),
        },
      });
      patientBId = patient.id;
    });
  });

  afterAll(async () => {
    for (const practiceId of [practiceA, practiceB]) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.agreement.deleteMany({});
        await tx.assignor.deleteMany({});
        await tx.patient.deleteMany({});
        await tx.provider.deleteMany({});
        await tx.practice.deleteMany({});
      });
    }
    await prisma.vaultOutbox.deleteMany({});
    await app.close();
  });

  describe('row-level security (rule: RLS respected, fails closed)', () => {
    it('cross_practice_read_fails_closed — practice A cannot see practice B rows', async () => {
      const fromA = await prisma.withPractice(practiceA, (tx) => tx.patient.findFirst({ where: { id: patientBId } }));
      expect(fromA).toBeNull();
      const listed = await prisma.withPractice(practiceA, (tx) => tx.patient.findMany());
      expect(listed.every((p) => p.practiceId === practiceA)).toBe(true);
    });

    it('unscoped_access_fails_closed — no practice scope set means zero rows, not all rows', async () => {
      const unscoped = await prisma.patient.findMany();
      expect(unscoped).toEqual([]);
    });

    it('cross_practice_write_fails_closed — practice A cannot insert rows into practice B', async () => {
      await expect(
        prisma.withPractice(practiceA, (tx) =>
          tx.patient.create({
            data: {
              practiceId: practiceB,
              familyName: 'Smuggled',
              givenNames: 'Row',
              dateOfBirth: new Date('1990-01-01'),
            },
          }),
        ),
      ).rejects.toThrow(/row-level security|denied/i);
    });
  });

  describe('agreement flow (draft → lock → sign) with outbox evidence', () => {
    let agreementId: string;

    it('creates a draft and enqueues agreement.created in the same transaction', async () => {
      const res = await request(app.getHttpServer())
        .post('/agreements')
        .set('x-practice-id', practiceA)
        .send({
          type: 'episodic_pre',
          providerId: gpId,
          patientId: patientAId,
          assignorId: assignorAId,
          assignorIsPatient: true,
        })
        .expect(201);
      agreementId = res.body.id;
      const outbox = await prisma.vaultOutbox.findMany({ where: { subjectId: agreementId } });
      expect(outbox.map((r) => r.type)).toContain('agreement.created');
    });

    it('signature_blocked_until_particulars_locked_and_validated — signing a draft is unreachable', async () => {
      await request(app.getHttpServer())
        .post(`/agreements/${agreementId}/transition`)
        .set('x-practice-id', practiceA)
        .send({ to: 'awaiting_signature' })
        .expect(201);
      const res = await request(app.getHttpServer())
        .post(`/agreements/${agreementId}/transition`)
        .set('x-practice-id', practiceA)
        .send({ to: 'signed' })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('REQ-REG-06');
    });

    it('locks particulars after rules validation, recording rule-set and mapping versions (rule 14)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/agreements/${agreementId}/particulars`)
        .set('x-practice-id', practiceA)
        .send({
          particulars: {
            patientName: 'Alex Testpatient',
            agreementDate: '2026-09-01',
            agreementType: 'episodic_pre',
            serviceDate: '2026-09-01',
            basicServiceDescription: 'General practitioner attendance',
            assignorIsPatient: true,
          },
        })
        .expect(201);
      expect(res.body.ruleSetVersion).toBe('test-rules-1');
      expect(res.body.mappingVersion).toBe('test-mapping-1');
      expect(res.body.particularsLockedAt).toBeDefined();
    });

    it('benefit_amount_rejected_on_agreement_artefact — forbidden fields never reach the lock', async () => {
      const res = await request(app.getHttpServer())
        .post(`/agreements/${agreementId}/particulars`)
        .set('x-practice-id', practiceA)
        .send({ particulars: { benefitAmount: 65.7 } })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('REQ-REG-04');
    });

    it('signs once locked and validated, emitting agreement.signed', async () => {
      await request(app.getHttpServer())
        .post(`/agreements/${agreementId}/transition`)
        .set('x-practice-id', practiceA)
        .send({ to: 'signed' })
        .expect(201);
      const outbox = await prisma.vaultOutbox.findMany({ where: { subjectId: agreementId } });
      expect(outbox.map((r) => r.type)).toEqual(
        expect.arrayContaining(['agreement.created', 'agreement.particulars_locked', 'agreement.signed']),
      );
    });

    it('agreement_anchor_immutable_at_db_layer — HARD-01 trigger rejects a provider swap', async () => {
      await expect(
        prisma.withPractice(practiceA, (tx) =>
          tx.agreement.update({ where: { id: agreementId }, data: { providerId: specialistId } }),
        ),
      ).rejects.toThrow(/HARD-01/);
    });

    it('signed_content_immutable_at_db_layer — HARD-02 trigger rejects rewriting a signed artefact', async () => {
      await expect(
        prisma.withPractice(practiceA, (tx) =>
          tx.agreement.update({ where: { id: agreementId }, data: { particulars: { tampered: true } } }),
        ),
      ).rejects.toThrow(/HARD-02/);
    });
  });

  describe('enduring_is_gp_only (REQ-END-01a)', () => {
    it('refuses an enduring agreement anchored to a specialist', async () => {
      const res = await request(app.getHttpServer())
        .post('/agreements')
        .set('x-practice-id', practiceA)
        .send({
          type: 'enduring',
          enduringPathway: 'mymedicare',
          providerId: specialistId,
          patientId: patientAId,
          assignorId: assignorAId,
          assignorIsPatient: true,
        })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('REQ-END-01a');
    });
  });
});
