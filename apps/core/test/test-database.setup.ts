/**
 * E2E NEVER RUNS AGAINST THE DEV DATABASE (Carl, 11 Sep 2026).
 *
 * WHAT WENT WRONG WITHOUT THIS. `jest.e2e.config.js` set no database of its
 * own and nothing in `test/` overrode one, so every suite connected to
 * `apps/core/.env` — the same `aobplatform` database the running dev app uses
 * and the same one Carl seeds to test against. The suites are not gentle with
 * it: unfiltered `deleteMany({})` calls empty patient, agreement, assignor,
 * provider, practice, arrival and more, and a few specs issue raw
 * `DELETE FROM` at the portal tables. One run therefore destroyed a morning of
 * seeded queue rows. It was caught before it happened, on 11 Sep, only because
 * somebody checked the config before pressing go.
 *
 * SO THE SUITE POINTS SOMEWHERE ELSE, and does it here rather than in a file
 * a developer has to remember to source. `ConfigModule` merges `.env` into
 * `process.env` with "only if not already present" (see `offline-abr.setup.ts`
 * for the same trick), so a value set before any suite builds a Nest
 * application is the value the application gets.
 *
 * THE DATABASE IS CREATED OUT OF BAND, by `scripts/dev/test-db.sh`, as a schema
 * copy of dev. A copy rather than `migrate deploy` because the dev migration
 * ledger still carries the failed `20260903020000_chase_attempts` (TODO), and a
 * broken ledger must not be the reason nobody can run a test.
 */
const DEFAULT_TEST_URL = 'postgresql://aobplatform:aobplatform@127.0.0.1:21020/aobplatform_test?schema=core';

/*
 * AN OVERRIDE IS ALLOWED — CI will have its own — but it is checked, because
 * the whole point of this file is that a wrong value here is measured in lost
 * work rather than a failed assertion.
 */
const url = process.env.E2E_DATABASE_URL ?? DEFAULT_TEST_URL;

/**
 * THE GUARD IS THE POINT, not the default. A test database that happens to be
 * named right is not proof; a name that is plainly the dev one is proof of the
 * opposite, and the run stops before a single `deleteMany` reaches it.
 */
const databaseName = url.split('/').pop()?.split('?')[0] ?? '';
if (!databaseName.endsWith('_test')) {
  throw new Error(
    `E2E refuses to run against "${databaseName}": the e2e suites empty whole tables, `
      + 'so the database name must end in "_test". Create one with scripts/dev/test-db.sh, '
      + 'or set E2E_DATABASE_URL to a database you are willing to lose.',
  );
}

process.env.DATABASE_URL = url;
