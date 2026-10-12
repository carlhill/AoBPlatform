-- ENDURING AT THE KIOSK (Carl, 4 Sep 2026; GA-PLAN B5/B6). Two changes.
--
-- 1. WHICH AGREEMENT THE PRE-STEP OFFERS FIRST, per practice. For a GP
--    practice the strongest answer at the desk is an ONGOING agreement --
--    sign once, and there is nothing post-service ever, because the 89AA
--    notice is one-way and is never chased (REQ-END-05, hard rule 7). A
--    patient who declines is offered an agreement for the visit instead,
--    which is also the only offer for a non-GP provider (REQ-END-01a).
--
--    DEFAULT TRUE, AND IT IS A DEFAULT RATHER THAN A PERMISSION. Enduring
--    stays GP-only and per practitioner x patient however this is set (hard
--    rule 6, REQ-END-01/-01a): the setting decides what is OFFERED FIRST,
--    never what is allowed. NOT NULL for the same reason the idle timeout is
--    -- "no setting" must not become a third, unstated behaviour.
--
-- 2. THE TENTH SESSION STATE: `declined_enduring`. The patient read the
--    ongoing agreement and chose "I'd rather agree each visit". It is an
--    ENDING like `walked_away` and changes NOTHING on the agreement, but it
--    is its own word because it has its own next step -- reception offers an
--    agreement for today's visit. Filing it under `walked_away` would lose
--    the one thing worth knowing: the patient did not leave, they answered.
--    It joins BOTH constraints together so `tablet_sessions_ended_states_agree`
--    still holds in both directions: an ended state and an `endedAt` travel
--    together.
--
-- Idempotent and reversible; written to be applied twice (DEV-LOOP.md).

ALTER TABLE "practices"
  ADD COLUMN IF NOT EXISTS "enduringByDefault" BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_state_known;
  ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_state_known
    CHECK ("state" IN (
      'pushed', 'reading', 'details_confirmed', 'details_disputed',
      'signed', 'walked_away', 'timed_out', 'recalled', 'expired',
      'declined_enduring'
    ));

  ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_ended_states_agree;
  ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_ended_states_agree
    CHECK (
      ("state" IN ('signed', 'walked_away', 'timed_out', 'recalled', 'expired', 'declined_enduring'))
        = ("endedAt" IS NOT NULL)
    );
END
$$;

-- Down:
--   DO $$
--   BEGIN
--     ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_state_known;
--     ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_state_known
--       CHECK ("state" IN ('pushed','reading','details_confirmed','details_disputed',
--                          'signed','walked_away','timed_out','recalled','expired'));
--     ALTER TABLE "tablet_sessions" DROP CONSTRAINT IF EXISTS tablet_sessions_ended_states_agree;
--     ALTER TABLE "tablet_sessions" ADD CONSTRAINT tablet_sessions_ended_states_agree
--       CHECK (("state" IN ('signed','walked_away','timed_out','recalled','expired')) = ("endedAt" IS NOT NULL));
--   END
--   $$;
--   ALTER TABLE "practices" DROP COLUMN IF EXISTS "enduringByDefault";
