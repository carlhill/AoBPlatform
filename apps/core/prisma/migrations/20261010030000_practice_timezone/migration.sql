-- THE ZONE A PRACTICE'S DAY IS MEASURED IN (D-2026-10-10-03, Carl: "per-practice
-- timezone, do it now on its own branch").
--
-- WHY. The desk worked out "today" two ways -- the UTC date and the server's
-- local midnight -- and in Sydney under daylight saving the UTC date is still
-- yesterday until 11am. Every morning today's appointment-linked agreements were
-- missing from the desk and yesterday's showed as today's. Production runs on
-- UTC, so it was not a development-only fault. The fix is a zone per practice,
-- read once per request, and every desk day boundary measured in it.
--
-- AN IANA NAME, NEVER AN OFFSET (D-2026-09-12-17). `+10:00` is right until
-- daylight saving moves; `Australia/Sydney` is right all year.
--
-- NOT NULL DEFAULT 'Australia/Sydney'. "No zone" must never mean UTC, which is
-- the defect this replaces; Sydney is the platform's one zone today
-- (`REPORT_TIMEZONE`), so every existing practice keeps exactly the day it is
-- meant to have.
--
-- THE CHECK COPIES THE CONTENT LIST (wow.md section 2 item 7). Its source is
-- `packages/domain/content/practice-timezones.json` at version
-- practice-timezones-2026-10-1, read in code through `PRACTICE_TIMEZONE_KEYS`;
-- `src/practices/practice-timezone-check.spec.ts` fails when the two disagree.
-- Adding a zone is an edit there AND a migration that widens this.
--
-- NOTHING MOVES. Every existing row takes the default.
--
-- Idempotent (DEV-LOOP.md): the column is added IF NOT EXISTS and the
-- constraint dropped before it is added, so a second run lands on the same
-- definition rather than failing.
-- Reversible:
--   ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS "practices_timezone_check";
--   ALTER TABLE "practices" DROP COLUMN IF EXISTS "timezone";
-- -- which loses each practice's choice and returns the desk to the server's
-- clock, i.e. reintroduces the morning defect. Stored timestamps are instants
-- and are untouched either way.
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'Australia/Sydney';

ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS "practices_timezone_check";
ALTER TABLE "practices" ADD CONSTRAINT "practices_timezone_check"
  CHECK ("timezone" IN (
    'Australia/Sydney',
    'Australia/Melbourne',
    'Australia/Brisbane',
    'Australia/Adelaide',
    'Australia/Darwin',
    'Australia/Perth',
    'Australia/Hobart',
    'Australia/Broken_Hill',
    'Australia/Lindeman',
    'Australia/Eucla',
    'Australia/Lord_Howe'
  ));
