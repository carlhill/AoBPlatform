-- THE FULL AGREEMENT: LETTERHEAD, TEMPLATE WORDS, AND THE VERSIONS OF BOTH
-- (Carl, 5 Sep 2026; PMS_to_AoB_Workflow.md W1).
--
-- WHAT WAS WRONG BEFORE THIS. The rendered agreement carried the patient's
-- name and a list of keys. Two consequences, and the second is the serious
-- one. A patient signed a page that did not look like an agreement; and
-- because the render input was a payload that did not contain the practice,
-- the words or most of the data set, CORRECTING A DETAIL CHANGED NO BYTE
-- (the 4 September note). A hash over an incomplete payload cannot detect a
-- change to what it omits, which is the whole job of hard rule 13.
--
-- SO THE HASHED UNIT IS NOW THE WHOLE DOCUMENT, stored in `renderPayload`:
-- letterhead, resolved template words and particulars together. `particulars`
-- is untouched and still means exactly what it meant — the s 65C snapshot the
-- rules engine validated. Agreements locked before today keep `renderPayload`
-- NULL and keep re-verifying under `pdf-1`, which is why renderers are
-- versioned content rather than edited in place (rules 13 and 14).
--
-- THE THREE NEW VERSION COLUMNS ON `agreements` sit beside `ruleSetVersion`
-- and `mappingVersion` for the same reason those exist: regulatory whipsaw is
-- the top project risk and versioning is the defence. A stored agreement now
-- says which WORDS it was made from and which LETTERHEAD was on it, so a
-- question asked in 2028 has an answer that does not depend on what the
-- practice's settings happen to say then.
--
-- `practice_agreement_templates` IS THE PER-PRACTICE WORDING, and its shape
-- encodes the one rule that matters about it: A PRACTICE CANNOT ACTIVATE ITS
-- OWN LEGAL COPY. Activation is a platform-operator act, and the CHECK
-- constraint below refuses a row that claims to be active without a named
-- reviewer. The service refuses it earlier and more politely; this is the line
-- that holds when a future code path forgets.
--
-- NO BENEFIT AMOUNT, NO PRACTITIONER SIGNATURE, NO MEDICARE NUMBER can reach
-- any of these columns: the template loader refuses them in the body before it
-- is stored, and the renderer refuses them again against the substituted
-- values before anything is hashed (hard rules 1, 3, 4, 12).
--
-- IDEMPOTENT AND REVERSIBLE (DEV-LOOP.md). Every column is additive and
-- nullable or defaulted; the one new table is new. The reversal is at the foot
-- of this file and is by hand, deliberately.

-- --- The rendered document, and the versions that produced it -------------
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "renderPayload"   JSONB;
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "templateId"      TEXT;
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "templateVersion" TEXT;
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "letterheadHash"  TEXT;

-- --- The practice's letterhead logo ---------------------------------------
-- A REFERENCE, NEVER BYTES. The image lives in the artefact store, addressed
-- by content hash; these columns say which one is current. Clearing the logo
-- clears the POINTER and never deletes the artefact — agreements signed under
-- that letterhead have to keep re-verifying (rule 11, rule 13).
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "logoArtefactId"  UUID;
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "logoSha256"      TEXT;
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "logoContentType" TEXT;
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "logoWidthPx"     INTEGER;
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "logoHeightPx"    INTEGER;
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "logoUpdatedAt"   TIMESTAMP(3);
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "logoUpdatedBy"   TEXT;

-- THE PURPOSE ALLOWLIST, BROUGHT BACK INTO LINE WITH THE DOMAIN — again.
--
-- `artefacts_purpose_known` is a CHECK the domain's `ARTEFACT_PURPOSES` list
-- has now outgrown twice. Adding a purpose in TypeScript and not here means the
-- code believes in something the database refuses, and it is discovered as a
-- 500 at the moment somebody uploads. Dropped and recreated rather than
-- amended, which is also what makes it safe to apply twice.
ALTER TABLE "artefacts" DROP CONSTRAINT IF EXISTS artefacts_purpose_known;
ALTER TABLE "artefacts" ADD CONSTRAINT artefacts_purpose_known
  CHECK ("purpose" IN (
    'entitlement_call','domain_check','website_capture','credential','identity_document',
    'address_evidence','signature_raster','signature_vector','practice_logo','other'));

-- --- What the assignor actually ticked ------------------------------------
-- KEYS, NEVER TEXT (`episodic_assign_v1`). The words are in the template, at
-- the version the agreement records; storing them again here would be a second
-- copy that could disagree with the document the person read.
ALTER TABLE "signature_events" ADD COLUMN IF NOT EXISTS "affirmations" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "signature_events" ADD COLUMN IF NOT EXISTS "templateId"      TEXT;
ALTER TABLE "signature_events" ADD COLUMN IF NOT EXISTS "templateVersion" TEXT;

-- --- Per-practice wording --------------------------------------------------
CREATE TABLE IF NOT EXISTS "practice_agreement_templates" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId"      UUID NOT NULL,
  -- episodic | enduring. The two instruments; see packages/domain.
  "agreementType"   TEXT NOT NULL,
  -- Minted by the practice, e.g. `testville-episodic-1`. Recorded on every
  -- agreement made from it, so a rewrite mints a new version rather than
  -- silently changing what an old record says it was made from.
  "version"         TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'draft',
  -- The template body, in the same schema as the generic content file and
  -- validated against the same loader before it is written.
  "body"            JSONB NOT NULL,
  "notes"           TEXT,
  "submittedByName" TEXT,
  "submittedAt"     TIMESTAMP(3),
  -- The PLATFORM principal who read the words. Never a practice user.
  "reviewedByName"  TEXT,
  "reviewedAt"      TIMESTAMP(3),
  "reviewNotes"     TEXT,
  "activatedAt"     TIMESTAMP(3),
  "retiredAt"       TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "practice_agreement_templates_version_key"
  ON "practice_agreement_templates" ("practiceId", "agreementType", "version");

-- ONE ACTIVE VARIANT PER TYPE PER PRACTICE. Two would mean the platform
-- choosing which words a patient reads, which is not a choice software gets
-- to make.
CREATE UNIQUE INDEX IF NOT EXISTS "practice_agreement_templates_one_active"
  ON "practice_agreement_templates" ("practiceId", "agreementType")
  WHERE "status" = 'active';

CREATE INDEX IF NOT EXISTS "practice_agreement_templates_practice_idx"
  ON "practice_agreement_templates" ("practiceId", "agreementType");

-- The review queue reads across practices, so it needs an index that is not
-- practice-scoped. (It runs as a platform operator; RLS below still applies,
-- and the platform read path sets no practice scope — see the service.)
CREATE INDEX IF NOT EXISTS "practice_agreement_templates_status_idx"
  ON "practice_agreement_templates" ("status", "submittedAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practice_templates_type_known') THEN
    ALTER TABLE "practice_agreement_templates" ADD CONSTRAINT practice_templates_type_known
      CHECK ("agreementType" IN ('episodic', 'enduring'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practice_templates_status_known') THEN
    ALTER TABLE "practice_agreement_templates" ADD CONSTRAINT practice_templates_status_known
      CHECK ("status" IN ('draft', 'in_review', 'active', 'retired'));
  END IF;

  -- A PRACTICE CANNOT ACTIVATE ITS OWN LEGAL COPY. Regulatory wording is read
  -- by a person with the standing to read it; "active with nobody having
  -- reviewed it" is the state this table exists to make impossible.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practice_templates_active_was_reviewed') THEN
    ALTER TABLE "practice_agreement_templates" ADD CONSTRAINT practice_templates_active_was_reviewed
      CHECK (
        "status" <> 'active'
        OR ("reviewedByName" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "activatedAt" IS NOT NULL)
      );
  END IF;

  -- A variant in review is one somebody actually submitted.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practice_templates_in_review_was_submitted') THEN
    ALTER TABLE "practice_agreement_templates" ADD CONSTRAINT practice_templates_in_review_was_submitted
      CHECK ("status" = 'draft' OR "submittedAt" IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practice_templates_version_present') THEN
    ALTER TABLE "practice_agreement_templates" ADD CONSTRAINT practice_templates_version_present
      CHECK (length(trim("version")) > 0);
  END IF;
END
$$;

-- Practice scoping at the DB layer, FORCE so it applies to the owner too.
ALTER TABLE "practice_agreement_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "practice_agreement_templates" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS practice_isolation ON "practice_agreement_templates";
CREATE POLICY practice_isolation ON "practice_agreement_templates"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

-- --- The platform reviewer's queue, across every practice ------------------
--
-- WHY SECURITY DEFINER, WRITTEN DOWN AS CONVENTIONS.md 6 REQUIRES.
--
-- This answers a question no tenant can ask: "across every practice, whose
-- agreement wording is waiting to be read". A platform reviewer has no
-- practice context by definition, so RLS cannot express it — there is no
-- single app.practice_id that would be correct.
--
-- WHAT KEEPS IT NARROW:
--   1. READ ONLY. Activation is a WRITE and goes the ordinary way, inside
--      `withPractice(practiceId)` — a reviewer acts on ONE practice's row at a
--      time, and the scope is the practice named in the URL.
--   2. Only wording that has been SUBMITTED, plus what is currently active.
--      A practice's private drafts are not the platform's business.
--   3. It carries no patient data of any kind. A practice name, a type, a
--      version, a date, and the words themselves — which the template loader
--      has already refused to let carry an amount, a practitioner signature or
--      a Medicare number (hard rules 1, 3, 4).
CREATE OR REPLACE FUNCTION agreement_templates_awaiting_review()
RETURNS TABLE (
  "id"              uuid,
  "practiceId"      uuid,
  "practiceName"    text,
  "agreementType"   text,
  "version"         text,
  "status"          text,
  "body"            jsonb,
  "notes"           text,
  "submittedByName" text,
  "submittedAt"     timestamp(3),
  "reviewedByName"  text,
  "reviewNotes"     text,
  "activatedAt"     timestamp(3)
) AS $fn$
  SELECT t."id", t."practiceId", COALESCE(p."legalName", p."name"), t."agreementType", t."version",
         t."status", t."body", t."notes", t."submittedByName", t."submittedAt",
         t."reviewedByName", t."reviewNotes", t."activatedAt"
  FROM "practice_agreement_templates" t
  JOIN "practices" p ON p."id" = t."practiceId"
  WHERE t."status" IN ('in_review', 'active')
  ORDER BY t."status" ASC, t."submittedAt" ASC NULLS LAST;
$fn$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Reverse (by hand, deliberately — this project does not run down-migrations
-- automatically, and a reversal that runs itself on a bad deploy is how a
-- column full of live evidence disappears):
--
--   DROP FUNCTION IF EXISTS agreement_templates_awaiting_review();
--   DROP TABLE IF EXISTS "practice_agreement_templates";
--   ALTER TABLE "signature_events"
--     DROP COLUMN IF EXISTS "affirmations",
--     DROP COLUMN IF EXISTS "templateId",
--     DROP COLUMN IF EXISTS "templateVersion";
--   ALTER TABLE "practices"
--     DROP COLUMN IF EXISTS "logoArtefactId",
--     DROP COLUMN IF EXISTS "logoSha256",
--     DROP COLUMN IF EXISTS "logoContentType",
--     DROP COLUMN IF EXISTS "logoWidthPx",
--     DROP COLUMN IF EXISTS "logoHeightPx",
--     DROP COLUMN IF EXISTS "logoUpdatedAt",
--     DROP COLUMN IF EXISTS "logoUpdatedBy";
--   ALTER TABLE "agreements"
--     DROP COLUMN IF EXISTS "renderPayload",
--     DROP COLUMN IF EXISTS "templateId",
--     DROP COLUMN IF EXISTS "templateVersion",
--     DROP COLUMN IF EXISTS "letterheadHash";
--
-- Reversing loses the per-practice wording and the version trail; agreements
-- locked under `pdf-2` would no longer re-verify, because their render input
-- would be gone. That is a real consequence, stated rather than hidden.
