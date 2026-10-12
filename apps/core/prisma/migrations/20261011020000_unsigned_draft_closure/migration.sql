-- UNSIGNED AGREEMENTS WITH NO SERVICE ARE CLOSED AFTER N DAYS
-- (D-2026-10-10-09, option 3; Carl, 10 Oct 2026: "N is 7 days - make N a
-- configurable setting").
--
-- N IS VERSIONED CONTENT (`packages/domain/content/unsigned-draft-closure.json`,
-- hard rule 14). A practice may set its own; NULL means it follows the
-- content default. Closing is `expired` (already in the lifecycle) with the
-- reason, time, content version and N stored beside the status; never a delete.
--
-- Idempotent, written to be applied twice (DEV-LOOP.md), and reversible: the
-- down path is at the foot of this file, commented because Prisma migrations
-- do not run one.

ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "unsignedDraftClosureDays" INTEGER;

-- THE BOUNDS ARE THE CONTENT FILE'S `minDays` AND `maxDays` (1 and 90 at
-- `unsigned-draft-closure-2026-10-1`). Narrowing them is a content change AND a
-- migration; the loader refuses a default outside them.
ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS "practices_unsigned_draft_closure_days_range";
ALTER TABLE "practices" ADD CONSTRAINT "practices_unsigned_draft_closure_days_range"
  CHECK ("unsignedDraftClosureDays" IS NULL OR "unsignedDraftClosureDays" BETWEEN 1 AND 90);

ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "closedReason" TEXT;
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMPTZ(3);
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "closureRuleVersion" TEXT;
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "closureDays" INTEGER;
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "closureDaysSource" TEXT;

-- ALL OR NONE, AND ONLY ON AN EXPIRED AGREEMENT. A closure reason on a live
-- agreement would be a closure that did not happen; a closure with no version
-- or N would be one nobody could re-derive.
ALTER TABLE "agreements" DROP CONSTRAINT IF EXISTS "agreements_closure_all_or_none";
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_closure_all_or_none"
  CHECK (
    ("closedReason" IS NULL AND "closedAt" IS NULL AND "closureRuleVersion" IS NULL
      AND "closureDays" IS NULL AND "closureDaysSource" IS NULL)
    OR ("closedReason" IS NOT NULL AND "closedAt" IS NOT NULL AND "closureRuleVersion" IS NOT NULL
      AND "closureDays" IS NOT NULL AND "closureDaysSource" IS NOT NULL AND "status" = 'expired')
  );

-- THE LISTS ARE COPIED FROM THE DOMAIN: `UNSIGNED_DRAFT_CLOSURE_REASONS` and the
-- two sources `effectiveClosureDays` answers, in
-- `packages/domain/src/unsigned-draft-closure.ts`.
ALTER TABLE "agreements" DROP CONSTRAINT IF EXISTS "agreements_closure_values";
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_closure_values"
  CHECK (
    ("closedReason" IS NULL OR "closedReason" IN ('no_service_recorded'))
    AND ("closureDaysSource" IS NULL OR "closureDaysSource" IN ('practice', 'content_default'))
    AND ("closureDays" IS NULL OR "closureDays" >= 1)
  );

-- WHICH PRACTICES HAVE AN UNSIGNED AGREEMENT THE SWEEP SHOULD LOOK AT. The
-- sweep acts for the platform and has no practice scope, and RLS on
-- `agreements` correctly yields nothing to an unscoped read, so it asks this
-- SECURITY DEFINER function, as `core.post_service_chase_due` does
-- (CONVENTIONS.md section 6). PRACTICE IDS ONLY. The statuses and types are
-- PARAMETERS, passed from the domain, so there is no second list here.
CREATE OR REPLACE FUNCTION core.unsigned_draft_closure_practices(
  p_statuses text[],
  p_types text[],
  p_limit integer DEFAULT 500
)
RETURNS TABLE ("practiceId" uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT DISTINCT a."practiceId"
  FROM core.agreements a
  WHERE a."status" = ANY (p_statuses)
    AND a."type" = ANY (p_types)
    AND a."signatureEventId" IS NULL
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION core.unsigned_draft_closure_practices(text[], text[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.unsigned_draft_closure_practices(text[], text[], integer) TO aob_app;

-- DOWN (run by hand to reverse):
-- DROP FUNCTION IF EXISTS core.unsigned_draft_closure_practices(text[], text[], integer);
-- ALTER TABLE "agreements" DROP CONSTRAINT IF EXISTS "agreements_closure_values";
-- ALTER TABLE "agreements" DROP CONSTRAINT IF EXISTS "agreements_closure_all_or_none";
-- ALTER TABLE "agreements" DROP COLUMN IF EXISTS "closureDaysSource", DROP COLUMN IF EXISTS "closureDays",
--   DROP COLUMN IF EXISTS "closureRuleVersion", DROP COLUMN IF EXISTS "closedAt", DROP COLUMN IF EXISTS "closedReason";
-- ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS "practices_unsigned_draft_closure_days_range";
-- ALTER TABLE "practices" DROP COLUMN IF EXISTS "unsignedDraftClosureDays";
