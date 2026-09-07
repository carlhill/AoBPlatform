-- A time-boxed correction window.
--
-- The status token is long-lived on purpose: an applicant should be able to
-- check where their application has got to for as long as it is open. The
-- right to CHANGE the application is a different privilege and should not
-- inherit that lifetime.
--
-- Without a window, the correction link is a standing credential sitting in an
-- inbox indefinitely — forwarded, archived, searchable, and still live months
-- later when the person who received it has left the practice. Five days is
-- long enough to act on and short enough that a stale copy is worthless.
--
-- The window OPENS when a reviewer asks for a correction, rather than at
-- submission. That makes it a deliberate, attributable act — somebody decided
-- this application needs fixing and said so — and it means the clock does not
-- run down while an application sits in a queue nobody has reached yet.

ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "correctionRequestedAt" timestamptz;
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "correctionExpiresAt" timestamptz;
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "correctionRequestedByName" text;
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "correctionReason" text;

-- Open the window. SECURITY DEFINER because the caller is a reviewer, and the
-- console is cross-tenant by definition — there is no app.practice_id to
-- satisfy RLS with.
--
-- Re-requesting RESTARTS the window rather than extending it, and overwrites
-- the reason. An applicant who was asked twice should be acting on the second
-- request, not on whichever of the two they happen to open.
CREATE OR REPLACE FUNCTION open_correction_window(
  p_practice uuid,
  p_days integer,
  p_by_name text,
  p_reason text
) RETURNS TABLE ("statusToken" text, "correctionExpiresAt" timestamptz) AS $fn$
  UPDATE "practices" SET
    "correctionRequestedAt"     = now(),
    "correctionExpiresAt"       = now() + (p_days || ' days')::interval,
    "correctionRequestedByName" = p_by_name,
    "correctionReason"          = p_reason
  WHERE "id" = p_practice
    -- Only an application still waiting on a person. A decided one is closed,
    -- and opening a correction window on it would offer the applicant an edit
    -- that the amendment rules will then refuse — a link that leads to a wall.
    AND "validationState" = 'pending'
  RETURNING "statusToken", "correctionExpiresAt";
$fn$ LANGUAGE sql SECURITY DEFINER;

-- The applicant's view must carry the window too, so the service can refuse an
-- expired link and the page can say when it closes rather than failing at the
-- moment somebody presses Send.
--
-- DROP first: Postgres will not change a function's OUT-parameter row type in
-- place, and CREATE OR REPLACE fails with "cannot change return type".
DROP FUNCTION IF EXISTS find_amendable_application(text);

CREATE FUNCTION find_amendable_application(p_token text)
RETURNS TABLE (
  id uuid, name text, abn text, "legalName" text, "entityType" text, "abnStatus" text,
  "validationState" text, website text,
  "adminName" text, "adminEmail" text, "adminPhone" text, "adminPosition" text,
  "managerName" text, "managerEmail" text, "managerPhone" text, "managerPosition" text,
  "headOfficeLine1" text, "headOfficeLine2" text, "headOfficeSuburb" text, "headOfficeState" text,
  "headOfficePostcode" text, "statedPractitionerCount" integer, "amendmentCount" integer,
  "createdAt" timestamptz,
  "correctionExpiresAt" timestamptz, "correctionRequestedByName" text, "correctionReason" text
) AS $fn$
  SELECT p."id", p."name", p."abn", p."legalName", p."entityType", p."abnStatus", p."validationState",
         p."website", p."adminName", p."adminEmail", p."adminPhone", p."adminPosition",
         p."managerName", p."managerEmail", p."managerPhone", p."managerPosition",
         p."headOfficeLine1", p."headOfficeLine2", p."headOfficeSuburb", p."headOfficeState",
         p."headOfficePostcode", p."statedPractitionerCount", p."amendmentCount", p."createdAt",
         p."correctionExpiresAt", p."correctionRequestedByName", p."correctionReason"
    FROM "practices" p WHERE p."statusToken" = p_token LIMIT 1;
$fn$ LANGUAGE sql SECURITY DEFINER STABLE;
