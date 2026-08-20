-- Hardening: after a transaction that SET LOCAL a custom GUC ends, the
-- session-level value of that GUC is the EMPTY STRING, not undefined — so
-- current_setting('app.practice_id', true) returns '' and ''::uuid raises
-- 22P02. That error is still fail-closed (nothing leaks), but the intended
-- behaviour is "no scope ⇒ zero rows", which NULLIF gives us: NULL scope
-- makes every comparison NULL, filtering every row.

DROP POLICY practice_isolation ON "practices";
DROP POLICY practice_isolation ON "providers";
DROP POLICY practice_isolation ON "patients";
DROP POLICY practice_isolation ON "assignors";
DROP POLICY practice_isolation ON "agreements";

CREATE POLICY practice_isolation ON "practices"
  USING (id = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.practice_id', true), '')::uuid);

CREATE POLICY practice_isolation ON "providers"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

CREATE POLICY practice_isolation ON "patients"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

CREATE POLICY practice_isolation ON "assignors"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);

CREATE POLICY practice_isolation ON "agreements"
  USING ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid)
  WITH CHECK ("practiceId" = NULLIF(current_setting('app.practice_id', true), '')::uuid);
