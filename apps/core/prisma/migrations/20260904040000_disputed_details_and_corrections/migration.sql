-- TICK OR CROSS PER ROW, AND RECEPTION SEES WHICH
-- (TODO.md "Check-your-details: tick or cross per row", Carl 4 Sep 2026).
--
-- The patient answers every detail on K-P1 with a tick or a cross. A cross
-- stops the ceremony and tells reception WHICH detail is wrong, so they can
-- correct it at the desk and send the agreement again. Two things follow, and
-- they are the whole of this migration:
--
--   1. A session can be in `details_disputed` — a LIVE state, not an ending.
--      The device keeps the session; reception acts on it.
--   2. A patient mirror row can carry WHEN a staff member corrected it, and
--      which fields. The PMS remains the source of truth (REQ-DATA-10): until
--      the Medtech write-back exists (D-01) the next sync would bring the old
--      value back, so the sync will need to compare per field and refuse to
--      overwrite a staff correction newer than its own value.
--
-- TYPES, NEVER VALUES, on both new session columns (REQ-VER-04, hard rule 9).
-- The CHECK constraint below is what makes that a fact about the database
-- rather than a promise about the callers.
--
-- Written to be applied twice (DEV-LOOP.md).

ALTER TABLE "tablet_sessions"
  ADD COLUMN IF NOT EXISTS "detailsDisputedTypes" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "tablet_sessions"
  ADD COLUMN IF NOT EXISTS "detailsDisputedAt" TIMESTAMP(3);

ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "detailsCorrectedAt" TIMESTAMP(3);
ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "detailsCorrectedFields" JSONB;

DO $$
BEGIN
  -- ---------------------------------------------------------------------
  -- THE EIGHTH STATE. `details_disputed` joins the three live ones rather
  -- than the four ended ones, so `tablet_sessions_ended_states_agree` still
  -- holds unchanged: a disputed session has no `endedAt`, keeps its device,
  -- and stays on reception's live list — which is the one list they need it
  -- on.
  --
  -- DROPPED AND RE-ADDED rather than altered: a CHECK constraint's expression
  -- cannot be changed in place, and `IF EXISTS` on the drop is what lets this
  -- file be applied twice.
  -- ---------------------------------------------------------------------
  ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_state_known;
  ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_state_known
    CHECK ("state" IN (
      'pushed', 'reading', 'details_confirmed', 'details_disputed',
      'signed', 'walked_away', 'recalled', 'expired'
    ));

  -- WHAT THE PATIENT CROSSED IS TYPES, NEVER VALUES — the same five permitted
  -- words as the confirmed column, and the same reason (REQ-VER-04, hard rule
  -- 9). A row carrying an address in this column cannot be written at all.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tablet_sessions_disputed_types_only') THEN
    ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_disputed_types_only
      CHECK ("detailsDisputedTypes" <@ ARRAY['name', 'date_of_birth', 'address', 'mobile', 'email']::text[]);
  END IF;

  -- TICKED OR CROSSED, NEVER BOTH. The service refuses an overlapping pair
  -- before it writes; this is the same rule where a caller cannot get at it.
  -- A record saying the patient both agreed and disagreed about their address
  -- is not a record of anything.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tablet_sessions_answers_disjoint') THEN
    ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_answers_disjoint
      CHECK (NOT ("detailsConfirmedTypes" && "detailsDisputedTypes"));
  END IF;

  -- A DISPUTED STATE AND A DISPUTED LIST TRAVEL TOGETHER. A session sitting in
  -- `details_disputed` with an empty list would tell reception that something
  -- is wrong and not which thing — the failure that looks like information.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tablet_sessions_disputed_state_has_types') THEN
    ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_disputed_state_has_types
      CHECK ("state" <> 'details_disputed' OR array_length("detailsDisputedTypes", 1) >= 1);
  END IF;
END
$$;

-- Down:
--   ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_disputed_state_has_types;
--   ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_answers_disjoint;
--   ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_disputed_types_only;
--   ALTER TABLE "tablet_sessions" DROP COLUMN IF EXISTS "detailsDisputedAt";
--   ALTER TABLE "tablet_sessions" DROP COLUMN IF EXISTS "detailsDisputedTypes";
--   ALTER TABLE "patients" DROP COLUMN IF EXISTS "detailsCorrectedFields";
--   ALTER TABLE "patients" DROP COLUMN IF EXISTS "detailsCorrectedAt";
--   ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_state_known;
--   ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_state_known
--     CHECK ("state" IN ('pushed','reading','details_confirmed','signed','walked_away','recalled','expired'));
