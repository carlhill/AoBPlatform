-- The console's own read of an application.
--
-- find_amendable_application() takes the applicant's bearer TOKEN; this takes
-- the practice ID, because the console already knows which practice it is
-- looking at and has no token to present.
--
-- SECURITY DEFINER for the same reason as the rest of this family: a platform
-- or practice administrator working in the console has no app.practice_id set
-- on the connection, so RLS would filter this to zero rows and the page would
-- report "no such application" for every application that exists.
--
-- Identical projection to the token version. Deliberately so: two functions
-- returning different subsets of the same row is how one of them quietly
-- becomes the one that leaks.
DROP FUNCTION IF EXISTS find_application_by_id(uuid);

CREATE FUNCTION find_application_by_id(p_practice uuid)
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
    FROM "practices" p
   WHERE p."id" = p_practice
   LIMIT 1;
$fn$ LANGUAGE sql SECURITY DEFINER STABLE;
