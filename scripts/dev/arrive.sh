#!/usr/bin/env bash
# Tell AoBPlatform that patients have walked up to reception.  (DEV ONLY)
#
# This is the arrival contract (TODO.md "Reception-centric" section 2) driven by
# hand. It posts `POST /arrivals` — the same message the site connector will
# send once D-01 is resolved and we know whether Medtech pushes or we poll — and
# the platform does the rest: mirrors the patient from the details in the
# message (the PMS is the source of truth, REQ-DATA-10), ensures the patient's
# own assignor record, DECIDES what the visit needs from the versioned visit
# policy, and drafts + opens the in-practice request that puts them on
# reception's queue.
#
#   bash scripts/dev/arrive.sh                                   # the standard five
#   bash scripts/dev/arrive.sh "Riley Example|1988-03-09|7 Sample Road, Sampletown NSW 2000"
#   bash scripts/dev/arrive.sh "Riley Example|1988-03-09|7 Sample Road|<providerId>"
#
# HOW THIS DIFFERS FROM stage-kiosk-patients.sh, WHICH IS STILL HERE.
# The staging script reaches into Postgres, inserts the patient and the assignor
# itself, and then calls four endpoints in the order a reception push would —
# it MIMICS the sequence. This sends ONE message and lets the platform perform
# it, which is the point: it exercises the code a real connector will drive,
# including the decision the PMS is not allowed to make. Nothing here touches
# the database.
#
# WHAT YOU WILL SEE ON THE QUEUE, AND WHY IT MAY NOT BE WHAT YOU EXPECT.
# The decision is the rule set's, not this script's. At a GP practice with the
# enduring default on, a first visit decides `enduring` — and an enduring draft
# cannot be locked or pushed yet, because the s 65C rule set has no enduring
# path (a human-authored zone; the queue shows `enduring_rules_not_authored`). That
# is GA-PLAN B5's job. To see the ordinary episodic pre-agreement flow today,
# pass a NON-GP provider's id as the fourth field, or use
# scripts/dev/reset-kiosk-list.sh, which stages episodic drafts directly and is
# deliberately left alone for exactly this reason.
#
# Needs: core on :3001 (npm run start:watch -w apps/core) and the postgres
# container (only to look up the default provider). Fake identities only, and
# no Medicare numbers anywhere — the endpoint refuses any field with "medicare"
# in its name, out loud (CLAUDE.md rule 1).
set -euo pipefail

CORE="${CORE:-http://localhost:3001}"
PRACTICE_ID="${PRACTICE_ID:-821709fb-7f89-4fcf-95c0-27c5eb55cec8}"   # XLEVELUP Medical (dev)
PG=(docker exec -i -e PGPASSWORD=aobplatform aobplatform-postgres psql -U aobplatform -d aobplatform -A -t -q -v ON_ERROR_STOP=1)
RUN="$(date +%s)"

# "Given Family|YYYY-MM-DD|address|providerId(optional)" — fake identities only.
DEFAULTS=(
  "Jamie Sampleton|1962-08-04|2 Example Street, Sampletown NSW 2000"
  "Morgan Placeholder|1971-11-22|2 Example Street, Sampletown NSW 2000"
  "Riley Example|1988-03-09|7 Sample Road, Sampletown NSW 2000"
  "Alex Fictional|1954-12-01|12 Placeholder Street, Sampletown NSW 2000"
  "Kim Specimen|2001-07-21|3 Dummy Lane, Sampletown NSW 2000"
)
PATIENTS=("$@"); [ ${#PATIENTS[@]} -eq 0 ] && PATIENTS=("${DEFAULTS[@]}")

hdr=(-H "x-practice-id: ${PRACTICE_ID}" -H "content-type: application/json")

DEFAULT_PROVIDER_ID="${PROVIDER_ID:-$("${PG[@]}" -c "select id from core.providers where \"practiceId\"='${PRACTICE_ID}' and active order by name limit 1;")}"
[ -n "$DEFAULT_PROVIDER_ID" ] || { echo "no active provider for practice ${PRACTICE_ID}"; exit 1; }

for spec in "${PATIENTS[@]}"; do
  IFS='|' read -r fullname dob address provider <<<"$spec"
  given="${fullname% *}"; family="${fullname##* }"
  slug="$(echo "${given}-${family}" | tr '[:upper:]' '[:lower:]')"
  provider="${provider:-$DEFAULT_PROVIDER_ID}"

  # The patient record number is the practice's OWN handle for this person —
  # what reception reads off the screen in front of them, and the key the
  # platform matches its mirror row on.
  body="$(GIVEN="$given" FAMILY="$family" DOB="$dob" ADDR="$address" PROV="$provider" \
          SLUG="$slug" RUN="$RUN" python -c '
import json, os, datetime
slug = os.environ["SLUG"]
print(json.dumps({
  "pmsPatientRecordNumber": "DEV-" + slug.upper(),
  "familyName": os.environ["FAMILY"],
  "givenNames": os.environ["GIVEN"],
  "dateOfBirth": os.environ["DOB"],
  "address": os.environ["ADDR"],
  "mobile": "+61400000999",
  "email": slug + "@example.invalid",
  "providerId": os.environ["PROV"],
  "arrivedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
  "source": "dev",
  "idempotencyKey": "dev-" + slug + "-" + os.environ["RUN"],
}))')"

  response="$(curl -sS "${hdr[@]}" -X POST "${CORE}/arrivals" -d "$body" || true)"
  if [ -z "$response" ]; then
    echo "  ${fullname}: no response from ${CORE} — is core running on :3001?"
    continue
  fi
  printf '%s' "$response" | FULLNAME="$fullname" python -c '
import sys, json, os
name = os.environ["FULLNAME"]
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except ValueError:
    sys.exit("  %-22s UNREADABLE: %s" % (name, raw[:200]))
if "arrivalId" not in d:
    sys.exit("  %-22s REFUSED: %s" % (name, d.get("message", d)))
decision = d["decision"]
note = {
  "enduring": "  (enduring drafts cannot be pushed yet - GA-PLAN B5)",
  "none": "  (already covered - nothing to sign)",
}.get(decision["type"], "")
print("arrived  %-22s %-13s %s%s" % (name, decision["type"], decision["reason"], note))'
done

echo
echo "Now on reception's queue (GET /tablet-sessions/pushable):"
curl -sS -H "x-practice-id: ${PRACTICE_ID}" "${CORE}/tablet-sessions/pushable" 2>/dev/null \
  | python -c '
import sys, json
try:
    rows = json.load(sys.stdin)
except Exception:
    sys.exit("  (list not readable this way - open http://localhost:3100/practice/tablet)")
for r in rows:
    state = "ready" if r.get("pushable") else "blocked: %s" % r.get("blockedReason")
    print("  - %-22s %-14s %s" % (r.get("patientName"), r.get("agreementType"), state))' \
  || echo "  (list not readable this way - open http://localhost:3100/practice/tablet)"
