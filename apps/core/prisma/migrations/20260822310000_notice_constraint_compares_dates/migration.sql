-- The notice constraint compared INSTANTS. The rule is about DAYS.
--
-- A practitioner's last day is a date. The screen sends a date input, which
-- arrives as midnight UTC. `noticeGivenAt` is `now()`, which is whatever time
-- of day it happens to be. So recording "their last day is the 22nd" at 3:32pm
-- on the 22nd produced:
--
--   endsAt        = 2026-08-22 00:00
--   noticeGivenAt = 2026-08-22 15:32
--   endsAt >= noticeGivenAt  ->  FALSE
--
-- ...and a 500, for a record that is perfectly ordinary. Somebody leaving today
-- and being recorded today is not backdating; it is Tuesday.
--
-- The domain has always compared at date granularity (`atMidnightUtc`, and
-- `needsExternalAttestation` deliberately answers false for the same day). The
-- constraint did not, so the two disagreed about the one case that happens
-- most often -- and the constraint won, at runtime, as a 500 rather than a
-- refusal anybody could read.
--
-- Comparing dates on both sides makes the database agree with the rule it is
-- there to back up.

ALTER TABLE "affiliations" DROP CONSTRAINT IF EXISTS affiliations_notice_precedes_end;

ALTER TABLE "affiliations" ADD CONSTRAINT affiliations_notice_precedes_end
  CHECK (
    "noticeGivenAt" IS NULL
    OR "endsAt" IS NULL
    -- Same day is fine. It is the DAY that must not be in the past.
    OR date_trunc('day', "endsAt") >= date_trunc('day', "noticeGivenAt")
    -- Or notice was given outside AoBPlatform, and the record says so.
    OR "externalNoticeMeans" IS NOT NULL
  );
