-- AlterTable
ALTER TABLE "practitioners" ADD COLUMN     "invitedByPracticeId" UUID;

-- ---------------------------------------------------------------------------
-- A practitioner identity is created by INVITATION only (CONVENTIONS.md §8b).
--
-- No self-registration path exists, so every practitioner traces to a
-- validated practice that a named human approved. To mint a fake practitioner
-- an attacker must first obtain such a practice — a real ACTIVE ABN, a name
-- matching the register, a passed entitlement check, human approval. Identity
-- creation goes from free to expensive, which is the whole point.
--
-- Deliberately NO foreign key: the identity outlives the practice that
-- introduced it. A practitioner between jobs, or one whose introducing
-- practice has since left the platform, does not cease to exist — they are one
-- human across the platform, which is the reason `practitioners` is not
-- practice-scoped in the first place.
--
-- Existing rows keep a NULL: they predate the rule, and backfilling a practice
-- id would be inventing a provenance nobody recorded.
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN "practitioners"."invitedByPracticeId" IS
  'The validated practice that created this identity. NULL only for rows predating the invitation-only rule.';
