-- Artefacts keep `practiceId` for RLS scoping, but lose the foreign key.
--
-- WHY. An artefact is append-only evidence: it cannot be deleted, only
-- tombstoned, so that a record of what existed and who supplied it survives.
-- Combine that with a foreign key and the consequence is one nobody chose:
-- the PRACTICE becomes undeletable too, forever, because a child row exists
-- that by construction can never be removed.
--
-- That surfaced immediately — the test suites could no longer clean up after
-- themselves — but the same trap would have appeared in production the first
-- time anyone tried to remove a rejected application that had uploaded a
-- document.
--
-- The general rule, and the reason `enrolment_ceremonies` was already built
-- this way: APPEND-ONLY EVIDENCE MUST NOT BE PINNED BY REFERENTIAL INTEGRITY
-- TO A DELETABLE PARENT. Evidence outlives its subject on purpose; a foreign
-- key inverts that and makes the subject a hostage to its own evidence.
--
-- `practiceId` remains, indexed and enforced by the RLS policy, so scoping is
-- unchanged. What is given up is the database guaranteeing the practice still
-- exists — which is exactly the guarantee we do not want here.

ALTER TABLE "artefacts" DROP CONSTRAINT IF EXISTS "artefacts_practiceId_fkey";

-- `practice_credentials` KEEPS its foreign key, deliberately. A credential is
-- current state, not evidence: it says what a practice claims today. It has no
-- meaning without the practice, and deleting it alongside is correct. The
-- evidence that a credential was verified lives in the vault, which is not
-- deleted with anything.
