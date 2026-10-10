import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { MockPmsAdapter } from '@aobplatform/connector';
import type { PmsInvoice, ValidationResponse } from '@aobplatform/contracts';
import { SERVICE_DESCRIPTIONS, practiceDayWindow, practiceToday, type IsoDate } from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PMS_ADAPTER } from '../src/pms/pms.tokens';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../src/messaging/gateway';
import { RULES_CLIENT } from '../src/rules-client/rules-client.module';
import * as association from '../src/agreements/pre-agreement-association';
import { createServicingProvider, deleteSeededAnchors, type SeededAnchor } from './anchor';

/**
 * AN UNSIGNED PRE-AGREEMENT IS ASSOCIATED WITH ITS VISIT'S SERVICE, NEVER
 * LINKED TO IT (D-2026-10-10-09; Carl, 10 Oct 2026: option (b)).
 *
 * WHAT THIS SUITE PINS:
 *  - exactly one matching draft is associated when the service arrives, and
 *    the post-service agreement is STILL drafted, linked and chased;
 *  - two matching drafts associate none, and Reconciliation names both;
 *  - a person's choice is recorded, with the chooser and a vault event;
 *  - a different day, provider, patient or type does not match;
 *  - signed, expired and superseded drafts are never candidates;
 *  - the practice-local day boundary decides the day, not UTC;
 *  - the tablet's earlier-days line says what was found and names the item;
 *  - tenancy fails closed.
 *
 * NO DEPENDENCE ON THE CLOCK BEYOND "DAYS AGO" (wow.md §2 item 6): every
 * visit is several practice-local days in the past, and every draft's
 * creation time is pinned inside (or just outside) that day's window.
 */

const MANAGER = {
  sub: '00000000-0000-4000-8000-0000000aa501',
  principalType: 'staff',
  roles: [],
  preferredUsername: 'mai.manager',
  raw: {},
};
let currentPrincipal: Record<string, unknown> | null = null;

/** The post-service push locks the draft it makes; the rules engine is not under test here. */
const passingRules = {
  validate: async (): Promise<ValidationResponse> => ({
    valid: true,
    results: [{ rule: 'C8', outcome: 'pass', message: 'D7 is complete.', citation: 's 65C(4)' }],
    ruleSetVersion: 'test-rules-1',
    mappingVersion: 'test-mapping-1',
  }),
};

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** A practice-local day `n` days ago, and midday in it. */
const dayAgo = (n: number): IsoDate => practiceToday(new Date(Date.now() - n * DAY_MS)) as IsoDate;
const middayOf = (day: string) => new Date(practiceDayWindow(day).from.getTime() + 12 * HOUR_MS);

class FixtureAdapter extends MockPmsAdapter {
  invoices: PmsInvoice[] = [];
  override async readInvoices(): Promise<readonly PmsInvoice[]> {
    return this.invoices;
  }
}

describe('pre-agreement association, option (b) (e2e, real Postgres + fixture adapter)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const adapter = new FixtureAdapter();
  const practiceA = randomUUID();
  const practiceB = randomUUID();
  let provA: SeededAnchor;
  let provA2: SeededAnchor;

  const http = () => request(app.getHttpServer());
  const sync = () => http().post('/pms/sync').set('x-practice-id', practiceA).expect(201);
  const choices = (practiceId = practiceA) =>
    http().get('/reconciliation/association-choices').set('x-practice-id', practiceId).expect(200);

  let seq = 0;
  async function patient(practiceId = practiceA): Promise<{ id: string; key: string; assignorId: string }> {
    seq += 1;
    const key = `paa-${seq}-${randomUUID().slice(0, 8)}`;
    return prisma.withPractice(practiceId, async (tx) => {
      const row = await tx.patient.create({
        data: {
          practiceId,
          familyName: `Sampleperson${seq}`,
          givenNames: 'Alex',
          dateOfBirth: new Date('1970-01-01'),
          mobile: '+61400000000',
          email: `alex.sample${seq}@example.invalid`,
          patientRecordNumber: `PAA-${seq}`,
          pmsLinkageKey: key,
        },
      });
      const assignor = await tx.assignor.create({
        data: { practiceId, name: `Alex Sampleperson${seq}`, authorityBasis: 'self', dateOfBirth: new Date('1970-01-01') },
      });
      return { id: row.id, key, assignorId: assignor.id };
    });
  }

  async function draft(opts: {
    patient: { id: string; assignorId: string };
    createdAt: Date;
    anchor?: SeededAnchor;
    type?: string;
    status?: string;
    signatureEventId?: string;
    supersedesAgreementId?: string;
    practiceId?: string;
  }): Promise<string> {
    const practiceId = opts.practiceId ?? practiceA;
    return prisma.withPractice(practiceId, async (tx) => {
      const row = await tx.agreement.create({
        data: {
          practiceId,
          type: opts.type ?? 'episodic_pre',
          anchorKind: 'provider',
          affiliationId: (opts.anchor ?? provA).id,
          patientId: opts.patient.id,
          assignorId: opts.patient.assignorId,
          assignorIsPatient: true,
          status: opts.status ?? 'draft',
          signatureEventId: opts.signatureEventId ?? null,
          supersedesAgreementId: opts.supersedesAgreementId ?? null,
          serviceDescription: SERVICE_DESCRIPTIONS[0],
          createdAt: opts.createdAt,
        },
      });
      return row.id;
    });
  }

  function invoice(patientKey: string, serviceDate: string, providerKey = 'paa-prov-1'): PmsInvoice {
    return {
      pmsInvoiceKey: `paa-inv-${randomUUID()}`,
      patientLinkageKey: patientKey,
      providerLinkageKey: providerKey,
      serviceDate: serviceDate as IsoDate,
      mbsItemNumbers: ['23'],
    };
  }

  const recordFor = (pmsInvoiceKey: string) =>
    prisma.withPractice(practiceA, (tx) => tx.serviceRecord.findFirstOrThrow({ where: { pmsInvoiceKey } }));
  const associationOf = (agreementId: string, practiceId = practiceA) =>
    prisma.withPractice(practiceId, (tx) => tx.preAgreementAssociation.findFirst({ where: { agreementId } }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PMS_ADAPTER)
      .useValue(adapter)
      .overrideProvider(MESSAGING_GATEWAY)
      .useValue({ mode: 'test', dispatch: async () => ({ accepted: true }) } as MessagingGateway)
      .overrideProvider(RULES_CLIENT)
      .useValue(passingRules)
      .compile();
    app = moduleRef.createNestApplication();
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      if (currentPrincipal) req.principal = currentPrincipal;
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceA, async (tx) => {
      await tx.practice.create({ data: { id: practiceA, name: 'Association Practice A' } });
      provA = await createServicingProvider(tx, practiceA, { name: 'Dr Example Provider', pmsLinkageKey: 'paa-prov-1' });
      provA2 = await createServicingProvider(tx, practiceA, {
        name: 'Dr Second Provider',
        pmsLinkageKey: 'paa-prov-2',
        suburb: 'Otherton',
      });
    });
    await prisma.withPractice(practiceB, async (tx) => {
      await tx.practice.create({ data: { id: practiceB, name: 'Association Practice B' } });
    });
  });

  afterEach(() => {
    currentPrincipal = null;
    adapter.invoices = [];
  });

  afterAll(async () => {
    for (const practiceId of [practiceA, practiceB]) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.outboundItem.deleteMany({});
        await tx.captureRequest.deleteMany({});
        await tx.verificationChallenge.deleteMany({});
        await tx.preAgreementAssociation.deleteMany({});
        await tx.serviceRecord.deleteMany({});
        await tx.agreement.deleteMany({});
        await tx.assignor.deleteMany({});
        await tx.patient.deleteMany({});
        await tx.provider.deleteMany({});
        await deleteSeededAnchors(tx);
        await tx.practice.deleteMany({});
      });
    }
    await prisma.vaultOutbox.deleteMany({ where: { type: 'agreement.service_associated' } });
    await app?.close();
  });

  it('one_matching_draft_is_associated_and_the_post_agreement_is_still_drafted_linked_and_chased', async () => {
    const p = await patient();
    const day = dayAgo(5);
    const pre = await draft({ patient: p, createdAt: middayOf(day) });
    const inv = invoice(p.key, day);
    adapter.invoices = [inv];

    await sync();

    const record = await recordFor(inv.pmsInvoiceKey);
    const association = await associationOf(pre);
    expect(association).toMatchObject({ serviceRecordId: record.id, how: 'automatic', candidateCount: 1, associatedByPrincipalId: null });

    // NEVER LINKED: the service record names the post-service agreement, not the pre-agreement.
    expect(record.agreementId).not.toBeNull();
    expect(record.agreementId).not.toBe(pre);
    await prisma.withPractice(practiceA, async (tx) => {
      const post = await tx.agreement.findFirstOrThrow({ where: { id: record.agreementId! } });
      expect(post.type).toBe('episodic_post');
      // CHASED: the cascade opened a capture request for the post-agreement.
      expect(await tx.captureRequest.count({ where: { agreementId: post.id } })).toBeGreaterThan(0);
      // The pre-agreement itself is untouched.
      expect((await tx.agreement.findFirstOrThrow({ where: { id: pre } })).status).toBe('draft');
    });

    const events = await prisma.vaultOutbox.findMany({ where: { type: 'agreement.service_associated', subjectId: pre } });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ serviceRecordId: record.id, how: 'automatic', candidateCount: 1, linked: false, serviceDate: day });
    // IDS, THE DAY AND COUNTS ONLY: nothing about the person.
    expect(JSON.stringify(events[0]!.payload)).not.toContain('Sampleperson');
    expect(JSON.stringify(events[0]!.payload)).not.toContain('+614');
  });

  it('a_service_rendered_push_associates_its_one_matching_draft_and_still_drafts_the_post_agreement', async () => {
    const p = await patient();
    const day = dayAgo(4);
    const pre = await draft({ patient: p, createdAt: middayOf(day) });
    const patientRecordNumber = (await prisma.withPractice(practiceA, (tx) => tx.patient.findFirstOrThrow({ where: { id: p.id } })))
      .patientRecordNumber;

    const res = await http()
      .post('/arrivals/service-rendered')
      .set('x-practice-id', practiceA)
      .send({
        pmsPatientRecordNumber: patientRecordNumber,
        affiliationId: provA.id,
        serviceDate: day,
        mbsItemNumbers: ['23'],
        source: 'dev',
        idempotencyKey: `paa-svc-${randomUUID()}`,
      })
      .expect(201);

    expect(res.body.decision.outcome).toBe('episodic_post');
    expect(res.body.agreementId).toBeTruthy();
    expect(res.body.agreementId).not.toBe(pre);
    expect(await associationOf(pre)).toMatchObject({ serviceRecordId: res.body.serviceRecordId, how: 'automatic' });
  });

  it('two_matching_drafts_associate_none_and_reconciliation_names_both', async () => {
    const p = await patient();
    const day = dayAgo(6);
    const first = await draft({ patient: p, createdAt: middayOf(day) });
    const second = await draft({ patient: p, createdAt: new Date(middayOf(day).getTime() + HOUR_MS) });
    const inv = invoice(p.key, day);
    adapter.invoices = [inv];

    await sync();

    expect(await associationOf(first)).toBeNull();
    expect(await associationOf(second)).toBeNull();
    const record = await recordFor(inv.pmsInvoiceKey);
    // The post-service agreement is still drafted and linked.
    expect(record.agreementId).not.toBeNull();
    expect([first, second]).not.toContain(record.agreementId);

    const res = await choices();
    const item = (
      res.body as {
        serviceRecordId: string;
        reason: string;
        serviceDate: string;
        candidates: { agreementId: string; forDay: string }[];
      }[]
    ).find((c) => c.serviceRecordId === record.id)!;
    expect(item).toBeDefined();
    expect(item.reason).toBe('unsigned_drafts_match_service');
    expect(item.serviceDate).toBe(day);
    expect(item.candidates.map((c) => c.agreementId)).toEqual([first, second]);
    expect(item.candidates.every((c) => c.forDay === day)).toBe(true);
  });

  it('a_person_chooses_one_and_the_choice_is_recorded_with_the_chooser_and_an_event', async () => {
    const p = await patient();
    const day = dayAgo(7);
    const first = await draft({ patient: p, createdAt: middayOf(day) });
    const second = await draft({ patient: p, createdAt: new Date(middayOf(day).getTime() + HOUR_MS) });
    const inv = invoice(p.key, day);
    adapter.invoices = [inv];
    await sync();
    const record = await recordFor(inv.pmsInvoiceKey);
    const associate = (agreementId: string) =>
      http().post(`/reconciliation/${record.id}/associate`).set('x-practice-id', practiceA).send({ agreementId });

    // Nobody signed in: nothing recorded.
    await associate(second).expect(403);
    expect(await associationOf(second)).toBeNull();

    currentPrincipal = { ...MANAGER, practiceId: practiceA };
    // Not one of the matching drafts: refused, saying what was checked.
    const refused = await associate(randomUUID()).expect(400);
    expect(refused.body.message).toMatch(/not one of the unsigned drafts that match/);
    expect(refused.body.message).toMatch(/2 draft\(s\) match it now/);

    const chosen = await associate(second).expect(201);
    expect(chosen.body).toMatchObject({ serviceRecordId: record.id, agreementId: second, how: 'chosen', candidateCount: 2 });
    expect(await associationOf(second)).toMatchObject({ how: 'chosen', associatedByPrincipalId: MANAGER.sub });
    expect(await associationOf(first)).toBeNull();

    // A second choice for the same service is a conflict that names the first.
    const again = await associate(first).expect(409);
    expect(again.body.message).toContain(second);

    const events = await prisma.vaultOutbox.findMany({ where: { type: 'agreement.service_associated', subjectId: second } });
    expect(events).toHaveLength(1);
    expect(events[0]!.actor).toMatchObject({ principalType: 'staff', id: MANAGER.sub });
    expect(events[0]!.payload).toMatchObject({ how: 'chosen', candidateCount: 2, serviceRecordId: record.id });

    // Off the choice list once chosen.
    expect((await choices()).body.some((c: { serviceRecordId: string }) => c.serviceRecordId === record.id)).toBe(false);

    // THE TABLET'S EARLIER-DAYS LINES say what was found and name the Reconciliation item.
    const earlier = await http().get('/tablet-sessions/unsigned-earlier').set('x-practice-id', practiceA).expect(200);
    const rows = earlier.body.rows as { agreementId: string; reason: string; serviceRecordId: string | null }[];
    expect(rows.find((r) => r.agreementId === second)).toMatchObject({ reason: 'service_associated', serviceRecordId: record.id });
    expect(rows.find((r) => r.agreementId === first)).toMatchObject({ reason: 'service_associated_other', serviceRecordId: record.id });
  });

  it('a_waiting_choice_shows_on_the_tablet_as_choice_needed_naming_the_service', async () => {
    const p = await patient();
    const day = dayAgo(8);
    const first = await draft({ patient: p, createdAt: middayOf(day) });
    await draft({ patient: p, createdAt: new Date(middayOf(day).getTime() + HOUR_MS) });
    const inv = invoice(p.key, day);
    adapter.invoices = [inv];
    await sync();
    const record = await recordFor(inv.pmsInvoiceKey);

    const earlier = await http().get('/tablet-sessions/unsigned-earlier').set('x-practice-id', practiceA).expect(200);
    const row = (earlier.body.rows as { agreementId: string }[]).find((r) => r.agreementId === first);
    expect(row).toMatchObject({ reason: 'service_choice_needed', serviceRecordId: record.id });
  });

  it('a_different_day_provider_patient_or_type_does_not_match', async () => {
    const p = await patient();
    const other = await patient();
    const day = dayAgo(9);
    const dayBefore = dayAgo(10);
    const wrongDay = await draft({ patient: p, createdAt: middayOf(dayBefore) });
    const wrongProvider = await draft({ patient: p, createdAt: middayOf(day), anchor: provA2 });
    const wrongPatient = await draft({ patient: other, createdAt: middayOf(day) });
    const wrongType = await draft({ patient: p, createdAt: middayOf(day), type: 'treatment_plan' });
    const inv = invoice(p.key, day);
    adapter.invoices = [inv];

    await sync();

    for (const id of [wrongDay, wrongProvider, wrongPatient, wrongType]) expect(await associationOf(id)).toBeNull();
    const record = await recordFor(inv.pmsInvoiceKey);
    expect((await choices()).body.some((c: { serviceRecordId: string }) => c.serviceRecordId === record.id)).toBe(false);
  });

  it('signed_expired_and_superseded_drafts_are_never_candidates', async () => {
    const p = await patient();
    const day = dayAgo(11);
    const at = middayOf(day);
    const signed = await draft({ patient: p, createdAt: at, status: 'signed', signatureEventId: randomUUID() });
    const expired = await draft({ patient: p, createdAt: at, status: 'expired' });
    const replaced = await draft({ patient: p, createdAt: at });
    const successor = await draft({ patient: p, createdAt: new Date(at.getTime() + HOUR_MS), supersedesAgreementId: replaced });
    const inv = invoice(p.key, day);
    adapter.invoices = [inv];

    await sync();

    for (const id of [signed, expired, replaced]) expect(await associationOf(id)).toBeNull();
    // The successor is the one live draft for the visit, so it is the one associated.
    expect(await associationOf(successor)).toMatchObject({ how: 'automatic', candidateCount: 1 });
  });

  it('local_day_boundary_decides_the_day_not_utc', async () => {
    const p = await patient();
    const day = dayAgo(12);
    const { from } = practiceDayWindow(day);
    // Half an hour before the practice's midnight belongs to the day before.
    const lateTheNightBefore = await draft({ patient: p, createdAt: new Date(from.getTime() - 30 * 60_000) });
    // Half an hour after it belongs to the day, though in UTC it is still the previous date.
    const justAfterMidnight = await draft({ patient: p, createdAt: new Date(from.getTime() + 30 * 60_000) });
    const inv = invoice(p.key, day);
    adapter.invoices = [inv];

    await sync();

    expect(await associationOf(lateTheNightBefore)).toBeNull();
    expect(await associationOf(justAfterMidnight)).toMatchObject({ how: 'automatic', candidateCount: 1 });
  });

  /*
   * HARD RULE 8: AN ASSOCIATION IS EVIDENCE ABOUT A DRAFT, AND IT MAY NEVER COST
   * THE SERVICE. Two arrivals racing for one draft end in a unique violation;
   * that must not roll back the service record, its event, or the invoices
   * after it. The failure leaves the service on the choice list for a person.
   */
  it('a_failed_association_never_loses_the_service_record', async () => {
    const p = await patient();
    const later = await patient();
    const day = dayAgo(14);
    await draft({ patient: p, createdAt: middayOf(day) });
    const first = invoice(p.key, day);
    const second = invoice(later.key, day);
    adapter.invoices = [first, second];
    const race = Object.assign(new Error('Unique constraint failed on the fields: (`agreementId`)'), { code: 'P2002' });
    const spy = jest.spyOn(association, 'associateOnServiceArrival').mockRejectedValueOnce(race);
    try {
      await sync();
    } finally {
      spy.mockRestore();
    }

    const record = await recordFor(first.pmsInvoiceKey);
    // The service record survived, and the post-service agreement was still drafted and linked.
    expect(record.agreementId).not.toBeNull();
    // The invoice after it was not abandoned.
    expect((await recordFor(second.pmsInvoiceKey)).id).toBeTruthy();
    // Nothing was associated; the service is on the list for a person to choose.
    const listed = (await choices()).body as { serviceRecordId: string }[];
    expect(listed.some((c) => c.serviceRecordId === record.id)).toBe(true);
  });

  it('a_failed_association_never_loses_a_rendered_service_or_its_event', async () => {
    const p = await patient();
    const day = dayAgo(15);
    await draft({ patient: p, createdAt: middayOf(day) });
    const patientRecordNumber = (
      await prisma.withPractice(practiceA, (tx) => tx.patient.findFirstOrThrow({ where: { id: p.id } }))
    ).patientRecordNumber;
    const spy = jest.spyOn(association, 'associateOnServiceArrival').mockRejectedValueOnce(new Error('simulated'));
    let res: request.Response;
    try {
      res = await http()
        .post('/arrivals/service-rendered')
        .set('x-practice-id', practiceA)
        .send({
          pmsPatientRecordNumber: patientRecordNumber,
          affiliationId: provA.id,
          serviceDate: day,
          mbsItemNumbers: ['23'],
          source: 'dev',
          idempotencyKey: `paa-svc-${randomUUID()}`,
        })
        .expect(201);
    } finally {
      spy.mockRestore();
    }
    const serviceRecordId = res.body.serviceRecordId as string;
    expect(res.body.agreementId).toBeTruthy();
    const events = await prisma.vaultOutbox.findMany({ where: { type: 'service.rendered', subjectId: serviceRecordId } });
    expect(events).toHaveLength(1);
  });

  it('an_association_is_never_deleted_as_a_side_effect_of_deleting_its_draft_or_service', async () => {
    const p = await patient();
    const day = dayAgo(16);
    const pre = await draft({ patient: p, createdAt: middayOf(day) });
    const inv = invoice(p.key, day);
    adapter.invoices = [inv];
    await sync();
    const record = await recordFor(inv.pmsInvoiceKey);
    expect(await associationOf(pre)).not.toBeNull();

    // RESTRICT, not CASCADE: the fact stays unless somebody removes it on purpose.
    await expect(prisma.withPractice(practiceA, (tx) => tx.agreement.delete({ where: { id: pre } }))).rejects.toThrow();
    await expect(prisma.withPractice(practiceA, (tx) => tx.serviceRecord.delete({ where: { id: record.id } }))).rejects.toThrow();
    expect(await associationOf(pre)).not.toBeNull();
  });

  it('cross_practice_association_reads_and_choices_fail_closed', async () => {
    const p = await patient();
    const day = dayAgo(13);
    const first = await draft({ patient: p, createdAt: middayOf(day) });
    await draft({ patient: p, createdAt: new Date(middayOf(day).getTime() + HOUR_MS) });
    const inv = invoice(p.key, day);
    adapter.invoices = [inv];
    await sync();
    const record = await recordFor(inv.pmsInvoiceKey);

    // Practice B sees none of A's choices, and cannot choose for A's service.
    expect((await choices(practiceB)).body).toEqual([]);
    currentPrincipal = { ...MANAGER, practiceId: practiceB };
    await http()
      .post(`/reconciliation/${record.id}/associate`)
      .set('x-practice-id', practiceB)
      .send({ agreementId: first })
      .expect(404);
    expect(await associationOf(first)).toBeNull();

    // And a scoped read of the table from B returns nothing of A's.
    currentPrincipal = { ...MANAGER, practiceId: practiceA };
    await http().post(`/reconciliation/${record.id}/associate`).set('x-practice-id', practiceA).send({ agreementId: first }).expect(201);
    expect(await associationOf(first, practiceB)).toBeNull();
    expect(await associationOf(first, practiceA)).not.toBeNull();
  });
});
