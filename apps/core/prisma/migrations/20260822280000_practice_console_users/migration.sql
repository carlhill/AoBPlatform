-- Console access for practice staff, and the inactivity lifecycle.
--
-- WHY THIS SITS ON staff_members RATHER THAN A NEW TABLE. There was already a
-- record meaning "a person at this practice", with keycloakUserId, invitedAt
-- and passkeyEnrolledAt on it. A second table meaning the same thing would
-- drift from it, and the assignor block (REQ-VUL-04) would then check only one
-- of the two — which is the kind of gap that is invisible until it matters.
--
-- consoleRole is SEPARATE from role. `role` says what somebody does at the
-- practice; consoleRole says what they may do in AoBPlatform. NULL means no
-- sign-in access, which is the default: a staff record is not an account until
-- somebody deliberately makes it one. Every existing row therefore keeps
-- exactly the access it has today, which is none.

ALTER TABLE "staff_members"
  ADD COLUMN "consoleRole"        TEXT,
  ADD COLUMN "locationId"         UUID,
  ADD COLUMN "departmentId"       UUID,
  ADD COLUMN "lastSignInAt"       TIMESTAMP(3),
  ADD COLUMN "inactivityWarnedAt" TIMESTAMP(3),
  ADD COLUMN "deactivatedAt"      TIMESTAMP(3),
  ADD COLUMN "deactivatedReason"  TEXT,
  ADD COLUMN "deactivatedByName"  TEXT;

-- The console-user list, and the cap count, are the two reads every screen
-- makes. Partial: rows with no console role are not console users and are the
-- majority.
CREATE INDEX "staff_members_console_idx"
  ON "staff_members" ("practiceId", "consoleRole")
  WHERE "consoleRole" IS NOT NULL;

-- The lifecycle sweep asks "who is quiet and not yet withdrawn".
CREATE INDEX "staff_members_inactivity_idx"
  ON "staff_members" ("lastSignInAt")
  WHERE "consoleRole" IS NOT NULL AND "deactivatedAt" IS NULL;
