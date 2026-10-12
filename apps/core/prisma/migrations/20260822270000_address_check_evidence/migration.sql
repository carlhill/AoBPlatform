-- Address confirmation: HOW it was checked, by whom, and why it was sent back.
--
-- A location's address prints in the s 65C(5)(a) particulars block of every
-- agreement captured there. Until now the only record of a confirmation was a
-- boolean and a string of the form 'manual:<name>' stuffed into gnafVersion —
-- a column meant for the G-NAF extract's version. That conflated "confirmed
-- against a government dataset" with "somebody said so", in one field, with no
-- way to tell them apart afterwards.
--
-- All columns are nullable: existing rows were confirmed under the old rules
-- and must not be retro-labelled with a method nobody chose.

ALTER TABLE "practice_locations"
  ADD COLUMN "addressCheckMethod"     TEXT,
  ADD COLUMN "addressCheckVersion"    TEXT,
  ADD COLUMN "addressCheckNote"       TEXT,
  ADD COLUMN "addressCheckArtefactId" UUID,
  ADD COLUMN "addressCheckedAt"       TIMESTAMP(3),
  ADD COLUMN "addressCheckedBySub"    TEXT,
  ADD COLUMN "addressCheckedByName"   TEXT,
  ADD COLUMN "addressRejectedAt"      TIMESTAMP(3),
  ADD COLUMN "addressRejectedReason"  TEXT,
  ADD COLUMN "addressRejectedDetail"  TEXT,
  ADD COLUMN "addressRejectedByName"  TEXT;

-- Finding what is waiting on a reviewer, and what is waiting on a practice.
-- Both are queue reads on every review screen.
CREATE INDEX "practice_locations_awaiting_confirmation_idx"
  ON "practice_locations" ("practiceId")
  WHERE "addressValidated" = false;

CREATE INDEX "practice_locations_awaiting_correction_idx"
  ON "practice_locations" ("practiceId", "addressRejectedAt")
  WHERE "addressRejectedAt" IS NOT NULL;
