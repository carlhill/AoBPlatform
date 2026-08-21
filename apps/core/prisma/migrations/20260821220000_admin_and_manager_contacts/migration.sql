-- The applicant AND their manager, each with a position and personal contact
-- details.
--
-- This is the anti-fraud surface, and it is cheap to state and expensive to
-- fake. One applicant with one throwaway email costs an attacker nothing. Two
-- named people, in stated positions, each independently reachable, is a much
-- harder fabrication — and, more usefully, it gives the reviewer a SECOND
-- PERSON TO CALL who is not the person who applied. That is the only kind of
-- callback that verifies anything: a check whose subject did not choose the
-- number.
--
-- The manager block is optional at the database layer because a sole trader
-- genuinely has no manager. Whether to REQUIRE it for larger entity types is a
-- product decision, not a schema one, and belongs where the entity type is
-- known.

ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "adminPosition"   TEXT;
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "managerName"     TEXT;
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "managerEmail"    TEXT;
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "managerPhone"    TEXT;
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "managerPosition" TEXT;

-- A manager who cannot be reached is not a second point of contact. If any
-- manager detail is given, a name and at least one of email or phone must be.
ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS practices_manager_is_reachable;
ALTER TABLE "practices" ADD CONSTRAINT practices_manager_is_reachable
  CHECK (
    ("managerName" IS NULL AND "managerEmail" IS NULL AND "managerPhone" IS NULL AND "managerPosition" IS NULL)
    OR (COALESCE(btrim("managerName"), '') <> ''
        AND (COALESCE(btrim("managerEmail"), '') <> '' OR COALESCE(btrim("managerPhone"), '') <> ''))
  );

-- The manager must not simply be the applicant again under another heading —
-- that would defeat the entire point of having a second contact.
ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS practices_manager_is_a_different_person;
ALTER TABLE "practices" ADD CONSTRAINT practices_manager_is_a_different_person
  CHECK ("managerEmail" IS NULL OR "adminEmail" IS NULL OR lower(btrim("managerEmail")) <> lower(btrim("adminEmail")));

DROP FUNCTION IF EXISTS register_organisation(text,text,text,text,text[],text,text,boolean,text,text,text,text,text,text,text,text,text,text,text,text,boolean,text,text);

CREATE FUNCTION register_organisation(
  p_name text, p_abn text, p_acn text, p_legal_name text, p_trading_names text[],
  p_entity_type text, p_abn_status text, p_gst boolean, p_name_match_tier text,
  p_name_matched_on text, p_hpio text, p_pms text,
  p_verification_source text, p_sighted_by text,
  p_admin_name text, p_admin_email text, p_admin_phone text, p_website text,
  p_head_office_address text, p_head_office_state text, p_head_office_is_pop boolean,
  p_credential_type text, p_credential_value text,
  p_admin_position text, p_manager_name text, p_manager_email text,
  p_manager_phone text, p_manager_position text
) RETURNS uuid AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_verification_source NOT IN ('abr_api','manual_attestation') THEN
    RAISE EXCEPTION 'Unknown ABN verification source: %.', p_verification_source;
  END IF;
  IF p_verification_source = 'manual_attestation' AND COALESCE(btrim(p_sighted_by), '') = '' THEN
    RAISE EXCEPTION 'A manual ABR attestation must name the human who sighted the register.';
  END IF;
  IF COALESCE(btrim(p_admin_email), '') = '' THEN
    RAISE EXCEPTION 'An application must carry an admin email — it is where the passkey invitation goes.';
  END IF;
  IF COALESCE(btrim(p_head_office_address), '') = '' THEN
    RAISE EXCEPTION 'An application must carry a head-office address.';
  END IF;

  INSERT INTO "practices" (
    "id", "name", "abn", "acn", "legalName", "tradingNames", "entityType",
    "abnStatus", "abnVerifiedAt", "gstRegistered", "nameMatchTier",
    "nameMatchedOn", "hpiO", "pms", "validationState", "createdAt",
    "abnVerificationSource", "abnSightedByName",
    "adminName", "adminEmail", "adminPhone", "website",
    "headOfficeAddress", "headOfficeState", "headOfficeIsPlaceOfPractice",
    "credentialType", "credentialValue",
    "adminPosition", "managerName", "managerEmail", "managerPhone", "managerPosition"
  ) VALUES (
    gen_random_uuid(), p_name, p_abn, p_acn, p_legal_name,
    COALESCE(p_trading_names, ARRAY[]::text[]), p_entity_type,
    p_abn_status, now(), p_gst, p_name_match_tier,
    p_name_matched_on, p_hpio, COALESCE(p_pms, 'medtech_evolution'), 'pending', now(),
    p_verification_source, NULLIF(btrim(COALESCE(p_sighted_by, '')), ''),
    btrim(p_admin_name), lower(btrim(p_admin_email)), btrim(p_admin_phone),
    NULLIF(btrim(COALESCE(p_website, '')), ''),
    btrim(p_head_office_address), p_head_office_state, COALESCE(p_head_office_is_pop, false),
    p_credential_type, NULLIF(btrim(COALESCE(p_credential_value, '')), ''),
    NULLIF(btrim(COALESCE(p_admin_position, '')), ''),
    NULLIF(btrim(COALESCE(p_manager_name, '')), ''),
    NULLIF(lower(btrim(COALESCE(p_manager_email, ''))), ''),
    NULLIF(btrim(COALESCE(p_manager_phone, '')), ''),
    NULLIF(btrim(COALESCE(p_manager_position, '')), '')
  ) RETURNING "id" INTO v_id;
  RETURN v_id;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION register_organisation(text,text,text,text,text[],text,text,boolean,text,text,text,text,text,text,text,text,text,text,text,text,boolean,text,text,text,text,text,text,text) TO aob_app;

-- The queue shows both contacts, because the reviewer's job is to call one of
-- them — and the useful call is to the one who did NOT apply.
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
  "credentialType" text, "credentialValue" text
) AS $$
  SELECT p."id", p."name", p."abn", p."acn", p."legalName", p."tradingNames",
         p."entityType", p."abnStatus", p."nameMatchTier", p."nameMatchedOn", p."createdAt",
         p."abnVerificationSource", p."abnSightedByName",
         p."adminName", p."adminEmail", p."adminPhone", p."adminPosition",
         p."managerName", p."managerEmail", p."managerPhone", p."managerPosition",
         p."website", p."headOfficeAddress", p."headOfficeState",
         p."credentialType", p."credentialValue"
  FROM "practices" p
  WHERE p."validationState" = 'pending'
    AND p."abnVerifiedAt" IS NOT NULL
  ORDER BY p."createdAt" ASC;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION list_pending_organisations() TO aob_app;
