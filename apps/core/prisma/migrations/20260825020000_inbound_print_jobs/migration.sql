-- Work arriving FROM a practice's desktop: a print job, parsed down to the
-- s 65C fields before it left the practice (CONSULTATION-CAPTURE-PLAN.md
-- Parts 8 and 9).
--
-- THE MIRROR IMAGE OF outbound_items, built the same way on purpose: the same
-- states, lease, backoff and attempt budget, the same "dead is kept, never
-- deleted". What it adds is the LANE. The morning appointment list is
-- hundreds of rows printed by every practice at eight o'clock; the arrival
-- slip is one patient standing at the desk. One FIFO queue puts the second
-- behind the first, and that is the ordinary morning, not a spike. One worker
-- per lane makes starvation impossible by construction rather than by tuning.

CREATE TABLE "inbound_print_jobs" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId"            UUID NOT NULL,
  "deviceId"              TEXT,
  "credentialKind"        TEXT NOT NULL DEFAULT 'practice',
  "documentType"          TEXT NOT NULL,
  "lane"                  TEXT NOT NULL,
  "pms"                   TEXT NOT NULL,
  "parserTemplateVersion" TEXT NOT NULL,
  "sourceSha256"          TEXT NOT NULL,
  "payload"               JSONB NOT NULL,
  "state"                 TEXT NOT NULL DEFAULT 'pending',
  "attempts"              INTEGER NOT NULL DEFAULT 0,
  "availableAt"           TIMESTAMP(3) NOT NULL DEFAULT now(),
  "leasedBy"              TEXT,
  "leaseExpiresAt"        TIMESTAMP(3),
  "lastError"             TEXT,
  "receivedAt"            TIMESTAMP(3) NOT NULL DEFAULT now(),
  "processedAt"           TIMESTAMP(3),
  "outcome"               JSONB
);

-- The same document printed twice is the same job: same type, same bytes.
-- Enforced here, because two desktops racing is exactly how a duplicate
-- would appear and the service cannot see the other transaction.
CREATE UNIQUE INDEX "inbound_print_jobs_practiceId_documentType_sourceSha256_key"
  ON "inbound_print_jobs" ("practiceId", "documentType", "sourceSha256");

-- One claimable index PER LANE, so each lane's worker reads only its own.
CREATE INDEX "inbound_print_jobs_claimable_idx"
  ON "inbound_print_jobs" ("practiceId", "lane", "availableAt")
  WHERE "state" IN ('pending', 'failed');
CREATE INDEX "inbound_print_jobs_expired_lease_idx"
  ON "inbound_print_jobs" ("leaseExpiresAt")
  WHERE "state" = 'leased';
CREATE INDEX "inbound_print_jobs_dead_idx"
  ON "inbound_print_jobs" ("practiceId") WHERE "state" = 'dead';
CREATE INDEX "inbound_print_jobs_practiceId_lane_state_idx"
  ON "inbound_print_jobs" ("practiceId", "lane", "state");

-- The values are declared in packages/domain/src/inbound-lanes.ts; the
-- database refuses anything else so a typo cannot create a fourth lane that
-- no worker ever reads.
ALTER TABLE "inbound_print_jobs" ADD CONSTRAINT inbound_print_jobs_lane_known
  CHECK ("lane" IN ('critical', 'standard', 'fyi'));
ALTER TABLE "inbound_print_jobs" ADD CONSTRAINT inbound_print_jobs_state_known
  CHECK ("state" IN ('pending', 'leased', 'done', 'failed', 'dead'));
ALTER TABLE "inbound_print_jobs" ADD CONSTRAINT inbound_print_jobs_credential_known
  CHECK ("credentialKind" IN ('device', 'practice'));
ALTER TABLE "inbound_print_jobs" ADD CONSTRAINT inbound_print_jobs_payload_is_object
  CHECK (jsonb_typeof("payload") = 'object');
ALTER TABLE "inbound_print_jobs" ADD CONSTRAINT inbound_print_jobs_sha256_shape
  CHECK ("sourceSha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "inbound_print_jobs" ADD CONSTRAINT inbound_print_jobs_done_has_time
  CHECK (("state" = 'done') = ("processedAt" IS NOT NULL));

-- Same fail-closed tenancy as everything else holding practice data.
ALTER TABLE "inbound_print_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbound_print_jobs" FORCE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON "inbound_print_jobs"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

/*
 * Which practices have work on a lane.
 *
 * The same shape and the same justification as outbound_due_practices: RLS
 * here is fail-closed and FORCEd, so a worker with no practice scope sees
 * zero rows. Rather than weaken the policy on a table holding patient names,
 * this narrow SECURITY DEFINER function returns practice ids and a count —
 * never a payload — and every line after it runs inside withPractice().
 * Per lane, so the critical worker never learns about bulk work at all.
 */
CREATE OR REPLACE FUNCTION core.inbound_due_practices(p_lane text, p_limit integer DEFAULT 200)
RETURNS TABLE ("practiceId" uuid, "waiting" bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT "practiceId", count(*) AS waiting
  FROM core.inbound_print_jobs
  WHERE "lane" = p_lane
    AND (
      ("state" IN ('pending', 'failed') AND "availableAt" <= now())
      OR ("state" = 'leased' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= now()))
    )
  GROUP BY "practiceId"
  ORDER BY count(*) DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION core.inbound_due_practices(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.inbound_due_practices(text, integer) TO aob_app;
