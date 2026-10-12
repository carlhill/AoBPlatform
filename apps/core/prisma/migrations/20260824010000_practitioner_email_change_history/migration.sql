-- Reading a practitioner's own history of address changes.
--
-- The practice side already had `pending_email_changes_history_idx`; the
-- practitioner side had only the partial unique that enforces "one live change
-- at a time". That covers `live()`, which asks for the unresolved one, and
-- covers nothing for the churn check — "how many did this person ASK for in the
-- last month", which reads resolved rows too and is the query that decides
-- whether to refuse.
--
-- DESC on requestedAt for the same reason as the practice index: every caller
-- wants the most recent first, and a descending index means the planner reads
-- the front of it rather than sorting what it found.
CREATE INDEX IF NOT EXISTS pending_email_changes_practitioner_history_idx
  ON core.pending_email_changes ("practitionerId", "requestedAt" DESC)
  WHERE "practitionerId" IS NOT NULL;
