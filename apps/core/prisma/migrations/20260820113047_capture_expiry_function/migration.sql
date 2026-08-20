-- System jobs vs FORCE RLS. The expiry sweep must act across practices, but
-- every practice-scoped table fails closed without a practice scope — so an
-- unscoped sweep would silently do nothing (caught in review before it
-- shipped). The sanctioned pattern for cross-practice system work is a
-- SECURITY DEFINER function that performs ONE narrow, named operation and
-- nothing else — never a generic bypass GUC, never BYPASSRLS on the app role.

CREATE FUNCTION expire_due_capture_requests()
RETURNS TABLE (id uuid, "practiceId" uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core
AS $$
  UPDATE capture_requests
     SET status = 'expired'
   WHERE status = 'open'
     AND "expiresAt" IS NOT NULL
     AND "expiresAt" < now()
  RETURNING capture_requests.id, capture_requests."practiceId";
$$;

REVOKE ALL ON FUNCTION expire_due_capture_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expire_due_capture_requests() TO aob_app;
