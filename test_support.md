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

The e2e suites point at `aobplatform_test` and must never be pointed at
`aobplatform`, which is the dev database with the seeded data in it. Build the
test one with:

```bash
bash scripts/dev/test-db.sh
```

## Change log
| Date | Change |
|---|---|
| 12 Sep 2026 | v1.0. Written when Carl asked for the staging command to live somewhere findable. |
| 12 Sep 2026 | `seed-busy-day.ts` — ninety arrivals across three queues, for judging a screen at volume rather than at seven. |
