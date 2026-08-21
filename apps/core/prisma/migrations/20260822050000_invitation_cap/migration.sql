-- AlterTable
ALTER TABLE "practices" ADD COLUMN     "contractedInvitationCap" INTEGER,
ADD COLUMN     "statedPractitionerCount" INTEGER;

-- Sanity bounds. The real cap arithmetic lives in the domain layer, where it
-- can be reasoned about and tested; these only stop nonsense reaching a column.
ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS practices_stated_headcount_sane;
ALTER TABLE "practices" ADD CONSTRAINT practices_stated_headcount_sane
  CHECK ("statedPractitionerCount" IS NULL
      OR ("statedPractitionerCount" >= 0 AND "statedPractitionerCount" <= 5000));

-- A contracted cap is set by US, for hospitals and larger groups. It is the
-- only way past the default ceiling, which is why it is a separate column
-- rather than a bigger number in the one the applicant fills in.
ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS practices_contracted_cap_sane;
ALTER TABLE "practices" ADD CONSTRAINT practices_contracted_cap_sane
  CHECK ("contractedInvitationCap" IS NULL
      OR ("contractedInvitationCap" > 0 AND "contractedInvitationCap" <= 10000));
