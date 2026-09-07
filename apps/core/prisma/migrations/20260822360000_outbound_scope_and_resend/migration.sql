-- Making 375,000 messages a day searchable, and letting one be sent again.
--
-- THE SIZING IS THE WHOLE POINT. A support call arrives: "Dr Sorrell never got
-- the notice about the Yagoona site." Without these columns the only way to
-- answer is to open payloads one at a time, and payloads are the one thing we
-- deliberately do not let anybody search (a body search would let somebody
-- trawl for a patient name across a practice).
--
-- So the ANSWERS live in columns and the CONTENT stays closed:
--   which site      -> locationId, departmentId
--   who it was for  -> recipientType, recipientId, recipientName
--   how many goes   -> resendCount, and resendOfId for the chain
--
-- WHY recipientName IS DENORMALISED. A support call is answered by typing a
-- name, and joining out to practitioners/patients/assignors to resolve one
-- would be three joins on a table with 274 million rows a year. It is also
-- correct evidentially: the name is what the message was ADDRESSED to at the
-- time, which is not necessarily the name that record carries today.

ALTER TABLE "outbound_items"
  ADD COLUMN "locationId"    UUID,
  ADD COLUMN "departmentId"  UUID,
  -- practitioner | patient | assignor | practice | other
  ADD COLUMN "recipientType" TEXT,
  ADD COLUMN "recipientId"   UUID,
  ADD COLUMN "recipientName" TEXT,
  -- The original this is a resend of. NULL on an original.
  ADD COLUMN "resendOfId"    UUID,
  -- On the ORIGINAL: how many times it has been sent again. Both are kept:
  -- the chain answers "when, and by whom, each time", the count answers "how
  -- many" without a subquery on every row of a list.
  ADD COLUMN "resendCount"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "resendReason"  TEXT,
  ADD COLUMN "resendByName"  TEXT;

-- The support-call query: this practice, this site, this person.
CREATE INDEX "outbound_items_scope_idx"
  ON "outbound_items" ("practiceId", "locationId", "createdAt" DESC);

-- "What did we send this person" -- the most common shape of the question.
CREATE INDEX "outbound_items_recipient_idx"
  ON "outbound_items" ("practiceId", "recipientType", "recipientId", "createdAt" DESC);

-- Name search, case-insensitively, without scanning.
CREATE INDEX "outbound_items_recipient_name_idx"
  ON "outbound_items" ("practiceId", lower("recipientName"));

-- Walking a resend chain back to its original.
CREATE INDEX "outbound_items_resend_idx" ON "outbound_items" ("resendOfId") WHERE "resendOfId" IS NOT NULL;

-- A resend must point at something real, and cannot point at itself.
ALTER TABLE "outbound_items" ADD CONSTRAINT outbound_items_resend_not_self
  CHECK ("resendOfId" IS NULL OR "resendOfId" <> "id");

-- A department sits inside a location. A department-scoped message with no
-- location would be unfilterable by site, which is the filter that matters.
ALTER TABLE "outbound_items" ADD CONSTRAINT outbound_items_department_needs_location
  CHECK ("departmentId" IS NULL OR "locationId" IS NOT NULL);
