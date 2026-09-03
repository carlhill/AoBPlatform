# Session handover — 3 September 2026, 14:42

Written before a reboot. Everything below is either pushed or named as
unfinished. Branch `feat/apply-ui`, last commit `a553115`, in sync with origin.

Pull request: <https://github.com/carlhill/AoBPlatform/pull/1> — 152 commits
into `main`, which holds nothing that is not on the branch, so it is a clean
fast-forward.

---

## Restart the machine, then restart the stack

Containers come back on their own if Docker Desktop starts with Windows. The
two dev servers do not.

```bash
docker compose up -d postgres immudb keycloak mailhog rules vault
```

```bash
npm run build -w packages/domain
```

```bash
npm run start:watch -w apps/core
```

```bash
npm run dev -w apps/web
```

Build the domain package **before** starting either server. The apps consume
its build output, not its source, and today's correspondence work added a
module to it.

**Use a browser address of `localhost:3100`.** `127.0.0.1:3100` now works too,
as of this session, but `localhost` is the address everything else is written
around.

---

## What was built today

| # | Item | State |
|---|---|---|
| 1 | Retention sweep (consultation-capture plan, Part 5) | Built, 8/8 e2e, pushed |
| 2 | Correspondence log — practice screen and patient half | Built, pushed |
| 3 | Correspondence seed data | **In progress, uncommitted** |

### Retention sweep — `53c3694`

Hourly job, two passes. Due agreements move to the terminal
`retention_expiry_scheduled` state; content past expiry and not on legal hold
is tombstoned, so the row survives and the text goes. Every removal emits a
vault event carrying the retention clock source where it was defaulted
conservatively. Three `SECURITY DEFINER` functions return ids only; no policy
was weakened.

**Gap:** nothing stamps an agreement's retention expiry date yet, because claim
linking is not built. Correspondence and artefact tombstoning are live today;
the agreement pass wakes up when a writer exists.

### Correspondence — `49a0e56`, `ffd53a1`

One domain module and one component serve four readers, which is what the
design handoff demands: "one log with two audiences, not two features". The
practice screen is `/practice/correspondence` with a view-only platform twin;
the patient's half is a token-scoped route. The existing practitioner messages
page was moved onto the same component.

Cost is shown to the practice only. Bodies are withheld from the platform
twin. No resend control exists on the component for **any** row, so an 89AA
notice cannot acquire one by accident later — the named test
`eightynineAA_rows_have_no_chase_action` covers it at domain and API level.

Tests: domain 776/776, correspondence e2e 9/9, patient link 9/9, reconciliation
and retention 18/18.

**Two things deliberately not invented:**

- **No cost column.** Nothing in the schema records what a send costs, and a
  plausible-looking figure is worse than an absent one.
- **"Stop reminders" renders disabled with its reason.** No cross-channel STOP
  mechanism exists anywhere in the codebase yet.

---

## Unfinished, and the only thing at risk

`apps/core/src/dev-seed/dev-seed.controller.ts` is **modified and
uncommitted**. A background agent was building a dev-only seed that creates
representative correspondence for practice `821709fb-7f89-4fcf-95c0-27c5eb55cec8`
(XLEVELUP Medical), covering a capture link, a run of reminders on one subject
so the attempt ordinal shows, a signed copy, an 89AA notice, a failed send, a
postal item queued for print, and one message whose text retention has removed.

**The agent dies with the reboot. The file edit survives on disk.** Pick it up
by reading that file and finishing it, or discard it with
`git checkout apps/core/src/dev-seed/dev-seed.controller.ts` and start again.

### Why the seed is needed

The screen is fully wired — page, view, menu entry, page-access declaration,
back link — and the endpoint returns rows. But the practice's 21 existing
messages are all administrative notices, so every filter segment (capture,
reminders, copies, 89AA, failed) and every delivery state renders empty. The
screen works and shows nothing about itself.

`carls_notes_1.txt` is also modified — that is your own file, untouched by me.

---

## Fixed along the way

- **CI was red and had been.** `a553115`. Lint and typecheck ran *before* the
  packages they import were built, so every web file importing
  `@aobplatform/domain` failed with TS2307 on a clean checkout. It passed
  locally only because of a stale `dist`. The run died at typecheck, so lint,
  the realm guard, the tests and the e2e suite **never executed at all**.
  `build:packages` now runs first. **Confirm this run is green** — it had not
  finished when this was written.
- **Reconciliation had no back link** (`1fe25d2`) — missing from the parent
  map, the third map that page has been missed in. Also fixed a lint error in
  its keyboard handler that was blocking the whole web lint run.
- **Two pre-existing gate failures** (`a19e284`) — a domain cast, and the
  Medicare-number rule firing on the very test that proves the rule works.
- **The blank page on `127.0.0.1`** — see below.

### The blank page, in full, because it took three attempts

The dev server refused its own JavaScript chunks to that origin with a 403.
Next treats a dev request from an unrecognised origin as cross-origin. The
page itself is plain HTML and still returned 200, so the tab titled itself
correctly and **curl found nothing wrong** — curl sends no `Origin` header.
Only a browser triggers it. With the scripts refused React never hydrated, so
nothing rendered and no error appeared anywhere on the page.

Two fixes, both pushed:

- `e1302cf` — added `apps/web/next.config.mjs` with `allowedDevOrigins`. There
  was no Next config in the repo at all. Dev server only; a build is unaffected.
- `bb1c165` — registered both local spellings in the Keycloak client. Applied
  to the **running** realm through the admin API, not by re-import: the realm
  imports only when absent and the credential store is persistent, so an
  import would have been a rebuild, and a rebuild once cost every enrolled
  passkey. The generator now agrees with what is live. The issuer was
  deliberately not duplicated. `npm run validate:realm` re-run and green.

`462459b` also bounded the silent-restore wait so it cannot hang forever.
**Its commit message implies that was the cause of the blank page. It was
not** — that path never ran. The bound is kept because an unbounded wait is a
hazard this file has been bitten by twice, but it fixed nothing you saw.

---

## Needs your decision

1. **A Medicare fixture may be checksum-valid.** In
   `apps/core/test/inbound-print-jobs.e2e-spec.ts`, the smuggled number
   `2123 45670 1` appears to carry a valid check digit, where CLAUDE.md
   requires invalid-checksum fixtures. There is no Medicare checksum validator
   in the repo to confirm it against — only the ABN one — and the brief says
   not to lean on training-data priors for this regime, so it was left alone
   rather than changed on arithmetic.
2. **The Industry token set** from the design handoff is still unported. It
   re-themes every screen and is a product decision, not a side effect of one
   page. The handoff wants it decided before the kiosk build.

---

## Next

Consultation-capture plan Part 7 **item 7: the kiosk MVP** — list, verify,
render, sign, done, episodic pre-consultation only, with a fast poll while
waiting. It depends on items 2 and 3, both built, and on the token-set decision
above.

## Ways of working, recorded this session

Both are now in `CLAUDE.md` section 7 and survive into every future session.

- **Compact the chat past roughly 40% of the five-hour budget or ~100k
  context.** Every tool call re-sends the whole conversation, so a long history
  is paid for again on each call and buys nothing. Write the next step into the
  plan doc first.
- **Fable orchestrates, Opus builds.** Builds run in subagents on Opus;
  mechanical fix-ups and test re-runs on Sonnet. Subagent output counts against
  the same limit, so brief tightly and ask for a short report.
