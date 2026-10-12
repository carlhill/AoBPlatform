-- THE POST-SERVICE PUSH — the second moment, on the same desk (Carl, 11 Sep
-- 2026; TODO.md "Two front doors" decision (b), "Still to build: Post-service
-- push").
--
-- The patient has seen the practitioner and the service is known: the day it
-- was rendered (D5) and its MBS item numbers (D6b — post-agreements only,
-- REQ-REG-01; s 65C(4) table item 6). Where no pre-agreement covers the billed
-- item, reception pushes a NEW agreement to the same tablet and the patient
-- signs it. The tap is a SIGNATURE in its own right (REQ-REG-07), never a
-- confirmation of the earlier one.
--
-- WHY THIS EXTENDS `service_records` RATHER THAN ADDING A TABLE. A rendered
-- service IS a billed service, and `service_records` is already the platform's
-- model of one: the reconciliation queue bands it by the lodgement window
-- (REQ-CHASE-05), `resend` refuses one past the deadline (REQ-CHASE-08), and
-- `ChaseAttemptsService` measures the whole ladder from its `serviceDate`. A
-- second table for the same fact would be a second place for the chase to
-- forget to look. The unique `("practiceId","pmsInvoiceKey")` already there is
-- the idempotency fence a connector on a practice's ADSL needs.
--
-- WHAT IS NOT ADDED, and every absence is load-bearing:
--   * NO Medicare number column. Ever (hard rule 1, REQ-VER-02, HARD-03).
--   * NO benefit, fee or dollar amount (hard rule 4). A post-agreement states
--     the date and the item numbers; the amount is not in the s 65C data set
--     and adding it is risk.
--   * NO sender-supplied decision. `visitDecision` is written by the platform's
--     own versioned post-service table and a CHECK limits it to the three
--     answers that table can give (hard rule 14).
--
-- REVERSIBLE AND IDEMPOTENT. Purely additive columns on one existing table,
-- with no column dropped and no existing constraint altered, so the reverse is
-- to drop the constraints and the ten columns named below. Written to be
-- applied twice (DEV-LOOP.md).

ALTER TABLE "service_records" ADD COLUMN IF NOT EXISTS "affiliationId" UUID;
ALTER TABLE "service_records" ADD COLUMN IF NOT EXISTS "visitDecision" TEXT;
ALTER TABLE "service_records" ADD COLUMN IF NOT EXISTS "decisionReason" TEXT;
ALTER TABLE "service_records" ADD COLUMN IF NOT EXISTS "policyVersion" TEXT;
ALTER TABLE "service_records" ADD COLUMN IF NOT EXISTS "coveringAgreementId" UUID;
ALTER TABLE "service_records" ADD COLUMN IF NOT EXISTS "captureRequestId" UUID;
ALTER TABLE "service_records" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "service_records" ADD COLUMN IF NOT EXISTS "receivedByPrincipalId" TEXT;
ALTER TABLE "service_records" ADD COLUMN IF NOT EXISTS "serviceRenderedAt" TIMESTAMP(3);
ALTER TABLE "service_records" ADD COLUMN IF NOT EXISTS "chaseStartedAt" TIMESTAMP(3);

DO $$
BEGIN
  -- HARD RULE 14 IN THE COLUMN DEFINITION. These three are every answer the
  -- post-service table can give. A PMS that wants to assert "nothing needed"
  -- has no field to say it in and no value the database would accept if it did.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_records_visit_decision_known') THEN
    ALTER TABLE "service_records" ADD CONSTRAINT service_records_visit_decision_known
      CHECK ("visitDecision" IS NULL
        OR "visitDecision" IN ('covered', 'covered_by_enduring', 'episodic_post'));
  END IF;

  -- A decision without the version of the table that made it is a decision
  -- nobody can audit in 2028 (hard rule 14).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_records_decision_carries_its_version') THEN
    ALTER TABLE "service_records" ADD CONSTRAINT service_records_decision_carries_its_version
      CHECK ("visitDecision" IS NULL
        OR ("policyVersion" IS NOT NULL AND "decisionReason" IS NOT NULL));
  END IF;

  -- COVERED MEANS NOTHING WAS DRAFTED, AND SAYS WHAT COVERED IT. A record
  -- claiming the visit was already covered while pointing at nothing is a
  -- record reception cannot follow anywhere, and "shortcuts to the answer"
  -- (CLAUDE.md section 7) means the covering agreement has to be nameable.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_records_covered_names_what_covered_it') THEN
    ALTER TABLE "service_records" ADD CONSTRAINT service_records_covered_names_what_covered_it
      CHECK ("visitDecision" NOT IN ('covered', 'covered_by_enduring')
        OR "coveringAgreementId" IS NOT NULL);
  END IF;

  -- A real practice's software, a dev script and a person at the front desk
  -- must never look alike in the evidence (PMS_to_AoB_Workflow.md case 4, W2).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_records_source_known') THEN
    ALTER TABLE "service_records" ADD CONSTRAINT service_records_source_known
      CHECK ("source" IS NULL OR "source" IN ('connector', 'dev', 'reception'));
  END IF;

  -- WHOSE HANDS TYPED IT, and null when nobody's did — the same fence
  -- `arrivals_principal_only_when_typed` puts up. A connector push naming a
  -- staff member would assert that somebody vouched for a message nobody read.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_records_principal_only_when_typed') THEN
    ALTER TABLE "service_records" ADD CONSTRAINT service_records_principal_only_when_typed
      CHECK ("receivedByPrincipalId" IS NULL OR "source" = 'reception');
  END IF;

  -- THE THIRTY-MINUTE CLOCK NEEDS A START. A record that says the cascade was
  -- entered but not when the platform learned of the service could not be
  -- audited against REQ-CHASE-05's banding.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_records_chase_started_after_a_known_service') THEN
    ALTER TABLE "service_records" ADD CONSTRAINT service_records_chase_started_after_a_known_service
      CHECK ("chaseStartedAt" IS NULL OR "serviceRenderedAt" IS NOT NULL);
  END IF;
END
$$;

-- The sweep's own read: services still waiting on a signature, oldest first.
CREATE INDEX IF NOT EXISTS "service_records_practiceId_serviceRenderedAt_idx"
  ON "service_records" ("practiceId", "serviceRenderedAt");

-- WHICH SERVICES ARE STILL WAITING ON A SIGNATURE, ACROSS PRACTICES — the
-- thirty-minute nudge that is the chase cascade's first rung (REQ-CHASE-05;
-- TODO.md "Reminders are the fallback, not the flow").
--
-- WHY SECURITY DEFINER, per CONVENTIONS.md section 6 and exactly as
-- `core.retention_due_agreements` does it. A sweep acts for the platform and has
-- no practice scope of its own, and RLS on `service_records` correctly yields
-- nothing to an unscoped read. This returns PRACTICE IDS ONLY — no patient, no
-- agreement, no item number, no amount — and every read and write that follows
-- happens inside `withPractice()`, scoped like everything else.
CREATE OR REPLACE FUNCTION core.post_service_chase_due(p_cutoff timestamp, p_limit integer DEFAULT 50)
RETURNS TABLE ("practiceId" uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT DISTINCT s."practiceId"
  FROM core.service_records s
  WHERE s."visitDecision" = 'episodic_post'
    AND s."chaseStartedAt" IS NULL
    AND s."serviceRenderedAt" IS NOT NULL
    AND s."serviceRenderedAt" <= p_cutoff
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION core.post_service_chase_due(timestamp, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.post_service_chase_due(timestamp, integer) TO aob_app;
