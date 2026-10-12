-- THE AGREEMENT'S ANCHOR MOVES FROM `providers` TO `affiliations`
-- (Carl, 7 Sep 2026: "retire providers as the anchor").
--
-- WHAT WAS WRONG. Two unconnected tables described the same person.
-- `providers` is PRACTICE-scoped, has no `locationId`, no foreign key to
-- anything but `practices`, and was the anchor `Agreement.providerId` pointed
-- at. `affiliations` is the practitioner x location edge, carries the
-- per-location provider number (FR-1.8) and now the billing role -- and
-- nothing joined the two. The billing-role build had to GUESS which
-- affiliation an arrival's provider meant, by matching on whichever of three
-- keys the two tables happened to share.
--
-- WHY THE AFFILIATION IS THE RIGHT ANCHOR, in three lines from the rules
-- rather than from convenience:
--   * the enduring agreement is per PRACTITIONER x patient (REQ-END-01, hard
--     rule 6), and only the affiliation reaches a practitioner;
--   * the provider number is issued per practitioner per LOCATION (FR-1.8),
--     and only the affiliation holds one;
--   * s 65C(5)(a) identifies the professional by name AND the address of the
--     place of practice, and only the affiliation names the place.
-- A practice-scoped `providers` row answers none of the three.
--
-- `providerId` IS NOT DROPPED. Every signed agreement is evidence, its render
-- was hashed at lock (hard rule 13), and the column is what those rows still
-- say about who they named. It stays, nullable, for the transition; the drop
-- is a later migration and is on TODO.md.
--
-- Idempotent, reversible, written to be applied twice (DEV-LOOP.md).

-- ---------------------------------------------------------------------------
-- 1. THE COLUMNS
-- ---------------------------------------------------------------------------

-- HOW AN EXISTING AGREEMENT CAME BY ITS ANCHOR. A TYPE, never a value: which
-- of the three keys matched. NULL on every row anchored at creation, which is
-- the ordinary case from today. Read by nothing at runtime -- it exists so
-- that a question asked in 2028 about a backfilled agreement has an answer
-- other than "somebody ran something once".
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "providerAnchorBackfill" TEXT;

-- THE ARRIVAL'S OWN ANCHOR. An arrival now resolves to the affiliation at the
-- location the patient walked into, and the row records which one -- so
-- "whose name went on this" is answerable from the arrival as well as from the
-- agreement it produced. No foreign key, for the reason the rest of this table
-- gives: `arrivals` deliberately carries no relations, and scoping is RLS's
-- job on `practiceId`.
ALTER TABLE "arrivals" ADD COLUMN IF NOT EXISTS "affiliationId" UUID;

-- ---------------------------------------------------------------------------
-- 2. HARD-01, NARROWED RATHER THAN WEAKENED
--
-- The anchor of an agreement is immutable: a contract that can be re-pointed
-- at a different doctor after it was signed is not evidence of anything. That
-- stays exactly as it was for `anchorKind`, `providerId`, `organisationId`,
-- `patientId`, `practiceId` and `type`.
--
-- The ONE thing this changes is that `affiliationId` may go from NULL to a
-- value -- once. Filling in a column that was never set is completing the
-- record, not moving the anchor; and once it holds a value it is as immutable
-- as everything else in the list, so nothing can be re-pointed and nothing can
-- be cleared. Without this the backfill below could not run at all, and every
-- pre-existing agreement would stay permanently unanswerable about which
-- practitioner, at which location, it named.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_agreement_anchor_change() RETURNS trigger AS $fn$
BEGIN
  IF NEW."anchorKind"      IS DISTINCT FROM OLD."anchorKind"
  OR NEW."providerId"      IS DISTINCT FROM OLD."providerId"
  OR NEW."organisationId"  IS DISTINCT FROM OLD."organisationId"
  OR NEW."patientId"       IS DISTINCT FROM OLD."patientId"
  OR NEW."practiceId"      IS DISTINCT FROM OLD."practiceId"
  OR NEW."type"            IS DISTINCT FROM OLD."type" THEN
    RAISE EXCEPTION 'HARD-01: agreement anchor/identity fields are immutable - terminate and recreate';
  END IF;
  -- NULL -> value is allowed once. value -> anything else is not.
  IF OLD."affiliationId" IS NOT NULL AND NEW."affiliationId" IS DISTINCT FROM OLD."affiliationId" THEN
    RAISE EXCEPTION 'HARD-01: the affiliation anchor is immutable once set - terminate and recreate';
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 3. THE BACKFILL, WHICH NEVER GUESSES
--
-- Three keys, strongest first, exactly the ones the two tables can share:
--   1. `pmsLinkageKey` -- the practice's own software saying "same person,
--      same place". The strongest, and what the connector will populate on
--      both sides once D-01 resolves.
--   2. `providerNumber` -- issued per practitioner per location, so two rows
--      carrying the same one ARE the same practitioner at the same location.
--   3. `ahpraNumber` -- the same PERSON; the same place only where they hold
--      exactly one affiliation at this practice.
--
-- EVERY MATCH MUST BE UNIQUE OR IT IS NOT A MATCH. Where a key finds two
-- candidate affiliations the row is left alone: picking one would be a coin
-- toss over whose name is on a contract, and an unanswered question is better
-- evidence than a confident wrong answer. Unresolved rows keep
-- `affiliationId` NULL and raise a review task (section 4).
--
-- IT CROSSES PRACTICES, AND NOTHING HERE LIFTS RLS TO DO IT. The migration
-- role holds BYPASSRLS; the application connects as `aob_app`, which holds
-- neither that nor SUPERUSER, so every statement below is unreachable from the
-- running platform (DEV-LOOP.md). No policy is dropped, no table is taken out
-- of FORCE, and a practice's rows are still fenced from every other practice
-- the moment this migration ends.
-- ---------------------------------------------------------------------------

-- 3a. by pmsLinkageKey
WITH candidate AS (
  SELECT p.id AS provider_id, MIN(a.id::text)::uuid AS affiliation_id, COUNT(*) AS matches
    FROM "providers" p
    JOIN "affiliations" a
      ON a."practiceId" = p."practiceId"
     AND a."pmsLinkageKey" = p."pmsLinkageKey"
   WHERE COALESCE(btrim(p."pmsLinkageKey"), '') <> ''
   GROUP BY p.id
)
UPDATE "agreements" ag
   SET "affiliationId" = c.affiliation_id,
       "providerAnchorBackfill" = 'pms_linkage_key'
  FROM candidate c
 WHERE c.matches = 1
   AND ag."providerId" = c.provider_id
   AND ag."affiliationId" IS NULL;

-- 3b. by providerNumber
WITH candidate AS (
  SELECT p.id AS provider_id, MIN(a.id::text)::uuid AS affiliation_id, COUNT(*) AS matches
    FROM "providers" p
    JOIN "affiliations" a
      ON a."practiceId" = p."practiceId"
     AND a."providerNumber" = p."providerNumber"
   WHERE COALESCE(btrim(p."providerNumber"), '') <> ''
   GROUP BY p.id
)
UPDATE "agreements" ag
   SET "affiliationId" = c.affiliation_id,
       "providerAnchorBackfill" = 'provider_number'
  FROM candidate c
 WHERE c.matches = 1
   AND ag."providerId" = c.provider_id
   AND ag."affiliationId" IS NULL;

-- 3c. by ahpraNumber, and only where the person holds ONE affiliation here
WITH candidate AS (
  SELECT p.id AS provider_id, MIN(a.id::text)::uuid AS affiliation_id, COUNT(*) AS matches
    FROM "providers" p
    JOIN "practitioners" pr ON pr."ahpraNumber" = p."ahpraNumber"
    JOIN "affiliations" a
      ON a."practitionerId" = pr.id
     AND a."practiceId" = p."practiceId"
   WHERE COALESCE(btrim(p."ahpraNumber"), '') <> ''
   GROUP BY p.id
)
UPDATE "agreements" ag
   SET "affiliationId" = c.affiliation_id,
       "providerAnchorBackfill" = 'ahpra_number'
  FROM candidate c
 WHERE c.matches = 1
   AND ag."providerId" = c.provider_id
   AND ag."affiliationId" IS NULL;

-- ---------------------------------------------------------------------------
-- 4. WHAT COULD NOT BE RESOLVED BECOMES SOMEBODY'S WORK, not a silence.
--
-- ONE TASK PER PROVIDER, not per agreement. A human maps a provider to a
-- practitioner-at-a-location ONCE and every agreement that named them follows;
-- one task per agreement would be a queue nobody opens. LOW stakes: nothing is
-- at risk while it waits -- the agreements are unchanged, still readable,
-- still rendering from their own stored particulars -- and what is being asked
-- for is a mapping, not a judgement about a consent.
--
-- The summary carries a COUNT and no patient names: a review queue is not a
-- place to put a patient list.
-- ---------------------------------------------------------------------------

INSERT INTO "review_tasks" (id, "practiceId", kind, "subjectType", "subjectId", summary, detail, state, "raisedBy")
SELECT gen_random_uuid(),
       p."practiceId",
       'agreement_anchor_unresolved',
       'Provider',
       p.id,
       'Provider "' || p.name || '" could not be matched to a practitioner at a location, so '
         || COUNT(ag.id)::text || ' agreement(s) have no practitioner anchor.',
       jsonb_build_object(
         'agreementCount', COUNT(ag.id),
         'providerHasPmsLinkageKey', COALESCE(btrim(p."pmsLinkageKey"), '') <> '',
         'providerHasProviderNumber', COALESCE(btrim(p."providerNumber"), '') <> '',
         'providerHasAhpraNumber', COALESCE(btrim(p."ahpraNumber"), '') <> ''),
       'open',
       'migration:20260907040000_agreement_anchored_on_affiliation'
  FROM "providers" p
  JOIN "agreements" ag ON ag."providerId" = p.id AND ag."affiliationId" IS NULL
 WHERE NOT EXISTS (
         SELECT 1 FROM "review_tasks" t
          WHERE t.kind = 'agreement_anchor_unresolved'
            AND t."subjectId" = p.id
            AND t.state IN ('open', 'claimed'))
 GROUP BY p.id, p."practiceId", p.name, p."pmsLinkageKey", p."providerNumber", p."ahpraNumber";

-- ---------------------------------------------------------------------------
-- 5. FROM HERE, EVERY NEW AGREEMENT IS ANCHORED ON AN AFFILIATION.
--
-- The column cannot be NOT NULL -- the agreements above that nobody could map
-- are evidence and are not going to be deleted to satisfy a constraint. So the
-- rule is stated on the rows it can be stated on: anything created from the
-- day this landed. A fixed timestamp rather than a moving one, so the
-- constraint means the same thing every time it is checked.
--
-- ORGANISATION-ANCHORED AGREEMENTS ARE OUT OF IT, by the first clause: the
-- ACCHO/AMS enduring pathway anchors to an organisation and names no
-- practitioner at all (Addendum v3 1.1).
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreements_new_rows_are_anchored_on_an_affiliation') THEN
    ALTER TABLE "agreements" ADD CONSTRAINT agreements_new_rows_are_anchored_on_an_affiliation
      CHECK ("anchorKind" <> 'provider'
             OR "affiliationId" IS NOT NULL
             OR "createdAt" < TIMESTAMP '2026-09-07 00:00:00');
  END IF;

  -- A NOTE ABOUT HOW AN ANCHOR WAS FOUND, ON A ROW THAT HAS NO ANCHOR, would
  -- be a record of something that did not happen.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreements_anchor_backfill_note_needs_an_anchor') THEN
    ALTER TABLE "agreements" ADD CONSTRAINT agreements_anchor_backfill_note_needs_an_anchor
      CHECK ("providerAnchorBackfill" IS NULL OR "affiliationId" IS NOT NULL);
  END IF;

  -- The three keys and nothing else. The set is closed on purpose: a fourth
  -- value would mean somebody had invented a fourth way to decide whose name
  -- goes on a contract without saying so here.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreements_anchor_backfill_key_known') THEN
    ALTER TABLE "agreements" ADD CONSTRAINT agreements_anchor_backfill_key_known
      CHECK ("providerAnchorBackfill" IS NULL
             OR "providerAnchorBackfill" IN ('pms_linkage_key', 'provider_number', 'ahpra_number'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "arrivals_affiliation_idx" ON "arrivals" ("affiliationId");

-- ---------------------------------------------------------------------------
-- ROLLBACK (apply by hand; Prisma has no down-migrations)
--
--   DROP INDEX IF EXISTS "arrivals_affiliation_idx";
--   ALTER TABLE "agreements" DROP CONSTRAINT IF EXISTS agreements_anchor_backfill_key_known;
--   ALTER TABLE "agreements" DROP CONSTRAINT IF EXISTS agreements_anchor_backfill_note_needs_an_anchor;
--   ALTER TABLE "agreements" DROP CONSTRAINT IF EXISTS agreements_new_rows_are_anchored_on_an_affiliation;
--   ALTER TABLE "arrivals"   DROP COLUMN IF EXISTS "affiliationId";
--   ALTER TABLE "agreements" DROP COLUMN IF EXISTS "providerAnchorBackfill";
--   -- the anchors themselves stay: clearing them would need the trigger lifted,
--   -- and an agreement that has been told which practitioner it named does not
--   -- become better evidence by being told to forget.
--   -- Restore the stricter trigger body from 20260820110800_rls_and_immutability
--   -- if the NULL -> value path is not wanted.
--
-- What the rollback loses: which practitioner-at-a-location each agreement
-- named, and the note saying how that was worked out. Nothing in the
-- non-repudiation chain moves -- no particulars, no render payload, no hash and
-- no signature event is touched by any statement above (hard rule 13).
-- ---------------------------------------------------------------------------
