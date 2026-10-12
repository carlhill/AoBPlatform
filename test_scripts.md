# Test scripts: what each is called and the command that runs it

Every command runs from the **repo root in Git Bash** unless it says otherwise.
All of these are **dev only**: they use obviously fake people and never a
Medicare number. Most need **core on :3001** (`npm run start:watch -w apps/core`)
and the **postgres container** running; each entry says what it needs.

When a new test script is added, add its entry here in the same PR.

---

## Test data: patients and agreements

### `db4-round-trip` — print one DB4 through AOBPRINTER and watch it become an agreement
Checks every prerequisite by itself and names the fix for whichever is missing.
Makes sure the fixture's patient (chart 09911, Testalina Fakesurname) and
servicing provider 9999999X exist, prints the fixture DB4 to the AOBPRINTER
printer, and follows it to an agreement on the tablet desk.
Needs: core :3001, web :3100, AOBPRINTER watcher and config, postgres container.
```bash
bash scripts/dev/db4-round-trip.sh
```
```bash
bash scripts/dev/db4-round-trip.sh --status
```
```bash
bash scripts/dev/db4-round-trip.sh --stop
```
`--status` reports the prerequisites and touches nothing; `--stop` stops a
watcher this script started.

### `arrive` — patients walk up to reception
Sends `POST /arrivals`, the message a PMS connector will send. The platform
creates the patient, decides what the visit needs and puts them on reception's
queue. Touches no database directly.
Needs: core :3001.
```bash
bash scripts/dev/arrive.sh
```
```bash
bash scripts/dev/arrive.sh "Riley Example|1988-03-09|7 Sample Road, Sampletown NSW 2000"
```
With no argument it sends the standard five. A fourth field
(`"...|<affiliationId>"`) names the provider; pass a non-GP one to see the
ordinary episodic flow rather than `enduring_rules_not_authored`.

### `service-rendered` — the service was given (the second push)
Sends `POST /arrivals/service-rendered` with the service day and MBS item
numbers. Patients whose pre-agreement for today is signed come back
`covered`; everyone else gets a locked post-service agreement on the desk.
Needs: core :3001. **Run `arrive` first.**
```bash
bash scripts/dev/service-rendered.sh
```
```bash
bash scripts/dev/service-rendered.sh "Riley Example|23,10990|2026-09-10"
```

### `stage-kiosk-patients` — put waiting patients on the kiosk
Creates the patient, their assignor, a draft and an in-practice request, then
locks the particulars, the same order the kiosk Playwright test uses.
Needs: core :3001, postgres container.
```bash
bash scripts/dev/stage-kiosk-patients.sh
```
```bash
bash scripts/dev/stage-kiosk-patients.sh "Riley Example|1988-03-09|7 Sample Road, Sampletown NSW 2000"
```
Default: Riley Example, Alex Fictional, Kim Specimen, Noor Illustrative.
Re-running adds another waiting row for the same people.

### `reset-kiosk-list` — empty the kiosk list and restage the standard five
Expires every open in-practice request for the dev practice (deletes nothing),
then runs `stage-kiosk-patients`.
Needs: core :3001, postgres container.
```bash
bash scripts/dev/reset-kiosk-list.sh
```

### `seed-busy-day` — a busy morning: ninety arrivals across three queues
Ninety arrivals, six finished, two live on tablets, eight blocked, and timings
for every step. Adds to what is there; deletes nothing. Never touches the
"Carl browser tablet".
Needs: core :3001, postgres container. Runs from `apps/core`.
```bash
cd apps/core && npx ts-node -T ../../scripts/dev/seed-busy-day.ts
```
A smaller trial run with its own identities:
```bash
cd apps/core && RECORD_PREFIX=SMOKE ARRIVALS=6 npx ts-node -T ../../scripts/dev/seed-busy-day.ts
```

### AOBPRINTER test tool — send test DB4s from the browser
Open http://localhost:3100/aobprinter. Choose a preset and send it; it goes
through the same `POST /inbound/print-jobs` path a real print does.
Needs: core :3001, web :3100.

**Load test agreements** (the button at the top): makes sure five fake
patients are on file (the `db4-round-trip` fixture patient on chart 09911 plus
the four `stage-kiosk-patients` people), adding any that are missing through
`POST /arrivals` as the script does, then sends one DB4 each from five presets
and says how many placed. Each press adds five new agreements. It never creates
a servicing provider: if 9999999X is not set up, it says so and points at
`db4-round-trip`'s seed step.

After a press it also lists the **check cases** (no provider name, every live
check at once, no card, no place of practice, and the two refused at the door),
ready to print. Nothing is sent for them: choosing one puts it in the form for
Testalina Fakesurname with a new form reference, and **Print to AoB** sends it.

---

## Test runs

### `e2e-template` — build the template every e2e run copies
Each core e2e run clones its own database from this template and drops it
afterwards. **Re-run whenever the schema changes.**
Needs: postgres container.
```bash
bash scripts/dev/test-db.sh
```

### Core unit tests for the files you changed
```bash
cd apps/core && npx jest --findRelatedTests src/path/to/changed-file.ts
```

### Core e2e, one spec
Uses a fresh clone of the template; never point it at `aobplatform` or
`aobplatform_test`.
```bash
cd apps/core && npx jest --config jest.e2e.config.js test/name-of.e2e-spec.ts
```

### Web unit tests (Vitest), one file
```bash
npm test -w apps/web -- app/path/to/Component.test.tsx
```

### `e2e:kiosk` — the kiosk ceremony in a real browser (Playwright)
Needs: core :3001, web :3100, and a staged waiting patient (run
`stage-kiosk-patients` first).
```bash
npm run e2e:kiosk -w apps/web
```

### `e2e:service-description` — the service description screen (Playwright)
Needs: core :3001, web :3100, and `E2E_PRACTICE_USER` / `E2E_PRACTICE_PASSWORD`
for the dev realm set in your shell (it skips without them).
```bash
npm run e2e:service-description -w apps/web
```

### `inventory` — regenerate INVENTORY.md, and check it is current
```bash
npm run inventory
```
```bash
npm run validate:inventory
```

---

## When something shows nothing

### The test tool says "The 0 most recent forms", or the tablet cannot connect
Your PC's network address has changed (a different Wi-Fi). Web calls core at the
address in `apps/web/.env.local`, and an old address fails silently. Find the
current one:
```bash
ipconfig | grep IPv4
```
Use the `192.168.x.x` Wi-Fi address (not `192.168.56.1`, which is VirtualBox), and
put it in three places: `NEXT_PUBLIC_CORE_URL` and `DEV_LAN_HOSTS` in
`apps/web/.env.local`, and `CORS_ORIGINS` in `apps/core/.env`. No restart needed:
core and Next.js dev both reload their env files when they change. Refresh the
page.
