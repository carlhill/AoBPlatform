-- Application role. The app NEVER connects as the superuser: a superuser
-- bypasses row-level security wholesale, which would silently disable the
-- practice-scoping guarantee (found the hard way — the RLS fail-closed tests
-- pass only under a non-superuser role). Migrations run as the admin role
-- (aobplatform); runtime connects as aob_app.
CREATE ROLE aob_app LOGIN PASSWORD 'aob_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT USAGE ON SCHEMA core, rules, vault TO aob_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core, rules, vault TO aob_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA core, rules, vault TO aob_app;

-- Future tables created by migrations (as aobplatform) are granted automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE aobplatform IN SCHEMA core GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aob_app;
ALTER DEFAULT PRIVILEGES FOR ROLE aobplatform IN SCHEMA rules GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aob_app;
ALTER DEFAULT PRIVILEGES FOR ROLE aobplatform IN SCHEMA vault GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aob_app;
ALTER DEFAULT PRIVILEGES FOR ROLE aobplatform IN SCHEMA core GRANT USAGE, SELECT ON SEQUENCES TO aob_app;
ALTER DEFAULT PRIVILEGES FOR ROLE aobplatform IN SCHEMA rules GRANT USAGE, SELECT ON SEQUENCES TO aob_app;
ALTER DEFAULT PRIVILEGES FOR ROLE aobplatform IN SCHEMA vault GRANT USAGE, SELECT ON SEQUENCES TO aob_app;

-- No DELETE on evidence tables ever lands on this role beyond what a feature
-- explicitly needs — revisit grants per table as the vault schema grows
-- (rule 11: no delete grants in any application role on evidence stores).
