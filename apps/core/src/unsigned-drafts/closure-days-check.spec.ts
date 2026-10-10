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
 */
describe('the closure-days CHECK matches the versioned content', () => {
  it('closure_days_db_check_equals_the_content_bounds', () => {
    const root = join(__dirname, '..', '..', 'prisma', 'migrations');
    const definitions = readdirSync(root)
      .sort()
      .map((dir) => {
        try {
          return readFileSync(join(root, dir, 'migration.sql'), 'utf8');
        } catch {
          return '';
        }
      })
      .flatMap((sql) => [
        ...sql.matchAll(
          /ADD CONSTRAINT "practices_unsigned_draft_closure_days_range"[\s\S]*?BETWEEN\s+(\d+)\s+AND\s+(\d+)/g,
        ),
      ]);
    expect(definitions.length).toBeGreaterThan(0);
    const latest = definitions[definitions.length - 1]!;
    expect({ min: Number(latest[1]), max: Number(latest[2]) }).toEqual({
      min: UNSIGNED_DRAFT_CLOSURE_MIN_DAYS,
      max: UNSIGNED_DRAFT_CLOSURE_MAX_DAYS,
    });
    // Named so a failure says which content version the CHECK was written against.
    expect(UNSIGNED_DRAFT_CLOSURE_VERSION).toBe('unsigned-draft-closure-2026-10-1');
  });
});
