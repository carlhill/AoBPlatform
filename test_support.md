# test_support.md — getting test data onto the screens
### v1.0 · 12 September 2026 · Owner: Carl. Sibling of `helpful_scripts.md` (which is for when something is broken) and `DEV-LOOP.md` (which is for the edit-to-see loop).

This file answers one question: **how do I get patients onto the console so I
can test it?** Carl asked for it by name so the commands are findable instead
of being re-derived every time.

Everything here talks to the local sandbox and uses obviously fake identities.
No script here sends a real email or a real text. Where a fixture needs a
Medicare number (the DB4 Print Record carries one since D-2026-09-14-03), it
uses an **invalid checksum** so it can never be a real card — and the number is
never used to verify, find or match anybody (hard rule 1).

---

## The one you probably want

```bash
bash scripts/dev/stage-kiosk-patients.sh
```

Puts patients on the kiosk waiting list at `http://localhost:3100/kiosk` and on
reception's queue. It creates the patient, their own assignor record, a
pre-agreement draft, an in-practice capture request, and locks the particulars
with the practice's default service description.

Give it your own people instead of the default four:

```bash
bash scripts/dev/stage-kiosk-patients.sh "Riley Example|1988-03-09|7 Sample Road, Sampletown NSW 2000"
```

The format is `Given Family|YYYY-MM-DD|address`, repeated.

**It needs:** core running on 3001 and the Postgres container up. Re-running is
safe — patients are matched by name, so a second run adds another waiting row
for the same people rather than duplicating them.

## The one that is closer to real life

```bash
bash scripts/dev/arrive.sh
```

**Prefer this when you are testing the pipeline rather than the screens.** The
staging script above reaches into Postgres and then calls four endpoints in the
order a reception push would — it MIMICS the sequence. This sends ONE message,
`POST /arrivals`, and lets the platform do the rest: mirror the patient, ensure
their assignor record, decide from the versioned visit policy what the visit
needs, and draft and open the request. It is the door the site connector will
come through.

With your own people, and optionally the affiliation they came to see:

```bash
bash scripts/dev/arrive.sh "Ada Testpatient|1962-02-11|4 Sample Street, Sampletown NSW 2000|<affiliationId>"
```

**What you will see, and why it may surprise you.** The agreement type is the
rule set's decision, not the script's. Where a practice has ongoing agreements
switched on, a first visit decides `enduring` — and an enduring draft cannot be
locked or pushed yet, because the s 65C rule set has no enduring branch (a
human-authored zone). The queue says `enduring_rules_not_authored`. XLEVELUP
Medical has the setting OFF, so its arrivals come out as ordinary one-off
pre-agreements.

**Every arrival lands blocked on `assignor_not_confirmed`, and that is
correct.** Nobody has been asked who is signing yet. Confirm it at the desk, or
by hand:

```bash
curl -s -X POST http://localhost:3001/agreements/<agreementId>/assignor -H 'x-practice-id: <practiceId>' -H 'content-type: application/json' -d '{"assignorIsPatient":true}'
```

For somebody else signing, name them and the basis:

```bash
curl -s -X POST http://localhost:3001/agreements/<agreementId>/assignor -H 'x-practice-id: <practiceId>' -H 'content-type: application/json' -d '{"assignorIsPatient":false,"name":"Nina Sampleton","authorityBasis":"spouse","relationship":"spouse","declaresEighteenOrOver":true}'
```

The bases are `parent`, `spouse`, `co_resident_relative_18_plus`, `guardian`,
`health_epoa` and `other_with_note`. The 18+ answer is a DECLARATION, never a
date of birth.

## The one for a busy morning

```bash
cd apps/core && npx ts-node -T ../../scripts/dev/seed-busy-day.ts
```

Ninety arrivals today at XLEVELUP, spread across **three** practitioner
queues — about thirty each, which is one practitioner's real day. Two patients
are left holding a tablet, six are signed and finished, eight are deliberately
left with nobody answering "who is signing" so the "Needs a look" rail is not
empty, and two are signed for by a spouse. Everything else is ready to send.

**Use it when the question is about a screen at volume.** Seven patients
flatters every wide layout: short rails hide the cost of five headings, and a
desk that reads beautifully at seven can be unusable at ninety. This is what
`/practice/frontdesk` and `/practice/frontdesksmall` were compared on.

**It is a .ts and not a .sh, and the reason is worth knowing.** The arrivals go
through the front door over HTTP exactly as `arrive.sh` does. But
`POST /tablet-sessions/devices/:id/push` **refuses an unattributed caller** —
a push writes a staff-verified event, and an audit line naming nobody is worse
than a refusal — and there is no dev header that fakes one. So the script boots
a Nest application context and calls the services directly for the push and the
signature, with an actor that says out loud it is a seed. It disables the
`@Interval`/`@Cron` sweeps it inherits from `AppModule` on the way in, because
core is already running every one of them on :3001.

Knobs, all optional:

```bash
ARRIVALS=30 RECORD_PREFIX=TRIAL npx ts-node -T ../../scripts/dev/seed-busy-day.ts
```

`RECORD_PREFIX` is the identity space. Two runs with the same prefix are the
same people arriving twice, which is usually what you want; **a smaller trial
run wants its own prefix**, because a patient who has already signed today may
be decided `none` on a second arrival and would quietly hollow out the real
run. The idempotency key is deterministic per person per day, so a run
interrupted halfway tops up rather than duplicating — but that also means a
second full run on the same prefix is measuring the dedupe path, not the create
path. `TABLETS` overrides the two device ids; **`e1e2c073-…` "Carl browser
tablet" is deliberately not one of them** and must stay that way.

**It measures itself, and that is half the point.** Every arrival locks
particulars and renders a hashed PDF/A artefact, so ninety of them is real
load. The run prints total wall clock, median / p95 / worst per arrival, the
first ten against the last ten, and the three console page reads —
`/tablet-sessions/pushable`, `/arrivals/day`, `/practitioner-queue/waiting` —
timed before the ninety and again after. Measured 12 Sep 2026: **13.3 s for 90,
median 142 ms, worst 222 ms, about 10% slower by the end**; the page reads went
from 25–125 ms at 7 rows to 30–92 ms at 158 rows, i.e. no cliff yet.

**It creates a third practitioner if there is not one.** XLEVELUP has only two
live practitioner-at-a-location affiliations, so the script pre-registers
Dr Omar Notional (`MED9000000903`), invites them to a location and accepts on
their behalf — three ordinary endpoints, not SQL and not a revived `ended` row.
Idempotent on the AHPRA number.

## The one that starts from a physical printer

```bash
bash scripts/dev/db4-round-trip.sh            # print a DB4 to AOBPRINTER, watch it become an agreement
bash scripts/dev/db4-round-trip.sh --status   # report every prerequisite, touch nothing
bash scripts/dev/db4-round-trip.sh --stop     # stop a watcher this script started
```

**What Carl actually wants to do with this one:** print a PracSoft DB4 to the
`AOBPRINTER` printer on his machine and watch it turn into a post-service
agreement on the tablet desk (DB4-AND-AOBL.md §13a piece 1) — without first
working out which of six things is not running yet.

**Every stage is checked and named separately, in order, and the run stops at
the first one that fails**: the Postgres container, core on :3001, web on
:3100, `apps/aobprinter/dist/src/main.js`, the `AOBPRINTER` printer itself, and
`aobprinter.config.json` — each with the exact command that fixes it. Then it
clears any stale spool file (so the first job it claims is the one this run
printed), seeds the patient and servicing provider the fixture needs, starts
the watcher, prints the fixture, and polls the pipeline stage by stage: the
spool file appears, is claimed (disappears), an `InboundPrintJob` row appears,
its state becomes `done`, and the agreement exists.

**The fixture it prints is
`apps/aobprinter/test-fixtures/pracsoft3-db4-probe.source.txt`, and its values
are not what the DB4 e2e spec uses.** `apps/core/test/db4-assignment.e2e-spec.ts`
uses chart `00680` / provider `5745385T` on its own throwaway practice; the
printed fixture — the one this script actually prints — carries chart `09911`,
patient Testalina Fakesurname, servicing provider `9999999X` (Dr Ficticia
Nonperson). Both are obviously fake and the Medicare number's checksum is
invalid by construction. Re-check with
`grep -i "chart\|servicing" apps/aobprinter/test-fixtures/pracsoft3-db4-probe.source.txt`
if the fixture ever changes — this script matches the fixture, not the spec.

**Seeding is ordinary endpoints, never SQL:** `POST /practices/:id/providers`
for the servicing affiliation, `POST /arrivals` for the patient — the same
door `arrive.sh` uses, matched on `patientRecordNumber` so the DB4 handler can
find it (`db4-assignment.handler.ts`: "the chart number is the join key, and
the only one"). Idempotent: re-running says `already present` instead of
duplicating.

**It can fail here in a way that names a real gap, not a flaky check.**
`POST /practices/:id/providers` needs a location, and there is no ordinary
endpoint that can add one to a practice that already exists but was never
onboarded (`assertValidated` refuses it, and full onboarding mints its own
practice id rather than adopting an existing one). If AOBPRINTER's config
points at such a practice, the script says so by name and gives two ways out —
point the config at a practice `POST /dev/seed` mints (which comes with a
location, a servicing provider and a patient already in place), or have Carl
add one `practice_locations` row for it by hand. It will not do that write
itself.

**It manages its own watcher and nobody else's.** A pidfile at
`<dataDir>/dev-watcher.pid` is the only thing this script will ever kill: if
one is already running there, it is reused and left alone on exit; if this run
starts one, it stops it on exit (including Ctrl-C). `--stop` stops whatever
that pidfile names, independent of a run.

**It stops after the signature, and that is not this script's gap to close.**
The Signed-DB4 template (piece 2) and the write-back into the chart folder
(piece 4) are not built yet (DB4-AND-AOBL.md) — nothing lands in a folder. The
agreement exists, signed, in the Evidence Vault, and that is as far as the
round trip goes today.

## The other two

```bash
bash scripts/dev/reset-kiosk-list.sh      # back to the standard five, episodic drafts, staged directly
bash scripts/dev/service-rendered.sh      # the SECOND push: the service happened, here are the item numbers
```

`service-rendered.sh` is the only way to exercise the post-service branch at the
moment, because no screen posts those item numbers yet — that gap is
`INTEGRATION-MODES.md` section 4, gap A, and D-2026-09-12-13 makes the screen
release-blocking.

## Where the data shows up

| Screen | What it shows |
|---|---|
| `/practice/frontdesk` | Who is here, who has a tablet, who is expected. Only rows that still need something |
| `/practice/day` | Everybody who came in, on any day. The register, not the work list |
| `/practice/practitioner/waiting` | Today's arrivals grouped by practitioner, with whether the paperwork is done |
| `/practice/patients` | The patients with something open, and a count of open items each |
| `/kiosk` | The tablet. Walk-up, or whatever reception has sent to it |

**The desk and the register will not show the same number, and should not.**
The desk is a work list and empties as the day goes on; the register only grows.

## Clearing it down

There is no script for this, deliberately — it is a destructive act on a
database somebody is using. When it is needed, take a dump first:

```bash
docker exec aobplatform-postgres pg_dump -U aobplatform -d aobplatform -n core > before-cleanup.sql
```

**Two things will refuse to be deleted, and they are right to.** Signature
events and verification events are append-only in the schema itself, not by
convention — the triggers say so and roll the whole transaction back. Clear the
in-progress data around them (arrivals, capture requests, tablet sessions,
unsigned agreements) and leave the evidence. Finished agreements do not appear
on the desk or the waiting list anyway.

Keep the practice SETUP unless you mean to re-enter it: locations, departments,
practitioners, affiliations, staff, devices and their pairing (delete a device
and the tablet in the drawer is unpaired), templates and the letterhead.

## Never do this to the e2e database

The e2e suites must never be pointed at `aobplatform`, which is the dev
database with the seeded data in it.

Each e2e run makes its own database, `aobplatform_e2e_<time>_<random>_test`,
copied from the template `aobplatform_e2e_template`, and drops it when the run
ends. So two agents, or an agent and you, can run e2e at the same time without
deleting each other's rows. Build or refresh the template after any schema
change with:

```bash
bash scripts/dev/test-db.sh
```

Refresh it while no e2e run is starting: a run that copies the template halfway
through the rebuild gets half a schema.

To keep a run's database afterwards and look at what it left, set
`E2E_KEEP_DATABASE=1`; the run prints the name. A run that crashed leaves its
database behind, and a later run drops it once it is twelve hours old.

## Change log
| Date | Change |
|---|---|
| 12 Sep 2026 | v1.0. Written when Carl asked for the staging command to live somewhere findable. |
| 12 Sep 2026 | `seed-busy-day.ts` — ninety arrivals across three queues, for judging a screen at volume rather than at seven. |
| 27 Sep 2026 | `db4-round-trip.sh` — one command from a physical print to an agreement, naming whichever of six prerequisites is missing rather than leaving Carl to guess. |
| 11 Oct 2026 | e2e runs each get their own database, copied from `aobplatform_e2e_template`; `test-db.sh` now builds the template. |
