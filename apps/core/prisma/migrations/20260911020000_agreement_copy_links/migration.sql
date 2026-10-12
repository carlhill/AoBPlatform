-- W6 "send me a copy" — REQ-PORT-02, the s 65C copy-on-request obligation
-- automated. The link that carries a signed agreement back to the person who
-- signed it.
--
-- WHAT IS NOT IN THIS TABLE, and the omission is the design: the address. No
-- email column, no mobile column, not even a masked one. `channel` is the TYPE
-- and `recipientType` names the RECORD the address was read from — the
-- patient's own when the patient signed, the assignor's own when somebody else
-- did (ASSIGNOR-RULES rules 5–6). Verification and delivery evidence store
-- identifier types and outcomes, never values (hard rule 9, REQ-VER-04).
--
-- ONLY THE HASH OF THE SECRET IS STORED, exactly as capture tokens and portal
-- activation tokens do it. A database read cannot mint a working link.
--
-- Written to be applied twice (DEV-LOOP.md), and reversible: the down path is
-- the DROP at the foot of this file, commented because Prisma migrations do
-- not run one — nothing else in the schema references this table, so dropping
-- it takes nothing with it.

CREATE TABLE IF NOT EXISTS "agreement_copy_links" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId"     UUID NOT NULL,
  "agreementId"    UUID NOT NULL,
  "tokenHash"      TEXT NOT NULL,
  "channel"        TEXT NOT NULL,
  "optionKey"      TEXT NOT NULL,
  "optionsVersion" TEXT NOT NULL,
  "recipientType"  TEXT NOT NULL,
  "recipientId"    UUID NOT NULL,
  "outboundItemId" UUID,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT now(),
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "firstOpenedAt"  TIMESTAMP(3),
  "lastOpenedAt"   TIMESTAMP(3),
  "openCount"      INTEGER NOT NULL DEFAULT 0,
  "revokedAt"      TIMESTAMP(3)
);

-- The CHECKs are derived from the domain lists they mirror
-- (`COPY_DELIVERY_TRANSPORTS` in packages/domain/src/agreement-copy.ts, and the
-- two records a signer's contact can live on). A third channel is a content
-- change AND a migration, deliberately: the database is the last place that
-- can stop a value nobody wrote code for.
ALTER TABLE "agreement_copy_links" DROP CONSTRAINT IF EXISTS "agreement_copy_links_channel_check";
ALTER TABLE "agreement_copy_links" ADD CONSTRAINT "agreement_copy_links_channel_check"
  CHECK ("channel" IN ('email', 'sms'));

ALTER TABLE "agreement_copy_links" DROP CONSTRAINT IF EXISTS "agreement_copy_links_recipient_type_check";
ALTER TABLE "agreement_copy_links" ADD CONSTRAINT "agreement_copy_links_recipient_type_check"
  CHECK ("recipientType" IN ('patient', 'assignor'));

CREATE UNIQUE INDEX IF NOT EXISTS "agreement_copy_links_tokenHash_key"
  ON "agreement_copy_links" ("tokenHash");
CREATE INDEX IF NOT EXISTS "agreement_copy_links_practiceId_idx"
  ON "agreement_copy_links" ("practiceId");
CREATE INDEX IF NOT EXISTS "agreement_copy_links_agreementId_idx"
  ON "agreement_copy_links" ("agreementId");
CREATE INDEX IF NOT EXISTS "agreement_copy_links_expiresAt_idx"
  ON "agreement_copy_links" ("expiresAt");

-- Practice scoping at the DB layer, fail-closed and FORCEd like every other
-- practice-scoped table. The public endpoint that serves a copy establishes
-- the scope from the token's own routing segment BEFORE it reads anything —
-- the same trick capture and activation tokens use, and the same
-- justification: a practice UUID identifies a business, not a person.
ALTER TABLE "agreement_copy_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agreement_copy_links" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_isolation ON "agreement_copy_links";
CREATE POLICY practice_isolation ON "agreement_copy_links"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

-- DOWN (by hand, DEV-LOOP.md):
--   DROP TABLE IF EXISTS "agreement_copy_links";
