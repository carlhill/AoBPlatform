# To-do

Things agreed but not built. Not a backlog of ideas — everything here has been
decided, and is written down so it does not get re-decided.

Convention: each entry says what it is, WHY it was deferred rather than done,
and what it depends on. An entry with no "why deferred" is just an unfinished
task and belongs in the code as a TODO comment instead.

---

## Onboarding

### AI chat bot for application status
**Status:** not started.
**Decided:** 2026-08-22, Carl.

An applicant waiting on a decision should be able to ask "where is my
application" without ringing anyone. The acknowledgement email will offer three
routes — call us, check the status page, or ask the bot — and the third does not
exist yet.

**Why deferred:** the status page has to exist before a bot has anything to
answer from, and the bot's scope needs a boundary drawn before it is built. It
must be able to say what stage an application is at and what is outstanding. It
must NOT be able to say why a reviewer is hesitating, disclose whether an ABN is
already registered here (that turns a status query into a way to enumerate
customers — the same rule already enforced on rejection reasons), or give any
impression of deciding. A bot that sounds like it is approving something is
worse than no bot.

**Depends on:** the public status page.

### Public application-status page
**Status:** not started.
**Decided:** 2026-08-22, Carl.

`/status/<token>` — the same three-row gate ledger the applicant saw when they
submitted, showing where the application has got to.

**Why deferred:** needs a bearer token that is NOT the practice id. The id is a
primary key: it ends up in logs, referrer headers and support tickets, and a
primary key that doubles as a credential is a credential that leaks. A separate
random token, revocable independently, is a column and a migration.

**Depends on:** nothing else.

---

## Access

### Platform-admin sign-in
**Status:** not started. **This is the most serious gap on the list.**
**Found:** 2026-08-22, by Carl, while reviewing an application.

There is no sign-in for the platform operator — the person who reads
applications and approves practices. The Keycloak `web` client is the
clinician-browser flow, bound to practice admins and practitioners; a reviewer
is a different principal entirely and has no realm role, no flow and no
account.

**Why this matters more than it looks.** Every check and every approval records
the name of the human who performed it, and that is the entire basis on which
this system claims a decision was made by somebody rather than by a machine.
Today that name is TYPED. It identifies nobody, cannot be checked, and could be
anyone's — including the name of a real colleague who did not make the
decision. For a product whose premise is non-repudiable records, an
unverifiable signature on the approval is the wrong thing to be missing.

The reviewer screens are already wired to take the name from the session the
moment one exists (`currentSession()?.username`), and fall back to a typed name
only when there is none — shown against a notice that says plainly it is
unverified. That fallback is the honest shape of the gap. It is not a fix.

**Why deferred:** it is a Keycloak realm change (a client, a role, and a flow),
not a code change, and it belongs with the AUTH_ENFORCE=true release gate
rather than ahead of it.

**Until it exists:** treat every recorded reviewer name as an assertion, not an
identity. Do not rely on the check history as evidence of who did what.

---

## Identity

### The two identity-strength dashboards
**Status:** designed, not built. See IDENTITY-STRENGTH-DESIGN.md.

Practice identity strength and practitioner identity strength, each filterable
by practitioner name and practice.

**Why deferred:** scoring is captured and stored already; the dashboards are a
reporting surface over data that is accumulating correctly in the meantime, so
delay costs nothing.

---

## Open questions

These block work and need Carl, not code.

- **REVIEW-REQUIRED.md** — two files still marked DRAFT, awaiting sign-off.
- **PIE licence** — $4,000 API install + $1,000/yr + $1/practitioner/yr. Alert
  is browser-only, so it cannot be automated. Decision needed before the
  entitlement check can be anything other than a phone call.
- **CLAUDE.md §7 sign-off** — fetching an applicant's website, and sending mail
  from a real domain, both need explicit approval before they leave the sandbox.
- **Collection notice** — not written. Required before any real applicant data
  is collected.
- **Retention conflict** — 7-year practitioner report vs 2-year stated
  retention. These cannot both be true; one has to give.
- **Can a sole trader reach 6 points?** If not, the identity threshold quietly
  excludes them, which is a policy decision and not a scoring detail.
