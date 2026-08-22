-- The recipient's NAME, so a report can be broken down per practitioner.
--
-- Asked for explicitly, and reasoned through rather than waved in.
--
-- WHAT THIS DOES NOT CHANGE: the boundary that matters. `cube_reader` still has
-- RLS applied to it and is still pinned to one practice on its connection, so a
-- practice sees the names of ITS OWN people and nobody else's. Those are names
-- it already has on its affiliations screen. Nothing here lets one practice see
-- another's, and the isolation tests now assert that about names specifically.
--
-- WHAT IT DOES CHANGE, stated plainly so nobody has to rediscover it: a
-- PLATFORM report can now group by practitioner name across practices, which
-- assembles "who works where". That is the cross-practice directory the hard
-- rules are about.
--
-- It is accepted here for two reasons. The platform credential already carries
-- BYPASSRLS and could assemble the same list directly from the tables, so this
-- adds convenience rather than capability. And the rule's actual subject is the
-- PROVIDER NUMBER -- which is not here, is not in this view, and is not going
-- to be: a name plus a practice is an employment fact the practice itself
-- publishes, while a provider number plus a practice is the billing identity
-- the whole regime is built to protect.
--
-- If platform-side grouping by name later needs stopping, the place to do it is
-- Cube's queryRewrite for the platform context -- not by removing the column,
-- which would take it from practices who are entitled to it.

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
  -- NULL stays NULL: "we did not record who this went to" is a different fact
  -- from "it went to the practice", and collapsing them invents data.
  o."recipientType",
  -- Whose name it was. Scoped by the same RLS as every other column here.
  o."recipientName",

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
  'the practice named in app.practice_id on its connection -- including recipient names, which are therefore '
  'never visible across a practice boundary. Still carries NO provider number, no message body and no '
  'identifiers; a name plus a practice is an employment fact, a provider number plus a practice is not.';

GRANT SELECT ON reporting.outbound_messages TO cube_reader, cube_platform_reader;
