-- AlterTable
ALTER TABLE "agreements" ADD COLUMN     "pmsDocumentKey" TEXT,
ADD COLUMN     "writtenBackAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "pmsLinkageKey" TEXT;

-- CreateTable
CREATE TABLE "service_records" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "pmsInvoiceKey" TEXT NOT NULL,
    "patientId" UUID,
    "providerId" UUID,
    "serviceDate" DATE NOT NULL,
    "mbsItemNumbers" TEXT[],
    "agreementId" UUID,
    "retentionClockSource" TEXT NOT NULL DEFAULT 'conservative_default',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_records_practiceId_idx" ON "service_records"("practiceId");

-- CreateIndex
CREATE INDEX "service_records_serviceDate_idx" ON "service_records"("serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "service_records_practiceId_pmsInvoiceKey_key" ON "service_records"("practiceId", "pmsInvoiceKey");

ALTER TABLE "service_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_records" FORCE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON "service_records"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);
