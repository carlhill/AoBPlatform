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
7. **Migrations**: idempotent, reversible, applied by hand to the dev DB, CHECKs derived from the domain list not a second literal.
8. **Vault**: new event literals INSIDE `VAULT_EVENT_TYPES`; the vault container rebuilt; every domain write with its outbox event in one transaction.
9. **PII**: none in logs, events, heartbeats, error messages, or test names; identifier TYPES not values.
10. **Zero-footprint kiosk**: no storage API but the pairing credential; `kiosk_persists_nothing_but_pairing` green.
11. **Determinism**: render bytes for existing agreements unchanged; `two_renders_of_one_agreement_are_byte_identical` green.
12. **CI**: green on the pushed head; flakes fixed at the assertion, not retried.

## 3. Gate commits on the tests, mechanically (Claude's own rule, 7 Sep 2026)

Twice on 7 Sep a commit was pushed with a failing test because a pipeline `grep | head` swallowed the test's exit code. From now on every commit-and-push command reads `${PIPESTATUS[0]}` (or runs the test without a pipe) and refuses to commit unless tests, typecheck and lint all exit 0. No exceptions for "small" changes.

## 4. Resume, don't restart (Carl, 4 Sep 2026)

When a build agent dies on the 5-hour limit, a stall, or a 429: resume it by id with a message naming the exact step it stopped on. Its files are intact. Never start a fresh agent for work that is half done. Watch the reset time and resume the minute it passes; if it has not passed, schedule the wake-up and tell Carl the time.

## 5. Parallel builds stay on disjoint paths

Every brief names the paths the agent owns and the paths other running agents own. Shared files (`strings.ts`, `schema.prisma`, `TODO.md`, `pushDesk.tsx`) are edited with small anchored edits after re-reading, and staged hunk-by-hunk so one agent's commit never carries another's half-finished work. When a commit does sweep another's hunk in (it happened twice on 4 Sep), fix forward in the next commit; never rewrite pushed history.

## 6. Tell Carl what to test, not what was built

Every landing report ends with the URL to open and the steps to try, in the order to try them, plus the decisions the build left for Carl. A report without a test path is not finished.

## Change log
| Date | Change |
|---|---|
| 7 Sep 2026 | File created: review-before-ready (§1–2), mechanical commit gating (§3), resume-don't-restart (§4), disjoint paths (§5), test paths in reports (§6). |
