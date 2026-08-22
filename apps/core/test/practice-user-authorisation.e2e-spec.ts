import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PracticeUsersService } from '../src/practices/practice-users.service';

/**
 * Who may decide who else can sign in.
 *
 * WHAT THIS PINS. Being scoped to a practice used to be the entire access
 * model on these endpoints — the controller said so in a comment. That
 * separates a practice from the platform and separates nothing INSIDE a
 * practice, so somebody holding "ordinary access", the least privileged role
 * we issue, could open the same screen and grant themselves the administrator
 * role, withdraw the real administrator, or invite anybody they liked.
 *
 * Every cap the domain enforces — one administrator, five per scope — sat
 * behind a door anybody at the practice could walk through. The caps were
 * never the weak part; the door was.
 */
describe('who may manage a practice’s users (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: PracticeUsersService;
  let practiceId: string;

  // The two people, and the difference between them is one column.
  const ADMIN_SUB = 'kc-admin-authorisation-test';
  const ORDINARY_SUB = 'kc-ordinary-authorisation-test';

  const admin = { id: ADMIN_SUB, name: 'The Administrator', principalType: 'staff', roles: [] as string[] };
  const ordinary = { id: ORDINARY_SUB, name: 'An Ordinary User', principalType: 'staff', roles: [] as string[] };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    users = app.get(PracticeUsersService);

    const created = await request(app.getHttpServer())
      .post('/practices')
      .send({
        name: 'User Authorisation Test Practice',
        pms: 'medtech_evolution',
        rails: ['tyro'],
        locations: [{ address: '2 Example Street, Sampletown NSW 2000' }],
      })
      .expect(201);
    practiceId = created.body.id;

    await prisma.withPractice(practiceId, async (tx) => {
      await tx.staffMember.create({
        data: {
          practiceId,
          name: 'The Administrator',
          email: 'admin@authtest.invalid',
          role: 'practice_manager',
          consoleRole: 'admin',
          keycloakUserId: ADMIN_SUB,
        },
      });
      await tx.staffMember.create({
        data: {
          practiceId,
          name: 'An Ordinary User',
          email: 'ordinary@authtest.invalid',
          role: 'front_desk',
          consoleRole: 'other',
          keycloakUserId: ORDINARY_SUB,
        },
      });
    });
  });

  afterAll(async () => {
    if (practiceId) {
      await prisma.withPractice(practiceId, async (tx) => {
        await tx.staffMember.deleteMany({});
        await tx.practiceLocation.deleteMany({});
        await tx.practice.deleteMany({});
      });
    }
    await app.close();
  });

  const newPerson = {
    name: 'Somebody New',
    email: 'somebody.new@authtest.invalid',
    consoleRole: 'other',
  };

  it('lets the practice’s administrator add somebody', async () => {
    const created = await users.grant(practiceId, newPerson, admin);
    expect(created.id).toBeTruthy();

    await prisma.withPractice(practiceId, (tx) => tx.staffMember.delete({ where: { id: created.id } }));
  });

  it('REFUSES an ordinary account adding somebody', async () => {
    await expect(users.grant(practiceId, newPerson, ordinary)).rejects.toThrow(/only this practice’s administrator/i);
  });

  it('REFUSES an ordinary account promoting itself to administrator', async () => {
    /*
     * The escalation the cap could never have stopped. `assertMayAddUser`
     * enforces one administrator per practice, and would have refused this on
     * the count — but only after letting an ordinary user ask the question.
     * Withdrawing the real administrator first would then have made room.
     */
    const me = await prisma.withPractice(practiceId, (tx) =>
      tx.staffMember.findFirst({ where: { keycloakUserId: ORDINARY_SUB } }),
    );
    await expect(users.changeRole(practiceId, me!.id, 'admin', ordinary)).rejects.toThrow(/administrator/i);

    const after = await prisma.withPractice(practiceId, (tx) =>
      tx.staffMember.findFirst({ where: { keycloakUserId: ORDINARY_SUB } }),
    );
    expect(after?.consoleRole).toBe('other');
  });

  it('REFUSES an ordinary account withdrawing the administrator', async () => {
    const theAdmin = await prisma.withPractice(practiceId, (tx) =>
      tx.staffMember.findFirst({ where: { keycloakUserId: ADMIN_SUB } }),
    );
    await expect(users.deactivate(practiceId, theAdmin!.id, 'because', ordinary)).rejects.toThrow(/administrator/i);

    const after = await prisma.withPractice(practiceId, (tx) =>
      tx.staffMember.findFirst({ where: { keycloakUserId: ADMIN_SUB } }),
    );
    expect(after?.deactivatedAt).toBeNull();
  });

  it('REFUSES an ordinary account sending an enrolment link', async () => {
    // An invitation is a credential arriving in somebody's inbox. Not a
    // read-only act, and not one an ordinary account gets to perform.
    const theAdmin = await prisma.withPractice(practiceId, (tx) =>
      tx.staffMember.findFirst({ where: { keycloakUserId: ADMIN_SUB } }),
    );
    await expect(users.invite(practiceId, theAdmin!.id, ordinary)).rejects.toThrow(/administrator/i);
  });

  it('REFUSES a caller we cannot identify at all', async () => {
    await expect(users.grant(practiceId, newPerson, undefined)).rejects.toThrow(/could not tell who is asking/i);
  });

  it('REFUSES an administrator of a DIFFERENT practice', async () => {
    // The staff row is looked up inside this practice's scope, so an
    // administrator elsewhere resolves to nobody here rather than to somebody
    // with admin rights.
    const elsewhere = { id: 'kc-admin-of-somewhere-else', name: 'Other Admin', principalType: 'staff', roles: [] };
    await expect(users.grant(practiceId, newPerson, elsewhere)).rejects.toThrow(/only this practice’s administrator/i);
  });

  it('REFUSES a withdrawn administrator', async () => {
    /*
     * Access withdrawn is access withdrawn. Checking the role without checking
     * whether the row is still live would leave a former administrator able to
     * reinstate themselves for as long as the row existed — and rows here are
     * kept for ever, deliberately.
     */
    const theAdmin = await prisma.withPractice(practiceId, (tx) =>
      tx.staffMember.findFirst({ where: { keycloakUserId: ADMIN_SUB } }),
    );
    await prisma.withPractice(practiceId, (tx) =>
      tx.staffMember.update({ where: { id: theAdmin!.id }, data: { deactivatedAt: new Date() } }),
    );

    await expect(users.grant(practiceId, newPerson, admin)).rejects.toThrow(/only this practice’s administrator/i);

    await prisma.withPractice(practiceId, (tx) =>
      tx.staffMember.update({ where: { id: theAdmin!.id }, data: { deactivatedAt: null } }),
    );
  });

  it('REFUSES a platform operator who is not acting as the practice', async () => {
    /*
     * The role is not the permission. An operator's own token carries no
     * practice claim; the acting-as interceptor puts one there for the life of
     * an open session. Passing on the role alone would let support perform a
     * practice's own acts with no session, no stated reason, and nothing said
     * to the practice — which is the entire cost that makes acting-as
     * acceptable in the first place.
     */
    const looking = {
      id: 'kc-platform-operator',
      name: 'Support',
      principalType: 'staff',
      roles: ['platform_admin'],
    };
    await expect(users.grant(practiceId, newPerson, looking)).rejects.toThrow(/practice session rather than yours/i);
  });

  it('lets a platform operator through while acting as THIS practice', async () => {
    const acting = {
      id: 'kc-platform-operator',
      name: 'Support',
      principalType: 'staff',
      roles: ['platform_admin'],
      practiceId,
    };
    const created = await users.grant(practiceId, newPerson, acting);
    expect(created.id).toBeTruthy();

    await prisma.withPractice(practiceId, (tx) => tx.staffMember.delete({ where: { id: created.id } }));
  });

  it('REFUSES an operator acting as a DIFFERENT practice', async () => {
    // The claim has to name THIS practice. Holding an open session elsewhere
    // is not standing here, and a stale claim from a previous session is the
    // ordinary way that would happen.
    const elsewhere = {
      id: 'kc-platform-operator',
      name: 'Support',
      principalType: 'staff',
      roles: ['platform_admin'],
      practiceId: '00000000-0000-4000-8000-000000000000',
    };
    await expect(users.grant(practiceId, newPerson, elsewhere)).rejects.toThrow(/practice session rather than yours/i);
  });
});
