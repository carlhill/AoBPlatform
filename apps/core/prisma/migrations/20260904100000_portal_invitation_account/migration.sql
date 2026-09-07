-- THE RECORD ID EXISTS BEFORE THE FIRST MESSAGE (Carl, 4 Sep 2026).
--
-- `AoBPlatform-PatientId-<accountId>` is what a patient checks a message, a
-- page and a passkey against. That check only works if the id in the very
-- FIRST message -- the invitation -- is the id they will see after they sign
-- in. Until now the account was created at activation, so the invitation could
-- not name one.
--
-- So the account is minted when the invitation is, and the token names it.
-- LINKING STILL HAPPENS AT ACTIVATION: the account row is an id and two
-- timestamps and holds no patient data at all, and `portal_account_patients`
-- -- the row that says this account may read this practice's record -- is
-- still written only after the three-identifier check passes. A minted account
-- with no link can see nothing.
--
-- NULLABLE, because every invitation issued before this migration has no
-- account and must keep working: `POST /portal/activate` falls back to the old
-- behaviour when the token names none.
--
-- Idempotent: the column is added only if it is not already there.

ALTER TABLE "portal_activation_tokens"
  ADD COLUMN IF NOT EXISTS "accountId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'portal_activation_tokens_accountId_fkey'
  ) THEN
    ALTER TABLE "portal_activation_tokens"
      ADD CONSTRAINT "portal_activation_tokens_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "portal_accounts"("id");
  END IF;
END
$$;

-- The mint reads "has this patient already been given an id?" on every
-- invitation, so that two invitations to one person quote the SAME id rather
-- than two -- which would be the exact confusion the id exists to remove.
CREATE INDEX IF NOT EXISTS "portal_activation_tokens_patientId_idx"
  ON "portal_activation_tokens" ("patientId");
