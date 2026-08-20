-- CreateTable
CREATE TABLE "practices" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "abn" TEXT,
    "pms" TEXT NOT NULL DEFAULT 'medtech_evolution',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "placeOfPracticeAddress" TEXT,
    "providerNumber" TEXT,
    "ahpraNumber" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "familyName" TEXT NOT NULL,
    "givenNames" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "genderAsIdentified" TEXT,
    "address" TEXT,
    "patientRecordNumber" TEXT,
    "ihi" TEXT,
    "preferredLanguage" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "confidentialityFlag" BOOLEAN NOT NULL DEFAULT false,
    "myMedicareRegistered" BOOLEAN,
    "pmsLinkageKey" TEXT,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignors" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "relationshipToPatient" TEXT,
    "authorityBasis" TEXT NOT NULL,
    "authorityNote" TEXT,
    "contactMobile" TEXT,
    "contactEmail" TEXT,
    "preferredLanguage" TEXT,

    CONSTRAINT "assignors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreements" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "anchorKind" TEXT NOT NULL,
    "providerId" UUID,
    "organisationId" UUID,
    "patientId" UUID NOT NULL,
    "assignorId" UUID NOT NULL,
    "assignorIsPatient" BOOLEAN NOT NULL,
    "enduringPathway" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "particulars" JSONB,
    "particularsLockedAt" TIMESTAMP(3),
    "ruleSetVersion" TEXT,
    "mappingVersion" TEXT,
    "renderedLanguages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "renderedArtefactHash" TEXT,
    "verificationEventId" UUID,
    "signatureEventId" UUID,
    "supersedesAgreementId" UUID,
    "retentionExpiryDate" DATE,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_outbox" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actor" JSONB NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),

    CONSTRAINT "vault_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "providers_practiceId_idx" ON "providers"("practiceId");

-- CreateIndex
CREATE INDEX "patients_practiceId_idx" ON "patients"("practiceId");

-- CreateIndex
CREATE INDEX "assignors_practiceId_idx" ON "assignors"("practiceId");

-- CreateIndex
CREATE INDEX "agreements_practiceId_idx" ON "agreements"("practiceId");

-- CreateIndex
CREATE INDEX "agreements_patientId_idx" ON "agreements"("patientId");

-- CreateIndex
CREATE INDEX "agreements_status_idx" ON "agreements"("status");

-- CreateIndex
CREATE INDEX "vault_outbox_publishedAt_nextAttemptAt_idx" ON "vault_outbox"("publishedAt", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "providers" ADD CONSTRAINT "providers_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignors" ADD CONSTRAINT "assignors_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_assignorId_fkey" FOREIGN KEY ("assignorId") REFERENCES "assignors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
