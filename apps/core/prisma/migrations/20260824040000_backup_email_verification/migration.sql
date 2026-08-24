-- Proving a backup address, rather than merely announcing it.
--
-- `backupEmailVerifiedAt` has existed since the backup address was added and
-- nothing has ever set it. The address was stored and a notice was sent to it,
-- and that was the whole of it — so every backup on the platform reads as
-- unverified forever, which makes the column say nothing at all.
--
-- WHY IT HAS TO BE PROVED. The backup exists to be the channel that still works
-- when the main one does not. A backup nobody has ever had an answer from is
-- not a second channel; it is a guess, and it will be discovered to be a guess
-- at exactly the moment somebody needs it — during a takeover, when the primary
-- is already gone.
--
-- A TYPO IS THE COMMON CASE, not an attack. Somebody types their partner's
-- address with a letter missing. Nothing tells them, because nothing ever
-- writes to it again until the day it matters.
--
-- Same shape as every other proof here: a token in the link, a code for the
-- human, an expiry, and a count of attempts.
ALTER TABLE "practitioners"
  ADD COLUMN "backupEmailToken"     TEXT,
  ADD COLUMN "backupEmailCode"      TEXT,
  ADD COLUMN "backupEmailExpiresAt" TIMESTAMP(3),
  ADD COLUMN "backupEmailAttempts"  INTEGER NOT NULL DEFAULT 0;

-- The token is how the link finds the row, so it has to be unique and it has to
-- be indexed. Partial: only a backup awaiting proof has one.
CREATE UNIQUE INDEX IF NOT EXISTS practitioners_backup_email_token_key
  ON core.practitioners ("backupEmailToken")
  WHERE "backupEmailToken" IS NOT NULL;

/*
 * READING THE ROW FROM THE TOKEN ALONE, before there is any session.
 *
 * Whoever holds a backup-confirmation link is by definition not signed in --
 * they may not have an account at all, being somebody's spouse or colleague.
 * `practitioners` carries no RLS today, but this function is how the lookup is
 * expressed so that adding RLS later cannot silently break the one path that
 * has to work without a claim.
 *
 * It returns NOTHING for a token that does not match, and never reveals whether
 * an address is on the platform.
 */
CREATE OR REPLACE FUNCTION core.practitioner_by_backup_token(p_token text)
RETURNS TABLE (
  id uuid,
  "backupEmail" text,
  "backupEmailCode" text,
  "backupEmailExpiresAt" timestamp,
  "backupEmailAttempts" integer,
  "backupEmailVerifiedAt" timestamp
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT p.id,
         p."backupEmail",
         p."backupEmailCode",
         p."backupEmailExpiresAt",
         p."backupEmailAttempts",
         p."backupEmailVerifiedAt"
  FROM core.practitioners p
  WHERE p."backupEmailToken" = p_token
    AND p."backupEmailToken" IS NOT NULL
$$;

REVOKE ALL ON FUNCTION core.practitioner_by_backup_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.practitioner_by_backup_token(text) TO aob_app;
