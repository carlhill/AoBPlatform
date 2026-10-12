-- The affiliation invitation: a link to a page, and a CODE to type into it.
--
-- WHAT WAS MISSING. `invite()` created the affiliation and returned a message
-- saying "an invitation goes to the practitioner's own email". Nothing sent
-- one. And `respond()` wanted a practitionerId "from their own session", which
-- practitioners do not have -- so the single rule this module exists to hold,
-- that only the practitioner can turn an invitation into an active
-- affiliation, had no path by which a practitioner could act at all.
--
-- WHY THE SAME TWO-PHASE SHAPE AS EMAIL VERIFICATION. A bare link is consumed
-- by a GET, and corporate mail scanners, link-preview bots, antivirus gateways
-- and "safe links" rewriting all issue GETs. Accepting is a POST, so a scanner
-- cannot accept -- but the attempt cap and the single-use clearing are worth
-- having regardless, and consistency between the two flows is worth more than
-- a cleverer scheme in one of them.
--
-- BE HONEST ABOUT WHAT THIS PROVES. A token and a code in the SAME email prove
-- that somebody read that email. They do not prove WHO. That is proof of
-- access to an inbox, and it is recorded as exactly that in
-- "acceptanceMethod" -- never as "the practitioner signed". The real answer is
-- the practitioner passkey (FR-1.9), and the column exists so that when
-- passkey acceptance lands, the two are distinguishable in evidence forever
-- after rather than blurred into one undifferentiated "accepted".

ALTER TABLE "affiliations" ADD COLUMN IF NOT EXISTS "inviteToken" text;
ALTER TABLE "affiliations" ADD COLUMN IF NOT EXISTS "inviteCode" text;
ALTER TABLE "affiliations" ADD COLUMN IF NOT EXISTS "inviteSentAt" timestamptz;
ALTER TABLE "affiliations" ADD COLUMN IF NOT EXISTS "inviteExpiresAt" timestamptz;
ALTER TABLE "affiliations" ADD COLUMN IF NOT EXISTS "inviteAttempts" integer NOT NULL DEFAULT 0;
-- email_link_and_code | passkey | console. NULL until answered.
ALTER TABLE "affiliations" ADD COLUMN IF NOT EXISTS "acceptanceMethod" text;

-- Unique, because the token is how a row is FOUND. A duplicate would make the
-- lookup ambiguous, and an ambiguous lookup on a credential is a lookup that
-- eventually returns somebody else's row.
CREATE UNIQUE INDEX IF NOT EXISTS "affiliations_inviteToken_key"
  ON "affiliations" ("inviteToken") WHERE "inviteToken" IS NOT NULL;

-- DROP before CREATE. Postgres will not change a function's OUT-parameter row
-- type in place -- CREATE OR REPLACE fails with "cannot change return type" --
-- and dropping only the current signature makes the migration succeed once and
-- fail on every re-run, which is how a migration that worked in development
-- bricks a deploy.
DROP FUNCTION IF EXISTS issue_affiliation_invitation(uuid, integer);
DROP FUNCTION IF EXISTS affiliation_invitation_state(text);
DROP FUNCTION IF EXISTS record_invitation_attempt(text);
DROP FUNCTION IF EXISTS answer_affiliation_invitation(text, text, text);

-- Issue a token and a code for an affiliation that is still awaiting an answer.
--
-- Re-issuable on purpose: a practice whose practitioner lost the email must be
-- able to send another. Doing so REPLACES the previous token and resets the
-- attempt count, so an old link stops working the moment a new one is sent.
CREATE FUNCTION issue_affiliation_invitation(p_affiliation uuid, p_days integer)
RETURNS TABLE (
  "token" text, "code" text, "expiresAt" timestamptz,
  "practitionerEmail" text, "practitionerName" text, "practiceName" text
) AS $fn$
  UPDATE "affiliations" a SET
    "inviteToken"     = encode(gen_random_bytes(32), 'hex'),
    -- Six digits, zero-padded. lpad matters: without it a leading-zero code
    -- silently becomes five digits and will not match what was sent.
    "inviteCode"      = lpad((floor(random() * 1000000))::int::text, 6, '0'),
    "inviteAttempts"  = 0,
    "inviteSentAt"    = now(),
    "inviteExpiresAt" = now() + (p_days || ' days')::interval
  FROM "practitioners" pr, "practices" p
  WHERE a."id" = p_affiliation
    AND a."practitionerId" = pr."id"
    AND a."practiceId" = p."id"
    AND a."status" = 'invited'
  RETURNING a."inviteToken", a."inviteCode", a."inviteExpiresAt",
            pr."email", pr."givenNames" || ' ' || pr."familyName", p."name";
$fn$ LANGUAGE sql SECURITY DEFINER;

-- What the PAGE may know before a code is entered.
--
-- DELIBERATELY DIFFERENT FROM email_verification_state, which reveals nothing.
-- That page asks somebody to confirm an address they already own; this one asks
-- somebody to accept a working relationship, and NOBODY CAN CONSENT TO AN
-- UNNAMED THING. Withholding the practice and the location until after the code
-- would mean asking a practitioner to prove they read an email before telling
-- them what they are agreeing to -- which is both useless and slightly sinister.
--
-- So it names the practice, the site and the person. The disclosure that buys
-- is "this practitioner was invited to this practice", to somebody already
-- holding a 32-byte token sent to the practitioner's own address.
--
-- What it does NOT return is the provider number. That is the artefact the
-- REQ-PKI family exists to protect, it is not needed to decide, and a page
-- reachable by a forwarded URL is not where it belongs.
CREATE FUNCTION affiliation_invitation_state(p_token text)
RETURNS TABLE (
  "state" text, "attemptsLeft" integer, "practiceName" text,
  "locationAddress" text, "locationCode" text, "departmentName" text,
  "practitionerName" text, "invitedByName" text, "invitedAt" timestamptz
) AS $fn$
  SELECT
    CASE
      WHEN a."status" = 'active' OR a."status" = 'ending' THEN 'already_accepted'
      WHEN a."status" = 'rejected' THEN 'already_declined'
      WHEN a."status" = 'ended' THEN 'ended'
      WHEN pr."deregisteredAt" IS NOT NULL THEN 'deregistered'
      WHEN a."inviteAttempts" >= 5 THEN 'locked'
      WHEN a."inviteExpiresAt" <= now() THEN 'expired'
      ELSE 'live'
    END,
    GREATEST(0, 5 - a."inviteAttempts"),
    p."name",
    COALESCE(l."addressCanonical", l."address"),
    l."code",
    d."name",
    pr."givenNames" || ' ' || pr."familyName",
    a."invitedByName",
    a."invitedAt"
  FROM "affiliations" a
  JOIN "practices" p ON p."id" = a."practiceId"
  JOIN "practitioners" pr ON pr."id" = a."practitionerId"
  JOIN "practice_locations" l ON l."id" = a."locationId"
  LEFT JOIN "departments" d ON d."id" = a."departmentId"
  WHERE a."inviteToken" = p_token
  LIMIT 1;
$fn$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Count a wrong attempt. Separate from the answer itself, so a failure is
-- recorded even though the answer returns nothing -- otherwise the cap could be
-- evaded by simply never succeeding.
CREATE FUNCTION record_invitation_attempt(p_token text)
RETURNS integer AS $fn$
  UPDATE "affiliations"
     SET "inviteAttempts" = "inviteAttempts" + 1
   WHERE "inviteToken" = p_token
  RETURNING "inviteAttempts";
$fn$ LANGUAGE sql SECURITY DEFINER;

-- Answer it. Token AND code AND unexpired AND under the cap AND still awaiting
-- an answer AND the practitioner still registered, in ONE statement, so none of
-- those can be won by a race between a check and an update.
--
-- Single use: the token and code are cleared either way, so neither a forwarded
-- link nor a screenshot of the email can be replayed -- and note that DECLINING
-- clears them too. An invitation answered is answered; letting a decline be
-- overturned by whoever else holds the link would make the decline worthless.
CREATE FUNCTION answer_affiliation_invitation(p_token text, p_code text, p_decision text)
RETURNS TABLE (id uuid, "practiceId" uuid, "practitionerId" uuid, "status" text) AS $fn$
  UPDATE "affiliations" a SET
    "status"           = CASE WHEN p_decision = 'accept' THEN 'active' ELSE 'rejected' END,
    "startedAt"        = CASE WHEN p_decision = 'accept' THEN now() ELSE NULL END,
    "rejectedAt"       = CASE WHEN p_decision = 'accept' THEN NULL ELSE now() END,
    "endReason"        = CASE WHEN p_decision = 'accept' THEN NULL ELSE 'rejected' END,
    "acceptanceMethod" = 'email_link_and_code',
    "inviteToken"      = NULL,
    "inviteCode"       = NULL
  FROM "practitioners" pr
  WHERE a."inviteToken" = p_token
    AND a."inviteCode" = p_code
    AND a."inviteExpiresAt" > now()
    AND a."inviteAttempts" < 5
    AND a."status" = 'invited'
    AND a."practitionerId" = pr."id"
    -- REQ-XFER-08. Somebody AHPRA no longer registers cannot accept their way
    -- back into a practice, whatever the email in their inbox says.
    AND pr."deregisteredAt" IS NULL
  RETURNING a."id", a."practiceId", a."practitionerId", a."status";
$fn$ LANGUAGE sql SECURITY DEFINER;
