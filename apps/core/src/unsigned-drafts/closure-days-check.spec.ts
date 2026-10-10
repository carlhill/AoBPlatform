import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  UNSIGNED_DRAFT_CLOSURE_MAX_DAYS,
  UNSIGNED_DRAFT_CLOSURE_MIN_DAYS,
  UNSIGNED_DRAFT_CLOSURE_VERSION,
} from '@aobplatform/domain';

/**
 * THE DATABASE CHECK ON `practices.unsignedDraftClosureDays` IS A COPY OF THE
 * CONTENT'S BOUNDS, AND THIS TEST IS WHAT KEEPS IT ONE (review of
 * D-2026-10-10-09, finding 6; wow.md §2 item 7).
 *
 * WHY THE CHECK STAYS RATHER THAN BEING DROPPED. The DTO is the boundary for
 * requests; the CHECK is the boundary for everything else (a script, a seed,
 * a future endpoint that forgets the DTO), and the sweep would silently fall
 * back to the default for an out-of-range value. SQL cannot read the JSON, so
 * the CHECK carries literals, and this test fails the moment the content's
 * `minDays`/`maxDays` and the LATEST migration defining the constraint
 * disagree. Changing the bounds is then a content edit AND a new migration.
 * A content edit that leaves the bounds alone (a version bump) passes.
 */
const CONSTRAINT = 'practices_unsigned_draft_closure_days_range';

/**
 * The bounds the LATEST migration that adds the constraint gives it. A
 * migration that names the constraint in an ADD CONSTRAINT this cannot parse
 * is a loud failure, never a silent skip: an unparsed definition would let
 * the literals drift unseen.
 */
export function latestCheckBounds(migrations: readonly { name: string; sql: string }[]): { min: number; max: number } {
  let latest: { min: number; max: number } | null = null;
  for (const { name, sql } of migrations) {
    const adds = [...sql.matchAll(new RegExp(`ADD CONSTRAINT "${CONSTRAINT}"([\\s\\S]*?);`, 'g'))];
    for (const add of adds) {
      const bounds = /BETWEEN\s+(\d+)\s+AND\s+(\d+)/.exec(add[1]!);
      if (!bounds) {
        throw new Error(
          `Migration ${name} adds ${CONSTRAINT} in a form this test cannot read. Write it as ` +
            '"BETWEEN <min> AND <max>", or teach this test the new form; never leave it unchecked.',
        );
      }
      latest = { min: Number(bounds[1]), max: Number(bounds[2]) };
    }
  }
  if (!latest) throw new Error(`No migration adds ${CONSTRAINT}.`);
  return latest;
}

describe('the closure-days CHECK matches the versioned content', () => {
  it('closure_days_db_check_equals_the_content_bounds', () => {
    const root = join(__dirname, '..', '..', 'prisma', 'migrations');
    const migrations = readdirSync(root)
      .sort()
      .flatMap((name) => {
        try {
          return [{ name, sql: readFileSync(join(root, name, 'migration.sql'), 'utf8') }];
        } catch {
          return [];
        }
      });
    const db = latestCheckBounds(migrations);
    if (db.min !== UNSIGNED_DRAFT_CLOSURE_MIN_DAYS || db.max !== UNSIGNED_DRAFT_CLOSURE_MAX_DAYS) {
      throw new Error(
        `${CONSTRAINT} allows ${db.min}..${db.max} but content ${UNSIGNED_DRAFT_CLOSURE_VERSION} says ` +
          `${UNSIGNED_DRAFT_CLOSURE_MIN_DAYS}..${UNSIGNED_DRAFT_CLOSURE_MAX_DAYS}. Add a migration that moves the CHECK.`,
      );
    }
  });

  it('a_migration_naming_the_constraint_in_an_unreadable_form_fails_loudly', () => {
    expect(() =>
      latestCheckBounds([
        { name: 'a', sql: `ADD CONSTRAINT "${CONSTRAINT}" CHECK ("x" BETWEEN 1 AND 90);` },
        { name: 'b_unreadable', sql: `ADD CONSTRAINT "${CONSTRAINT}" CHECK ("x" >= 1 AND "x" <= 60);` },
      ]),
    ).toThrow(/b_unreadable/);
  });

  it('the_latest_readable_definition_wins', () => {
    expect(
      latestCheckBounds([
        { name: 'a', sql: `ADD CONSTRAINT "${CONSTRAINT}" CHECK ("x" BETWEEN 1 AND 90);` },
        { name: 'b', sql: `ALTER TABLE t ADD CONSTRAINT "${CONSTRAINT}" CHECK ("x" IS NULL OR "x" BETWEEN 2 AND 60);` },
      ]),
    ).toEqual({ min: 2, max: 60 });
  });
});
