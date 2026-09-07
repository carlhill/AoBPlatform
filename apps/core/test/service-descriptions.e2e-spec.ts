import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ValidationResponse } from '@aobplatform/contracts';
import { SERVICE_DESCRIPTIONS, SERVICE_DESCRIPTIONS_VERSION } from '@aobplatform/domain';
import { DEV_MAPPING } from '../../rules/src/rules/rule-set-2026-08.draft';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';

/**
 * D6a ON A STAFF SURFACE — `GET /service-descriptions` and
 * `POST /service-descriptions/agreements/:id`.
 *
 * WHAT THESE PIN. That the list the practice picks from is the same list the
 * rules engine matches against, string for string (the whole reason two copies
 * are tolerable at all); that the acting staff member is recorded and an
 * unattributed request is REFUSED rather than filed as nobody; that setting
 * D6a actually clears C6 rather than merely writing a column; that a locked
 * agreement is never edited; and that none of it crosses a practice boundary.
 */

/** The receptionist doing the work. Null = nobody signed in. */
const RECEPTIONIST = {
  sub: '00000000-0000-4000-8000-0000000d6a01',
  principalType: 'staff',
  roles: [],
  preferredUsername: 'mai.frontdesk',
  raw: {},
};
let currentPrincipal: Record<string, unknown> | null = null;

/**
 * A rules stub that evaluates C6 THE WAY THE DRAFT RULE SET DOES — an exact,
 * case-sensitive membership test against the mapping. A stub that waved
 * everything through would make "the description cleared C6" unfalsifiable,
 * which is the one thing this suite exists to say.
 */
const c6EvaluatingRules = {
  validate: async ({ payload }: { payload: unknown }): Promise<ValidationResponse> => {
    const p = (payload ?? {}) as Record<string, unknown>;
    const isPre = p.agreementType === 'episodic_pre' || p.agreementType === 'treatment_plan';
    const ok = !isPre || DEV_MAPPING.descriptions.includes(p.basicServiceDescription as string);
    return {
      valid: ok,
      results: [
        {
          rule: 'C6',
          outcome: ok ? 'pass' : 'fail',
          message: `D6a: a pre-agreement requires a basic service description drawn from the current mapping (version ${DEV_MAPPING.version}).`,
          citation: 's 65C(4); REQ-REG-03',
        },
      ],
      ruleSetVersion: 'test-rules-1',
      mappingVersion: DEV_MAPPING.version,
    };
  },
};

describe('D6a on a staff surface (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const practiceId = randomUUID();
  const otherPracticeId = randomUUID();
  let providerId: string;
  let patientId: string;
  let assignorId: string;

  async function draft(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/agreements')
      .set('x-practice-id', practiceId)
      .send({ type: 'episodic_pre', providerId, patientId, assignorId, assignorIsPatient: true })
      .expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RULES_CLIENT)
      .useValue(c6EvaluatingRules)
      .compile();
    app = moduleRef.createNestApplication();
    // Middleware runs before the guards and cannot be forged by a client — the
    // same seam the reconciliation and acting-as suites use.
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      if (currentPrincipal) req.principal = currentPrincipal;
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.practice.create({ data: { id: practiceId, name: 'Service Description Test Practice' } });
      providerId = (
        await tx.provider.create({
          data: { practiceId, name: 'Dr Example Provider', providerType: 'general_practitioner' },
        })
      ).id;
      patientId = (
        await tx.patient.create({
          data: { practiceId, familyName: 'Placeholder', givenNames: 'Morgan', dateOfBirth: new Date('1979-03-11') },
        })
      ).id;
      assignorId = (
        await tx.assignor.create({ data: { practiceId, name: 'Morgan Placeholder', authorityBasis: 'self' } })
      ).id;
    });

    // The tenancy test creates the practice it is about rather than assuming
    // one is lying around.
    await prisma.withPractice(otherPracticeId, async (tx) => {
      await tx.practice.create({ data: { id: otherPracticeId, name: 'Somewhere Else Medical' } });
    });
  });

  beforeEach(() => {
    currentPrincipal = RECEPTIONIST;
  });

  afterAll(async () => {
    for (const scope of [practiceId, otherPracticeId]) {
      await prisma.withPractice(scope, async (tx) => {
        await tx.captureRequest.deleteMany({});
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

  /**
   * THE TEST THIS WHOLE DESIGN RESTS ON.
   *
   * The rules service is a separate deployable that publishes only rule-set
   * VERSIONS over HTTP (`GET /rule-sets`), never its mapping — so core holds
   * the list a practice picks from and the engine holds the list it matches
   * against, and they are two copies. Two copies are only honest with this
   * between them: a description offered on a screen that the engine would
   * refuse is a refusal delivered to a patient's tablet instead of to a build.
   */
  it('service_descriptions_agree_with_rules_mapping', () => {
    expect(SERVICE_DESCRIPTIONS_VERSION).toBe(DEV_MAPPING.version);
    expect([...SERVICE_DESCRIPTIONS]).toEqual([...DEV_MAPPING.descriptions]);
  });

  it('serves the list and its version, and the list carries no amount (hard rule 4)', async () => {
    const res = await request(app.getHttpServer())
      .get('/service-descriptions')
      .set('x-practice-id', practiceId)
      .expect(200);

    expect(res.body.version).toBe(SERVICE_DESCRIPTIONS_VERSION);
    expect(res.body.descriptions).toEqual([...SERVICE_DESCRIPTIONS]);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/\$|certified|approved|accredited/i);
  });

  it('lists a draft with no description as pending, and drops it once one is set', async () => {
    const agreementId = await draft();

    const before = await request(app.getHttpServer())
      .get('/service-descriptions/pending')
      .set('x-practice-id', practiceId)
      .expect(200);
    expect(before.body.map((r: { agreementId: string }) => r.agreementId)).toContain(agreementId);
    // An initial and a family name, never the full given names and never an
    // identifier of any kind.
    const row = before.body.find((r: { agreementId: string }) => r.agreementId === agreementId);
    expect(row.patientName).toBe('M. Placeholder');

    await request(app.getHttpServer())
      .post(`/service-descriptions/agreements/${agreementId}`)
      .set('x-practice-id', practiceId)
      .send({ description: SERVICE_DESCRIPTIONS[0] })
      .expect(201);

    const after = await request(app.getHttpServer())
      .get('/service-descriptions/pending')
      .set('x-practice-id', practiceId)
      .expect(200);
    expect(after.body.map((r: { agreementId: string }) => r.agreementId)).not.toContain(agreementId);
  });

  it('setting_d6a_records_staff_identity', async () => {
    const agreementId = await draft();

    const res = await request(app.getHttpServer())
      .post(`/service-descriptions/agreements/${agreementId}`)
      .set('x-practice-id', practiceId)
      .send({ description: SERVICE_DESCRIPTIONS[0] })
      .expect(201);

    // From the session, never from the body — nothing named a person here.
    expect(res.body.setBy).toBe('mai.frontdesk');
    expect(res.body.mappingVersion).toBe(SERVICE_DESCRIPTIONS_VERSION);

    const stored = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    expect(stored?.serviceDescription).toBe(SERVICE_DESCRIPTIONS[0]);
    expect(stored?.serviceDescriptionSetBy).toBe('mai.frontdesk');
    expect(stored?.serviceDescriptionSetAt).not.toBeNull();

    // The write and its evidence commit together (hard rule 11 — the outbox).
    const events = await prisma.vaultOutbox.findMany({ where: { subjectId: agreementId } });
    const set = events.find((e) => e.type === 'agreement.service_description_set');
    expect(set).toBeDefined();
    expect((set!.actor as { principalType: string; id: string }).principalType).toBe('staff');
    expect((set!.actor as { id: string }).id).toBe(RECEPTIONIST.sub);
    // WHICH LIST THEY WERE OFFERED (hard rule 14).
    expect((set!.payload as { serviceDescriptionsVersion: string }).serviceDescriptionsVersion).toBe(
      SERVICE_DESCRIPTIONS_VERSION,
    );
  });

  it('refuses an unattributed request rather than recording it as nobody', async () => {
    const agreementId = await draft();
    currentPrincipal = null;

    const res = await request(app.getHttpServer())
      .post(`/service-descriptions/agreements/${agreementId}`)
      .set('x-practice-id', practiceId)
      .send({ description: SERVICE_DESCRIPTIONS[0] })
      .expect(403);
    expect(res.body.message).toMatch(/no signed-in user/i);

    const stored = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    expect(stored?.serviceDescription).toBeNull();
  });

  it('d6a_change_revalidates_and_clears_c6', async () => {
    const agreementId = await draft();

    // Before: the rule set refuses, which is exactly why the kiosk hands over.
    const blocked = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/particulars`)
      .set('x-practice-id', practiceId)
      .send({ serviceDate: new Date().toISOString().slice(0, 10) })
      .expect(400);
    expect(JSON.stringify(blocked.body)).toMatch(/C6/);

    const set = await request(app.getHttpServer())
      .post(`/service-descriptions/agreements/${agreementId}`)
      .set('x-practice-id', practiceId)
      .send({ description: 'General practitioner attendance' })
      .expect(201);
    // The endpoint re-asks the rule set rather than assuming.
    expect(set.body.validation.c6).toBe('pass');
    expect(set.body.validation.otherFailures).toEqual([]);

    // After: the lock succeeds, and the SERVER supplied D6a — the client sent
    // no description, exactly as the kiosk does not.
    const locked = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/particulars`)
      .set('x-practice-id', practiceId)
      .send({ serviceDate: new Date().toISOString().slice(0, 10) })
      .expect(201);
    expect(locked.body.particulars.basicServiceDescription).toBe('General practitioner attendance');
    expect(locked.body.particularsLockedAt).not.toBeNull();
  });

  it('refuses a description that is not in the current list, exactly as C6 would', async () => {
    const agreementId = await draft();
    for (const description of ['general practitioner attendance', 'GP visit', ' General practitioner attendance']) {
      const res = await request(app.getHttpServer())
        .post(`/service-descriptions/agreements/${agreementId}`)
        .set('x-practice-id', practiceId)
        .send({ description })
        .expect(400);
      expect(res.body.message).toMatch(new RegExp(SERVICE_DESCRIPTIONS_VERSION));
      // The refusal names the version, never the value that was sent.
      expect(res.body.message).not.toContain(description);
    }
  });

  it('never edits a locked agreement — a correction supersedes (HARD-02)', async () => {
    const agreementId = await draft();
    await request(app.getHttpServer())
      .post(`/service-descriptions/agreements/${agreementId}`)
      .set('x-practice-id', practiceId)
      .send({ description: SERVICE_DESCRIPTIONS[0] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/particulars`)
      .set('x-practice-id', practiceId)
      .send({ serviceDate: new Date().toISOString().slice(0, 10) })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/service-descriptions/agreements/${agreementId}`)
      .set('x-practice-id', practiceId)
      .send({ description: SERVICE_DESCRIPTIONS[1] })
      .expect(400);
    expect(res.body.message).toMatch(/already locked/i);
  });

  it('fails closed across a practice boundary — the agreement is simply not found', async () => {
    const agreementId = await draft();

    await request(app.getHttpServer())
      .post(`/service-descriptions/agreements/${agreementId}`)
      .set('x-practice-id', otherPracticeId)
      .send({ description: SERVICE_DESCRIPTIONS[0] })
      .expect(404);

    const pending = await request(app.getHttpServer())
      .get('/service-descriptions/pending')
      .set('x-practice-id', otherPracticeId)
      .expect(200);
    expect(pending.body.map((r: { agreementId: string }) => r.agreementId)).not.toContain(agreementId);

    const stored = await prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({ where: { id: agreementId } }),
    );
    expect(stored?.serviceDescription).toBeNull();
  });

  it('records the practice default against the person who set it, and refuses one off the list', async () => {
    await request(app.getHttpServer())
      .put('/service-descriptions/default')
      .set('x-practice-id', practiceId)
      .send({ description: 'Not on any list' })
      .expect(400);

    const saved = await request(app.getHttpServer())
      .put('/service-descriptions/default')
      .set('x-practice-id', practiceId)
      .send({ description: SERVICE_DESCRIPTIONS[0] })
      .expect(200);
    expect(saved.body.defaultDescription).toBe(SERVICE_DESCRIPTIONS[0]);

    const settings = await request(app.getHttpServer())
      .get('/service-descriptions/settings')
      .set('x-practice-id', practiceId)
      .expect(200);
    expect(settings.body.defaultDescription).toBe(SERVICE_DESCRIPTIONS[0]);

    const events = await prisma.vaultOutbox.findMany({ where: { subjectId: practiceId } });
    const set = events.find((e) => e.type === 'practice.default_service_description_set');
    expect(set).toBeDefined();
    expect((set!.actor as { id: string }).id).toBe(RECEPTIONIST.sub);

    // Put it back, so the suite leaves the practice as it found it.
    await request(app.getHttpServer())
      .put('/service-descriptions/default')
      .set('x-practice-id', practiceId)
      .send({ description: null })
      .expect(200);
  });
});
