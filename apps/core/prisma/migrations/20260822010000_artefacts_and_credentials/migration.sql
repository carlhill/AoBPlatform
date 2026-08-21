-- CreateTable
CREATE TABLE "practice_credentials" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "credentialType" TEXT NOT NULL,
    "credentialValue" TEXT NOT NULL,
    "label" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByName" TEXT,
    "verificationMethod" TEXT,
    "verificationNote" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedByName" TEXT,

    CONSTRAINT "practice_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artefacts" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "declaredContentType" TEXT,
    "detectedContentType" TEXT NOT NULL,
    "declaredTypeMismatch" BOOLEAN NOT NULL DEFAULT false,
    "filename" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" UUID,
    "uploadedByName" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storageKey" TEXT NOT NULL,
    "retentionExpiryDate" DATE,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "artefacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practice_credentials_practiceId_idx" ON "practice_credentials"("practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "practice_credentials_practiceId_credentialType_credentialVa_key" ON "practice_credentials"("practiceId", "credentialType", "credentialValue");

-- CreateIndex
CREATE INDEX "artefacts_practiceId_idx" ON "artefacts"("practiceId");

-- CreateIndex
CREATE INDEX "artefacts_subjectType_subjectId_idx" ON "artefacts"("subjectType", "subjectId");

-- AddForeignKey
ALTER TABLE "practice_credentials" ADD CONSTRAINT "practice_credentials_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artefacts" ADD CONSTRAINT "artefacts_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- HAND-AUTHORED HALF.
-- ===========================================================================

ALTER TABLE "practice_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "practice_credentials" FORCE ROW LEVEL SECURITY;
ALTER TABLE "artefacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "artefacts" FORCE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON "practice_credentials"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

CREATE POLICY practice_isolation ON "artefacts"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Credentials
-- ---------------------------------------------------------------------------

ALTER TABLE "practice_credentials" DROP CONSTRAINT IF EXISTS credentials_type_known;
ALTER TABLE "practice_credentials" ADD CONSTRAINT credentials_type_known
  CHECK ("credentialType" IN ('ahpra','hpio','accreditation','nash','other'));

ALTER TABLE "practice_credentials" DROP CONSTRAINT IF EXISTS credentials_value_present;
ALTER TABLE "practice_credentials" ADD CONSTRAINT credentials_value_present
  CHECK (COALESCE(btrim("credentialValue"), '') <> '');

-- A VERIFICATION MUST NAME ITS SOURCE AND ITS AUTHOR.
--
-- This is the constraint that makes the strength score mean anything. Points
-- attach to verified credentials, never to entered ones — so "verified" with
-- nobody and no method attached would be a free point for typing, which is
-- exactly the fraud the score exists to resist.
ALTER TABLE "practice_credentials" DROP CONSTRAINT IF EXISTS credentials_verification_is_attributable;
ALTER TABLE "practice_credentials" ADD CONSTRAINT credentials_verification_is_attributable
  CHECK ("verifiedAt" IS NULL
      OR (COALESCE(btrim("verifiedByName"), '') <> '' AND "verificationMethod" IS NOT NULL));

ALTER TABLE "practice_credentials" DROP CONSTRAINT IF EXISTS credentials_verification_method_known;
ALTER TABLE "practice_credentials" ADD CONSTRAINT credentials_verification_method_known
  CHECK ("verificationMethod" IS NULL
      OR "verificationMethod" IN ('ahpra_register','hi_service','accrediting_body','document_sighted'));

-- Carry across whatever the single-pair columns held, so nothing is lost.
INSERT INTO "practice_credentials" ("id", "practiceId", "credentialType", "credentialValue", "addedAt")
SELECT gen_random_uuid(), p."id", p."credentialType", p."credentialValue", p."createdAt"
  FROM "practices" p
 WHERE p."credentialType" IS NOT NULL
   AND COALESCE(btrim(p."credentialValue"), '') <> ''
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Artefacts
-- ---------------------------------------------------------------------------

ALTER TABLE "artefacts" DROP CONSTRAINT IF EXISTS artefacts_purpose_known;
ALTER TABLE "artefacts" ADD CONSTRAINT artefacts_purpose_known
  CHECK ("purpose" IN ('entitlement_call','domain_check','website_capture','credential','identity_document','other'));

-- The allowlist, enforced at the layer that cannot be bypassed by a new caller.
-- SVG and HTML are absent on purpose: they are documents that execute, and an
-- artefact is attacker-supplied content we later hand back to a reviewer's
-- browser.
ALTER TABLE "artefacts" DROP CONSTRAINT IF EXISTS artefacts_content_type_allowed;
ALTER TABLE "artefacts" ADD CONSTRAINT artefacts_content_type_allowed
  CHECK ("detectedContentType" IN ('application/pdf','image/png','image/jpeg','text/plain'));

ALTER TABLE "artefacts" DROP CONSTRAINT IF EXISTS artefacts_sha256_shape;
ALTER TABLE "artefacts" ADD CONSTRAINT artefacts_sha256_shape
  CHECK ("sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "artefacts" DROP CONSTRAINT IF EXISTS artefacts_size_sane;
ALTER TABLE "artefacts" ADD CONSTRAINT artefacts_size_sane
  CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 20971520);

-- A filename must never be able to describe a path. The application sanitises
-- it; this makes the guarantee structural, because the sanitiser is one
-- function and a future caller might not use it.
ALTER TABLE "artefacts" DROP CONSTRAINT IF EXISTS artefacts_filename_is_not_a_path;
ALTER TABLE "artefacts" ADD CONSTRAINT artefacts_filename_is_not_a_path
  CHECK ("filename" !~ '[/\\]' AND "filename" !~ '\.\.' AND COALESCE(btrim("filename"), '') <> '');

-- Deletion is a TOMBSTONE, not a removal. The bytes go; the row, its hash and
-- its provenance stay, so evidence that once existed cannot quietly cease to
-- have existed.
CREATE OR REPLACE FUNCTION prevent_artefact_erasure() RETURNS trigger AS $$
BEGIN
  IF NEW."sha256" IS DISTINCT FROM OLD."sha256"
  OR NEW."uploadedByName" IS DISTINCT FROM OLD."uploadedByName"
  OR NEW."uploadedAt" IS DISTINCT FROM OLD."uploadedAt"
  OR NEW."practiceId" IS DISTINCT FROM OLD."practiceId" THEN
    RAISE EXCEPTION
      'The hash and provenance of an artefact are immutable. To remove the content, tombstone it by setting '
      'deletedAt — the record of what existed, and who supplied it, survives.';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS artefacts_provenance_immutable ON "artefacts";
CREATE TRIGGER artefacts_provenance_immutable
  BEFORE UPDATE ON "artefacts"
  FOR EACH ROW EXECUTE FUNCTION prevent_artefact_erasure();

CREATE FUNCTION refuse_artefact_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Artefacts are not deleted. Tombstone the row (deletedAt, deletedReason) so the hash and provenance '
    'survive — an evidence record that can vanish is not evidence.';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS artefacts_no_delete ON "artefacts";
CREATE TRIGGER artefacts_no_delete
  BEFORE DELETE ON "artefacts"
  FOR EACH ROW EXECUTE FUNCTION refuse_artefact_delete();
