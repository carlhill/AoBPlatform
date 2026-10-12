-- AN UNSIGNED PRE-AGREEMENT, ASSOCIATED WITH THE SERVICE ITS VISIT BECAME
-- (D-2026-10-10-09; Carl, 10 Oct 2026: option (b), "associate, do not link").
--
-- `service_records."agreementId"` is left alone: it is the agreement a claim
-- is reconciled against, and the post-service cascade reads a non-null value
-- as "already covered". This table records the separate fact that an unsigned
-- `episodic_pre` was for the visit a service record records.
--
-- ONE EACH WAY. One service per draft and one draft per service, by two
-- UNIQUE indexes. `how` is `automatic` (exactly one draft matched when the
-- service arrived) or `chosen` (a person picked one on Reconciliation), and a
-- chosen row names the person by token subject while an automatic one names
-- nobody.
--
-- FOREIGN KEYS, ON DELETE CASCADE. Agreements and service records are never
-- hard-deleted in production (deletion is crypto-shredding plus a tombstone,
-- hard rule 11), so the cascade only ever fires in a test teardown; the
-- association's evidence is its vault event, which no delete reaches.
--
-- Idempotent, written to be applied twice (DEV-LOOP.md), and reversible: the
-- down path is at the foot of this file, commented because Prisma migrations
-- do not run one.

CREATE TABLE IF NOT EXISTS "pre_agreement_associations" (
  "id"                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId"              UUID NOT NULL,
  "agreementId"             UUID NOT NULL,
  "serviceRecordId"         UUID NOT NULL,
  "how"                     TEXT NOT NULL,
  "candidateCount"          INTEGER NOT NULL,
  "associatedByPrincipalId" TEXT,
  "createdAt"               TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "pre_agreement_associations_agreementId_key"
  ON "pre_agreement_associations" ("agreementId");
CREATE UNIQUE INDEX IF NOT EXISTS "pre_agreement_associations_serviceRecordId_key"
  ON "pre_agreement_associations" ("serviceRecordId");
CREATE INDEX IF NOT EXISTS "pre_agreement_associations_practiceId_idx"
  ON "pre_agreement_associations" ("practiceId");

ALTER TABLE "pre_agreement_associations" DROP CONSTRAINT IF EXISTS "pre_agreement_associations_agreementId_fkey";
ALTER TABLE "pre_agreement_associations" ADD CONSTRAINT "pre_agreement_associations_agreementId_fkey"
  FOREIGN KEY ("agreementId") REFERENCES "agreements" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pre_agreement_associations" DROP CONSTRAINT IF EXISTS "pre_agreement_associations_serviceRecordId_fkey";
ALTER TABLE "pre_agreement_associations" ADD CONSTRAINT "pre_agreement_associations_serviceRecordId_fkey"
  FOREIGN KEY ("serviceRecordId") REFERENCES "service_records" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- THE LIST IS COPIED FROM THE DOMAIN, not a second literal kept in step by
-- memory: `PRE_AGREEMENT_ASSOCIATION_HOW` in
-- `packages/domain/src/pre-agreement-association.ts`. Adding a value is a
-- domain change AND a migration.
ALTER TABLE "pre_agreement_associations" DROP CONSTRAINT IF EXISTS "pre_agreement_associations_how_check";
ALTER TABLE "pre_agreement_associations" ADD CONSTRAINT "pre_agreement_associations_how_check"
  CHECK ("how" IN ('automatic', 'chosen'));

-- A PERSON IF AND ONLY IF A PERSON CHOSE. An automatic association with a
-- name on it would be a witness the platform invented; a chosen one without
-- a name would be a choice nobody made.
ALTER TABLE "pre_agreement_associations" DROP CONSTRAINT IF EXISTS "pre_agreement_associations_chooser_iff_chosen";
ALTER TABLE "pre_agreement_associations" ADD CONSTRAINT "pre_agreement_associations_chooser_iff_chosen"
  CHECK (("how" = 'chosen') = ("associatedByPrincipalId" IS NOT NULL));

-- AUTOMATIC MEANS EXACTLY ONE MATCHED (D-2026-10-10-09: more than one, and
-- nothing is associated automatically).
ALTER TABLE "pre_agreement_associations" DROP CONSTRAINT IF EXISTS "pre_agreement_associations_candidates_sane";
ALTER TABLE "pre_agreement_associations" ADD CONSTRAINT "pre_agreement_associations_candidates_sane"
  CHECK ("candidateCount" >= 1 AND ("how" <> 'automatic' OR "candidateCount" = 1));

-- Practice scoping at the DB layer, fail-closed and FORCEd like every other
-- practice-scoped table.
ALTER TABLE "pre_agreement_associations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pre_agreement_associations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_isolation ON "pre_agreement_associations";
CREATE POLICY practice_isolation ON "pre_agreement_associations"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);


-- DOWN (run by hand to reverse; nothing else in the schema references this table):
-- DROP TABLE IF EXISTS "pre_agreement_associations";
