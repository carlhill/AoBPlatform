-- Teach the notice constraint about attested external notice.
--
-- `affiliations_notice_precedes_end` enforced `endsAt >= noticeGivenAt` in the
-- database, which is exactly the right place for it: the domain rule and the
-- API can both be bypassed by a script, and this could not.
--
-- But it encoded the OLD rule, which merged two questions:
--
--   1. When did the agreements cease?  -> the departure date, always
--   2. Was notice given, and by whom?  -> sometimes outside AoBPlatform
--
-- A practitioner who left on the 19th, recorded on the 22nd, having been told
-- months earlier in their employment agreement, is a legitimate record. The
-- old constraint refused it — so the platform went on showing them as ACTIVE
-- at a location they had left, which is a worse falsehood than the one the
-- constraint was guarding against.
--
-- The guarantee is UNCHANGED for the ordinary path: you still cannot record a
-- past departure as though we had given notice. What is now permitted is
-- recording one where somebody has attested, on the record and under their own
-- name, that notice came from somewhere else. `externalNoticeMeans` is only
-- ever set by that attestation, so it cannot be reached by accident.

ALTER TABLE "affiliations" DROP CONSTRAINT IF EXISTS affiliations_notice_precedes_end;

ALTER TABLE "affiliations" ADD CONSTRAINT affiliations_notice_precedes_end
  CHECK (
    "noticeGivenAt" IS NULL
    OR "endsAt" IS NULL
    OR "endsAt" >= "noticeGivenAt"
    -- The attested path. Notice was given elsewhere, and the record says so.
    OR "externalNoticeMeans" IS NOT NULL
  );

-- An attestation without its date would be an assertion with nothing to check.
ALTER TABLE "affiliations" ADD CONSTRAINT affiliations_external_notice_complete
  CHECK (
    "externalNoticeMeans" IS NULL
    OR "externalNoticeGivenAt" IS NOT NULL
  );
