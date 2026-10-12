-- The outbound queue.
--
-- SIZING, because it drove every decision below. Carl models 750,000 notices a
-- day at the top end (30 patients x 25,000 GPs). Over a ~10-hour clinical day
-- that is ~21/second average, with peaks around the end of consultation blocks
-- perhaps 3-5x that. Postgres does not care about those numbers. What matters:
--
--   * 274 million rows a year if nothing is ever removed -> the table MUST be
--     prunable, which it is, because it is transport and not evidence.
--   * The claim query runs constantly and must never table-scan -> partial
--     indexes covering exactly the claimable set.
--   * Two workers must never take the same item -> FOR UPDATE SKIP LOCKED,
--     which needs no extra infrastructure and no coordination.

CREATE TABLE "outbound_items" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId"     UUID NOT NULL,
  "channel"        TEXT NOT NULL,
  "destination"    TEXT,
  "subjectType"    TEXT NOT NULL,
  "subjectId"      UUID NOT NULL,
  "payload"        JSONB NOT NULL,
  "state"          TEXT NOT NULL DEFAULT 'pending',
  "attempts"       INTEGER NOT NULL DEFAULT 0,
  "availableAt"    TIMESTAMP(3) NOT NULL DEFAULT now(),
  "leasedBy"       TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "idempotencyKey" TEXT NOT NULL,
  "lastError"      TEXT,
  "providerRef"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT now(),
  "sentAt"         TIMESTAMP(3)
);

-- One logical send per practice. This is what makes a retry after a crash
-- safe: the same send produces the same key, and the second insert loses.
CREATE UNIQUE INDEX "outbound_items_idempotency_key"
  ON "outbound_items" ("practiceId", "idempotencyKey");

-- THE CLAIM QUERY, which runs continuously. Partial so the index holds only
-- claimable rows -- at steady state that is a small fraction of the table, and
-- the sent majority never enters it.
CREATE INDEX "outbound_items_claimable_idx"
  ON "outbound_items" ("channel", "availableAt")
  WHERE "state" IN ('pending', 'failed');

-- A device asking for ITS practice's work. Same shape, scoped.
CREATE INDEX "outbound_items_device_claim_idx"
  ON "outbound_items" ("practiceId", "channel", "availableAt")
  WHERE "state" IN ('pending', 'failed');

-- Reclaiming after a worker died. Also small: only currently-leased rows.
CREATE INDEX "outbound_items_expired_lease_idx"
  ON "outbound_items" ("leaseExpiresAt")
  WHERE "state" = 'leased';

-- The pruner, and the "what is stuck" view an operator will want.
CREATE INDEX "outbound_items_sent_idx" ON "outbound_items" ("sentAt") WHERE "state" = 'sent';
CREATE INDEX "outbound_items_dead_idx" ON "outbound_items" ("practiceId") WHERE "state" = 'dead';

-- Same fail-closed tenancy as every other table. A queue leaking across
-- practices would leak the CONTENT of notices, which is the worst kind of
-- cross-tenant leak this system could have.
ALTER TABLE "outbound_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbound_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON "outbound_items"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

-- A payload that is not an object is a caller bug, and one that reaches the
-- worker as a surprise at 3am rather than a refusal at the call site.
ALTER TABLE "outbound_items" ADD CONSTRAINT outbound_items_payload_is_object
  CHECK (jsonb_typeof("payload") = 'object');

-- Only a device item may be unaddressed. Enforced here as well as in the
-- domain because an unaddressed email is a row that can never be delivered and
-- will retry eight times discovering that.
ALTER TABLE "outbound_items" ADD CONSTRAINT outbound_items_destination_required
  CHECK ("channel" = 'device' OR "destination" IS NOT NULL);

-- A sent item has a time; an unsent one does not. Cheap, and it catches the
-- class of bug where a worker marks success without stamping when.
ALTER TABLE "outbound_items" ADD CONSTRAINT outbound_items_sent_has_time
  CHECK (("state" = 'sent') = ("sentAt" IS NOT NULL));
