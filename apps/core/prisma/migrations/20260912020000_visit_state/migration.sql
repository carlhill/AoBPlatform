-- A STATUS PER PATIENT, SET FROM THE PRACTITIONER'S WAITING LIST
-- (Carl, 12 Sep 2026; PRACTITIONER-QUEUE-PAGE.md section 3a).
--
-- Carl, annotating the grouped waiting list: "Need buttons or drop down to say
-- 1. With patient now 2. Pending (patient in queue) 3. Completed (consultation
-- completed) 4. Reassign (to a different Doctor) -- Reception will have a task
-- on the frontdesk/patient page to reassign the patient to a different doctor
-- and do the necessary checks and so on."
--
-- ONE ROW PER SAYING, NEVER ONE PER VISIT. Section 3a rule 6: "Reversible and
-- recorded. A wrong state is corrected, and the correction is kept beside the
-- original rather than over it." So there is deliberately NO unique key on
-- `arrivalId`: a correction is an INSERT with a later `setAt`, the row it
-- corrects survives, and the reader takes the newest. Nothing in the
-- application UPDATEs or DELETEs this table -- the same instinct as hard rule
-- 11, where the vault has neither verb.
--
-- IT IS ATTENDANCE, NOT CLINICAL DOCUMENTATION (section 3a rule 1;
-- VISIT-CHECKLIST.md section 5). The design is in what has no column: no
-- reason, no note, no triage category, no duration, no result, no amount (hard
-- rule 4) and no identifier value (hard rules 1 and 9). "A note box here
-- becomes a clinical record within a week", so there is nowhere to put one.
--
-- WHO SET IT COMES FROM THE TOKEN, NEVER FROM A TYPED NAME. `setByPrincipalId`
-- is a principal; there is no name column and adding one would be adding a box
-- somebody could type into.
--
-- IT GATES NOTHING (section 3a rule 5, hard rule 8, REQ-REC-04). No other query
-- joins on this table to decide whether a patient may be seen or billed.
--
-- NO FOREIGN KEYS, because this family of tables carries none by design -- the
-- same shape `arrivals` has, for the reason recorded there. Scoping is RLS on
-- `practiceId`, which is where it belongs (ADR: practice scoping at the DB
-- layer).
--
-- Idempotent, written to be applied twice (DEV-LOOP.md), and reversible: the
-- down path is the DROP at the foot of this file, commented because Prisma
-- migrations do not run one. Nothing else in the schema references this table,
-- so dropping it takes nothing with it.

CREATE TABLE IF NOT EXISTS "visit_states" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId"         UUID NOT NULL,
  "arrivalId"          UUID NOT NULL,
  "state"              TEXT NOT NULL,
  "statesVersion"      TEXT NOT NULL,
  "setByPrincipalId"   TEXT NOT NULL,
  "setByPrincipalType" TEXT NOT NULL,
  "setAt"              TIMESTAMP(3) NOT NULL DEFAULT now(),
  "serviceRecordId"    UUID,
  "renderedOutcome"    TEXT,
  "reviewTaskId"       UUID
);

-- THE CHECK IS DERIVED FROM THE DOMAIN LIST, not from a second literal somebody
-- has to remember to keep in step: these four keys are the `key` fields of
-- `packages/domain/content/visit-states.json` at version
-- `visit-states-2026-09-1`. Adding a fifth state is a content change AND a
-- migration, deliberately -- the database is the last place that can stop a
-- value nobody wrote code for (the same rule the copy-links channel CHECK
-- follows).
ALTER TABLE "visit_states" DROP CONSTRAINT IF EXISTS "visit_states_state_check";
ALTER TABLE "visit_states" ADD CONSTRAINT "visit_states_state_check"
  CHECK ("state" IN ('pending', 'with_patient_now', 'completed', 'reassign'));

-- `pending` IS THE STARTING STATE AND NOBODY SETS IT (section 3a's table gives
-- it no setter). An untouched visit reads `pending` because there is no row at
-- all, so a stored `pending` would be a person moving a patient BACKWARDS into
-- "not yet seen" after the service-rendered signal had already gone. The
-- application refuses it; so does this.
ALTER TABLE "visit_states" DROP CONSTRAINT IF EXISTS "visit_states_never_stores_the_starting_state";
ALTER TABLE "visit_states" ADD CONSTRAINT "visit_states_never_stores_the_starting_state"
  CHECK ("state" <> 'pending');

-- "Where has this visit got to" -- the read every row of the waiting list
-- makes, always about one practice, one arrival, newest first.
CREATE INDEX IF NOT EXISTS "visit_states_arrival_idx"
  ON "visit_states" ("practiceId", "arrivalId", "setAt");
CREATE INDEX IF NOT EXISTS "visit_states_practice_idx"
  ON "visit_states" ("practiceId", "setAt");

-- Practice scoping at the DB layer, fail-closed and FORCEd like every other
-- practice-scoped table. A cross-practice write cannot be committed even if
-- every application check above it were removed.
ALTER TABLE "visit_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visit_states" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_isolation ON "visit_states";
CREATE POLICY practice_isolation ON "visit_states"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

-- DOWN (by hand, DEV-LOOP.md):
--   DROP TABLE IF EXISTS "visit_states";
