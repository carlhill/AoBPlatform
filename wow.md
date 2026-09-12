# wow.md — ways of working for Claude Code sessions on AoBPlatform
### Started 7 September 2026. Owner: Carl. Companion to CLAUDE.md §7 (the build brief's working rules); this file holds the session habits Carl has asked for since, dated.

## 1. Review before "ready to test" (Carl, 7 Sep 2026)

Carl asked: *"do you review your own work and flag anything you'd fix before I ship this?"* Honest answer on 7 Sep: **not consistently.** Builds ran tests, typecheck and lint and reported their own decisions, and commits were gated on green — but nobody read the diff with fresh eyes before Carl was told "ready". Three things that day got through that a reviewer would have caught: a route shadowed by an older `:id` route that no test exercised; a page shipped without the back link and refresh every other page has; two commits pushed with a failing test because a shell chain did not gate on the test's exit code.

**The rule from now on.**
- Before Claude tells Carl a piece of work is ready to test, a **fresh reviewer agent** (Sonnet; not the agent that wrote it) reads the diff since the last review against the checklist in §2 and returns a list of *"would fix before ship"* items with file and line.
- Claude reports that list to Carl verbatim with a verdict on each: fixed now / deferred with reason / disagree with reason. Nothing is marked ready with red CI.
- Carl's "ship" is a PR merge to `main`; the review runs at least once per day of work and once more immediately before a merge.
- Small doc-only or copy-only commits skip the review; anything touching a hard rule, a migration, a route, auth, the vault, the render, or a patient-facing screen does not.

## 2. The reviewer's checklist

1. **Hard rules** (CLAUDE.md §2): every one the diff touches has a named test, and the enforcement is in code, not a comment.
2. **Routes**: new routes are not shadowed by an earlier `:id`/`:param` route in the same or an earlier-registered controller; a route-level e2e hits the URL, not only the service.
3. **Console pages**: back-link parent registered, top-bar refresh registered (`useRefreshable`), hub card or nav entry, platform twin where the pattern exists, `canOpen` gating equals the page's own.
4. **Strings**: none inline; UK/AU spelling; never "certified/approved/accredited/government-approved".
5. **Shortcuts to the answer**: every blocked/waiting message names the reason and links or acts where it is fixed; unmapped codes show the code.
6. **Tests**: no substring assertions that random hex or UUIDs can hit (match words or full values); no `>= N hours` for business-day rules; no dependence on the day of the week or the clock; named tests match their names.
    - **Wait for the data, not the element** (7 Sep 2026, after a race failed CI four times in one weekend). A component often renders its CONTAINER — a select, a panel, a row, a card — as soon as one fetch resolves, while its CONTENTS depend on a SECOND fetch that lands separately (a role list, a content catalogue, a patient's details, arrived on its own `useEffect`/`.then` rather than batched into the same state update). `await screen.findByTestId(container)` only proves the first fetch landed; a synchronous `getByTestId`/`.options`/`.textContent`/`.value` read straight after it is reading whatever the second fetch happened to have delivered by that tick — passes on a fast machine, flakes on a slower CI runner. Await the actual content (`await waitFor(() => expect(select.options.length).toBeGreaterThan(...))`, or `findByTestId` the specific child) instead of the container that merely hosts it. A synchronous read of the awaited element itself, or of static markup, stays fine — say so in a comment when it's deliberate. Swept 7 Sep 2026: `affiliations.test.tsx`, `ServiceDescriptionsNeeded.test.tsx` (×2), `TemplatesView.test.tsx`, `SetupHub.test.tsx`, `tablet.test.tsx` — each a container gated on one fetch (a row list, a hub summary) whose select options, version chip, or rollup figure came from a second, independently-resolving one. **The same race wears a second coat:** an INPUT can exist before its VALUE is seeded (a correction panel's fields render, then the details fetch pre-fills them). `findByTestId(input)` then `fireEvent.change` lets the seed overwrite the change; asserting `.value` straight away reads ''. Wait for the pre-fill: `await waitFor(() => expect(input.value).toBe(expected))` before typing or asserting (two more CI failures, 7 Sep 2026, `tablet.test.tsx`).
7. **Migrations**: idempotent, reversible, applied by hand to the dev DB, CHECKs derived from the domain list not a second literal.
8. **Vault**: new event literals INSIDE `VAULT_EVENT_TYPES`; the vault container rebuilt; every domain write with its outbox event in one transaction.
9. **PII**: none in logs, events, heartbeats, error messages, or test names; identifier TYPES not values.
10. **Zero-footprint kiosk**: no storage API but the pairing credential; `kiosk_persists_nothing_but_pairing` green.
11. **Determinism**: render bytes for existing agreements unchanged; `two_renders_of_one_agreement_are_byte_identical` green.
12. **CI**: green on the pushed head; flakes fixed at the assertion, not retried.
13. **Reuse** (§10): the diff's new components and helpers are each justified in the report; nothing in it duplicates something `INVENTORY.md` already lists; anything now written a third time is extracted; `INVENTORY.md` is regenerated in the same commit as the exports it describes.

## 3. Gate commits on the tests, mechanically (Claude's own rule, 7 Sep 2026)

Twice on 7 Sep a commit was pushed with a failing test because a pipeline `grep | head` swallowed the test's exit code. From now on every commit-and-push command reads `${PIPESTATUS[0]}` (or runs the test without a pipe) and refuses to commit unless tests, typecheck and lint all exit 0. No exceptions for "small" changes.

## 4. Resume, don't restart (Carl, 4 Sep 2026)

When a build agent dies on the 5-hour limit, a stall, or a 429: resume it by id with a message naming the exact step it stopped on. Its files are intact. Never start a fresh agent for work that is half done. Watch the reset time and resume the minute it passes; if it has not passed, schedule the wake-up and tell Carl the time.

## 5. Parallel builds stay on disjoint paths

Every brief names the paths the agent owns and the paths other running agents own. Shared files (`strings.ts`, `schema.prisma`, `TODO.md`, `pushDesk.tsx`) are edited with small anchored edits after re-reading, and staged hunk-by-hunk so one agent's commit never carries another's half-finished work. When a commit does sweep another's hunk in (twice on 4 Sep, and again on 12 Sep), fix forward in the next commit; never rewrite pushed history.

### 5a. `git add <paths> && git commit` does NOT commit only those paths (12 Sep 2026)

It commits **the whole index**, and with agents running the index is not yours.
On 12 September a commit meant to carry six files carried thirty-one: a
concurrent agent had staged its tier 2 work, and `git commit` took everything
staged. The commit message described six of them. Nothing was lost, but the
history now says the patient-ID change contains an authentication build.

Naming paths on `git add` feels like scoping the commit and is not. Two things
fix it, and the second is better:

1. **Read the index before committing** — `git diff --cached --name-only` — and
   stop if it holds anything you did not put there.
2. **Commit with a pathspec**, which ignores the index entirely:

   ```
   git commit -o path/one.ts path/two.ts -F message.txt
   ```

   `-o` (`--only`) commits exactly those paths from the working tree and leaves
   everything else staged for whoever staged it. Use it by default whenever
   another agent is running.

The failure is silent in the direction that matters: the commit succeeds, the
tests pass, and the mistake is only visible in `git show --stat` afterwards.

## 6. Tell Carl what to test, not what was built

Every landing report ends with the URL to open and the steps to try, in the order to try them, plus the decisions the build left for Carl. A report without a test path is not finished.

## 7. Carl's notes travel with the code (Carl, 7 Sep 2026)

`carls_notes_1.txt` is committed with every push from now on — it is Carl's
running record and belongs in the history beside the work it describes. Claude
includes it in the next commit whenever it has changed (a `docs(notes)` commit
of its own if nothing else is going out), scanning the diff first for anything
that looks like a secret.

## 8. Background commands, and the shells that wait on them (11 Sep 2026)

Two rules, both learned by losing hours to them.

**Never pipe a background command into `tail` or `head` if anything is watching
its output.** A pipe buffers everything until the command exits, so the output
file stays empty for the whole run — and if the command never exits, the output
never arrives at all. On 11 Sep a Jest e2e run was started as
`npx jest ... 2>&1 | tail -40` with a second shell polling that output file for
the string `Test Suites:`. The pipe guaranteed the string could never appear
while the run was alive, so the two deadlocked and sat there for four hours: one
holding output, the other waiting for it. Let a background command write its
output plainly; read the tail from the file afterwards if the volume is a
problem.

**A waiter watches for completion, not for a string.** Polling a log for text is
a guess about output that a buffer, a crash, a changed summary line or a
non-zero exit can each falsify — and the waiter then spins forever, because
nothing tells it the thing it waits for can no longer happen. Prefer the
harness: a background task notifies on completion by itself, so wait for the
notification rather than building a `until grep ...; do sleep 5; done` loop. If
a poll is genuinely unavoidable, bound it with a maximum wait and check the
process is still alive on every pass.

**Staging and committing are ONE shell invocation.** `git add` in one call and
`git commit` in the next leaves a window where a parallel agent stages its own
work into the same index, and the commit carries both. It happened twice on
4 Sep and again on 11 Sep. Stage by explicit path and commit in the same
invocation: `git add <paths> && git commit -m ...`. This is §5 enforced at the
shell rather than in the brief.

## 9. Every rule goes into the right markdown file, always (Carl, 12 Sep 2026)

Carl: *"always write the rules to the appropriate md."* A rule that exists only
in a chat message, a code comment or one agent's head is not a rule — it is a
thing that will be re-litigated in a fortnight by somebody who was not there,
and re-litigated differently.

**When.** The moment a rule is settled, in the same turn, before the next task
starts. Not at the end of the session, where it is lost to a usage limit or a
compaction.

**Where — pick by what KIND of statement it is, not by which file is open.**

| The statement | Goes in |
|---|---|
| A product or regulatory choice, with a date, who made it and what would reopen it | `DECISIONS.md`, as a `D-YYYY-MM-DD-NN` entry, plus a row in its index table |
| A rule about who signs, how they are reached, or what may change after the lock | `ASSIGNOR-RULES.md`, with the code that enforces it and the test that names it |
| A rule about how a Claude session should WORK — reviews, commits, agents, shells | this file |
| A statutory invariant that must be enforced in code and can never be "improved" | `CLAUDE.md` §2 — and only with Carl saying so in as many words |
| Work still to do, an open question, or a diagnosis not yet fixed | `TODO.md` |
| A plan for something not yet built | its own `*.md`, named for the thing (e.g. `PATIENT-WORKFLOW-PAGE.md`) |

**What a written rule carries.** The rule itself; WHY, in enough detail that
somebody can tell whether the reason still holds; where it is enforced in code
and the named test; and for a decision, what would reopen it. A rule with no
reason cannot be safely changed later, because nobody can tell what changing it
would break.

**And it closes what it answers.** A new decision that settles an open question
strikes that question through where it was asked and points at the decision, so
the two never disagree. D-2026-09-11-03 closing `ASSIGNOR-RULES.md` §4 is the
worked example.

**A decision made by an agent mid-build is still Carl's to confirm.** Write it
up as an assumption, say so plainly in the report, and rewrite it as a decision
once he answers — the way the no-typed-address rule went from an assumption in a
build brief to D-2026-09-11-03.

## 10. Reuse is proved, not promised (Carl, 12 Sep 2026)

Carl: *"We know what we have built. I am assuming you know what you have built
and your first instinct will not be to write new code but to see what we have
built and to reuse code, without breaking what we have built. How do we do
this?"*

**The honest answer to "how do we do this" was: we didn't.** An agent starts
cold. It knows what its brief names and nothing else, so it cannot reuse what
it cannot discover, and the cheapest path in front of it is always to write the
thing again. On the afternoon of 12 Sep the front desk panel shipped its own
hand-rolled subset of the tablet page's session controls — a second, smaller,
subtly different copy of `SessionActions`, `SendAgain`, `SendSteps` and
`CorrectionPanel`, all of which were already exported from
`apps/web/app/practice/tablet/pushDesk.tsx` and already used by two other
screens. Nobody was careless. There was simply no index: 1,959 exported symbols
across `apps/web`, `packages/domain`, `packages/contracts` and `apps/core`, 55
of them out of `pushDesk.tsx` alone, and no way to see any of it short of
grepping for a word you would have to guess first.

Two copies of a control is not a tidiness problem in this product. It is two
places where a blocked state can be reachable, two places a string can be
inline, two places a hard rule has to be enforced — and one of them will be
missed.

### The rule

**1. Every build brief names `INVENTORY.md` as required reading, and names the
exports the work should reuse.** `INVENTORY.md` is generated by
`npm run inventory` (`scripts/dev/inventory.mjs`) and committed: every exported
symbol, its file, the first sentence of its own comment, and how many places
already import it, sorted most-imported first. Where the briefing agent already
knows which exports apply — "reuse `SessionActions`, `SendAgain` and
`usePushDesk` from `pushDesk.tsx`" — it says so by name. Naming three saves the
agent a search; the inventory catches the fourth nobody thought of.

**2. Every agent report lists what it IMPORTED and what it WROTE.** Two
explicit lists, not prose. Each new component, hook or helper gets one line
saying why the existing thing did not fit. A new thing is fine — half of them
are the right call. An *unexplained* new thing is not, because nobody reading
the report can tell whether it is a considered decision or a search that never
happened. "Wrote `SessionPanel` — `SessionActions` renders the recall control,
which reception must not see here" is an answer. "Added `SessionPanel`" is not.

**3. The rule of three.** The first time, write it. The second time, wince and
write it again. The third time, extract it — into `app/ui/` for a shared
control, `packages/domain/` for logic, and delete the copies in the same
commit. Not "later": the third copy is the one that starts drifting, and by the
fourth nobody can tell which is authoritative.

**4. Reuse is proved by a test where it matters.** A structural check survives
a busy afternoon; a good intention does not. Where two screens must show the
same control, assert it — render the page and assert the shared component's own
`data-testid` is present, or assert the two surfaces produce the same output
from the same shared helper. A test that fails when somebody quietly forks a
component is the only version of this rule that still works in six weeks.

### Enforcement

- `npm run inventory` regenerates `INVENTORY.md`.
- `node scripts/dev/inventory.test.mjs` fails when the committed file and the
  tree disagree, and it runs first inside `npm run lint`, so a branch that adds
  an export and does not regenerate fails at the bench and in CI. Same shape,
  and the same reason, as the realm-export guard in `infra/keycloak`.
- The generator quotes each symbol's own comment and never composes a
  description. An export with a blank cell is an export nobody documented —
  read that as a defect in the code, not in the index.
- Reviewer's checklist (§2) gains item 13, below.

### And a note on the other half of what Carl asked

"*without breaking what we have built*". Reuse cuts both ways: extending a
component that fourteen screens import can break fourteen screens. The
inventory's **Used by** column is the blast radius, and it is there to be read
before the edit, not after the regression. Above about five importers, add the
new behaviour behind an optional prop that defaults to today's behaviour rather
than changing what the existing callers get.

## Change log
| Date | Change |
|---|---|
| 7 Sep 2026 | File created: review-before-ready (§1–2), mechanical commit gating (§3), resume-don't-restart (§4), disjoint paths (§5), test paths in reports (§6). |
| 7 Sep 2026 | §7: Carl's notes file is committed with every push. |
| 7 Sep 2026 | §2 item 6: added "wait for the data, not the element" after a second-fetch race failed CI four times in one weekend. |
| 11 Sep 2026 | §8: background commands never pipe into `tail`/`head`; waiters watch for completion, not a string; staging and committing are one shell invocation. |
| 12 Sep 2026 | §9: every settled rule is written to the right md in the same turn, with its reason, its enforcement and what would reopen it. |
| 12 Sep 2026 | §10: reuse is proved, not promised — generated `INVENTORY.md` as required reading, imported-versus-written in every report, the rule of three, and a test where it matters. Written after the front desk panel shipped a second copy of the tablet page's session controls. §2 gains item 13. |
| 12 Sep 2026 | 5a added: `git add <paths> && git commit` commits the whole index, not those paths. A concurrent agent's staged work rode into a commit that named six files and carried thirty-one. Use `git commit -o <paths>`, or read `git diff --cached --name-only` first. |
