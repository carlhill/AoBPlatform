#!/usr/bin/env bash
# Tell AoBPlatform that the service has been rendered — the SECOND push. (DEV ONLY)
#
# The mirror image of arrive.sh. That one says a patient walked IN; this says
# they have been SEEN, and what was done: the day the service was rendered (D5)
# and its MBS item numbers (D6b — post-agreements only, REQ-REG-01; s 65C(4)
# table item 6). It posts `POST /arrivals/service-rendered` and the platform
# does the rest: it asks the VERSIONED post-service table whether a second
# signature is owed, and where it is, drafts an `episodic_post`, validates it,
# locks it and opens the in-practice request that puts the patient back on
# reception's desk — the same tablet, the same ceremony, one mechanism and two
# moments (TODO.md "Two front doors" decision (b)).
#
#   bash scripts/dev/service-rendered.sh                 # the same five, mixed outcomes
#   bash scripts/dev/service-rendered.sh "Riley Example|23"
#   bash scripts/dev/service-rendered.sh "Riley Example|23,10990|2026-09-10"
#
# RUN arrive.sh FIRST. A rendered service carries NO patient details and never
# creates a patient record from a billing message (REQ-DATA-10) — the five
# details rode in on the arrival, and a second copy arriving with an invoice is
# a second chance for the two to disagree. An unknown record number is refused
# with the fix named.
#
# WHAT YOU WILL SEE, AND IT IS DELIBERATELY TWO DIFFERENT THINGS.
#   * A patient whose pre-agreement for today is SIGNED comes back `covered`:
#     nothing is drafted, nothing is asked, and the desk shows a quiet history
#     line — "Covered by today's agreement" — under the queue. One signature per
#     episodic visit, not two.
#   * Everyone else comes back `episodic_post`: a locked post-agreement on
#     reception's desk, waiting for "Who is signing?" and then Send.
# To see the first outcome, sign one patient's pre-agreement at the tablet
# first; this script signs nothing.
#
# THE DECISION IS THE RULE SET'S, NOT THIS SCRIPT'S. There is no field here that
# could assert it, and the endpoint refuses one — the versioned table in
# `packages/domain/content/visit-agreement-policy.json` decides and its version
# travels onto the record (hard rule 14).
#
# NO AMOUNT, ANYWHERE. An invoice has a figure on it; an assignment of benefit
# does not (hard rule 4, REQ-REG-04), and the endpoint refuses any field that
# looks like money, out loud. No Medicare numbers either (hard rule 1).
#
# Needs: core on :3001 (npm run start:watch -w apps/core) and the postgres
# container (only to look up the default practitioner). Fake identities only.
set -euo pipefail

CORE="${CORE:-http://localhost:3001}"
PRACTICE_ID="${PRACTICE_ID:-821709fb-7f89-4fcf-95c0-27c5eb55cec8}"   # XLEVELUP Medical (dev)
PG=(docker exec -i -e PGPASSWORD=aobplatform aobplatform-postgres psql -U aobplatform -d aobplatform -A -t -q -v ON_ERROR_STOP=1)
RUN="$(date +%s)"
TODAY="$(date -u +%Y-%m-%d)"

# "Given Family|items|serviceDate(optional)|affiliationId(optional)".
# The same five people arrive.sh sends, so the two scripts compose: arrive.sh
# puts them on the desk on the way in, this one puts them back on it on the way
# out. Item numbers are real MBS shapes (1-5 digits) and nothing else about the
# claim is carried.
DEFAULTS=(
  "Jamie Sampleton|23"
  "Morgan Placeholder|36"
  "Riley Example|23,10990"
  "Alex Fictional|44"
  "Kim Specimen|23"
)
VISITS=("$@"); [ ${#VISITS[@]} -eq 0 ] && VISITS=("${DEFAULTS[@]}")

hdr=(-H "x-practice-id: ${PRACTICE_ID}" -H "content-type: application/json")

DEFAULT_AFFILIATION_ID="${AFFILIATION_ID:-$("${PG[@]}" -c "select id from core.affiliations where \"practiceId\"='${PRACTICE_ID}' and status in ('active','ending','invited') and \"billingRole\"='servicing_provider' order by \"invitedAt\" limit 1;")}"
[ -n "$DEFAULT_AFFILIATION_ID" ] || {
  echo "no servicing affiliation for practice ${PRACTICE_ID}."
  echo "Add a practitioner at a location first: POST /practices/${PRACTICE_ID}/providers"
  exit 1
}

for spec in "${VISITS[@]}"; do
  IFS='|' read -r fullname items service_date affiliation <<<"$spec"
  given="${fullname% *}"; family="${fullname##* }"
  slug="$(echo "${given}-${family}" | tr '[:upper:]' '[:lower:]')"
  affiliation="${affiliation:-$DEFAULT_AFFILIATION_ID}"
  service_date="${service_date:-$TODAY}"
  # The provider number where this affiliation holds one — it names the
  # practitioner AND the location by itself (FR-1.8), which is the shape a real
  # PMS invoice is likeliest to carry. Empty is lawful: s 65C(5)(a) identifies
  # the professional by name and place of practice instead.
  provider_number="$("${PG[@]}" -c "select coalesce(\"providerNumber\", '') from core.affiliations where id='${affiliation}';")"

  body="$(ITEMS="$items" DATE="$service_date" AFFIL="$affiliation" PROVNUM="$provider_number" \
          SLUG="$slug" RUN="$RUN" python -c '
import json, os
slug = os.environ["SLUG"]
# The provider number where there is one, the affiliation id otherwise. Never
# both: the server resolves either to the same practitioner at the same place,
# and sending two keys would hide which one a connector is actually relying on.
number = os.environ["PROVNUM"].strip()
who = {"providerNumber": number} if number else {"affiliationId": os.environ["AFFIL"]}
print(json.dumps({
  # The practice`s OWN handle for the person — the same key arrive.sh used, which
  # is what makes these two scripts describe one visit rather than two people.
  "pmsPatientRecordNumber": "DEV-" + slug.upper(),
  **who,
  "serviceDate": os.environ["DATE"],
  "mbsItemNumbers": [i.strip() for i in os.environ["ITEMS"].split(",") if i.strip()],
  "source": "dev",
  "idempotencyKey": "dev-svc-" + slug + "-" + os.environ["RUN"],
}))')"

  response="$(curl -sS "${hdr[@]}" -X POST "${CORE}/arrivals/service-rendered" -d "$body" || true)"
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
if "serviceRecordId" not in d:
    # A REFUSAL CARRIES A CODE OR A REASON, and reading it first saves a hunt.
    reason = d.get("reason")
    print("REFUSED  %-22s %-16s %s" % (name, reason or "-", d.get("message", d)))
    if not reason:
        print("         if this says \"no patient with record number\", run scripts/dev/arrive.sh first")
    sys.exit(0)
decision = d["decision"]
note = {
  "covered": "  (nothing to sign - today’s agreement covers it)",
  "covered_by_enduring": "  (nothing to sign - an ongoing agreement covers it)",
}.get(decision["outcome"], "")
print("rendered %-22s %-20s %s%s" % (name, decision["outcome"], decision["reason"], note))'
done

echo
echo "Now on reception's desk (GET /tablet-sessions/pushable):"
curl -sS -H "x-practice-id: ${PRACTICE_ID}" "${CORE}/tablet-sessions/pushable" 2>/dev/null \
  | python -c '
import sys, json
try:
    rows = json.load(sys.stdin)
except Exception:
    sys.exit("  (list not readable this way - open http://localhost:3100/practice/tablet)")
for r in rows:
    state = "ready" if r.get("pushable") else "blocked: %s" % r.get("blockedReason")
    items = ", ".join(r.get("mbsItemNumbers") or []) or "-"
    when = r.get("serviceDate") or r.get("appointmentDate") or "-"
    print("  - %-22s %-14s %-11s items %-12s %s" % (r.get("patientName"), r.get("agreementType"), when, items, state))' \
  || echo "  (list not readable this way - open http://localhost:3100/practice/tablet)"

echo
echo "Covered already today, needing nothing (GET /tablet-sessions/covered):"
curl -sS -H "x-practice-id: ${PRACTICE_ID}" "${CORE}/tablet-sessions/covered" 2>/dev/null \
  | python -c '
import sys, json
try:
    rows = json.load(sys.stdin)
except Exception:
    sys.exit("  (list not readable this way - open http://localhost:3100/practice/tablet)")
if not rows:
    print("  (none - sign a pre-agreement at the tablet, then run this script again)")
for r in rows:
    items = ", ".join(r.get("mbsItemNumbers") or []) or "-"
    print("  - %-22s %-28s %-11s items %s" % (r.get("patientName"), r.get("reason"), r.get("serviceDate"), items))' \
  || echo "  (list not readable this way - open http://localhost:3100/practice/tablet)"
