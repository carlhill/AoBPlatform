-- PUSH-TO-DEVICE CAPTURE — one locked agreement, assigned to one named tablet
-- (TODO.md "Push-to-device capture" and "Two front doors", Carl 4 Sep 2026).
--
-- The walk-up kiosk stays exactly as it is. This is the SECOND use case on the
-- same paired tablet: reception has already checked the Medicare card in the
-- PMS and asked date of birth, mobile, email and address across the desk (the
-- three-identifier staff check, REQ-VER-03), so the patient never searches and
-- never types. The push validates and LOCKS the particulars server-side before
-- any device sees them, which is why a tablet structurally cannot hold a draft
-- (REQ-REG-06 — signing a draft is the offence in this regime).
--
-- Written to be applied twice (DEV-LOOP.md).

CREATE TABLE IF NOT EXISTS "tablet_sessions" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId"            UUID NOT NULL,
  "deviceId"              UUID NOT NULL,
  "agreementId"           UUID NOT NULL,
  "captureRequestId"      UUID,
  "verificationEventId"   UUID,
  "state"                 TEXT NOT NULL DEFAULT 'pushed',
  "detailsConfirmedTypes" TEXT[] NOT NULL DEFAULT '{}',
  "detailsConfirmedAt"    TIMESTAMP(3),
  "pushedBy"              TEXT NOT NULL,
  "pushedById"            TEXT NOT NULL,
  "pushedAt"              TIMESTAMP(3) NOT NULL DEFAULT now(),
  "lastStateAt"           TIMESTAMP(3) NOT NULL DEFAULT now(),
  "endedAt"               TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "tablet_sessions_practiceId_idx" ON "tablet_sessions" ("practiceId");
CREATE INDEX IF NOT EXISTS "tablet_sessions_deviceId_idx" ON "tablet_sessions" ("deviceId");
CREATE INDEX IF NOT EXISTS "tablet_sessions_agreementId_idx" ON "tablet_sessions" ("agreementId");

-- ---------------------------------------------------------------------------
-- ONE SESSION PER DEVICE, AS A DATABASE FACT.
--
-- A partial unique index rather than a check in the service: two receptionists
-- pushing to the same tablet in the same second produce exactly one session
-- and one refusal, and the refusal can carry the live session's id so the
-- console offers Recall. A read-then-write would produce two sessions showing
-- two patients on one screen, and no story anybody could reconstruct
-- afterwards.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "tablet_sessions_one_active_per_device"
  ON "tablet_sessions" ("deviceId") WHERE "endedAt" IS NULL;

DO $$
BEGIN
  -- The seven states, in the column definition rather than only in TypeScript.
  -- Three are live, four are ended; see packages/domain/src/tablet-session.ts.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tablet_sessions_state_known') THEN
    ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_state_known
      CHECK ("state" IN ('pushed', 'reading', 'details_confirmed', 'signed', 'walked_away', 'recalled', 'expired'));
  END IF;

  -- AN ENDED STATE AND AN END TIME TRAVEL TOGETHER, in both directions. The
  -- partial unique index above keys on `endedAt IS NULL`, so a session left in
  -- `recalled` with no `endedAt` would hold a device busy forever while
  -- claiming to be over — the failure that looks like success.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tablet_sessions_ended_states_agree') THEN
    ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_ended_states_agree
      CHECK (
        ("state" IN ('signed', 'walked_away', 'recalled', 'expired')) = ("endedAt" IS NOT NULL)
      );
  END IF;

  -- PUSHED BY SOMEBODY, ALWAYS. The push IS the staff-verified record
  -- (REQ-VER-03/-04): it carries the identity of the person who checked the
  -- patient across the desk. A row naming nobody would be a verification
  -- record that cannot be questioned later, which is worse than a refusal —
  -- the same reasoning `devices_has_actor` gives.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tablet_sessions_has_actor') THEN
    ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_has_actor
      CHECK (length(trim("pushedBy")) > 0 AND length(trim("pushedById")) > 0);
  END IF;

  -- WHAT THE PATIENT TICKED IS TYPES, NEVER VALUES (REQ-VER-04, hard rule 9).
  -- The five permitted words are here so a row carrying a date of birth or an
  -- address in this column cannot be written at all. Note `mobile` and
  -- `email`: they are CONTACT details and are confirmable, and they are NOT
  -- identity identifiers (REQ-VER-02 — the Medicare-number mistake, one step
  -- sideways).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tablet_sessions_confirmed_types_only') THEN
    ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_confirmed_types_only
      CHECK ("detailsConfirmedTypes" <@ ARRAY['name', 'date_of_birth', 'address', 'mobile', 'email']::text[]);
  END IF;
END
$$;

-- Practice scoping at the DB layer, FORCE so it applies to the owner too.
ALTER TABLE "tablet_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tablet_sessions" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS practice_isolation ON "tablet_sessions";
CREATE POLICY practice_isolation ON "tablet_sessions"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

-- Down:
--   DROP TABLE "tablet_sessions";
