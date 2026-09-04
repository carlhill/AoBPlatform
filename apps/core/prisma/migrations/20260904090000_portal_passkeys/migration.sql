-- FR-8.2 — PASSKEYS FOR THE PATIENT PORTAL (C8; Carl, 4 September 2026:
-- "Implement"). Decision D-2026-09-04-02.
--
-- WHERE THE PASSKEY LIVES, AND WHY IT IS NOT KEYCLOAK. Hard rule 15 makes
-- WebAuthn mandatory for practitioners and admins, and that is what the
-- Keycloak realm is for. A patient is not staff: they have no console login,
-- must never need one (REQ-PORT-08), and the account they do have is the portal
-- account in these tables, with a server-side session core already issues. The
-- thing that binds a credential to a VERIFIED PERSON is the three-identifier
-- bootstrap core performs against a practice's own record — Keycloak has no
-- part in it and could not perform it. A second realm for patients would move
-- patient PII into Keycloak to buy nothing.
--
-- THE ORDER IS BOOTSTRAP FIRST, ALWAYS, AND IT IS STRUCTURAL. Registration is
-- reachable only inside a live portal session, so a credential can only be
-- enrolled by somebody a practice verified across its counter. A passkey
-- enrolled before that check would be bound to whoever was holding the phone —
-- the family-phone failure (REQ-VUL, addendum v4) with a key on the end of it.
--
-- Written to be applied twice (DEV-LOOP.md).

-- ---------------------------------------------------------------------------
-- One credential, one device, one account.
--
-- NO PASSWORD COLUMN AND NO RECOVERY QUESTION, ever. A patient who loses every
-- device re-bootstraps from a fresh invitation at the practice: the same door
-- they came in through, and one that costs them nothing they need, because
-- signing an agreement has never required this page.
--
-- `revokedAt` RATHER THAN A DELETE. "Removed in March" and "never existed" are
-- different histories, and a sign-in attempted with a revoked credential is
-- worth being able to see.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "portal_credentials" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "accountId"    UUID NOT NULL REFERENCES "portal_accounts"("id"),
  -- The authenticator's own credential id, base64url. A discoverable sign-in
  -- arrives with nothing but this, so it is the key the account is resolved
  -- from; two accounts sharing one would be an ambiguity with a session on the
  -- end of it.
  "credentialId" TEXT NOT NULL,
  -- COSE public key bytes. Public by definition. Stored raw because verifying a
  -- signature needs exactly these bytes, and re-encoding them is a way to
  -- produce a verification failure that looks like an attack.
  "publicKey"    BYTEA NOT NULL,
  -- Goes UP or stays put. A value that goes backwards means the credential has
  -- been cloned; the service refuses and writes `portal.passkey_rejected`.
  "counter"      BIGINT NOT NULL DEFAULT 0,
  "transports"   TEXT[] NOT NULL DEFAULT '{}',
  -- The authenticator MODEL id. A device type, never a device instance and
  -- never a person — kept because "every failure is on one model of phone" is
  -- otherwise an unanswerable support question.
  "aaguid"       TEXT NOT NULL DEFAULT '',
  -- The patient's own words for their own device. THE ONLY FREE TEXT HERE, and
  -- never generated from a user agent string, which is a fingerprint dressed up
  -- as a convenience.
  "label"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT now(),
  "lastUsedAt"   TIMESTAMP(3),
  "revokedAt"    TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "portal_credentials_credentialId_key"
  ON "portal_credentials" ("credentialId");
CREATE INDEX IF NOT EXISTS "portal_credentials_accountId_idx"
  ON "portal_credentials" ("accountId");

-- ---------------------------------------------------------------------------
-- The challenge. Five minutes, single use.
--
-- WHY A ROW AND NOT A SIGNED COOKIE OR AN HMAC. The property being bought is
-- that the SECOND use of a challenge fails, and only something the server can
-- SPEND has that property — a stateless token can be presented twice and both
-- presentations verify. `consumedAt` is set by a conditional update, so two
-- requests racing on one challenge produce one winner and one refusal rather
-- than two sessions.
--
-- `accountId` AND `sessionId` ARE SET FOR REGISTRATION AND NULL FOR SIGN-IN,
-- and the asymmetry is the point. Registration happens inside a live session
-- and is bound to it, so a challenge minted for one person cannot be finished
-- by another, or by the same person after they signed out. A sign-in challenge
-- has nobody yet: working out who it was is the signature's job.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "portal_passkey_challenges" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "purpose"    TEXT NOT NULL,
  "challenge"  TEXT NOT NULL,
  "accountId"  UUID,
  "sessionId"  UUID,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT now(),
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "portal_passkey_challenges_challenge_key"
  ON "portal_passkey_challenges" ("challenge");
CREATE INDEX IF NOT EXISTS "portal_passkey_challenges_accountId_idx"
  ON "portal_passkey_challenges" ("accountId");
CREATE INDEX IF NOT EXISTS "portal_passkey_challenges_expiresAt_idx"
  ON "portal_passkey_challenges" ("expiresAt");

DO $$
BEGIN
  -- A CHALLENGE THAT NEVER EXPIRES IS NOT A CHALLENGE. Same reasoning as
  -- `portal_sessions_expires_after_creation`: a row issued already dead, or one
  -- with no clock at all, hides a real timing error under a support ticket.
  ALTER TABLE "portal_passkey_challenges" DROP CONSTRAINT IF EXISTS portal_passkey_challenges_expires_after_creation;
  ALTER TABLE "portal_passkey_challenges" ADD CONSTRAINT portal_passkey_challenges_expires_after_creation
    CHECK ("expiresAt" > "createdAt");

  -- TWO PURPOSES, AND THEY ARE NOT INTERCHANGEABLE. A registration challenge
  -- presented to the sign-in verifier is refused in the service; the constraint
  -- stops a third purpose being spelled into existence by a typo.
  ALTER TABLE "portal_passkey_challenges" DROP CONSTRAINT IF EXISTS portal_passkey_challenges_purpose_known;
  ALTER TABLE "portal_passkey_challenges" ADD CONSTRAINT portal_passkey_challenges_purpose_known
    CHECK ("purpose" IN ('registration', 'authentication'));

  -- REGISTRATION IS BOUND TO A SESSION; SIGN-IN IS BOUND TO NOBODY. Written as
  -- a constraint rather than left to the service, because "registration inside
  -- a live session" is the whole of what makes a credential mean anything, and
  -- a service that forgot to set `accountId` once would produce a credential
  -- bound to whoever finished the ceremony.
  ALTER TABLE "portal_passkey_challenges" DROP CONSTRAINT IF EXISTS portal_passkey_challenges_binding_matches_purpose;
  ALTER TABLE "portal_passkey_challenges" ADD CONSTRAINT portal_passkey_challenges_binding_matches_purpose
    CHECK (
      ("purpose" = 'registration' AND "accountId" IS NOT NULL AND "sessionId" IS NOT NULL)
      OR ("purpose" = 'authentication' AND "accountId" IS NULL AND "sessionId" IS NULL)
    );

  -- A COUNTER IS NEVER NEGATIVE. The regression check lives in the service
  -- because it compares two values; this stops the stored one being nonsense.
  ALTER TABLE "portal_credentials" DROP CONSTRAINT IF EXISTS portal_credentials_counter_not_negative;
  ALTER TABLE "portal_credentials" ADD CONSTRAINT portal_credentials_counter_not_negative
    CHECK ("counter" >= 0);

  -- A LABEL IS THE PATIENT'S OWN WORDS OR IT IS NOTHING. An empty string is a
  -- third state that every screen would then have to handle, and none would.
  ALTER TABLE "portal_credentials" DROP CONSTRAINT IF EXISTS portal_credentials_label_not_blank;
  ALTER TABLE "portal_credentials" ADD CONSTRAINT portal_credentials_label_not_blank
    CHECK ("label" IS NULL OR length(btrim("label")) > 0);
END
$$;

-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY.
--
-- TWO NEW SETTINGS, AND BOTH ARE THE `app.portal_session_id` IDIOM RATHER THAN
-- A NEW ONE. That setting exists because resolving a cookie happens BEFORE the
-- account is known: it names exactly one row by primary key and nothing else.
-- Passkeys have the same shape of problem twice over.
--
--   `app.portal_challenge_id`  names one challenge row by primary key. The
--                              verify call says which challenge it is
--                              finishing, and for a sign-in there is no
--                              account to scope by yet.
--   `app.portal_credential_id` names one credential row by its unique
--                              credential id. A discoverable sign-in arrives
--                              carrying nothing else, and resolving it to an
--                              account is the first thing that must happen.
--
-- WHAT THAT DISCLOSES, SAID PLAINLY. A caller who already holds a credential id
-- can read that credential's PUBLIC key, its counter and its account id. None
-- of those is a patient identifier, none is a name, and none of them lets
-- anybody in: the assertion still has to verify against that public key, and
-- the counter check still has to pass. RLS here is the floor under the
-- application's own scoping, not the thing doing the authenticating — exactly
-- as the session key is.
--
-- LIVE IN DEVELOPMENT TOO. The service connects as `aob_app`, which holds
-- neither SUPERUSER nor BYPASSRLS, so the e2e suite exercises the real fence.
-- ---------------------------------------------------------------------------
ALTER TABLE "portal_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_credentials" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_credential_isolation ON "portal_credentials";
CREATE POLICY portal_credential_isolation ON "portal_credentials"
  USING (
    "accountId" = NULLIF(current_setting('app.portal_account_id', true), '')::uuid
    OR "credentialId" = NULLIF(current_setting('app.portal_credential_id', true), '')
  )
  WITH CHECK (
    "accountId" = NULLIF(current_setting('app.portal_account_id', true), '')::uuid
    OR "credentialId" = NULLIF(current_setting('app.portal_credential_id', true), '')
  );

ALTER TABLE "portal_passkey_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_passkey_challenges" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_passkey_challenge_isolation ON "portal_passkey_challenges";
CREATE POLICY portal_passkey_challenge_isolation ON "portal_passkey_challenges"
  USING (
    "id" = NULLIF(current_setting('app.portal_challenge_id', true), '')::uuid
    OR "accountId" = NULLIF(current_setting('app.portal_account_id', true), '')::uuid
  )
  /*
   * THE CHALLENGE KEY IS ACCEPTED ON WRITE AS WELL AS ON READ, for the reason
   * `portal_sessions` gives: spending a challenge is an UPDATE on a row found
   * by the key the caller presented, and a WITH CHECK narrower than the USING
   * clause turns every verify into a 500 — the row is visible and the update is
   * refused. It is also what lets a sign-in challenge, which has no account, be
   * inserted at all: the service sets the key to the id it just generated.
   */
  WITH CHECK (
    "id" = NULLIF(current_setting('app.portal_challenge_id', true), '')::uuid
    OR "accountId" = NULLIF(current_setting('app.portal_account_id', true), '')::uuid
  );

-- Down:
--   DROP TABLE IF EXISTS "portal_passkey_challenges";
--   DROP TABLE IF EXISTS "portal_credentials";
