-- One practitioner's own messages, with what was actually in them.
--
-- WHY THIS IS NOT A CUBE QUERY, and the distinction is the point.
--
-- The reporting layer carries counts and coarse dimensions and NO message
-- content — deliberately, because that is what makes it safe to let a query
-- engine compose its own SQL over it. Adding a body column there to answer
-- "what did it say" would undo the reason the whole arrangement is defensible.
--
-- But a practitioner reading a message SENT TO THEM is not a privacy question
-- at all. They received it; it is in their inbox. The answer is not to widen
-- the reporting surface, it is to answer a different question from a different
-- place: Cube for how many, this for what one said.
--
-- SCOPED THE SAME WAY AS EVERYTHING ELSE OF THEIRS. Keyed on the practitioner
-- id, returning only rows addressed to them. A practitioner cannot ask this for
-- somebody else because the id is not a parameter they supply — it comes off
-- their token.

CREATE OR REPLACE FUNCTION core.practitioner_message_detail(
  p_practitioner_id uuid,
  p_limit           integer DEFAULT 100
)
RETURNS TABLE (
  "id"           uuid,
  "practiceName" text,
  "channel"      text,
  "mediaType"    text,
  "state"        text,
  "occurredAt"   timestamp(3),
  "sentAt"       timestamp(3),
  "subject"      text,
  "body"         text,
  "sentBy"       text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT
    o."id",
    pr."name",
    o."channel",
    o."mediaType",
    o."state",
    COALESCE(o."sentAt", o."createdAt")::timestamp(3),
    o."sentAt",
    o."payload"->>'subject',
    /*
     * MAY BE NULL, and the screen has to say so rather than showing a blank.
     * A message Keycloak sent — an enrolment link — is recorded by us but
     * composed and sent by it, so we hold the subject and never the body.
     * Rendering an empty body would look like a message with nothing in it,
     * which is a different and false statement.
     */
    o."payload"->>'body',
    o."payload"->>'sentBy'
  FROM core.outbound_items o
  JOIN core.practices pr ON pr."id" = o."practiceId"
  WHERE o."recipientType" = 'practitioner'
    AND o."recipientId" = p_practitioner_id
    AND COALESCE(o."sentAt", o."createdAt") >= now() - interval '2 years'
  ORDER BY COALESCE(o."sentAt", o."createdAt") DESC
  LIMIT p_limit;
$$;
