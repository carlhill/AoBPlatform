-- THE AOBPRINTER HOST, AS THE PLATFORM LAST HEARD FROM IT
-- (PRINTER-HEARTBEAT.md section 3, D-2026-10-10-02 and its amendment).
--
-- Every minute the host at a practice posts `POST /inbound/print-jobs/heartbeat`
-- with stage counts, versions and the head of its local audit chain. One row
-- per (practice, chain): the chain id is the hash of the host's audit event
-- seq 1, so a rewritten log or a second host arrives as a SECOND row and can
-- never quietly overwrite the first (decision 6).
--
-- COUNTS, HASHES, CODES, VERSIONS AND TIMES ONLY. No name, no chart number,
-- no form reference, no path (hard rule 9). There is no free-text column.
--
-- THE ROW IS TELEMETRY; THE EVIDENCE IS IN THE VAULT. A beat updates the row
-- in place. What it says about the chain goes to the vault through the outbox
-- in the same transaction (hard rule 11), so a DBA editing this table cannot
-- edit what the vault holds -- which is the whole point of decision 5.
--
-- NO FOREIGN KEYS, like the rest of this family of tables. Scoping is RLS on
-- `practiceId`.
--
-- Idempotent, written to be applied twice (DEV-LOOP.md), and reversible: the
-- down path is at the foot of this file, commented because Prisma migrations
-- do not run one. Nothing else in the schema references this table.

CREATE TABLE IF NOT EXISTS "aobprinter_hosts" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId"       UUID NOT NULL,
  "chainId"          TEXT NOT NULL,
  "lastSeenAt"       TIMESTAMP(3) NOT NULL,
  "hostSentAt"       TIMESTAMP(3) NOT NULL,
  "intervalMs"       INTEGER NOT NULL,
  "printerVersion"   TEXT NOT NULL,
  "templateVersion"  TEXT NOT NULL,
  "schemaVersion"    INTEGER NOT NULL,
  "runtimeVersion"   TEXT NOT NULL,
  "startedAt"        TIMESTAMP(3) NOT NULL,
  "collecting"       BOOLEAN NOT NULL,
  "retentionEnabled" BOOLEAN NOT NULL,
  "queueCount"       INTEGER NOT NULL,
  "counts"           JSONB NOT NULL,
  "openExceptions"   JSONB NOT NULL,
  "filedUnconfirmed" JSONB NOT NULL,
  "localCheck"       JSONB NOT NULL,
  "headSeq"          INTEGER NOT NULL,
  "headHash"         TEXT,
  "headAdvancedAt"   TIMESTAMP(3),
  "anchorSeq"        INTEGER NOT NULL,
  "anchorHash"       TEXT,
  "anchorVerifiedAt" TIMESTAMP(3),
  "vaultAnchoredAt"  TIMESTAMP(3),
  "chainStatus"      TEXT NOT NULL,
  "regressionKind"   TEXT,
  "regressionAt"     TIMESTAMP(3),
  "regressionDetail" JSONB,
  "rebaselinedAt"    TIMESTAMP(3),
  "rebaselinedBy"    TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "aobprinter_hosts_practiceId_chainId_key"
  ON "aobprinter_hosts" ("practiceId", "chainId");
CREATE INDEX IF NOT EXISTS "aobprinter_hosts_practiceId_lastSeenAt_idx"
  ON "aobprinter_hosts" ("practiceId", "lastSeenAt");

-- HASHES ARE LOWER-CASE SHA-256 HEX, and nothing else can be stored where a
-- hash goes -- which is also what keeps a stray value out of these columns.
ALTER TABLE "aobprinter_hosts" DROP CONSTRAINT IF EXISTS "aobprinter_hosts_hashes_are_sha256";
ALTER TABLE "aobprinter_hosts" ADD CONSTRAINT "aobprinter_hosts_hashes_are_sha256"
  CHECK (
    "chainId" ~ '^[0-9a-f]{64}$'
    AND ("headHash" IS NULL OR "headHash" ~ '^[0-9a-f]{64}$')
    AND ("anchorHash" IS NULL OR "anchorHash" ~ '^[0-9a-f]{64}$')
  );

ALTER TABLE "aobprinter_hosts" DROP CONSTRAINT IF EXISTS "aobprinter_hosts_seqs_are_sane";
ALTER TABLE "aobprinter_hosts" ADD CONSTRAINT "aobprinter_hosts_seqs_are_sane"
  CHECK ("headSeq" >= 0 AND "anchorSeq" >= 0 AND "intervalMs" > 0);

-- THE ANCHOR IS NEVER AHEAD OF THE HEAD -- except on a regressed row. The
-- verdict's rule 2 updates the head of a regressed chain and leaves the
-- anchor where it was, so a chain that went backwards (rule 3) legitimately
-- has its head behind its anchor until an operator re-baselines it, which puts
-- the anchor back at the head.
ALTER TABLE "aobprinter_hosts" DROP CONSTRAINT IF EXISTS "aobprinter_hosts_anchor_not_ahead_of_head";
ALTER TABLE "aobprinter_hosts" ADD CONSTRAINT "aobprinter_hosts_anchor_not_ahead_of_head"
  CHECK ("chainStatus" = 'regressed' OR "anchorSeq" <= "headSeq");

-- THE LISTS ARE COPIED FROM THE DOMAIN, not a second literal somebody keeps in
-- step by memory: `AOBPRINTER_CHAIN_STATUSES` and `AOBPRINTER_CHAIN_REGRESSIONS`
-- in `packages/domain/src/aobprinter-host.ts` (re-exported as types by
-- `@aobplatform/contracts`). Adding a value is a domain change AND a migration.
ALTER TABLE "aobprinter_hosts" DROP CONSTRAINT IF EXISTS "aobprinter_hosts_chain_status_check";
ALTER TABLE "aobprinter_hosts" ADD CONSTRAINT "aobprinter_hosts_chain_status_check"
  CHECK ("chainStatus" IN ('unverified', 'consistent', 'regressed'));

ALTER TABLE "aobprinter_hosts" DROP CONSTRAINT IF EXISTS "aobprinter_hosts_regression_kind_check";
ALTER TABLE "aobprinter_hosts" ADD CONSTRAINT "aobprinter_hosts_regression_kind_check"
  CHECK (
    "regressionKind" IS NULL
    OR "regressionKind" IN ('went_backwards', 'same_seq_different_hash', 'anchor_mismatch', 'chain_replaced')
  );

-- REGRESSED IF AND ONLY IF THERE IS A KIND. A regressed row with no reason
-- would be a flag nobody could explain; a reason on a row that is not
-- regressed would be a finding nobody is shown.
ALTER TABLE "aobprinter_hosts" DROP CONSTRAINT IF EXISTS "aobprinter_hosts_regressed_iff_kind";
ALTER TABLE "aobprinter_hosts" ADD CONSTRAINT "aobprinter_hosts_regressed_iff_kind"
  CHECK (("chainStatus" = 'regressed') = ("regressionKind" IS NOT NULL));

-- Practice scoping at the DB layer, fail-closed and FORCEd like every other
-- practice-scoped table.
ALTER TABLE "aobprinter_hosts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "aobprinter_hosts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_isolation ON "aobprinter_hosts";
CREATE POLICY practice_isolation ON "aobprinter_hosts"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

-- THE PLATFORM'S OVERVIEW OF EVERY HOST (decision 10). RLS is FORCEd, so an
-- unscoped read correctly returns nothing; the platform's own cross-practice
-- question is asked through a SECURITY DEFINER function granted to `aob_app`
-- alone (CONVENTIONS.md section 6). COUNTS, VERSIONS, TIMES AND STATUS, plus
-- the practice so a row can open its twin. No agreement id, no print hash, no
-- chain hash, no patient.
DROP FUNCTION IF EXISTS core.aobprinter_hosts_overview();
CREATE FUNCTION core.aobprinter_hosts_overview()
RETURNS TABLE (
  "practiceId"       uuid,
  "practiceName"     text,
  "lastSeenAt"       timestamp,
  "hostSentAt"       timestamp,
  "intervalMs"       integer,
  "printerVersion"   text,
  "chainStatus"      text,
  "regressionKind"   text,
  "localCheckOk"     boolean,
  "openExceptions"   integer,
  "filedUnconfirmed" integer,
  "staleQueued"      integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT
    h."practiceId",
    p."name",
    h."lastSeenAt",
    h."hostSentAt",
    h."intervalMs",
    h."printerVersion",
    h."chainStatus",
    h."regressionKind",
    COALESCE((h."localCheck" ->> 'ok')::boolean, false),
    COALESCE((h."counts" -> 'openExceptions' ->> 'parse')::integer, 0)
      + COALESCE((h."counts" -> 'openExceptions' ->> 'send')::integer, 0)
      + COALESCE((h."counts" -> 'openExceptions' ->> 'received')::integer, 0)
      + COALESCE((h."counts" -> 'openExceptions' ->> 'filing')::integer, 0),
    COALESCE((h."counts" -> 'returns' ->> 'filed')::integer, 0),
    COALESCE((h."counts" ->> 'staleQueued')::integer, 0)
  FROM core.aobprinter_hosts h
  LEFT JOIN core.practices p ON p."id" = h."practiceId"
  ORDER BY h."practiceId", h."lastSeenAt" DESC;
$$;
REVOKE ALL ON FUNCTION core.aobprinter_hosts_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.aobprinter_hosts_overview() TO aob_app;

-- WHICH PRACTICE A HOST BELONGS TO, AND NOTHING ELSE. The operator's
-- re-baseline names a host by its id and carries no practice header -- it is
-- the platform's act on a host, not something done as the practice -- so the
-- practice is found here and every read and write that follows happens inside
-- `withPractice`, scoped like everything else.
DROP FUNCTION IF EXISTS core.aobprinter_host_practice(uuid);
CREATE FUNCTION core.aobprinter_host_practice(p_host_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT h."practiceId" FROM core.aobprinter_hosts h WHERE h."id" = p_host_id;
$$;
REVOKE ALL ON FUNCTION core.aobprinter_host_practice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.aobprinter_host_practice(uuid) TO aob_app;

-- WHICH PRACTICES HAVE A HOST, for the five-minute silence sweep (decision 3).
-- PRACTICE IDS ONLY, the same shape as `post_service_chase_due`; the sweep
-- reads each practice's hosts back through `withPractice`.
DROP FUNCTION IF EXISTS core.aobprinter_host_practices();
CREATE FUNCTION core.aobprinter_host_practices()
RETURNS TABLE ("practiceId" uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT DISTINCT h."practiceId" FROM core.aobprinter_hosts h;
$$;
REVOKE ALL ON FUNCTION core.aobprinter_host_practices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.aobprinter_host_practices() TO aob_app;

-- DOWN (by hand, DEV-LOOP.md):
--   DROP FUNCTION IF EXISTS core.aobprinter_host_practices();
--   DROP FUNCTION IF EXISTS core.aobprinter_host_practice(uuid);
--   DROP FUNCTION IF EXISTS core.aobprinter_hosts_overview();
--   DROP TABLE IF EXISTS "aobprinter_hosts";
