-- How many times we have written to somebody with a sign-in link.
--
-- WHY COUNT RATHER THAN OVERWRITE `invitedAt`. "We have written to this person
-- four times and they have still never signed in" is a different situation
-- from "we wrote to them yesterday", and it is the one worth acting on: either
-- the address is wrong, or the mail is not arriving, or the person has left.
-- A single timestamp answers when we last tried and hides how hard we have
-- been trying.
--
-- Zero is the honest default for rows that predate this. It is also correct
-- for every row created by `grant`, because adding somebody has never sent
-- them anything -- which was the bug that prompted all of this: the list said
-- "Invited" for people nobody had ever written to.
ALTER TABLE "staff_members"
  ADD COLUMN "invitationsSent" INTEGER NOT NULL DEFAULT 0;

-- Rows that already carry an invitedAt were invited once, before we counted.
-- Not a guess: invitedAt is only ever set by a path that sends.
UPDATE "staff_members" SET "invitationsSent" = 1 WHERE "invitedAt" IS NOT NULL;
