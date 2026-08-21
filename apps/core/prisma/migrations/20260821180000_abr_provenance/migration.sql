-- AlterTable
ALTER TABLE "practices" ADD COLUMN     "abnSightedByName" TEXT,
ADD COLUMN     "abnVerificationSource" TEXT;


-- ---------------------------------------------------------------------------
-- The ABR's JSON API requires a registered GUID. Where an environment has
-- none, the platform must not simply refuse to onboard anybody — but it must
-- also never PRETEND the register was consulted when it was not.
--
-- So the second path is the one this codebase already uses three times over
-- (the enrolment ceremony, address validation, and the organisation queue
-- itself): a NAMED HUMAN looks the ABN up on abr.business.gov.au, types in
-- what they saw, and the record says it was them.
--
-- `abnVerificationSource` is what keeps that honest. A reviewer approving a
-- practice can see whether the ABR answered or whether a colleague retyped
-- it, and weigh it accordingly. Collapsing the two into a single "verified"
-- flag would be the lie.
-- ---------------------------------------------------------------------------

ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS practices_abn_verification_source_known;
ALTER TABLE "practices" ADD CONSTRAINT practices_abn_verification_source_known
  CHECK ("abnVerificationSource" IS NULL OR "abnVerificationSource" IN ('abr_api','manual_attestation'));

-- A manual attestation without a name is not an attestation.
ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS practices_manual_attestation_is_named;
ALTER TABLE "practices" ADD CONSTRAINT practices_manual_attestation_is_named
  CHECK ("abnVerificationSource" <> 'manual_attestation' OR COALESCE(btrim("abnSightedByName"), '') <> '');

-- Existing rows came through the fixture client, which stands in for the API.
UPDATE "practices" SET "abnVerificationSource" = 'abr_api' WHERE "abnVerifiedAt" IS NOT NULL;
