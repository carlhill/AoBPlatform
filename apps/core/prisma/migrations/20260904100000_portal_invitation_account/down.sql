-- Reverse of `migration.sql`. Dropping the column drops the pre-minted link
-- between an invitation and its account id; the accounts themselves stay,
-- because an account that has been activated has links and sessions hanging
-- off it. Written to be applied twice.

DROP INDEX IF EXISTS "portal_activation_tokens_patientId_idx";

ALTER TABLE "portal_activation_tokens"
  DROP CONSTRAINT IF EXISTS "portal_activation_tokens_accountId_fkey";

ALTER TABLE "portal_activation_tokens"
  DROP COLUMN IF EXISTS "accountId";
