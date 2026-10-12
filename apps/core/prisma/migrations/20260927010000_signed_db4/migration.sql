-- THE SIGNED-DB4 (D-2026-09-14-02/-03; DB4-AND-AOBL.md §12) — AoB's
-- deterministic reproduction of the DB4 the practice's billing software
-- printed, with the cost on it, the Medicare card number in full and the
-- patient's signature at the bottom. One form back in the chart folder, which
-- is what the practice asked for.
--
-- SIX COLUMNS, AND THE FIRST IS THE ONE THAT MATTERS MOST.
--
-- `sourcePrintJobId` IS A REAL LINK. Until now the only route from an
-- agreement back to the printed form that produced it was
-- `inbound_print_jobs.outcome->'db4'->>'agreementId'` — unindexed JSON,
-- pointing the wrong way — or a join through
-- `service_records."pmsInvoiceKey" = 'db4:<formReference>'`, which is a string
-- convention rather than a reference. Neither is a thing to hang a rendered
-- artefact on, and the Signed-DB4's entire precondition is "this agreement
-- came from a DB4". NULL on every agreement that did not, which is most of
-- them, and that NULL is the whole of the gate.
--
-- NO FOREIGN KEY, deliberately, and the same call as `artefacts."practiceId"`.
-- `inbound_print_jobs` belongs to another module and a declared relation here
-- would be this module reaching into its table (CLAUDE.md §4). The id is
-- provenance; the read is practice-scoped by RLS like every other.
--
-- THE FIVE `signedDb4*` COLUMNS ARE OUTSIDE THE HARD-02 TRIGGER ON PURPOSE.
-- That trigger keeps `particulars`, `particularsLockedAt`,
-- `renderedArtefactHash` and `signatureEventId` immutable once an agreement is
-- signed, and it must stay exactly that. These five are not the signed
-- agreement being rewritten — they record a DIFFERENT artefact, produced after
-- the signature commits precisely because the signature has to be on it. The
-- trigger is untouched by this migration.
--
-- ALL SIX NULL IS ALSO THE RETRY STATE. A Signed-DB4 render that fails leaves
-- the agreement signed, stored and written back, and leaves these null;
-- producing one is idempotent and can simply be asked for again. Hard rule 8:
-- the platform never blocks care, and a failure here slows evidence only.
--
-- Idempotent (DEV-LOOP.md): applied twice, this does nothing the second time.
-- Reversible by
--   DROP INDEX IF EXISTS "agreements_sourcePrintJobId_idx";
--   ALTER TABLE "agreements"
--     DROP COLUMN IF EXISTS "sourcePrintJobId",
--     DROP COLUMN IF EXISTS "signedDb4ArtefactId",
--     DROP COLUMN IF EXISTS "signedDb4Sha256",
--     DROP COLUMN IF EXISTS "signedDb4RendererVersion",
--     DROP COLUMN IF EXISTS "signedDb4ContentVersion",
--     DROP COLUMN IF EXISTS "signedDb4RenderPayload",
--     DROP COLUMN IF EXISTS "signedDb4RenderedAt";
-- -- every column is new and nullable, nothing read them before this
-- migration, and no default changes any existing row's behaviour. The
-- `artefacts_purpose_known` CHECK at the foot of this file reverses by
-- recreating it without 'signed_db4' — which only succeeds once no artefact
-- carries that purpose, correctly.

ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "sourcePrintJobId" UUID;
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "signedDb4ArtefactId" UUID;
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "signedDb4Sha256" TEXT;
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "signedDb4RendererVersion" TEXT;
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "signedDb4ContentVersion" TEXT;
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "signedDb4RenderPayload" JSONB;
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "signedDb4RenderedAt" TIMESTAMPTZ(3);

-- "Which agreement did this printed form become" is a question the write-back
-- and the reconciliation queue both ask, and it must not be a sequential scan
-- of every agreement a practice has ever made.
CREATE INDEX IF NOT EXISTS "agreements_sourcePrintJobId_idx" ON "agreements" ("sourcePrintJobId");

-- THE PURPOSE ALLOWLIST, BROUGHT BACK INTO LINE WITH THE DOMAIN — a THIRD
-- time, and the previous migration said in so many words that this would
-- happen again: "Adding a purpose in TypeScript and not here means the code
-- believes in something the database refuses, and it is discovered as a 500 at
-- the moment somebody uploads."
--
-- HERE IT WOULD NOT EVEN HAVE BEEN A 500. The Signed-DB4 is produced after the
-- signature has committed and its failure is swallowed on purpose (hard rule 8
-- — nothing may block care), so a CHECK violation would have rolled the
-- artefact row back, logged one line, and left every practice signing DB4s
-- with no form in the folder and nothing failing loudly. Silence is the worst
-- failure mode this table has.
--
-- The list is the domain's `ARTEFACT_PURPOSES` (packages/domain/src/artefact.ts)
-- in its order. Dropped and recreated rather than amended, which is also what
-- makes it safe to apply twice.
ALTER TABLE "artefacts" DROP CONSTRAINT IF EXISTS artefacts_purpose_known;
ALTER TABLE "artefacts" ADD CONSTRAINT artefacts_purpose_known
  CHECK ("purpose" IN (
    'entitlement_call','domain_check','website_capture','credential','identity_document',
    'address_evidence','signature_raster','signature_vector','practice_logo','signed_db4','other'));
