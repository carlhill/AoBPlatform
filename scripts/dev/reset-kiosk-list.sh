#!/usr/bin/env bash
# Reset the kiosk waiting list for the dev practice to the STANDARD FIVE.  (DEV ONLY)
#
#   bash scripts/dev/reset-kiosk-list.sh
#
# 1. Expires every open in-practice capture request for the practice — that is
#    what empties the kiosk list and the send-to-tablet list. Nothing is
#    deleted: agreements, verification events and vault events stay for the
#    audit trail; the requests just stop being open.
# 2. Stages the standard five through scripts/dev/stage-kiosk-patients.sh:
#    draft → in-practice request → particulars locked with a D6a. Existing
#    patients are matched by name, so re-running does not multiply patients.
#
# Needs: core on :3001 and the postgres container. Fake identities only.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

PRACTICE_ID="${PRACTICE_ID:-821709fb-7f89-4fcf-95c0-27c5eb55cec8}"   # XLEVELUP Medical (dev)
PG=(docker exec -i -e PGPASSWORD=aobplatform aobplatform-postgres psql -U aobplatform -d aobplatform -A -t -q -v ON_ERROR_STOP=1)

echo "Clearing the kiosk list for practice ${PRACTICE_ID}…"
CLEARED="$("${PG[@]}" -c "with u as (
    update core.capture_requests c set status='expired'
    from core.agreements a
    where c.\"agreementId\"=a.id and a.\"practiceId\"='${PRACTICE_ID}'
      and c.channel='in_practice' and c.status='open'
    returning 1)
  select count(*) from u;")"
echo "  ${CLEARED} open request(s) expired"

# The standard five. "Given Family|YYYY-MM-DD|address" — all obviously fake.
STANDARD=(
  "Jamie Sampleton|1962-08-04|2 Example Street, Sampletown NSW 2000"
  "Morgan Placeholder|1971-11-22|2 Example Street, Sampletown NSW 2000"
  "Riley Example|1988-03-09|7 Sample Road, Sampletown NSW 2000"
  "Alex Fictional|1954-12-01|12 Placeholder Street, Sampletown NSW 2000"
  "Kim Specimen|2001-07-21|3 Dummy Lane, Sampletown NSW 2000"
)

echo "Staging the standard five…"
PRACTICE_ID="$PRACTICE_ID" bash "$HERE/stage-kiosk-patients.sh" "${STANDARD[@]}"
