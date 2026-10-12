-- The practice's PUBLIC contact details.
--
-- WHY THESE DID NOT EXIST. Every address on `practices` so far belongs to
-- somebody or something internal:
--
--   adminEmail / adminPhone  a HUMAN who holds the practice-admin role, and the
--                            address a credential enrols against
--   managerEmail / Phone     a second named human, for FR-1.9 independence
--   groupEmail               an internal shared mailbox for our notices, with
--                            nothing enrolling against it
--
-- None of those is "how do I contact this practice". Showing a practitioner the
-- administrator's personal address because it was the only one to hand would be
-- publishing a person's contact details to answer a question about a business —
-- and it is the address that holds their sign-in.
--
-- So: two fields that are PUBLIC by design. Safe to show a practitioner who
-- works there, and safe to show a patient when patient access arrives, because
-- they are the business's own published details rather than anybody's personal
-- ones.
--
-- OPTIONAL, deliberately. A practice that has not filled them in should show
-- nothing rather than fall back to a private address — the fallback is exactly
-- the mistake this exists to prevent, and it would be invisible.

ALTER TABLE "practices"
  ADD COLUMN "businessPhone" TEXT,
  ADD COLUMN "businessEmail" TEXT;

COMMENT ON COLUMN "practices"."businessPhone" IS
  'PUBLIC. The number a patient or practitioner would ring. Never adminPhone, which identifies a person.';

COMMENT ON COLUMN "practices"."businessEmail" IS
  'PUBLIC. The address a patient or practitioner would write to. Never adminEmail, which holds a credential, '
  'and never groupEmail, which is an internal notices mailbox.';

/*
 * WHAT A PRACTITIONER MAY SEE ABOUT A PRACTICE THEY WORK AT.
 *
 * They have no practice claim -- their scope is their affiliations -- so RLS is
 * fail-closed against them here, and the practice-scoped functions cannot
 * express "the practices I am affiliated with".
 *
 * Same shape and justification as the other pre-tenant functions
 * (CONVENTIONS.md section 6): keyed on the practitioner's own id, returning one
 * row only for a practice they are ACTUALLY AFFILIATED WITH.
 *
 * THE PROJECTION IS THE POINT. It returns the business's published details and
 * nothing else -- no administrator, no manager, no other practitioners, no
 * application, no verification state. Working somewhere does not make somebody
 * a reader of that practice's record, and the way to guarantee that is to not
 * select the columns rather than to remember not to show them.
 */
CREATE OR REPLACE FUNCTION core.practice_public_for_practitioner(
  p_practitioner_id uuid,
  p_practice_id     uuid
)
RETURNS TABLE (
  "id"            uuid,
  "name"          text,
  "legalName"     text,
  "tradingNames"  text[],
  "abn"           text,
  "website"       text,
  "businessPhone" text,
  "businessEmail" text,
  "headOfficeLine1"    text,
  "headOfficeLine2"    text,
  "headOfficeSuburb"   text,
  "headOfficeState"    text,
  "headOfficePostcode" text,
  "headOfficeCountry"  text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT
    p."id", p."name", p."legalName", p."tradingNames", p."abn", p."website",
    p."businessPhone", p."businessEmail",
    p."headOfficeLine1", p."headOfficeLine2", p."headOfficeSuburb",
    p."headOfficeState", p."headOfficePostcode", p."headOfficeCountry"
  FROM core.practices p
  WHERE p."id" = p_practice_id
    -- AFFILIATED, and not merely "has heard of". An ended affiliation still
    -- counts: somebody who worked there last year may legitimately need the
    -- practice's details to chase something from that time.
    AND EXISTS (
      SELECT 1 FROM core.affiliations a
      WHERE a."practiceId" = p."id" AND a."practitionerId" = p_practitioner_id
    )
  LIMIT 1;
$$;
