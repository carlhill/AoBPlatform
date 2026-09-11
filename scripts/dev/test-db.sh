#!/usr/bin/env bash
# Create (or rebuild) the database the e2e suites run against.
#
# WHY THIS EXISTS. The e2e suites empty whole tables — unfiltered deleteMany on
# patient, agreement, assignor, practice, arrival and more — and until 11 Sep
# 2026 they did it to the DEV database, because jest.e2e.config.js set none of
# its own and picked up apps/core/.env. See apps/core/test/test-database.setup.ts.
#
# A SCHEMA COPY, NOT `migrate deploy`. The dev migration ledger still carries a
# failed 20260903020000_chase_attempts (P3009, see TODO.md), so a replay would
# stop on it. Copying the dev schema gives exactly the shape the running app
# expects, RLS policies included. Re-run this whenever the schema changes.
set -euo pipefail

CONTAINER="${POSTGRES_CONTAINER:-aobplatform-postgres}"
SOURCE_DB="${SOURCE_DB:-aobplatform}"
TEST_DB="${TEST_DB:-aobplatform_test}"

case "$TEST_DB" in
  *_test) ;;
  *) echo "refusing: TEST_DB must end in _test (got '$TEST_DB')" >&2; exit 1 ;;
esac

echo "rebuilding $TEST_DB from the schema of $SOURCE_DB ..."
docker exec "$CONTAINER" psql -U aobplatform -d postgres -q \
  -c "DROP DATABASE IF EXISTS $TEST_DB;" \
  -c "CREATE DATABASE $TEST_DB;"
docker exec "$CONTAINER" sh -c \
  "pg_dump -U aobplatform --schema-only $SOURCE_DB | psql -U aobplatform -d $TEST_DB -q"

tables=$(docker exec "$CONTAINER" psql -U aobplatform -d "$TEST_DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='core';")
policies=$(docker exec "$CONTAINER" psql -U aobplatform -d "$TEST_DB" -tAc \
  "SELECT count(*) FROM pg_policies WHERE schemaname='core';")
echo "$TEST_DB ready: $tables tables, $policies RLS policies"
