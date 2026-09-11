-- The common reasons for sending a message again, as DATA.
--
-- WHY A TABLE RATHER THAN A LIST IN THE CODE. Somebody will think of a sixth
-- reason, and that should not be a code change, a review and a deploy. A
-- catalogue of common answers is data; it changes at the speed of operations,
-- not at the speed of releases.
--
-- WHAT DELIBERATELY DID NOT MOVE HERE is the rule about how much somebody has
-- to say. `MIN_RESEND_REASON_WORDS` stays in the domain, because a rule that
-- lived in this table could be edited to nothing by whoever was tired of
-- typing -- and the whole point of the note is that a second assertion of
-- notice is accountable.
--
-- WHY A LIST AT ALL, rather than free text. Typing "resent" into a box a
-- hundred times produces a hundred records that say nothing. A list produces
-- something countable, and "how often do our messages not arrive" is a
-- question about deliverability that nobody can currently answer.

CREATE TABLE "resend_reasons" (
  -- Stable, and referenced by outbound_items."resendReason". Renaming a label
  -- must never orphan the records that chose it.
  "key"       TEXT PRIMARY KEY,
  "label"     TEXT NOT NULL,
  -- Shown under the field once chosen. This is where a reason earns its place:
  -- a label alone leaves somebody guessing which of two near-identical ones
  -- they mean.
  "detail"    TEXT NOT NULL,
  -- Retired rather than deleted. Deleting one would orphan every record that
  -- chose it, and "why did we resend these forty messages" would stop having
  -- an answer.
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

/*
 * NOT ROW-LEVEL SCOPED, and it needs saying because everything else here is.
 *
 * This is a catalogue of words, identical for every practice and containing
 * nothing about anybody. Scoping it would mean each practice maintaining its
 * own list, which is the opposite of what makes the answers countable across
 * practices.
 */

INSERT INTO "resend_reasons" ("key", "label", "detail", "sortOrder") VALUES
  ('not_received', 'They say they never received it',
   'The commonest one. Worth counting: several of these to one address is a delivery problem rather than a habit.',
   10),
  ('asked_again', 'They asked for another copy',
   'They had it and want it again — deleted, lost, or needing to forward it to somebody else.',
   20),
  ('spam_filtered', 'It was caught by a spam filter',
   'They found it in junk, or their mail server rejected it without telling anybody.',
   30),
  ('wrong_address', 'It went to the wrong address, now corrected',
   'Correct the address first. Resending to the same wrong one repeats the mistake and hides it.',
   40),
  ('first_attempt_failed', 'The first attempt failed and has not retried',
   'The queue retries on its own, so reach for this only when it has given up.',
   50),
  ('other', 'Another reason',
   'Say what happened in your own words. If you find yourself choosing this often, tell us — it means the list is missing something.',
   900);

/*
 * THE KEY AND THE WORDS ARE DIFFERENT THINGS, and until now one column held
 * whichever somebody typed.
 *
 * `resendReason` already contains free text on existing rows -- "Practice says
 * it never arrived" -- so it cannot become a foreign key without first deciding
 * what to do with those.
 *
 * They are MOVED, not mapped. "Practice says it never arrived" plainly means
 * `not_received`, and guessing that for them would be writing a categorised
 * decision nobody made -- which is the same fabrication as inventing a reason
 * for a row that has none. The words are kept verbatim and the key is left
 * null, which is the truthful record: somebody said why, before there was a
 * list to say it from.
 */
ALTER TABLE "outbound_items" ADD COLUMN "resendNote" TEXT;

UPDATE "outbound_items"
   SET "resendNote" = "resendReason",
       "resendReason" = NULL
 WHERE "resendReason" IS NOT NULL;

/*
 * NOW the foreign key holds, so a resend cannot record a reason nobody defined.
 *
 * Nullable, because of the rows above and because a resend from before this
 * existed genuinely has no key.
 */
ALTER TABLE "outbound_items"
  ADD CONSTRAINT "outbound_items_resend_reason_fk"
  FOREIGN KEY ("resendReason") REFERENCES "resend_reasons"("key");

/*
 * A KEY WITHOUT WORDS IS NOT ENOUGH. The list makes answers countable; the note
 * makes one accountable. Requiring both together is what stops the list
 * becoming a way to resend without saying anything.
 *
 * Only enforced going forward: rows predating this have one or the other and
 * rewriting them would be inventing what somebody meant.
 */
ALTER TABLE "outbound_items" ADD CONSTRAINT "outbound_items_resend_has_both"
  CHECK ("resendReason" IS NULL OR COALESCE(btrim("resendNote"), '') <> '');
