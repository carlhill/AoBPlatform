-- Why the cascade did not ask, on the service record itself.
--
-- The capture.suppressed vault event is the record. But the reconciliation
-- queue is read by a person deciding what to do next, and "needs agreement"
-- tells them nothing about WHY the platform left it to them. The reason word
-- lives here so the screen can show it beside the item (the wireframe's
-- "confidential" under CHASE SUPPRESSED is the shape). Cleared when an
-- agreement is drafted.
ALTER TABLE "service_records"
  ADD COLUMN "captureSuppressedReason" TEXT,
  ADD COLUMN "captureSuppressedAt"     TIMESTAMP(3);
