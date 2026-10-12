-- The telehealth consultation ID (Carl, 12 Oct 2026, DECISIONS.md D-2026-10-12-03 item 11):
-- TH- and two groups of four from Crockford's base 32, unique across the platform. Generated in
-- core (packages/domain telehealthConsultationId); existing rows are backfilled here.
-- Safe to apply twice.
ALTER TABLE "telehealth_sessions" ADD COLUMN IF NOT EXISTS "consultationId" TEXT;

UPDATE "telehealth_sessions" s
SET "consultationId" = 'TH-' || substr(r.code, 1, 4) || '-' || substr(r.code, 5, 4)
FROM (
  SELECT t."id",
         (SELECT string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', 1 + floor(random() * 32)::int, 1), '')
            FROM generate_series(1, 8) g
           WHERE t."id" IS NOT NULL) AS code
    FROM "telehealth_sessions" t
   WHERE t."consultationId" IS NULL
) r
WHERE s."id" = r."id";

ALTER TABLE "telehealth_sessions" ALTER COLUMN "consultationId" SET NOT NULL;

ALTER TABLE "telehealth_sessions" DROP CONSTRAINT IF EXISTS "telehealth_sessions_consultation_id_shape";
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_consultation_id_shape"
  CHECK ("consultationId" ~ '^TH-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$');

DROP INDEX IF EXISTS "telehealth_sessions_practiceId_consultationId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "telehealth_sessions_consultationId_key"
  ON "telehealth_sessions" ("consultationId");