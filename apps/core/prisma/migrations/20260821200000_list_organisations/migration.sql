-- A platform operator needs to find a practice they have already approved.
--
-- Until now they could not: an approved organisation leaves the pending queue,
-- and RLS scopes `practices` to one tenant, so there was no way back to it
-- except reading the database by hand. That is a missing capability, not a
-- security posture — the person who approves practices is precisely the person
-- entitled to see the list of them.
--
-- WHY THIS IS NOT THE SAME CALL AS THE PRACTITIONER DIRECTORY, which refuses
-- to be enumerated: a practitioner is a private individual whose presence on
-- this platform is not public, and any practice admin could have queried it.
-- The organisation list is OUR customer list, readable by OUR operators, and
-- it carries no patient data, no agreements, no evidence and no provider
-- numbers. Different asset, different audience, different answer.
--
-- It is still platform-operator territory, and it is covered by the same
-- AUTH_ENFORCE release gate as everything else.

CREATE FUNCTION list_organisations(p_state text)
RETURNS TABLE (
  id uuid, name text, abn text, acn text, "legalName" text,
  "tradingNames" text[], "entityType" text, "abnStatus" text,
  "nameMatchTier" text, "nameMatchedOn" text, "createdAt" timestamp(3),
  "abnVerificationSource" text, "abnSightedByName" text,
  "validationState" text, "validatedByName" text, "validatedAt" timestamp(3),
  "locationCount" bigint, "activeLocationCount" bigint
) AS $$
  SELECT p."id", p."name", p."abn", p."acn", p."legalName", p."tradingNames",
         p."entityType", p."abnStatus", p."nameMatchTier", p."nameMatchedOn", p."createdAt",
         p."abnVerificationSource", p."abnSightedByName",
         p."validationState", p."validatedByName", p."validatedAt",
         (SELECT count(*) FROM "practice_locations" l WHERE l."practiceId" = p."id"),
         (SELECT count(*) FROM "practice_locations" l WHERE l."practiceId" = p."id" AND l."active")
  FROM "practices" p
  -- Only rows that actually applied. Dev-seed and fixture practices never did.
  WHERE p."abnVerifiedAt" IS NOT NULL
    AND (p_state = 'all' OR p."validationState" = p_state)
  ORDER BY p."createdAt" DESC;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION list_organisations(text) TO aob_app;
