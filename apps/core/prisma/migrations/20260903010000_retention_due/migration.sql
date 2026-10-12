-- Retention sweep: what is due, across practices (CONSULTATION-CAPTURE-PLAN.md Part 5, item 6).
--
-- WHY SECURITY DEFINER, per CONVENTIONS.md §6. The sweep acts for the platform,
-- not a practice; under FORCE RLS an unscoped read returns zero rows and the
-- sweep would report success while removing nothing. These three functions
-- return IDS ONLY — never a body, a subject or a filename. Every write happens
-- afterwards inside withPractice()/withPractitioner(), scoped like everything
-- else. legalHold is excluded here AND re-checked under scope before any write.

-- (a) Agreements whose retention expiry has arrived and may move to the terminal
-- state. Statuses are the ones lifecycle.ts allows into retention_expiry_scheduled,
-- less legal_hold (a hold is not a longer expiry — it wins outright).
-- The clock source comes from the linked service records, least trustworthy
-- first, so the event can say when the clock was defaulted (REQ-INT-04).
CREATE OR REPLACE FUNCTION core.retention_due_agreements(p_today date, p_limit integer DEFAULT 500)
RETURNS TABLE (id uuid, "practiceId" uuid, "retentionClockSource" text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT a."id", a."practiceId",
         COALESCE((
           SELECT CASE
             WHEN bool_or(sr."retentionClockSource" = 'conservative_default') THEN 'conservative_default'
             WHEN bool_or(sr."retentionClockSource" = 'practice_asserted') THEN 'practice_asserted'
             ELSE 'observed_claim' END
           FROM core.service_records sr WHERE sr."agreementId" = a."id"
         ), 'conservative_default')
  FROM core.agreements a
  WHERE a."retentionExpiryDate" IS NOT NULL
    AND a."retentionExpiryDate" <= p_today
    AND a."legalHold" = false
    AND a."status" IN ('stored', 'claim_linked', 'ceased')
  ORDER BY a."retentionExpiryDate"
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION core.retention_due_agreements(date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.retention_due_agreements(date, integer) TO aob_app;

-- (b) Correspondence past expiry that still carries text. practiceId is NULL for
-- a practitioner's personal message; recipientId lets the sweep scope those
-- through withPractitioner() instead.
CREATE OR REPLACE FUNCTION core.retention_due_correspondence(p_today date, p_limit integer DEFAULT 500)
RETURNS TABLE (id uuid, "practiceId" uuid, "recipientId" uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT c."id", c."practiceId", c."recipientId"
  FROM core.correspondence c
  WHERE c."retentionExpiryDate" IS NOT NULL
    AND c."retentionExpiryDate" <= p_today
    AND c."legalHold" = false
    AND c."contentRemovedAt" IS NULL
  ORDER BY c."retentionExpiryDate"
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION core.retention_due_correspondence(date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.retention_due_correspondence(date, integer) TO aob_app;

-- (c) Artefacts past expiry whose bytes are still in the store.
CREATE OR REPLACE FUNCTION core.retention_due_artefacts(p_today date, p_limit integer DEFAULT 500)
RETURNS TABLE (id uuid, "practiceId" uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT f."id", f."practiceId"
  FROM core.artefacts f
  WHERE f."retentionExpiryDate" IS NOT NULL
    AND f."retentionExpiryDate" <= p_today
    AND f."legalHold" = false
    AND f."deletedAt" IS NULL
  ORDER BY f."retentionExpiryDate"
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION core.retention_due_artefacts(date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.retention_due_artefacts(date, integer) TO aob_app;
