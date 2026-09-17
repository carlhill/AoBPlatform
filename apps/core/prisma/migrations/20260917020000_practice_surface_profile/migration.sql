-- WHICH PARTS OF AoB A PRACTICE USES (D-2026-09-14-04: "the first customer
-- sees the DB4 path and nothing else: no waiting-room kiosk walk-up, no
-- ongoing agreements, no queue rails, no portal, no practitioner pages. Those
-- stay built and stay off. Turning one on for a practice is a flag, never a
-- rebuild.").
--
-- IT IS A PERMISSION, WHICH THE TWO SETTINGS BESIDE IT ARE NOT.
-- `usesQueueTickets` and `enduringByDefault` both say in their own comments
-- that they gate nothing. This one gates: the console hides a surface that is
-- off AND the server refuses its endpoints. A setting that only hid things
-- would be a setting that lies.
--
-- NOT "posture": D-2026-09-12-14 already uses "practice posture" for
-- integration modes, and the collision would be read as the same thing.
--
-- DEFAULT 'full', SO THIS IS A NO-OP FOR EVERY PRACTICE THAT EXISTS. Nothing
-- changes for anybody until somebody sets a profile; `full` holds every
-- declared surface, and the domain loader refuses a content file in which it
-- does not, so a surface added later cannot switch itself off platform-wide.
--
-- Idempotent (DEV-LOOP.md): a migration that only works once passes in
-- development and then breaks `prisma migrate deploy` on the next start.
-- Reversible by
--   ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS "practices_surface_profile_check";
--   ALTER TABLE "practices" DROP COLUMN IF EXISTS "surfaceProfile";
-- -- the column is new, nothing read it before this migration, and its default
-- is today's behaviour exactly (every surface on, everywhere).
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "surfaceProfile" TEXT NOT NULL DEFAULT 'full';

-- THE CHECK IS DERIVED FROM THE DOMAIN LIST, not from a second literal
-- somebody has to remember to keep in step: these are the `profiles` keys of
-- `packages/domain/content/practice-surfaces.json`, read through
-- `SURFACE_PROFILE_KEYS`. A third profile is a content change AND a migration,
-- deliberately — the database is the last place that can stop a value nobody
-- wrote code for (the same rule the visit-state, copy-link and queue-ticket
-- CHECKs follow).
--
-- AND THE DOMAIN STILL FAILS SAFE IF THE TWO EVER PART. An unrecognised
-- profile grants the `always` surfaces and nothing more, so a practice on one
-- can still sign in, be configured and record what happened — it does not
-- become a practice nobody can help.
ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS "practices_surface_profile_check";
ALTER TABLE "practices" ADD CONSTRAINT "practices_surface_profile_check"
  CHECK ("surfaceProfile" IN ('full', 'db4'));
