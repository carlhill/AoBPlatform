-- AN ARRIVAL CARRIES WHO THE PATIENT CAME TO SEE, AND WHO THE CLAIM GOES UNDER
-- (Carl, 12 Sep 2026; ARRIVAL-WHO-IS-SEEN.md sections 2 and 6).
--
-- Carl: "build the arrival change so nurses can be arrived. It is not just
-- nurses -- even the phlebotomists can be arrived, if someone has just come for
-- a blood test or some other specimen test."
--
-- THE PROBLEM. `arrivals.affiliationId` was doing two jobs: who the patient
-- came to see, and who the claim goes under. For a GP they are the same person
-- and nobody noticed. For a nurse or a phlebotomist they are not, and because
-- only a `servicing_provider` may be named on an agreement the whole arrival
-- was REFUSED and reception substituted the billable provider. The person the
-- patient actually came to see was thrown away.
--
-- `affiliationId` KEEPS ITS PRESENT MEANING AND EVERY PRESENT USE. Agreements
-- anchor on it, the visit policy reads it, the desk queue joins on it. The new
-- column is purely additive.
--
-- NO FOREIGN KEY, because this table carries none by design -- the same shape
-- `affiliationId`, `patientId` and `providerId` already have. Scoping is RLS on
-- `practiceId`, which is where it belongs.
--
-- THE BACKFILL IS TRUE, NOT A GUESS. Until today an arrival could only be
-- accepted when the person named could be the provider on the agreement, so for
-- every arrival written so far the two facts WERE the same fact. Copying
-- `affiliationId` across states what happened rather than inventing it. Refused
-- rows are copied too, and for the same reason: the affiliation recorded on a
-- refusal is the practitioner the sender named.
--
-- Idempotent, reversible, written to be applied twice (DEV-LOOP.md). The down
-- path is at the foot of this file, commented because Prisma migrations do not
-- run one; dropping the column takes nothing with it.

ALTER TABLE "arrivals" ADD COLUMN IF NOT EXISTS "seeingAffiliationId" UUID;

-- ONLY WHERE IT IS STILL UNSET, so re-running this cannot overwrite a value the
-- application has since written for somebody who was seen by a nurse.
UPDATE "arrivals"
   SET "seeingAffiliationId" = "affiliationId"
 WHERE "seeingAffiliationId" IS NULL
   AND "affiliationId" IS NOT NULL;

-- "Everybody this practitioner is seeing today" -- the read the nurse's own
-- queue page will make (PRACTITIONER-QUEUE-PAGE.md), which is always about one
-- practitioner on one day.
CREATE INDEX IF NOT EXISTS "arrivals_seeing_affiliation_idx"
  ON "arrivals" ("practiceId", "seeingAffiliationId", "arrivedAt");

-- DOWN (by hand; Prisma does not run it):
--   DROP INDEX IF EXISTS "arrivals_seeing_affiliation_idx";
--   ALTER TABLE "arrivals" DROP COLUMN IF EXISTS "seeingAffiliationId";
