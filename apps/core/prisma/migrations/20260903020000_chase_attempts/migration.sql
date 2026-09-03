-- What a PERSON at the practice did to chase an agreement.
--
-- Carl, 3 Sep 2026: "we need an audit-trail to show that a practice-user
-- called the Patient, sent SMS / email and so on ... The Practice will chase
-- as they will not get paid otherwise."
--
-- The platform's own attempts are already evidence (capture_requests,
-- correspondence). This is the half that happens off the platform: the call,
-- the conversation at the desk, the letter. Without it, a practice that chased
-- diligently and still got nothing has no record that it tried — which is
-- exactly the record it needs, because it is the party that loses the benefit.
--
-- APPEND-ONLY, the same way reconciliation_decisions is: a correction is a new
-- row pointing at the one it replaces. The trigger makes that true whichever
-- code path writes, and the runtime role is additionally stripped of UPDATE
-- and DELETE (rule 11 — no role holds DELETE on an evidence store).
--
-- Written to be applied twice (DEV-LOOP.md).

CREATE TABLE IF NOT EXISTS "chase_attempts" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId"         UUID NOT NULL,
  "subjectType"        TEXT NOT NULL,
  "subjectId"          UUID NOT NULL,
  "channel"            TEXT NOT NULL,
  "outcome"            TEXT NOT NULL,
  "contactedPartyType" TEXT,
  "note"               TEXT,
  "attemptedBy"        TEXT NOT NULL,
  "attemptedById"      TEXT NOT NULL,
  "occurredAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "recordedAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "band"               TEXT NOT NULL,
  "daysRemaining"      INTEGER NOT NULL,
  "attemptOrdinal"     INTEGER NOT NULL,
  "supersedesId"       UUID REFERENCES "chase_attempts"("id")
);

CREATE INDEX IF NOT EXISTS "chase_attempts_practice_subject_occurredAt_idx"
  ON "chase_attempts" ("practiceId", "subjectType", "subjectId", "occurredAt");

-- One correction per row. Two rows both claiming to replace the same attempt
-- is not a correction, it is an argument.
CREATE UNIQUE INDEX IF NOT EXISTS "chase_attempts_supersedesId_key"
  ON "chase_attempts" ("supersedesId");

DO $$
BEGIN
  -- RULE 7 / REQ-CHASE-02 / REQ-END-05, IN THE COLUMN DEFINITION.
  -- A reg 89AA notice is one-way: it tells a patient a service was billed and
  -- asks for nothing, so it is never chased by anybody, on any surface. The
  -- subject list therefore has no value that could name one, and no future
  -- code path can introduce one without altering this constraint.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chase_attempts_subject_never_a_notice') THEN
    ALTER TABLE "chase_attempts" ADD CONSTRAINT chase_attempts_subject_never_a_notice
      CHECK ("subjectType" IN ('ServiceRecord', 'Agreement'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chase_attempts_channel_known') THEN
    ALTER TABLE "chase_attempts" ADD CONSTRAINT chase_attempts_channel_known
      CHECK ("channel" IN ('phone', 'sms', 'email', 'in_person', 'post'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chase_attempts_outcome_known') THEN
    ALTER TABLE "chase_attempts" ADD CONSTRAINT chase_attempts_outcome_known
      CHECK ("outcome" IN ('reached', 'no_answer', 'left_message', 'refused', 'wrong_contact'));
  END IF;

  -- WHO was contacted is a ROLE, never a name (REQ-VER-04).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chase_attempts_contacted_party_known') THEN
    ALTER TABLE "chase_attempts" ADD CONSTRAINT chase_attempts_contacted_party_known
      CHECK ("contactedPartyType" IS NULL OR "contactedPartyType" IN ('patient', 'assignor', 'other'));
  END IF;

  -- An attempt attributed to nobody is decoration, not evidence.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chase_attempts_has_actor') THEN
    ALTER TABLE "chase_attempts" ADD CONSTRAINT chase_attempts_has_actor
      CHECK (length(trim("attemptedBy")) > 0 AND length(trim("attemptedById")) > 0);
  END IF;

  -- A correction says what was wrong with the row it replaces.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chase_attempts_correction_has_reason') THEN
    ALTER TABLE "chase_attempts" ADD CONSTRAINT chase_attempts_correction_has_reason
      CHECK ("supersedesId" IS NULL OR length(trim(coalesce("note", ''))) > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chase_attempts_note_length') THEN
    ALTER TABLE "chase_attempts" ADD CONSTRAINT chase_attempts_note_length
      CHECK ("note" IS NULL OR length("note") <= 1000);
  END IF;

  -- A row cannot supersede itself.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chase_attempts_supersedes_another_row') THEN
    ALTER TABLE "chase_attempts" ADD CONSTRAINT chase_attempts_supersedes_another_row
      CHECK ("supersedesId" IS NULL OR "supersedesId" <> "id");
  END IF;
END
$$;

-- Practice scoping at the DB layer, FORCE so it applies to the owner too.
ALTER TABLE "chase_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chase_attempts" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS practice_isolation ON "chase_attempts";
CREATE POLICY practice_isolation ON "chase_attempts"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

-- APPEND-ONLY. A chase attempt is a claim about what somebody did on a given
-- day; rewriting one silently changes what the practice is asserting. A later
-- row supersedes it and both stay visible.
CREATE OR REPLACE FUNCTION core.chase_attempts_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'chase attempts are append-only evidence: a correction supersedes with a new row, nothing rewrites';
END;
$$;

DROP TRIGGER IF EXISTS chase_attempts_no_update ON "chase_attempts";
CREATE TRIGGER chase_attempts_no_update
  BEFORE UPDATE ON "chase_attempts"
  FOR EACH ROW EXECUTE FUNCTION core.chase_attempts_append_only();

DROP TRIGGER IF EXISTS chase_attempts_no_delete ON "chase_attempts";
CREATE TRIGGER chase_attempts_no_delete
  BEFORE DELETE ON "chase_attempts"
  FOR EACH ROW EXECUTE FUNCTION core.chase_attempts_append_only();

-- Belt as well as braces (rule 11). init-roles.sql grants the runtime role
-- SELECT/INSERT/UPDATE/DELETE on every new table in this schema by default;
-- an evidence table takes the last two back, so the trigger is the second line
-- of defence rather than the only one.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aob_app') THEN
    REVOKE UPDATE, DELETE ON "chase_attempts" FROM aob_app;
  END IF;
END
$$;
