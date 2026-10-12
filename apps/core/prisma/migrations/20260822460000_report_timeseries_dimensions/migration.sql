-- The time series, broken down by where the message was going.
--
-- WHY THE DIMENSIONS COME BACK NAMED. The first version returned counts and a
-- practice id, so a page could say "165 messages" beside a table saying "10" --
-- the same page, two totals, no way to tell which was answering which
-- question. Returning the site and department the counts belong to lets one
-- screen show one thing broken down, instead of two things that look like they
-- should agree.
--
-- Names are resolved HERE rather than by a second query per row. A report over
-- two years and forty sites would otherwise be forty round trips, and the
-- version that batches them is the version somebody writes later, wrongly.

DROP FUNCTION IF EXISTS core.outbound_timeseries(text, uuid, uuid, uuid, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION core.outbound_timeseries(
  p_scope         text,
  p_practice_id   uuid        DEFAULT NULL,
  p_location_id   uuid        DEFAULT NULL,
  p_department_id uuid        DEFAULT NULL,
  p_from          timestamptz DEFAULT NULL,
  p_to            timestamptz DEFAULT NULL
)
RETURNS TABLE (
  "at"             timestamp(3),
  "count"          bigint,
  "practiceId"     uuid,
  "practiceName"   text,
  "locationId"     uuid,
  "locationName"   text,
  "departmentId"   uuid,
  "departmentName" text,
  "mediaType"      text,
  "state"          text
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

  -- `organisation` must name a practice, or a NULL id reads as "no filter" and
  -- hands one practice every other practice's figures: a tenancy breach
  -- dressed as a missing parameter.
  IF p_scope = 'organisation' AND p_practice_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    date_trunc('hour', COALESCE(o."sentAt", o."createdAt"))::timestamp(3),
    count(*)::bigint,
    o."practiceId",
    pr."name",
    o."locationId",
    -- A message addressed to the practice itself has no site, and that is a
    -- real answer rather than missing data. The screen says so in words; NULL
    -- here is what lets it.
    loc."code",
    o."departmentId",
    dep."name",
    o."mediaType",
    o."state"
  FROM core.outbound_items o
  JOIN core.practices pr ON pr."id" = o."practiceId"
  LEFT JOIN core.practice_locations loc ON loc."id" = o."locationId"
  LEFT JOIN core.departments dep       ON dep."id" = o."departmentId"
  WHERE (p_scope = 'platform' OR o."practiceId" = p_practice_id)
    AND (p_location_id IS NULL OR o."locationId" = p_location_id)
    AND (p_department_id IS NULL OR o."departmentId" = p_department_id)
    AND (p_from IS NULL OR COALESCE(o."sentAt", o."createdAt") >= v_from)
    AND (p_to   IS NULL OR COALESCE(o."sentAt", o."createdAt") <= v_to)
  GROUP BY 1, o."practiceId", pr."name", o."locationId", loc."code",
           o."departmentId", dep."name", o."mediaType", o."state";
END $$;
