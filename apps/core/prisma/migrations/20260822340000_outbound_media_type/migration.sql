-- What FORMAT the payload is, as distinct from which CHANNEL carries it.
--
-- `channel` says how it travels (email, webhook, device). `mediaType` says what
-- the thing IS (an email, a JSON document, XML, a PDF, markdown). They are
-- different axes: a JSON document can go to a webhook or sit waiting for a
-- kiosk, and an email may or may not carry an attachment.
--
-- A column rather than a payload field because it is a FILTER, and filtering
-- 274 million rows a year by digging into JSONB is the kind of decision that
-- looks fine at ten thousand rows.

ALTER TABLE "outbound_items"
  ADD COLUMN "mediaType" TEXT NOT NULL DEFAULT 'email',
  -- Set when the payload references a stored file rather than carrying it.
  -- Large content belongs in the artefact store; this is the pointer.
  ADD COLUMN "artefactId" UUID;

-- The queue screen filters on this, scoped to a practice.
CREATE INDEX "outbound_items_media_idx" ON "outbound_items" ("practiceId", "mediaType", "createdAt" DESC);
