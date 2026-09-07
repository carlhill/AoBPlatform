-- "Who received it" — by TYPE, and only by type.
--
-- Carl asked for practitioner and patient as breakdowns. `outbound_items`
-- already records `recipientType`, `recipientId` and `recipientName`, so there
-- were two ways to answer and they are very different.
--
-- WHAT THIS ADDS: recipientType. How many messages went to practitioners, to
-- patients, to the practice itself. Counts by category, no names, and useful
-- immediately.
--
-- WHAT IT DOES NOT ADD, and will not: recipientName or recipientId.
--
--   * A NAME IN THE REPORTING SURFACE is a name a query engine can be asked to
--     group by, sort by, or filter on. The whole reason it is safe to let Cube
--     compose its own SQL here is that there is nothing in reach worth
--     composing it against, and one name column ends that.
--
--   * PER-PRACTITIONER TOTALS ARE A DIRECTORY. "How many messages went to Dr X"
--     is one join away from "and at which practices", which is precisely the
--     thing the hard rules say must never be answerable. A practice knows who
--     works there; the platform must not be able to assemble the other view.
--
-- A practice wanting per-person figures has them in the console, scoped, with a
-- person's name attached to a decision somebody is accountable for. That is a
-- different kind of surface from a report anybody can slice.

/*
 * DROPPED AND RECREATED, not replaced. `CREATE OR REPLACE VIEW` can only APPEND
 * columns -- inserting one in the middle fails with "cannot change name of view
 * column", because Postgres matches the new definition against the old one
 * positionally. Putting the column at the end to avoid that would order the
 * view by the history of its edits rather than by what belongs together.
 *
 * Dropping costs the grants, so they are reissued below. Nothing else depends
 * on this view.
 */
DROP VIEW IF EXISTS reporting.outbound_messages;

CREATE VIEW reporting.outbound_messages
WITH (security_invoker = true) AS
SELECT
  o."id",
  o."practiceId",
  pr."name"      AS "practiceName",
  o."locationId",
  loc."code"     AS "locationCode",
  o."departmentId",
  dep."name"     AS "departmentName",
  o."channel",
  o."mediaType",
  o."state",

  -- practitioner | patient | practice, or NULL where nothing was recorded.
  -- NULL is left as NULL rather than defaulted to a category: "we did not
  -- record who this went to" is a different fact from "it went to the
  -- practice", and collapsing them would quietly invent data.
  o."recipientType",

  COALESCE(o."sentAt", o."createdAt") AS "occurredAt",
  o."createdAt",
  o."sentAt",
  o."attempts",
  o."resendCount"
FROM core.outbound_items o
JOIN core.practices pr                ON pr."id"  = o."practiceId"
LEFT JOIN core.practice_locations loc ON loc."id" = o."locationId"
LEFT JOIN core.departments dep        ON dep."id" = o."departmentId"
WHERE COALESCE(o."sentAt", o."createdAt") >= now() - interval '2 years';

COMMENT ON VIEW reporting.outbound_messages IS
  'Read by Cube. security_invoker is deliberate: RLS applies to the CONNECTING ROLE, so cube_reader sees only '
  'the practice named in app.practice_id on its connection even if Cube''s own filter is wrong. Recipients '
  'appear by TYPE only -- never by name or id, because a name here is a name a query engine can group by, and '
  'per-practitioner totals are one join from the cross-practice directory the hard rules forbid.';

-- Reissued after the drop. Per object, as before: a future view added to
-- `reporting` is not granted by inheritance.
GRANT SELECT ON reporting.outbound_messages TO cube_reader, cube_platform_reader;
