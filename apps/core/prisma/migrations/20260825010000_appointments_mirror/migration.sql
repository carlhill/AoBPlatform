-- Appointments as the PMS reported them — the PRE-consultation trigger.
--
-- WHY A TABLE. The appointment feed is read again and again: a morning list,
-- then an arrival slip for the same patient at check-in, then tomorrow's list.
-- One appointment must never open two capture requests, and the only honest
-- way to promise that is a row keyed on the handle the PMS gave it. Nothing
-- about the PERSON lives here — that stays on "patients", mirrored by linkage
-- key exactly as the invoice sync already does (REQ-DATA-10).
--
-- "agreementId" is the pre-agreement drafted for it, or NULL where the
-- cascade decided not to ask — a decision recorded on a capture.suppressed
-- vault event, never left as a silence.

CREATE TABLE "appointments" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId"        UUID NOT NULL,
  "pmsAppointmentKey" TEXT NOT NULL,
  "patientId"         UUID,
  "providerId"        UUID,
  "date"              DATE NOT NULL,
  "time"              TEXT,
  "agreementId"       UUID,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT now()
);

-- The idempotency promise, enforced where two syncs racing would otherwise
-- both see "no row yet".
CREATE UNIQUE INDEX "appointments_practiceId_pmsAppointmentKey_key"
  ON "appointments" ("practiceId", "pmsAppointmentKey");

-- "What is on today" — the kiosk's question.
CREATE INDEX "appointments_practiceId_date_idx"
  ON "appointments" ("practiceId", "date");

-- Same fail-closed tenancy as everything else holding practice data.
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON "appointments"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);
