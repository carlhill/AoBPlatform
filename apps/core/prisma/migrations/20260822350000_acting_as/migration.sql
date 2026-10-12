-- Acting as a practice (CRITICAL-ISSUES.md §5, RECERTIFICATION-AND-ACTING-AS.md).
--
-- A platform operator using a practice's console when the practice cannot act
-- for itself: no passkey enrolled, an administrator who left suddenly, a
-- doctor who is not technical and whose assistant has gone.
--
-- The alternative to building this is not "nobody impersonates". It is
-- somebody being handed the practice's passkey over the phone, which is
-- impersonation with none of the record.
--
-- NO DELETES, EVER. Not even a tombstone. This table is the record of who wore
-- whose face, and it is exactly the table somebody would want to remove a row
-- from. Enforced with a rule below rather than left to convention.

CREATE TABLE "acting_as_sessions" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId"  UUID NOT NULL,

  -- The REAL person. Never the practice. From the verified token.
  "operatorSub"  TEXT NOT NULL,
  "operatorName" TEXT NOT NULL,

  -- From ACTING_AS_REASONS. Chosen, not typed, so it can be counted later --
  -- "how often do we act for practices, and why" is a question worth being
  -- able to answer without reading free text.
  "reason"     TEXT NOT NULL,
  "note"       TEXT,

  "startedAt"  TIMESTAMP(3) NOT NULL DEFAULT now(),
  "endedAt"    TIMESTAMP(3),
  -- expired | ended_by_operator. How it finished is worth knowing: a session
  -- that always expires is somebody who never closes them.
  "endedHow"   TEXT,

  -- What the practice was told, and when. Rule 3: no OTP before, notified
  -- after -- so this column is the proof that the "after" happened.
  "practiceNotifiedAt" TIMESTAMP(3),

  -- Rule 6: any impersonation forces re-approval. Set when the session starts,
  -- cleared when somebody OTHER than the operator approves.
  "forcedReapproval" BOOLEAN NOT NULL DEFAULT true,
  "clearedByApproval" UUID,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

-- "Is this operator currently acting for anybody" -- checked on every request
-- while a session might be open, so it must be cheap.
CREATE INDEX "acting_as_open_idx"
  ON "acting_as_sessions" ("operatorSub", "startedAt" DESC)
  WHERE "endedAt" IS NULL;

-- "Who has acted as this practice since its last approval" -- the query behind
-- rule 7, the separation-of-duties check.
CREATE INDEX "acting_as_practice_idx" ON "acting_as_sessions" ("practiceId", "startedAt" DESC);

-- Rule 7 needs this list at the moment of approval.
CREATE INDEX "acting_as_uncleared_idx"
  ON "acting_as_sessions" ("practiceId")
  WHERE "clearedByApproval" IS NULL;

-- NO ROW LEVEL SECURITY, deliberately, and this is the one table where that is
-- correct. A session belongs to the PLATFORM, not to the practice being acted
-- for: scoping it by practice would mean an operator's own session becomes
-- invisible to them the moment they stop acting, and the separation-of-duties
-- check needs to read across practices anyway. Nothing here is patient data --
-- it is who did what, which is the opposite of a thing to hide.

-- APPEND-ONLY. The same protection the vault outbox has, for the same reason:
-- this is the record of impersonation, so it is precisely the table somebody
-- would want to edit their way out of.
CREATE OR REPLACE FUNCTION core.acting_as_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'acting_as_sessions is append-only: an impersonation record cannot be deleted.';
END;
$$;

CREATE TRIGGER acting_as_no_delete_trg
  BEFORE DELETE ON "acting_as_sessions"
  FOR EACH ROW EXECUTE FUNCTION core.acting_as_no_delete();

-- Updating is allowed only to CLOSE a session or record the notification.
-- Rewriting who acted, for whom, or why is not.
CREATE OR REPLACE FUNCTION core.acting_as_immutable_facts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."practiceId"  IS DISTINCT FROM OLD."practiceId"
  OR NEW."operatorSub"  IS DISTINCT FROM OLD."operatorSub"
  OR NEW."operatorName" IS DISTINCT FROM OLD."operatorName"
  OR NEW."reason"       IS DISTINCT FROM OLD."reason"
  OR NEW."startedAt"    IS DISTINCT FROM OLD."startedAt" THEN
    RAISE EXCEPTION 'Who acted, for whom, why and when cannot be changed after the fact.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER acting_as_immutable_facts_trg
  BEFORE UPDATE ON "acting_as_sessions"
  FOR EACH ROW EXECUTE FUNCTION core.acting_as_immutable_facts();

GRANT SELECT, INSERT, UPDATE ON "acting_as_sessions" TO aob_app;
