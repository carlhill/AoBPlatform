-- AlterTable
ALTER TABLE "practice_locations" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "country" TEXT DEFAULT 'Australia',
ADD COLUMN     "postcode" TEXT,
ADD COLUMN     "suburb" TEXT;

-- AlterTable
ALTER TABLE "practices" ADD COLUMN     "headOfficeCountry" TEXT DEFAULT 'Australia',
ADD COLUMN     "headOfficeLine1" TEXT,
ADD COLUMN     "headOfficeLine2" TEXT,
ADD COLUMN     "headOfficePostcode" TEXT,
ADD COLUMN     "headOfficeSuburb" TEXT;


-- ===========================================================================
-- HAND-AUTHORED HALF: backfill, then the constraints that keep it honest.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Backfill from the single-line addresses already stored.
--
-- The regex mirrors parseSingleLine() in packages/domain/src/address.ts and is
-- anchored at the END, because the tail — SUBURB STATE POSTCODE — is the only
-- reliably ordered part of an Australian address. Everything before it is the
-- street, and where that has two comma-separated parts the FIRST is the
-- unit/level by Australian convention ("Unit 3, 1 Example Street").
--
-- DELIBERATELY LOSSY, AND SILENT ABOUT NOTHING. Anything the pattern cannot
-- place is left NULL for a human rather than guessed at: a confidently wrong
-- suburb is worse than an empty one, because matching is the entire purpose of
-- these columns.
-- ---------------------------------------------------------------------------

WITH parsed AS (
  SELECT
    l."id",
    regexp_match(
      l."address",
      '^(.*?)[,\s]+([A-Za-z'' -]+?)[,\s]+(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)[,\s]+(\d{4})\s*$',
      'i'
    ) AS m
  FROM "practice_locations" l
  WHERE l."addressLine1" IS NULL
)
UPDATE "practice_locations" l
   SET "addressLine2" = CASE
         WHEN array_length(string_to_array(p.m[1], ','), 1) > 1
         THEN btrim((string_to_array(p.m[1], ','))[1])
         ELSE NULL END,
       "addressLine1" = CASE
         WHEN array_length(string_to_array(p.m[1], ','), 1) > 1
         THEN btrim(array_to_string((string_to_array(p.m[1], ','))[2:], ', '))
         ELSE btrim(p.m[1]) END,
       "suburb"   = btrim(p.m[2]),
       "state"    = COALESCE(l."state", upper(p.m[3])),
       "postcode" = p.m[4],
       "country"  = COALESCE(l."country", 'Australia')
  FROM parsed p
 WHERE l."id" = p."id" AND p.m IS NOT NULL;

WITH parsed AS (
  SELECT
    pr."id",
    regexp_match(
      pr."headOfficeAddress",
      '^(.*?)[,\s]+([A-Za-z'' -]+?)[,\s]+(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)[,\s]+(\d{4})\s*$',
      'i'
    ) AS m
  FROM "practices" pr
  WHERE pr."headOfficeLine1" IS NULL AND pr."headOfficeAddress" IS NOT NULL
)
UPDATE "practices" pr
   SET "headOfficeLine2" = CASE
         WHEN array_length(string_to_array(p.m[1], ','), 1) > 1
         THEN btrim((string_to_array(p.m[1], ','))[1])
         ELSE NULL END,
       "headOfficeLine1" = CASE
         WHEN array_length(string_to_array(p.m[1], ','), 1) > 1
         THEN btrim(array_to_string((string_to_array(p.m[1], ','))[2:], ', '))
         ELSE btrim(p.m[1]) END,
       "headOfficeSuburb"   = btrim(p.m[2]),
       "headOfficeState"    = COALESCE(pr."headOfficeState", upper(p.m[3])),
       "headOfficePostcode" = p.m[4],
       "headOfficeCountry"  = COALESCE(pr."headOfficeCountry", 'Australia')
  FROM parsed p
 WHERE pr."id" = p."id" AND p.m IS NOT NULL;

-- ---------------------------------------------------------------------------
-- An ACTIVE location must have a structured address.
--
-- `active` means "may host affiliations", and an affiliation's address is
-- rendered into the s 65C(5)(a) particulars of every agreement captured there.
-- An address we could not structure is one we cannot reliably render or match,
-- so it must not be active.
--
-- Any location the backfill could not parse is therefore DEACTIVATED rather
-- than left active with half an address. That is deliberately visible: the
-- practice is asked to re-enter it in the six fields, which is a small cost
-- against silently carrying an unmatched address into a consent record.
-- ---------------------------------------------------------------------------

UPDATE "practice_locations"
   SET "active" = false
 WHERE "active" = true
   AND (COALESCE(btrim("addressLine1"), '') = ''
     OR COALESCE(btrim("suburb"), '') = ''
     OR COALESCE(btrim("postcode"), '') = '');

ALTER TABLE "practice_locations" DROP CONSTRAINT IF EXISTS locations_active_needs_structured_address;
ALTER TABLE "practice_locations" ADD CONSTRAINT locations_active_needs_structured_address
  CHECK ("active" = false
      OR (COALESCE(btrim("addressLine1"), '') <> ''
          AND COALESCE(btrim("suburb"), '') <> ''
          AND COALESCE(btrim("state"), '') <> ''
          AND COALESCE(btrim("postcode"), '') <> ''));

-- Postcodes are four digits, and leading zeros are real — NT uses 08xx and ACT
-- 02xx. Storing them as text rather than an integer is the whole reason those
-- survive; this only checks the shape.
ALTER TABLE "practice_locations" DROP CONSTRAINT IF EXISTS locations_postcode_shape;
ALTER TABLE "practice_locations" ADD CONSTRAINT locations_postcode_shape
  CHECK ("postcode" IS NULL OR "postcode" ~ '^\d{4}$');

ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS practices_head_office_postcode_shape;
ALTER TABLE "practices" ADD CONSTRAINT practices_head_office_postcode_shape
  CHECK ("headOfficePostcode" IS NULL OR "headOfficePostcode" ~ '^\d{4}$');

-- The state list is closed. Note what is NOT constrained here: the
-- postcode-to-state relationship. Our range table is unverified and new
-- allocations happen, so a mismatch WARNS in the domain layer and is never
-- refused — rejecting a real practice because our list is stale is the worse
-- failure direction.
ALTER TABLE "practice_locations" DROP CONSTRAINT IF EXISTS locations_state_known;
ALTER TABLE "practice_locations" ADD CONSTRAINT locations_state_known
  CHECK ("state" IS NULL OR "state" IN ('NSW','VIC','QLD','SA','WA','TAS','NT','ACT'));

ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS practices_head_office_state_known;
ALTER TABLE "practices" ADD CONSTRAINT practices_head_office_state_known
  CHECK ("headOfficeState" IS NULL OR "headOfficeState" IN ('NSW','VIC','QLD','SA','WA','TAS','NT','ACT'));

-- Matching happens on suburb + postcode constantly (AHPRA locality comparison,
-- G-NAF, ABR agreement), so index them.
CREATE INDEX IF NOT EXISTS practice_locations_locality_idx
  ON "practice_locations" (upper("suburb"), "postcode");
