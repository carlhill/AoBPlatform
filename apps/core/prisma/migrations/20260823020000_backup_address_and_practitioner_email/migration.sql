-- A backup address, and holding a practitioner's email change until it is proved.
--
-- WHY A BACKUP ADDRESS IS THE PIECE THAT MAKES THE REST WORK.
--
-- The obvious design is "the OLD address must authorise the change". It defeats
-- takeover completely: somebody with a stolen console session cannot proceed
-- without the old inbox.
--
-- And it breaks the case the feature exists for. The commonest LEGITIMATE
-- reason to change an address is that the old one is gone — left the practice,
-- mailbox closed, account deleted. Requiring it to authorise means exactly the
-- people who most need this cannot use it, and every one of them becomes a
-- support call where somebody judges identity over the phone. That is a worse
-- security position than the mechanism it replaced, arrived at by making each
-- step stronger.
--
-- A BACKUP ADDRESS gives a second channel that is not the one being changed. So
-- the alarm still reaches somebody even when the old address is unreachable,
-- without making an unreachable address a dead end. It is why Google and
-- Microsoft ask for one.
--
-- NEVER THE SAME AS THE PRIMARY. One inbox covering both is one compromise
-- covering both, which is the entire thing this defends against. Enforced by a
-- constraint rather than by the form, because the form is not the only caller.

ALTER TABLE "practitioners"
  ADD COLUMN "backupEmail" TEXT,
  ADD COLUMN "backupEmailVerifiedAt" TIMESTAMP(3);

ALTER TABLE "practitioners" ADD CONSTRAINT practitioners_backup_differs
  CHECK ("backupEmail" IS NULL OR lower("backupEmail") IS DISTINCT FROM lower("email"));

ALTER TABLE "practices"
  ADD COLUMN "backupEmail" TEXT,
  ADD COLUMN "backupEmailVerifiedAt" TIMESTAMP(3);

ALTER TABLE "practices" ADD CONSTRAINT practices_backup_differs
  CHECK ("backupEmail" IS NULL OR lower("backupEmail") IS DISTINCT FROM lower("adminEmail"));

/*
 * THE SAME PENDING MECHANISM, NOW FOR PRACTITIONERS TOO.
 *
 * `pending_email_changes` was built for a practice's administrator address and
 * is practice-scoped, because that is what it protected. A practitioner has no
 * practice — their scope is their affiliations — so `practiceId` cannot be the
 * anchor for theirs.
 *
 * Rather than a second table repeating the token, code, expiry and outcome
 * logic, the existing one gains a subject: a change belongs EITHER to a practice
 * or to a practitioner, never to both and never to neither.
 */
ALTER TABLE "pending_email_changes"
  ADD COLUMN "practitionerId" UUID,
  -- The address that carried the warning, so a reviewer can see WHICH channel
  -- was actually reachable rather than assuming the old one was.
  ADD COLUMN "backupEmail" TEXT,
  -- Set when the change takes effect. The cooling-off window runs from here,
  -- not from the request: somebody who notices late is objecting to the change
  -- having happened, not to it having been asked for.
  ADD COLUMN "effectiveAt" TIMESTAMP(3);

ALTER TABLE "pending_email_changes"
  ALTER COLUMN "practiceId" DROP NOT NULL;

ALTER TABLE "pending_email_changes" ADD CONSTRAINT pending_email_changes_has_one_subject
  CHECK (num_nonnulls("practiceId", "practitionerId") = 1);

/*
 * RLS, and the practitioner case needs its own policy for the same reason the
 * reporting layer did: they carry no practice claim, so the existing policy
 * can never match their rows and would fail closed against the person the row
 * is about.
 *
 * Keyed on the same `app.practitioner_id` the reporting policies use, so there
 * is one setting meaning one thing across the schema.
 */
CREATE POLICY practitioner_own_email_changes ON "pending_email_changes"
  USING ("practitionerId" = NULLIF(current_setting('app.practitioner_id', true), '')::uuid)
  WITH CHECK ("practitionerId" = NULLIF(current_setting('app.practitioner_id', true), '')::uuid);

-- One live change per practitioner, the same way there is one per practice.
CREATE UNIQUE INDEX "pending_email_changes_one_live_practitioner"
  ON "pending_email_changes" ("practitionerId")
  WHERE "outcome" IS NULL AND "practitionerId" IS NOT NULL;

/*
 * ANSWERING A LINK, for a change that belongs to a practitioner.
 *
 * Same shape and justification as `pending_email_change_by_token`: the caller
 * holds a single-use bearer token, has no session, and the function returns
 * only what that token already identifies — never a listing, never the code.
 *
 * REPLACES the practice-only version rather than sitting beside it, so there is
 * one way to answer a link and not two that could drift.
 */
-- DROPPED FIRST. `CREATE OR REPLACE` cannot change a function's return type,
-- and this one gains columns -- so replacing it in place fails with "cannot
-- change return type of existing function". Nothing holds a reference to it
-- but the service, which is redeployed with this.
DROP FUNCTION IF EXISTS core.pending_email_change_by_token(text, text);

CREATE FUNCTION core.pending_email_change_by_token(p_token text, p_kind text)
RETURNS TABLE (
  "id"             uuid,
  "practiceId"     uuid,
  "practitionerId" uuid,
  "requestedEmail" text,
  "previousEmail"  text,
  "backupEmail"    text,
  "expiresAt"      timestamp(3),
  "effectiveAt"    timestamp(3),
  "attempts"       integer,
  "outcome"        text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT "id", "practiceId", "practitionerId", "requestedEmail", "previousEmail", "backupEmail",
         "expiresAt", "effectiveAt", "attempts", "outcome"
  FROM core.pending_email_changes
  WHERE (p_kind = 'confirm' AND "confirmToken" = p_token)
     OR (p_kind = 'stop'    AND "stopToken"    = p_token)
  LIMIT 1;
$$;
