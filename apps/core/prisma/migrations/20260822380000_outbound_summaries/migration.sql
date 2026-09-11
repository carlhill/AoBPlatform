-- Queue totals, across practices and within one.
--
-- WHY A SECURITY DEFINER FUNCTION FOR THE CROSS-PRACTICE ONE, individually
-- justified per CONVENTIONS.md §6.
--
-- "How much is each practice sending, and of what" is a question about the
-- PLATFORM, not about any one practice, so there is no scope to run it inside.
-- RLS is fail-closed and returns zero rows without one -- the same trap that
-- has bitten three times today.
--
-- WHAT MAKES IT SAFE TO OPEN: it returns COUNTS. No payload, no destination,
-- no recipient, no subject id. Knowing that a practice sent 412 emails
-- yesterday tells an operator whether the platform is working; it tells them
-- nothing about any patient, any practitioner, or any consent record. That is
-- a materially different disclosure from the item list, which is why the item
-- list stays scoped to one practice and this does not.

CREATE OR REPLACE FUNCTION core.outbound_totals_by_org()
RETURNS TABLE (
  "practiceId" uuid,
  "practiceName" text,
  "mediaType" text,
  "state" text,
  "total" bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT
    o."practiceId",
    COALESCE(p."tradingNames"[1], p."legalName", p."name") AS "practiceName",
    o."mediaType",
    o."state",
    count(*) AS total
  FROM core.outbound_items o
  JOIN core.practices p ON p."id" = o."practiceId"
  GROUP BY o."practiceId", COALESCE(p."tradingNames"[1], p."legalName", p."name"), o."mediaType", o."state";
$$;

REVOKE ALL ON FUNCTION core.outbound_totals_by_org() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.outbound_totals_by_org() TO aob_app;

-- The within-a-practice rollup needs NO function: it runs inside the practice
-- scope like every other read, so RLS does the work and no hole is opened.
-- Recorded here so the asymmetry is deliberate rather than accidental.
