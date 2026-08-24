-- An approval that did not produce an administrator is a piece of work.
--
-- WHAT WAS ALREADY TRUE. Validation and invitation are ONE act and have been:
-- `validate()` calls `onApproved()` in the same call, which records the
-- enrolment ceremony, creates the Keycloak account and sends the passkey link.
-- That part needed no fixing.
--
-- WHAT WAS MISSING is the other half of "one act": when the invitation fails,
-- the approval still stands and nothing durable says the invitation did not
-- happen. The error is logged and returned in the response, and then it is
-- gone. The practice sits approved with nobody able to sign in, and the only
-- trace is a line in a log file nobody is reading.
--
-- That is exactly Sampletown Family Practice: approved, four locations, and not
-- one person who can sign in. It went unnoticed until a setup gap was added
-- that happened to surface it.
--
-- So the outcome is written down. An approval whose invitation failed becomes
-- something somebody can SEE and RETRY, rather than something inferred later
-- from an absence.
ALTER TABLE "practices"
  -- NULL means "no attempt has failed", which is the ordinary case. Set means
  -- the last attempt failed and nobody has succeeded since.
  ADD COLUMN "adminInviteFailedAt" TIMESTAMP(3),
  -- The reason, in the words the identity provider used. Kept verbatim: a
  -- paraphrased error is one somebody has to guess the original of, and the
  -- commonest of these ("an account already exists with this email") is
  -- actionable precisely because it is specific.
  ADD COLUMN "adminInviteError" TEXT,
  -- How many times. A first failure is a bounce; a fourth is a decision
  -- somebody needs to make about this practice.
  ADD COLUMN "adminInviteAttempts" INTEGER NOT NULL DEFAULT 0;

/*
 * FINDING THE ONES THAT NEED RESCUING, without scanning every practice.
 *
 * Partial, because the rows that matter are a small minority and always will
 * be — an index over every practice to find the handful that failed would be
 * mostly wasted pages.
 */
CREATE INDEX IF NOT EXISTS practices_admin_invite_failed_idx
  ON core.practices ("adminInviteFailedAt" DESC)
  WHERE "adminInviteFailedAt" IS NOT NULL;
