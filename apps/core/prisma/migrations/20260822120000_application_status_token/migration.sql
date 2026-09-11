-- A bearer token for the public application-status page.
--
-- WHY NOT THE PRACTICE ID. The id is a primary key. It appears in server logs,
-- in Referer headers when the page links anywhere, in support tickets that get
-- pasted into email, and in every URL an applicant ever bookmarks. A primary
-- key that doubles as a credential is a credential that leaks, and worse, one
-- that cannot be rotated without breaking every foreign key pointing at it.
--
-- So: a separate 256-bit random token, revocable on its own, that grants
-- exactly one thing — the right to read the status of ONE application.
--
-- WHAT A LEAKED TOKEN DISCLOSES, deliberately bounded: the name the applicant
-- applied under, their reference, and which of the three gates has been
-- reached. Nothing else. Not the reviewer, not the reviewer's note, not the
-- checklist, not why anyone is hesitating, and not whether the ABN is already
-- registered here — that last one would turn a status query into a way to
-- enumerate our customers, which is the same rule already enforced on
-- rejection reasons.
--
-- Guessing is not the threat model at 256 bits. Forwarding is: the realistic
-- leak is an applicant forwarding the acknowledgement email, and the person who
-- receives it already has the practice name in the message they were sent.

ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "statusToken" text;

-- gen_random_bytes needs pgcrypto; encode(..., 'hex') keeps it URL-safe with
-- no escaping, at the cost of length we do not care about in a mailed link.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Backfill. Every application that already exists gets one, so the column can
-- be made NOT NULL and no row is a special case forever after.
UPDATE "practices"
   SET "statusToken" = encode(gen_random_bytes(32), 'hex')
 WHERE "statusToken" IS NULL;

ALTER TABLE "practices" ALTER COLUMN "statusToken" SET NOT NULL;

-- Unique, because two applications sharing a token would let one applicant read
-- the other's status. The index also makes the lookup a single probe, which
-- matters: this endpoint is public and unauthenticated.
CREATE UNIQUE INDEX IF NOT EXISTS "practices_statusToken_key" ON "practices" ("statusToken");

-- New rows get one without the service having to remember.
ALTER TABLE "practices" ALTER COLUMN "statusToken" SET DEFAULT encode(gen_random_bytes(32), 'hex');

-- ---------------------------------------------------------------------------
-- The lookup.
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER because this is PRE-TENANT in the strictest sense: the
-- caller is an applicant with no session, no practice context and no account.
-- Through the ordinary client, RLS would filter this to zero rows and the page
-- would report "no such application" for every application — the silent
-- failure this codebase exists to avoid.
--
-- The projection IS the security boundary. It returns four columns, and adding
-- a fifth is a decision about what an unauthenticated stranger may read.
-- Notably absent: validationNote (the reviewer's words), validatedByName (who
-- decided), every entitlement column, and the ABN itself.

CREATE OR REPLACE FUNCTION find_application_by_status_token(p_token text)
RETURNS TABLE (
  id uuid,
  name text,
  "validationState" text,
  "createdAt" timestamptz
) AS $$
  SELECT p."id", p."name", p."validationState", p."createdAt"
    FROM "practices" p
   WHERE p."statusToken" = p_token
   LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;
