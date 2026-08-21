-- AlterTable
ALTER TABLE "enrolment_ceremonies" ADD COLUMN     "approvedOrganisationId" UUID,
ADD COLUMN     "subjectKind" TEXT NOT NULL DEFAULT 'practitioner',
ALTER COLUMN "ahpraNumber" DROP NOT NULL,
ALTER COLUMN "ahpraRegistrationCurrent" SET DEFAULT false,
ALTER COLUMN "providerNumber" DROP NOT NULL,
ALTER COLUMN "providerNumberLocation" DROP NOT NULL,
ALTER COLUMN "providerNumberVerified" SET DEFAULT false;

-- AlterTable
ALTER TABLE "practices" ADD COLUMN     "adminEmail" TEXT,
ADD COLUMN     "adminInvitedAt" TIMESTAMP(3),
ADD COLUMN     "adminKeycloakUserId" TEXT,
ADD COLUMN     "adminName" TEXT,
ADD COLUMN     "adminPasskeyEnrolledAt" TIMESTAMP(3),
ADD COLUMN     "adminPhone" TEXT,
ADD COLUMN     "credentialType" TEXT,
ADD COLUMN     "credentialValue" TEXT,
ADD COLUMN     "entitlementCheckedAt" TIMESTAMP(3),
ADD COLUMN     "entitlementCheckedByName" TEXT,
ADD COLUMN     "entitlementMethod" TEXT,
ADD COLUMN     "entitlementNote" TEXT,
ADD COLUMN     "entitlementNumberSource" TEXT,
ADD COLUMN     "entitlementPhoneNumber" TEXT,
ADD COLUMN     "entitlementSpokeWithName" TEXT,
ADD COLUMN     "headOfficeAddress" TEXT,
ADD COLUMN     "headOfficeIsPlaceOfPractice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "headOfficeState" TEXT,
ADD COLUMN     "website" TEXT;


-- ===========================================================================
-- HAND-AUTHORED HALF.
-- ===========================================================================

ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS practices_credential_type_known;
ALTER TABLE "practices" ADD CONSTRAINT practices_credential_type_known
  CHECK ("credentialType" IS NULL OR "credentialType" IN ('ahpra','hpio','accreditation'));

ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS practices_credential_is_paired;
ALTER TABLE "practices" ADD CONSTRAINT practices_credential_is_paired
  CHECK (("credentialType" IS NULL) = ("credentialValue" IS NULL));

ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS practices_entitlement_method_known;
ALTER TABLE "practices" ADD CONSTRAINT practices_entitlement_method_known
  CHECK ("entitlementMethod" IS NULL
      OR "entitlementMethod" IN ('phone_call','domain_match','hpio','document','none'));

ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS practices_entitlement_number_source_known;
ALTER TABLE "practices" ADD CONSTRAINT practices_entitlement_number_source_known
  CHECK ("entitlementNumberSource" IS NULL
      OR "entitlementNumberSource" IN ('nhsd','practice_website','public_directory','application_form','other'));

-- A recorded phone call MUST say which number was dialled, and where that
-- number came from.
--
-- Without the source the record is worthless: a number supplied on the
-- application form is chosen by the applicant, so calling it verifies that the
-- applicant answers their own phone and nothing else. AHPRA cannot supply one
-- either — the public register publishes suburb and postcode only, never a
-- phone number or an email. Making the source mandatory forces the reviewer to
-- notice where they got it, which is the entire value of the check.
ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS practices_phone_check_records_its_source;
ALTER TABLE "practices" ADD CONSTRAINT practices_phone_check_records_its_source
  CHECK ("entitlementMethod" IS DISTINCT FROM 'phone_call'
      OR (COALESCE(btrim("entitlementPhoneNumber"), '') <> ''
          AND "entitlementNumberSource" IS NOT NULL
          AND COALESCE(btrim("entitlementSpokeWithName"), '') <> ''));

-- Any entitlement decision names the human who made it.
ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS practices_entitlement_is_named;
ALTER TABLE "practices" ADD CONSTRAINT practices_entitlement_is_named
  CHECK ("entitlementMethod" IS NULL OR COALESCE(btrim("entitlementCheckedByName"), '') <> '');

-- ---------------------------------------------------------------------------
-- The ceremony now serves two kinds of subject, and each must be complete for
-- its own kind. A practitioner ceremony without an AHPRA number is not a
-- ceremony; an admin ceremony without the approval it rests on is not either.
-- ---------------------------------------------------------------------------

ALTER TABLE "enrolment_ceremonies" DROP CONSTRAINT IF EXISTS ceremonies_subject_kind_known;
ALTER TABLE "enrolment_ceremonies" ADD CONSTRAINT ceremonies_subject_kind_known
  CHECK ("subjectKind" IN ('practitioner','practice_admin'));

ALTER TABLE "enrolment_ceremonies" DROP CONSTRAINT IF EXISTS ceremonies_complete_for_kind;
ALTER TABLE "enrolment_ceremonies" ADD CONSTRAINT ceremonies_complete_for_kind
  CHECK (
    ("subjectKind" = 'practitioner'
      AND "ahpraNumber" IS NOT NULL
      AND "providerNumber" IS NOT NULL
      AND "providerNumberLocation" IS NOT NULL)
    OR
    ("subjectKind" = 'practice_admin' AND "approvedOrganisationId" IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- Registration now carries the applicant and the head office. More parameters
-- rather than an overload, for the same reason as last time: an overload that
-- silently defaults them to NULL is exactly the call a later change makes by
-- accident.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS register_organisation(text,text,text,text,text[],text,text,boolean,text,text,text,text,text,text);

CREATE FUNCTION register_organisation(
  p_name text, p_abn text, p_acn text, p_legal_name text, p_trading_names text[],
  p_entity_type text, p_abn_status text, p_gst boolean, p_name_match_tier text,
  p_name_matched_on text, p_hpio text, p_pms text,
  p_verification_source text, p_sighted_by text,
  p_admin_name text, p_admin_email text, p_admin_phone text, p_website text,
  p_head_office_address text, p_head_office_state text, p_head_office_is_pop boolean,
  p_credential_type text, p_credential_value text
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
    "credentialType", "credentialValue"
  ) VALUES (
    gen_random_uuid(), p_name, p_abn, p_acn, p_legal_name,
    COALESCE(p_trading_names, ARRAY[]::text[]), p_entity_type,
    p_abn_status, now(), p_gst, p_name_match_tier,
    p_name_matched_on, p_hpio, COALESCE(p_pms, 'medtech_evolution'), 'pending', now(),
    p_verification_source, NULLIF(btrim(COALESCE(p_sighted_by, '')), ''),
    btrim(p_admin_name), lower(btrim(p_admin_email)), btrim(p_admin_phone),
    NULLIF(btrim(COALESCE(p_website, '')), ''),
    btrim(p_head_office_address), p_head_office_state, COALESCE(p_head_office_is_pop, false),
    p_credential_type, NULLIF(btrim(COALESCE(p_credential_value, '')), '')
  ) RETURNING "id" INTO v_id;
  RETURN v_id;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION register_organisation(text,text,text,text,text[],text,text,boolean,text,text,text,text,text,text,text,text,text,text,text,text,boolean,text,text) TO aob_app;

-- ---------------------------------------------------------------------------
-- Approval records the entitlement check alongside the decision, and returns
-- enough for the service to send the right email.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS decide_organisation_validation(uuid,text,text,text);

CREATE FUNCTION decide_organisation_validation(
  p_id uuid, p_decision text, p_reviewer text, p_note text,
  p_entitlement_method text, p_phone text, p_number_source text, p_spoke_with text
) RETURNS TABLE (
  id uuid, name text, "validationState" text, "validatedByName" text,
  "validatedAt" timestamp(3), "adminName" text, "adminEmail" text
) AS $$
DECLARE
  v_current text;
BEGIN
  IF p_decision NOT IN ('validated','rejected') THEN
    RAISE EXCEPTION 'A validation decision is validated or rejected, not %.', p_decision;
  END IF;
  IF COALESCE(btrim(p_reviewer), '') = '' THEN
    RAISE EXCEPTION 'A validation decision must name the human who made it.';
  END IF;

  SELECT pr."validationState" INTO v_current FROM "practices" pr WHERE pr."id" = p_id;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Organisation % not found.', p_id;
  END IF;
  IF v_current <> 'pending' THEN
    RAISE EXCEPTION 'Organisation % is already %, and re-deciding would overwrite who approved it.', p_id, v_current;
  END IF;

  -- APPROVAL requires an entitlement decision. Rejection does not: refusing an
  -- application you could not verify is precisely the right outcome, and
  -- demanding a completed check before you may say no would be backwards.
  IF p_decision = 'validated' AND COALESCE(btrim(p_entitlement_method), '') = '' THEN
    RAISE EXCEPTION
      'Approving a practice requires recording HOW the applicant was verified to represent this entity. '
      'The ABN gate proves the entity exists; it does not prove this person speaks for it, and the ABN and '
      'trading names are public.';
  END IF;

  RETURN QUERY
  UPDATE "practices" pr
     SET "validationState" = p_decision,
         "validatedByName" = btrim(p_reviewer),
         "validatedAt" = now(),
         "validationNote" = p_note,
         "entitlementMethod" = NULLIF(btrim(COALESCE(p_entitlement_method, '')), ''),
         "entitlementPhoneNumber" = NULLIF(btrim(COALESCE(p_phone, '')), ''),
         "entitlementNumberSource" = NULLIF(btrim(COALESCE(p_number_source, '')), ''),
         "entitlementSpokeWithName" = NULLIF(btrim(COALESCE(p_spoke_with, '')), ''),
         "entitlementCheckedByName" = CASE WHEN COALESCE(btrim(p_entitlement_method), '') = ''
                                           THEN NULL ELSE btrim(p_reviewer) END,
         "entitlementCheckedAt" = CASE WHEN COALESCE(btrim(p_entitlement_method), '') = ''
                                       THEN NULL ELSE now() END
   WHERE pr."id" = p_id
  RETURNING pr."id", pr."name", pr."validationState", pr."validatedByName",
            pr."validatedAt", pr."adminName", pr."adminEmail";
END $$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION decide_organisation_validation(uuid,text,text,text,text,text,text,text) TO aob_app;

-- The picker and the queue both need the applicant, so an operator can see who
-- applied without opening the record.
DROP FUNCTION IF EXISTS list_pending_organisations();

CREATE FUNCTION list_pending_organisations()
RETURNS TABLE (
  id uuid, name text, abn text, acn text, "legalName" text,
  "tradingNames" text[], "entityType" text, "abnStatus" text,
  "nameMatchTier" text, "nameMatchedOn" text, "createdAt" timestamp(3),
  "abnVerificationSource" text, "abnSightedByName" text,
  "adminName" text, "adminEmail" text, "adminPhone" text, "website" text,
  "headOfficeAddress" text, "headOfficeState" text,
  "credentialType" text, "credentialValue" text
) AS $$
  SELECT p."id", p."name", p."abn", p."acn", p."legalName", p."tradingNames",
         p."entityType", p."abnStatus", p."nameMatchTier", p."nameMatchedOn", p."createdAt",
         p."abnVerificationSource", p."abnSightedByName",
         p."adminName", p."adminEmail", p."adminPhone", p."website",
         p."headOfficeAddress", p."headOfficeState",
         p."credentialType", p."credentialValue"
  FROM "practices" p
  WHERE p."validationState" = 'pending'
    AND p."abnVerifiedAt" IS NOT NULL
  ORDER BY p."createdAt" ASC;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION list_pending_organisations() TO aob_app;
