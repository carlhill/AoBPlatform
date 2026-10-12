-- What was sent, as EVIDENCE — CONSULTATION-CAPTURE-PLAN.md Part 4.
--
-- outbound_items is transport and is pruned after thirty days; Notice is
-- durable but is specifically the reg 89AA notice. Everything else the
-- platform sends — confirmations, acting-as notices, invitations, capture
-- links — had no durable record a practice, a doctor or a patient could be
-- shown. This table is the evidence twin of every send: written in the same
-- transaction as the transport row, kept for the retention period, and then
-- tombstoned (text removed, row kept) rather than deleted. legalHold wins.

CREATE TABLE "correspondence" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId"          UUID,
  "recipientType"       TEXT,
  "recipientId"         UUID,
  "recipientName"       TEXT,
  "to"                  TEXT,
  "channel"             TEXT NOT NULL,
  "mediaType"           TEXT NOT NULL DEFAULT 'email',
  "subject"             TEXT,
  "bodyText"            TEXT,
  "bodyHtml"            TEXT,
  "sentBy"              TEXT,
  "subjectType"         TEXT NOT NULL,
  "subjectId"           UUID NOT NULL,
  "outboundItemId"      UUID,
  "noticeId"            UUID,
  "state"               TEXT NOT NULL DEFAULT 'queued',
  "queuedAt"            TIMESTAMP(3) NOT NULL DEFAULT now(),
  "sentAt"              TIMESTAMP(3),
  "deliveredAt"         TIMESTAMP(3),
  "failedAt"            TIMESTAMP(3),
  "failureReason"       TEXT,
  "retentionExpiryDate" DATE,
  "legalHold"           BOOLEAN NOT NULL DEFAULT false,
  "contentRemovedAt"    TIMESTAMP(3)
);

-- One evidence row per send, whichever store the send came from.
CREATE UNIQUE INDEX "correspondence_outboundItemId_key" ON "correspondence" ("outboundItemId");
CREATE UNIQUE INDEX "correspondence_noticeId_key" ON "correspondence" ("noticeId");

CREATE INDEX "correspondence_practiceId_queuedAt_idx" ON "correspondence" ("practiceId", "queuedAt");
CREATE INDEX "correspondence_recipientType_recipientId_queuedAt_idx"
  ON "correspondence" ("recipientType", "recipientId", "queuedAt");
CREATE INDEX "correspondence_subjectType_subjectId_idx" ON "correspondence" ("subjectType", "subjectId");
CREATE INDEX "correspondence_retentionExpiryDate_idx" ON "correspondence" ("retentionExpiryDate");

-- The same rule as outbound_items: a practice-less row is a practitioner's
-- personal message and nothing else.
ALTER TABLE "correspondence" ADD CONSTRAINT correspondence_practiceless_is_personal
  CHECK ("practiceId" IS NOT NULL OR ("recipientType" = 'practitioner' AND "recipientId" IS NOT NULL));
ALTER TABLE "correspondence" ADD CONSTRAINT correspondence_state_known
  CHECK ("state" IN ('queued', 'sent', 'delivered', 'failed', 'dead'));
-- A row must mirror something. Evidence of a message that was not sent by
-- either store is not evidence.
ALTER TABLE "correspondence" ADD CONSTRAINT correspondence_mirrors_a_send
  CHECK ("outboundItemId" IS NOT NULL OR "noticeId" IS NOT NULL);

-- Fail-closed tenancy, as everywhere; plus the practitioner's own rows, keyed
-- on app.practitioner_id alone, exactly as practitioner_own_messages is on
-- outbound_items. A NULL practiceId row can never satisfy practice_isolation
-- (three-valued logic), so the practitioner policy is the only way to it.
ALTER TABLE "correspondence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "correspondence" FORCE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON "correspondence"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

CREATE POLICY practitioner_own_correspondence ON "correspondence"
  USING ("recipientType" = 'practitioner' AND "recipientId" = NULLIF(current_setting('app.practitioner_id', true), '')::uuid)
  WITH CHECK ("recipientType" = 'practitioner' AND "recipientId" = NULLIF(current_setting('app.practitioner_id', true), '')::uuid);

/*
 * A practitioner's messages across every practice — the doctor's view
 * (plan §4.2), a deliberate cross-tenant read individually justified per
 * CONVENTIONS.md §6. Same columns as practitioner_message_detail so the
 * screen that reads it does not change; a different table underneath, one
 * that is not pruned at thirty days.
 */
CREATE OR REPLACE FUNCTION core.practitioner_correspondence_detail(
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
    c."id",
    COALESCE(pr."name", 'AoBPlatform'),
    c."channel",
    c."mediaType",
    c."state",
    COALESCE(c."sentAt", c."queuedAt")::timestamp(3),
    c."sentAt",
    c."subject",
    -- Tombstoned text is gone; the row says so rather than showing nothing.
    CASE WHEN c."contentRemovedAt" IS NOT NULL THEN NULL ELSE c."bodyText" END,
    c."sentBy"
  FROM core.correspondence c
  LEFT JOIN core.practices pr ON pr."id" = c."practiceId"
  WHERE c."recipientType" = 'practitioner'
    AND c."recipientId" = p_practitioner_id
  ORDER BY COALESCE(c."sentAt", c."queuedAt") DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION core.practitioner_correspondence_detail(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.practitioner_correspondence_detail(uuid, integer) TO aob_app;

/*
 * BACKFILL, once. Everything still in outbound_items becomes evidence, so
 * nobody's history is shorter after this migration than before it. The
 * retention expiry uses the default two years from when it went; rows written
 * from now on take the configured value. ON CONFLICT so re-running is safe.
 */
INSERT INTO "correspondence" (
  "practiceId", "recipientType", "recipientId", "recipientName", "to", "channel", "mediaType",
  "subject", "bodyText", "bodyHtml", "sentBy", "subjectType", "subjectId", "outboundItemId",
  "state", "queuedAt", "sentAt", "failedAt", "failureReason", "retentionExpiryDate"
)
SELECT
  o."practiceId", o."recipientType", o."recipientId", o."recipientName", o."destination", o."channel", o."mediaType",
  o."payload"->>'subject', o."payload"->>'body', o."payload"->>'html', o."payload"->>'sentBy',
  o."subjectType", o."subjectId", o."id",
  CASE o."state" WHEN 'sent' THEN 'sent' WHEN 'dead' THEN 'dead' WHEN 'failed' THEN 'failed' ELSE 'queued' END,
  o."createdAt", o."sentAt",
  CASE WHEN o."state" IN ('failed', 'dead') THEN o."createdAt" ELSE NULL END,
  CASE WHEN o."state" IN ('failed', 'dead') THEN o."lastError" ELSE NULL END,
  (COALESCE(o."sentAt", o."createdAt") + interval '2 years')::date
FROM "outbound_items" o
ON CONFLICT ("outboundItemId") DO NOTHING;
