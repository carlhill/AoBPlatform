-- Fix: "column reference validationState is ambiguous".
--
-- In a plpgsql function, every RETURNS TABLE output column is also an
-- implicitly-declared variable. `decide_organisation_validation` returns a
-- column named "validationState", so the bare reference inside
--
--   SELECT "validationState" INTO v_current FROM "practices" WHERE "id" = p_id
--
-- could mean either the output variable or the table column, and Postgres
-- refuses to guess. Every reference to a practices column is now qualified
-- through an alias, which removes the ambiguity for good rather than relying
-- on the output names never colliding again.

CREATE OR REPLACE FUNCTION decide_organisation_validation(
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

  SELECT pr."validationState" INTO v_current FROM "practices" pr WHERE pr."id" = p_id;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Organisation % not found.', p_id;
  END IF;
  IF v_current <> 'pending' THEN
    RAISE EXCEPTION 'Organisation % is already %, and re-deciding would overwrite who approved it.', p_id, v_current;
  END IF;

  RETURN QUERY
  UPDATE "practices" pr
     SET "validationState" = p_decision,
         "validatedByName" = btrim(p_reviewer),
         "validatedAt" = now(),
         "validationNote" = p_note
   WHERE pr."id" = p_id
  RETURNING pr."id", pr."validationState", pr."validatedByName", pr."validatedAt";
END $$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION decide_organisation_validation(uuid,text,text,text) TO aob_app;
