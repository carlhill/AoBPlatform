import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Can one practice see another's figures through the reporting layer?
 *
 * WHY THIS TEST EXISTS AND WHY IT IS UNUSUAL. Cube composes its own SQL, which
 * is the point of it — somebody asks a question nobody anticipated and it
 * writes the query. So the tenancy boundary cannot be "the queries we wrote are
 * careful"; there are no queries we wrote. It has to be something the database
 * refuses to answer.
 *
 * Everywhere else in this codebase RLS is that backstop, keyed on a
 * transaction-local setting. Cube pools connections, so the natural worry is
 * that the setting cannot follow a pooled connection and RLS quietly stops
 * applying — leaving a config file as the only thing between two practices.
 *
 * The arrangement being pinned here:
 *   * the reporting view is `security_invoker`, so RLS applies to the CALLER
 *     rather than to the view's owner
 *   * `cube_reader` is a role those policies apply to, with the practice fixed
 *     on the connection
 *   * `cube_platform_reader` carries BYPASSRLS and is a separate credential,
 *     reachable only through a token carrying platform_admin
 *
 * RUNS THROUGH psql RATHER THAN PRISMA, deliberately. Prisma connects as the
 * application role; the whole question here is what a DIFFERENT role can see,
 * and a test that could not connect as that role would be testing nothing.
 */

/*
 * TWO WAYS IN, because the database is not reached the same way in both places.
 *
 * Locally it is a container and `docker exec` needs no psql on the host. In CI
 * it is a SERVICE: there is no container called `aobplatform-postgres` to exec
 * into, and every test here failed with "No such container" -- invisibly, for
 * as long as the run was dying at typecheck before it ever got this far.
 *
 * The runner does have psql (the workflow initialises the schemas with it) and
 * both environments publish the same host port, so CI connects over TCP. What
 * is asserted does not change: the point is still to connect AS A DIFFERENT
 * ROLE, which is why this goes through psql rather than Prisma at all.
 */
const PG_ARGS = ['psql', '-U', '{role}', '-d', 'aobplatform', '-A', '-t', '-c', '{sql}'];

function psqlArgv(role: string, sql: string): { cmd: string; args: string[] } {
  const base = PG_ARGS.map((a) => a.replace('{role}', role).replace('{sql}', sql));
  if (process.env.CI) return { cmd: base[0], args: ['-h', 'localhost', '-p', '21020', ...base.slice(1)] };
  return { cmd: 'docker', args: ['exec', '-e', `PGPASSWORD=${role}`, 'aobplatform-postgres', ...base] };
}

function psql(role: string, sql: string): string {
  const { cmd, args } = psqlArgv(role, sql);
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, PGPASSWORD: role },
  })
    .trim()
    /*
     * The LAST line, because `SET app.practice_id=...` prints "SET" of its own
     * before the query's answer. Taking the whole output made every count NaN,
     * and `expect(NaN).toBe(0)` fails — which is the lucky direction. Had the
     * assertion been "greater than zero" the isolation tests would have looked
     * like they were passing.
     */
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .pop() ?? '';
}

/*
 * ITS OWN FIXTURES, because reading whatever the database happened to hold was
 * never a test of anything — it was a test that only worked on a machine that
 * had been used.
 *
 * This suite used to pick the two busiest practices and practitioners out of
 * whatever was already there. On a fresh CI database nothing is busiest: the
 * ids came back as empty strings, every query after them failed, and the guard
 * went red for a reason that had nothing to do with tenancy. So the suite now
 * CREATES the two practices and two practitioners it needs. It still READS
 * them back through the database roles rather than trusting these constants,
 * which is what keeps the guard worth having: if the fixtures were ever absent,
 * the ids come back empty and the guard fails exactly as loudly as before.
 *
 * Written through Prisma inside withPractice(), like the rest of the suite
 * family. RLS is fail-closed and FORCEd, so a fixture landing in the wrong
 * practice could not be written at all. Every ASSERTION still goes through
 * psql as a DIFFERENT role — that is the subject of this file and it does not
 * change.
 *
 * Fresh ids per run, deleted afterwards. The database is shared with the other
 * e2e suites, so nothing here assumes these are the only rows, or the busiest
 * ones; the fixtures are found by id.
 */
const fixture = {
  practiceA: randomUUID(),
  practiceB: randomUUID(),
  practitionerA: randomUUID(),
  practitionerB: randomUUID(),
};

let moduleRef: TestingModule;
let prisma: PrismaService;

/** One already-sent message. `sent` keeps the queue worker out of the fixture. */
const fixtureMessage = (practiceId: string, recipientId: string, recipientName: string) => ({
  practiceId,
  channel: 'email',
  destination: 'nobody@example.invalid',
  subjectType: 'ReportingIsolationFixture',
  subjectId: randomUUID(),
  recipientType: 'practitioner',
  recipientId,
  recipientName,
  payload: { note: 'reporting isolation fixture' },
  state: 'sent',
  sentAt: new Date(),
  idempotencyKey: `reporting-isolation:${randomUUID()}`,
});

beforeAll(async () => {
  // ConfigModule alone, so DATABASE_URL is read from .env the way the app reads
  // it. Nothing else of the app is booted; this file only needs to write rows.
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true })],
    providers: [PrismaService],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);

  // Obviously fake people, and no real-format registration numbers.
  for (const [id, name] of [
    [fixture.practitionerA, 'Alpha'],
    [fixture.practitionerB, 'Beta'],
  ] as const) {
    await prisma.practitioner.create({
      data: {
        id,
        ahpraNumber: `RPTISO-${id.slice(0, 8)}`,
        familyName: `Fixture${name}`,
        givenNames: 'Not-Real',
        providerType: 'general_practitioner',
        email: `${name.toLowerCase()}.fixture@example.invalid`,
      },
    });
  }

  // Two practices with messages, addressed to two DIFFERENT practitioners —
  // which is what makes both halves of this file answerable on an empty
  // database. Names are set because one of the assertions is about names
  // never crossing a practice boundary.
  await prisma.withPractice(fixture.practiceA, async (tx) => {
    await tx.practice.create({ data: { id: fixture.practiceA, name: 'Reporting Isolation Fixture A' } });
    await tx.outboundItem.createMany({
      data: [
        fixtureMessage(fixture.practiceA, fixture.practitionerA, 'Not-Real FixtureAlpha'),
        fixtureMessage(fixture.practiceA, fixture.practitionerA, 'Not-Real FixtureAlpha'),
      ],
    });
  });
  await prisma.withPractice(fixture.practiceB, async (tx) => {
    await tx.practice.create({ data: { id: fixture.practiceB, name: 'Reporting Isolation Fixture B' } });
    await tx.outboundItem.createMany({
      data: [
        fixtureMessage(fixture.practiceB, fixture.practitionerB, 'Not-Real FixtureBeta'),
        fixtureMessage(fixture.practiceB, fixture.practitionerB, 'Not-Real FixtureBeta'),
      ],
    });
  });
});

afterAll(async () => {
  // Cleaned up, as the suite family does — the database is shared and serial.
  // deleteMany({}) inside withPractice() removes this practice's rows only;
  // RLS is what makes that safe rather than the empty filter.
  for (const practiceId of [fixture.practiceA, fixture.practiceB]) {
    await prisma?.withPractice(practiceId, async (tx) => {
      await tx.outboundItem.deleteMany({});
      await tx.practice.deleteMany({});
    });
  }
  await prisma?.practitioner.deleteMany({ where: { id: { in: [fixture.practitionerA, fixture.practitionerB] } } });
  await moduleRef?.close();
});

describe('reporting layer tenancy (e2e, real Postgres roles)', () => {
  let myPractice: string;
  let otherPractice: string;

  beforeAll(() => {
    // Found through the platform role, which is the one allowed to look across.
    // By id rather than by row count: other suites' rows may outnumber these,
    // and "whose data is this" was never the interesting question here.
    myPractice = psql(
      'cube_platform_reader',
      `SELECT "practiceId" FROM reporting.outbound_messages WHERE "practiceId"='${fixture.practiceA}' GROUP BY 1`,
    );
    // Asked for separately rather than as "any practice that is not that one":
    // with no fixture the first id is empty, and an empty string is not a uuid
    // Postgres will compare — the guard below should be what goes red, not psql.
    otherPractice = psql(
      'cube_platform_reader',
      `SELECT "practiceId" FROM reporting.outbound_messages WHERE "practiceId"='${fixture.practiceB}' GROUP BY 1`,
    );
  });

  it('has two practices with messages, or this test proves nothing', () => {
    /*
     * Guard, not ceremony. Every assertion below is "X cannot see Y" — and
     * they all pass trivially against an empty database. A green suite that
     * proved nothing is worse than a red one.
     */
    expect(myPractice).toMatch(/^[0-9a-f-]{36}$/);
    expect(otherPractice).toMatch(/^[0-9a-f-]{36}$/);
    expect(otherPractice).not.toBe(myPractice);
  });

  it('shows a scoped reader its own practice, so the positive case is real', () => {
    const visible = psql(
      'cube_reader',
      `SET app.practice_id='${myPractice}'; SELECT count(*) FROM reporting.outbound_messages`,
    );
    expect(Number(visible)).toBeGreaterThan(0);
  });

  it('SHOWS IT NOTHING FROM ANY OTHER PRACTICE', () => {
    const practices = psql(
      'cube_reader',
      `SET app.practice_id='${myPractice}'; SELECT count(DISTINCT "practiceId") FROM reporting.outbound_messages`,
    );
    expect(Number(practices)).toBe(1);

    // Asked for another practice by name, in a session scoped to this one.
    const other = psql(
      'cube_reader',
      `SET app.practice_id='${myPractice}'; ` +
        `SELECT count(*) FROM reporting.outbound_messages WHERE "practiceId"='${otherPractice}'`,
    );
    expect(Number(other)).toBe(0);
  });

  it('refuses a reader with NO practice on its connection', () => {
    // Fail-closed. A connection that forgot to name a practice reads nothing,
    // rather than reading everything.
    const visible = psql('cube_reader', 'SELECT count(*) FROM reporting.outbound_messages');
    expect(Number(visible)).toBe(0);
  });

  it('refuses the same reader going AROUND the view to the tables', () => {
    /*
     * The view is not the boundary; the policies are. Somebody adding a second
     * view later, or Cube being pointed at a table directly, must not be a way
     * through — so the role itself has to be unable to see across practices.
     */
    const other = psql(
      'cube_reader',
      `SET app.practice_id='${myPractice}'; ` +
        `SELECT count(*) FROM core.outbound_items WHERE "practiceId"='${otherPractice}'`,
    );
    expect(Number(other)).toBe(0);
  });

  it('lets the platform credential look across, because that is what it is for', () => {
    const practices = psql(
      'cube_platform_reader',
      'SELECT count(DISTINCT "practiceId") FROM reporting.outbound_messages',
    );
    expect(Number(practices)).toBeGreaterThan(1);
  });

  it('keeps MESSAGE CONTENT and identifiers out of the reporting surface', () => {
    /*
     * Narrowed deliberately, and the history matters. This used to ban any
     * column containing "recipient" or "practitioner" — which was too blunt in
     * both directions. It tripped on `recipientType` (a category, not a person)
     * and it would have banned the recipient NAME, which a practice is entitled
     * to see about its own people and already sees on its affiliations screen.
     *
     * What must stay out is different: message content, and identifiers that
     * mean something outside this practice. A name plus a practice is an
     * employment fact the practice itself publishes. A PROVIDER NUMBER plus a
     * practice is the billing identity the whole regime exists to protect, and
     * it is not here.
     */
    const columns = psql(
      'cube_platform_reader',
      "SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns " +
        "WHERE table_schema='reporting' AND table_name='outbound_messages'",
    ).toLowerCase();

    for (const forbidden of ['providernumber', 'ahpra', 'body', 'payload', 'subject', 'destination', 'medicare']) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it('NEVER lets one practice see another practice’s recipient names', () => {
    /*
     * The assertion that replaces the blunt one. Names being present is a
     * decision; names crossing a practice boundary is not, and never will be.
     *
     * Checked by asking for names in a session scoped to one practice and
     * confirming every row belongs to it — so the guarantee is about the rows
     * returned, not about which columns exist.
     */
    const foreignNames = psql(
      'cube_reader',
      `SET app.practice_id='${myPractice}'; ` +
        `SELECT count(*) FROM reporting.outbound_messages ` +
        `WHERE "recipientName" IS NOT NULL AND "practiceId" <> '${myPractice}'`,
    );
    expect(Number(foreignNames)).toBe(0);

    // And the same question of the raw table, in case a later view is added
    // that forgets the boundary.
    const foreignRaw = psql(
      'cube_reader',
      `SET app.practice_id='${myPractice}'; ` +
        `SELECT count(*) FROM core.outbound_items WHERE "practiceId" <> '${myPractice}'`,
    );
    expect(Number(foreignRaw)).toBe(0);
  });
});

describe('a practitioner reading their own figures (e2e, real Postgres roles)', () => {
  let mine: string;
  let theirs: string;

  beforeAll(() => {
    /*
     * JOINED TO A LIVE PRACTITIONER, not merely present on a message.
     *
     * This used to take whichever recipientId had the most rows. Other suites
     * create practitioners, send to them and delete them again, so the busiest
     * recipient was often somebody who no longer exists — and `my_messages`
     * joins practitioners, so the count came back zero and this test failed
     * for a reason that had nothing to do with isolation.
     *
     * The subject of this test is RLS. Picking a practitioner who is actually
     * there is setup, and setup should not be the thing that breaks.
     *
     * It is now this file's OWN practitioner, and the join stays: it is what
     * proves the fixture is really in the database when the assertions run.
     */
    mine = psql(
      // THE OWNER, for setup only. `cube_platform_reader` cannot read
      // `core.practitioners` at all -- which is the isolation this file exists
      // to prove, so borrowing it here would have been proving the opposite.
      // Every ASSERTION below still runs as the restricted role.
      'aobplatform',
      `SELECT o."recipientId" FROM core.outbound_items o ` +
        `JOIN core.practitioners p ON p.id = o."recipientId" ` +
        `WHERE o."recipientType"='practitioner' AND o."recipientId"='${fixture.practitionerA}' GROUP BY 1`,
    );
    theirs = psql(
      'aobplatform',
      `SELECT o."recipientId" FROM core.outbound_items o ` +
        `JOIN core.practitioners p ON p.id = o."recipientId" ` +
        `WHERE o."recipientType"='practitioner' AND o."recipientId"='${fixture.practitionerB}' GROUP BY 1`,
    );
  });

  it('has two practitioners with messages, or this proves nothing', () => {
    expect(mine).toMatch(/^[0-9a-f-]{36}$/);
    expect(theirs).toMatch(/^[0-9a-f-]{36}$/);
    expect(theirs).not.toBe(mine);
  });

  it('shows a practitioner their own messages', () => {
    /*
     * The positive case, and it is the awkward one. A practitioner is not
     * scoped to a practice — they work at several — so the usual policy has no
     * practice to name and would read nothing. A second policy keyed on
     * `app.practitioner_id` is what makes this answerable at all.
     */
    const count = psql(
      'cube_practitioner_reader',
      `SET app.practitioner_id='${mine}'; SELECT count(*) FROM reporting.my_messages`,
    );
    expect(Number(count)).toBeGreaterThan(0);
  });

  it('SHOWS THEM NOTHING OF ANOTHER PRACTITIONER', () => {
    const others = psql(
      'cube_practitioner_reader',
      `SET app.practitioner_id='${mine}'; ` +
        `SELECT count(*) FROM reporting.my_messages WHERE "practitionerId"='${theirs}'`,
    );
    expect(Number(others)).toBe(0);

    // And every row that IS returned is theirs, which is the stronger form.
    const distinct = psql(
      'cube_practitioner_reader',
      `SET app.practitioner_id='${mine}'; SELECT count(DISTINCT "practitionerId") FROM reporting.my_messages`,
    );
    expect(Number(distinct)).toBe(1);
  });

  it('reads nothing with no practitioner on the connection', () => {
    const count = psql('cube_practitioner_reader', 'SELECT count(*) FROM reporting.my_messages');
    expect(Number(count)).toBe(0);
  });

  it('REFUSES the practice-wide view outright, rather than returning it empty', () => {
    /*
     * A refusal, not an empty answer. "Permission denied" tells a practitioner
     * they asked the wrong question; zero rows would tell them the practice
     * sent nothing, which is a claim about the practice and would be false.
     */
    expect(() =>
      psql('cube_practitioner_reader', `SET app.practitioner_id='${mine}'; SELECT count(*) FROM reporting.outbound_messages`),
    ).toThrow(/permission denied/i);
  });

  it('cannot reach the raw table beyond its own rows', () => {
    // The view is not the boundary; the policy is. Going around it must give
    // the same answer.
    const others = psql(
      'cube_practitioner_reader',
      `SET app.practitioner_id='${mine}'; ` +
        `SELECT count(*) FROM core.outbound_items WHERE "recipientId"='${theirs}'`,
    );
    expect(Number(others)).toBe(0);
  });
});
