-- The practice list must project what the practice list can be searched by.
--
-- The search box matches on name, ABN, and the CONTACT details of both named
-- people -- because that is what somebody actually has to hand when they are
-- looking for a clinic: a mobile number from a missed call, an address from an
-- email thread. None of those columns were projected, so the search could only
-- ever match a name.
--
-- Same failure as adminEmailVerifiedAt on the review queue, by the same route:
-- the value existed in every layer except the one that reads it. Adding a
-- column that a screen searches or filters by now means checking this function.
--
-- These are the practice's OWN contacts, shown on the practice's own list.
-- Nothing here crosses a tenant boundary once the list is scoped by session,
-- and no provider number appears -- those never belong in a list at all.

DROP FUNCTION IF EXISTS list_organisations(text);

CREATE FUNCTION list_organisations(p_state text)
RETURNS TABLE (
  id uuid, name text, abn text, acn text, "legalName" text,
  "tradingNames" text[], "entityType" text, "abnStatus" text,
  "nameMatchTier" text, "nameMatchedOn" text, "createdAt" timestamp(3),
  "abnVerificationSource" text, "abnSightedByName" text,
  "validationState" text, "validatedByName" text, "validatedAt" timestamp(3),
  "adminName" text, "adminEmail" text, "adminPhone" text,
  "managerName" text, "managerEmail" text, "managerPhone" text,
  "locationCount" bigint, "activeLocationCount" bigint
) AS $$
  SELECT p."id", p."name", p."abn", p."acn", p."legalName", p."tradingNames",
         p."entityType", p."abnStatus", p."nameMatchTier", p."nameMatchedOn", p."createdAt",
         p."abnVerificationSource", p."abnSightedByName",
         p."validationState", p."validatedByName", p."validatedAt",
         p."adminName", p."adminEmail", p."adminPhone",
         p."managerName", p."managerEmail", p."managerPhone",
         (SELECT count(*) FROM "practice_locations" l WHERE l."practiceId" = p."id"),
         (SELECT count(*) FROM "practice_locations" l WHERE l."practiceId" = p."id" AND l."active")
  FROM "practices" p
  -- Only rows that actually applied. Dev-seed and fixture practices never did.
  WHERE p."abnVerifiedAt" IS NOT NULL
    AND (p_state = 'all' OR p."validationState" = p_state)
  ORDER BY p."createdAt" DESC;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION list_organisations(text) TO aob_app;
