-- The queue must project what the queue's flags read.
--
-- adminEmailVerifiedAt was set correctly, stored correctly, and shown nowhere:
-- the reviewer's "email not confirmed" flag stayed up on an application whose
-- address HAD been confirmed, because the SECURITY DEFINER projection feeding
-- the queue did not return the column. The value existed in every layer except
-- the one that reads it.
--
-- This is the same failure CONVENTIONS.md §9a exists to prevent, arriving by a
-- route the checklist did not cover: the field reached the screen, and then a
-- LATER field was added without revisiting the projection. Adding a column that
-- a flag depends on now means checking this function.
--
-- Also adds the amendment markers, so the queue can flag an application the
-- applicant has changed since it was submitted.

DROP FUNCTION IF EXISTS list_pending_organisations();

CREATE FUNCTION list_pending_organisations()
RETURNS TABLE (
  id uuid, name text, abn text, acn text, "legalName" text,
  "tradingNames" text[], "entityType" text, "abnStatus" text,
  "nameMatchTier" text, "nameMatchedOn" text, "createdAt" timestamp(3),
  "abnVerificationSource" text, "abnSightedByName" text,
  "adminName" text, "adminEmail" text, "adminPhone" text, "adminPosition" text,
  "managerName" text, "managerEmail" text, "managerPhone" text, "managerPosition" text,
  website text, "headOfficeAddress" text, "headOfficeState" text,
  "credentialType" text, "credentialValue" text,
  "adminEmailVerifiedAt" timestamptz,
  "amendedAt" timestamptz, "amendmentCount" integer,
  "correctionExpiresAt" timestamptz
) AS $$
  SELECT p."id", p."name", p."abn", p."acn", p."legalName", p."tradingNames",
         p."entityType", p."abnStatus", p."nameMatchTier", p."nameMatchedOn", p."createdAt",
         p."abnVerificationSource", p."abnSightedByName",
         p."adminName", p."adminEmail", p."adminPhone", p."adminPosition",
         p."managerName", p."managerEmail", p."managerPhone", p."managerPosition",
         p."website", p."headOfficeAddress", p."headOfficeState",
         p."credentialType", p."credentialValue",
         p."adminEmailVerifiedAt",
         p."amendedAt", p."amendmentCount",
         p."correctionExpiresAt"
  FROM "practices" p
  WHERE p."validationState" = 'pending'
    AND p."abnVerifiedAt" IS NOT NULL
  ORDER BY p."createdAt" ASC;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION list_pending_organisations() TO aob_app;
