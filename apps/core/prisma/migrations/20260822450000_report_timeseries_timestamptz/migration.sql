-- The report function took `timestamp` and Prisma sends `timestamptz`.
--
-- Postgres does not coerce between them when resolving an overload, so the call
-- failed with "function ... does not exist" -- which reads like the migration
-- never ran, and sent me looking in the wrong place. The function was there;
-- its signature was not the one being called.
--
-- The columns it compares against are `timestamp(3)` WITHOUT a zone, holding
-- UTC by Prisma's convention. So the parameters are taken as `timestamptz` --
-- what the caller actually sends, and unambiguous about which instant it means
-- -- and converted to naive UTC inside, where the comparison happens. Doing it
-- the other way round would silently reinterpret the caller's instant in the
-- server's timezone, which is right only when the server runs in UTC and wrong
-- everywhere else.

DROP FUNCTION IF EXISTS core.outbound_timeseries(text, uuid, uuid, uuid, timestamp(3), timestamp(3));

CREATE OR REPLACE FUNCTION core.outbound_timeseries(
  p_scope         text,
  p_practice_id   uuid        DEFAULT NULL,
  p_location_id   uuid        DEFAULT NULL,
  p_department_id uuid        DEFAULT NULL,
  p_from          timestamptz DEFAULT NULL,
  p_to            timestamptz DEFAULT NULL
)
RETURNS TABLE (
  "at"         timestamp(3),
  "count"      bigint,
  "practiceId" uuid,
  "mediaType"  text,
  "state"      text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
DECLARE
  v_from timestamp(3) := (p_from AT TIME ZONE 'UTC')::timestamp(3);
  v_to   timestamp(3) := (p_to   AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  -- An unrecognised scope returns nothing rather than falling through to an
  -- unfiltered query. The dangerous version is the one where a typo means
  -- "everything".
  IF p_scope NOT IN ('platform', 'organisation') THEN
    RETURN;
  END IF;

  -- `organisation` must name a practice, or a NULL id would read as "no
  -- filter" and hand one practice every other practice's figures -- a tenancy
  -- breach dressed as a missing parameter.
  IF p_scope = 'organisation' AND p_practice_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    -- Truncated to the hour: finer than any grain offered, coarse enough that
    -- two years is thousands of rows rather than millions, and it keeps the
    -- timezone conversion in one place -- the domain.
    date_trunc('hour', COALESCE(o."sentAt", o."createdAt"))::timestamp(3),
    count(*)::bigint,
    o."practiceId",
    o."mediaType",
    o."state"
  FROM core.outbound_items o
  WHERE (p_scope = 'platform' OR o."practiceId" = p_practice_id)
    AND (p_location_id IS NULL OR o."locationId" = p_location_id)
    AND (p_department_id IS NULL OR o."departmentId" = p_department_id)
    AND (p_from IS NULL OR COALESCE(o."sentAt", o."createdAt") >= v_from)
    AND (p_to   IS NULL OR COALESCE(o."sentAt", o."createdAt") <= v_to)
  GROUP BY 1, o."practiceId", o."mediaType", o."state";
END $$;
