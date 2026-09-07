-- The two identity dashboards (IDENTITY-STRENGTH-DESIGN.md 7).
--
-- WHY SECURITY DEFINER, WRITTEN DOWN AS CONVENTIONS.md 6 REQUIRES.
--
-- These answer a question no tenant can ask: "across every practice on the
-- platform, whose verification is going stale and which applications are stuck,
-- and on what". A platform operator has no practice context by definition --
-- the console is cross-tenant, which is the whole point of it -- so RLS cannot
-- express this, because there is no single app.practice_id that would be
-- correct.
--
-- WHAT KEEPS THEM NARROW:
--
--   1. They are READ ONLY. Nothing here updates anything.
--   2. They return the fields the dashboards render and no more. In particular
--      practitioner_identity_rows carries NO PROVIDER NUMBER: that is the
--      artefact the REQ-PKI family exists to protect, it is not needed to
--      answer "is this identity strong", and a cross-practice view is exactly
--      where it must not appear.
--   3. They carry no patient data of any kind.
--   4. The SCORING is not here. These return raw facts; the weights and the
--      decay live in the domain package with tests, so there is one
--      implementation of what a score means rather than one in SQL and another
--      in TypeScript that quietly disagree.
--
-- The route in front of them requires the platform_admin role.

DROP FUNCTION IF EXISTS practice_identity_rows();
DROP FUNCTION IF EXISTS practice_identity_checks();
-- BOTH signatures. This one gained a parameter after its first draft, and
-- dropping only the no-argument form makes the migration succeed once and
-- fail on every re-run with "function already exists" -- which is how a
-- migration that worked in development bricks a deploy.
DROP FUNCTION IF EXISTS practitioner_identity_rows();
DROP FUNCTION IF EXISTS practitioner_identity_rows(timestamptz);

-- One row per practice: the application, and what has been established about it.
CREATE FUNCTION practice_identity_rows()
RETURNS TABLE (
  "id" uuid,
  "name" text,
  "legalName" text,
  "abn" text,
  "abnStatus" text,
  "entityType" text,
  "validationState" text,
  "validatedByName" text,
  "validatedAt" timestamptz,
  "createdAt" timestamptz,
  "adminEmailVerifiedAt" timestamptz,
  "state" text,
  "artefactCount" bigint,
  "locationCount" bigint,
  "activeLocationCount" bigint,
  "credentialCount" bigint,
  "verifiedCredentialCount" bigint,
  "affiliationCount" bigint,
  "activeAffiliationCount" bigint
) AS $fn$
  SELECT
    p."id", p."name", p."legalName", p."abn", p."abnStatus", p."entityType",
    p."validationState", p."validatedByName", p."validatedAt", p."createdAt",
    p."adminEmailVerifiedAt",
    -- The head-office state, for the state filter in 7.
    (SELECT l."state" FROM "practice_locations" l WHERE l."practiceId" = p."id" ORDER BY l."createdAt" LIMIT 1),
    (SELECT count(*) FROM "artefacts" a WHERE a."practiceId" = p."id"),
    (SELECT count(*) FROM "practice_locations" l WHERE l."practiceId" = p."id"),
    (SELECT count(*) FROM "practice_locations" l WHERE l."practiceId" = p."id" AND l."active"),
    (SELECT count(*) FROM "practice_credentials" c WHERE c."practiceId" = p."id"),
    (SELECT count(*) FROM "practice_credentials" c WHERE c."practiceId" = p."id" AND c."verifiedAt" IS NOT NULL),
    (SELECT count(*) FROM "affiliations" af WHERE af."practiceId" = p."id"),
    (SELECT count(*) FROM "affiliations" af WHERE af."practiceId" = p."id" AND af."status" IN ('active','ending'))
  FROM "practices" p
  ORDER BY p."createdAt" DESC;
$fn$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Every check ever recorded, across every practice.
--
-- RAW ROWS, not a score. Checks are append-only and a key may have been
-- performed several times; deciding which one counts is summariseChecks() in
-- the domain, and it stays there.
CREATE FUNCTION practice_identity_checks()
RETURNS TABLE (
  "practiceId" uuid,
  "checkKey" text,
  "outcome" text,
  "performedAt" timestamptz,
  "performedByName" text,
  "reasonCode" text,
  "note" text
) AS $fn$
  SELECT c."practiceId", c."checkKey", c."outcome", c."performedAt", c."performedByName",
         c."reasonCode", c."note"
  FROM "practice_checks" c
  ORDER BY c."performedAt" ASC;
$fn$ LANGUAGE sql SECURITY DEFINER STABLE;

-- One row per practitioner, across every practice.
--
-- NOTE WHAT IS ABSENT AND WHY. There is no provider number here, and there
-- never will be: it is the artefact the REQ-PKI family exists to protect, a
-- cross-practice view is precisely where it must not appear, and it answers
-- nothing about identity strength anyway. There is no practice name either --
-- "which practices does this doctor work at" is a different question from
-- "how well do we know this doctor", and only counts are needed for the second.
--
-- The email is absent too. The dashboard needs to know whether an address has
-- been PROVEN, which is a boolean, not what the address is.
CREATE FUNCTION practitioner_identity_rows(p_velocity_since timestamptz)
RETURNS TABLE (
  "id" uuid,
  "ahpraNumber" text,
  "familyName" text,
  "givenNames" text,
  "providerType" text,
  "profession" text,
  "registrationStatus" text,
  "registrationSightedAt" timestamptz,
  "registrationSightedByName" text,
  "registrationSource" text,
  "verifiedAt" timestamptz,
  "passkeyEnrolledAt" timestamptz,
  "deregisteredAt" timestamptz,
  "hasEmail" boolean,
  "hasRestrictions" boolean,
  "principalSuburb" text,
  "principalState" text,
  "affiliationCount" bigint,
  "activeAffiliationCount" bigint,
  "affiliationsInWindow" bigint,
  "acceptedByPasskey" bigint,
  "acceptedByEmail" bigint,
  "createdAt" timestamptz
) AS $fn$
  SELECT
    pr."id", pr."ahpraNumber", pr."familyName", pr."givenNames", pr."providerType",
    pr."profession", pr."registrationStatus", pr."registrationSightedAt",
    pr."registrationSightedByName", pr."registrationSource",
    pr."verifiedAt", pr."passkeyEnrolledAt", pr."deregisteredAt",
    pr."email" IS NOT NULL,
    -- Registered and unrestricted are different things, and this is the line
    -- most easily skimmed past. "None" is a real and common register value.
    (
      COALESCE(NULLIF(lower(trim(pr."conditions")), 'none'), '') <> ''
      OR COALESCE(NULLIF(lower(trim(pr."undertakings")), 'none'), '') <> ''
      OR COALESCE(NULLIF(lower(trim(pr."reprimands")), 'none'), '') <> ''
    ),
    pr."principalSuburb", pr."principalState",
    (SELECT count(*) FROM "affiliations" a WHERE a."practitionerId" = pr."id"),
    (SELECT count(*) FROM "affiliations" a WHERE a."practitionerId" = pr."id" AND a."status" IN ('active','ending')),
    -- REQ-ANOM-01: the RATE, not the total. Working across several practices is
    -- ordinary; going from two to thirty in a week is worth a human looking.
    (SELECT count(*) FROM "affiliations" a WHERE a."practitionerId" = pr."id" AND a."invitedAt" >= p_velocity_since),
    (SELECT count(*) FROM "affiliations" a WHERE a."practitionerId" = pr."id" AND a."acceptanceMethod" = 'passkey'),
    (SELECT count(*) FROM "affiliations" a WHERE a."practitionerId" = pr."id" AND a."acceptanceMethod" = 'email_link_and_code'),
    pr."createdAt"
  FROM "practitioners" pr
  ORDER BY pr."familyName" ASC, pr."givenNames" ASC;
$fn$ LANGUAGE sql SECURITY DEFINER STABLE;
