-- Two-phase email verification: a link to a page, and a CODE to type into it.
--
-- WHY THE LINK ALONE WAS NOT ENOUGH. A bare confirmation link is consumed by a
-- GET, and plenty of things issue a GET that are not the recipient: corporate
-- mail scanners, link-preview bots, antivirus gateways, and the "safe links"
-- rewriting that several mail providers apply to every URL that passes through
-- them. Each of those would mark an address confirmed without a human ever
-- opening the message. The signal was weakest exactly where it was most likely
-- to be used -- a practice on a managed corporate mail system.
--
-- Splitting it fixes that. The link opens a page; the CODE is what confirms.
-- A scanner may fetch the URL all it likes, because fetching the page does
-- nothing. Someone has to read the message and type six digits.
--
-- WHY SIX DIGITS AND NOT FOUR. Four digits is ten thousand combinations, which
-- is guessable by brute force in seconds against an endpoint that does not
-- refuse. Six is a million, and with an attempt cap it is not worth the effort.
-- The cost to the applicant is two extra characters.
--
-- The attempt cap is the part that actually makes the code safe, not the
-- length: a six-digit code with unlimited attempts is a four-digit code with
-- extra steps.

ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "adminEmailVerificationCode" text;
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "adminEmailVerificationAttempts" integer NOT NULL DEFAULT 0;

-- DROP before CREATE: Postgres will not change a function's OUT-parameter row
-- type in place, and CREATE OR REPLACE fails with "cannot change return type".
-- BOTH signatures dropped, old and new. Dropping only the previous one made
-- this migration succeed once and fail on every re-run with "function already
-- exists with same argument types" — which is how a migration that worked in
-- development bricks a deploy.
DROP FUNCTION IF EXISTS issue_email_verification(uuid, integer);
DROP FUNCTION IF EXISTS email_verification_state(text);
DROP FUNCTION IF EXISTS consume_email_verification(text);
DROP FUNCTION IF EXISTS consume_email_verification(text, text);
DROP FUNCTION IF EXISTS record_verification_attempt(text);

-- Issue a token AND a code. The token addresses the page; the code confirms.
CREATE FUNCTION issue_email_verification(p_practice uuid, p_days integer)
RETURNS TABLE (
  "token" text, "code" text, "expiresAt" timestamptz,
  "adminEmail" text, "adminName" text, "name" text
) AS $fn$
  UPDATE "practices" SET
    "adminEmailVerificationToken"     = encode(gen_random_bytes(32), 'hex'),
    -- Six digits, zero-padded, uniformly distributed. lpad matters: without it
    -- a leading-zero code silently becomes five digits and will not match what
    -- the applicant was sent.
    "adminEmailVerificationCode"      = lpad((floor(random() * 1000000))::int::text, 6, '0'),
    "adminEmailVerificationAttempts"  = 0,
    "adminEmailVerificationSentAt"    = now(),
    "adminEmailVerificationExpiresAt" = now() + (p_days || ' days')::interval
  WHERE "id" = p_practice
    AND "adminEmailVerifiedAt" IS NULL
  RETURNING "adminEmailVerificationToken", "adminEmailVerificationCode",
            "adminEmailVerificationExpiresAt", "adminEmail", "adminName", "name";
$fn$ LANGUAGE sql SECURITY DEFINER;

-- What the PAGE may know before a code is entered.
--
-- Deliberately not the practice name: the page is reached by a URL that may
-- have been forwarded, and naming the practice would confirm to whoever holds
-- the link that this entity applied to us. It returns only whether there is
-- anything to do, and how many attempts remain.
CREATE FUNCTION email_verification_state(p_token text)
RETURNS TABLE ("state" text, "attemptsLeft" integer) AS $fn$
  SELECT
    CASE
      WHEN p."adminEmailVerifiedAt" IS NOT NULL THEN 'already_verified'
      WHEN p."adminEmailVerificationAttempts" >= 5 THEN 'locked'
      WHEN p."adminEmailVerificationExpiresAt" <= now() THEN 'expired'
      ELSE 'live'
    END,
    GREATEST(0, 5 - p."adminEmailVerificationAttempts")
  FROM "practices" p
  WHERE p."adminEmailVerificationToken" = p_token
  LIMIT 1;
$fn$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Count a wrong attempt. Separate from the check so a failure is recorded even
-- though the check itself returns nothing -- otherwise the cap could be evaded
-- by simply never succeeding.
CREATE FUNCTION record_verification_attempt(p_token text)
RETURNS integer AS $fn$
  UPDATE "practices"
     SET "adminEmailVerificationAttempts" = "adminEmailVerificationAttempts" + 1
   WHERE "adminEmailVerificationToken" = p_token
  RETURNING "adminEmailVerificationAttempts";
$fn$ LANGUAGE sql SECURITY DEFINER;

-- Confirm. Token AND code AND unexpired AND under the attempt cap, in ONE
-- statement, so none of those can be won by a race between a check and an
-- update.
--
-- Single use: the token and the code are cleared on success, so neither a
-- forwarded link nor a screenshot of the email can be replayed.
CREATE FUNCTION consume_email_verification(p_token text, p_code text)
RETURNS TABLE (id uuid, "name" text, "adminEmail" text) AS $fn$
  UPDATE "practices" SET
    "adminEmailVerifiedAt"        = now(),
    "adminEmailVerificationToken" = NULL,
    "adminEmailVerificationCode"  = NULL
  WHERE "adminEmailVerificationToken" = p_token
    AND "adminEmailVerificationCode" = p_code
    AND "adminEmailVerificationExpiresAt" > now()
    AND "adminEmailVerificationAttempts" < 5
  RETURNING "id", "name", "adminEmail";
$fn$ LANGUAGE sql SECURITY DEFINER;
