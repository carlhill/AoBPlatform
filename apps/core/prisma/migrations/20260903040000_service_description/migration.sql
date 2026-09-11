-- D6a set on a STAFF surface, before the lock.
--
-- A pre-agreement drafted at check-in can reach the kiosk with no Basic
-- Service Description, C6 refuses the lock, and the tablet hands over. D6a is
-- never entered on the patient surface (Carl, 3 Sep 2026), so it is parked on
-- the draft by a staff member whose identity is recorded, and the lock
-- assembles it from the platform's own records like every other particular.
--
-- Reversible: three nullable columns on `agreements`, one on `practices`, and
-- one trigger. The down migration is the DROPs at the foot of this file.

ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "serviceDescription" TEXT;
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "serviceDescriptionSetBy" TEXT;
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "serviceDescriptionSetAt" TIMESTAMP(3);

ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "defaultServiceDescription" TEXT;

-- ---------------------------------------------------------------------------
-- The description may only move while the particulars can still move.
--
-- HARD-02 already refuses a change to `particulars` once an agreement is
-- signed, and this is the same rule one step earlier: after the lock the
-- artefact has been RENDERED AND HASHED against these words (rule 13), so
-- editing them afterwards would leave a stored agreement whose description
-- disagrees with the document it hashes to. A correction supersedes.
--
-- In the database rather than only in the service, because the service is one
-- caller and a migration script, a console and a future module are others.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS agreements_service_description_locked ON "agreements";
DROP FUNCTION IF EXISTS prevent_locked_service_description_change();

CREATE FUNCTION prevent_locked_service_description_change() RETURNS trigger AS $$
BEGIN
  IF OLD."particularsLockedAt" IS NOT NULL
     AND NEW."serviceDescription" IS DISTINCT FROM OLD."serviceDescription" THEN
    RAISE EXCEPTION 'D6a is locked with the particulars — create a superseding agreement (HARD-02, REQ-REG-06)';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER agreements_service_description_locked
  BEFORE UPDATE ON "agreements"
  FOR EACH ROW EXECUTE FUNCTION prevent_locked_service_description_change();

-- Down:
--   DROP TRIGGER agreements_service_description_locked ON "agreements";
--   DROP FUNCTION prevent_locked_service_description_change();
--   ALTER TABLE "practices" DROP COLUMN "defaultServiceDescription";
--   ALTER TABLE "agreements" DROP COLUMN "serviceDescriptionSetAt";
--   ALTER TABLE "agreements" DROP COLUMN "serviceDescriptionSetBy";
--   ALTER TABLE "agreements" DROP COLUMN "serviceDescription";
