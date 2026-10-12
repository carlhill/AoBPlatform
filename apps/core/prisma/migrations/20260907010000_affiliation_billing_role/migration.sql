-- THE BILLING ROLE, AND THE ARRIVAL THAT NAMED THE WRONG PERSON
-- (Carl, 5-7 Sep 2026; TODO.md "Billing role on the affiliation").
--
-- WHAT THE RULE IS. The provider on an assignment of benefit is the SERVICING
-- PROVIDER whose provider number goes on the claim, never (of itself) the
-- person who delivered the service. A practice nurse on a "for and on behalf
-- of" item bills nothing under their own number -- the claim goes under the
-- GP, so the assignment does too. A nurse practitioner is an eligible provider
-- in their own right. A phlebotomist generates no Medicare claim at all.
--
-- WHY IT HANGS OFF THE AFFILIATION. Provider numbers are issued per
-- practitioner PER LOCATION, and the same person can be a nurse practitioner
-- at one site and an RN at another. `affiliations` is the practitioner x
-- location edge and already carries `providerNumber` for that reason (FR-1.8).
--
-- WHY THE DEFAULT IS `servicing_provider` AND IS NOT A GUESS. Every
-- practitioner on the platform on the day this landed is a doctor: the roster
-- is doctors, invited by practices as doctors, and the affiliation exists to
-- carry their provider number. The default states what was already true rather
-- than inventing a state nobody chose. A practice that employs a nurse changes
-- the role on the affiliation screen, and that change is a vault event
-- (`affiliation.billing_role_set`).
--
-- THE LIST IS VERSIONED CONTENT, NOT CODE (hard rule 14):
-- packages/domain/content/billing-roles.json. The CHECK below repeats the keys
-- from that file, in the pattern `assignors_authority_basis_known` set: the
-- list a user picks from is content, and the set of values the COLUMN may hold
-- is a constraint, and the two are kept in step by hand when the file moves.
-- The database is the last line, not the only one.
--
-- Idempotent, reversible, written to be applied twice (DEV-LOOP.md).

ALTER TABLE "affiliations"
  ADD COLUMN IF NOT EXISTS "billingRole" TEXT NOT NULL DEFAULT 'servicing_provider';

-- ---------------------------------------------------------------------------
-- AN ARRIVAL THAT NAMED SOMEBODY WHO CANNOT BE THE PROVIDER.
--
-- Carl's ruling: it is REFUSED, and reception picks the provider the claim
-- will go under. Accepting a `supervisingProviderId` from the PMS was the
-- alternative and was rejected -- it would have the practice's software
-- deciding whose name goes on a contract.
--
-- A refusal is RECORDED rather than merely returned. "The connector sent us
-- somebody who cannot be the provider" is a fact about an onboarding, and one
-- that has to be visible at the desk rather than only in a 422 nobody reads.
--
-- `refusedPayload` HOLDS THE PMS'S OWN MESSAGE, and only while the arrival is
-- refused. Reception's fix is one click -- choose the provider, and the
-- platform replays the arrival it already has -- and it cannot replay a
-- message it threw away. Nothing is mirrored onto the patient row until that
-- click, so a refused arrival changes nothing about the person. The payload is
-- CLEARED the moment the arrival is accepted, enforced by the CHECK below, so
-- it is a held message and never a second copy of the patient record. Same
-- shape and same reasoning as `inbound_print_jobs.payload`.
-- ---------------------------------------------------------------------------

ALTER TABLE "arrivals" ADD COLUMN IF NOT EXISTS "outcome" TEXT NOT NULL DEFAULT 'received';
ALTER TABLE "arrivals" ADD COLUMN IF NOT EXISTS "refusedReason" TEXT;
ALTER TABLE "arrivals" ADD COLUMN IF NOT EXISTS "refusedPayload" JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliations_billing_role_known') THEN
    ALTER TABLE "affiliations" ADD CONSTRAINT affiliations_billing_role_known
      CHECK ("billingRole" IN ('servicing_provider', 'works_under_provider', 'not_billable'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arrivals_outcome_known') THEN
    ALTER TABLE "arrivals" ADD CONSTRAINT arrivals_outcome_known
      CHECK ("outcome" IN ('received', 'refused'));
  END IF;

  -- A REFUSAL WITHOUT A REASON IS NOT A REFUSAL, it is a shrug -- and this one
  -- is read by a person at a desk who has to fix it. The same shape as
  -- `assignors_other_basis_has_note`, for the same reason.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arrivals_refusal_has_a_reason') THEN
    ALTER TABLE "arrivals" ADD CONSTRAINT arrivals_refusal_has_a_reason
      CHECK (("outcome" = 'refused') = ("refusedReason" IS NOT NULL));
  END IF;

  -- AND AN ACCEPTED ARRIVAL HOLDS NO PAYLOAD. The held message exists only so
  -- reception can replay a refusal; once the arrival has been accepted the
  -- patient row IS the record (REQ-DATA-10) and a second copy of the same
  -- details sitting in a JSON column is data we have no reason to keep.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arrivals_payload_held_only_while_refused') THEN
    ALTER TABLE "arrivals" ADD CONSTRAINT arrivals_payload_held_only_while_refused
      CHECK ("outcome" = 'refused' OR "refusedPayload" IS NULL);
  END IF;
END
$$;

-- The desk's "Needs a provider" list, and nothing else reads this way.
CREATE INDEX IF NOT EXISTS "arrivals_practice_outcome_idx"
  ON "arrivals" ("practiceId", "outcome", "arrivedAt");

-- ---------------------------------------------------------------------------
-- ROLLBACK (apply by hand; Prisma has no down-migrations)
--
--   DROP INDEX IF EXISTS "arrivals_practice_outcome_idx";
--   ALTER TABLE "arrivals"     DROP CONSTRAINT IF EXISTS arrivals_payload_held_only_while_refused;
--   ALTER TABLE "arrivals"     DROP CONSTRAINT IF EXISTS arrivals_refusal_has_a_reason;
--   ALTER TABLE "arrivals"     DROP CONSTRAINT IF EXISTS arrivals_outcome_known;
--   ALTER TABLE "arrivals"     DROP COLUMN IF EXISTS "refusedPayload";
--   ALTER TABLE "arrivals"     DROP COLUMN IF EXISTS "refusedReason";
--   ALTER TABLE "arrivals"     DROP COLUMN IF EXISTS "outcome";
--   ALTER TABLE "affiliations" DROP CONSTRAINT IF EXISTS affiliations_billing_role_known;
--   ALTER TABLE "affiliations" DROP COLUMN IF EXISTS "billingRole";
--
-- What the rollback loses: which practitioners are servicing providers at
-- which locations, and the record of arrivals refused for naming somebody who
-- is not one. Neither is part of the non-repudiation chain -- the vault holds
-- `affiliation.billing_role_set` and `arrival.refused` -- so nothing that
-- proves a consent goes with it.
-- ---------------------------------------------------------------------------
