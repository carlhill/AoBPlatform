-- Cross-practice system job (same sanctioned pattern as the capture expiry
-- sweep): one narrow SECURITY DEFINER function, never a bypass. Lists stored
-- agreements not yet written back to the PMS so the sweep can retry each
-- under its own practice scope (FR-9.3).

CREATE FUNCTION list_unwritten_stored_agreements(max_rows int DEFAULT 50)
RETURNS TABLE (id uuid, "practiceId" uuid, "createdAt" timestamp)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core
AS $$
  SELECT a.id, a."practiceId", a."createdAt"
    FROM agreements a
   WHERE a.status = 'stored'
     AND a."writtenBackAt" IS NULL
   ORDER BY a."createdAt" ASC
   LIMIT max_rows;
$$;

REVOKE ALL ON FUNCTION list_unwritten_stored_agreements(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_unwritten_stored_agreements(int) TO aob_app;
