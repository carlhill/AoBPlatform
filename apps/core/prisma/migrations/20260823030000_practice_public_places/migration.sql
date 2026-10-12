-- The practice's places, for somebody who works there.
--
-- WHICH LOCATIONS, and the reasoning matters more than the query.
--
-- A practitioner sees ALL of the practice's active locations, not only the ones
-- they personally work at. A location's address is already printed on
-- patient-facing notices — it is the practice's published place of business,
-- not a confidence — and somebody needing to ring another site of their own
-- practice is an ordinary need. Restricting it to their own sites would make
-- the page useless for the thing it exists for.
--
-- WHAT THE HARD RULES ACTUALLY PROTECT is who works where: provider numbers,
-- and any listing that lets somebody assemble a practitioner directory. Not
-- where a practice is.
--
-- WHICH MAKES THE DANGEROUS PART WHAT IS ATTACHED TO EACH LOCATION. "Locations,
-- and who is at each" is exactly the directory we forbid — so this returns
-- locations, their departments, and nothing about people. No affiliations, no
-- practitioner names, no provider numbers, and no counts of them either: a
-- count is a fact about staffing that a practitioner has no need for and that
-- becomes a signal when compared across practices.
--
-- ACTIVE ONLY. The page answers "how do I contact them", and a closed site is
-- not a contact route. History belongs on a different screen with dates on it.

CREATE OR REPLACE FUNCTION core.practice_places_for_practitioner(
  p_practitioner_id uuid,
  p_practice_id     uuid
)
RETURNS TABLE (
  "locationId"      uuid,
  "code"            text,
  "address"         text,
  "addressLine1"    text,
  "addressLine2"    text,
  "suburb"          text,
  "state"           text,
  "postcode"        text,
  "country"         text,
  "departmentId"    uuid,
  "departmentName"  text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT
    l."id", l."code", l."address",
    l."addressLine1", l."addressLine2", l."suburb", l."state", l."postcode", l."country",
    d."id", d."name"
  FROM core.practice_locations l
  -- LEFT, because a location with no departments is a location, and dropping
  -- it would silently hide a whole site from somebody looking for its address.
  LEFT JOIN core.departments d ON d."locationId" = l."id" AND d."active" = true
  WHERE l."practiceId" = p_practice_id
    AND l."active" = true
    -- The same affiliation test as the practice details themselves: this can
    -- only ever be asked about a practice the caller actually works at, and an
    -- ENDED affiliation still counts because somebody chasing something from
    -- last year still needs the address.
    AND EXISTS (
      SELECT 1 FROM core.affiliations a
      WHERE a."practiceId" = p_practice_id AND a."practitionerId" = p_practitioner_id
    )
  ORDER BY l."code" NULLS LAST, l."address", d."name" NULLS FIRST;
$$;
