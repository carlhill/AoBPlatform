-- Applicant amendments to a pending application.
--
-- An applicant who mistypes their own phone number should not have to be
-- rejected and reapply. But an edit to a submitted application changes the
-- EVIDENCE, so it is appended and never applied over the top of what came
-- before.
--
-- The reviewer's dossier tells them these values are "as submitted". That has
-- to stay true. If an applicant could overwrite a value, a check recorded
-- against it would silently come to attest to something else -- which is
-- exactly the sequence worth worrying about: submit clean, wait for the check
-- to pass, then change the value that was verified.

CREATE TABLE IF NOT EXISTS "application_amendments" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId"     uuid NOT NULL,
  "field"          text NOT NULL,
  "valueBefore"    text,
  "valueAfter"     text,
  "amendedAt"      timestamptz NOT NULL DEFAULT now(),
  -- The applicant as the application knows them. Not a session: an applicant
  -- holds a bearer token, not an account, until they are approved and enrol a
  -- passkey.
  "amendedByName"  text NOT NULL,
  "amendedByEmail" text NOT NULL,
  -- Which already-recorded checks this amendment bears on, computed at the
  -- time of the amendment. Stored rather than derived later, because the
  -- field-to-check mapping is versioned with the catalogue and the answer must
  -- be the one that was true when the change was made.
  "affectedChecks" text[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS "application_amendments_practice_idx"
  ON "application_amendments" ("practiceId", "amendedAt");

-- Append-only, enforced rather than assumed. Same shape as the
-- enrolment-ceremony and practice-check guards (REQ-PKI-01).
CREATE OR REPLACE FUNCTION prevent_amendment_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION
    'Application amendments are append-only evidence and cannot be %. A correction is a further amendment.',
    lower(TG_OP);
END;
$fn$;

DROP TRIGGER IF EXISTS amendments_no_update ON "application_amendments";
CREATE TRIGGER amendments_no_update BEFORE UPDATE ON "application_amendments"
  FOR EACH ROW EXECUTE FUNCTION prevent_amendment_rewrite();

DROP TRIGGER IF EXISTS amendments_no_delete ON "application_amendments";
CREATE TRIGGER amendments_no_delete BEFORE DELETE ON "application_amendments"
  FOR EACH ROW EXECUTE FUNCTION prevent_amendment_rewrite();

ALTER TABLE "application_amendments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_amendments" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS amendments_tenant ON "application_amendments";
CREATE POLICY amendments_tenant ON "application_amendments"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

-- Cheap markers so the queue can flag an amended application without a join.
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "amendedAt" timestamptz;
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "amendmentCount" integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- The applicant's own view, and the write.
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER for the same reason as every other pre-tenant function: the
-- caller is an applicant with no session and no practice context, so RLS would
-- filter every row and the page would report "no such application" for all of
-- them -- the silent-invalidation failure this codebase exists to avoid.
--
-- The projection IS the security boundary. It returns what the applicant
-- themselves submitted plus the register values already on their confirmation
-- screen. It does NOT return the reviewer's note, who is reviewing, the
-- checklist, any check outcome, or the identity score.

CREATE OR REPLACE FUNCTION find_amendable_application(p_token text)
RETURNS TABLE (
  id uuid,
  name text,
  abn text,
  "legalName" text,
  "entityType" text,
  "abnStatus" text,
  "validationState" text,
  website text,
  "adminName" text,
  "adminEmail" text,
  "adminPhone" text,
  "adminPosition" text,
  "managerName" text,
  "managerEmail" text,
  "managerPhone" text,
  "managerPosition" text,
  "headOfficeLine1" text,
  "headOfficeLine2" text,
  "headOfficeSuburb" text,
  "headOfficeState" text,
  "headOfficePostcode" text,
  "statedPractitionerCount" integer,
  "amendmentCount" integer,
  "createdAt" timestamptz
) AS $fn$
  SELECT p."id", p."name", p."abn", p."legalName", p."entityType", p."abnStatus", p."validationState",
         p."website", p."adminName", p."adminEmail", p."adminPhone", p."adminPosition",
         p."managerName", p."managerEmail", p."managerPhone", p."managerPosition",
         p."headOfficeLine1", p."headOfficeLine2", p."headOfficeSuburb", p."headOfficeState",
         p."headOfficePostcode", p."statedPractitionerCount", p."amendmentCount", p."createdAt"
    FROM "practices" p
   WHERE p."statusToken" = p_token
   LIMIT 1;
$fn$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Which checks have been recorded. KEYS ONLY -- not outcomes, not notes, not
-- who performed them. An applicant learning that a check failed, and why, is
-- learning how to pass it next time.
CREATE OR REPLACE FUNCTION recorded_check_keys(p_practice uuid)
RETURNS TABLE ("checkKey" text) AS $fn$
  SELECT DISTINCT c."checkKey" FROM "practice_checks" c WHERE c."practiceId" = p_practice;
$fn$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION record_amendment(
  p_practice uuid,
  p_field text,
  p_before text,
  p_after text,
  p_by_name text,
  p_by_email text,
  p_affected text[]
) RETURNS uuid AS $fn$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO "application_amendments"
    ("practiceId", "field", "valueBefore", "valueAfter", "amendedByName", "amendedByEmail", "affectedChecks")
  VALUES (p_practice, p_field, p_before, p_after, p_by_name, p_by_email, COALESCE(p_affected, '{}'))
  RETURNING "id" INTO v_id;
  RETURN v_id;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

-- The write. The parameter list IS the allow-list, and it contains no ABN:
-- every check runs against one legal entity, so a different ABN is a different
-- application, not a correction to this one.
CREATE OR REPLACE FUNCTION apply_amendment(
  p_practice uuid,
  p_name text,
  p_website text,
  p_admin_name text,
  p_admin_email text,
  p_admin_phone text,
  p_admin_position text,
  p_manager_name text,
  p_manager_email text,
  p_manager_phone text,
  p_manager_position text,
  p_line1 text,
  p_line2 text,
  p_suburb text,
  p_state text,
  p_postcode text,
  p_practitioner_count integer
) RETURNS void AS $fn$
  UPDATE "practices" SET
    "name"                    = COALESCE(p_name, "name"),
    "website"                 = COALESCE(p_website, "website"),
    "adminName"               = COALESCE(p_admin_name, "adminName"),
    "adminEmail"              = COALESCE(p_admin_email, "adminEmail"),
    "adminPhone"              = COALESCE(p_admin_phone, "adminPhone"),
    "adminPosition"           = COALESCE(p_admin_position, "adminPosition"),
    "managerName"             = COALESCE(p_manager_name, "managerName"),
    "managerEmail"            = COALESCE(p_manager_email, "managerEmail"),
    "managerPhone"            = COALESCE(p_manager_phone, "managerPhone"),
    "managerPosition"         = COALESCE(p_manager_position, "managerPosition"),
    "headOfficeLine1"         = COALESCE(p_line1, "headOfficeLine1"),
    "headOfficeLine2"         = COALESCE(p_line2, "headOfficeLine2"),
    "headOfficeSuburb"        = COALESCE(p_suburb, "headOfficeSuburb"),
    "headOfficeState"         = COALESCE(p_state, "headOfficeState"),
    "headOfficePostcode"      = COALESCE(p_postcode, "headOfficePostcode"),
    "statedPractitionerCount" = COALESCE(p_practitioner_count, "statedPractitionerCount"),
    "amendedAt"               = now(),
    "amendmentCount"          = "amendmentCount" + 1
  WHERE "id" = p_practice;
$fn$ LANGUAGE sql SECURITY DEFINER;
