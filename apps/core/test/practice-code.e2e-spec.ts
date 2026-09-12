/**
 * THE PRACTICE CODE AND THE TWO USERNAME SHAPES, against real Postgres
 * (PRACTICE-SCOPED-LOGIN.md sections 3, 3a, 3b, 5; D-2026-09-12-10).
 *
 * The domain half — how a slug is made, what the two shapes look like — is
 * proved without a database in `packages/domain/src/account-naming.test.ts`.
 * What can only be proved HERE is the half that is the database's job:
 *
 *   - two practices can never hold the same code, because a UNIQUE index says
 *     so rather than because a code path looked first;
 *   - the allocator walks past a collision the index refuses;
 *   - a code, once allocated, does not move when the practice is renamed;
 *   - an account that already exists keeps its username, whatever shape it is
 *     in — the one thing in this change that could lock a real person out.
 *
 * Keycloak is a stub. The point under test is which name is CHOSEN, not the
 * realm round-trip; sign-in against the live realm is verified separately with
 * a virtual authenticator.
 */
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { allocatePracticeCode, practiceCode } from '../src/practices/practice-code';
import { usernameForPersonAtPractice, usernameForPracticeAdmin } from '../src/identity/account-names';

/**
 * A token nothing else in the database can be carrying, so a slug built from a
 * name in this file can never collide with one of the 142 practices already
 * there — and a collision the test DOES want is one it created itself.
 */
const RUN = randomUUID().replace(/-/g, '').slice(0, 6);

describe('the practice code (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const created: string[] = [];

  /** Accounts the stub realm holds, by username, so grandfathering can be exercised. */
  const realm = new Map<string, { id: string; username: string; attributes?: Record<string, string[]> }>();
  const keycloak = {
    findById: async (id: string) => [...realm.values()].find((u) => u.id === id) ?? null,
    findByUsername: async (username: string) => realm.get(username) ?? null,
  };

  const makePractice = async (name: string, tradingNames: string[] = []) => {
    const id = randomUUID();
    created.push(id);
    await prisma.withPractice(id, (tx) => tx.practice.create({ data: { id, name, tradingNames } }));
    return id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Only rows this file created, addressed by id.
    for (const id of created) {
      await prisma.withPractice(id, (tx) => tx.practice.deleteMany({ where: { id } }));
    }
    await app.close();
  });

  it('the_slug_is_made_from_the_trading_name_and_strips_everything_but_letters_and_digits', async () => {
    // The allocator and the migration's SQL must agree, so the worked examples
    // from the document are run through the real path rather than the pure one.
    // (A per-run suffix keeps them from colliding with the 142 practices the
    // database already holds; it is stripped by the same rule as the rest.)
    const id = await makePractice(`Powell St. Practice ${RUN}`, [`Powell St. Practice ${RUN}`]);
    const { code, generated } = await allocatePracticeCode(prisma, id);
    expect(code).toBe(`powellstpractice${RUN}`);
    expect(generated).toBe(false);

    // Apostrophes and ampersands disappear like every other character outside
    // a-z0-9 — nothing is transliterated and nothing becomes a hyphen.
    const obrien = await makePractice(`O'Brien & Sons ${RUN}`);
    expect((await allocatePracticeCode(prisma, obrien)).code).toBe(`obriensons${RUN}`);

    // Truncated to 24 (rule 3), counted AFTER stripping.
    const long = await makePractice(`The Very Long Named Family Medical Centre of Sampletown ${RUN}`);
    const longCode = (await allocatePracticeCode(prisma, long)).code;
    expect(longCode).toHaveLength(24);
    expect(longCode).toBe('theverylongnamedfamilyme');

    // The TRADING name wins, and the LEGAL name is never consulted — the
    // allocator does not even select the column.
    const traded = await makePractice(`Long Legal Entity Name ${RUN}`, [`Traded${RUN}`]);
    await prisma.withPractice(traded, (tx) =>
      tx.practice.update({ where: { id: traded }, data: { legalName: `The trustee for Something Trust ${RUN}` } }),
    );
    expect((await allocatePracticeCode(prisma, traded)).code).toBe(`traded${RUN}`);
  });

  it('two_practices_can_never_be_issued_the_same_code', async () => {
    const first = await makePractice(`Identical Name Medical ${RUN}`);
    const second = await makePractice(`Identical Name Medical ${RUN}`);

    const one = await allocatePracticeCode(prisma, first);
    const two = await allocatePracticeCode(prisma, second);
    expect(one.code).toBe(`identicalnamemedical${RUN}`.slice(0, 24));
    expect(two.code).not.toBe(one.code);
    // Extended deterministically rather than randomly (section 5 rule 3).
    expect(two.code).toBe(`${one.code}2`);

    /*
     * AND THE DATABASE IS WHAT MAKES THAT TRUE, not the loop above. Written
     * straight past the allocator, so what fails is the UNIQUE index. An
     * application check would pass this test and still lose a race; this one
     * cannot.
     */
    const third = await makePractice(`Something Else Entirely ${RUN}`);
    await expect(
      prisma.withPractice(third, (tx) =>
        tx.practice.update({ where: { id: third }, data: { code: one.code } }),
      ),
    ).rejects.toMatchObject({ code: 'P2002' });

    // The shape CHECK is the database's too: a code that is not a-z0-9 is
    // refused however it arrives.
    await expect(
      prisma.withPractice(third, (tx) =>
        tx.practice.update({ where: { id: third }, data: { code: 'Not A Code' } }),
      ),
    ).rejects.toThrow();
  });

  it('renaming_a_practice_never_moves_its_code', async () => {
    const id = await makePractice(`Before The Rename ${RUN}`);
    const original = await practiceCode(prisma, id);
    expect(original).toBe(`beforetherename${RUN}`.slice(0, 24));

    await prisma.withPractice(id, (tx) =>
      tx.practice.update({
        where: { id },
        data: { name: `After The Rename ${RUN}`, tradingNames: [`Rebranded${RUN}`] },
      }),
    );

    // Asked again — including through the path every account-naming call site
    // uses — the answer is the same one. The code is STORED, never re-derived,
    // because a username must never change under a passkey.
    expect(await practiceCode(prisma, id)).toBe(original);
    const again = await allocatePracticeCode(prisma, id);
    expect(again.code).toBe(original);
    expect(again.allocated).toBe(false);

    // And so is the username built from it.
    const { username } = await usernameForPracticeAdmin(
      { prisma, keycloak: keycloak as never },
      { practiceId: id },
    );
    expect(username).toBe(`admin.${original}`);
  });

  it('a_practice_whose_name_yields_no_usable_slug_gets_a_generated_code_marked_as_generated', async () => {
    // A practice named in a non-Latin script strips to nothing (section 3b
    // rule 4). A mangled code would be worse than an honest opaque one.
    const id = await makePractice('診療所');
    const { code, generated } = await allocatePracticeCode(prisma, id);

    expect(generated).toBe(true);
    expect(code).toMatch(/^p[0-9a-f]{12}$/);

    // MARKED, and the mark is stored so a reader does not have to infer it.
    const row = await prisma.withPractice(id, (tx) =>
      tx.practice.findFirstOrThrow({ where: { id }, select: { code: true, codeGenerated: true } }),
    );
    expect(row.code).toBe(code);
    expect(row.codeGenerated).toBe(true);
  });

  it('a_practices_admin_account_is_named_for_the_practice_and_never_for_a_person', async () => {
    const id = await makePractice(`Xlevelup Sample ${RUN}`, [`Xlevelup${RUN}`]);
    const code = await practiceCode(prisma, id);

    const { username, grandfathered } = await usernameForPracticeAdmin(
      { prisma, keycloak: keycloak as never },
      { practiceId: id, adminKeycloakUserId: null },
    );
    expect(grandfathered).toBe(false);
    expect(username).toBe(`admin.${code}`);
    expect(username).toBe(`admin.xlevelup${RUN}`);

    // Nothing of a person is in it: no address, no name, and no practice id
    // either — the code is readable and allocated, not a UUID slice.
    expect(username).not.toContain('@');
    expect(username).not.toContain(id.slice(0, 8));

    // A person at the same practice gets the OTHER shape, and it carries their
    // whole address unchanged.
    const person = await usernameForPersonAtPractice(
      { prisma, keycloak: keycloak as never },
      { practiceId: id, email: 'audrey@hillsempire.com' },
    );
    expect(person.username).toBe(`audrey@hillsempire.com.${code}`);
  });

  it('the_same_person_at_two_practices_gets_two_usernames_and_keeps_one_address', async () => {
    // Section 3a. Two logins, one person — and both accounts carry her own
    // email, which is what the realm change in section 4 makes possible.
    const a = await makePractice(`Practice Alpha ${RUN}`);
    const b = await makePractice(`Practice Beta ${RUN}`);
    const email = 'audrey@hillsempire.com';

    const atA = await usernameForPersonAtPractice({ prisma, keycloak: keycloak as never }, { practiceId: a, email });
    const atB = await usernameForPersonAtPractice({ prisma, keycloak: keycloak as never }, { practiceId: b, email });

    expect(atA.username).not.toBe(atB.username);
    expect(atA.username.startsWith(`${email}.`)).toBe(true);
    expect(atB.username.startsWith(`${email}.`)).toBe(true);
  });

  it('existing_usernames_are_never_changed', async () => {
    /*
     * THE ONE THING IN THIS CHANGE THAT COULD LOCK A REAL PERSON OUT.
     *
     * A passkey is bound to a username. `admin.821709fb`, `drjhuang@gmail.com`
     * and `jo.example@example.invalid` are live accounts issued before this
     * scheme; if the platform decided their names again under the new rules it
     * would miss them, create a second account, and orphan a credential
     * somebody uses to sign in at a practice they are standing in.
     *
     * Every shape those accounts wear is exercised here.
     */
    const id = await makePractice(`Grandfather Test ${RUN}`, [`Grandfather${RUN}`]);
    const code = await practiceCode(prisma, id);

    // 1. The oldest admin name: `admin.<first 8 hex>`, claimed only because its
    //    own practice_id attribute says it is ours.
    const oldest = { id: randomUUID(), username: `admin.${id.slice(0, 8)}`, attributes: { practice_id: [id] } };
    realm.set(oldest.username, oldest);
    let resolved = await usernameForPracticeAdmin({ prisma, keycloak: keycloak as never }, { practiceId: id });
    expect(resolved).toEqual({ username: `admin.${id.slice(0, 8)}`, grandfathered: true });
    expect(resolved.username).not.toBe(`admin.${code}`);

    // ...and NOT when it belongs to somebody else. Eight hex characters is 32
    // bits; the account it finds may be another practice's, and adopting it
    // would hand this practice their token claim.
    realm.set(oldest.username, { ...oldest, attributes: { practice_id: [randomUUID()] } });
    resolved = await usernameForPracticeAdmin({ prisma, keycloak: keycloak as never }, { practiceId: id });
    expect(resolved).toEqual({ username: `admin.${code}`, grandfathered: false });
    realm.delete(oldest.username);

    // 2. The scheme immediately before this one: `admin.<full practice id>`.
    const previous = { id: randomUUID(), username: `admin.${id}` };
    realm.set(previous.username, previous);
    resolved = await usernameForPracticeAdmin({ prisma, keycloak: keycloak as never }, { practiceId: id });
    expect(resolved).toEqual({ username: `admin.${id}`, grandfathered: true });
    realm.delete(previous.username);

    // 3. AN ACCOUNT WE ALREADY HOLD THE ID OF WINS OVER EVERY GUESS, and the
    //    name is returned verbatim however odd it looks — this is the path
    //    `admin.821709fb` and `drjhuang@gmail.com` actually take.
    for (const legacy of ['admin.821709fb', 'drjhuang@gmail.com', 'jo.example@example.invalid']) {
      const account = { id: randomUUID(), username: legacy };
      realm.set(legacy, account);

      expect(
        await usernameForPracticeAdmin(
          { prisma, keycloak: keycloak as never },
          { practiceId: id, adminKeycloakUserId: account.id },
        ),
      ).toEqual({ username: legacy, grandfathered: true });

      expect(
        await usernameForPersonAtPractice(
          { prisma, keycloak: keycloak as never },
          { practiceId: id, email: 'somebody@example.invalid', keycloakUserId: account.id },
        ),
      ).toEqual({ username: legacy, grandfathered: true });
    }

    // 4. A STALE ID IS NOT A NAME. When our column points at an account the
    //    realm no longer has, there is no credential left to orphan, so the
    //    current scheme is correct rather than dangerous.
    expect(
      await usernameForPersonAtPractice(
        { prisma, keycloak: keycloak as never },
        { practiceId: id, email: 'somebody@example.invalid', keycloakUserId: randomUUID() },
      ),
    ).toEqual({ username: `somebody@example.invalid.${code}`, grandfathered: false });
  });
});
