-- Reverse of `migration.sql`: all six timestamps on `tablet_sessions` back to
-- `timestamp(3) without time zone`. `... AT TIME ZONE 'UTC'` on a
-- timestamptz strips the zone and leaves the same instant read as naive UTC
-- -- the same expression as the up migration, because the conversion is an
-- involution.
--
-- Written to be applied twice: each column's current type is checked first,
-- so a second run is a no-op.

DO $$
BEGIN
  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'core' AND table_name = 'tablet_sessions' AND column_name = 'detailsConfirmedAt'
  ) = 'timestamp with time zone' THEN
    ALTER TABLE "tablet_sessions"
      ALTER COLUMN "detailsConfirmedAt" TYPE TIMESTAMP(3) USING "detailsConfirmedAt" AT TIME ZONE 'UTC';
  END IF;

  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'core' AND table_name = 'tablet_sessions' AND column_name = 'pushedAt'
  ) = 'timestamp with time zone' THEN
    ALTER TABLE "tablet_sessions"
      ALTER COLUMN "pushedAt" TYPE TIMESTAMP(3) USING "pushedAt" AT TIME ZONE 'UTC';
  END IF;

  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'core' AND table_name = 'tablet_sessions' AND column_name = 'lastStateAt'
  ) = 'timestamp with time zone' THEN
    ALTER TABLE "tablet_sessions"
      ALTER COLUMN "lastStateAt" TYPE TIMESTAMP(3) USING "lastStateAt" AT TIME ZONE 'UTC';
  END IF;

  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'core' AND table_name = 'tablet_sessions' AND column_name = 'endedAt'
  ) = 'timestamp with time zone' THEN
    ALTER TABLE "tablet_sessions"
      ALTER COLUMN "endedAt" TYPE TIMESTAMP(3) USING "endedAt" AT TIME ZONE 'UTC';
  END IF;

  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'core' AND table_name = 'tablet_sessions' AND column_name = 'detailsDisputedAt'
  ) = 'timestamp with time zone' THEN
    ALTER TABLE "tablet_sessions"
      ALTER COLUMN "detailsDisputedAt" TYPE TIMESTAMP(3) USING "detailsDisputedAt" AT TIME ZONE 'UTC';
  END IF;

  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'core' AND table_name = 'tablet_sessions' AND column_name = 'disputeResolvedAt'
  ) = 'timestamp with time zone' THEN
    ALTER TABLE "tablet_sessions"
      ALTER COLUMN "disputeResolvedAt" TYPE TIMESTAMP(3) USING "disputeResolvedAt" AT TIME ZONE 'UTC';
  END IF;
END
$$;
