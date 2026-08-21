-- Email verification for the applicant.
--
-- WHAT THIS PROVES, exactly: that whoever completed the application can read
-- mail at the address they gave. That is a small claim and it is worth stating
-- narrowly, because verified-email badges are routinely over-read.
--
-- It does NOT prove the address belongs to the practice, that the person is who
-- they say, or that they are entitled to act for the entity. A free mailbox
-- verifies exactly as well as a practice one. The entitlement check is still
-- the check that matters.
--
-- What it DOES do is close the cheapest gap in the current flow: today an
-- applicant can type any address at all, and nothing anywhere notices. An
-- application whose contact address was never confirmed is one where every
-- subsequent message — the correction link, the decision, the passkey
-- invitation — goes into the dark.
--
-- SEPARATE TOKEN from the status token, deliberately. The status token grants
-- reading the application and, in an open window, changing it. Verification
-- should grant neither, so that a verification link forwarded to a colleague
-- ("can you click this for me") does not hand over the ability to edit.

ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "adminEmailVerifiedAt" timestamptz;
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "adminEmailVerificationToken" text;
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "adminEmailVerificationSentAt" timestamptz;
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "adminEmailVerificationExpiresAt" timestamptz;

-- Unique so one token cannot resolve to two applications. Partial, because
-- consumed tokens are set to NULL and many NULLs are not a conflict.
CREATE UNIQUE INDEX IF NOT EXISTS "practices_emailVerificationToken_key"
  ON "practices" ("adminEmailVerificationToken")
  WHERE "adminEmailVerificationToken" IS NOT NULL;

-- Issue a token. Called at submission, and again if the applicant asks for
-- another. Re-issuing REPLACES the previous one rather than adding a second:
-- two live verification links for one address is one more than is needed, and
-- the older one is exactly the copy most likely to have been forwarded.
CREATE OR REPLACE FUNCTION issue_email_verification(p_practice uuid, p_days integer)
RETURNS TABLE ("token" text, "expiresAt" timestamptz, "adminEmail" text, "adminName" text, "name" text) AS $fn$
  UPDATE "practices" SET
    "adminEmailVerificationToken"     = encode(gen_random_bytes(32), 'hex'),
    "adminEmailVerificationSentAt"    = now(),
    "adminEmailVerificationExpiresAt" = now() + (p_days || ' days')::interval
  WHERE "id" = p_practice
    -- Not once it is already verified. Re-verifying an address proves nothing
    -- new and would only reopen a window that is closed.
    AND "adminEmailVerifiedAt" IS NULL
  RETURNING "adminEmailVerificationToken", "adminEmailVerificationExpiresAt",
            "adminEmail", "adminName", "name";
$fn$ LANGUAGE sql SECURITY DEFINER;

-- Consume it. SECURITY DEFINER because the caller is an applicant with no
-- session — through the ordinary client RLS would match zero rows and the page
-- would report "this link is not valid" for every valid link.
--
-- SINGLE USE: the token is set to NULL on success, so a link that has already
-- been used cannot be replayed from a forwarded copy or a browser history.
-- The expiry is checked in the same statement, so an expired token cannot be
-- consumed by a race between the check and the update.
CREATE OR REPLACE FUNCTION consume_email_verification(p_token text)
RETURNS TABLE (id uuid, "name" text, "adminEmail" text) AS $fn$
  UPDATE "practices" SET
    "adminEmailVerifiedAt"        = now(),
    "adminEmailVerificationToken" = NULL
  WHERE "adminEmailVerificationToken" = p_token
    AND "adminEmailVerificationExpiresAt" > now()
  RETURNING "id", "name", "adminEmail";
$fn$ LANGUAGE sql SECURITY DEFINER;

-- Whether a token is merely EXPIRED rather than unknown, so the page can offer
-- "send me another" instead of "that link is wrong". A token that has been
-- consumed is indistinguishable from one that never existed, which is correct:
-- confirming that a used token was once real tells a stranger something.
CREATE OR REPLACE FUNCTION email_verification_state(p_token text)
RETURNS TABLE ("state" text, "name" text) AS $fn$
  SELECT
    CASE
      WHEN p."adminEmailVerificationExpiresAt" <= now() THEN 'expired'
      ELSE 'live'
    END,
    p."name"
  FROM "practices" p
  WHERE p."adminEmailVerificationToken" = p_token
  LIMIT 1;
$fn$ LANGUAGE sql SECURITY DEFINER STABLE;
