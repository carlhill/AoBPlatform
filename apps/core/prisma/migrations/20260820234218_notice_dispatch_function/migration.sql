-- Cross-practice system job (same sanctioned pattern as the capture-expiry and
-- write-back sweeps): one narrow SECURITY DEFINER function, never a bypass.
-- Lists composed-but-undispatched notices so the sweep can act on each under
-- its own practice scope, ordered by CLAIM LODGEMENT so the closest to its
-- 24-hour deadline goes first (REQ-DEL-03).

CREATE FUNCTION list_undispatched_notices(max_rows int DEFAULT 50)
RETURNS TABLE (id uuid, "practiceId" uuid, "claimLodgedAt" timestamp)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core
AS $$
  SELECT n.id, n."practiceId", n."claimLodgedAt"
    FROM notices n
   WHERE n."dispatchedAt" IS NULL
   ORDER BY n."claimLodgedAt" ASC
   LIMIT max_rows;
$$;

REVOKE ALL ON FUNCTION list_undispatched_notices(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_undispatched_notices(int) TO aob_app;
