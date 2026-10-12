-- THE STEP BEFORE A TELEHEALTH CONSULTATION (TELEHEALTH-PLAN.md section 8
-- step 2; D-2026-10-11-07 and -08).
--
-- One row per telehealth session: the patient, the practitioner (anchored on
-- the affiliation, as agreements are), who checked identity on the call and
-- WHICH identifier TYPES, the channel, and where the session has got to.
--
-- NO IDENTIFIER VALUE AND NO CONTACT VALUE (hard rules 1 and 9). The link goes
-- to the contact already on the patient record and is never copied here.
-- SECRETS ARE HASHES: link and page keys are sha256 of 256-bit secrets, the
-- 6-digit code is a salted scrypt. The code is never stored in plaintext.
--
-- NO FOREIGN KEYS, like the rest of this family of tables. Scoping is RLS on
-- `practiceId`, FORCEd and fail-closed.
--
-- Idempotent, written to be applied twice (DEV-LOOP.md), and reversible: the
-- down path is at the foot of this file, commented because Prisma migrations
-- do not run one. Nothing else in the schema references this table.

CREATE TABLE IF NOT EXISTS "telehealth_sessions" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId"            UUID NOT NULL,
  "patientId"             UUID NOT NULL,
  "practitionerId"        UUID NOT NULL,
  "affiliationId"         UUID NOT NULL,
  "state"                 TEXT NOT NULL DEFAULT 'opened',
  "identityCheckedByType" TEXT,
  "identityCheckedById"   TEXT,
  "identifierTypes"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "verificationEventId"   UUID,
  "consenterIsPatient"    BOOLEAN,
  "consenterRelationship" TEXT,
  "consenterAttested18"   BOOLEAN,
  "channel"               TEXT,
  "linkTokenHash"         TEXT,
  "linkExpiresAt"         TIMESTAMP(3),
  "linkConsumedAt"        TIMESTAMP(3),
  "linkSentCount"         INTEGER NOT NULL DEFAULT 0,
  "codeHash"              TEXT,
  "codeExpiresAt"         TIMESTAMP(3),
  "codeAttempts"          INTEGER NOT NULL DEFAULT 0,
  "codeLockedAt"          TIMESTAMP(3),
  "codeCheckedAt"         TIMESTAMP(3),
  "pageKeyHash"           TEXT,
  "pageKeyExpiresAt"      TIMESTAMP(3),
  "retiredPageKeyHash"    TEXT,
  "agreedAt"              TIMESTAMP(3),
  "consentKey"            TEXT,
  "contentVersion"        TEXT NOT NULL,
  "notDoneReason"         TEXT,
  "notDoneReasonsVersion" TEXT,
  "notDoneNote"           TEXT,
  "consultationAt"        TIMESTAMP(3),
  "outcomeRecordedAt"     TIMESTAMP(3),
  "outcomeRecordedById"   TEXT,
  "createdById"           TEXT NOT NULL,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"             TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "telehealth_sessions_linkTokenHash_key"
  ON "telehealth_sessions" ("linkTokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "telehealth_sessions_pageKeyHash_key"
  ON "telehealth_sessions" ("pageKeyHash");
CREATE UNIQUE INDEX IF NOT EXISTS "telehealth_sessions_retiredPageKeyHash_key"
  ON "telehealth_sessions" ("retiredPageKeyHash");
CREATE INDEX IF NOT EXISTS "telehealth_sessions_practiceId_practitionerId_createdAt_idx"
  ON "telehealth_sessions" ("practiceId", "practitionerId", "createdAt");
CREATE INDEX IF NOT EXISTS "telehealth_sessions_practiceId_patientId_idx"
  ON "telehealth_sessions" ("practiceId", "patientId");

-- THE LISTS ARE COPIED FROM THE DOMAIN, not a second literal kept in step by
-- memory: `TELEHEALTH_SESSION_STATES`, `TELEHEALTH_CHANNELS` and
-- `APPROVED_IDENTIFIER_TYPES` in `packages/domain/src`. Step 3 adds the DB4
-- states to the domain list AND to this CHECK.
ALTER TABLE "telehealth_sessions" DROP CONSTRAINT IF EXISTS "telehealth_sessions_state_check";
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_state_check"
  CHECK ("state" IN ('opened', 'code_checked', 'agreed', 'not_done', 'did_not_proceed'));

ALTER TABLE "telehealth_sessions" DROP CONSTRAINT IF EXISTS "telehealth_sessions_channel_check";
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_channel_check"
  CHECK ("channel" IS NULL OR "channel" IN ('sms', 'email', 'both'));

ALTER TABLE "telehealth_sessions" DROP CONSTRAINT IF EXISTS "telehealth_sessions_checker_check";
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_checker_check"
  CHECK ("identityCheckedByType" IS NULL OR "identityCheckedByType" IN ('practitioner', 'staff'));

-- HARD RULE 1 AT THE DATABASE: only approved identifier TYPES may be stored,
-- so the Medicare card number cannot reach this column whatever a caller does.
ALTER TABLE "telehealth_sessions" DROP CONSTRAINT IF EXISTS "telehealth_sessions_identifier_types_approved";
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_identifier_types_approved"
  CHECK ("identifierTypes" <@ ARRAY['name', 'date_of_birth', 'gender', 'address', 'patient_record_number', 'ihi']::TEXT[]);

-- A LINK WAS SENT IF AND ONLY IF IDENTITY WAS CHECKED. A session with a link
-- and no check would be a code read out to nobody in particular.
ALTER TABLE "telehealth_sessions" DROP CONSTRAINT IF EXISTS "telehealth_sessions_link_needs_check";
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_link_needs_check"
  CHECK ("linkSentCount" = 0 OR ("identityCheckedById" IS NOT NULL AND cardinality("identifierTypes") >= 3 AND "channel" IS NOT NULL AND "consenterIsPatient" IS NOT NULL));

-- HARD RULE 10 AT THE DATABASE: somebody acting for the patient has said how
-- they are related and has attested they are 18 or over.
ALTER TABLE "telehealth_sessions" DROP CONSTRAINT IF EXISTS "telehealth_sessions_carer_attested";
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_carer_attested"
  -- COALESCE, because NULL = true is NULL and a CHECK passes on NULL: without
  -- it a carer with no attestation at all would get through.
  CHECK ("consenterIsPatient" IS DISTINCT FROM false OR (COALESCE("consenterAttested18", false) = true AND "consenterRelationship" IS NOT NULL));

-- NOT DONE IF AND ONLY IF THERE IS A REASON, and a note only beside a reason.
ALTER TABLE "telehealth_sessions" DROP CONSTRAINT IF EXISTS "telehealth_sessions_not_done_iff_reason";
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_not_done_iff_reason"
  CHECK ((("state" = 'not_done') = ("notDoneReason" IS NOT NULL)) AND ("notDoneNote" IS NULL OR "notDoneReason" IS NOT NULL));

-- AGREED ONLY AFTER THE CODE. The order on the page is enforced here as well.
ALTER TABLE "telehealth_sessions" DROP CONSTRAINT IF EXISTS "telehealth_sessions_agreed_after_code";
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_agreed_after_code"
  CHECK ("agreedAt" IS NULL OR ("codeCheckedAt" IS NOT NULL AND "consentKey" IS NOT NULL));

-- HASHES ARE WHAT THEY SAY, so a raw secret can never be written where a hash goes.
ALTER TABLE "telehealth_sessions" DROP CONSTRAINT IF EXISTS "telehealth_sessions_hashes_are_hashes";
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_hashes_are_hashes"
  CHECK (
    ("linkTokenHash" IS NULL OR "linkTokenHash" ~ '^[0-9a-f]{64}$')
    AND ("pageKeyHash" IS NULL OR "pageKeyHash" ~ '^[0-9a-f]{64}$')
    AND ("retiredPageKeyHash" IS NULL OR "retiredPageKeyHash" ~ '^[0-9a-f]{64}$')
    AND ("codeHash" IS NULL OR "codeHash" ~ '^scrypt\$[0-9]+\$[0-9a-f]{32}\$[0-9a-f]{64}$')
  );

ALTER TABLE "telehealth_sessions" DROP CONSTRAINT IF EXISTS "telehealth_sessions_note_is_short";
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_note_is_short"
  CHECK ("notDoneNote" IS NULL OR char_length("notDoneNote") <= 200);

-- Practice scoping at the DB layer, fail-closed and FORCEd like every other
-- practice-scoped table.
ALTER TABLE "telehealth_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telehealth_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_isolation ON "telehealth_sessions";
CREATE POLICY practice_isolation ON "telehealth_sessions"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

-- The application role, as every table in `core` has it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aob_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "telehealth_sessions" TO aob_app;
  END IF;
END $$;

-- DOWN (not run by Prisma; apply by hand to reverse):
--   DROP POLICY IF EXISTS practice_isolation ON "telehealth_sessions";
--   DROP TABLE IF EXISTS "telehealth_sessions";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261012010000_telehealth_sessions';
