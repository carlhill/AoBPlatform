-- TABLET HEARTBEAT, "RETURN TO BEGIN", AND OUT OF USE (Carl, 4-5 Sep 2026;
-- TODO.md "Tablet heartbeat and Return to Begin", "Tablets: make one
-- inactive").
--
-- WHAT THIS ADDS AND WHY IT IS ALL ON `devices`. A tablet already tells the
-- server it is alive; it has never told the server WHERE it is, so a walk-up
-- half-way through verifying was invisible from the console and a tablet on
-- Begin looked exactly like one that was switched off. These columns are the
-- device's own current state, so they belong on the device's own row.
--
-- NO PATIENT DATA IN ANY OF THEM. `currentScreen` is one of a fixed list of
-- ten screen NAMES (packages/domain `KIOSK_SCREENS`), validated by the DTO;
-- `currentSessionId` is the opaque pushed-session id and no name goes with it
-- (REQ-VER-04, hard rule 9). There is no heartbeat history table: a heartbeat
-- is telemetry, not evidence, and the acts that ARE evidence
-- (`tablet.return_to_begin_requested`, `device.taken_out_of_use`) go to the
-- vault through the outbox like everything else (hard rule 11).
--
-- IDEMPOTENT (DEV-LOOP.md): a migration that only works once passes in
-- development and then breaks `prisma migrate deploy` on the next start.
--
-- REVERSIBLE: every column is nullable and additive, with no default, no
-- constraint and no index, so the reversal is the four statements at the foot
-- of this file and it loses only telemetry. Nothing evidentiary lives here.

ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "currentScreen" TEXT;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "currentSessionId" UUID;

ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "outOfUseAt" TIMESTAMP(3);
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "outOfUseBy" TEXT;

ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "pendingCommandId" UUID;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "pendingCommandKind" TEXT;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "pendingCommandIssuedAt" TIMESTAMP(3);
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "pendingCommandIssuedBy" TEXT;

-- Reverse (by hand, deliberately — this project does not run down-migrations
-- automatically, and a reversal that runs itself on a bad deploy is how a
-- column full of live state disappears):
--
--   ALTER TABLE "devices"
--     DROP COLUMN IF EXISTS "currentScreen",
--     DROP COLUMN IF EXISTS "currentSessionId",
--     DROP COLUMN IF EXISTS "outOfUseAt",
--     DROP COLUMN IF EXISTS "outOfUseBy",
--     DROP COLUMN IF EXISTS "pendingCommandId",
--     DROP COLUMN IF EXISTS "pendingCommandKind",
--     DROP COLUMN IF EXISTS "pendingCommandIssuedAt",
--     DROP COLUMN IF EXISTS "pendingCommandIssuedBy";
