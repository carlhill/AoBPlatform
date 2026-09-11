-- ARRIVALS — "this patient has just walked up to reception to see this
-- provider" (Carl, 4 Sep 2026; TODO.md "Reception-centric" section 2).
--
-- Until now nothing told the platform that a person walked in: the queue was
-- fed by dev staging scripts and by the appointment sweep. D-01 (Medtech's
-- write-back / event mechanism) is unresolved, so we own the SHAPE of the
-- message and leave the transport open — whatever Evolution turns out to
-- allow, the site connector's job becomes "produce this".
--
-- WHAT IS NOT IN THIS TABLE, and why each absence is load-bearing:
--   * NO Medicare number column. Ever. The card number is not an identity
--     identifier and the exclusion is not configurable (hard rule 1,
--     REQ-VER-02, HARD-03).
--   * NO benefit and no amount (hard rule 4).
--   * NOT the five patient details. They ride IN the message because the PMS
--     is the source of truth (REQ-DATA-10) and land on `patients`, the one
--     mirror. Only the detail TYPES that changed are kept here — names, never
--     values (REQ-VER-04, REQ-LOG-08).
--   * NO sender-supplied agreement type. `visitDecision` is written by the
--     platform's own versioned visit policy; a CHECK constraint limits it to
--     the three answers that policy can give, so no future code path can
--     record something a rule set did not say (hard rules 6 and 14).
--
-- REVERSIBLE AND IDEMPOTENT. Purely additive: one new table, no column added
-- to and no constraint changed on anything that already exists, so the reverse
-- is `DROP TABLE IF EXISTS "arrivals";` and nothing else has to be unpicked.
-- Written to be applied twice (DEV-LOOP.md).

CREATE TABLE IF NOT EXISTS "arrivals" (
  "id"                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId"             UUID NOT NULL,
  "pmsPatientRecordNumber" TEXT NOT NULL,
  "patientId"              UUID,
  "providerId"             UUID,
  "providerNumber"         TEXT,
  "assignorId"             UUID,
  "patientCreated"         BOOLEAN NOT NULL DEFAULT false,
  "detailsChanged"         TEXT[] NOT NULL DEFAULT '{}',
  "visitDecision"          TEXT,
  "decisionReason"         TEXT,
  "policyVersion"          TEXT,
  "agreementId"            UUID,
  "captureRequestId"       UUID,
  "arrivedAt"              TIMESTAMP(3) NOT NULL,
  "receivedAt"             TIMESTAMP(3) NOT NULL DEFAULT now(),
  "source"                 TEXT NOT NULL,
  "idempotencyKey"         TEXT NOT NULL
);

-- THE IDEMPOTENCY FENCE, IN THE DATABASE. A connector on a practice's ADSL
-- retries; two arrivals for one walk-in would be two agreements for one visit
-- and the same person twice on reception's queue. The service checks first,
-- and this makes the check true under a race as well as in sequence.
CREATE UNIQUE INDEX IF NOT EXISTS "arrivals_practiceId_idempotencyKey_key"
  ON "arrivals" ("practiceId", "idempotencyKey");

CREATE INDEX IF NOT EXISTS "arrivals_practiceId_arrivedAt_idx"
  ON "arrivals" ("practiceId", "arrivedAt");

DO $$
BEGIN
  -- HARD RULES 6 AND 14 IN THE COLUMN DEFINITION. These three are every answer
  -- the visit policy can give. A PMS that wants to assert "enduring" has no
  -- field to say it in and no value the database would accept if it did.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arrivals_visit_decision_known') THEN
    ALTER TABLE "arrivals" ADD CONSTRAINT arrivals_visit_decision_known
      CHECK ("visitDecision" IS NULL OR "visitDecision" IN ('enduring', 'episodic_pre', 'none'));
  END IF;

  -- A decision without the version of the table that made it is a decision
  -- nobody can audit in 2028 (hard rule 14).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arrivals_decision_carries_its_version') THEN
    ALTER TABLE "arrivals" ADD CONSTRAINT arrivals_decision_carries_its_version
      CHECK ("visitDecision" IS NULL OR ("policyVersion" IS NOT NULL AND "decisionReason" IS NOT NULL));
  END IF;

  -- A real practice's software and a dev script must never look alike here.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arrivals_source_known') THEN
    ALTER TABLE "arrivals" ADD CONSTRAINT arrivals_source_known
      CHECK ("source" IN ('connector', 'dev'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arrivals_has_idempotency_key') THEN
    ALTER TABLE "arrivals" ADD CONSTRAINT arrivals_has_idempotency_key
      CHECK (length(trim("idempotencyKey")) > 0 AND length(trim("pmsPatientRecordNumber")) > 0);
  END IF;

  -- `none` MEANS NOTHING WAS DRAFTED. An arrival claiming the patient was
  -- already covered while pointing at an agreement it created is two stories.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arrivals_none_drafts_nothing') THEN
    ALTER TABLE "arrivals" ADD CONSTRAINT arrivals_none_drafts_nothing
      CHECK ("visitDecision" IS DISTINCT FROM 'none' OR "agreementId" IS NULL);
  END IF;
END
$$;

-- Practice scoping at the DB layer, FORCE so it applies to the owner too.
ALTER TABLE "arrivals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "arrivals" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS practice_isolation ON "arrivals";
CREATE POLICY practice_isolation ON "arrivals"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

-- NOT APPEND-ONLY, and the reason is worth stating because every other table
-- added this month was. An arrival is received first and DECIDED a moment
-- later — the draft, the capture request and the lock each need their own
-- transaction (the services that own those guards open their own), so the
-- decision is written back onto the row that is already there. The evidence is
-- the `arrival.received` vault event, which is append-only by construction and
-- is written in the SAME transaction as the row it is about (hard rule 11).
