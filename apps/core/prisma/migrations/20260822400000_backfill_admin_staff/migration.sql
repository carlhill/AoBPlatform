-- Give every practice that already has an administrator ACCOUNT a matching
-- staff row.
--
-- WHY IT WAS MISSING. The account is created in Keycloak and its id stored on
-- the practice (`adminKeycloakUserId`). Nothing wrote a staff_members row,
-- because until /practice/users existed there was no list for it to be on.
--
-- The consequence was a screen contradicting the system it is a view of:
-- "no administrator" for a practice that plainly had one, with a live passkey.
--
-- It also quietly emptied a rule. The domain caps administrator accounts at
-- exactly one per practice, and that cap counts staff rows with
-- consoleRole = 'admin'. With none of them existing, the cap was counting
-- nothing and would have allowed a second.

INSERT INTO "staff_members" ("id", "practiceId", "name", "email", "role", "consoleRole", "keycloakUserId", "invitedAt", "active")
SELECT
  gen_random_uuid(),
  p."id",
  COALESCE(p."adminName", 'Practice administrator'),
  p."adminEmail",
  -- What they DO at the practice, kept separate from what they may do in
  -- AoBPlatform so console access is never granted by describing somebody.
  'practice_manager',
  'admin',
  p."adminKeycloakUserId",
  p."adminInvitedAt",
  true
FROM "practices" p
WHERE p."adminKeycloakUserId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "staff_members" s
    WHERE s."practiceId" = p."id" AND s."consoleRole" = 'admin'
  );
