-- The decision reads the entitlement CHECK instead of asking for it again.
--
-- WHAT WAS WRONG. A reviewer records an entitlement check -- the number, where
-- the number came from, who answered, and an attached artefact -- and was then
-- asked, at the decision, to type the same facts into a second form. Two
-- consequences, and the second is the serious one:
--
--   1. TWO RECORDS OF ONE EVENT THAT CAN DISAGREE. The check carries evidence;
--      the retyped copy does not. The weaker record was the one the decision
--      stored.
--
--   2. IT MISATTRIBUTED THE CHECK. One person rings the practice and another
--      approves -- ordinary, and arguably better practice. The function set
--      "entitlementCheckedByName" to the REVIEWER whenever a method came in on
--      the decision, so John's phone call was recorded as Carl's. On the most
--      privileged act in the system, in a product whose premise is
--      non-repudiable records, that is the wrong thing to be generating.
--
-- So the caller now passes WHO performed the establishing check and WHEN,
-- taken off the check itself rather than from the person deciding.
--
-- The service derives both through establishingEntitlementCheck() in the
-- domain, which picks the strongest passed entitlement check and reads its
-- fields. The arithmetic of "which check does this rest on" is a rule with
-- tests, so it does not live here.

-- BOTH SIGNATURES. Postgres will not change a function's parameter list in
-- place, and dropping only the current one makes this migration succeed once
-- and fail on every re-run.
DROP FUNCTION IF EXISTS decide_organisation_validation(uuid, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS decide_organisation_validation(uuid, text, text, text, text, text, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS decide_organisation_validation(uuid, text, text, text);

CREATE FUNCTION decide_organisation_validation(
  p_id uuid, p_decision text, p_reviewer text, p_note text,
  p_entitlement_method text, p_phone text, p_number_source text, p_spoke_with text,
  -- Who actually performed the establishing check, and when. NULL falls back to
  -- the reviewer, which is correct only when the entitlement was recorded
  -- inline at the decision by that same person.
  p_checked_by text DEFAULT NULL, p_checked_at timestamptz DEFAULT NULL
) RETURNS TABLE (
  id uuid, name text, "validationState" text, "validatedByName" text,
  "validatedAt" timestamp(3), "adminName" text, "adminEmail" text
) AS $$
DECLARE
  v_current text;
  v_entitlement_checks int;
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

  IF p_decision = 'validated' THEN
    SELECT count(*) INTO v_entitlement_checks
      FROM "practice_checks" c
     WHERE c."practiceId" = p_id
       AND c."category" = 'entitlement'
       AND c."outcome" = 'passed';

    -- Either a recorded entitlement CHECK, or the inline method. What is
    -- refused throughout is approving with NEITHER: the ABN gate proves the
    -- entity exists, not that this person speaks for it.
    IF v_entitlement_checks = 0 AND COALESCE(btrim(p_entitlement_method), '') = '' THEN
      RAISE EXCEPTION
        'Approving a practice requires at least one PASSED entitlement check. The ABN gate proves the entity '
        'exists; it does not prove this person speaks for it, and the ABN and trading names are public.';
    END IF;
  END IF;

  RETURN QUERY
  UPDATE "practices" pr
     SET "validationState" = p_decision,
         "validatedByName" = btrim(p_reviewer),
         "validatedAt" = now(),
         "validationNote" = p_note,
         "entitlementMethod" = COALESCE(NULLIF(btrim(COALESCE(p_entitlement_method, '')), ''), pr."entitlementMethod"),
         "entitlementPhoneNumber" = COALESCE(NULLIF(btrim(COALESCE(p_phone, '')), ''), pr."entitlementPhoneNumber"),
         "entitlementNumberSource" = COALESCE(NULLIF(btrim(COALESCE(p_number_source, '')), ''), pr."entitlementNumberSource"),
         "entitlementSpokeWithName" = COALESCE(NULLIF(btrim(COALESCE(p_spoke_with, '')), ''), pr."entitlementSpokeWithName"),
         -- THE ATTRIBUTION. The caller's value wins, because it came off the
         -- check. Only when there is none does this fall back to the reviewer,
         -- and then only if they recorded a method inline -- which is the one
         -- case where reviewer and checker really are the same person.
         "entitlementCheckedByName" = COALESCE(
           NULLIF(btrim(COALESCE(p_checked_by, '')), ''),
           pr."entitlementCheckedByName",
           CASE WHEN COALESCE(btrim(p_entitlement_method), '') = '' THEN NULL ELSE btrim(p_reviewer) END),
         "entitlementCheckedAt" = COALESCE(
           p_checked_at,
           pr."entitlementCheckedAt",
           CASE WHEN COALESCE(btrim(p_entitlement_method), '') = '' THEN NULL ELSE now() END)
   WHERE pr."id" = p_id
  RETURNING pr."id", pr."name", pr."validationState", pr."validatedByName",
            pr."validatedAt", pr."adminName", pr."adminEmail";
END $$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION decide_organisation_validation(uuid,text,text,text,text,text,text,text,text,timestamptz) TO aob_app;
