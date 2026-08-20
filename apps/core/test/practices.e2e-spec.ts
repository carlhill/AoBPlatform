import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('M1.A practice onboarding (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let practiceId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (practiceId) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.assignor.deleteMany({});
        await tx.provider.deleteMany({});
        await tx.staffMember.deleteMany({});
        await tx.practiceLocation.deleteMany({});
        await tx.practice.deleteMany({});
      });
      await prisma.vaultOutbox.deleteMany({});
    }
    await app.close();
  });

  it('creates a practice with locations (FR-1.1) and sane config defaults', async () => {
    const res = await request(app.getHttpServer())
      .post('/practices')
      .send({
        name: 'Onboarding Test Practice',
        pms: 'medtech_evolution',
        rails: ['tyro'],
        locations: [{ address: '1 Example Street, Sampletown NSW 2000' }],
      })
      .expect(201);
    practiceId = res.body.id;
    expect(res.body.locations).toHaveLength(1);
    expect(res.body.identifierTypes).toEqual(['name', 'date_of_birth', 'address']);
    expect(res.body.linkExpiryHours).toBe(48);
    expect(res.body.writeBackProven).toBe(false);
  });

  it('medicare_number_rejected_in_practice_config — the exclusion is not configurable (REQ-VER-02)', async () => {
    await request(app.getHttpServer())
      .patch(`/practices/${practiceId}/config`)
      .set('x-practice-id', practiceId)
      .send({ identifierTypes: ['name', 'date_of_birth', 'medicare_number'] })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/practices/${practiceId}/config`)
      .set('x-practice-id', practiceId)
      .send({ identifierTypes: ['name', 'date_of_birth'] })
      .expect(400); // below the floor of three
  });

  it('accepts a valid config change (identifier set + link expiry, FR-1.4)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/practices/${practiceId}/config`)
      .set('x-practice-id', practiceId)
      .send({ identifierTypes: ['name', 'date_of_birth', 'patient_record_number'], linkExpiryHours: 24 })
      .expect(200);
    expect(res.body.linkExpiryHours).toBe(24);
  });

  it('practice_staff_hard_blocked_as_assignors (REQ-VUL-04) — no override exists', async () => {
    await request(app.getHttpServer())
      .post(`/practices/${practiceId}/staff`)
      .set('x-practice-id', practiceId)
      .send({ name: 'Robin Frontdesk', role: 'front_desk', dateOfBirth: '1990-05-05' })
      .expect(201);

    const blocked = await request(app.getHttpServer())
      .post(`/practices/${practiceId}/assignors`)
      .set('x-practice-id', practiceId)
      .send({ name: 'Robin  FRONTDESK', dateOfBirth: '1990-05-05', authorityBasis: 'parent' })
      .expect(400);
    expect(blocked.body.message).toContain('REQ-VUL-04');

    // A different person with the same role in life is fine.
    await request(app.getHttpServer())
      .post(`/practices/${practiceId}/assignors`)
      .set('x-practice-id', practiceId)
      .send({ name: 'Sam Carer', dateOfBirth: '1980-02-02', authorityBasis: 'parent', relationshipToPatient: 'parent' })
      .expect(201);
  });

  it('provider number is optional — s 65C(5)(a) name+address suffices (REQ-REG-02)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/practices/${practiceId}/providers`)
      .set('x-practice-id', practiceId)
      .send({
        name: 'Dr Example Provider',
        providerType: 'general_practitioner',
        placeOfPracticeAddress: '1 Example Street, Sampletown NSW 2000',
      })
      .expect(201);
    expect(res.body.providerNumber).toBeNull();
  });

  it('go-live checklist is honest: blocked until write-back, sender ID and the rule set exist (FR-1.7)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/practices/${practiceId}/go-live-checklist`)
      .set('x-practice-id', practiceId)
      .expect(200);
    expect(res.body.readyForGoLive).toBe(false);
    const byItem = Object.fromEntries(res.body.items.map((i: { item: string; done: boolean }) => [i.item, i.done]));
    expect(byItem.write_back_proven).toBe(false); // D-01 unresolved — cannot be true yet
    expect(byItem.provider_onboarded).toBe(true);
    expect(byItem.conformance_statement_available).toBe(false); // human-authored zone pending
  });

  it('practice scope mismatch is rejected loudly', async () => {
    await request(app.getHttpServer())
      .get(`/practices/${practiceId}/go-live-checklist`)
      .set('x-practice-id', '00000000-0000-0000-0000-000000000000')
      .expect(400);
  });
});
