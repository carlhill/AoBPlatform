-- Pre-tenant and cross-tenant access, as narrow SECURITY DEFINER functions.
--
-- WHY THIS EXISTS. RLS on `practices` scopes every row to app.practice_id.
-- That is correct and stays. But the organisation/affiliation model has
-- operations that are legitimately OUTSIDE any single tenant:
--
--   * REGISTERING an organisation — the tenant does not exist yet, so there is
--     no id to scope to. The INSERT's WITH CHECK can never pass.
--   * The VALIDATION QUEUE — a platform operator reviewing applications across
--     every tenant, by definition.
--   * A PRACTITIONER answering an invitation, or being deregistered — a
--     practitioner spans practices; that is the whole point of the model.
--   * The AFFILIATION SWEEP — a system job that must find every affiliation
--     whose end date has arrived, in every practice.
--
-- Attempted through the ordinary client, each of these FAILS SILENTLY rather
-- than loudly: RLS filters the rows and the query returns zero, so the sweep
-- reports "0 ended", the velocity check reports "0 affiliations", and
-- deregistration reports "0 affiliations ended" — all while appearing to work.
-- That is the silent-invalidation failure mode this system is built to avoid,
-- so the escape hatches are explicit, individually justified, and each returns
-- the NARROWEST projection its caller needs.
--
-- WHAT NONE OF THEM RETURN: patient data, agreement content, evidence, or a
-- provider number. They deal in ids, statuses and dates.

-- ---------------------------------------------------------------------------
-- Organisation registration and the human validation queue.
-- ---------------------------------------------------------------------------

CREATE FUNCTION find_organisation_by_abn(p_abn text)
RETURNS TABLE (id uuid, name text) AS $$
  SELECT p."id", p."name" FROM "practices" p WHERE p."abn" = p_abn LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

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
  p_pms text
) RETURNS uuid AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO "practices" (
    "id", "name", "abn", "acn", "legalName", "tradingNames", "entityType",
    "abnStatus", "abnVerifiedAt", "gstRegistered", "nameMatchTier",
    "nameMatchedOn", "hpiO", "pms", "validationState", "createdAt"
  ) VALUES (
    gen_random_uuid(), p_name, p_abn, p_acn, p_legal_name,
    COALESCE(p_trading_names, ARRAY[]::text[]), p_entity_type,
    p_abn_status, now(), p_gst, p_name_match_tier,
    p_name_matched_on, p_hpio, COALESCE(p_pms, 'medtech_evolution'), 'pending', now()
  ) RETURNING "id" INTO v_id;
  RETURN v_id;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE FUNCTION list_pending_organisations()
RETURNS TABLE (
  id uuid, name text, abn text, acn text, "legalName" text,
  "tradingNames" text[], "entityType" text, "abnStatus" text,
  "nameMatchTier" text, "nameMatchedOn" text, "createdAt" timestamp(3)
) AS $$
  SELECT p."id", p."name", p."abn", p."acn", p."legalName", p."tradingNames",
         p."entityType", p."abnStatus", p."nameMatchTier", p."nameMatchedOn", p."createdAt"
  FROM "practices" p
  WHERE p."validationState" = 'pending'
  ORDER BY p."createdAt" ASC;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE FUNCTION get_organisation_validation(p_id uuid)
RETURNS TABLE (id uuid, name text, "validationState" text, "validatedByName" text, "validatedAt" timestamp(3)) AS $$
  SELECT p."id", p."name", p."validationState", p."validatedByName", p."validatedAt"
  FROM "practices" p WHERE p."id" = p_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- The decision is only ever applied to a PENDING organisation. Re-deciding
-- would overwrite the record of who approved it and when, so the function
-- refuses rather than the service merely checking first.
CREATE FUNCTION decide_organisation_validation(
  p_id uuid, p_decision text, p_reviewer text, p_note text
) RETURNS TABLE (id uuid, "validationState" text, "validatedByName" text, "validatedAt" timestamp(3)) AS $$
DECLARE
  v_current text;
BEGIN
  IF p_decision NOT IN ('validated','rejected') THEN
    RAISE EXCEPTION 'A validation decision is validated or rejected, not %.', p_decision;
  END IF;
  IF COALESCE(btrim(p_reviewer), '') = '' THEN
    RAISE EXCEPTION 'A validation decision must name the human who made it.';
  END IF;

  SELECT "validationState" INTO v_current FROM "practices" WHERE "id" = p_id;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Organisation % not found.', p_id;
  END IF;
  IF v_current <> 'pending' THEN
    RAISE EXCEPTION 'Organisation % is already %, and re-deciding would overwrite who approved it.', p_id, v_current;
  END IF;

  RETURN QUERY
  UPDATE "practices"
     SET "validationState" = p_decision,
         "validatedByName" = btrim(p_reviewer),
         "validatedAt" = now(),
         "validationNote" = p_note
   WHERE "id" = p_id
  RETURNING "practices"."id", "practices"."validationState",
            "practices"."validatedByName", "practices"."validatedAt";
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- Practitioner-side and system-side affiliation access.
--
-- Each returns the practiceId, so the SERVICE can then do its write inside
-- withPractice() — the escape hatch is used to find out which tenant to scope
-- to, not to write unscoped.
-- ---------------------------------------------------------------------------

/** One affiliation, but only if it really belongs to this practitioner. */
CREATE FUNCTION find_affiliation_for_practitioner(p_affiliation_id uuid, p_practitioner_id uuid)
RETURNS TABLE (id uuid, "practiceId" uuid, status text) AS $$
  SELECT a."id", a."practiceId", a."status"
  FROM "affiliations" a
  WHERE a."id" = p_affiliation_id AND a."practitionerId" = p_practitioner_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

/** Every live affiliation a practitioner holds — for the deregistration stop. */
CREATE FUNCTION list_live_affiliations_for_practitioner(p_practitioner_id uuid)
RETURNS TABLE (id uuid, "practiceId" uuid, status text) AS $$
  SELECT a."id", a."practiceId", a."status"
  FROM "affiliations" a
  WHERE a."practitionerId" = p_practitioner_id
    AND a."status" IN ('invited','active','ending');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

/** REQ-ANOM-01 velocity. Counts only — no practice is named. */
CREATE FUNCTION count_practitioner_affiliations(p_practitioner_id uuid, p_since timestamp(3))
RETURNS TABLE ("activeCount" bigint, "addedInWindow" bigint) AS $$
  SELECT
    count(*) FILTER (WHERE a."status" IN ('active','ending')),
    count(*) FILTER (WHERE a."invitedAt" >= p_since)
  FROM "affiliations" a
  WHERE a."practitionerId" = p_practitioner_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

/**
 * The sweep. Affiliations whose agreed end date has arrived, across every
 * practice — this is the query that, filtered to zero by RLS, would let the
 * platform keep accepting consent under expired affiliations forever.
 */
CREATE FUNCTION list_due_affiliations(p_now timestamp(3))
RETURNS TABLE (id uuid, "practiceId" uuid) AS $$
  SELECT a."id", a."practiceId"
  FROM "affiliations" a
  WHERE a."status" = 'ending' AND a."endsAt" IS NOT NULL AND a."endsAt" <= p_now;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION find_organisation_by_abn(text) TO aob_app;
GRANT EXECUTE ON FUNCTION register_organisation(text,text,text,text,text[],text,text,boolean,text,text,text,text) TO aob_app;
GRANT EXECUTE ON FUNCTION list_pending_organisations() TO aob_app;
GRANT EXECUTE ON FUNCTION get_organisation_validation(uuid) TO aob_app;
GRANT EXECUTE ON FUNCTION decide_organisation_validation(uuid,text,text,text) TO aob_app;
GRANT EXECUTE ON FUNCTION find_affiliation_for_practitioner(uuid,uuid) TO aob_app;
GRANT EXECUTE ON FUNCTION list_live_affiliations_for_practitioner(uuid) TO aob_app;
GRANT EXECUTE ON FUNCTION count_practitioner_affiliations(uuid,timestamp(3)) TO aob_app;
GRANT EXECUTE ON FUNCTION list_due_affiliations(timestamp(3)) TO aob_app;
