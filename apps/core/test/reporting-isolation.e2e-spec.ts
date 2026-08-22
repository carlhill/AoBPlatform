import { execFileSync } from 'node:child_process';

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

function psql(role: string, sql: string): string {
  return execFileSync(
    'docker',
    [
      'exec',
      '-e',
      `PGPASSWORD=${role}`,
      'aobplatform-postgres',
      'psql',
      '-U',
      role,
      '-d',
      'aobplatform',
      '-A',
      '-t',
      '-c',
      sql,
    ],
    { encoding: 'utf8', timeout: 30_000 },
  )
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

describe('reporting layer tenancy (e2e, real Postgres roles)', () => {
  let busiestPractice: string;
  let otherPractice: string;

  beforeAll(() => {
    // Found through the platform role, which is the one allowed to look across.
    busiestPractice = psql(
      'cube_platform_reader',
      'SELECT "practiceId" FROM reporting.outbound_messages GROUP BY 1 ORDER BY count(*) DESC LIMIT 1',
    );
    otherPractice = psql(
      'cube_platform_reader',
      `SELECT "practiceId" FROM reporting.outbound_messages WHERE "practiceId" <> '${busiestPractice}' LIMIT 1`,
    );
  });

  it('has two practices with messages, or this test proves nothing', () => {
    /*
     * Guard, not ceremony. Every assertion below is "X cannot see Y" — and
     * they all pass trivially against an empty database. A green suite that
     * proved nothing is worse than a red one.
     */
    expect(busiestPractice).toMatch(/^[0-9a-f-]{36}$/);
    expect(otherPractice).toMatch(/^[0-9a-f-]{36}$/);
    expect(otherPractice).not.toBe(busiestPractice);
  });

  it('shows a scoped reader its own practice, so the positive case is real', () => {
    const visible = psql(
      'cube_reader',
      `SET app.practice_id='${busiestPractice}'; SELECT count(*) FROM reporting.outbound_messages`,
    );
    expect(Number(visible)).toBeGreaterThan(0);
  });

  it('SHOWS IT NOTHING FROM ANY OTHER PRACTICE', () => {
    const practices = psql(
      'cube_reader',
      `SET app.practice_id='${busiestPractice}'; SELECT count(DISTINCT "practiceId") FROM reporting.outbound_messages`,
    );
    expect(Number(practices)).toBe(1);

    // Asked for another practice by name, in a session scoped to this one.
    const other = psql(
      'cube_reader',
      `SET app.practice_id='${busiestPractice}'; ` +
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
      `SET app.practice_id='${busiestPractice}'; ` +
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

  it('keeps names and message content out of the reporting surface entirely', () => {
    /*
     * The third layer, and the only one that still holds if the other two fail:
     * bound what could leak, not just who can reach it. A query engine roaming
     * over counts is a different proposition from one roaming over recipients.
     */
    const columns = psql(
      'cube_platform_reader',
      "SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns " +
        "WHERE table_schema='reporting' AND table_name='outbound_messages'",
    );

    for (const forbidden of ['recipient', 'body', 'payload', 'subject', 'patient', 'practitioner', 'provider']) {
      expect(columns.toLowerCase()).not.toContain(forbidden);
    }
  });
});
