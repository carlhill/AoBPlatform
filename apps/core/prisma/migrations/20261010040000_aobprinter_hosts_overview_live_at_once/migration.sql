-- THE OVERVIEW SAYS "TWO AUDIT LOGS AT ONCE" BY THE SAME RULE AS THE ALERT
-- (PRINTER-HEARTBEAT.md section 3, decision 6 as amended, D-2026-10-10-02).
--
-- Two audit logs reporting is two chains KEEPING reporting -- both live at
-- once -- not a new chain appearing while the old one's last beat is still
-- inside the 15-minute window. A reinstall on the same PC (the old chain
-- stops) is `chain_replaced` and no second host. The ALERT already decides
-- this with `bothLiveAtOnce` in `aobprinter-hosts.service.ts`: the OLDER
-- chain (by first beat) has reported since the NEWER one first appeared. The
-- overview counted every row inside the window instead, so a reinstall read
-- as two hosts for up to 15 minutes.
--
-- The function now returns each row's "createdAt" (the time of its first
-- beat), so the service applies that one predicate to the overview as it does
-- to the practice page and the ALERT. A time, nothing else: no chain id, no
-- hash, no patient. Rows and WHERE are unchanged (20261010020000).
--
-- The return type changes, so `CREATE OR REPLACE` cannot be used ("cannot
-- change return type of existing function"): DROP, then CREATE, which loses
-- the grant, so REVOKE and GRANT follow. Idempotent, written to be applied
-- twice (DEV-LOOP.md). Applied after 20261010020000_aobprinter_hosts_retired,
-- which it does not edit.

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
  "staleQueued"      integer,
  "createdAt"        timestamp
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
    COALESCE((h."counts" ->> 'staleQueued')::integer, 0),
    h."createdAt"
  FROM core.aobprinter_hosts h
  LEFT JOIN core.practices p ON p."id" = h."practiceId"
  WHERE h."retiredAt" IS NULL OR h."lastSeenAt" > h."retiredAt"
  ORDER BY h."practiceId", h."lastSeenAt" DESC;
$$;
REVOKE ALL ON FUNCTION core.aobprinter_hosts_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.aobprinter_hosts_overview() TO aob_app;

-- DOWN (by hand, DEV-LOOP.md): the core service of the previous commit reads
-- the function without "createdAt", so roll the code back with it.
--   1. DROP FUNCTION IF EXISTS core.aobprinter_hosts_overview();
--   2. Re-apply the CREATE OR REPLACE FUNCTION core.aobprinter_hosts_overview()
--      block from 20261010020000_aobprinter_hosts_retired/migration.sql (the
--      same function without "createdAt"), with its REVOKE and GRANT.
