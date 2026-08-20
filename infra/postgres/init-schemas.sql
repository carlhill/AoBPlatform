-- Creates each deployable's Postgres schema up front so app migrations only
-- ever need CREATE TABLE, not CREATE SCHEMA, privileges. (Pattern carried
-- over from ReferralPlatform.)
--
-- RLS note (CLAUDE.md rule set / ADR): practice scoping is enforced with
-- row-level security at the database layer — an application bug must not be
-- able to leak another practice's records. RLS policies are added with the
-- first real tables in each schema; a cross-practice access test must fail
-- closed (definition of done, CLAUDE.md §6).
--
-- The vault schema holds relational bookkeeping only; tamper-evident events
-- live in immudb. No role is ever granted DELETE on evidence tables (rule 11).

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS rules;
CREATE SCHEMA IF NOT EXISTS vault;
