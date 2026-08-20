-- CreateTable
CREATE TABLE "enduring_details" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "notificationMethod" TEXT NOT NULL,
    "notificationAlternate" TEXT,
    "terminationMethod" TEXT NOT NULL,
    "responsiblePersonBasis" TEXT,
    "patientDeclarationAt" TIMESTAMP(3),
    "scopeType" TEXT NOT NULL,
    "scopeValues" TEXT[],
    "enteredIntoAt" TIMESTAMP(3) NOT NULL,
    "registeredAt" TIMESTAMP(3),
    "registrationReference" TEXT,
    "terminationNoticeAt" TIMESTAMP(3),
    "terminationEffectiveAt" TIMESTAMP(3),
    "terminationCalendarState" TEXT,
    "ceasedAt" TIMESTAMP(3),
    "cessationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enduring_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notices" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "serviceRecordId" UUID,
    "claimReference" TEXT NOT NULL,
    "claimLodgedAt" TIMESTAMP(3) NOT NULL,
    "practitionerName" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "benefitAmountCents" INTEGER NOT NULL,
    "agreementMethod" TEXT NOT NULL,
    "dispatchChannel" TEXT,
    "payloadHash" TEXT NOT NULL,
    "composedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "gatewayMessageId" TEXT,
    "supersedesNoticeId" UUID,
    "correctionReason" TEXT,

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notice_delivery_events" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "noticeId" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "channel" TEXT,
    "detail" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notice_delivery_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "enduring_details_agreementId_key" ON "enduring_details"("agreementId");

-- CreateIndex
CREATE INDEX "enduring_details_practiceId_idx" ON "enduring_details"("practiceId");

-- CreateIndex
CREATE INDEX "enduring_details_ceasedAt_idx" ON "enduring_details"("ceasedAt");

-- CreateIndex
CREATE INDEX "notices_practiceId_idx" ON "notices"("practiceId");

-- CreateIndex
CREATE INDEX "notices_agreementId_idx" ON "notices"("agreementId");

-- CreateIndex
CREATE INDEX "notices_claimLodgedAt_idx" ON "notices"("claimLodgedAt");

-- CreateIndex
CREATE INDEX "notice_delivery_events_practiceId_idx" ON "notice_delivery_events"("practiceId");

-- CreateIndex
CREATE INDEX "notice_delivery_events_noticeId_idx" ON "notice_delivery_events"("noticeId");

-- RLS: same fail-closed practice scoping as every practice-scoped table.
ALTER TABLE "enduring_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enduring_details" FORCE ROW LEVEL SECURITY;
ALTER TABLE "notices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notices" FORCE ROW LEVEL SECURITY;
ALTER TABLE "notice_delivery_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notice_delivery_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON "enduring_details"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

CREATE POLICY practice_isolation ON "notices"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

CREATE POLICY practice_isolation ON "notice_delivery_events"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

-- Delivery evidence is append-only, like verification and signature events.
CREATE FUNCTION prevent_notice_delivery_event_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'notice delivery events are append-only evidence (REQ-DEL-01)';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER notice_delivery_events_append_only
  BEFORE UPDATE OR DELETE ON "notice_delivery_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_notice_delivery_event_change();

-- HARD-02 family: a DISPATCHED notice is immutable. Corrections supersede via
-- supersedesNoticeId; nothing rewrites what was sent (REQ-DEL-06). Delivery
-- outcomes (delivered/read/failed) and retry bookkeeping stay writable.
CREATE FUNCTION prevent_dispatched_notice_content_change() RETURNS trigger AS $$
BEGIN
  IF OLD."dispatchedAt" IS NOT NULL AND (
       NEW."practitionerName"   IS DISTINCT FROM OLD."practitionerName"
    OR NEW."patientName"        IS DISTINCT FROM OLD."patientName"
    OR NEW."serviceDate"        IS DISTINCT FROM OLD."serviceDate"
    OR NEW."benefitAmountCents" IS DISTINCT FROM OLD."benefitAmountCents"
    OR NEW."payloadHash"        IS DISTINCT FROM OLD."payloadHash"
    OR NEW."dispatchedAt"       IS DISTINCT FROM OLD."dispatchedAt"
    OR NEW."dispatchChannel"    IS DISTINCT FROM OLD."dispatchChannel"
  ) THEN
    RAISE EXCEPTION 'REQ-DEL-06: a dispatched notice is immutable - issue a superseding correction notice';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER notices_dispatched_content_immutable
  BEFORE UPDATE ON "notices"
  FOR EACH ROW EXECUTE FUNCTION prevent_dispatched_notice_content_change();
