-- CreateTable
CREATE TABLE "capture_requests" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "verificationChallengeId" UUID,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capture_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "capture_requests_tokenHash_key" ON "capture_requests"("tokenHash");

-- CreateIndex
CREATE INDEX "capture_requests_practiceId_idx" ON "capture_requests"("practiceId");

-- CreateIndex
CREATE INDEX "capture_requests_agreementId_idx" ON "capture_requests"("agreementId");

ALTER TABLE "capture_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "capture_requests" FORCE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON "capture_requests"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);
