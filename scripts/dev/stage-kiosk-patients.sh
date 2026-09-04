#!/usr/bin/env bash
# Stage waiting patients for the kiosk at http://localhost:3100/kiosk  (DEV ONLY)
#
# For each name below it creates an obviously-fake patient (if missing), the
# patient's own assignor record, a pre-agreement draft, an in-practice capture
# request, then locks the particulars with a D6a from the current mapping — the
# same sequence apps/web/e2e/kiosk-ceremony.spec.ts uses, and the shape a
# reception push will produce. No Medicare numbers anywhere (CLAUDE.md rule 1).
#
#   bash scripts/dev/stage-kiosk-patients.sh                 # stage the default four
#   bash scripts/dev/stage-kiosk-patients.sh "Riley Example|1988-03-09|7 Sample Road, Sampletown NSW 2000"
#
# Needs: core on :3001 (npm run start:watch -w apps/core) and the postgres
# container. Re-running is safe: patients are matched by name, and an extra run
# just adds another waiting row for them (expire the extras in the DB if that
# gets noisy).
set -euo pipefail

CORE="${CORE:-http://localhost:3001}"
PRACTICE_ID="${PRACTICE_ID:-821709fb-7f89-4fcf-95c0-27c5eb55cec8}"   # XLEVELUP Medical (dev)
PG=(docker exec -i -e PGPASSWORD=aobplatform aobplatform-postgres psql -U aobplatform -d aobplatform -A -t -q -v ON_ERROR_STOP=1)
D6A="${D6A:-General practitioner attendance}"   # must be an exact string from the current mapping
TODAY="$(date +%F)"

# "Given Family|YYYY-MM-DD|address"  — fake identities only.
DEFAULTS=(
  "Riley Example|1988-03-09|7 Sample Road, Sampletown NSW 2000"
  "Alex Fictional|1954-12-01|12 Placeholder Street, Sampletown NSW 2000"
  "Kim Specimen|2001-07-21|3 Dummy Lane, Sampletown NSW 2000"
  "Noor Illustrative|1976-05-15|9 Example Street, Sampletown NSW 2000"
)
PATIENTS=("$@"); [ ${#PATIENTS[@]} -eq 0 ] && PATIENTS=("${DEFAULTS[@]}")

hdr=(-H "x-practice-id: ${PRACTICE_ID}" -H "content-type: application/json")

PROVIDER_ID="$("${PG[@]}" -c "select id from core.providers where \"practiceId\"='${PRACTICE_ID}' and active order by name limit 1;")"
[ -n "$PROVIDER_ID" ] || { echo "no active provider for practice ${PRACTICE_ID}"; exit 1; }

for spec in "${PATIENTS[@]}"; do
  IFS='|' read -r fullname dob address <<<"$spec"
  given="${fullname% *}"; family="${fullname##* }"
  slug="$(echo "${given}-${family}" | tr '[:upper:]' '[:lower:]')"

  # Patient: match by name within the practice; create if missing.
  PATIENT_ID="$("${PG[@]}" -c "select id from core.patients where \"practiceId\"='${PRACTICE_ID}' and \"givenNames\"='${given}' and \"familyName\"='${family}' limit 1;")"
  if [ -z "$PATIENT_ID" ]; then
    PATIENT_ID="$("${PG[@]}" -c "insert into core.patients (id, \"practiceId\", \"familyName\", \"givenNames\", \"dateOfBirth\", address, \"patientRecordNumber\", mobile, email, \"pmsLinkageKey\")
      values (gen_random_uuid(), '${PRACTICE_ID}', '${family}', '${given}', '${dob}', '${address}', 'DEV-${slug^^}', '+61400000999', '${slug}@example.invalid', 'dev-${slug}')
      returning id;")"
    echo "created patient ${fullname}"
  fi

  # The patient's OWN assignor record (D7 stays explicit even when they sign for themselves).
  ASSIGNOR_ID="$("${PG[@]}" -c "select id from core.assignors where \"practiceId\"='${PRACTICE_ID}' and name='${fullname}' and \"authorityBasis\"='self' limit 1;")"
  if [ -z "$ASSIGNOR_ID" ]; then
    ASSIGNOR_ID="$("${PG[@]}" -c "insert into core.assignors (id, \"practiceId\", name, \"dateOfBirth\", \"authorityBasis\") values (gen_random_uuid(), '${PRACTICE_ID}', '${fullname}', '${dob}', 'self') returning id;")"
  fi

  # Draft → capture request (this is what puts them on the kiosk list) → lock with D6a.
  AGREEMENT_ID="$(curl -sS "${hdr[@]}" -X POST "${CORE}/agreements" \
    -d "{\"type\":\"episodic_pre\",\"providerId\":\"${PROVIDER_ID}\",\"patientId\":\"${PATIENT_ID}\",\"assignorId\":\"${ASSIGNOR_ID}\",\"assignorIsPatient\":true}" \
    | python -c 'import sys,json; d=json.load(sys.stdin); print(d.get("id") or sys.exit("agreement not created: %s" % d))')"
  curl -sS -o /dev/null -f "${hdr[@]}" -X POST "${CORE}/capture" -d "{\"agreementId\":\"${AGREEMENT_ID}\",\"channel\":\"in_practice\"}"
  curl -sS -o /dev/null -f "${hdr[@]}" -X POST "${CORE}/agreements/${AGREEMENT_ID}/transition" -d '{"to":"awaiting_signature"}'
  curl -sS -o /dev/null -f "${hdr[@]}" -X POST "${CORE}/agreements/${AGREEMENT_ID}/particulars" \
    -d "{\"serviceDate\":\"${TODAY}\",\"basicServiceDescription\":\"${D6A}\"}"
  echo "staged  ${fullname}  DOB ${dob}  ${address}"
done

echo
echo "Now waiting at /kiosk:"
# Once device pairing lands, /kiosk/* takes a device credential instead of the practice header;
# this listing is a convenience and may fail without undoing the staging above.
curl -sS -H "x-practice-id: ${PRACTICE_ID}" "${CORE}/kiosk/waiting-list" 2>/dev/null   | python -c 'import sys,json; [print("  -", r.get("patientName")) for r in json.load(sys.stdin)["waiting"]]' 2>/dev/null   || echo "  (list not readable this way any more - open http://localhost:3100/kiosk to see it)"
