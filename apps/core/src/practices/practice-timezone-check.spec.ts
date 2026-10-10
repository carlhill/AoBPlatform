import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PRACTICE_TIMEZONE_KEYS } from '@aobplatform/domain';

/**
 * THE DATABASE MUST ACCEPT EXACTLY THE ZONES THE CONTENT FILE OFFERS
 * (D-2026-10-10-03; wow.md §2 item 7).
 *
 * `practices.timezone` carries a CHECK copying
 * `packages/domain/content/practice-timezones.json`. A zone added to the file
 * and not to the CHECK is a select option the save refuses with a 500; a zone
 * left in the CHECK after leaving the file is a value the console cannot show.
 *
 * Same shape as `artefact-purposes.spec.ts`: it reads the MIGRATIONS, not the
 * database, so it runs without Postgres, and the last migration to define the
 * constraint wins because each drops and recreates it.
 */
const MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');

function zonesInTheLastMigrationThatDefinesThem(): string[] {
  const dirs = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  let found: string[] | null = null;
  for (const dir of dirs) {
    let sql: string;
    try {
      sql = readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
    } catch {
      continue;
    }
    const match = /ADD CONSTRAINT "practices_timezone_check"\s*CHECK\s*\(\s*"timezone"\s+IN\s*\(([\s\S]*?)\)\s*\)/i.exec(sql);
    if (!match) continue;
    found = [...match[1].matchAll(/'([A-Za-z_/]+)'/g)].map((m) => m[1]);
  }

  if (!found) throw new Error(`No migration under ${MIGRATIONS} defines practices_timezone_check.`);
  return found;
}

describe('the practice timezone list is the same list in both places', () => {
  it('practice_timezone_check_matches_the_content_list', () => {
    expect(zonesInTheLastMigrationThatDefinesThem()).toEqual([...PRACTICE_TIMEZONE_KEYS]);
  });
});
