-- Hand-authored migration: row-level security practice scoping + hard-rule
-- triggers. Enforcement at the database layer, in depth behind the
-- application checks (CLAUDE.md §2, Addendum v3 §4).

-- ---------------------------------------------------------------------------
-- Row-level security (fail closed).
--
-- FORCE means even the table owner is subject to the policies. The scoping
-- policy requires the transaction-local setting app.practice_id
-- (SET LOCAL app.practice_id = '<uuid>' — see PrismaService.withPractice()).
-- When it is unset, current_setting(..., true) returns NULL, the comparison
-- is NULL, and every row is filtered: a request that forgets to set its
-- practice scope sees NOTHING, writes NOTHING.
--
-- vault_outbox is deliberately NOT scoped: the relay is a system job across
-- practices and rows carry IDs only, never content (REQ-LOG-08).
-- ---------------------------------------------------------------------------

ALTER TABLE "practices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "practices" FORCE ROW LEVEL SECURITY;
ALTER TABLE "providers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "providers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "patients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;
ALTER TABLE "assignors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignors" FORCE ROW LEVEL SECURITY;
ALTER TABLE "agreements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agreements" FORCE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON "practices"
  USING (id = current_setting('app.practice_id', true)::uuid)
  WITH CHECK (id = current_setting('app.practice_id', true)::uuid);

CREATE POLICY practice_isolation ON "providers"
  USING ("practiceId" = current_setting('app.practice_id', true)::uuid)
  WITH CHECK ("practiceId" = current_setting('app.practice_id', true)::uuid);

CREATE POLICY practice_isolation ON "patients"
  USING ("practiceId" = current_setting('app.practice_id', true)::uuid)
  WITH CHECK ("practiceId" = current_setting('app.practice_id', true)::uuid);

CREATE POLICY practice_isolation ON "assignors"
  USING ("practiceId" = current_setting('app.practice_id', true)::uuid)
  WITH CHECK ("practiceId" = current_setting('app.practice_id', true)::uuid);

CREATE POLICY practice_isolation ON "agreements"
  USING ("practiceId" = current_setting('app.practice_id', true)::uuid)
  WITH CHECK ("practiceId" = current_setting('app.practice_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- HARD-01: the agreement anchor and identity fields are immutable. No update
-- path, no admin override, no migration script. Terminate + recreate is the
-- only way to change who an agreement binds.
-- ---------------------------------------------------------------------------

CREATE FUNCTION prevent_agreement_anchor_change() RETURNS trigger AS $$
BEGIN
  IF NEW."anchorKind"      IS DISTINCT FROM OLD."anchorKind"
  OR NEW."providerId"      IS DISTINCT FROM OLD."providerId"
  OR NEW."organisationId"  IS DISTINCT FROM OLD."organisationId"
  OR NEW."patientId"       IS DISTINCT FROM OLD."patientId"
  OR NEW."practiceId"      IS DISTINCT FROM OLD."practiceId"
  OR NEW."type"            IS DISTINCT FROM OLD."type" THEN
    RAISE EXCEPTION 'HARD-01: agreement anchor/identity fields are immutable — terminate and recreate';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER agreements_anchor_immutable
  BEFORE UPDATE ON "agreements"
  FOR EACH ROW EXECUTE FUNCTION prevent_agreement_anchor_change();

-- ---------------------------------------------------------------------------
-- HARD-02: rendered content is immutable once signed. Corrections create a
-- superseding agreement; nothing rewrites a signed artefact.
-- ---------------------------------------------------------------------------

CREATE FUNCTION prevent_signed_content_change() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN (
    'signed','validated','stored','active','claim_linked','verbal_recorded',
    'registration_pending','registered','registration_overdue','ceased',
    'legal_hold','retention_expiry_scheduled'
  ) AND (
       NEW."particulars"          IS DISTINCT FROM OLD."particulars"
    OR NEW."particularsLockedAt"  IS DISTINCT FROM OLD."particularsLockedAt"
    OR NEW."renderedArtefactHash" IS DISTINCT FROM OLD."renderedArtefactHash"
    OR NEW."signatureEventId"     IS DISTINCT FROM OLD."signatureEventId"
  ) THEN
    RAISE EXCEPTION 'HARD-02: a signed agreement is immutable — create a superseding agreement';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER agreements_signed_content_immutable
  BEFORE UPDATE ON "agreements"
  FOR EACH ROW EXECUTE FUNCTION prevent_signed_content_change();
