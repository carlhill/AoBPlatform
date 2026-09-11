-- THE DRAWN SIGNATURE, ACTUALLY STORED (REQ-SIG-01/-02).
--
-- The kiosk's pad captured stroke points and a PNG and uploaded NEITHER,
-- because `SignDto` took a method, a channel and a capture request and no
-- payload. So a signature recorded as `drawn` bound the rendered agreement's
-- hash, the versions and the verification event — and not the mark the person
-- made. In a dispute that is a tap-to-approve in disguise.
--
-- Eight nullable columns, no backfill, nothing rewritten. Null is the honest
-- value for every signature already stored and for every method that has no
-- mark to store: tap-to-approve is a real signature (REQ-SIG-01) and draws
-- nothing.
--
--   signatureRasterArtefactId / Sha256   the PNG the pad produced
--   signatureVectorArtefactId / Sha256   the strokes, with their timing,
--                                        exactly as captured — no smoothing,
--                                        no resampling, and never a biometric
--                                        template
--   padWidth / padHeight                 the logical size the coordinates were
--                                        captured against; without it the
--                                        vector cannot be redrawn at any other
--                                        size
--   strokeCount / pointCount             shape only. Never a score: this
--                                        platform stores the signals and does
--                                        not judge them
--
-- THE HASHES ARE HERE, THE BYTES ARE NOT. The content goes to the encrypted
-- artefact store under the existing `artefacts` path; this row and the vault
-- event hold its identity. Same division as `renderedArtefactHash` on an
-- agreement (REQ-LOG-08).
--
-- NO FOREIGN KEY TO `artefacts`, deliberately, and for the reason `artefacts`
-- itself has none to `practices`: both tables are append-only evidence, and a
-- foreign key between two things that can never be deleted only adds a way for
-- a tombstone to fail. The binding that matters is the HASH, which survives
-- the content being crypto-shredded.
--
-- Written to be applied twice (DEV-LOOP.md).

ALTER TABLE "signature_events" ADD COLUMN IF NOT EXISTS "signatureRasterArtefactId" UUID;
ALTER TABLE "signature_events" ADD COLUMN IF NOT EXISTS "signatureRasterSha256" TEXT;
ALTER TABLE "signature_events" ADD COLUMN IF NOT EXISTS "signatureVectorArtefactId" UUID;
ALTER TABLE "signature_events" ADD COLUMN IF NOT EXISTS "signatureVectorSha256" TEXT;
ALTER TABLE "signature_events" ADD COLUMN IF NOT EXISTS "padWidth" DOUBLE PRECISION;
ALTER TABLE "signature_events" ADD COLUMN IF NOT EXISTS "padHeight" DOUBLE PRECISION;
ALTER TABLE "signature_events" ADD COLUMN IF NOT EXISTS "strokeCount" INTEGER;
ALTER TABLE "signature_events" ADD COLUMN IF NOT EXISTS "pointCount" INTEGER;

DO $$
BEGIN
  -- A HASH IS A HASH. A column that can hold "pending" or an empty string is a
  -- column a later reader has to guess about, and the guess would be about
  -- whether a signature was bound to its own image.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_events_raster_sha_shape') THEN
    ALTER TABLE "signature_events" ADD CONSTRAINT signature_events_raster_sha_shape
      CHECK ("signatureRasterSha256" IS NULL OR "signatureRasterSha256" ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_events_vector_sha_shape') THEN
    ALTER TABLE "signature_events" ADD CONSTRAINT signature_events_vector_sha_shape
      CHECK ("signatureVectorSha256" IS NULL OR "signatureVectorSha256" ~ '^[0-9a-f]{64}$');
  END IF;

  -- BOTH HALVES OR NEITHER. REQ-SIG-01 says vector AND raster; a row holding
  -- one of them is a drawn signature that half survived, and nothing in the
  -- code should be able to produce one. Enforced in the database because a
  -- rule enforced only in a service is a rule until the next caller.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_events_both_halves_or_neither') THEN
    ALTER TABLE "signature_events" ADD CONSTRAINT signature_events_both_halves_or_neither
      CHECK (("signatureRasterSha256" IS NULL) = ("signatureVectorSha256" IS NULL));
  END IF;

  -- AN ARTEFACT ID WITHOUT ITS HASH IS A POINTER WITH NOTHING TO CHECK IT
  -- AGAINST — which is precisely what rule 13 exists to prevent.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_events_raster_id_with_hash') THEN
    ALTER TABLE "signature_events" ADD CONSTRAINT signature_events_raster_id_with_hash
      CHECK (("signatureRasterArtefactId" IS NULL) = ("signatureRasterSha256" IS NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_events_vector_id_with_hash') THEN
    ALTER TABLE "signature_events" ADD CONSTRAINT signature_events_vector_id_with_hash
      CHECK (("signatureVectorArtefactId" IS NULL) = ("signatureVectorSha256" IS NULL));
  END IF;

  -- COORDINATES MEAN NOTHING WITHOUT THE PAD THEY WERE MEASURED ON.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_events_pad_size_with_vector') THEN
    ALTER TABLE "signature_events" ADD CONSTRAINT signature_events_pad_size_with_vector
      CHECK ("signatureVectorSha256" IS NULL
             OR ("padWidth" > 0 AND "padHeight" > 0));
  END IF;
END
$$;

-- THE PURPOSE ALLOWLIST, BROUGHT BACK INTO LINE WITH THE DOMAIN.
--
-- `artefacts_purpose_known` still listed the six purposes of August. The domain
-- has since added `address_evidence`, and this migration adds the two halves of
-- a signature — so the constraint was already refusing a purpose the code
-- believed in, and would have refused these two the moment a patient signed.
-- Dropped and recreated rather than amended, which is also what makes it safe
-- to apply twice.
ALTER TABLE "artefacts" DROP CONSTRAINT IF EXISTS artefacts_purpose_known;
ALTER TABLE "artefacts" ADD CONSTRAINT artefacts_purpose_known
  CHECK ("purpose" IN (
    'entitlement_call','domain_check','website_capture','credential','identity_document',
    'address_evidence','signature_raster','signature_vector','other'));

-- Finding the signature artefacts of an agreement is a read a dispute makes.
CREATE INDEX IF NOT EXISTS "signature_events_raster_artefact_idx"
  ON "signature_events" ("signatureRasterArtefactId");
CREATE INDEX IF NOT EXISTS "signature_events_vector_artefact_idx"
  ON "signature_events" ("signatureVectorArtefactId");

-- ---------------------------------------------------------------------------
-- ROLLBACK (apply by hand; Prisma has no down-migrations)
--
--   DROP INDEX IF EXISTS "signature_events_vector_artefact_idx";
--   DROP INDEX IF EXISTS "signature_events_raster_artefact_idx";
--   ALTER TABLE "signature_events" DROP CONSTRAINT IF EXISTS signature_events_pad_size_with_vector;
--   ALTER TABLE "signature_events" DROP CONSTRAINT IF EXISTS signature_events_vector_id_with_hash;
--   ALTER TABLE "signature_events" DROP CONSTRAINT IF EXISTS signature_events_raster_id_with_hash;
--   ALTER TABLE "signature_events" DROP CONSTRAINT IF EXISTS signature_events_both_halves_or_neither;
--   ALTER TABLE "signature_events" DROP CONSTRAINT IF EXISTS signature_events_vector_sha_shape;
--   ALTER TABLE "signature_events" DROP CONSTRAINT IF EXISTS signature_events_raster_sha_shape;
--   ALTER TABLE "signature_events" DROP COLUMN IF EXISTS "pointCount";
--   ALTER TABLE "signature_events" DROP COLUMN IF EXISTS "strokeCount";
--   ALTER TABLE "signature_events" DROP COLUMN IF EXISTS "padHeight";
--   ALTER TABLE "signature_events" DROP COLUMN IF EXISTS "padWidth";
--   ALTER TABLE "signature_events" DROP COLUMN IF EXISTS "signatureVectorSha256";
--   ALTER TABLE "signature_events" DROP COLUMN IF EXISTS "signatureVectorArtefactId";
--   ALTER TABLE "signature_events" DROP COLUMN IF EXISTS "signatureRasterSha256";
--   ALTER TABLE "signature_events" DROP COLUMN IF EXISTS "signatureRasterArtefactId";
--   ALTER TABLE "artefacts" DROP CONSTRAINT IF EXISTS artefacts_purpose_known;
--   ALTER TABLE "artefacts" ADD CONSTRAINT artefacts_purpose_known
--     CHECK ("purpose" IN ('entitlement_call','domain_check','website_capture','credential',
--                          'identity_document','other'));
--   -- (only after deleting any signature or address_evidence artefact rows)
--
-- WHAT THE ROLLBACK COSTS. The artefact rows and their bytes survive — they
-- are `artefacts` rows subject-typed to the agreement — and so do the vault
-- events that recorded both hashes at signing. What is lost is the direct
-- binding from the signature event to them; the chain still holds it.
-- ---------------------------------------------------------------------------
