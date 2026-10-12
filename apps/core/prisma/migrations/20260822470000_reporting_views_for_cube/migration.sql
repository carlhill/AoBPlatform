-- A reporting surface for Cube, with RLS still doing the enforcing.
--
-- THE REQUIREMENT: people and organisations must not see each other's data.
-- Everything below exists to make that true even if something above it is
-- wrong.
--
-- WHY THIS NEEDED THINKING. Cube composes its own SQL -- that is the whole
-- value of it, somebody asks a question we did not anticipate and it writes the
-- query -- and it is also the risk, because whatever Cube can reach it can be
-- asked for. Cube pools connections, so the obvious worry is that our
-- transaction-local `app.practice_id` cannot follow a pooled connection and RLS
-- stops applying, leaving Cube's own config as the only boundary.
--
-- TWO INDEPENDENT LAYERS, so that neither is load-bearing alone:
--
--   1. Cube's queryRewrite injects a mandatory practice filter, from a security
--      context taken off a Keycloak-signed token.
--   2. THIS FILE. The view is `security_invoker`, so the RLS policies of the
--      base tables apply to whoever is querying rather than to the view's
--      owner. Cube connects as a role those policies apply to, on a connection
--      that carries one practice. If the rewrite were ever wrong, the database
--      still returns one practice's rows.
--
-- `security_invoker` is the piece that makes this possible and it is why this
-- needs Postgres 15+. Without it a view runs as its owner, RLS is bypassed,
-- and layer 2 silently does not exist -- which is the worst outcome, because
-- the design would look right.

CREATE SCHEMA IF NOT EXISTS reporting;

/*
 * WHAT WAS SENT, one row per message, stripped to its shape.
 *
 * NOT IN HERE, deliberately: no recipient, no address, no phone number, no
 * message body or subject, no patient, no practitioner, no provider number, no
 * agreement or notice id. Every one of those is answerable in the console, by
 * somebody scoped to it. None is answerable here at any scope.
 *
 * That is the third layer, and the only one that holds if both the others fail:
 * limiting what could leak rather than only who can reach it.
 */
CREATE OR REPLACE VIEW reporting.outbound_messages
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
  -- When the message counts as having happened. Sent if it was sent, created
  -- otherwise, so a pending message appears on the day it was raised rather
  -- than vanishing until it goes.
  COALESCE(o."sentAt", o."createdAt") AS "occurredAt",
  o."createdAt",
  o."sentAt",
  o."attempts",
  -- Resends counted rather than hidden: "we sent this four times" is a
  -- different operational picture from "we sent four things".
  o."resendCount"
FROM core.outbound_items o
JOIN core.practices pr                ON pr."id"  = o."practiceId"
LEFT JOIN core.practice_locations loc ON loc."id" = o."locationId"
LEFT JOIN core.departments dep        ON dep."id" = o."departmentId"
-- Two years, applied here as well as in the API. Retention is not a default
-- somebody widens by asking a different question.
WHERE COALESCE(o."sentAt", o."createdAt") >= now() - interval '2 years';

/*
 * THE TENANT ROLE. RLS applies to it, and that is the point.
 *
 * No BYPASSRLS, and not an owner of anything -- either would switch layer 2
 * off. Cube connects as this role with `app.practice_id` set on the
 * connection, so every query it can compose is already narrowed by the
 * database before Cube's own filter is considered.
 */
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cube_reader') THEN
    CREATE ROLE cube_reader LOGIN PASSWORD 'cube_reader';
  END IF;
END $$;

/*
 * THE PLATFORM ROLE, which necessarily can see across practices -- that is
 * what a platform report is -- and is therefore kept separate rather than
 * being the same role with a wider filter.
 *
 * Separate because the difference between "one practice" and "all practices"
 * should be a different set of database credentials, not a variable. Cube
 * chooses between them from the token's claims, so reaching this one requires
 * a Keycloak-signed platform_admin role rather than a mistake in a filter.
 */
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cube_platform_reader') THEN
    CREATE ROLE cube_platform_reader LOGIN PASSWORD 'cube_platform_reader' BYPASSRLS;
  END IF;
END $$;

REVOKE ALL ON SCHEMA public FROM cube_reader, cube_platform_reader;
GRANT USAGE ON SCHEMA reporting TO cube_reader, cube_platform_reader;
GRANT USAGE ON SCHEMA core      TO cube_reader, cube_platform_reader;

-- Per object, on purpose. A future view added to `reporting` is not granted by
-- this; adding one has to be a decision rather than an inheritance.
GRANT SELECT ON reporting.outbound_messages TO cube_reader, cube_platform_reader;

/*
 * Base-table SELECT is required BECAUSE the view is security_invoker -- the
 * caller's own privileges are what run the query. That is the trade: RLS now
 * applies, and the grant has to be real.
 *
 * It is narrow. Four tables, SELECT only, and every one of them carries an RLS
 * policy that `cube_reader` cannot escape. `cube_platform_reader` can, which
 * is what a platform report is, and is why it is a separate credential.
 */
GRANT SELECT ON core.outbound_items, core.practices, core.practice_locations, core.departments
  TO cube_reader, cube_platform_reader;

COMMENT ON VIEW reporting.outbound_messages IS
  'Read by Cube. security_invoker is deliberate: RLS applies to the CONNECTING ROLE, so cube_reader sees only '
  'the practice named in app.practice_id on its connection even if Cube''s own filter is wrong. Nothing here '
  'identifies a person, which bounds what a failure of both layers could expose.';
