-- FR-7.3 — convert-or-forgo (design wireframe R-3).
--
-- A service was billed, the patient was seen, and no agreement was captured.
-- A person decides what happens to the benefit. Nothing happens by default,
-- and either choice is recorded — with the deciding person's identity.
--
-- APPEND-ONLY, like signature events: a decision is superseded by a later one,
-- never edited or deleted. The trigger is what makes that true regardless of
-- which code path writes.

CREATE TABLE "reconciliation_decisions" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId"      UUID NOT NULL,
  "serviceRecordId" UUID NOT NULL REFERENCES "service_records"("id"),
  "decision"        TEXT NOT NULL,
  "reason"          TEXT,
  "decidedBy"       TEXT NOT NULL,
  "decidedAt"       TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE INDEX "reconciliation_decisions_practiceId_serviceRecordId_decidedAt_idx"
  ON "reconciliation_decisions" ("practiceId", "serviceRecordId", "decidedAt");

ALTER TABLE "reconciliation_decisions" ADD CONSTRAINT reconciliation_decisions_decision_known
  CHECK ("decision" IN ('convert_to_private', 'forgo_benefit', 'keep_chasing'));
ALTER TABLE "reconciliation_decisions" ADD CONSTRAINT reconciliation_decisions_has_decider
  CHECK (length(trim("decidedBy")) > 0);

ALTER TABLE "reconciliation_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_decisions" FORCE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON "reconciliation_decisions"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION core.reconciliation_decisions_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'reconciliation decisions are append-only evidence (FR-7.3): a later decision supersedes, nothing rewrites';
END;
$$;

CREATE TRIGGER reconciliation_decisions_no_update
  BEFORE UPDATE ON "reconciliation_decisions"
  FOR EACH ROW EXECUTE FUNCTION core.reconciliation_decisions_append_only();
CREATE TRIGGER reconciliation_decisions_no_delete
  BEFORE DELETE ON "reconciliation_decisions"
  FOR EACH ROW EXECUTE FUNCTION core.reconciliation_decisions_append_only();
