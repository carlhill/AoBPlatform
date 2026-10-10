-- AN ASSOCIATION IS A DOMAIN FACT, SO NOTHING DELETES IT AS A SIDE EFFECT
-- (review of D-2026-10-10-09, 11 Oct 2026).
--
-- `20261011010000_pre_agreement_associations` declared both foreign keys
-- ON DELETE CASCADE, so deleting an agreement or a service record would have
-- removed the association with no vault event saying so. RESTRICT instead:
-- the parent cannot be deleted while an association names it. Agreements and
-- service records are never hard-deleted in production (hard rule 11:
-- crypto-shredding plus a tombstone), so this only changes what a test
-- teardown must do first.
--
-- Idempotent and reversible: the down path (back to CASCADE) is at the foot.

ALTER TABLE "pre_agreement_associations" DROP CONSTRAINT IF EXISTS "pre_agreement_associations_agreementId_fkey";
ALTER TABLE "pre_agreement_associations" ADD CONSTRAINT "pre_agreement_associations_agreementId_fkey"
  FOREIGN KEY ("agreementId") REFERENCES "agreements" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pre_agreement_associations" DROP CONSTRAINT IF EXISTS "pre_agreement_associations_serviceRecordId_fkey";
ALTER TABLE "pre_agreement_associations" ADD CONSTRAINT "pre_agreement_associations_serviceRecordId_fkey"
  FOREIGN KEY ("serviceRecordId") REFERENCES "service_records" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DOWN (run by hand to reverse):
-- ALTER TABLE "pre_agreement_associations" DROP CONSTRAINT IF EXISTS "pre_agreement_associations_agreementId_fkey";
-- ALTER TABLE "pre_agreement_associations" ADD CONSTRAINT "pre_agreement_associations_agreementId_fkey"
--   FOREIGN KEY ("agreementId") REFERENCES "agreements" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- ALTER TABLE "pre_agreement_associations" DROP CONSTRAINT IF EXISTS "pre_agreement_associations_serviceRecordId_fkey";
-- ALTER TABLE "pre_agreement_associations" ADD CONSTRAINT "pre_agreement_associations_serviceRecordId_fkey"
--   FOREIGN KEY ("serviceRecordId") REFERENCES "service_records" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
