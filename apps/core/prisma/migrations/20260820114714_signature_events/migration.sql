-- CreateTable
CREATE TABLE "signature_events" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "captureRequestId" UUID,
    "method" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "artefactHash" TEXT NOT NULL,
    "rendererVersion" TEXT NOT NULL,
    "ruleSetVersion" TEXT,
    "mappingVersion" TEXT,
    "verificationEventId" UUID,
    "deviceFingerprint" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signature_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signature_events_practiceId_idx" ON "signature_events"("practiceId");

-- CreateIndex
CREATE INDEX "signature_events_agreementId_idx" ON "signature_events"("agreementId");

ALTER TABLE "signature_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "signature_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON "signature_events"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

-- Signature events are evidence: append-only, like verification events.
CREATE FUNCTION prevent_signature_event_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'signature events are append-only evidence (REQ-SIG-02)';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER signature_events_append_only
  BEFORE UPDATE OR DELETE ON "signature_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_signature_event_change();
