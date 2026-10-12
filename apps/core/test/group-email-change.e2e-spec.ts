import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PendingEmailService } from '../src/organisations/pending-email.service';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../src/messaging/gateway';

/**
 * Changing the SHARED practice address, held until it is confirmed — the
 * groupEmail mirror of pending-email-change.e2e-spec.ts.
 *
 * WHAT THIS PINS. groupEmail used to apply the instant it was saved. Its own
 * schema comment says "nothing enrols against this address, it receives
 * notices only" — true, and not the same as harmless: groupEmail is the
 * WITNESS an adminEmail handover is told about when the old admin inbox is
 * unreachable. Changed in the same breath as the thing it watches, it would
 * silence itself before it ever saw the handover it exists to catch.
 *
 * So these tests pin the same shape as the adminEmail suite — held, proved,
 * the old address and the admin address both told, one live request at a
 * time — AND pin the one deliberate difference: no Keycloak call anywhere,
 * because nobody signs in as groupEmail.
 */
describe('a held shared-address (groupEmail) change (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let pending: PendingEmailService;
  let practiceId: string;

  const sent: { to: string; subject: string; body: string }[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_GATEWAY)
      .useValue({
        mode: 'test',
        dispatch: async (m) => {
          sent.push({ to: m.to, subject: m.subject ?? '', body: m.body });
          return { accepted: true };
        },
      } as MessagingGateway)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    pending = app.get(PendingEmailService);

    const created = await request(app.getHttpServer())
      .post('/practices')
      .send({
        name: 'Held Group Email Test Practice',
        pms: 'medtech_evolution',
        rails: ['tyro'],
        locations: [{ address: '1 Example Street, Sampletown NSW 2000' }],
      })
      .expect(201);
    practiceId = created.body.id;

    await prisma.withPractice(practiceId, (tx) =>
      tx.practice.update({
        where: { id: practiceId },
        data: {
          adminName: 'Robin Admin',
          adminEmail: 'robin.admin@practice.invalid',
          groupEmail: 'reception@practice.invalid',
          adminEmailVerifiedAt: new Date(),
        },
      }),
    );
  });

  afterAll(async () => {
    if (practiceId) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.pendingEmailChange.deleteMany({});
        await tx.reviewTask.deleteMany({});
        await tx.staffMember.deleteMany({});
        await tx.practiceLocation.deleteMany({});
        await tx.practice.deleteMany({});
      });
    }
    await app.close();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  it('does not move the address on request', async () => {
    await pending.requestGroupEmail(practiceId, {
      requestedEmail: 'new.reception@practice.invalid',
      previousGroupEmail: 'reception@practice.invalid',
      currentAdminEmail: 'robin.admin@practice.invalid',
      requestedByName: 'Robin Admin',
    });

    const after = await prisma.withPractice(practiceId, (tx) => tx.practice.findFirst({ where: { id: practiceId } }));
    expect(after?.groupEmail).toBe('reception@practice.invalid');
  });

  it('tells the OLD shared address and the administrator, not just the new address', async () => {
    await pending.requestGroupEmail(practiceId, {
      requestedEmail: 'new.reception@practice.invalid',
      previousGroupEmail: 'reception@practice.invalid',
      currentAdminEmail: 'robin.admin@practice.invalid',
      requestedByName: 'Robin Admin',
    });

    const to = sent.map((m) => m.to);
    expect(to).toContain('new.reception@practice.invalid');
    expect(to).toContain('reception@practice.invalid');
    expect(to).toContain('robin.admin@practice.invalid');
  });

  it('applies the change only once the new address answers with its code, and does not touch adminEmail', async () => {
    await pending.requestGroupEmail(practiceId, {
      requestedEmail: 'confirmed.reception@practice.invalid',
      previousGroupEmail: 'reception@practice.invalid',
      currentAdminEmail: 'robin.admin@practice.invalid',
      requestedByName: 'Robin Admin',
    });

    const row = await prisma.withPractice(practiceId, (tx) =>
      tx.pendingEmailChange.findFirst({ where: { practiceId, field: 'groupEmail', outcome: null } }),
    );

    const found = await pending.resolve(row!.confirmToken, 'confirm');
    const result = await pending.confirmGroupEmail(found!, row!.confirmCode);
    expect(result.confirmed).toBe(true);

    const practice = await prisma.withPractice(practiceId, (tx) => tx.practice.findFirst({ where: { id: practiceId } }));
    expect(practice?.groupEmail).toBe('confirmed.reception@practice.invalid');
    expect(practice?.groupEmailVerifiedAt).not.toBeNull();
    // NOT A HANDOVER: the administrator's own address is untouched.
    expect(practice?.adminEmail).toBe('robin.admin@practice.invalid');
  });

  it('lets the old address stop a change, and raises a task a person must decide', async () => {
    await prisma.withPractice(practiceId, (tx) =>
      tx.practice.update({ where: { id: practiceId }, data: { groupEmail: 'reception@practice.invalid' } }),
    );

    await pending.requestGroupEmail(practiceId, {
      requestedEmail: 'attacker@elsewhere.invalid',
      previousGroupEmail: 'reception@practice.invalid',
      currentAdminEmail: 'robin.admin@practice.invalid',
      requestedByName: 'Somebody',
    });

    const row = await prisma.withPractice(practiceId, (tx) =>
      tx.pendingEmailChange.findFirst({ where: { practiceId, field: 'groupEmail', outcome: null } }),
    );

    const found = await pending.resolve(row!.stopToken, 'stop');
    const stopped = await pending.stopGroupEmail(found!);
    expect(stopped.stopped).toBe(true);

    const practice = await prisma.withPractice(practiceId, (tx) => tx.practice.findFirst({ where: { id: practiceId } }));
    expect(practice?.groupEmail).toBe('reception@practice.invalid');

    const task = await prisma.withPractice(practiceId, (tx) =>
      tx.reviewTask.findFirst({ where: { practiceId, kind: 'admin_contact_changed' }, orderBy: { raisedAt: 'desc' } }),
    );
    expect(task).toBeTruthy();
    expect(task?.state).toBe('open');
  });

  it('supersedes an earlier groupEmail request without touching a live adminEmail one', async () => {
    await pending.request(practiceId, {
      requestedEmail: 'new.admin@practice.invalid',
      previousAdminEmail: 'robin.admin@practice.invalid',
      previousGroupEmail: 'reception@practice.invalid',
      requestedByName: 'Robin Admin',
      otherContactEmails: [],
    });

    await pending.requestGroupEmail(practiceId, {
      requestedEmail: 'first@practice.invalid',
      previousGroupEmail: 'reception@practice.invalid',
      currentAdminEmail: 'robin.admin@practice.invalid',
      requestedByName: 'Robin Admin',
    });
    await pending.requestGroupEmail(practiceId, {
      requestedEmail: 'second@practice.invalid',
      previousGroupEmail: 'reception@practice.invalid',
      currentAdminEmail: 'robin.admin@practice.invalid',
      requestedByName: 'Robin Admin',
    });

    // ONE live groupEmail request...
    const liveGroup = await prisma.withPractice(practiceId, (tx) =>
      tx.pendingEmailChange.findMany({ where: { practiceId, field: 'groupEmail', outcome: null } }),
    );
    expect(liveGroup).toHaveLength(1);
    expect(liveGroup[0].requestedEmail).toBe('second@practice.invalid');

    // ...and the adminEmail request from moments ago is still untouched by it.
    const liveAdmin = await prisma.withPractice(practiceId, (tx) =>
      tx.pendingEmailChange.findMany({ where: { practiceId, field: 'adminEmail', outcome: null } }),
    );
    expect(liveAdmin).toHaveLength(1);
    expect(liveAdmin[0].requestedEmail).toBe('new.admin@practice.invalid');
  });

  /**
   * THE WIRING, not just the service. `organisations.amendApplication` is
   * where `PATCH /organisations/:id` actually intercepts groupEmail the same
   * way it already intercepted adminEmail — the two tested here in the SAME
   * save, because that is the case the migration exists for: one field
   * silencing the other's witness.
   */
  describe('reached through PATCH /organisations/:id (amendApplication)', () => {
    it('holds groupEmail rather than applying it, raises one review task, and leaves adminEmail as a separate hold', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/organisations/${practiceId}`)
        .send({
          groupEmail: 'patched.reception@practice.invalid',
          adminEmail: 'patched.admin@practice.invalid',
          reason: 'Testing the groupEmail proof cycle end to end',
          changedByName: 'Robin Admin',
        })
        .expect(200);

      expect(res.body.pending.groupEmail?.requestedEmail).toBe('patched.reception@practice.invalid');
      expect(res.body.pending.adminEmail?.requestedEmail).toBe('patched.admin@practice.invalid');

      // NEITHER has moved — both are held pending their own confirmation.
      const practice = await prisma.withPractice(practiceId, (tx) => tx.practice.findFirst({ where: { id: practiceId } }));
      expect(practice?.groupEmail).not.toBe('patched.reception@practice.invalid');
      expect(practice?.adminEmail).not.toBe('patched.admin@practice.invalid');

      // Two independent live rows, correctly scoped by field.
      const live = await prisma.withPractice(practiceId, (tx) =>
        tx.pendingEmailChange.findMany({ where: { practiceId, outcome: null } }),
      );
      expect(live.map((r) => r.field).sort()).toEqual(['adminEmail', 'groupEmail']);
    });
  });
});
