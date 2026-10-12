-- M8 — THE PATIENT'S OWN PAGE (C8; REQ-PORT-01..08, FR-8.1/8.2, FR-1.14,
-- FR-1.19/-1.23, FR-5.3). TODO.md "The patient's own page", Carl 4 Sep 2026.
--
-- Carl's question was "a patient will want to know what we do with all their
-- data". C8 is the answer, and it is a GA MUST with statutory sections behind
-- two of its cards — the artefact copy (s 65C copy-on-request) and enduring
-- termination (65CA(7)(b)).
--
-- THE SHAPE OF THE WHOLE THING, in one paragraph, because the table list on its
-- own does not explain it. A portal ACCOUNT is the hub. It holds nothing about
-- the person — no name, no email, no mobile, no date of birth — because all of
-- that already lives on each practice's own patient row where the PMS is master
-- (REQ-DATA-10) and where the encryption and RLS already are. The patient LINKS
-- their own practices, one at a time, by activating from a signed agreement at
-- that practice after that practice verified them across its own counter. So no
-- practice ever learns another exists, there is no cross-practice identifier
-- anywhere in this migration, and no IHI matching is needed or possible.
--
-- Written to be applied twice (DEV-LOOP.md).

-- ---------------------------------------------------------------------------
-- The account. Almost empty on purpose.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "portal_accounts" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT now(),
  "lastSeenAt" TIMESTAMP(3)
);

-- ---------------------------------------------------------------------------
-- One link per practice the patient activated from.
--
-- `linkedByAgreementId` is the evidence of WHY this account may read this
-- practice's record: the agreement whose invitation produced the link. A link
-- with nothing behind it would be the platform asserting that somebody is a
-- patient, which is the assertion the three-identifier check exists to avoid.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "portal_account_patients" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "accountId"           UUID NOT NULL REFERENCES "portal_accounts"("id"),
  "patientId"           UUID NOT NULL,
  "practiceId"          UUID NOT NULL,
  "linkedAt"            TIMESTAMP(3) NOT NULL DEFAULT now(),
  "linkedByAgreementId" UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS "portal_account_patients_account_patient_key"
  ON "portal_account_patients" ("accountId", "patientId");
CREATE INDEX IF NOT EXISTS "portal_account_patients_accountId_idx"
  ON "portal_account_patients" ("accountId");
CREATE INDEX IF NOT EXISTS "portal_account_patients_practiceId_idx"
  ON "portal_account_patients" ("practiceId");

-- ---------------------------------------------------------------------------
-- Sessions. Short-lived (FR-8.2), server-side, opaque.
--
-- THE COOKIE CARRIES AN ID AND NOTHING ELSE — no claims, no patient ids,
-- nothing a client could edit and nothing a stolen copy could be read for. The
-- row is the session; revoking it is one UPDATE and takes effect on the next
-- request.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "portal_sessions" (
  "id"        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "accountId" UUID NOT NULL REFERENCES "portal_accounts"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "portal_sessions_accountId_idx" ON "portal_sessions" ("accountId");

-- ---------------------------------------------------------------------------
-- FR-1.14 — the activation invitation. Offered after a completed signature,
-- never required (REQ-PORT-08).
--
-- ONLY THE HASH IS STORED, exactly as capture links do, so a database read
-- cannot mint a working invitation. And the token is NOT the door: activation
-- also demands the three approved identifiers against that agreement's own
-- practice. That is the family-phone rule made structural — a parent and a 14+
-- child sharing one mobile must not be able to open each other's records by
-- forwarding a message (REQ-VUL, addendum v4).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "portal_activation_tokens" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId"  UUID NOT NULL,
  "agreementId" UUID NOT NULL,
  "patientId"   UUID NOT NULL,
  "tokenHash"   TEXT NOT NULL,
  "mintedById"  TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT now(),
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "usedAt"      TIMESTAMP(3),
  "attempts"    INTEGER NOT NULL DEFAULT 0,
  "lockedAt"    TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "portal_activation_tokens_tokenHash_key"
  ON "portal_activation_tokens" ("tokenHash");
CREATE INDEX IF NOT EXISTS "portal_activation_tokens_practiceId_idx"
  ON "portal_activation_tokens" ("practiceId");
CREATE INDEX IF NOT EXISTS "portal_activation_tokens_agreementId_idx"
  ON "portal_activation_tokens" ("agreementId");

-- ---------------------------------------------------------------------------
-- REQ-PORT-05 — the written notice a termination generates.
--
-- ITS OWN TABLE AND NOT `notices`. That table is the reg 89AA one: it requires
-- a claim reference, a claim lodgement time and a benefit amount, because a
-- post-claim notification is what it is for. A termination notice has none of
-- those, and writing one there would mean inventing a benefit amount for a
-- document that must not carry one (hard rule 4).
--
-- EVERY ROW IS A DRAFT, enforced below rather than left to the service. The
-- wording is human-authored regulatory copy and the content file ships empty
-- and marked draft; a review task is raised beside every row. The TERMINATION
-- is not held up by that — the statutory clock starts at notice and the
-- patient's right does not wait on our copywriting.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "portal_termination_notices" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId"      UUID NOT NULL,
  "agreementId"     UUID NOT NULL,
  "accountId"       UUID NOT NULL,
  "templateKey"     TEXT NOT NULL,
  "templateVersion" TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'draft_pending_review',
  "noticeAt"        TIMESTAMP(3) NOT NULL,
  "effectiveAt"     TIMESTAMP(3) NOT NULL,
  "calendarState"   TEXT NOT NULL,
  "reviewTaskId"    UUID,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "portal_termination_notices_agreementId_key"
  ON "portal_termination_notices" ("agreementId");
CREATE INDEX IF NOT EXISTS "portal_termination_notices_practiceId_idx"
  ON "portal_termination_notices" ("practiceId");

-- ---------------------------------------------------------------------------
-- FR-1.23 — the patient removes an assignor, with no justification.
--
-- A ROW RATHER THAN A COLUMN ON `assignors`, for two reasons. Revocation is per
-- PATIENT: one assignor may act for two people, and being removed by one of
-- them says nothing about the other. And it is an act with a time, which a
-- boolean cannot hold — "she was removed in March" and "she was never
-- nominated" are different histories, and only one of them is true.
--
-- THERE IS NO REASON COLUMN AND THERE MUST NEVER BE ONE. FR-1.23 says the
-- patient owes no justification. A nullable field for one becomes a question on
-- a screen, and then a required question.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "portal_assignor_revocations" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId" UUID NOT NULL,
  "accountId"  UUID NOT NULL,
  "assignorId" UUID NOT NULL,
  "patientId"  UUID NOT NULL,
  "revokedAt"  TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "portal_assignor_revocations_assignor_patient_key"
  ON "portal_assignor_revocations" ("assignorId", "patientId");
CREATE INDEX IF NOT EXISTS "portal_assignor_revocations_practiceId_idx"
  ON "portal_assignor_revocations" ("practiceId");

DO $$
BEGIN
  -- A SESSION THAT NEVER ENDS IS NOT A SHORT-LIVED SESSION (FR-8.2). The
  -- expiry is NOT NULL above; this stops a caller writing one in the past or
  -- at creation time, which would be a session that is simultaneously issued
  -- and dead — the shape that produces "why does the portal log me straight
  -- out" bug reports and hides a real clock error underneath them.
  ALTER TABLE "portal_sessions" DROP CONSTRAINT IF EXISTS portal_sessions_expires_after_creation;
  ALTER TABLE "portal_sessions" ADD CONSTRAINT portal_sessions_expires_after_creation
    CHECK ("expiresAt" > "createdAt");

  -- AN INVITATION EXPIRES TOO, and a used one has a time. Both halves matter:
  -- REQ-VER-05 wants links short-lived, and `usedAt` is what makes an
  -- invitation single-use rather than a standing key to a record.
  ALTER TABLE "portal_activation_tokens" DROP CONSTRAINT IF EXISTS portal_activation_tokens_expires_after_creation;
  ALTER TABLE "portal_activation_tokens" ADD CONSTRAINT portal_activation_tokens_expires_after_creation
    CHECK ("expiresAt" > "createdAt");

  -- ATTEMPTS ARE COUNTED, NEVER NEGATIVE, and a locked token has been tried.
  -- The lock is the whole of REQ-PORT-08's teeth on this path: three wrong
  -- answers finish the invitation, and a fresh one is a practice act at the
  -- counter rather than something a caller can grind out.
  ALTER TABLE "portal_activation_tokens" DROP CONSTRAINT IF EXISTS portal_activation_tokens_attempts_sane;
  ALTER TABLE "portal_activation_tokens" ADD CONSTRAINT portal_activation_tokens_attempts_sane
    CHECK ("attempts" >= 0 AND ("lockedAt" IS NULL OR "attempts" > 0));

  -- EVERY NOTICE IS A DRAFT, IN THE DATABASE AND NOT ONLY IN THE SERVICE.
  -- The wording is human-authored regulatory copy that does not exist yet; a
  -- row claiming any other status would be a notice somebody could believe had
  -- been reviewed. Widening this list is the same act as writing the copy.
  ALTER TABLE "portal_termination_notices" DROP CONSTRAINT IF EXISTS portal_termination_notices_status_known;
  ALTER TABLE "portal_termination_notices" ADD CONSTRAINT portal_termination_notices_status_known
    CHECK ("status" IN ('draft_pending_review'));

  -- TWO BUSINESS DAYS IS AFTER THE NOTICE, ALWAYS (FR-5.3). A termination
  -- effective before it was given would be a backdated one, which is the one
  -- thing an effect date must never be able to be.
  ALTER TABLE "portal_termination_notices" DROP CONSTRAINT IF EXISTS portal_termination_notices_effective_after_notice;
  ALTER TABLE "portal_termination_notices" ADD CONSTRAINT portal_termination_notices_effective_after_notice
    CHECK ("effectiveAt" > "noticeAt");
END
$$;

-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY — the floor under the application's own scoping.
--
-- THE PORTAL NEEDED A SECOND KEY, and the reason is the same one that made
-- `app.practitioner_id` necessary for practitioners: a portal account is not
-- inside one practice. It spans every practice the patient linked, so a policy
-- written on `app.practice_id` alone would fail closed against the very person
-- the rows are about. So `app.portal_account_id` is the second key, set by
-- `PortalScope` for the length of one transaction (is_local = true, exactly as
-- withPractice does — the scope dies with the transaction and no connection can
-- be left polluted). Policies are OR'd, so the two coexist without either
-- widening the other: a practice still sees its own links, and an account still
-- sees only its own.
--
-- `app.portal_session_id` EXISTS FOR ONE QUERY ONLY: resolving the cookie, when
-- the account is not yet known. It names a single session row by primary key
-- and nothing else, and a request with no cookie sets nothing and therefore
-- sees nothing.
--
-- THESE POLICIES ARE LIVE IN DEVELOPMENT TOO. The service connects as `aob_app`,
-- which holds neither SUPERUSER nor BYPASSRLS; only the migration role does. So
-- the e2e suite exercises the real fence rather than a description of one, and
-- the application-layer filter (every read starts from the account's own links)
-- sits on top of it rather than in place of it.
-- ---------------------------------------------------------------------------
ALTER TABLE "portal_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_accounts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_account_isolation ON "portal_accounts";
CREATE POLICY portal_account_isolation ON "portal_accounts"
  USING ("id" = NULLIF(current_setting('app.portal_account_id', true), '')::uuid)
  WITH CHECK ("id" = NULLIF(current_setting('app.portal_account_id', true), '')::uuid);

ALTER TABLE "portal_account_patients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_account_patients" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_link_isolation ON "portal_account_patients";
CREATE POLICY portal_link_isolation ON "portal_account_patients"
  USING (
    "accountId" = NULLIF(current_setting('app.portal_account_id', true), '')::uuid
    OR "practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid
  )
  WITH CHECK (
    "accountId" = NULLIF(current_setting('app.portal_account_id', true), '')::uuid
    OR "practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid
  );

ALTER TABLE "portal_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_session_isolation ON "portal_sessions";
CREATE POLICY portal_session_isolation ON "portal_sessions"
  USING (
    "accountId" = NULLIF(current_setting('app.portal_account_id', true), '')::uuid
    OR "id" = NULLIF(current_setting('app.portal_session_id', true), '')::uuid
  )
  /*
   * THE SESSION KEY IS ACCEPTED ON WRITE AS WELL AS ON READ, and it has to be:
   * signing out revokes a session found by its cookie, before the account is
   * known. A `WITH CHECK` narrower than the `USING` clause would make every
   * revoke a 500 — the row is visible and the update is refused. The authority
   * is the same either way: `app.portal_session_id` is a 128-bit id held only
   * by the person the session belongs to, and it names exactly one row.
   */
  WITH CHECK (
    "accountId" = NULLIF(current_setting('app.portal_account_id', true), '')::uuid
    OR "id" = NULLIF(current_setting('app.portal_session_id', true), '')::uuid
  );

ALTER TABLE "portal_activation_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_activation_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_isolation ON "portal_activation_tokens";
CREATE POLICY practice_isolation ON "portal_activation_tokens"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

ALTER TABLE "portal_termination_notices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_termination_notices" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_termination_notice_isolation ON "portal_termination_notices";
CREATE POLICY portal_termination_notice_isolation ON "portal_termination_notices"
  USING (
    "practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid
    OR "accountId" = NULLIF(current_setting('app.portal_account_id', true), '')::uuid
  )
  WITH CHECK (
    "practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid
    OR "accountId" = NULLIF(current_setting('app.portal_account_id', true), '')::uuid
  );

ALTER TABLE "portal_assignor_revocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_assignor_revocations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_revocation_isolation ON "portal_assignor_revocations";
CREATE POLICY portal_revocation_isolation ON "portal_assignor_revocations"
  USING (
    "practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid
    OR "accountId" = NULLIF(current_setting('app.portal_account_id', true), '')::uuid
  )
  WITH CHECK (
    "practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid
    OR "accountId" = NULLIF(current_setting('app.portal_account_id', true), '')::uuid
  );

-- Down:
--   DROP TABLE IF EXISTS "portal_assignor_revocations";
--   DROP TABLE IF EXISTS "portal_termination_notices";
--   DROP TABLE IF EXISTS "portal_activation_tokens";
--   DROP TABLE IF EXISTS "portal_sessions";
--   DROP TABLE IF EXISTS "portal_account_patients";
--   DROP TABLE IF EXISTS "portal_accounts";
