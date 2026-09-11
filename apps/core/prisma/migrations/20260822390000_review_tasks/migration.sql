-- Work arriving INTO the platform that needs a second look.
--
-- SEPARATE FROM outbound_items, deliberately. That table carries things
-- LEAVING; this carries work coming in. One table would mean "queue" meaning
-- two things in one schema, and the first person to write
-- `WHERE state = 'pending'` would get both.
--
-- WHY IT EXISTS. A practice can now change its own contact details, head
-- office and shared address. Those are amendable precisely because they are
-- not identity evidence -- but "not identity evidence" is not the same as
-- "nobody should look". An administrator's email changing the week before a
-- payment run is not suspicious on its own and is worth somebody seeing.
--
-- THE TASK IS NOT THE EVIDENCE. The amendment record already holds what
-- changed, who changed it and why; this points at it. What IS evidence is the
-- RESOLUTION -- "somebody looked at this and accepted it" -- and that is
-- written to the vault, so a task row can be pruned while the decision cannot.

CREATE TABLE "review_tasks" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId" UUID NOT NULL,

  -- From REVIEW_TASK_KINDS. The kind carries the stakes, and the stakes decide
  -- whether an automated check may close it.
  "kind"        TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId"   UUID NOT NULL,

  -- What a reviewer reads first. Written when the task is raised, because the
  -- thing that raised it knows what changed and a reviewer opening it later
  -- should not have to reconstruct that.
  "summary" TEXT NOT NULL,
  -- The diff, or whatever the raiser wants the reviewer to see.
  "detail"  JSONB NOT NULL DEFAULT '{}'::jsonb,

  "state"     TEXT NOT NULL DEFAULT 'open',
  "raisedBy"  TEXT NOT NULL,
  "raisedAt"  TIMESTAMP(3) NOT NULL DEFAULT now(),

  -- Leasing, so a human and a checker cannot both work the same task.
  "claimedBy"      TEXT,
  "claimExpiresAt" TIMESTAMP(3),

  -- What an automated check thought. ADVICE, recorded whether or not it was
  -- allowed to act on it -- a model that flagged something a person then
  -- dismissed is worth being able to find later.
  "autoVerdict"     TEXT,
  "autoConfidence"  DOUBLE PRECISION,
  "autoReasoning"   TEXT,
  "autoCheckedBy"   TEXT,
  "autoCheckedAt"   TIMESTAMP(3),

  "resolution"   TEXT,
  "resolvedBy"   TEXT,
  "resolvedAt"   TIMESTAMP(3),
  "resolvedNote" TEXT,
  -- TRUE when no person looked. Recorded as its own column rather than
  -- inferred from resolvedBy, because "was this reviewed by a human" is a
  -- question somebody will ask of the whole table at once.
  "resolvedAutomatically" BOOLEAN NOT NULL DEFAULT false,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

-- The reviewer's queue: what is open, oldest first.
CREATE INDEX "review_tasks_open_idx"
  ON "review_tasks" ("practiceId", "raisedAt")
  WHERE "state" IN ('open', 'claimed');

-- A checker looking for work of a kind it can handle.
CREATE INDEX "review_tasks_kind_idx"
  ON "review_tasks" ("kind", "raisedAt")
  WHERE "state" IN ('open', 'claimed');

-- "What did we close without a person looking" -- the question this schema
-- exists to keep answerable.
CREATE INDEX "review_tasks_auto_idx"
  ON "review_tasks" ("practiceId", "resolvedAt")
  WHERE "resolvedAutomatically" = true;

-- Same fail-closed tenancy as everything else holding practice data.
ALTER TABLE "review_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "review_tasks" FORCE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON "review_tasks"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

-- A resolved task has a resolution and a time. Cheap, and it catches the class
-- of bug where something is marked done without recording what was decided.
ALTER TABLE "review_tasks" ADD CONSTRAINT review_tasks_resolved_is_complete
  CHECK (
    "state" NOT IN ('resolved', 'dismissed')
    OR ("resolution" IS NOT NULL AND "resolvedAt" IS NOT NULL AND "resolvedBy" IS NOT NULL)
  );

-- An automated resolution must say how confident it was. A closure with no
-- confidence recorded is one nobody can weigh afterwards.
ALTER TABLE "review_tasks" ADD CONSTRAINT review_tasks_auto_has_confidence
  CHECK ("resolvedAutomatically" = false OR "autoConfidence" IS NOT NULL);

-- Which practices have open work. Same shape and same reason as
-- outbound_due_practices: a checker sweeping every practice has no scope to
-- run in, RLS is fail-closed, and this returns COUNTS ONLY -- never a summary,
-- never a detail, never a subject id.
CREATE OR REPLACE FUNCTION core.review_tasks_due_practices(p_limit integer DEFAULT 200)
RETURNS TABLE ("practiceId" uuid, "waiting" bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT "practiceId", count(*) AS waiting
  FROM core.review_tasks
  WHERE "state" = 'open'
     OR ("state" = 'claimed' AND ("claimExpiresAt" IS NULL OR "claimExpiresAt" <= now()))
  GROUP BY "practiceId"
  ORDER BY count(*) DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION core.review_tasks_due_practices(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.review_tasks_due_practices(integer) TO aob_app;
