-- Contact independence, extended from email to telephone.
--
-- The two-contact rule exists to give a reviewer somebody to call who is not
-- the applicant. The database already refused a shared EMAIL. It did not refuse
-- a shared PHONE, so one person could name themselves twice — invent a
-- colleague, reuse their own mobile — and the strongest cheap control in
-- onboarding quietly became decorative. Observed in a real application:
-- adminPhone and managerPhone both 0408169971.
--
-- The application layer refuses this first and with a better message. This is
-- the BACKSTOP: the service can be bypassed by anything that writes to the
-- table, and a control that only lives above the database is a convention.
--
-- Comparison is on a normalised value, because these are one telephone:
--
--     0408 169 971    +61 408 169 971    (04) 0816-9971    0408169971
--
-- The normaliser must agree with normalisePhone() in packages/domain/src/
-- contacts.ts. It is IMMUTABLE so it can be used in a CHECK constraint.

CREATE OR REPLACE FUNCTION normalise_au_phone(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  -- Order matches the TypeScript: strip non-digits (keeping a leading +),
  -- rewrite the international prefix to a national 0, then collapse the
  -- doubled zero that rewrite can produce.
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(COALESCE(value, ''), '[^0-9+]', '', 'g'),
             '^(\+?61|0061)', '0'
           ),
           '^00+', '0'
         );
$$;

ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS practices_manager_is_a_different_person;

-- One constraint covering both channels, so a single violation name means one
-- thing: these two contacts are not independently reachable.
ALTER TABLE "practices" ADD CONSTRAINT practices_manager_is_a_different_person
  CHECK (
    (
      "managerEmail" IS NULL
      OR "adminEmail" IS NULL
      OR lower(btrim("managerEmail")) <> lower(btrim("adminEmail"))
    )
    AND (
      "managerPhone" IS NULL
      OR "adminPhone" IS NULL
      OR btrim("managerPhone") = ''
      OR btrim("adminPhone") = ''
      OR normalise_au_phone("managerPhone") <> normalise_au_phone("adminPhone")
    )
  )
  -- NOT VALID: applications submitted BEFORE this rule existed are left in
  -- place rather than deleted or quietly edited. An application whose two
  -- contacts share a handset is precisely what the human reviewer is there to
  -- catch, and rewriting the evidence to fit a later rule would destroy the
  -- thing under review. New and updated rows are fully constrained from here.
  --
  -- To validate once the queue is clear:
  --   ALTER TABLE "practices" VALIDATE CONSTRAINT practices_manager_is_a_different_person;
  NOT VALID;
