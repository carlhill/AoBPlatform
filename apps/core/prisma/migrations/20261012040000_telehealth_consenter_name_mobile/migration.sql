-- Someone acting for the patient types their full name and a mobile on the page before they
-- agree (Carl, 12 Oct 2026, DECISIONS.md D-2026-10-12-03 item 12). The mobile is mandatory, so
-- the practice can reach them, in an emergency above all. Stored on the session, never in a
-- vault payload (hard rule 9). Safe to apply twice.
ALTER TABLE "telehealth_sessions" ADD COLUMN IF NOT EXISTS "consenterName" TEXT;
ALTER TABLE "telehealth_sessions" ADD COLUMN IF NOT EXISTS "consenterMobile" TEXT;

-- A carer's agreement carries both; a patient's carries neither. Rows agreed before this
-- migration (dev only) are left alone by "agreedAt" < the cut-over.
ALTER TABLE "telehealth_sessions" DROP CONSTRAINT IF EXISTS "telehealth_sessions_carer_named";
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_carer_named"
  CHECK (
    "agreedAt" IS NULL
    OR "agreedAt" < TIMESTAMP '2026-10-12 12:00:00'
    OR ("consenterIsPatient" IS DISTINCT FROM false AND "consenterName" IS NULL AND "consenterMobile" IS NULL)
    OR ("consenterIsPatient" = false AND "consenterName" IS NOT NULL AND "consenterMobile" ~ '^04[0-9]{8}$')
  ) NOT VALID;