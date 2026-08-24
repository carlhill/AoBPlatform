-- Holding a change to the SHARED PRACTICE address until it is proved, the
-- same way the administrator address already is.
--
-- WHY groupEmail NEEDED THIS TOO. Its own schema comment said "nothing enrols
-- against this address, it receives notices only" — true, and not the same as
-- harmless. groupEmail is the WITNESS an adminEmail handover is told about
-- when the old admin inbox is unreachable. An attacker who changes both in one
-- save silences that witness before it ever sees the handover it exists to
-- catch, because groupEmail took effect on save while adminEmail was merely
-- held. Two fields with the same purpose need the same control, or the
-- stronger one is worth nothing.
--
-- NOT A HANDOVER, THOUGH. groupEmail signs nobody in and holds no passkey, so
-- confirming a change to it writes the column and stops -- no Keycloak call,
-- no staff-row sync, no revocation. What carries over is only the shape that
-- protects a channel of communication: held until proved, the address it
-- replaces told, a way to object.

/*
 * WHICH FIELD, on a row that used to only ever mean one. A practice can now
 * hold a live adminEmail change and a live groupEmail change at once, so the
 * one-live-request index gains this as part of its key. Practitioner rows
 * have no second field to name; the default keeps them exactly as they were.
 */
ALTER TABLE "pending_email_changes"
  ADD COLUMN "field" TEXT NOT NULL DEFAULT 'adminEmail',
  -- The WITNESS for a groupEmail change: the admin address at the time. The
  -- mirror of "previousGroupEmail", which is the witness for an adminEmail
  -- change.
  ADD COLUMN "previousAdminEmail" TEXT;

-- Proven the same way adminEmail is, just without a handover.
ALTER TABLE "practices" ADD COLUMN "groupEmailVerifiedAt" TIMESTAMP(3);

ALTER TABLE "pending_email_changes" ADD CONSTRAINT pending_email_changes_field_known
  CHECK ("field" IN ('adminEmail', 'groupEmail'));

DROP INDEX "pending_email_changes_one_live";

CREATE UNIQUE INDEX "pending_email_changes_one_live"
  ON "pending_email_changes" ("practiceId", "field")
  WHERE "outcome" IS NULL;

-- The token-answering function gains the column everything downstream needs
-- to decide which of the two (very different) confirm paths applies.
DROP FUNCTION IF EXISTS core.pending_email_change_by_token(text, text);

CREATE FUNCTION core.pending_email_change_by_token(p_token text, p_kind text)
RETURNS TABLE (
  "id"                 uuid,
  "practiceId"         uuid,
  "practitionerId"     uuid,
  "field"              text,
  "requestedEmail"     text,
  "previousEmail"      text,
  "previousAdminEmail" text,
  "backupEmail"        text,
  "expiresAt"          timestamp(3),
  "effectiveAt"        timestamp(3),
  "attempts"           integer,
  "outcome"            text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT "id", "practiceId", "practitionerId", "field", "requestedEmail", "previousEmail",
         "previousAdminEmail", "backupEmail", "expiresAt", "effectiveAt", "attempts", "outcome"
  FROM core.pending_email_changes
  WHERE (p_kind = 'confirm' AND "confirmToken" = p_token)
     OR (p_kind = 'stop'    AND "stopToken"    = p_token)
  LIMIT 1;
$$;
