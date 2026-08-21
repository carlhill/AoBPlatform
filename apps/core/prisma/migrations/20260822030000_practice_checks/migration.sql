-- CreateTable
CREATE TABLE "practice_checks" (
    "id" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "checkKey" TEXT NOT NULL,
    "checklistVersion" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "weight" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reasonCode" TEXT,
    "note" TEXT,
    "fields" JSONB,
    "performedByName" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practice_checks_practiceId_idx" ON "practice_checks"("practiceId");

-- CreateIndex
CREATE INDEX "practice_checks_practiceId_checkKey_idx" ON "practice_checks"("practiceId", "checkKey");


-- ===========================================================================
-- HAND-AUTHORED HALF.
-- ===========================================================================

ALTER TABLE "practice_checks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "practice_checks" FORCE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON "practice_checks"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

ALTER TABLE "practice_checks" DROP CONSTRAINT IF EXISTS checks_outcome_known;
ALTER TABLE "practice_checks" ADD CONSTRAINT checks_outcome_known
  CHECK ("outcome" IN ('passed','failed','not_applicable','could_not_complete'));

ALTER TABLE "practice_checks" DROP CONSTRAINT IF EXISTS checks_category_known;
ALTER TABLE "practice_checks" ADD CONSTRAINT checks_category_known
  CHECK ("category" IN ('entitlement','entity','address','credential','reputation'));

ALTER TABLE "practice_checks" DROP CONSTRAINT IF EXISTS checks_weight_known;
ALTER TABLE "practice_checks" ADD CONSTRAINT checks_weight_known
  CHECK ("weight" IN ('STRONG','MODERATE','WEAK','NEGATIVE'));

-- NOTE what is NOT constrained: `checkKey`. The catalogue is code and will
-- grow, and an enum here would mean a migration for every new check — friction
-- that ends with somebody adding a key by hand to avoid it. The domain
-- validates the key against the versioned catalogue on write, and
-- `checklistVersion` is what makes an old row readable later.

ALTER TABLE "practice_checks" DROP CONSTRAINT IF EXISTS checks_performer_named;
ALTER TABLE "practice_checks" ADD CONSTRAINT checks_performer_named
  CHECK (COALESCE(btrim("performedByName"), '') <> '');

-- A failure needs BOTH a code and words. The code makes it countable; the
-- words are what the next reviewer actually needs.
ALTER TABLE "practice_checks" DROP CONSTRAINT IF EXISTS checks_failure_is_explained;
ALTER TABLE "practice_checks" ADD CONSTRAINT checks_failure_is_explained
  CHECK ("outcome" <> 'failed'
      OR ("reasonCode" IS NOT NULL AND COALESCE(btrim("note"), '') <> ''));

ALTER TABLE "practice_checks" DROP CONSTRAINT IF EXISTS checks_incomplete_has_a_reason;
ALTER TABLE "practice_checks" ADD CONSTRAINT checks_incomplete_has_a_reason
  CHECK ("outcome" <> 'could_not_complete' OR "reasonCode" IS NOT NULL);

-- `not_applicable` is excluded from the score entirely, so an unexplained one
-- is indistinguishable from having skipped the check.
ALTER TABLE "practice_checks" DROP CONSTRAINT IF EXISTS checks_na_is_explained;
ALTER TABLE "practice_checks" ADD CONSTRAINT checks_na_is_explained
  CHECK ("outcome" <> 'not_applicable' OR COALESCE(btrim("note"), '') <> '');

-- ---------------------------------------------------------------------------
-- APPEND-ONLY. A check is a record of something a person did at a moment. If
-- the facts change, or an unanswered call is retried, a NEW row is written and
-- both survive — "we called twice before anyone answered" is a different story
-- from "we called once", and only one of them is true.
-- ---------------------------------------------------------------------------

CREATE FUNCTION prevent_check_rewrite() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Checks are append-only. To change an outcome, perform the check again — both records survive, because '
    'how many attempts it took is itself part of the picture.';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS checks_no_update ON "practice_checks";
CREATE TRIGGER checks_no_update
  BEFORE UPDATE ON "practice_checks"
  FOR EACH ROW EXECUTE FUNCTION prevent_check_rewrite();

DROP TRIGGER IF EXISTS checks_no_delete ON "practice_checks";
CREATE TRIGGER checks_no_delete
  BEFORE DELETE ON "practice_checks"
  FOR EACH ROW EXECUTE FUNCTION prevent_check_rewrite();

-- ---------------------------------------------------------------------------
-- Approval now rests on the CHECKS, not on a single entitlement column.
--
-- The old signature demanded one `entitlementMethod`, which allowed exactly one
-- method per practice — and several are better than one, precisely because
-- they are independent. That column stays as a summary of the method most
-- recently recorded; the checks are the record.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS decide_organisation_validation(uuid,text,text,text,text,text,text,text);

CREATE FUNCTION decide_organisation_validation(
  p_id uuid, p_decision text, p_reviewer text, p_note text,
  p_entitlement_method text, p_phone text, p_number_source text, p_spoke_with text
) RETURNS TABLE (
  id uuid, name text, "validationState" text, "validatedByName" text,
  "validatedAt" timestamp(3), "adminName" text, "adminEmail" text
) AS $$
DECLARE
  v_current text;
  v_entitlement_checks int;
BEGIN
  IF p_decision NOT IN ('validated','rejected') THEN
    RAISE EXCEPTION 'A validation decision is validated or rejected, not %.', p_decision;
  END IF;
  IF COALESCE(btrim(p_reviewer), '') = '' THEN
    RAISE EXCEPTION 'A validation decision must name the human who made it.';
  END IF;

  SELECT pr."validationState" INTO v_current FROM "practices" pr WHERE pr."id" = p_id;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Organisation % not found.', p_id;
  END IF;
  IF v_current <> 'pending' THEN
    RAISE EXCEPTION 'Organisation % is already %, and re-deciding would overwrite who approved it.', p_id, v_current;
  END IF;

  IF p_decision = 'validated' THEN
    SELECT count(*) INTO v_entitlement_checks
      FROM "practice_checks" c
     WHERE c."practiceId" = p_id
       AND c."category" = 'entitlement'
       AND c."outcome" = 'passed';

    -- Either a recorded entitlement CHECK, or the legacy single method. The
    -- legacy path stays until the console has moved over entirely; what is
    -- refused throughout is approving with NEITHER.
    IF v_entitlement_checks = 0 AND COALESCE(btrim(p_entitlement_method), '') = '' THEN
      RAISE EXCEPTION
        'Approving a practice requires at least one PASSED entitlement check. The ABN gate proves the entity '
        'exists; it does not prove this person speaks for it, and the ABN and trading names are public.';
    END IF;
  END IF;

  RETURN QUERY
  UPDATE "practices" pr
     SET "validationState" = p_decision,
         "validatedByName" = btrim(p_reviewer),
         "validatedAt" = now(),
         "validationNote" = p_note,
         "entitlementMethod" = COALESCE(NULLIF(btrim(COALESCE(p_entitlement_method, '')), ''), pr."entitlementMethod"),
         "entitlementPhoneNumber" = COALESCE(NULLIF(btrim(COALESCE(p_phone, '')), ''), pr."entitlementPhoneNumber"),
         "entitlementNumberSource" = COALESCE(NULLIF(btrim(COALESCE(p_number_source, '')), ''), pr."entitlementNumberSource"),
         "entitlementSpokeWithName" = COALESCE(NULLIF(btrim(COALESCE(p_spoke_with, '')), ''), pr."entitlementSpokeWithName"),
         "entitlementCheckedByName" = COALESCE(pr."entitlementCheckedByName",
                                               CASE WHEN COALESCE(btrim(p_entitlement_method), '') = ''
                                                    THEN NULL ELSE btrim(p_reviewer) END),
         "entitlementCheckedAt" = COALESCE(pr."entitlementCheckedAt",
                                           CASE WHEN COALESCE(btrim(p_entitlement_method), '') = ''
                                                THEN NULL ELSE now() END)
   WHERE pr."id" = p_id
  RETURNING pr."id", pr."name", pr."validationState", pr."validatedByName",
            pr."validatedAt", pr."adminName", pr."adminEmail";
END $$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION decide_organisation_validation(uuid,text,text,text,text,text,text,text) TO aob_app;
