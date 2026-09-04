-- THE NINTH STATE: `timed_out` (Carl's ruling, 4 Sep 2026).
--
-- Same effect on the record as `walked_away` — the session ends, the
-- agreement is untouched, the device is released to idle — but a different
-- word, so reception can tell "the patient pressed See reception" from "the
-- tablet's own inactivity clock ended it with nobody there". It joins the
-- ended states, exactly where `walked_away` sits, so
-- `tablet_sessions_ended_states_agree` still holds: an ended state and an
-- `endedAt` travel together, in both directions.
--
-- DROPPED AND RE-ADDED, not altered: a CHECK constraint's expression cannot
-- be changed in place, and `IF EXISTS` on the drop is what lets this file be
-- applied twice (DEV-LOOP.md).

DO $$
BEGIN
  ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_state_known;
  ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_state_known
    CHECK ("state" IN (
      'pushed', 'reading', 'details_confirmed', 'details_disputed',
      'signed', 'walked_away', 'timed_out', 'recalled', 'expired'
    ));

  ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_ended_states_agree;
  ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_ended_states_agree
    CHECK (
      ("state" IN ('signed', 'walked_away', 'timed_out', 'recalled', 'expired')) = ("endedAt" IS NOT NULL)
    );
END
$$;
