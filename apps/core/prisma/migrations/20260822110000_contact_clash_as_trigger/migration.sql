-- Contact independence, moved from a CHECK constraint to a trigger.
--
-- WHY. A CHECK constraint is re-evaluated on EVERY update to the row, not only
-- on updates that touch the constrained columns. Combined with NOT VALID —
-- which exempts existing rows at the moment the constraint is added, and then
-- exempts them from nothing at all afterwards — the result was that an
-- application already in the queue with two contacts on one handset became
-- COMPLETELY UN-UPDATABLE. The reviewer could not approve it, could not reject
-- it, and could not record anything against it.
--
-- That is precisely backwards. The application most needing a human decision
-- was the one the database refused to let a human decide. Discovered when a
-- routine backfill of an unrelated column failed against a real pending
-- application.
--
-- What we actually want to say is not "this row must always satisfy the rule"
-- but "nobody may CREATE a clash, or INTRODUCE one into a row that did not have
-- it". That is a statement about a transition, and a transition is a trigger.
--
-- The effect:
--   * INSERT with clashing contacts        → refused
--   * UPDATE that creates a clash          → refused
--   * UPDATE of a pre-existing clashed row → ALLOWED, so it can be decided
--   * the clash is still surfaced to the reviewer as a flag on the dossier
--
-- The reviewer, not the database, is the right place to catch history.

ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS practices_manager_is_a_different_person;

CREATE OR REPLACE FUNCTION enforce_contacts_independent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_touched boolean;
BEGIN
  -- On UPDATE, only care if a contact field actually moved. IS DISTINCT FROM
  -- rather than <>, so a NULL becoming a value counts as a change.
  IF TG_OP = 'UPDATE' THEN
    v_touched :=
      NEW."adminEmail"   IS DISTINCT FROM OLD."adminEmail"   OR
      NEW."adminPhone"   IS DISTINCT FROM OLD."adminPhone"   OR
      NEW."managerEmail" IS DISTINCT FROM OLD."managerEmail" OR
      NEW."managerPhone" IS DISTINCT FROM OLD."managerPhone";
    IF NOT v_touched THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW."managerEmail" IS NOT NULL
     AND NEW."adminEmail" IS NOT NULL
     AND btrim(NEW."managerEmail") <> ''
     AND btrim(NEW."adminEmail") <> ''
     AND lower(btrim(NEW."managerEmail")) = lower(btrim(NEW."adminEmail")) THEN
    RAISE EXCEPTION
      'practices_manager_is_a_different_person [FR-1.9]: the manager must be a different person — a second '
      'contact with the same email verifies nothing, because both messages arrive in one inbox';
  END IF;

  IF NEW."managerPhone" IS NOT NULL
     AND NEW."adminPhone" IS NOT NULL
     AND btrim(NEW."managerPhone") <> ''
     AND btrim(NEW."adminPhone") <> ''
     AND normalise_au_phone(NEW."managerPhone") = normalise_au_phone(NEW."adminPhone") THEN
    RAISE EXCEPTION
      'practices_manager_is_a_different_person [FR-1.9]: the manager must be reachable independently — a '
      'second contact on the same number verifies nothing, because both calls reach one handset';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS practices_contacts_independent ON "practices";
CREATE TRIGGER practices_contacts_independent
  BEFORE INSERT OR UPDATE ON "practices"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_contacts_independent();
