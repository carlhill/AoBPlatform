-- AlterTable
ALTER TABLE "agreements" ADD COLUMN     "affiliationId" UUID;

-- AlterTable
ALTER TABLE "enrolment_ceremonies" ADD COLUMN     "practitionerId" UUID;

-- AlterTable
ALTER TABLE "practice_locations" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "addressCanonical" TEXT,
ADD COLUMN     "addressValidated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "gnafPid" TEXT,
ADD COLUMN     "gnafVersion" TEXT,
ADD COLUMN     "state" TEXT;

-- AlterTable
ALTER TABLE "practices" ADD COLUMN     "abnStatus" TEXT,
ADD COLUMN     "abnVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "acn" TEXT,
ADD COLUMN     "bbpipParticipant" BOOLEAN,
ADD COLUMN     "entityType" TEXT,
ADD COLUMN     "gstRegistered" BOOLEAN,
ADD COLUMN     "hpiO" TEXT,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "myMedicareRegistered" BOOLEAN,
ADD COLUMN     "nameMatchTier" TEXT,
ADD COLUMN     "nameMatchedOn" TEXT,
ADD COLUMN     "tradingNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "validatedAt" TIMESTAMP(3),
ADD COLUMN     "validatedByName" TEXT,
ADD COLUMN     "validationNote" TEXT,
ADD COLUMN     "validationState" TEXT NOT NULL DEFAULT 'pending';

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practitioners" (
    "id" UUID NOT NULL,
    "ahpraNumber" TEXT NOT NULL,
    "familyName" TEXT NOT NULL,
    "givenNames" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "email" TEXT,
    "keycloakUserId" TEXT,
    "invitedAt" TIMESTAMP(3),
    "passkeyEnrolledAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "deregisteredAt" TIMESTAMP(3),
    "deregisteredReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practitioners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliations" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "practitionerId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "departmentId" UUID,
    "providerNumber" TEXT,
    "pmsLinkageKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitedByName" TEXT,
    "startedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "noticeGivenAt" TIMESTAMP(3),
    "noticeGivenBy" TEXT,
    "endsAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "departments_practiceId_idx" ON "departments"("practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "departments_locationId_name_key" ON "departments"("locationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "practitioners_ahpraNumber_key" ON "practitioners"("ahpraNumber");

-- CreateIndex
CREATE INDEX "affiliations_practiceId_idx" ON "affiliations"("practiceId");

-- CreateIndex
CREATE INDEX "affiliations_practitionerId_idx" ON "affiliations"("practitionerId");

-- CreateIndex
CREATE INDEX "affiliations_status_idx" ON "affiliations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "affiliations_practitionerId_locationId_key" ON "affiliations"("practitionerId", "locationId");

-- CreateIndex
CREATE INDEX "agreements_affiliationId_idx" ON "agreements"("affiliationId");

-- CreateIndex
CREATE INDEX "enrolment_ceremonies_practitionerId_idx" ON "enrolment_ceremonies"("practitionerId");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "practice_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "practitioners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "practice_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliations" ADD CONSTRAINT "affiliations_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_affiliationId_fkey" FOREIGN KEY ("affiliationId") REFERENCES "affiliations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===========================================================================
-- HAND-AUTHORED HALF. Everything above this line is `prisma migrate diff`
-- output; everything below is the enforcement that Prisma cannot express.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Row-level security for the practice-scoped new tables.
-- ---------------------------------------------------------------------------

ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "departments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "affiliations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "affiliations" FORCE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON "departments"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

CREATE POLICY practice_isolation ON "affiliations"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- `practitioners` IS DELIBERATELY NOT ROW-LEVEL SCOPED.
--
-- This is the third documented exception, after `vault_outbox` (a system job
-- that spans practices) and the rules service (zero PII). It is not an
-- oversight, and it needs justifying because RLS is the fail-closed backstop
-- everywhere else.
--
-- WHY IT CANNOT BE SCOPED: a practitioner is ONE HUMAN across the platform.
-- That is the entire point of splitting them out of `providers`, where a
-- doctor at three practices is three unrelated rows — a shape that makes it
-- impossible to enforce a deregistration hard-stop across all three
-- (REQ-XFER-08), to detect anomalous affiliation velocity (REQ-ANOM-01), or
-- to show a practitioner what has been signed in their name. Scoping the
-- table to one practice would reinstate exactly the limitation being removed.
--
-- WHAT THAT DOES *NOT* EXPOSE, by construction:
--   * No provider number. Provider numbers live on `affiliations`, which IS
--     scoped. So "which practices does Dr X work at, and under what number"
--     remains unreadable across a tenant boundary — that was the asset worth
--     protecting (Addendum v5 PART C).
--   * No patient data, no agreements, no evidence. Nothing joins from here.
--
-- WHAT IT DOES EXPOSE to a compromised or buggy query: name, AHPRA number,
-- profession and verification state — which AHPRA itself publishes on a
-- public register — plus the practitioner's email address. The email is the
-- one genuinely non-public field, and it is why the code-side projection is
-- mandatory rather than advisory.
--
-- THE BOUNDARY IS THEREFORE ENFORCED IN CODE: a practitioner crosses a
-- practice boundary only through toDirectoryEntry()
-- (packages/domain/src/directory.ts), which is built field-by-field so a
-- column added later cannot ride along on a spread, and which carries no
-- email at all. assertNoProviderNumber() guards the serialisation.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Offboarding: notice runs BEFORE the end date.
--
-- Under reg 65CA(8) an enduring agreement ceases when the practitioner leaves
-- the nominated practice location — on that event, not some days after it. An
-- end date earlier than the notice would mean the practitioner had already
-- gone, and agreements had already ceased, while the platform kept processing
-- against consent that no longer existed. Backdating the notice does not
-- un-cease them, so the database refuses the shape outright.
-- ---------------------------------------------------------------------------

ALTER TABLE "affiliations" ADD CONSTRAINT affiliations_notice_precedes_end
  CHECK ("noticeGivenAt" IS NULL OR "endsAt" IS NULL OR "endsAt" >= "noticeGivenAt");

ALTER TABLE "affiliations" ADD CONSTRAINT affiliations_status_known
  CHECK ("status" IN ('invited','active','ending','ended','rejected'));

-- An affiliation cannot be active without having been accepted BY THE
-- PRACTITIONER: a practice must not be able to self-accept on their behalf.
ALTER TABLE "affiliations" ADD CONSTRAINT affiliations_active_requires_acceptance
  CHECK ("status" NOT IN ('active','ending') OR "startedAt" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Terminal states are terminal. `ended` and `rejected` do not reopen — a
-- practitioner who returns to a practice gets a NEW affiliation, and
-- therefore new agreements, which is the same rule as REQ-XFER-01.
-- ---------------------------------------------------------------------------

CREATE FUNCTION prevent_affiliation_resurrection() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('ended','rejected') AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION
      'FR-1.8: affiliation % is %, which is terminal. A practitioner returning to a practice gets a NEW '
      'affiliation and new agreements — reopening this one would silently revive agreements that ceased '
      'under reg 65CA(8).', OLD."id", OLD."status";
  END IF;
  -- The practitioner and the location are the identity of an affiliation. If
  -- either could move, the provider number would silently start describing a
  -- different person or a different place, and every agreement anchored here
  -- would be quietly wrong.
  IF NEW."practitionerId" IS DISTINCT FROM OLD."practitionerId"
  OR NEW."locationId"     IS DISTINCT FROM OLD."locationId"
  OR NEW."practiceId"     IS DISTINCT FROM OLD."practiceId" THEN
    RAISE EXCEPTION 'FR-1.8: the practitioner, location and practice of an affiliation are immutable.';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER affiliations_terminal_and_identity_immutable
  BEFORE UPDATE ON "affiliations"
  FOR EACH ROW EXECUTE FUNCTION prevent_affiliation_resurrection();

-- ---------------------------------------------------------------------------
-- A practitioner's AHPRA number is their identity here. It does not change:
-- a different number is a different person, and rewriting it in place would
-- re-attribute every agreement they have ever signed.
-- ---------------------------------------------------------------------------

CREATE FUNCTION prevent_practitioner_identity_change() RETURNS trigger AS $$
BEGIN
  IF NEW."ahpraNumber" IS DISTINCT FROM OLD."ahpraNumber" THEN
    RAISE EXCEPTION
      'REQ-XFER-01: a practitioner AHPRA number is immutable. A different number is a different person, and '
      'changing it would re-attribute every agreement already signed in this practitioner name.';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER practitioners_identity_immutable
  BEFORE UPDATE ON "practitioners"
  FOR EACH ROW EXECUTE FUNCTION prevent_practitioner_identity_change();

-- ---------------------------------------------------------------------------
-- HARD-01 extended to the new anchor. `affiliationId` joins anchorKind,
-- providerId, organisationId, patientId, practiceId and type as immutable:
-- terminate and recreate is the only way to change who an agreement binds.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_agreement_anchor_change() RETURNS trigger AS $$
BEGIN
  IF NEW."anchorKind"      IS DISTINCT FROM OLD."anchorKind"
  OR NEW."providerId"      IS DISTINCT FROM OLD."providerId"
  OR NEW."affiliationId"   IS DISTINCT FROM OLD."affiliationId"
  OR NEW."organisationId"  IS DISTINCT FROM OLD."organisationId"
  OR NEW."patientId"       IS DISTINCT FROM OLD."patientId"
  OR NEW."practiceId"      IS DISTINCT FROM OLD."practiceId"
  OR NEW."type"            IS DISTINCT FROM OLD."type" THEN
    RAISE EXCEPTION 'HARD-01: agreement anchor/identity fields are immutable — terminate and recreate';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- A practitioner's own view of their affiliations, across every practice.
--
-- SECURITY DEFINER because this is the one legitimate cross-tenant read: a
-- practitioner accepting an invitation from practice B must be able to see it
-- while scoped to nothing, and a practitioner is entitled to know where they
-- are affiliated. Note the projection: NO providerNumber column is returned,
-- so this cannot be used to harvest numbers even by the practitioner's own
-- session, and no patient or agreement data joins in.
-- ---------------------------------------------------------------------------

CREATE FUNCTION list_practitioner_affiliations(p_practitioner_id uuid)
RETURNS TABLE (
  id uuid,
  "practiceId" uuid,
  "practiceName" text,
  "locationId" uuid,
  "locationAddress" text,
  status text,
  "invitedAt" timestamp(3),
  "startedAt" timestamp(3),
  "noticeGivenAt" timestamp(3),
  "endsAt" timestamp(3)
) AS $$
  SELECT a."id", a."practiceId", p."name", a."locationId",
         COALESCE(l."addressCanonical", l."address"),
         a."status", a."invitedAt", a."startedAt", a."noticeGivenAt", a."endsAt"
  FROM "affiliations" a
  JOIN "practices" p ON p."id" = a."practiceId"
  JOIN "practice_locations" l ON l."id" = a."locationId"
  WHERE a."practitionerId" = p_practitioner_id
  ORDER BY a."invitedAt" DESC;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION list_practitioner_affiliations(uuid) TO aob_app;
