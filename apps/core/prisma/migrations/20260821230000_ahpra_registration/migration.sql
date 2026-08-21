-- AlterTable
ALTER TABLE "practitioners" ADD COLUMN     "conditions" TEXT,
ADD COLUMN     "dateOfFirstRegistration" DATE,
ADD COLUMN     "division" TEXT,
ADD COLUMN     "principalCountry" TEXT,
ADD COLUMN     "principalPostcode" TEXT,
ADD COLUMN     "principalState" TEXT,
ADD COLUMN     "principalSuburb" TEXT,
ADD COLUMN     "profession" TEXT,
ADD COLUMN     "registrationSightedAt" TIMESTAMP(3),
ADD COLUMN     "registrationSightedByName" TEXT,
ADD COLUMN     "registrationSource" TEXT,
ADD COLUMN     "registrationStatus" TEXT,
ADD COLUMN     "reprimands" TEXT,
ADD COLUMN     "undertakings" TEXT;

-- CreateTable
CREATE TABLE "practitioner_registrations" (
    "id" UUID NOT NULL,
    "practitionerId" UUID NOT NULL,
    "registrationType" TEXT NOT NULL,
    "specialty" TEXT,
    "expiryDate" DATE,
    "conditions" TEXT,
    "endorsements" TEXT,
    "notations" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practitioner_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practitioner_registrations_practitionerId_idx" ON "practitioner_registrations"("practitionerId");

-- AddForeignKey
ALTER TABLE "practitioner_registrations" ADD CONSTRAINT "practitioner_registrations_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "practitioners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- HAND-AUTHORED HALF.
-- ===========================================================================

-- `practitioner_registrations` inherits the practitioner's RLS exception: a
-- practitioner is ONE HUMAN across the platform, so neither table can be
-- scoped to a single tenant without reinstating the limitation the split
-- exists to remove. As with `practitioners`, nothing here is a provider
-- number, a patient, an agreement or a piece of evidence — this is a copy of
-- what a public register says, plus who read it.

ALTER TABLE "practitioners" DROP CONSTRAINT IF EXISTS practitioners_registration_source_known;
ALTER TABLE "practitioners" ADD CONSTRAINT practitioners_registration_source_known
  CHECK ("registrationSource" IS NULL OR "registrationSource" IN ('ahpra_manual','pie_api'));

-- A manual sighting is a person's word about a public register, so it names
-- them. "Checked" with nobody attached is not a check — the same rule as the
-- ABR attestation, for the same reason.
ALTER TABLE "practitioners" DROP CONSTRAINT IF EXISTS practitioners_manual_sighting_is_named;
ALTER TABLE "practitioners" ADD CONSTRAINT practitioners_manual_sighting_is_named
  CHECK ("registrationSource" IS DISTINCT FROM 'ahpra_manual'
      OR COALESCE(btrim("registrationSightedByName"), '') <> '');

-- Recording a status without recording where it came from would make the
-- register's word indistinguishable from a guess.
ALTER TABLE "practitioners" DROP CONSTRAINT IF EXISTS practitioners_status_has_a_source;
ALTER TABLE "practitioners" ADD CONSTRAINT practitioners_status_has_a_source
  CHECK ("registrationStatus" IS NULL OR "registrationSource" IS NOT NULL);

-- NOTE WHAT IS DELIBERATELY ABSENT: no constraint forbids an expiry date in
-- the past, and none ever should. AHPRA states that a past expiry may mean a
-- renewal is still being finalised, or the one-month late period, and that the
-- practitioner "is still able to practise". A NOT NULL or future-dated
-- constraint here would lock legitimately-practising doctors out of consent
-- capture every renewal season. It is surfaced as a warning in the domain
-- layer instead (packages/domain/src/ahpra.ts).

-- One row per registration type per practitioner. A practitioner holding both
-- General and Specialist is normal; holding "General" twice is a data error.
CREATE UNIQUE INDEX IF NOT EXISTS practitioner_registrations_unique_type
  ON "practitioner_registrations" ("practitionerId", "registrationType", COALESCE("specialty", ''));

-- A registration row that names no type describes nothing.
ALTER TABLE "practitioner_registrations" DROP CONSTRAINT IF EXISTS practitioner_registrations_type_present;
ALTER TABLE "practitioner_registrations" ADD CONSTRAINT practitioner_registrations_type_present
  CHECK (COALESCE(btrim("registrationType"), '') <> '');

GRANT SELECT, INSERT, UPDATE, DELETE ON "practitioner_registrations" TO aob_app;
