-- Sending volumes over time, for the summary reports.
--
-- RETURNS TIMESTAMPS AND COUNTS, NOT BUCKETS. The bucketing, the week-of-month
-- arithmetic and the two comparison matrices are in
-- packages/domain/src/reporting.ts with tests, and doing them here as well
-- would put the same rules in two languages -- which is how two screens come to
-- disagree about a total. This narrows the rows; the domain shapes them.
--
-- WHY A FUNCTION AT ALL. The platform report spans every organisation and RLS
-- is fail-closed, so a plain query returns nothing without a practice scope --
-- the failure we have hit four times now, always looking like "there is no
-- data". Same justification as outbound_totals_by_org: SECURITY DEFINER,
-- individually reasoned, returning only what the caller's scope allows.
--
-- THE SCOPE IS AN ARGUMENT, NOT A FILTER THE CALLER ADDS. Every branch below
-- narrows by something the server decided from who the caller is. There is no
-- code path that returns everything and leaves the narrowing to the reader.

CREATE OR REPLACE FUNCTION core.outbound_timeseries(
  p_scope        text,
  p_practice_id  uuid    DEFAULT NULL,
  p_location_id  uuid    DEFAULT NULL,
  p_department_id uuid   DEFAULT NULL,
  p_from         timestamp(3) DEFAULT NULL,
  p_to           timestamp(3) DEFAULT NULL
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
BEGIN
  /*
   * A scope we do not recognise returns nothing, rather than falling through
   * to an unfiltered query. The dangerous version of this function is the one
   * where a typo means "everything".
   */
  IF p_scope NOT IN ('platform', 'organisation') THEN
    RETURN;
  END IF;

  /*
   * `organisation` MUST name a practice. Without this an organisation-scoped
   * call with a NULL practice id would read as "no filter" and return every
   * practice's figures to one practice -- a tenancy breach dressed as a
   * missing parameter.
   */
  IF p_scope = 'organisation' AND p_practice_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    -- Truncated to the hour. Finer than any grain we offer, coarse enough that
    -- a two-year report is thousands of rows rather than millions -- and it
    -- keeps the timezone conversion in one place, in the domain.
    date_trunc('hour', COALESCE(o."sentAt", o."createdAt"))::timestamp(3),
    count(*)::bigint,
    o."practiceId",
    o."mediaType",
    o."state"
  FROM core.outbound_items o
  WHERE (p_scope = 'platform' OR o."practiceId" = p_practice_id)
    AND (p_location_id IS NULL OR o."locationId" = p_location_id)
    AND (p_department_id IS NULL OR o."departmentId" = p_department_id)
    -- The two-year limit is applied by the caller and again here. A hand-made
    -- request is still a request.
    AND (p_from IS NULL OR COALESCE(o."sentAt", o."createdAt") >= p_from)
    AND (p_to IS NULL OR COALESCE(o."sentAt", o."createdAt") <= p_to)
  GROUP BY 1, o."practiceId", o."mediaType", o."state";
END $$;

/*
 * NOTE WHAT IS ABSENT: no practitioner or patient branch.
 *
 * Not an oversight, and not laziness. `outbound_items` records what was SENT
 * and to which practice, and carries no practitioner or patient column -- so
 * "my own messages" cannot be answered from this table at all. It has to come
 * from `notices`, which is anchored to the person, and that is a different
 * query with a different privacy story: a practitioner's own totals must never
 * be groupable by organisation, because that answers "which practices does
 * this person work at" to whoever ran the report.
 *
 * Adding a branch here that silently returned nothing would be worse than
 * having none: an empty report reads as "you have sent nothing", which is a
 * claim, and it would be false.
 */
