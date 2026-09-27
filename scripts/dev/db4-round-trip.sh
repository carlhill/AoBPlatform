#!/usr/bin/env bash
# Print a DB4 to AOBPRINTER and watch it become an agreement.  (DEV ONLY)
#
# WHAT THIS IS FOR. Carl can print a PracSoft DB4 to the AOBPRINTER printer and
# watch it turn into a post-service agreement on the tablet desk
# (DB4-AND-AOBL.md §13a piece 1) — but today that needs four things running,
# a stale spool file cleared, and a patient + servicing provider that match
# what the fixture prints. Six ways for a first run to go quiet. This script
# is the one command: it checks every prerequisite BY ITSELF and names the
# fix for whichever one is missing, rather than leaving Carl to guess which of
# the six it was.
#
#   bash scripts/dev/db4-round-trip.sh            # the whole round trip
#   bash scripts/dev/db4-round-trip.sh --status    # report prerequisites, touch nothing
#   bash scripts/dev/db4-round-trip.sh --stop      # stop a watcher THIS SCRIPT started
#
# WHAT IT STOPS AFTER. The signature, which now produces the Signed-DB4
# (piece 2, 27 Sep 2026): the practice's own form with the cost, the Medicare
# number in full and the patient's signature on it, hashed and evidenced.
# The write-back into the chart folder (piece 4) is NOT built, and no screen
# shows the document — so nothing lands in a folder, and the artefact row is
# the only place the Signed-DB4 exists.
#
# THE FIXTURE'S REAL VALUES, NOT WHAT YOU MIGHT EXPECT. The DB4 e2e spec
# (apps/core/test/db4-assignment.e2e-spec.ts) uses chart 00680 / provider
# 5745385T on ITS OWN throwaway practice. The printed fixture at
# apps/aobprinter/test-fixtures/pracsoft3-db4-probe.source.txt — the one this
# script actually prints — carries different, equally fake values: chart
# 09911, patient Testalina Fakesurname, servicing provider 9999999X (Dr
# Ficticia Nonperson). Verified by reading the fixture itself, not assumed;
# re-check with `grep -i "chart\|servicing" apps/aobprinter/test-fixtures/pracsoft3-db4-probe.source.txt`
# if the fixture ever changes. This script matches the fixture, not the spec.
#
# WHY THE SEED STEP CAN REFUSE, AND WHY THAT IS NOT A BUG IN THIS SCRIPT.
# `POST /practices/:id/providers` — the ordinary endpoint arrive.sh and
# stage-kiosk-patients.sh both point you at when a practice has no servicing
# affiliation — requires the practice to already have at least one location.
# Adding a location to an EXISTING practice has exactly one ordinary path,
# `POST /organisations/locations`, and it refuses any practice that was not
# created through full organisation onboarding (`assertValidated`). The
# practice AOBPRINTER's config points at was created directly (id
# a2629964-c984-4a07-8db6-c42f40243654, validationState "not_applicable") —
# it has never been onboarded and holds zero locations. There is no ordinary
# endpoint that can fix that for an id that already exists; only a full (and
# id-minting, so it cannot target this practice) onboarding journey, or a
# raw SQL insert, could — and the brief for this script rules raw SQL out for
# exactly this kind of seeding. So if you see this, it is a real, load-bearing
# gap in the DEV DATA, not a flaky check: this script says so by name and
# gives you the two ways out, and stops rather than reaching for SQL.
#
# NEEDS: read-only `docker`, `curl`, `python`, `node`, and `powershell.exe`
# (called via `-NoProfile -Command`/`-File`, never interactively). Every
# database touch here is a SELECT — the same pattern arrive.sh and
# stage-kiosk-patients.sh use for lookups; nothing is written to Postgres
# except through the ordinary HTTP endpoints.
set -euo pipefail

CORE="${CORE:-http://localhost:3001}"
WEB="${WEB:-http://localhost:3100}"
AOBPRINTER_DIR="apps/aobprinter"
CONFIG_PATH_WIN="${AOBPRINTER_CONFIG:-C:/ProgramData/AoBPlatform/aobprinter.config.json}"
PRINTER_NAME="AOBPRINTER"
FIXTURE="${AOBPRINTER_DIR}/test-fixtures/pracsoft3-db4-probe.source.txt"

# --- the fixture's own values (verified against the .source.txt on disk; see header) ---
CHART_NUMBER="09911"
PATIENT_GIVEN="Testalina"
PATIENT_FAMILY="Fakesurname"
PATIENT_DOB="1972-02-02"
PATIENT_ADDRESS="3 Imaginary Ave, Fakevale NSW 2999"
PATIENT_MOBILE="+61400000001"
SERVICING_PROVIDER_NUMBER="9999999X"
SERVICING_AHPRA="MED9099110001"   # dedicated to this harness; not a real register number
SERVICING_NAME="Dr Ficticia Nonperson"
FORM_REFERENCE="HSS0610012092026120300"

PG=(docker exec -i -e PGPASSWORD=aobplatform aobplatform-postgres psql -U aobplatform -d aobplatform -A -t -q -v ON_ERROR_STOP=1)

# --- little helpers ----------------------------------------------------------

say() { printf '%s\n' "$*"; }
section() { printf '\n== %s ==\n' "$*"; }

# A failed stage names itself, what is wrong, and the exact command to fix it.
# Nothing else runs afterwards — CLAUDE.md §7c: "shortcuts to the answer".
fail() {
  printf '\nFAILED: %s\n' "$1" >&2
  [ -n "${2:-}" ] && printf 'fix:    %s\n' "$2" >&2
  exit 1
}

json_field() {
  # json_field '<json>' key -> value, or empty string if absent/unreadable.
  python -c '
import json, sys
try:
    d = json.loads(sys.argv[1])
except ValueError:
    sys.exit(0)
v = d
for k in sys.argv[2].split("."):
    if not isinstance(v, dict) or k not in v:
        sys.exit(0)
    v = v[k]
print(v if v is not None else "")
' "$1" "$2" 2>/dev/null || true
}

# --- preflight, each check separate and named ---------------------------------
#
# Returns 0/prints nothing on success; on failure prints the two-line block
# above and returns 1 (callers decide whether to stop there or keep going —
# `--status` keeps going through every check, the real run stops at the first).

check_postgres() {
  docker ps --filter "name=^aobplatform-postgres$" --filter "status=running" -q 2>/dev/null | grep -q .
}

check_core() {
  curl -sf -o /dev/null "${CORE}/health"
}

check_web() {
  code="$(curl -s -o /dev/null -w '%{http_code}' "${WEB}/" 2>/dev/null || echo 000)"
  [ "$code" -ge 200 ] && [ "$code" -lt 400 ]
}

check_dist() {
  [ -f "${AOBPRINTER_DIR}/dist/src/main.js" ]
}

check_printer() {
  powershell.exe -NoProfile -Command \
    "if (Get-Printer -Name '${PRINTER_NAME}' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" \
    >/dev/null 2>&1
}

# Reads the config into the CFG_* globals. Fails loudly on missing file or bad JSON.
load_config() {
  local raw
  raw="$(cat "$CONFIG_PATH_WIN" 2>/dev/null)" || return 1
  CFG_PRACTICE_ID="$(json_field "$raw" practiceId)"
  CFG_ENDPOINT="$(json_field "$raw" endpoint)"
  CFG_DATA_DIR="$(json_field "$raw" dataDir)"
  CFG_SPOOL_FILE="$(json_field "$raw" spoolFile)"
  [ -n "$CFG_PRACTICE_ID" ] && [ -n "$CFG_ENDPOINT" ] || return 1
  CFG_DATA_DIR="${CFG_DATA_DIR:-C:/ProgramData/AoBPlatform}"
  CFG_SPOOL_FILE="${CFG_SPOOL_FILE:-${CFG_DATA_DIR}/spool/aobprinter-out.pdf}"
  return 0
}

check_practice_exists() {
  curl -sf -o /dev/null -H "x-practice-id: ${CFG_PRACTICE_ID}" "${CORE}/practices/${CFG_PRACTICE_ID}"
}

# One pass over every prerequisite, in the order the brief names them.
# Used by both the real run (stop at first failure) and --status (report all).
run_preflight() {
  local stop_on_failure="$1" any_failed=0

  if check_postgres; then say "[ok]   postgres container (aobplatform-postgres) is up"
  else
    any_failed=1
    say "[FAIL] postgres container (aobplatform-postgres) is not running"
    say "       fix: docker compose up -d postgres immudb keycloak mailhog rules vault"
    [ "$stop_on_failure" = 1 ] && fail "postgres is not running" "docker compose up -d postgres immudb keycloak mailhog rules vault"
  fi

  if check_core; then say "[ok]   core is answering on :3001"
  else
    any_failed=1
    say "[FAIL] core is not answering on :3001"
    say "       fix: npm run start:watch -w apps/core"
    [ "$stop_on_failure" = 1 ] && fail "core is not answering on :3001" "npm run start:watch -w apps/core"
  fi

  if check_web; then say "[ok]   web is answering on :3100"
  else
    any_failed=1
    say "[FAIL] web is not answering on :3100"
    say "       fix: npm run dev -w apps/web"
    [ "$stop_on_failure" = 1 ] && fail "web is not answering on :3100" "npm run dev -w apps/web"
  fi

  if check_dist; then say "[ok]   ${AOBPRINTER_DIR}/dist/src/main.js exists"
  else
    any_failed=1
    say "[FAIL] ${AOBPRINTER_DIR}/dist/src/main.js is missing"
    say "       fix: npm run build -w apps/aobprinter"
    [ "$stop_on_failure" = 1 ] && fail "${AOBPRINTER_DIR}/dist/src/main.js is missing" "npm run build -w apps/aobprinter"
  fi

  if check_printer; then say "[ok]   printer \"${PRINTER_NAME}\" exists"
  else
    any_failed=1
    say "[FAIL] printer \"${PRINTER_NAME}\" was not found (Get-Printer)"
    say "       fix: powershell.exe -NoProfile -File ${AOBPRINTER_DIR}/install/Install-AobPrinter.ps1"
    [ "$stop_on_failure" = 1 ] && fail "printer \"${PRINTER_NAME}\" was not found" \
      "powershell.exe -NoProfile -File ${AOBPRINTER_DIR}/install/Install-AobPrinter.ps1"
  fi

  if load_config; then
    say "[ok]   ${CONFIG_PATH_WIN} exists and parses (practice ${CFG_PRACTICE_ID})"
  else
    any_failed=1
    say "[FAIL] ${CONFIG_PATH_WIN} is missing or is not valid JSON with practiceId + endpoint"
    say "       fix: powershell.exe -NoProfile -File ${AOBPRINTER_DIR}/install/Install-AobPrinter.ps1, or write the file by hand"
    [ "$stop_on_failure" = 1 ] && fail "${CONFIG_PATH_WIN} is missing or unreadable" \
      "powershell.exe -NoProfile -File ${AOBPRINTER_DIR}/install/Install-AobPrinter.ps1"
  fi

  if [ -n "${CFG_PRACTICE_ID:-}" ]; then
    if ! check_core; then
      any_failed=1
      say "[--]   practice ${CFG_PRACTICE_ID}: cannot check — core is down (see above)"
    elif check_practice_exists; then
      say "[ok]   practice ${CFG_PRACTICE_ID} exists in the database"
    else
      any_failed=1
      say "[FAIL] practice ${CFG_PRACTICE_ID} was not found (GET /practices/${CFG_PRACTICE_ID})"
      say "       fix: check aobprinter.config.json's practiceId, or POST /practices to create it"
      [ "$stop_on_failure" = 1 ] && fail "practice ${CFG_PRACTICE_ID} was not found" \
        "check ${CONFIG_PATH_WIN}'s practiceId, or POST /practices to create it"
    fi
  fi

  return "$any_failed"
}

# --- watcher lifecycle ---------------------------------------------------------
#
# Ownership is the pidfile: this script only ever kills a PID IT wrote there
# itself. If the pidfile names a live process, that watcher belongs to some
# run of this script (this one or an earlier one) and is reused rather than
# duplicated — two watchers on one spool file is a form posted twice or lost
# (watcher.ts's own header). "Never kill a watcher it did not start" (the
# brief) is enforced structurally: nothing here ever kills a PID it did not
# itself read from this file.

# Does the patient exist right now? The same question the pre-check asks,
# asked again AFTER the arrival, because the arrival can be refused at the
# agreement lock long after the patient row is committed.
patient_exists() {
  local hit
  hit="$(curl -sS -H "x-practice-id: ${CFG_PRACTICE_ID}" -H 'content-type: application/json'     "${CORE}/patients/search?q=${CHART_NUMBER}" 2>/dev/null |     python -c '
import json, sys
try:
    rows = json.load(sys.stdin)
except ValueError:
    rows = []
print("yes" if any(r.get("patientRecordNumber") == sys.argv[1] for r in rows) else "no")
' "$CHART_NUMBER" 2>/dev/null || echo no)"
  [ "$hit" = yes ]
}

pid_alive() {
  # `kill -0` on a Windows PID works under MSYS's process emulation for a
  # process this same shell tree can see; that is exactly the node child we
  # spawn below.
  kill -0 "$1" >/dev/null 2>&1
}

watcher_status() {
  # Prints "running <pid> <log>" or "stopped". Touches nothing.
  if [ -f "$WATCHER_PIDFILE" ]; then
    local pid; pid="$(cat "$WATCHER_PIDFILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && pid_alive "$pid"; then
      echo "running $pid $WATCHER_LOG"
      return 0
    fi
  fi
  echo "stopped"
  return 1
}

start_watcher() {
  WATCHER_STARTED_BY_THIS_RUN=0
  local status; status="$(watcher_status || true)"
  if [ "${status%% *}" = "running" ]; then
    WATCHER_PID="$(echo "$status" | cut -d' ' -f2)"
    say "watcher already running (pid ${WATCHER_PID}, started by an earlier run) — reusing it, log at ${WATCHER_LOG}"
    return 0
  fi

  : > "$WATCHER_LOG"
  ( cd "$AOBPRINTER_DIR" && AOBPRINTER_CONFIG="$CONFIG_PATH_WIN" exec node dist/src/main.js ) >>"$WATCHER_LOG" 2>&1 &
  WATCHER_PID=$!
  echo "$WATCHER_PID" > "$WATCHER_PIDFILE"
  WATCHER_STARTED_BY_THIS_RUN=1

  local waited=0
  while [ "$waited" -lt 10000 ]; do
    if grep -q "aobprinter.started" "$WATCHER_LOG" 2>/dev/null; then
      say "watcher started (pid ${WATCHER_PID}), log at ${WATCHER_LOG}"
      return 0
    fi
    if ! pid_alive "$WATCHER_PID"; then
      rm -f "$WATCHER_PIDFILE"
      fail "the watcher process died on startup — see ${WATCHER_LOG}" "tail ${WATCHER_LOG}"
    fi
    sleep 0.25; waited=$((waited + 250))
  done
  fail "the watcher did not report \"aobprinter.started\" within 10s — see ${WATCHER_LOG}" "tail ${WATCHER_LOG}"
}

stop_watcher_we_started() {
  if [ "${WATCHER_STARTED_BY_THIS_RUN:-0}" = 1 ] && [ -n "${WATCHER_PID:-}" ]; then
    if pid_alive "$WATCHER_PID"; then
      kill "$WATCHER_PID" >/dev/null 2>&1 || true
      say "stopped the watcher this run started (pid ${WATCHER_PID})"
    fi
    rm -f "$WATCHER_PIDFILE"
  fi
}

cmd_stop() {
  local status; status="$(watcher_status || true)"
  if [ "${status%% *}" = "running" ]; then
    local pid; pid="$(echo "$status" | cut -d' ' -f2)"
    kill "$pid" >/dev/null 2>&1 || true
    rm -f "$WATCHER_PIDFILE"
    say "stopped the watcher this script started (pid ${pid})"
  else
    say "no watcher started by this script is running"
    rm -f "$WATCHER_PIDFILE" 2>/dev/null || true
  fi
}

# --- the round trip -------------------------------------------------------------

clear_stale_spool() {
  section "clear the stale spool"
  if [ -f "$CFG_SPOOL_FILE" ]; then
    local size; size="$(stat -c %s "$CFG_SPOOL_FILE" 2>/dev/null || echo '?')"
    rm -f "$CFG_SPOOL_FILE"
    say "removed a stale spool file (${size} bytes) — the first job this run claims will be the one it prints"
  else
    say "no stale spool file — nothing to clear"
  fi
  local pending_dir="${CFG_DATA_DIR}/outbox/pending"
  local pending_count=0
  if [ -d "$pending_dir" ]; then
    pending_count="$(find "$pending_dir" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')"
  fi
  if [ "$pending_count" -gt 0 ]; then
    say "note: ${pending_dir} already holds ${pending_count} job(s) waiting to be posted (left alone)"
  else
    say "outbox/pending is empty"
  fi
}

hdr=()

seed_match() {
  section "seed the match"
  hdr=(-H "x-practice-id: ${CFG_PRACTICE_ID}" -H "content-type: application/json")

  # --- the servicing provider --------------------------------------------
  local roster live_id
  roster="$(curl -sS "${hdr[@]}" "${CORE}/affiliations" 2>/dev/null || echo '[]')"
  live_id="$(python -c '
import json, sys
try:
    rows = json.loads(sys.argv[1])
except ValueError:
    rows = []
target = sys.argv[2]
for r in rows:
    p = r.get("practitioner") or {}
    if p.get("ahpraNumber") == target and r.get("status") in ("active", "ending", "invited") and r.get("billingRole") == "servicing_provider":
        print(r["id"]); break
' "$roster" "$SERVICING_AHPRA" 2>/dev/null || true)"

  if [ -n "$live_id" ]; then
    say "servicing provider ${SERVICING_PROVIDER_NUMBER} (${SERVICING_NAME}): already present (affiliation ${live_id})"
  else
    local locations location_count location_id
    locations="$(curl -sS "${hdr[@]}" "${CORE}/organisations/locations" 2>/dev/null || echo '[]')"
    location_count="$(python -c 'import json,sys; print(len(json.loads(sys.argv[1])))' "$locations" 2>/dev/null || echo 0)"

    if [ "$location_count" -eq 0 ]; then
      cat >&2 <<EOF

FAILED: practice ${CFG_PRACTICE_ID} has no location and is not onboarded
        (validationState "not_applicable"), so there is no ordinary endpoint
        that can add one to it — POST /organisations/locations refuses any
        practice that was not created through full organisation onboarding,
        and onboarding mints its OWN practice id rather than adopting this
        one. POST /practices/:id/providers (the usual fix for "no servicing
        affiliation") needs a location to exist first, so it cannot help
        either. This script does not fall back to raw SQL for seeding data
        (the brief this script was built from rules that out explicitly).

        Two ways out, Carl's call:
          (a) point AOBPRINTER at an already-onboarded dev practice instead —
              POST ${CORE}/dev/seed mints one, with a location, a servicing
              provider and a patient already in place — then update
              practiceId in ${CONFIG_PATH_WIN} and restart the watcher; or
          (b) decide this practice should keep this id and have Carl add one
              practice_locations row for it by hand (the one write this
              script will not make for you).
EOF
      exit 1
    fi

    location_id="$(python -c 'import json,sys; print(json.loads(sys.argv[1])[0]["id"])' "$locations")"

    local pre_status
    pre_status="$(curl -sS -o /dev/null -w '%{http_code}' "${hdr[@]}" -X POST "${CORE}/practitioners" \
      -d "{\"ahpraNumber\":\"${SERVICING_AHPRA}\",\"familyName\":\"Nonperson\",\"givenNames\":\"Dr Ficticia\",\"providerType\":\"general_practitioner\"}")"
    if [ "$pre_status" -ge 300 ] && [ "$pre_status" != 409 ]; then
      fail "POST /practitioners refused (${pre_status}) while seeding the servicing provider" "inspect the response by hand: curl -X POST ${CORE}/practitioners -H 'x-practice-id: ${CFG_PRACTICE_ID}' -d '{...}'"
    fi

    local add_resp add_status
    add_resp="$(curl -sS -w '\n%{http_code}' "${hdr[@]}" -X POST "${CORE}/practices/${CFG_PRACTICE_ID}/providers" \
      -d "{\"name\":\"${SERVICING_NAME}\",\"providerType\":\"general_practitioner\",\"ahpraNumber\":\"${SERVICING_AHPRA}\",\"locationId\":\"${location_id}\",\"providerNumber\":\"${SERVICING_PROVIDER_NUMBER}\"}")"
    add_status="$(echo "$add_resp" | tail -1)"
    if [ "$add_status" -ge 300 ]; then
      fail "POST /practices/${CFG_PRACTICE_ID}/providers refused (${add_status})" "$(echo "$add_resp" | head -n -1)"
    fi
    say "servicing provider ${SERVICING_PROVIDER_NUMBER} (${SERVICING_NAME}): created"
  fi

  # --- the patient ---------------------------------------------------------
  local search_hit
  search_hit="$(curl -sS "${hdr[@]}" "${CORE}/patients/search?q=${CHART_NUMBER}" 2>/dev/null | \
    python -c '
import json, sys
try:
    rows = json.load(sys.stdin)
except ValueError:
    rows = []
print("yes" if any(r.get("patientRecordNumber") == sys.argv[1] for r in rows) else "no")
' "$CHART_NUMBER" 2>/dev/null || echo no)"

  local arrival_body arrival_resp arrival_id
  arrival_body="$(python -c '
import json
print(json.dumps({
  "pmsPatientRecordNumber": "'"${CHART_NUMBER}"'",
  "familyName": "'"${PATIENT_FAMILY}"'",
  "givenNames": "'"${PATIENT_GIVEN}"'",
  "dateOfBirth": "'"${PATIENT_DOB}"'",
  "address": "'"${PATIENT_ADDRESS}"'",
  "mobile": "'"${PATIENT_MOBILE}"'",
  "email": "testalina-fakesurname@example.invalid",
  "providerNumber": "'"${SERVICING_PROVIDER_NUMBER}"'",
  "arrivedAt": "2026-01-01T00:00:00.000Z",
  "source": "dev",
  "idempotencyKey": "dev-db4-round-trip-'"${CHART_NUMBER}"'",
}))')"
  # arrivedAt is a fixed instant, deliberately: this seed step only needs the
  # patient and the affiliation to exist, and a fixed idempotencyKey is what
  # makes a second run of this script top up rather than raising a second
  # arrival event for the same "visit".
  arrival_resp="$(curl -sS "${hdr[@]}" -X POST "${CORE}/arrivals" -d "$arrival_body" 2>/dev/null || true)"
  arrival_id="$(json_field "$arrival_resp" arrivalId)"

  #
  # THE TEST IS "DOES THE PATIENT EXIST", NOT "DID THE ARRIVAL SUCCEED".
  #
  # `POST /arrivals` does several things: it mirrors the patient, ensures an
  # assignor, decides what the visit needs, drafts an agreement and opens a
  # capture request. This step wants only the FIRST of those. At a practice
  # with a default service description the arrival goes on to lock the draft
  # and can be REFUSED there -- D5, the service date against the agreement
  # date, because `arrivedAt` here is a fixed instant in the past -- long
  # after the patient row has been committed.
  #
  # Measured at XLEVELUP Medical on 27 September 2026: the arrival was refused,
  # the patient existed, and this script stopped anyway and reported a failure
  # that was not one. So: ask the database. A refused arrival whose patient
  # landed is a success for this step, and it is said out loud rather than
  # hidden, because the refusal is still worth seeing.
  #
  if patient_exists; then
    if [ "$search_hit" = yes ]; then
      say "patient ${CHART_NUMBER} (${PATIENT_GIVEN} ${PATIENT_FAMILY}): already present"
    else
      say "patient ${CHART_NUMBER} (${PATIENT_GIVEN} ${PATIENT_FAMILY}): created"
    fi
    if [ -z "$arrival_id" ]; then
      say "  (the arrival itself was refused; only the patient was needed here)"
      say "  ${arrival_resp}"
    fi
  else
    fail "the patient ${CHART_NUMBER} does not exist after POST /arrivals" "$arrival_resp"
  fi
}

print_fixture() {
  section "print the fixture"
  [ -f "$FIXTURE" ] || fail "fixture not found: ${FIXTURE}"
  powershell.exe -NoProfile -Command \
    "Get-Content '${FIXTURE}' | Out-Printer -Name '${PRINTER_NAME}'"
  say "printed ${FIXTURE} to ${PRINTER_NAME}"
}

# Waits until COND (a bash function name, called with no args, 0 = satisfied)
# is true, polling every 0.25s up to TIMEOUT_S seconds. On timeout, fails with
# MSG.
wait_for() {
  local cond="$1" timeout_s="$2" msg="$3" waited=0
  while [ "$waited" -lt "$((timeout_s * 1000))" ]; do
    if "$cond"; then return 0; fi
    sleep 0.25; waited=$((waited + 250))
  done
  fail "$msg"
}

poll_pipeline() {
  section "poll the pipeline"

  spool_exists() { [ -f "$CFG_SPOOL_FILE" ]; }
  if wait_for spool_exists 10 "the spool file never appeared at ${CFG_SPOOL_FILE} — did the print actually reach ${PRINTER_NAME}?"; then
    say "[ok]   spool file appeared"
  fi

  spool_gone() { [ ! -f "$CFG_SPOOL_FILE" ]; }
  wait_for spool_gone 10 "the spool file was never claimed — is the watcher still running? (pid ${WATCHER_PID:-unknown}, log ${WATCHER_LOG})"
  say "[ok]   spool file claimed (gone)"

  local job_row=""
  job_appeared() {
    job_row="$("${PG[@]}" -c "select id from core.inbound_print_jobs where \"practiceId\"='${CFG_PRACTICE_ID}' and \"documentType\"='db4_assignment' and \"receivedAt\" >= '${RUN_STARTED_AT}' order by \"receivedAt\" desc limit 1;")"
    [ -n "$job_row" ]
  }
  wait_for job_appeared 20 "no new InboundPrintJob row appeared for practice ${CFG_PRACTICE_ID} after 20s — check the watcher's log (${WATCHER_LOG}) for a post failure"
  say "[ok]   InboundPrintJob row appeared (${job_row})"

  local job_state=""
  job_done() {
    job_state="$("${PG[@]}" -c "select state from core.inbound_print_jobs where id='${job_row}';")"
    [ "$job_state" = "done" ] || [ "$job_state" = "failed" ] || [ "$job_state" = "dead" ]
  }
  wait_for job_done 20 "job ${job_row} never reached a final state within 20s — is core's inbound lane worker running? (it runs inside core, not this script)"

  if [ "$job_state" != "done" ]; then
    local last_error; last_error="$("${PG[@]}" -c "select coalesce(\"lastError\",'') from core.inbound_print_jobs where id='${job_row}';")"
    fail "job ${job_row} ended in state \"${job_state}\": ${last_error}" "GET ${CORE}/inbound/print-jobs/metrics -H 'x-practice-id: ${CFG_PRACTICE_ID}'"
  fi
  say "[ok]   job ${job_row} is done"

  local outcome placed agreement_id reason
  outcome="$("${PG[@]}" -c "select outcome::text from core.inbound_print_jobs where id='${job_row}';")"
  placed="$(json_field "$outcome" db4.placed)"
  agreement_id="$(json_field "$outcome" db4.agreementId)"
  reason="$(json_field "$outcome" db4.reason)"

  if [ "$placed" != "True" ] || [ -z "$agreement_id" ]; then
    fail "the job finished without placing an agreement — reason: ${reason:-unknown}" \
      "see DB4_PLACEMENT_REASONS in packages/contracts/src/print-capture.ts for what \"${reason:-unknown}\" means"
  fi

  if ! curl -sf -o /dev/null -H "x-practice-id: ${CFG_PRACTICE_ID}" "${CORE}/agreements/${agreement_id}"; then
    fail "outcome named agreement ${agreement_id} but GET /agreements/${agreement_id} does not confirm it"
  fi
  say "[ok]   agreement ${agreement_id} exists"
  AGREEMENT_ID="$agreement_id"
}

report_next_steps() {
  section "what to do next"
  say "agreement:   ${AGREEMENT_ID}"
  say "tablet desk: ${WEB}/practice/tablet"
  say "Reception pushes it to a tablet from there; the patient signs on the tablet."
  say ""
  say "On signing, the Signed-DB4 is produced: the practice's own form with the"
  say "cost, the Medicare number in full and the patient's signature on it,"
  say "stored as an artefact with its own hash and vault event (piece 2)."
  say ""
  say "Reminder: NOTHING LANDS IN A CHART FOLDER YET. The write-back (piece 4)"
  say "is not built, and there is no screen for the Signed-DB4 — the artefact"
  say "row is the only place it exists."
}

# --- entry points ---------------------------------------------------------------

cmd_status() {
  section "prerequisites"
  run_preflight 0 || true
  if [ -n "${CFG_DATA_DIR:-}" ]; then
    WATCHER_PIDFILE="${CFG_DATA_DIR}/dev-watcher.pid"
    WATCHER_LOG="${CFG_DATA_DIR}/dev-watcher.log"
    section "watcher"
    say "$(watcher_status || true)"
    section "spool"
    if [ -f "${CFG_SPOOL_FILE:-}" ]; then
      say "spool file present at ${CFG_SPOOL_FILE}"
    else
      say "spool file: none"
    fi
    local pending_dir="${CFG_DATA_DIR}/outbox/pending"
    local pending_count=0
    [ -d "$pending_dir" ] && pending_count="$(find "$pending_dir" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')"
    say "outbox/pending: ${pending_count} job(s)"
  fi
}

cmd_run() {
  run_preflight 1

  WATCHER_PIDFILE="${CFG_DATA_DIR}/dev-watcher.pid"
  WATCHER_LOG="${CFG_DATA_DIR}/dev-watcher.log"
  WATCHER_STARTED_BY_THIS_RUN=0
  trap 'stop_watcher_we_started' EXIT INT TERM

  clear_stale_spool
  seed_match

  section "start the watcher"
  start_watcher

  RUN_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  print_fixture
  poll_pipeline
  report_next_steps
}

case "${1:-}" in
  --status) cmd_status ;;
  --stop)
    if load_config; then
      WATCHER_PIDFILE="${CFG_DATA_DIR}/dev-watcher.pid"
      WATCHER_LOG="${CFG_DATA_DIR}/dev-watcher.log"
    else
      WATCHER_PIDFILE="C:/ProgramData/AoBPlatform/dev-watcher.pid"
    fi
    cmd_stop
    ;;
  "") cmd_run ;;
  *) fail "unknown argument: $1" "bash scripts/dev/db4-round-trip.sh [--status|--stop]" ;;
esac
