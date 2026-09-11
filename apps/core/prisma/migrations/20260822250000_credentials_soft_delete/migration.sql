-- Removing a practice credential no longer destroys it.
--
-- WHAT WAS WRONG. `removeCredential` was a hard `deleteMany` with no vault
-- event. A credential is IDENTITY EVIDENCE -- an HPI-O, an accreditation, an
-- AHPRA number offered as proof this is a real health practice -- and it could
-- be removed leaving no record that it had ever existed, and none that anybody
-- had removed it.
--
-- That is the opposite of how everything else here works. Agreements CEASE and
-- are retained (REQ-OFF-07). Checks are append-only; performing one again
-- writes a new row and keeps both. Affiliations end rather than vanish. A
-- credential was the one thing that could simply disappear.
--
-- It also mattered for a reason nobody would notice until an audit: the
-- identity score is computed from VERIFIED credentials. Deleting a verified
-- credential silently lowers a practice's score with no trace of why it moved,
-- so a score that fell between two reviews could not be explained.
--
-- WHY A PARTIAL UNIQUE INDEX. The old constraint was on
-- (practiceId, credentialType, credentialValue). With a soft delete a removed
-- row still occupies that slot for ever, so re-adding a credential that was
-- removed by mistake would collide with its own tombstone. Constraining only
-- the LIVE rows is the honest reading: two live copies of one credential is
-- the error; a live one beside a removed one is an ordinary correction.

ALTER TABLE "practice_credentials" ADD COLUMN IF NOT EXISTS "removedAt" timestamptz;
ALTER TABLE "practice_credentials" ADD COLUMN IF NOT EXISTS "removedByName" text;
ALTER TABLE "practice_credentials" ADD COLUMN IF NOT EXISTS "removedReason" text;

-- FOUND BY SHAPE, NOT BY NAME. Prisma's generated name is longer than
-- Postgres's 63-character identifier limit and gets truncated -- and NOT where
-- you would guess: the real name lost "lue" from the middle of the last column,
-- so a hand-written DROP matched nothing and reported success. Both the old
-- total index and the new partial one then existed, which would have left
-- re-adding a removed credential blocked by a constraint nobody could see.
--
-- So: drop whatever unique index covers exactly those three columns and is not
-- the partial one, whatever it happens to be called.
DO $drop$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT i.relname
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class t ON t.oid = x.indrelid
     WHERE t.relname = 'practice_credentials'
       AND x.indisunique
       AND x.indpred IS NULL          -- total, not partial
       AND NOT x.indisprimary
       AND x.indnatts = 3
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', v_name);
  END LOOP;
END $drop$;

DROP INDEX IF EXISTS "practice_credentials_live_key";
CREATE UNIQUE INDEX "practice_credentials_live_key"
  ON "practice_credentials" ("practiceId", "credentialType", "credentialValue")
  WHERE "removedAt" IS NULL;
