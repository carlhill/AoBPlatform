-- THE CLOSURE SWEEP'S PRACTICE DISCOVERY, PAGED, ORDERED AND CUT OFF
-- (review of D-2026-10-10-09, 11 Oct 2026).
--
-- `20261011020000_unsigned_draft_closure` created
-- `core.unsigned_draft_closure_practices(text[], text[], integer)` with a
-- LIMIT and no ORDER BY, listing every practice with ANY unsigned draft. Past
-- the limit, which practices were swept was arbitrary, and a practice with
-- only today's drafts was listed every hour for nothing. This replaces it:
--  - `p_created_before`: only drafts old enough that some N could make them due
--    (the sweep passes the start of the practice-local day `today - minDays + 1`);
--  - legal hold excluded, as the sweep would skip it anyway;
--  - ORDER BY "practiceId", with `p_after` as a keyset cursor so the sweep
--    pages through every practice rather than the first 500 the planner found.
-- PRACTICE IDS ONLY, as before (CONVENTIONS.md section 6). The statuses and
-- types stay parameters, passed from the domain.
--
-- Idempotent and reversible: the down path at the foot restores the old one.

DROP FUNCTION IF EXISTS core.unsigned_draft_closure_practices(text[], text[], integer);

CREATE OR REPLACE FUNCTION core.unsigned_draft_closure_practices(
  p_statuses text[],
  p_types text[],
  p_created_before timestamp,
  p_after uuid,
  p_limit integer DEFAULT 500
)
RETURNS TABLE ("practiceId" uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT DISTINCT a."practiceId"
  FROM core.agreements a
  WHERE a."status" = ANY (p_statuses)
    AND a."type" = ANY (p_types)
    AND a."signatureEventId" IS NULL
    AND NOT a."legalHold"
    AND a."createdAt" < p_created_before
    AND (p_after IS NULL OR a."practiceId" > p_after)
  ORDER BY a."practiceId"
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION core.unsigned_draft_closure_practices(text[], text[], timestamp, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.unsigned_draft_closure_practices(text[], text[], timestamp, uuid, integer) TO aob_app;

-- DOWN (run by hand to reverse):
-- DROP FUNCTION IF EXISTS core.unsigned_draft_closure_practices(text[], text[], timestamp, uuid, integer);
-- CREATE OR REPLACE FUNCTION core.unsigned_draft_closure_practices(p_statuses text[], p_types text[], p_limit integer DEFAULT 500)
-- RETURNS TABLE ("practiceId" uuid) LANGUAGE sql SECURITY DEFINER SET search_path = core, pg_temp AS $$
--   SELECT DISTINCT a."practiceId" FROM core.agreements a
--   WHERE a."status" = ANY (p_statuses) AND a."type" = ANY (p_types) AND a."signatureEventId" IS NULL
--   LIMIT p_limit;
-- $$;
-- REVOKE ALL ON FUNCTION core.unsigned_draft_closure_practices(text[], text[], integer) FROM PUBLIC;
-- GRANT EXECUTE ON FUNCTION core.unsigned_draft_closure_practices(text[], text[], integer) TO aob_app;
