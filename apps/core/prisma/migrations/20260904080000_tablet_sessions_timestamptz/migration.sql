-- EVERY TIMESTAMP ON `tablet_sessions` BECOMES TIMESTAMPTZ (Carl, 4 Sep
-- 2026), not just the three dispute columns.
--
-- `timestamp without time zone` stores a wall-clock reading with no zone
-- attached; every value already in these columns was written by Prisma as a
-- UTC instant and then had its zone silently dropped on the way in. Reading
-- one back and asking "is this still open" or "how long has this device been
-- idle" is comparing a naive value to `now()` with no zone information to
-- anchor it, which is the class of bug that is invisible in Sydney and wrong
-- everywhere daylight saving does not track the server.
--
-- THE CONVERSION IS `... AT TIME ZONE 'UTC'`, both ways. That reinterprets a
-- naive value as a UTC instant and attaches the zone rather than shifting the
-- clock, which is the correct move because every existing value already IS a
-- UTC instant with its zone stripped. `... AT TIME ZONE 'UTC'` (the same
-- expression, run again) does the reverse: strip the zone back off a
-- timestamptz, leaving the same instant read as naive UTC. Down and up are
-- the same USING clause because the conversion is an involution.
--
-- ALL SIX TIMESTAMP COLUMNS, enumerated from `\d core.tablet_sessions`
-- rather than guessed: `detailsConfirmedAt`, `pushedAt`, `lastStateAt`,
-- `endedAt`, `detailsDisputedAt`, `disputeResolvedAt`. There is no
-- `expiresAt`, `createdAt` or `updatedAt` column on this table — the model
-- has never carried them.
--
-- Written to be applied twice (DEV-LOOP.md): each column's current type is
-- checked in `information_schema` first, so a second run is a no-op.

DO $$
BEGIN
  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'core' AND table_name = 'tablet_sessions' AND column_name = 'detailsConfirmedAt'
  ) = 'timestamp without time zone' THEN
    ALTER TABLE "tablet_sessions"
      ALTER COLUMN "detailsConfirmedAt" TYPE TIMESTAMPTZ(3) USING "detailsConfirmedAt" AT TIME ZONE 'UTC';
  END IF;

  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'core' AND table_name = 'tablet_sessions' AND column_name = 'pushedAt'
  ) = 'timestamp without time zone' THEN
    ALTER TABLE "tablet_sessions"
      ALTER COLUMN "pushedAt" TYPE TIMESTAMPTZ(3) USING "pushedAt" AT TIME ZONE 'UTC';
  END IF;

  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'core' AND table_name = 'tablet_sessions' AND column_name = 'lastStateAt'
  ) = 'timestamp without time zone' THEN
    ALTER TABLE "tablet_sessions"
      ALTER COLUMN "lastStateAt" TYPE TIMESTAMPTZ(3) USING "lastStateAt" AT TIME ZONE 'UTC';
  END IF;

  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'core' AND table_name = 'tablet_sessions' AND column_name = 'endedAt'
  ) = 'timestamp without time zone' THEN
    ALTER TABLE "tablet_sessions"
      ALTER COLUMN "endedAt" TYPE TIMESTAMPTZ(3) USING "endedAt" AT TIME ZONE 'UTC';
  END IF;

  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'core' AND table_name = 'tablet_sessions' AND column_name = 'detailsDisputedAt'
  ) = 'timestamp without time zone' THEN
    ALTER TABLE "tablet_sessions"
      ALTER COLUMN "detailsDisputedAt" TYPE TIMESTAMPTZ(3) USING "detailsDisputedAt" AT TIME ZONE 'UTC';
  END IF;

  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'core' AND table_name = 'tablet_sessions' AND column_name = 'disputeResolvedAt'
  ) = 'timestamp without time zone' THEN
    ALTER TABLE "tablet_sessions"
      ALTER COLUMN "disputeResolvedAt" TYPE TIMESTAMPTZ(3) USING "disputeResolvedAt" AT TIME ZONE 'UTC';
  END IF;
END
$$;
