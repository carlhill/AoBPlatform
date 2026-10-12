-- THE ELEVENTH SESSION STATE: `signature_failed` (Carl, 7 Sep 2026).
--
-- The person signed, the request REACHED the server, and the server refused
-- it. The tablet has nothing left to offer -- the payload it holds is the one
-- that was just refused -- so the screen says "please see reception" and
-- clears, and reception re-sends from a row that names the reason.
--
-- IT IS AN ENDING AND IT CHANGES NOTHING ON THE AGREEMENT, exactly like
-- `walked_away`, `timed_out` and `declined_enduring` before it (hard rule 8,
-- REQ-REC-04). It joins BOTH constraints so `tablet_sessions_ended_states_agree`
-- still holds in both directions: an ended state and an `endedAt` travel
-- together.
--
-- AND ONE COLUMN: the server's own reason CODE. A code, never a sentence --
-- the console owns the words, so a refusal can carry a destination with them
-- and an unmapped code can be shown as itself rather than swallowed by a
-- generic message. Nothing about the patient is in it (REQ-LOG-08), and the
-- CHECK is a SHAPE rather than a list: a newer server refusing for a newer
-- reason must reach reception as its code rather than be rejected on the way
-- in.
--
-- Idempotent and reversible; written to be applied twice (DEV-LOOP.md).

ALTER TABLE "tablet_sessions"
  ADD COLUMN IF NOT EXISTS "signatureFailureReason" TEXT;

DO $$
BEGIN
  ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_state_known;
  ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_state_known
    CHECK ("state" IN (
      'pushed', 'reading', 'details_confirmed', 'details_disputed',
      'signed', 'walked_away', 'timed_out', 'recalled', 'expired',
      'declined_enduring', 'signature_failed'
    ));

  ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_ended_states_agree;
  ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_ended_states_agree
    CHECK (
      ("state" IN ('signed', 'walked_away', 'timed_out', 'recalled', 'expired',
                   'declined_enduring', 'signature_failed'))
        = ("endedAt" IS NOT NULL)
    );

  -- A REASON ONLY WHERE THERE WAS A REFUSAL. A code on a session that ended
  -- any other way would be a fact about nothing, and a row that reception's
  -- screen would have to decide whether to believe.
  ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_signature_reason_shape;
  ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_signature_reason_shape
    CHECK (
      "signatureFailureReason" IS NULL
      OR ("state" = 'signature_failed' AND "signatureFailureReason" ~ '^[a-z][a-z0-9_]{0,59}$')
    );
END
$$;

-- Down:
--   DO $$
--   BEGIN
--     ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_signature_reason_shape;
--     UPDATE "tablet_sessions" SET "state" = 'walked_away' WHERE "state" = 'signature_failed';
--     ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_state_known;
--     ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_state_known
--       CHECK ("state" IN ('pushed','reading','details_confirmed','details_disputed',
--                          'signed','walked_away','timed_out','recalled','expired',
--                          'declined_enduring'));
--     ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_ended_states_agree;
--     ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_ended_states_agree
--       CHECK (("state" IN ('signed','walked_away','timed_out','recalled','expired','declined_enduring'))
--              = ("endedAt" IS NOT NULL));
--   END
--   $$;
--   ALTER TABLE "tablet_sessions" DROP COLUMN IF EXISTS "signatureFailureReason";
