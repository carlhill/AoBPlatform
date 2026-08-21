-- register_organisation() now records HOW the ABR details were obtained.
--
-- The old four-argument-shorter signature is dropped rather than left as an
-- overload: an overload that silently defaults the provenance to NULL is
-- exactly the call a future change would make by accident, and the whole
-- point of these two columns is that the provenance is never absent.

DROP FUNCTION IF EXISTS register_organisation(text,text,text,text,text[],text,text,boolean,text,text,text,text);

CREATE FUNCTION register_organisation(
  p_name text,
  p_abn text,
  p_acn text,
  p_legal_name text,
  p_trading_names text[],
  p_entity_type text,
  p_abn_status text,
  p_gst boolean,
  p_name_match_tier text,
  p_name_matched_on text,
  p_hpio text,
  p_pms text,
  p_verification_source text,
  p_sighted_by text
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

  INSERT INTO "practices" (
    "id", "name", "abn", "acn", "legalName", "tradingNames", "entityType",
    "abnStatus", "abnVerifiedAt", "gstRegistered", "nameMatchTier",
    "nameMatchedOn", "hpiO", "pms", "validationState", "createdAt",
    "abnVerificationSource", "abnSightedByName"
  ) VALUES (
    gen_random_uuid(), p_name, p_abn, p_acn, p_legal_name,
    COALESCE(p_trading_names, ARRAY[]::text[]), p_entity_type,
    p_abn_status, now(), p_gst, p_name_match_tier,
    p_name_matched_on, p_hpio, COALESCE(p_pms, 'medtech_evolution'), 'pending', now(),
    p_verification_source, NULLIF(btrim(COALESCE(p_sighted_by, '')), '')
  ) RETURNING "id" INTO v_id;
  RETURN v_id;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION register_organisation(text,text,text,text,text[],text,text,boolean,text,text,text,text,text,text) TO aob_app;

-- The reviewer's queue must show the provenance. Approving "ABN verified" is
-- a different act from approving "a colleague says they saw the ABN", and the
-- queue is the last point at which anyone can tell the difference.
-- DROP first: CREATE OR REPLACE cannot change a function's return type, and
-- this one gains two columns.
DROP FUNCTION IF EXISTS list_pending_organisations();

CREATE FUNCTION list_pending_organisations()
RETURNS TABLE (
  id uuid, name text, abn text, acn text, "legalName" text,
  "tradingNames" text[], "entityType" text, "abnStatus" text,
  "nameMatchTier" text, "nameMatchedOn" text, "createdAt" timestamp(3),
  "abnVerificationSource" text, "abnSightedByName" text
) AS $$
  SELECT p."id", p."name", p."abn", p."acn", p."legalName", p."tradingNames",
         p."entityType", p."abnStatus", p."nameMatchTier", p."nameMatchedOn", p."createdAt",
         p."abnVerificationSource", p."abnSightedByName"
  FROM "practices" p
  WHERE p."validationState" = 'pending'
    AND p."abnVerifiedAt" IS NOT NULL
  ORDER BY p."createdAt" ASC;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION list_pending_organisations() TO aob_app;
