-- CreateTable
CREATE TABLE "enrolment_ceremonies" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "providerId" UUID,
    "staffId" UUID,
    "ahpraNumber" TEXT NOT NULL,
    "ahpraRegistrationCurrent" BOOLEAN NOT NULL,
    "providerNumber" TEXT NOT NULL,
    "providerNumberLocation" TEXT NOT NULL,
    "providerNumberVerified" BOOLEAN NOT NULL,
    "personVerificationMethod" TEXT NOT NULL,
    "verifiedByName" TEXT NOT NULL,
    "verifiedByStaffId" UUID,
    "evidenceNote" TEXT,
    "steppedUp" BOOLEAN NOT NULL DEFAULT false,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrolment_ceremonies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enrolment_ceremonies_practiceId_idx" ON "enrolment_ceremonies"("practiceId");

-- CreateIndex
CREATE INDEX "enrolment_ceremonies_providerId_idx" ON "enrolment_ceremonies"("providerId");

-- CreateIndex
CREATE INDEX "enrolment_ceremonies_staffId_idx" ON "enrolment_ceremonies"("staffId");

ALTER TABLE "enrolment_ceremonies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enrolment_ceremonies" FORCE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON "enrolment_ceremonies"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

-- REQ-PKI-01: a ceremony is evidence of what a named human attested. Nothing
-- rewrites it; a wrong ceremony is superseded by performing a fresh one. The
-- single exception is stamping consumedAt when it authorises a key binding.
CREATE FUNCTION prevent_ceremony_rewrite() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'REQ-PKI-01: enrolment ceremonies are append-only evidence and cannot be deleted';
  END IF;
  IF NEW."ahpraNumber"              IS DISTINCT FROM OLD."ahpraNumber"
  OR NEW."ahpraRegistrationCurrent" IS DISTINCT FROM OLD."ahpraRegistrationCurrent"
  OR NEW."providerNumber"           IS DISTINCT FROM OLD."providerNumber"
  OR NEW."providerNumberLocation"   IS DISTINCT FROM OLD."providerNumberLocation"
  OR NEW."providerNumberVerified"   IS DISTINCT FROM OLD."providerNumberVerified"
  OR NEW."personVerificationMethod" IS DISTINCT FROM OLD."personVerificationMethod"
  OR NEW."verifiedByName"           IS DISTINCT FROM OLD."verifiedByName"
  OR NEW."verifiedByStaffId"        IS DISTINCT FROM OLD."verifiedByStaffId"
  OR NEW."steppedUp"                IS DISTINCT FROM OLD."steppedUp"
  OR NEW."performedAt"              IS DISTINCT FROM OLD."performedAt"
  OR NEW."providerId"               IS DISTINCT FROM OLD."providerId"
  OR NEW."staffId"                  IS DISTINCT FROM OLD."staffId" THEN
    RAISE EXCEPTION 'REQ-PKI-01: a ceremony records what was attested - perform a fresh ceremony instead';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER enrolment_ceremonies_append_only
  BEFORE UPDATE OR DELETE ON "enrolment_ceremonies"
  FOR EACH ROW EXECUTE FUNCTION prevent_ceremony_rewrite();
