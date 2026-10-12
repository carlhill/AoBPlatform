import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PendingEmailService } from '../src/organisations/pending-email.service';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../src/messaging/gateway';

/**
 * Changing the administrator's email address, held until it is confirmed.
 *
 * WHAT THIS PINS. The change used to apply the instant it was saved and revoke
 * every passkey in the same transaction. One console session was therefore
 * enough to redirect where a practice's mail goes AND lock the real
 * administrator out, with nothing sent to anybody -- takeover and denial of
 * service in a single save.
 *
 * The tests below are written against that failure rather than against the
 * happy path: the address must NOT move on save, the OLD address must be told,
 * and telling only the new address and the group address must not be enough.
 */
describe('a held administrator email change (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let pending: PendingEmailService;
  let practiceId: string;

  // Every message the service tried to send, in order.
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
        name: 'Held Email Test Practice',
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

  it('does not move the address on request, and does not revoke anything', async () => {
    await pending.request(practiceId, {
      requestedEmail: 'new.admin@practice.invalid',
      previousAdminEmail: 'robin.admin@practice.invalid',
      previousGroupEmail: 'reception@practice.invalid',
      requestedByName: 'Robin Admin',
      otherContactEmails: [],
    });

    const after = await prisma.withPractice(practiceId, (tx) =>
      tx.practice.findFirst({ where: { id: practiceId } }),
    );

    // The address in force is untouched, so the person who holds it can still
    // sign in, still receives our mail, and can still object.
    expect(after?.adminEmail).toBe('robin.admin@practice.invalid');
    // And its verification still stands, because it is still the same address.
    expect(after?.adminEmailVerifiedAt).not.toBeNull();
  });

  it('tells the OLD address, not just the new one and the group', async () => {
    /*
     * THE POINT OF THE WHOLE MECHANISM. The new address belongs to whoever
     * asked for the change, so telling them checks nothing. The group address
     * may be reachable by the same person if they are inside the practice. The
     * old address is the only channel the requester does not control BY HAVING
     * MADE THE REQUEST.
     */
    await pending.request(practiceId, {
      requestedEmail: 'attacker@elsewhere.invalid',
      previousAdminEmail: 'robin.admin@practice.invalid',
      previousGroupEmail: 'reception@practice.invalid',
      requestedByName: 'Robin Admin',
      otherContactEmails: [],
    });

    const to = sent.map((m) => m.to);
    expect(to).toContain('attacker@elsewhere.invalid');
    expect(to).toContain('robin.admin@practice.invalid');
    expect(to).toContain('reception@practice.invalid');
  });

  it('puts the code only in the message to the new address', async () => {
    await pending.request(practiceId, {
      requestedEmail: 'new.admin@practice.invalid',
      previousAdminEmail: 'robin.admin@practice.invalid',
      previousGroupEmail: 'reception@practice.invalid',
      requestedByName: 'Robin Admin',
      otherContactEmails: [],
    });

    const row = await prisma.withPractice(practiceId, (tx) =>
      tx.pendingEmailChange.findFirst({ where: { practiceId, outcome: null } }),
    );
    const code = row!.confirmCode;

    const toNew = sent.find((m) => m.to === 'new.admin@practice.invalid');
    const toOld = sent.find((m) => m.to === 'robin.admin@practice.invalid');

    expect(toNew!.body).toContain(code);
    // The warning must not carry the means to act on the thing it warns about.
    expect(toOld!.body).not.toContain(code);
  });

  it('refuses a confirmation with the wrong code, and counts the attempt', async () => {
    await pending.request(practiceId, {
      requestedEmail: 'new.admin@practice.invalid',
      previousAdminEmail: 'robin.admin@practice.invalid',
      previousGroupEmail: null,
      requestedByName: 'Robin Admin',
      otherContactEmails: [],
    });

    const row = await prisma.withPractice(practiceId, (tx) =>
      tx.pendingEmailChange.findFirst({ where: { practiceId, outcome: null } }),
    );

    await expect(pending.confirm(row!.confirmToken, '000000')).rejects.toThrow(/does not match/i);

    const after = await prisma.withPractice(practiceId, (tx) =>
      tx.pendingEmailChange.findFirst({ where: { id: row!.id } }),
    );
    expect(after?.attempts).toBe(1);
    // Still nothing has moved.
    const practice = await prisma.withPractice(practiceId, (tx) =>
      tx.practice.findFirst({ where: { id: practiceId } }),
    );
    expect(practice?.adminEmail).toBe('robin.admin@practice.invalid');
  });

  it('applies the change only once the new address answers with its code', async () => {
    await pending.request(practiceId, {
      requestedEmail: 'confirmed.admin@practice.invalid',
      previousAdminEmail: 'robin.admin@practice.invalid',
      previousGroupEmail: null,
      requestedByName: 'Robin Admin',
      otherContactEmails: [],
    });

    const row = await prisma.withPractice(practiceId, (tx) =>
      tx.pendingEmailChange.findFirst({ where: { practiceId, outcome: null } }),
    );

    const result = await pending.confirm(row!.confirmToken, row!.confirmCode);
    expect(result.confirmed).toBe(true);

    const practice = await prisma.withPractice(practiceId, (tx) =>
      tx.practice.findFirst({ where: { id: practiceId } }),
    );
    expect(practice?.adminEmail).toBe('confirmed.admin@practice.invalid');
    // Proven just now, by the exchange that moved it.
    expect(practice?.adminEmailVerifiedAt).not.toBeNull();
  });

  it('lets the old address stop a change, and raises a task a person must decide', async () => {
    await prisma.withPractice(practiceId, (tx) =>
      tx.practice.update({ where: { id: practiceId }, data: { adminEmail: 'robin.admin@practice.invalid' } }),
    );

    await pending.request(practiceId, {
      requestedEmail: 'attacker@elsewhere.invalid',
      previousAdminEmail: 'robin.admin@practice.invalid',
      previousGroupEmail: null,
      requestedByName: 'Somebody',
      otherContactEmails: [],
    });

    const row = await prisma.withPractice(practiceId, (tx) =>
      tx.pendingEmailChange.findFirst({ where: { practiceId, outcome: null } }),
    );

    const stopped = await pending.stop(row!.stopToken);
    expect(stopped.stopped).toBe(true);

    const practice = await prisma.withPractice(practiceId, (tx) =>
      tx.practice.findFirst({ where: { id: practiceId } }),
    );
    expect(practice?.adminEmail).toBe('robin.admin@practice.invalid');

    // "This was not me" about the address holding a credential always reaches a
    // person. `admin_contact_changed` is high-stakes, so no automated check may
    // close it.
    const task = await prisma.withPractice(practiceId, (tx) =>
      tx.reviewTask.findFirst({ where: { practiceId, kind: 'admin_contact_changed' }, orderBy: { raisedAt: 'desc' } }),
    );
    expect(task).toBeTruthy();
    expect(task?.state).toBe('open');

    // And a confirmation afterwards is refused: the token is still valid, the
    // answer is not.
    await expect(pending.confirm(row!.confirmToken, row!.confirmCode)).rejects.toThrow(/stopped/i);
  });

  it('supersedes an earlier request rather than leaving two live', async () => {
    await pending.request(practiceId, {
      requestedEmail: 'first@practice.invalid',
      previousAdminEmail: 'robin.admin@practice.invalid',
      previousGroupEmail: null,
      requestedByName: 'Robin Admin',
      otherContactEmails: [],
    });
    await pending.request(practiceId, {
      requestedEmail: 'second@practice.invalid',
      previousAdminEmail: 'robin.admin@practice.invalid',
      previousGroupEmail: null,
      requestedByName: 'Robin Admin',
      otherContactEmails: [],
    });

    const live = await prisma.withPractice(practiceId, (tx) =>
      tx.pendingEmailChange.findMany({ where: { practiceId, outcome: null } }),
    );
    expect(live).toHaveLength(1);
    expect(live[0].requestedEmail).toBe('second@practice.invalid');

    // The first is KEPT, marked superseded. Two attempts to move the same
    // address inside five days is itself worth a reviewer being able to see.
    const superseded = await prisma.withPractice(practiceId, (tx) =>
      tx.pendingEmailChange.findMany({ where: { practiceId, outcome: 'superseded' } }),
    );
    expect(superseded.length).toBeGreaterThan(0);
  });
});
