-- Every register check, not just the last one.
--
-- WHAT WAS WRONG. `practitioners` carried three columns — registrationSightedBy,
-- registrationSightedAt, registrationSource — and each new check OVERWROTE
-- them. So "who checked this, when, and what did the register say" had exactly
-- one answer at a time, and the previous answer was destroyed by the act of
-- asking again.
--
-- That is the wrong shape for an attestation. A check is somebody's statement
-- that on a given day the public register said a particular thing. It does not
-- stop being true when a later check is made — a practitioner who was
-- Registered in March and Cancelled in August has two facts, and the March one
-- is exactly what somebody will need when asked why consent captured in April
-- was allowed.
--
-- REPLACING IT IS ALSO HOW A BAD CHECK HIDES. Somebody recording "Registered"
-- over a previous "Cancelled" left no trace that the earlier reading existed.
-- With history, the correction and the thing corrected both stand, and a
-- reviewer can see which order they happened in.
--
-- THE COLUMNS ON `practitioners` STAY. They are the CURRENT value and every
-- screen reads them; deriving "latest" from this table on every read would be
-- correct and slower, and would rewrite code that is not wrong. They are now a
-- cache of the newest row here rather than the only record.

CREATE TABLE "practitioner_register_checks" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "practitionerId" UUID NOT NULL REFERENCES "practitioners"("id") ON DELETE CASCADE,

  -- WHAT THE REGISTER SAID, as read on the day.
  "registrationStatus" TEXT NOT NULL,
  "profession"         TEXT,
  "division"           TEXT,
  "conditions"         TEXT,
  "undertakings"       TEXT,
  "reprimands"         TEXT,

  -- WHO SAID SO, and how. `source` distinguishes a human reading the register
  -- from an API answering, because those are different kinds of evidence and a
  -- column that flattened them would make the weaker one look like the stronger.
  "source"        TEXT NOT NULL,
  "sightedByName" TEXT,
  "sightedAt"     TIMESTAMP(3) NOT NULL,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Newest first, which is how every reader wants it.
CREATE INDEX "practitioner_register_checks_history_idx"
  ON "practitioner_register_checks" ("practitionerId", "sightedAt" DESC);

/*
 * NO RLS, deliberately, and for the same reason `practitioners` has none: a
 * practitioner is a person-level identity that crosses practices, and a
 * practice-keyed policy could never match. What protects this is the endpoint:
 * reading a check is a platform act, and recording one already is.
 */

/*
 * WHAT WE ALREADY HELD BECOMES THE FIRST ROW.
 *
 * Every practitioner whose register has been checked has one reading recorded
 * on their row. Starting the history empty would say nobody had ever been
 * checked, which is both false and the more dangerous direction — it invites
 * somebody to "do the missing check" and overwrite a real one.
 */
INSERT INTO "practitioner_register_checks"
  ("practitionerId", "registrationStatus", "profession", "source", "sightedByName", "sightedAt")
SELECT
  "id",
  COALESCE("registrationStatus", 'unknown'),
  "profession",
  COALESCE("registrationSource", 'manual'),
  "registrationSightedByName",
  "registrationSightedAt"
FROM "practitioners"
WHERE "registrationSightedAt" IS NOT NULL;
