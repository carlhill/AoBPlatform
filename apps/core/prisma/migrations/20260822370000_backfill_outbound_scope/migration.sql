-- Backfill the scope and recipient columns on messages queued before they
-- existed.
--
-- WHY BOTHER, rather than letting old rows stay blank. Filters that return
-- nothing for most of the table do not read as "these are old rows" -- they
-- read as broken, and the first support call using them would be answered
-- wrongly. 39 of 42 rows had no site and no recipient, which is exactly enough
-- to make somebody distrust the screen.
--
-- Everything below is DERIVED FROM EXISTING RECORDS, never invented. Where a
-- value cannot be derived it stays NULL, because a guessed recipient on a
-- statutory notice is worse than an honest blank.

-- Affiliation notices: the affiliation already knows the site and the person.
UPDATE "outbound_items" o
SET
  "locationId"    = a."locationId",
  "departmentId"  = a."departmentId",
  "recipientType" = 'practitioner',
  "recipientId"   = a."practitionerId",
  "recipientName" = NULLIF(TRIM(BOTH ', ' FROM CONCAT_WS(', ', p."familyName", p."givenNames")), '')
FROM "affiliations" a
JOIN "practitioners" p ON p."id" = a."practitionerId"
WHERE o."subjectType" = 'Affiliation'
  AND o."subjectId" = a."id"
  AND o."recipientId" IS NULL;

-- Acting-as notices go to the practice itself, not to a person. Recorded as
-- such rather than left blank: "who was told" is the whole point of that
-- message, and the answer is "the practice".
UPDATE "outbound_items" o
SET
  "recipientType" = 'practice',
  "recipientId"   = o."practiceId",
  "recipientName" = COALESCE(pr."tradingNames"[1], pr."legalName", pr."name")
FROM "practices" pr
WHERE o."subjectType" = 'ActingAsSession'
  AND pr."id" = o."practiceId"
  AND o."recipientId" IS NULL;
