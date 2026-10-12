-- HOW THE DISPUTE ENDED, ON THE ROW (Carl's ruling, 4 Sep 2026).
--
-- The cross already had an event. What it did not have was a place on the
-- SESSION, so reception's list could only ever say "a detail is wrong" — even
-- after they had fixed it, or established that nothing needed fixing. The row
-- now reads "Resolved — ready to re-send" between the answer and the re-send,
-- which is the gap this closes.
--
-- A FACT ABOUT THE DISPUTE, NOT A NEW STATE. `state` stays `details_disputed`:
-- the cross happened, and a resolution does not unhappen it. Nothing here
-- touches `tablet_sessions_state_known` or the disputed-list constraints, and
-- `tablet_sessions_ended_states_agree` is untouched in both directions — a
-- resolved dispute is still a LIVE session holding its device, which is what
-- keeps it on the one list reception needs it on.
--
-- WHO BY IS A PRINCIPAL ID, NEVER A NAME. The display name belongs on the
-- vault event, where an audit line needs to read; a name in a column goes
-- stale the moment somebody is renamed and joins to nothing. And no value of
-- any kind appears here — the resolution is an outcome plus TYPES, and the
-- types already live in `detailsDisputedTypes` (REQ-VER-04, hard rule 9).
--
-- THE OUTCOME LIST IS `DISPUTE_RESOLUTION_OUTCOMES` in
-- packages/domain/src/tablet-session.ts. There is no generator that writes
-- this constraint from it, so the two are kept in step by hand and by the
-- named e2e test — the same arrangement every other CHECK in this schema uses
-- (see `tablet_sessions_state_known`). If a third outcome is ever added, both
-- change together or the write fails loudly here rather than quietly there.
--
-- Written to be applied twice (DEV-LOOP.md).

ALTER TABLE "tablet_sessions"
  ADD COLUMN IF NOT EXISTS "disputeResolution" TEXT;
ALTER TABLE "tablet_sessions"
  ADD COLUMN IF NOT EXISTS "disputeResolvedAt" TIMESTAMP(3);
ALTER TABLE "tablet_sessions"
  ADD COLUMN IF NOT EXISTS "disputeResolvedByPrincipalId" TEXT;

DO $$
BEGIN
  -- TWO HONEST ANSWERS AND NO THIRD. `corrected` says reception changed the
  -- detail (that act has its own `patient.details_corrected` event);
  -- `patient_error` says the detail was right and the patient crossed it
  -- anyway. Anything else written here is a refusal rather than a row.
  ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_dispute_resolution_known;
  ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_dispute_resolution_known
    CHECK ("disputeResolution" IS NULL OR "disputeResolution" IN ('corrected', 'patient_error'));

  -- A RESOLUTION TRAVELS WITH ITS TIME AND ITS AUTHOR, in both directions. A
  -- resolved dispute nobody can be asked about is the shape this platform
  -- exists to prevent, and a timestamp with no outcome is a row that says
  -- something happened without saying what.
  ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_dispute_resolution_attributed;
  ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_dispute_resolution_attributed
    CHECK (
      ("disputeResolution" IS NOT NULL)
        = ("disputeResolvedAt" IS NOT NULL AND "disputeResolvedByPrincipalId" IS NOT NULL)
    );

  -- AND ONLY A DISPUTE CAN BE RESOLVED. A session with nothing crossed and an
  -- answer to it would read like evidence of a conversation that never
  -- happened — the same rule the service states, put where no caller can get
  -- round it.
  ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_resolution_needs_a_dispute;
  ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_resolution_needs_a_dispute
    CHECK ("disputeResolution" IS NULL OR array_length("detailsDisputedTypes", 1) >= 1);
END
$$;

-- Down:
--   ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_resolution_needs_a_dispute;
--   ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_dispute_resolution_attributed;
--   ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_dispute_resolution_known;
--   ALTER TABLE "tablet_sessions" DROP COLUMN IF EXISTS "disputeResolvedByPrincipalId";
--   ALTER TABLE "tablet_sessions" DROP COLUMN IF EXISTS "disputeResolvedAt";
--   ALTER TABLE "tablet_sessions" DROP COLUMN IF EXISTS "disputeResolution";
