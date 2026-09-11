-- Changing the administrator's email address, held until it is confirmed.
--
-- WHY A TABLE AND NOT COLUMNS ON `practices`.
--
-- A pending change has a life: asked for, warned about, then confirmed,
-- stopped, expired or replaced by a later attempt. Columns on the practice row
-- hold only the current attempt, and the question a reviewer actually asks is
-- "has anybody tried to move this address before" -- which needs the ones that
-- did not succeed. A second attempt is recorded as `superseded` rather than
-- overwriting the first, because two attempts to move the same address inside
-- five days is itself the signal.
--
-- WHAT THIS REPLACED. The change used to apply the moment it was saved, and
-- revoke every passkey in the same transaction on the reasoning that a
-- handover should not leave the previous holder signed in. The reasoning is
-- right and the timing was wrong: one console session was enough to redirect
-- where a practice's mail goes AND lock the real administrator out, with
-- nothing sent to anybody. Takeover and denial of service in a single save.
--
-- Now nothing moves until the new address answers. The old address keeps
-- working throughout -- which is what gives the person being displaced a way
-- to notice and object.

CREATE TABLE "pending_email_changes" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId" UUID NOT NULL,

  "requestedEmail" TEXT NOT NULL,
  -- Kept even though `practices` still holds it: once this row is resolved the
  -- practice has moved on, and a reviewer reading history needs what it was AT
  -- THE TIME rather than what it is now.
  "previousEmail"  TEXT,
  -- The group address as it stood BEFORE the save, for the same reason and one
  -- sharper: if the group address is changed in the same save, the warning must
  -- still go where the practice could actually read it. Otherwise changing both
  -- at once silences the alarm, which makes changing both at once the move.
  "previousGroupEmail" TEXT,

  "requestedAt"     TIMESTAMP(3) NOT NULL DEFAULT now(),
  "requestedByName" TEXT NOT NULL,
  "expiresAt"       TIMESTAMP(3) NOT NULL,

  -- THE LINK CARRIES THE TOKEN, THE HUMAN CARRIES THE CODE.
  --
  -- A link alone is consumed by a GET, and mail scanners, link previews and
  -- antivirus gateways all issue GETs -- so a click-to-confirm scheme has
  -- addresses confirming themselves with nobody involved. Same reasoning as
  -- the original address verification, and the attempt cap matters more than
  -- the code length.
  "confirmToken" TEXT NOT NULL UNIQUE,
  "confirmCode"  TEXT NOT NULL,
  "attempts"     INTEGER NOT NULL DEFAULT 0,

  -- Sent to the OLD address and the group address. Separate from the confirm
  -- token so that holding one never implies the other: whoever can confirm the
  -- change must not thereby be able to cancel the warning about it.
  "stopToken" TEXT NOT NULL UNIQUE,

  -- NULL means still waiting. One of confirmed | stopped | expired | superseded.
  "outcome"     TEXT,
  "outcomeAt"   TIMESTAMP(3),
  -- Which address answered, never free text from the person answering.
  "outcomeBy"   TEXT,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

-- At most one live request per practice. A partial unique index rather than a
-- check in the service, because two saves racing is exactly how a second live
-- request would appear and the service cannot see the other transaction.
CREATE UNIQUE INDEX "pending_email_changes_one_live"
  ON "pending_email_changes" ("practiceId")
  WHERE "outcome" IS NULL;

-- "Has anybody tried to move this address before?"
CREATE INDEX "pending_email_changes_history_idx"
  ON "pending_email_changes" ("practiceId", "requestedAt" DESC);

-- Same fail-closed tenancy as everything else holding practice data.
ALTER TABLE "pending_email_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pending_email_changes" FORCE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON "pending_email_changes"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

-- A resolved request says when and by which address. The class of bug this
-- catches is a row marked done with no record of who did it.
ALTER TABLE "pending_email_changes" ADD CONSTRAINT pending_email_changes_outcome_is_complete
  CHECK ("outcome" IS NULL OR ("outcomeAt" IS NOT NULL AND "outcomeBy" IS NOT NULL));

-- The five-day window, enforced here rather than only in the service. A row
-- whose expiry is before its request is not a short window, it is a bug.
ALTER TABLE "pending_email_changes" ADD CONSTRAINT pending_email_changes_expiry_after_request
  CHECK ("expiresAt" > "requestedAt");

/*
 * Answering a confirmation or a stop link, which happens BEFORE anybody signs
 * in and therefore outside any practice scope.
 *
 * Same shape and same justification as the other pre-tenant functions
 * (CONVENTIONS.md section 6): the caller holds a single-use bearer token, and
 * the function returns only what that token already identifies -- never a
 * listing, never another practice's row, never the code.
 *
 * The token is the whole authorisation, so it is matched on equality and the
 * function returns nothing at all if it does not match. Not "returns an empty
 * set for a bad token and a row for a good one, plus a hint" -- nothing.
 */
CREATE OR REPLACE FUNCTION core.pending_email_change_by_token(p_token text, p_kind text)
RETURNS TABLE (
  "id"             uuid,
  "practiceId"     uuid,
  "requestedEmail" text,
  "previousEmail"  text,
  "expiresAt"      timestamp(3),
  "attempts"       integer,
  "outcome"        text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT "id", "practiceId", "requestedEmail", "previousEmail", "expiresAt", "attempts", "outcome"
  FROM core.pending_email_changes
  WHERE (p_kind = 'confirm' AND "confirmToken" = p_token)
     OR (p_kind = 'stop'    AND "stopToken"    = p_token)
  LIMIT 1;
$$;

-- Sweeping requests nobody answered. Counts and ids only, like the other
-- pre-tenant sweeps: a worker running across every practice has no scope, RLS
-- is fail-closed, and a sweep has no business reading addresses.
CREATE OR REPLACE FUNCTION core.pending_email_changes_to_expire(p_limit integer DEFAULT 200)
RETURNS TABLE ("id" uuid, "practiceId" uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT "id", "practiceId"
  FROM core.pending_email_changes
  WHERE "outcome" IS NULL AND "expiresAt" <= now()
  ORDER BY "expiresAt"
  LIMIT p_limit;
$$;
