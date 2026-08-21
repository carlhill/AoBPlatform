-- The validation queue must list APPLICATIONS, not every practice row.
--
-- `validationState` defaults to 'pending', which is the right default for a
-- new column — but it means every practice created through the older
-- POST /practices path (the dev seed, and every e2e fixture) appears in the
-- reviewer's queue as though someone had applied. Thirty rows with no ABN,
-- no legal name and nothing to review.
--
-- A queue full of items that cannot be actioned is worse than a slightly
-- wrong count: reviewers learn to skim it, and a real application waits behind
-- twenty-nine that are not applications at all.
--
-- `abnVerifiedAt` is the discriminator, and it is a fact rather than a flag:
-- register_organisation() sets it when the ABR has actually answered, so it is
-- non-null exactly for organisations that went through onboarding.

CREATE OR REPLACE FUNCTION list_pending_organisations()
RETURNS TABLE (
  id uuid, name text, abn text, acn text, "legalName" text,
  "tradingNames" text[], "entityType" text, "abnStatus" text,
  "nameMatchTier" text, "nameMatchedOn" text, "createdAt" timestamp(3)
) AS $$
  SELECT p."id", p."name", p."abn", p."acn", p."legalName", p."tradingNames",
         p."entityType", p."abnStatus", p."nameMatchTier", p."nameMatchedOn", p."createdAt"
  FROM "practices" p
  WHERE p."validationState" = 'pending'
    AND p."abnVerifiedAt" IS NOT NULL
  ORDER BY p."createdAt" ASC;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION list_pending_organisations() TO aob_app;

-- Practices that predate onboarding are marked so, rather than left sitting in
-- a state that reads as "an application nobody has looked at". They are not
-- 'validated' — nobody validated them — they simply never applied.
ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS practices_validation_state_known;
ALTER TABLE "practices" ADD CONSTRAINT practices_validation_state_known
  CHECK ("validationState" IN ('pending','validated','rejected','not_applicable'));

UPDATE "practices"
   SET "validationState" = 'not_applicable'
 WHERE "validationState" = 'pending'
   AND "abnVerifiedAt" IS NULL;
