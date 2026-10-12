-- A CHAIN THE PLATFORM NO LONGER COUNTS AS THE PRACTICE'S
-- (PRINTER-HEARTBEAT.md section 3 rule 1 and decision 7, D-2026-10-10-02 and
-- its amendment).
--
-- Re-baselining accepts a chain's CURRENT HEAD. It does not retire the chain:
-- a chain that was re-baselined is still the practice's chain, and a rewrite
-- or reinstall after it is a new chain beside it, which decision 6 says is
-- ALWAYS `chain_replaced`. Before this column the verdict skipped every chain
-- that had ever been re-baselined, so a rewrite after a re-baseline passed as
-- `unverified`.
--
-- RETIRED is the operator's acceptance of a REPLACEMENT. Re-baselining a row
-- whose regression is `chain_replaced` accepts the new chain as the practice's
-- chain, so every OTHER chain for the practice is stamped `retiredAt` /
-- `retiredBy` in the same transaction (and counted in the
-- `aobprinter.chain_rebaselined` vault event). Re-baselining any other kind of
-- regression retires nothing. Rule 1 considers every chain that is not retired.
--
-- TIMESTAMP(3), like every other time on this table (Prisma's `DateTime`), so
-- `retiredAt` compares with `lastSeenAt` without a time-zone conversion.
--
-- Idempotent, written to be applied twice (DEV-LOOP.md). Applied after
-- 20261010010000_aobprinter_hosts, which it does not edit.

ALTER TABLE "aobprinter_hosts"
  ADD COLUMN IF NOT EXISTS "retiredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "retiredBy" TEXT;

-- A RETIREMENT IS RECORDED AGAINST SOMEBODY. Both or neither.
ALTER TABLE "aobprinter_hosts" DROP CONSTRAINT IF EXISTS "aobprinter_hosts_retired_by_whom";
ALTER TABLE "aobprinter_hosts" ADD CONSTRAINT "aobprinter_hosts_retired_by_whom"
  CHECK (("retiredAt" IS NULL) = ("retiredBy" IS NULL));

-- THE PLATFORM'S OVERVIEW leaves out a retired chain -- unless it has reported
-- SINCE it was retired, in which case it is a host still running beside the
-- practice's accepted chain, and the overview must show it (decision 6: both
-- chains reporting is the two-hosts notice). Same shape as before; only the
-- WHERE is new, so `CREATE OR REPLACE` keeps the grant.
CREATE OR REPLACE FUNCTION core.aobprinter_hosts_overview()
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
  WHERE h."retiredAt" IS NULL OR h."lastSeenAt" > h."retiredAt"
  ORDER BY h."practiceId", h."lastSeenAt" DESC;
$$;
REVOKE ALL ON FUNCTION core.aobprinter_hosts_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.aobprinter_hosts_overview() TO aob_app;

-- DOWN (by hand, DEV-LOOP.md):
--   1. Re-apply the CREATE FUNCTION core.aobprinter_hosts_overview() block from
--      20261010010000_aobprinter_hosts/migration.sql (the same function
--      without the WHERE), with its REVOKE and GRANT.
--   2. ALTER TABLE "aobprinter_hosts" DROP CONSTRAINT IF EXISTS "aobprinter_hosts_retired_by_whom";
--   3. ALTER TABLE "aobprinter_hosts" DROP COLUMN IF EXISTS "retiredBy", DROP COLUMN IF EXISTS "retiredAt";
