#!/usr/bin/env bash
# Create (or rebuild) the template every e2e run copies its database from.
#
# WHY THIS EXISTS. The e2e suites empty whole tables — unfiltered deleteMany on
# patient, agreement, assignor, practice, arrival and more — and until 11 Sep
# 2026 they did it to the DEV database, because jest.e2e.config.js set none of
# its own and picked up apps/core/.env. See apps/core/test/test-database.setup.ts.
#
# A TEMPLATE, NOT THE TEST DATABASE (11 Oct 2026). Until then this built the one
# aobplatform_test that every worktree's runs shared, and two agents running e2e
# at once deleted each other's rows. Now each run clones its own
# aobplatform_e2e_<stamp>_<random>_test from this template and drops it at the
# end — see apps/core/test/e2e-database.global-setup.ts. The template's name
# does not end in _test, so the e2e guard refuses to run against it directly.
#
# NO CONNECTIONS ONCE BUILT. CREATE DATABASE ... TEMPLATE fails while anything
# is connected to the template, so a GUI client left open on it would break
# every run. ALLOW_CONNECTIONS false makes that impossible.
#
# A SCHEMA COPY, NOT `migrate deploy`. The dev migration ledger still carries a
# failed 20260903020000_chase_attempts (P3009, see TODO.md), so a replay would
# stop on it. Copying the dev schema gives exactly the shape the running app
# expects, RLS policies included. Re-run this whenever the schema changes.
set -euo pipefail

CONTAINER="${POSTGRES_CONTAINER:-aobplatform-postgres}"
SOURCE_DB="${SOURCE_DB:-aobplatform}"
TEMPLATE_DB="${TEMPLATE_DB:-aobplatform_e2e_template}"

case "$TEMPLATE_DB" in
  *_e2e_template) ;;
  *) echo "refusing: TEMPLATE_DB must end in _e2e_template (got '$TEMPLATE_DB')" >&2; exit 1 ;;
esac

echo "rebuilding $TEMPLATE_DB from the schema of $SOURCE_DB ..."
docker exec "$CONTAINER" psql -U aobplatform -d postgres -q \
  -c "DROP DATABASE IF EXISTS $TEMPLATE_DB;" \
  -c "CREATE DATABASE $TEMPLATE_DB;"
docker exec "$CONTAINER" sh -c \
  "pg_dump -U aobplatform --schema-only $SOURCE_DB | psql -U aobplatform -d $TEMPLATE_DB -q"

tables=$(docker exec "$CONTAINER" psql -U aobplatform -d "$TEMPLATE_DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='core';")
policies=$(docker exec "$CONTAINER" psql -U aobplatform -d "$TEMPLATE_DB" -tAc \
  "SELECT count(*) FROM pg_policies WHERE schemaname='core';")

docker exec "$CONTAINER" psql -U aobplatform -d postgres -q \
  -c "ALTER DATABASE $TEMPLATE_DB WITH ALLOW_CONNECTIONS false;"
echo "$TEMPLATE_DB ready: $tables tables, $policies RLS policies"
