-- RECEPTION TYPES AN ARRIVAL BY HAND (Carl, 7 Sep 2026;
-- PMS_to_AoB_Workflow.md case 4, row W2).
--
-- WHAT THIS IS FOR. The practice management system is down, or is not
-- integrated, or a walk-in has no record in it yet. Somebody at the front desk
-- types the details and the platform drafts the agreement EXACTLY as an
-- arrival would -- one pipeline, one visit policy, one lock, one queue. This
-- migration is the two facts that pipeline cannot currently record about a
-- typed arrival: that a person sent it, and which person.
--
-- IT ADDS NO SECOND PATH. There is no "reception agreements" table and no
-- second decision column, because the decision is the same decision: the
-- versioned visit policy answers it from the practitioner and the patient
-- (hard rules 6 and 14), and a receptionist cannot assert an agreement type
-- any more than a connector can.
--
-- Idempotent, reversible, written to be applied twice (DEV-LOOP.md).
--
-- REVERSE:
--   ALTER TABLE "arrivals" DROP CONSTRAINT IF EXISTS arrivals_source_known;
--   ALTER TABLE "arrivals" ADD CONSTRAINT arrivals_source_known
--     CHECK ("source" IN ('connector', 'dev'));
--   ALTER TABLE "arrivals" DROP COLUMN IF EXISTS "receivedByPrincipalId";
-- (Reversing needs no data migration only while no `reception` row exists;
--  once one does, reversing DELETES evidence -- supersede rather than revert.)

-- ---------------------------------------------------------------------------
-- WHOSE HANDS TYPED IT.
--
-- NULL FOR EVERY MACHINE PUSH, and the null is the fact rather than a gap: a
-- connector arrival is the practice's SOFTWARE speaking and nobody pressed
-- anything, so naming a staff member on one would be inventing a witness.
--
-- THE KEYCLOAK SUBJECT, NOT A NAME -- the same shape and the same reasoning as
-- `agreements."serviceDescriptionSetBy"`. An id from a token the realm signed
-- is evidence; a name typed into a form is an assertion (REQ-LOG-08: no
-- personal value lands in a column that exists to say who acted).
-- ---------------------------------------------------------------------------
ALTER TABLE "arrivals" ADD COLUMN IF NOT EXISTS "receivedByPrincipalId" TEXT;

DO $$
BEGIN
  -- ---------------------------------------------------------------------------
  -- `reception` JOINS THE KNOWN SOURCES.
  --
  -- The CHECK is rewritten rather than dropped: the whole point of the
  -- constraint is that an unknown source cannot be written, and a table with
  -- no constraint for the minute between two statements is a table that would
  -- accept one. Dropped and recreated in the same transaction as this DO
  -- block, which is atomic.
  -- ---------------------------------------------------------------------------
  ALTER TABLE "arrivals" DROP CONSTRAINT IF EXISTS arrivals_source_known;
  ALTER TABLE "arrivals" ADD CONSTRAINT arrivals_source_known
    CHECK ("source" IN ('connector', 'dev', 'reception'));

  -- ---------------------------------------------------------------------------
  -- A PERSON, OR A MACHINE -- NEVER A MACHINE WITH A WITNESS.
  --
  -- `receivedByPrincipalId` may only be present on a `reception` arrival. A
  -- connector push that named a staff member would be a record asserting that
  -- somebody at the desk vouched for a message nobody read, and that is
  -- exactly the kind of thing an audit two years from now would believe.
  -- ---------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arrivals_principal_only_when_typed') THEN
    ALTER TABLE "arrivals" ADD CONSTRAINT arrivals_principal_only_when_typed
      CHECK ("receivedByPrincipalId" IS NULL OR "source" = 'reception');
  END IF;
END
$$;
