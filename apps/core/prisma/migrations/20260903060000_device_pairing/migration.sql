-- DEVICE PAIRING — the one credential a tablet may hold.
--
-- `/kiosk` is a public route whose practice scope came from a build-time
-- environment variable: anybody who reached the URL saw that practice's
-- waiting room, which is a list of patient names. This is what closes it. The
-- console registers a device, shows a short-lived code, and the tablet
-- exchanges that code once for an opaque credential; every kiosk request
-- afterwards carries the credential and the SERVER resolves the practice from
-- it (CLAUDE.md section 7, TODO.md "Zero-footprint kiosk").
--
-- ONLY HASHES ARE STORED, for the credential and for the code alike — the same
-- rule `capture_requests.tokenHash` already keeps. A database read cannot mint
-- a working credential.
--
-- Written to be applied twice (DEV-LOOP.md).

-- ---------------------------------------------------------------------------
-- The build floor a practice's tablets must be at or above. NULL means no
-- floor and no tablet reloads; the absence of a setting is never a reason to
-- restart every tablet in the country.
-- ---------------------------------------------------------------------------
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "minimumKioskBuild" TEXT;

-- ---------------------------------------------------------------------------
-- The devices themselves. Practice-scoped, like every other practice table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "devices" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId"     UUID NOT NULL,
  "label"          TEXT NOT NULL,
  "credentialHash" TEXT,
  "createdBy"      TEXT NOT NULL,
  "createdById"    TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT now(),
  "pairedAt"       TIMESTAMP(3),
  "lastSeenAt"     TIMESTAMP(3),
  "lastKioskBuild" TEXT,
  "revokedAt"      TIMESTAMP(3),
  "revokedBy"      TEXT,
  "revokedReason"  TEXT
);

CREATE INDEX IF NOT EXISTS "devices_practiceId_idx" ON "devices" ("practiceId");

-- The credential lookup, and the guarantee that two devices can never resolve
-- to the same credential. NULLs do not collide in a unique index, so any
-- number of unpaired or revoked devices coexist.
CREATE UNIQUE INDEX IF NOT EXISTS "devices_credentialHash_key" ON "devices" ("credentialHash");

DO $$
BEGIN
  -- A device nobody named is a row nobody can find on a desk.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_label_present') THEN
    ALTER TABLE "devices" ADD CONSTRAINT devices_label_present
      CHECK (length(trim("label")) > 0 AND length("label") <= 60);
  END IF;

  -- Registered by somebody, always. This is the act that hands out the
  -- credential which opens a practice's waiting list; an audit line naming
  -- nobody is worse than a refusal.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_has_actor') THEN
    ALTER TABLE "devices" ADD CONSTRAINT devices_has_actor
      CHECK (length(trim("createdBy")) > 0 AND length(trim("createdById")) > 0);
  END IF;

  -- THE CREDENTIAL IS NEVER STORED IN CLEAR, in the column definition rather
  -- than only in the service. sha256 hex is exactly 64 characters of
  -- [0-9a-f]; a credential is base64url and longer, so a row holding one
  -- cannot be written at all. Named test: `credential_never_stored_in_clear`.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_credential_is_a_hash') THEN
    ALTER TABLE "devices" ADD CONSTRAINT devices_credential_is_a_hash
      CHECK ("credentialHash" IS NULL OR "credentialHash" ~ '^[0-9a-f]{64}$');
  END IF;

  -- A revoked device holds no live credential. Belt as well as braces: the
  -- service clears the hash on revoke, and this refuses the row if it ever
  -- stops doing so, which is the difference between a revoke that works and
  -- one that only looks like it did.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_revoked_holds_no_credential') THEN
    ALTER TABLE "devices" ADD CONSTRAINT devices_revoked_holds_no_credential
      CHECK ("revokedAt" IS NULL OR "credentialHash" IS NULL);
  END IF;
END
$$;

-- Practice scoping at the DB layer, FORCE so it applies to the owner too.
ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "devices" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS practice_isolation ON "devices";
CREATE POLICY practice_isolation ON "devices"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- The short-lived pairing codes.
--
-- DELIBERATELY NOT PRACTICE-SCOPED BY RLS, for the same reason `vault_outbox`
-- is not. `POST /devices/pair` is reached by a tablet that has no practice
-- scope yet — establishing one is the entire point of the call — so a policy
-- on `app.practice_id` would fail closed against the only caller the row
-- exists for. The row carries a hash, an expiry and two ids, and no patient
-- data of any kind; the service re-enters `withPractice` the moment it knows
-- which practice the code belongs to.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "device_pairing_codes" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practiceId" UUID NOT NULL,
  "deviceId"   UUID NOT NULL,
  "codeHash"   TEXT NOT NULL,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "device_pairing_codes_codeHash_key"
  ON "device_pairing_codes" ("codeHash");
CREATE INDEX IF NOT EXISTS "device_pairing_codes_deviceId_idx"
  ON "device_pairing_codes" ("deviceId");
CREATE INDEX IF NOT EXISTS "device_pairing_codes_expiresAt_idx"
  ON "device_pairing_codes" ("expiresAt");

DO $$
BEGIN
  -- The code is never stored either, only its sha256.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_pairing_codes_is_a_hash') THEN
    ALTER TABLE "device_pairing_codes" ADD CONSTRAINT device_pairing_codes_is_a_hash
      CHECK ("codeHash" ~ '^[0-9a-f]{64}$');
  END IF;

  -- Ten minutes is the policy (PAIRING_CODE_TTL_MS); a day is not. This
  -- refuses a caller that ever tries to mint a long-lived one, which would be
  -- a code left on a console screen overnight.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_pairing_codes_short_lived') THEN
    ALTER TABLE "device_pairing_codes" ADD CONSTRAINT device_pairing_codes_short_lived
      CHECK ("expiresAt" <= "createdAt" + INTERVAL '1 hour');
  END IF;
END
$$;

-- Down:
--   DROP TABLE "device_pairing_codes";
--   DROP TABLE "devices";
--   ALTER TABLE "practices" DROP COLUMN "minimumKioskBuild";
