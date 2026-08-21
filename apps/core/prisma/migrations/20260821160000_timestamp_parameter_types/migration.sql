-- Fix: "function count_practitioner_affiliations(uuid, timestamp with time
-- zone) does not exist".
--
-- Prisma sends a JavaScript Date as `timestamptz`, but these functions were
-- declared to take `timestamp(3)`, so Postgres found no matching overload and
-- the call failed outright.
--
-- Failing outright is the LUCKY outcome here. Had the types merely been
-- coercible, the comparison would have silently gone through the session's
-- TimeZone setting — and a sweep that decides whether an affiliation has
-- ended, and therefore whether enduring agreements have ceased under reg
-- 65CA(8), must not depend on what time zone a connection happens to be in.
--
-- So: the parameters are now `timestamptz`, and each stored column is lifted
-- into one explicitly with `AT TIME ZONE 'UTC'`. The columns are Prisma
-- `TIMESTAMP(3)` holding UTC wall-clock, so that conversion is exact and
-- session-independent.

DROP FUNCTION IF EXISTS count_practitioner_affiliations(uuid, timestamp(3));
DROP FUNCTION IF EXISTS list_due_affiliations(timestamp(3));

CREATE FUNCTION count_practitioner_affiliations(p_practitioner_id uuid, p_since timestamptz)
RETURNS TABLE ("activeCount" bigint, "addedInWindow" bigint) AS $$
  SELECT
    count(*) FILTER (WHERE a."status" IN ('active','ending')),
    count(*) FILTER (WHERE (a."invitedAt" AT TIME ZONE 'UTC') >= p_since)
  FROM "affiliations" a
  WHERE a."practitionerId" = p_practitioner_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE FUNCTION list_due_affiliations(p_now timestamptz)
RETURNS TABLE (id uuid, "practiceId" uuid) AS $$
  SELECT a."id", a."practiceId"
  FROM "affiliations" a
  WHERE a."status" = 'ending'
    AND a."endsAt" IS NOT NULL
    AND (a."endsAt" AT TIME ZONE 'UTC') <= p_now;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION count_practitioner_affiliations(uuid, timestamptz) TO aob_app;
GRANT EXECUTE ON FUNCTION list_due_affiliations(timestamptz) TO aob_app;
