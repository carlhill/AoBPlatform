import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { SERVICE_DESCRIPTIONS } from '@aobplatform/domain';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { EARLIER_UNSIGNED_CAP } from '../src/tablet-sessions/tablet-sessions.service';
import { createServicingProvider, deleteSeededAnchors, type SeededAnchor } from './anchor';

/**
 * "UNSIGNED FROM EARLIER DAYS: N" ON THE PRACTICE TABLET PAGE
 * (D-2026-10-10-01, option 1) — `GET /tablet-sessions/unsigned-earlier`.
 *
 * WHAT THIS SUITE PINS:
 *  - an earlier day's draft that a service record names says so, and carries
 *    that record's id for the Reconciliation link;
 *  - one no service record names says "no service recorded";
 *  - one whose service a Reconciliation decision closed says which decision;
 *  - today's rows, signed rows and stored rows are not on it;
 *  - the list is oldest first and capped, and the count is never capped;
 *  - it writes nothing (no agreement moves, no vault event) — hard rule 8;
 *  - tenancy fails closed.
 *
 * NO DEPENDENCE ON THE CLOCK BEYOND "DAYS AGO" (wow.md §2 item 6): every
 * earlier row is at least two days old and every today row is created now.
 */

const RECEPTIONIST = {
  sub: '00000000-0000-4000-8000-0000000e4a01',
  principalType: 'staff',
  roles: [],
  preferredUsername: 'mai.frontdesk',
  raw: {},
};
let currentPrincipal: Record<string, unknown> | null = null;
function signedInAt(practiceId: string): void {
  currentPrincipal = { ...RECEPTIONIST, practiceId };
}

const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

interface Row {
  agreementId: string;
  patientId: string;
  patientName: string;
  providerName: string | null;
  forDate: string;
  reason: string;
  serviceRecordId: string | null;
  reconciliationDecision: string | null;
}

describe('unsigned from earlier days (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const practiceA = randomUUID();
  const practiceB = randomUUID();
  let anchorA: SeededAnchor;
  let anchorB: SeededAnchor;
  let patientA: string;
  let assignorA: string;
  let patientB: string;
  let assignorB: string;

  const http = () => request(app.getHttpServer());
  const list = (practiceId = practiceA) =>
    http().get('/tablet-sessions/unsigned-earlier').set('x-practice-id', practiceId).expect(200);

  async function agreement(opts: {
    createdAt: Date;
    practiceId?: string;
    status?: string;
  }): Promise<string> {
    const practiceId = opts.practiceId ?? practiceA;
    const isB = practiceId === practiceB;
    return prisma.withPractice(practiceId, async (tx) => {
      const row = await tx.agreement.create({
        data: {
          practiceId,
          type: 'episodic_pre',
          anchorKind: 'provider',
          affiliationId: isB ? anchorB.id : anchorA.id,
          patientId: isB ? patientB : patientA,
          assignorId: isB ? assignorB : assignorA,
          assignorIsPatient: true,
          status: opts.status ?? 'draft',
          serviceDescription: SERVICE_DESCRIPTIONS[0],
          assignorConfirmedAt: opts.createdAt,
          createdAt: opts.createdAt,
        },
      });
      return row.id;
    });
  }

  async function serviceFor(agreementId: string, serviceDate: Date): Promise<string> {
    return prisma.withPractice(practiceA, async (tx) => {
      const record = await tx.serviceRecord.create({
        data: {
          practiceId: practiceA,
          pmsInvoiceKey: `earlier-${randomUUID()}`,
          patientId: patientA,
          providerId: anchorA.providerId,
          serviceDate,
          mbsItemNumbers: ['23'],
          agreementId,
        },
      });
      return record.id;
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // The same unforgeable seam the tablet-sessions suite uses.
    app.use((req: { principal?: unknown }, _res: unknown, next: () => void) => {
      if (currentPrincipal) req.principal = currentPrincipal;
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.withPractice(practiceA, async (tx) => {
      await tx.practice.create({ data: { id: practiceA, name: 'Earlier Days Practice A' } });
      anchorA = await createServicingProvider(tx, practiceA, {
        name: 'Dr Example Provider',
        providerType: 'general_practitioner',
      });
      patientA = (
        await tx.patient.create({
          data: {
            practiceId: practiceA,
            familyName: 'Sampleton',
            givenNames: 'Jamie',
            dateOfBirth: new Date('1957-03-14'),
            address: '12 Example Street, Sydney NSW 2000',
            patientRecordNumber: 'PRN-0001',
          },
        })
      ).id;
      assignorA = (
        await tx.assignor.create({ data: { practiceId: practiceA, name: 'Jamie Sampleton', authorityBasis: 'self' } })
      ).id;
    });

    await prisma.withPractice(practiceB, async (tx) => {
      await tx.practice.create({ data: { id: practiceB, name: 'Earlier Days Practice B' } });
      anchorB = await createServicingProvider(tx, practiceB, {
        name: 'Dr Other Provider',
        providerType: 'general_practitioner',
      });
      patientB = (
        await tx.patient.create({
          data: {
            practiceId: practiceB,
            familyName: 'Elsewhere',
            givenNames: 'Alex',
            dateOfBirth: new Date('1988-02-02'),
            address: '9 Other Road, Melbourne VIC 3000',
          },
        })
      ).id;
      assignorB = (
        await tx.assignor.create({ data: { practiceId: practiceB, name: 'Alex Elsewhere', authorityBasis: 'self' } })
      ).id;
    });
  });

  beforeEach(() => signedInAt(practiceA));

  afterAll(async () => {
    for (const practiceId of [practiceA, practiceB]) {
      await prisma.withPractice(practiceId, async (tx) => {
        // A decided service record stays: its decision is append-only evidence
        // and the database refuses to delete it (as reconciliation.e2e-spec).
        const decided = (await tx.reconciliationDecision.findMany({ select: { serviceRecordId: true } })).map(
          (d) => d.serviceRecordId,
        );
        await tx.serviceRecord.deleteMany({ where: { id: { notIn: decided } } });
        await tx.appointment.deleteMany({});
        await tx.captureRequest.deleteMany({});
        await tx.agreement.deleteMany({});
        await tx.assignor.deleteMany({});
        await tx.patient.deleteMany({});
        await tx.provider.deleteMany({});
        await deleteSeededAnchors(tx);
        await tx.practice.deleteMany({});
      });
    }
    await app?.close();
  });

  it('earlier_day_draft_linked_to_a_service_names_its_reconciliation_item', async () => {
    const agreementId = await agreement({ createdAt: daysAgo(3) });
    const serviceRecordId = await serviceFor(agreementId, daysAgo(3));

    const res = await list();
    const row = (res.body.rows as Row[]).find((r) => r.agreementId === agreementId);
    expect(row).toMatchObject({
      reason: 'service_in_reconciliation',
      serviceRecordId,
      reconciliationDecision: null,
      patientId: patientA,
      patientName: 'Jamie Sampleton',
      providerName: 'Dr Example Provider',
      forDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });

    // And it IS the item the Reconciliation page lists under that id.
    const queue = await http().get('/reconciliation/outstanding').set('x-practice-id', practiceA).expect(200);
    expect((queue.body as { serviceRecordId: string; agreementId: string }[])).toContainEqual(
      expect.objectContaining({ serviceRecordId, agreementId }),
    );
  });

  it('earlier_day_draft_with_no_service_says_no_service_recorded', async () => {
    const agreementId = await agreement({ createdAt: daysAgo(5) });

    const res = await list();
    const row = (res.body.rows as Row[]).find((r) => r.agreementId === agreementId);
    expect(row).toMatchObject({
      reason: 'no_service_recorded',
      serviceRecordId: null,
      reconciliationDecision: null,
      patientId: patientA,
    });
  });

  it('earlier_day_draft_whose_service_was_decided_names_the_decision', async () => {
    signedInAt(practiceA);
    const agreementId = await agreement({ createdAt: daysAgo(4) });
    const serviceRecordId = await serviceFor(agreementId, daysAgo(4));
    await prisma.withPractice(practiceA, (tx) =>
      tx.reconciliationDecision.create({
        data: { practiceId: practiceA, serviceRecordId, decision: 'forgo_benefit', decidedBy: 'mai.frontdesk' },
      }),
    );

    const res = await list();
    const row = (res.body.rows as Row[]).find((r) => r.agreementId === agreementId);
    expect(row).toMatchObject({
      reason: 'service_decided',
      serviceRecordId,
      reconciliationDecision: 'forgo_benefit',
    });
  });

  it('the_day_is_the_appointment_date_where_there_is_one', async () => {
    // Drafted TODAY for an appointment two days ago — earlier by the booking.
    const agreementId = await agreement({ createdAt: new Date() });
    const appointmentDay = isoDay(daysAgo(2));
    await prisma.withPractice(practiceA, (tx) =>
      tx.appointment.create({
        data: {
          practiceId: practiceA,
          pmsAppointmentKey: `earlier-${randomUUID()}`,
          patientId: patientA,
          date: new Date(appointmentDay),
          agreementId,
        },
      }),
    );

    const res = await list();
    const row = (res.body.rows as Row[]).find((r) => r.agreementId === agreementId);
    expect(row?.forDate).toBe(appointmentDay);
  });

  it('todays_rows_are_not_listed', async () => {
    const todays = await agreement({ createdAt: new Date() });

    const res = await list();
    expect((res.body.rows as Row[]).map((r) => r.agreementId)).not.toContain(todays);
    // ...and it is still on today's list, where it belongs.
    const pushable = await http().get('/tablet-sessions/pushable').set('x-practice-id', practiceA).expect(200);
    expect((pushable.body as { agreementId: string }[]).map((r) => r.agreementId)).toContain(todays);
  });

  it('signed_or_stored_agreements_are_not_listed', async () => {
    const stored = await agreement({ createdAt: daysAgo(6), status: 'stored' });
    const signedStatus = await agreement({ createdAt: daysAgo(6), status: 'signed' });

    const res = await list();
    const ids = (res.body.rows as Row[]).map((r) => r.agreementId);
    expect(ids).not.toContain(stored);
    expect(ids).not.toContain(signedStatus);
  });

  it('a_superseded_draft_is_not_listed_its_successor_is', async () => {
    const original = await agreement({ createdAt: daysAgo(7) });
    const successor = await prisma.withPractice(practiceA, async (tx) =>
      (
        await tx.agreement.create({
          data: {
            practiceId: practiceA,
            type: 'episodic_pre',
            anchorKind: 'provider',
            affiliationId: anchorA.id,
            patientId: patientA,
            assignorId: assignorA,
            assignorIsPatient: true,
            status: 'draft',
            serviceDescription: SERVICE_DESCRIPTIONS[0],
            supersedesAgreementId: original,
            createdAt: daysAgo(7),
          },
        })
      ).id,
    );

    const ids = ((await list()).body.rows as Row[]).map((r) => r.agreementId);
    expect(ids).not.toContain(original);
    expect(ids).toContain(successor);
  });

  it('the_list_reads_and_writes_nothing', async () => {
    const agreementId = await agreement({ createdAt: daysAgo(3) });
    const before = await prisma.withPractice(practiceA, (tx) => tx.agreement.findMany({ orderBy: { id: 'asc' } }));
    const outboxBefore = await prisma.vaultOutbox.count();

    await list();

    const after = await prisma.withPractice(practiceA, (tx) => tx.agreement.findMany({ orderBy: { id: 'asc' } }));
    expect(after).toEqual(before);
    expect(after.find((a) => a.id === agreementId)?.status).toBe('draft');
    expect(await prisma.vaultOutbox.count()).toBe(outboxBefore);
  });

  it('cross_practice_read_of_unsigned_earlier_fails_closed', async () => {
    await agreement({ createdAt: daysAgo(3) }); // practice A's
    const theirs = await agreement({ createdAt: daysAgo(3), practiceId: practiceB });

    /*
     * SIGNED IN AT B, ASKING AS B — the tenancy shape `tablet-sessions.e2e-spec`
     * uses. RLS scopes the read to the transaction's practice, so practice A's
     * earlier-day rows (several exist by now) are simply not there.
     *
     * NOT "signed in at B with A's header": with no bearer token the guard is
     * on its staged dev path and does not rewrite the header (it does so only
     * for a verified token's claim, `auth.guard.ts`), so that case would test
     * the staging, not this endpoint.
     */
    signedInAt(practiceB);
    const res = await http()
      .get('/tablet-sessions/unsigned-earlier')
      .set('x-practice-id', practiceB)
      .expect(200);
    expect(JSON.stringify(res.body)).not.toContain('Jamie');
    expect(JSON.stringify(res.body)).not.toContain(practiceA);
    expect((res.body.rows as Row[]).map((r) => r.agreementId)).toEqual([theirs]);
    expect(res.body.total).toBe(1);
  });

  it('oldest_first_and_capped_with_the_full_count', async () => {
    const extra = EARLIER_UNSIGNED_CAP + 2;
    await prisma.withPractice(practiceA, (tx) =>
      tx.agreement.createMany({
        data: Array.from({ length: extra }, (_, i) => ({
          practiceId: practiceA,
          type: 'episodic_pre',
          anchorKind: 'provider',
          affiliationId: anchorA.id,
          patientId: patientA,
          assignorId: assignorA,
          assignorIsPatient: true,
          status: 'draft',
          serviceDescription: SERVICE_DESCRIPTIONS[0],
          createdAt: daysAgo(10 + i),
        })),
      }),
    );

    const res = await list();
    const rows = res.body.rows as Row[];
    expect(res.body.total).toBeGreaterThan(EARLIER_UNSIGNED_CAP);
    expect(rows).toHaveLength(EARLIER_UNSIGNED_CAP);
    const dates = rows.map((r) => r.forDate);
    expect(dates).toEqual([...dates].sort());
    // The oldest of all of them leads.
    expect(rows[0].forDate <= isoDay(daysAgo(10 + extra - 2))).toBe(true);
  });
});
