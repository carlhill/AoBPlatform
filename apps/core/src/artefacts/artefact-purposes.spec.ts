import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ARTEFACT_PURPOSES } from '@aobplatform/domain';

/**
 * THE DATABASE MUST BELIEVE WHAT THE DOMAIN BELIEVES — a structural check,
 * written the third time the two parted company.
 *
 * `artefacts.purpose` carries a CHECK constraint listing the allowed values,
 * and `ARTEFACT_PURPOSES` in `packages/domain/src/artefact.ts` is the same
 * list in TypeScript. They are maintained by hand in two places, and the
 * migration that last recreated the CHECK said so in its own comment:
 * *"Adding a purpose in TypeScript and not here means the code believes in
 * something the database refuses, and it is discovered as a 500 at the moment
 * somebody uploads."* It had already happened twice when that was written.
 *
 * THE THIRD TIME WOULD NOT HAVE BEEN A 500, WHICH IS WHY THIS EXISTS NOW.
 * `signed_db4` is written by a path that is deliberately allowed to fail
 * quietly — the Signed-DB4 is produced after the signature has committed and
 * nothing it does may block care (hard rule 8) — so a CHECK violation would
 * have rolled the artefact back, logged one line, and left every practice
 * signing DB4s with no form in the chart folder and nothing failing loudly.
 * A guard that fails at the bench beats a silence in production.
 *
 * IT READS THE MIGRATIONS RATHER THAN THE DATABASE, on purpose: this is a unit
 * test and must run without Postgres, and the migrations are what any database
 * will eventually be. The LAST migration to mention the constraint wins,
 * because they are applied in name order and each one drops and recreates it.
 */
const MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');

function purposesInTheLastMigrationThatDefinesThem(): string[] {
  const files = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  let found: string[] | null = null;
  let source = '';
  for (const dir of files) {
    let sql: string;
    try {
      sql = readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
    } catch {
      continue;
    }
    const match = /ADD CONSTRAINT artefacts_purpose_known\s*\r?\n?\s*CHECK\s*\(\s*"purpose"\s+IN\s*\(([\s\S]*?)\)\s*\)/i.exec(
      sql,
    );
    if (!match) continue;
    found = [...match[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    source = dir;
  }

  if (!found) throw new Error(`No migration under ${MIGRATIONS} defines artefacts_purpose_known.`);
  expect(source).not.toHaveLength(0);
  return found;
}

describe('the artefact purpose allowlist is the same list in both places', () => {
  it('every purpose the domain allows is one the database will accept', () => {
    const inDatabase = purposesInTheLastMigrationThatDefinesThem();
    // Same members, and the order is the domain's, so the diff on a failure
    // names the purpose somebody forgot rather than showing two shuffled lists.
    expect([...inDatabase].sort()).toEqual([...ARTEFACT_PURPOSES].sort());
  });

  it('and the database accepts nothing the domain does not know about', () => {
    const inDatabase = purposesInTheLastMigrationThatDefinesThem();
    for (const purpose of inDatabase) {
      expect(ARTEFACT_PURPOSES as readonly string[]).toContain(purpose);
    }
  });

  /**
   * NAMED, so the next reader knows this file is the reason the Signed-DB4
   * can be stored at all.
   */
  it('signed_db4 is in both', () => {
    expect(ARTEFACT_PURPOSES as readonly string[]).toContain('signed_db4');
    expect(purposesInTheLastMigrationThatDefinesThem()).toContain('signed_db4');
  });
});
