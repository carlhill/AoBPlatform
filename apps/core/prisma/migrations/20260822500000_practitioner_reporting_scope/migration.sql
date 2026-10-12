-- A practitioner reading their OWN figures, across every practice they work at.
--
-- THE AWKWARD SHAPE: a practitioner is not scoped to a practice. They work at
-- several, which ones changes, and "what was sent to me" spans all of them. Our
-- RLS is keyed on `app.practice_id`, so a practitioner-scoped connection has no
-- practice to name and reads nothing — fail-closed, and in this case fail-wrong.
--
-- THE TEMPTING ANSWER IS TO USE THE PLATFORM CREDENTIAL AND FILTER IN CUBE.
-- That would put every practitioner's data one config mistake from every other
-- practitioner, and take the database out of the argument entirely. It is the
-- exact trade we refused when the same question came up for practices.
--
-- SO: a second RLS policy, on the same table, keyed on a different setting.
-- Policies are OR'd, so a connection carrying `app.practitioner_id` sees that
-- practitioner's rows wherever they are, and a connection carrying
-- `app.practice_id` sees that practice's rows, and a connection carrying
-- neither still sees nothing. The database stays the enforcer for both.
--
-- WHY THIS IS NOT A HOLE. The setting is only ever put on a connection from a
-- verified token's `practitioner_id` claim, exactly as the practice one is. And
-- what it grants is narrow by construction: rows ADDRESSED TO that practitioner.
-- It cannot reach a practice's other messages, its other people, or anything
-- about a practice beyond the fact that it wrote to them -- which they know,
-- because they received it.

CREATE POLICY practitioner_own_messages ON "outbound_items"
  FOR SELECT
  USING (
    "recipientType" = 'practitioner'
    AND "recipientId" = NULLIF(current_setting('app.practitioner_id', true), '')::uuid
  );

/*
 * THEIR OWN VIEW, and it is not the practice one with a filter.
 *
 * A practitioner may see WHAT was sent to them and WHEN, and which practice
 * sent it -- they already know, it arrived from that practice. They may not see
 * the practice's other traffic, so `recipientName` is absent: it would only
 * ever be their own name, and its presence would invite somebody to group by it
 * later and quietly widen the surface.
 */
CREATE OR REPLACE VIEW reporting.my_messages
WITH (security_invoker = true) AS
SELECT
  o."id",
  o."recipientId" AS "practitionerId",
  o."practiceId",
  pr."name"       AS "practiceName",
  loc."code"      AS "locationCode",
  o."channel",
  o."mediaType",
  o."state",
  COALESCE(o."sentAt", o."createdAt") AS "occurredAt",
  o."createdAt",
  o."sentAt"
FROM core.outbound_items o
JOIN core.practices pr                ON pr."id"  = o."practiceId"
LEFT JOIN core.practice_locations loc ON loc."id" = o."locationId"
WHERE o."recipientType" = 'practitioner'
  AND COALESCE(o."sentAt", o."createdAt") >= now() - interval '2 years';

/*
 * A THIRD CREDENTIAL, because a practitioner is a third kind of caller.
 *
 * No BYPASSRLS -- the whole point is that the policy above does the work. It
 * needs SELECT on `practices` and `practice_locations` to resolve names, and
 * those are RLS-protected too, so the policy pair has to admit it. See below.
 */
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cube_practitioner_reader') THEN
    CREATE ROLE cube_practitioner_reader LOGIN PASSWORD 'cube_practitioner_reader';
  END IF;
END $$;

/*
 * A PRACTITIONER MAY READ THE NAME OF A PRACTICE THAT WROTE TO THEM, and only
 * one that did. Expressed as a join back through their own messages rather than
 * as a blanket read of `practices`, so the set is exactly "practices I have
 * heard from" and moves when that does.
 */
CREATE POLICY practitioner_visible_practices ON "practices"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM core.outbound_items o
      WHERE o."practiceId" = "practices"."id"
        AND o."recipientType" = 'practitioner'
        AND o."recipientId" = NULLIF(current_setting('app.practitioner_id', true), '')::uuid
    )
  );

CREATE POLICY practitioner_visible_locations ON "practice_locations"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM core.outbound_items o
      WHERE o."locationId" = "practice_locations"."id"
        AND o."recipientType" = 'practitioner'
        AND o."recipientId" = NULLIF(current_setting('app.practitioner_id', true), '')::uuid
    )
  );

REVOKE ALL ON SCHEMA public FROM cube_practitioner_reader;
GRANT USAGE ON SCHEMA reporting, core TO cube_practitioner_reader;
GRANT SELECT ON reporting.my_messages TO cube_practitioner_reader;
GRANT SELECT ON core.outbound_items, core.practices, core.practice_locations TO cube_practitioner_reader;

-- Not granted the practice-facing view. A practitioner asking the practice
-- question should get "no such thing", not an empty answer that looks like the
-- practice sent nothing.
REVOKE ALL ON reporting.outbound_messages FROM cube_practitioner_reader;

COMMENT ON VIEW reporting.my_messages IS
  'One practitioner''s own messages, across every practice they work at. security_invoker with a policy keyed '
  'on app.practitioner_id, so the database — not Cube — is what stops one practitioner reading another''s. '
  'Carries no recipient name: it would only ever be their own, and its presence would invite a later grouping '
  'that widened the surface.';
