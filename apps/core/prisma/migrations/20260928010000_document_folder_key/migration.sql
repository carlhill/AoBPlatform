-- WHICH KEY NAMES THE PATIENT'S DOCUMENT FOLDER AT THIS PRACTICE (Carl, 28
-- September 2026: "build the import-folder write-back"; DB4-AND-AOBL.md §6a).
--
-- WHY THE ANSWER IS A COLUMN AND NOT A CONSTANT. The scanned DB4 from the test
-- practice carries the chart number and the practice's own annotation says to
-- use it "for filename for folder structure" — so `patient_record_number` is
-- the right answer there, and §6a records the correction that matters: it must
-- be CONFIRMED at a practice, not assumed. PMS installations differ, and a
-- wrong folder name does not fail loudly; it files a signed consent in a
-- stranger's record and says nothing.
--
-- NULL IS THE DEFAULT AND MEANS "NOBODY HAS BEEN ASKED". The collection lane
-- publishes nothing for such a practice, so the failure mode of forgetting to
-- ask is that write-back does not start — never that it starts and is wrong.
--
-- NOTHING MOVES. Every existing practice keeps NULL; this only makes the value
-- settable. No practice is opted in here.
--
-- Idempotent (DEV-LOOP.md): the column is added IF NOT EXISTS and the
-- constraint dropped before it is added, so a second run lands on the same
-- definition rather than failing.
-- Reversible:
--   ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS "practices_document_folder_key_check";
--   ALTER TABLE "practices" DROP COLUMN IF EXISTS "documentFolderKey";
-- -- which only loses the answers; it cannot lose a document, because the
-- folder drop is a copy and the Evidence Vault still holds the original.
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "documentFolderKey" TEXT;

ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS "practices_document_folder_key_check";
ALTER TABLE "practices" ADD CONSTRAINT "practices_document_folder_key_check"
  CHECK ("documentFolderKey" IS NULL OR "documentFolderKey" IN ('patient_record_number'));
