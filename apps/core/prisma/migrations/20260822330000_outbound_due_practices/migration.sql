-- Which practices have outbound work waiting.
--
-- WHY A SECURITY DEFINER FUNCTION, individually justified per CONVENTIONS.md §6.
--
-- The queue worker is not acting for a practice; it is acting for the platform,
-- draining every practice's queue in turn. But RLS on outbound_items is
-- fail-closed and FORCEd, so a query with no `app.practice_id` set returns
-- ZERO ROWS -- which is exactly what happened: the worker swept, saw nothing,
-- and every notice sat pending while the practice waited for an email.
--
-- The alternative was to let the worker run unscoped, which would mean
-- weakening RLS on a table holding the CONTENT of patient notices. That is the
-- worst possible table to open up, so it stays closed and this narrow function
-- is the only way through.
--
-- WHAT IT DELIBERATELY DOES NOT RETURN: payloads, destinations, subjects, or
-- anything about WHAT is queued. Only practice ids and a count. Everything
-- after this point runs inside withPractice() like the rest of the system, so
-- the moment the worker touches an actual item it is scoped again.

CREATE OR REPLACE FUNCTION core.outbound_due_practices(p_limit integer DEFAULT 200)
RETURNS TABLE ("practiceId" uuid, "waiting" bigint)
LANGUAGE sql
SECURITY DEFINER
-- Pinned, so the function cannot be redirected by a caller's search_path.
SET search_path = core, pg_temp
AS $$
  SELECT "practiceId", count(*) AS waiting
  FROM core.outbound_items
  WHERE "channel" <> 'device'
    AND (
      ("state" IN ('pending', 'failed') AND "availableAt" <= now())
      OR ("state" = 'leased' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= now()))
    )
  GROUP BY "practiceId"
  ORDER BY count(*) DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION core.outbound_due_practices(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.outbound_due_practices(integer) TO aob_app;
