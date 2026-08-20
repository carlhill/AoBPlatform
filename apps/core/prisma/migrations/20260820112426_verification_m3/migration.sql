-- CreateTable
CREATE TABLE "verification_challenges" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "identifierTypes" TEXT[],
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "passedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_events" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "challengeId" UUID NOT NULL,
    "identifierTypes" TEXT[],
    "outcome" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "verifiedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_challenges_practiceId_idx" ON "verification_challenges"("practiceId");

-- CreateIndex
CREATE INDEX "verification_challenges_patientId_idx" ON "verification_challenges"("patientId");

-- CreateIndex
CREATE INDEX "verification_events_practiceId_idx" ON "verification_events"("practiceId");

-- RLS: same fail-closed practice scoping as every practice-scoped table.
ALTER TABLE "verification_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_challenges" FORCE ROW LEVEL SECURITY;
ALTER TABLE "verification_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON "verification_challenges"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

CREATE POLICY practice_isolation ON "verification_events"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

-- Verification events are evidence: append-only. No UPDATE, no DELETE.
CREATE FUNCTION prevent_verification_event_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'verification events are append-only evidence (REQ-VER-04)';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER verification_events_append_only
  BEFORE UPDATE OR DELETE ON "verification_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_verification_event_change();
