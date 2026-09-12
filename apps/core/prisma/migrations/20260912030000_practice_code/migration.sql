-- THE PRACTICE CODE: ALLOCATED ONCE, ENFORCED UNIQUE BY THE DATABASE
-- (Carl, 12 Sep 2026; PRACTICE-SCOPED-LOGIN.md sections 3b and 5;
-- DECISIONS.md D-2026-09-12-10).
--
-- Carl asked how the practice half of a username can be guaranteed unique.
-- NOT by hoping a truncated identifier is. The scheme this replaces took the
-- first eight hex characters of the practice id -- 32 bits -- and across the
-- roughly ten thousand Australian general practices the chance that SOME pair
-- collides is about 1.2%. A collision is not a failed insert either:
-- `createPasskeyOnlyUser` RETURNS the existing account when the username
-- matches, so practice B would be handed practice A's admin account carrying
-- A's `practice_id` claim -- a cross-tenant breach arriving quietly, as a
-- successful invitation.
--
-- So the code is ALLOCATED: proposed from the trading name (never the legal
-- name), stripped to a-z0-9, truncated to 24, extended `xlevelup2` on
-- collision, stored, and never re-derived. THE UNIQUENESS IS THE UNIQUE INDEX
-- BELOW, not a code path -- a check-then-insert in the application is a race,
-- and the thing being raced for is an account key that can never be changed
-- afterwards because a passkey is bound to it.
--
-- NOTHING HERE RENAMES AN ACCOUNT. Every username already issued
-- (`admin.821709fb`, `drjhuang@gmail.com`, `jo.example@example.invalid`) keeps
-- its name for ever: this migration adds a column and fills it, and no
-- Keycloak account is touched by it or by the code that reads it.
--
-- Idempotent, written to be applied twice (DEV-LOOP.md), and reversible -- the
-- down path is at the foot of this file.

ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "codeGenerated" BOOLEAN NOT NULL DEFAULT false;

-- THE SHAPE, checked by the database rather than trusted from the caller. The
-- same pattern as `PRACTICE_CODE_PATTERN` in packages/domain/src/account-naming.ts,
-- which is where a code is proposed. A code goes inside an account key, so a
-- malformed one must be refused at the last possible point as well as the first.
ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS "practices_code_shape_check";
ALTER TABLE "practices" ADD CONSTRAINT "practices_code_shape_check"
  CHECK ("code" IS NULL OR "code" ~ '^[a-z0-9]{3,}$');

-- TWO PRACTICES CAN NEVER BE ISSUED THE SAME CODE (named test, section 7).
-- A UNIQUE index and not an application check, because that is the difference
-- between "we look before we insert" and "it cannot happen". It also gives
-- never-reuse for free: practice rows are deactivated and never deleted here,
-- so a retired practice's code stays occupied and can never be handed to a new
-- organisation that old evidence would then appear to point at (section 5
-- rule 5).
CREATE UNIQUE INDEX IF NOT EXISTS "practices_code_key" ON "practices" ("code");

-- BACKFILL, BY THE SAME RULES, because a scheme that only applies to practices
-- registered from now on leaves 142 rows with no code and every account for
-- them unnameable. The rules are section 3b's, restated in SQL and kept in step
-- with account-naming.ts by the shape CHECK above and by
-- practice-code.e2e-spec.ts, which asserts the allocator and this file agree.
--
-- ORDERED BY createdAt so the result is reproducible: the oldest practice of a
-- duplicated name takes the bare slug and the later ones take the suffixes,
-- which is also the order a human would expect.
DO $$
DECLARE
  r          RECORD;
  base       TEXT;
  candidate  TEXT;
  attempt    INT;
  wasGenerated BOOLEAN;
BEGIN
  FOR r IN
    SELECT "id", "name", "tradingNames" FROM "practices"
    WHERE "code" IS NULL
    ORDER BY "createdAt", "id"
  LOOP
    -- The trading name where there is one, else the practice name, NEVER the
    -- legal name (rule 1): XLEVELUP Medical's legal name is "The trustee for
    -- Hillsempire Family Trust", which nobody would recognise and which changes
    -- for reasons that have nothing to do with the practice.
    base := substr(
      regexp_replace(
        lower(coalesce(NULLIF(btrim(r."tradingNames"[1]), ''), r."name", '')),
        '[^a-z0-9]', '', 'g'
      ), 1, 24);

    -- Rule 4: no usable slug means a GENERATED code, marked as generated --
    -- 'p' then twelve hex characters, the same shape generatePracticeCode()
    -- produces. A mangled code would be worse than an honest opaque one.
    wasGenerated := false;
    IF length(base) < 3 THEN
      base := 'p' || encode(gen_random_bytes(6), 'hex');
      wasGenerated := true;
    END IF;

    -- Rule 5 / section 5 rule 3: extend deterministically. Predictable beats
    -- random, and the loop terminates because each pass tries a longer string.
    attempt := 1;
    candidate := base;
    WHILE EXISTS (SELECT 1 FROM "practices" WHERE "code" = candidate) LOOP
      attempt := attempt + 1;
      candidate := base || attempt::text;
    END LOOP;

    UPDATE "practices" SET "code" = candidate, "codeGenerated" = wasGenerated WHERE "id" = r."id";
  END LOOP;
END $$;

-- DOWN (by hand, DEV-LOOP.md). Reversible, and it takes nothing with it: no
-- foreign key points at this column and no username is stored anywhere in this
-- database, so dropping it loses the allocation and nothing else.
--   DROP INDEX IF EXISTS "practices_code_key";
--   ALTER TABLE "practices" DROP CONSTRAINT IF EXISTS "practices_code_shape_check";
--   ALTER TABLE "practices" DROP COLUMN IF EXISTS "codeGenerated";
--   ALTER TABLE "practices" DROP COLUMN IF EXISTS "code";
