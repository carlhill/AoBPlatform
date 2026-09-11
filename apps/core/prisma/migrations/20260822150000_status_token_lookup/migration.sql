-- The reviewer needs the applicant's token in order to send them a correction
-- link. SECURITY DEFINER because the console is cross-tenant by definition: a
-- platform operator reviews across every practice and has no app.practice_id
-- to satisfy RLS with.
--
-- Returns the TOKEN only. Not the row, and never anything else about the
-- practice -- the caller already has the dossier.
CREATE OR REPLACE FUNCTION find_status_token(p_practice uuid)
RETURNS TABLE ("statusToken" text) AS $fn$
  SELECT p."statusToken" FROM "practices" p WHERE p."id" = p_practice LIMIT 1;
$fn$ LANGUAGE sql SECURITY DEFINER STABLE;
