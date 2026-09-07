-- A message about a practitioner's own identity, with no practice to anchor it to.
--
-- WHY THIS WAS MISSING. `practitioner-email.service.ts` dispatches real email
-- for a backup address confirming itself, a new primary proving itself, and
-- the old address and backup being warned -- and never wrote any of it to
-- `outbound_items`. Carl caught it directly: "email messages for backup email
-- not appearing. At least 4 sent and email verified." The messages went out
-- and left no record a practitioner's own "what we have sent you" page could
-- read, because that page is a read over `outbound_items` and nothing was
-- ever inserted.
--
-- WHY IT WAS SKIPPED, and why that reasoning does not hold. The design note
-- on the service said these must NOT be recorded in a practice's queue,
-- because they are about a PERSON and `outbound_items` is practice-anchored --
-- a practice administrator reading their queue must not see a practitioner's
-- personal address-change traffic. True, and it does not follow that nothing
-- should be recorded anywhere: it means the row must not be visible to any
-- PRACTICE, which is a property of practiceId, not a reason to have no row.
--
-- THE FIX ALREADY HALF EXISTED. `practitioner_own_messages` (2026-08-22,
-- practitioner_reporting_scope) already lets a practitioner read outbound
-- rows keyed to `app.practitioner_id`, independent of `practiceId` -- built
-- for exactly this shape and never wired to an INSERT. And
-- `practice_isolation`'s WITH CHECK requires `practiceId = app.practice_id`,
-- so a NULL practiceId can never equal any practice's setting: a personal row
-- is invisible to every practice's queue by the same three-valued-logic rule
-- that made this safe to skip in the first place.

ALTER TABLE "outbound_items" ALTER COLUMN "practiceId" DROP NOT NULL;

-- NULL is legal only for a message that is unambiguously a practitioner's own
-- -- never for a practice's message with the field merely left blank.
ALTER TABLE "outbound_items" ADD CONSTRAINT outbound_items_practiceless_is_personal
  CHECK ("practiceId" IS NOT NULL OR ("recipientType" = 'practitioner' AND "recipientId" IS NOT NULL));

-- `practitioner_own_messages` was SELECT-only (r), because nothing ever wrote
-- through it. Widened to ALL, with an explicit WITH CHECK -- so INSERT is
-- permitted for exactly the row shape the CHECK constraint above requires,
-- and no wider.
DROP POLICY IF EXISTS practitioner_own_messages ON "outbound_items";
CREATE POLICY practitioner_own_messages ON "outbound_items"
  USING ("recipientType" = 'practitioner' AND "recipientId" = NULLIF(current_setting('app.practitioner_id', true), '')::uuid)
  WITH CHECK ("recipientType" = 'practitioner' AND "recipientId" = NULLIF(current_setting('app.practitioner_id', true), '')::uuid);

-- The unique index backing "one live idempotency key" is keyed on
-- (practiceId, idempotencyKey). Postgres unique indexes already treat NULL as
-- distinct from NULL, so many practiceId=NULL rows coexist freely; restated
-- here only as a comment, because the next reader will otherwise wonder.

-- practitioner_message_detail INNER JOINed practices, so a personal row with
-- no practiceId simply vanished from the query -- present in outbound_items,
-- invisible on "what we have sent you". LEFT JOIN, and a name that says what
-- a practice name cannot: this one came from AoBPlatform itself, about your
-- own account, not from anywhere you work.
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
    COALESCE(pr."name", 'AoBPlatform'),
    o."channel",
    o."mediaType",
    o."state",
    COALESCE(o."sentAt", o."createdAt")::timestamp(3),
    o."sentAt",
    o."payload"->>'subject',
    o."payload"->>'body',
    o."payload"->>'sentBy'
  FROM core.outbound_items o
  LEFT JOIN core.practices pr ON pr."id" = o."practiceId"
  WHERE o."recipientType" = 'practitioner'
    AND o."recipientId" = p_practitioner_id
    AND COALESCE(o."sentAt", o."createdAt") >= now() - interval '2 years'
  ORDER BY COALESCE(o."sentAt", o."createdAt") DESC
  LIMIT p_limit;
$$;
