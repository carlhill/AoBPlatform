# Outbound queue triage

**Status:** PROPOSED, not started. Written 2026-08-25, from the "what's next"
discussion following the groupEmail and acting-as work.
**Estimate:** ~1 day.
**Supersedes nothing** — this is the "build instead" half of the decision
already recorded in [TODO.md](TODO.md) under "Outbound queue — when to reach
for a broker". Read that first; it is the reasoning, this is the plan.

---

## Why this and not a ticketing tool

Asked 22 Aug 2026: at a spike of 100–500 review tasks a day, should platform
operations run on iTop, GLPI, Plane or Redmine instead of our own screen?

No, for three reasons, in full in TODO.md:

1. A review task **carries the practice's data** — before/after values of a
   contact change, an admin handover, an address correction. That sits behind
   RLS today; an external tracker has no equivalent tenancy model.
2. **The resolution is the compliance evidence.** "A named person looked at
   this and accepted it" has to be in the vault chain. Recorded somewhere
   else, the evidence chain has a hole at exactly the point a human decided.
3. Two systems tracking the same task would **disagree** — our own automated
   checks close tasks from this side too, so any external copy needs
   bidirectional sync, not a one-way feed.

And the volume argument points the other way from where it looks like it
should: if 500 tasks a day are reaching a person, the AI check has failed, and
a tracker would be organising work that should not exist. The lever against a
spike is the checker, which nothing calls yet — that is a different piece of
work from this one.

So: keep the queue in Postgres, keep resolutions in the vault chain, and spend
the day making the existing screen usable at volume instead.

---

## What exists today

`ReviewTask` (`apps/core/prisma/schema.prisma`) already carries most of what
triage needs — this is UI and one query shape away, not a data model change:

```
state          open | claimed | resolved | escalated
claimedBy      String?          -- a lease, not an assignment (see below)
claimExpiresAt DateTime?
raisedAt       DateTime         -- already the sort key the service queries by
autoVerdict / autoConfidence / autoReasoning / autoCheckedBy / autoCheckedAt
resolution / resolvedBy / resolvedAt / resolvedNote / resolvedAutomatically
```

Eight kinds, declared in `packages/domain/src/review-tasks.ts`, each with a
`stakes` of `'low'` or `'high'`. `autoResolvable` is *derived* from stakes
(`stakes === 'low'`), deliberately — nobody can quietly mark a high-stakes kind
auto-resolvable without changing what "high" means:

| kind | stakes | autoResolvable |
|---|---|---|
| `practice_amended` | low | yes |
| `recertification_due` | low | yes |
| `admin_contact_changed` | high | no |
| `address_changed_after_confirmation` | high | no |
| `acting_as_occurred` | high | no |
| `admin_invite_failed` | high | no |
| `email_change_churn` | high | no |

The only screen that reads any of this is `apps/web/app/practice/reviews/ReviewsView.tsx`,
via `GET /review-tasks` (`apps/core/src/review-tasks/review-tasks.controller.ts`).
It already has:

- **Claiming** — `POST /review-tasks/:id/claim`, a *lease* (`claimedBy` +
  `claimExpiresAt`, `REVIEW_CLAIM_MINUTES`), not an assignment. It expires on
  its own; nobody hands it to anybody.
- **Oldest-first ordering** — the service already queries
  `orderBy: { raisedAt: 'asc' }`. Nothing to build here, it just is not
  exposed as a promise on the screen.

What it does NOT have, and what this task is:

## The four pieces

### 1. Assign to a named platform user, plus "assigned to me"

Claim already answers "who is working this right now, for the next N
minutes". It does not answer "whose queue is this, long-term" — a lease that
expires is the wrong shape for a task somebody picked up yesterday and is
still the right owner of today.

- Add `assignedTo` (nullable, a name — same convention as `raisedBy` /
  `claimedBy` elsewhere in this table: a name, never a free-standing id) and
  `assignedAt`.
- `POST /review-tasks/:id/assign` — assign to self or to somebody else
  (claim-on-behalf, in the original phrasing). Assigning does not itself
  claim; a task can be assigned to someone who has not started it yet.
- `?assignedTo=me` filter alongside the existing `state`/`kind` ones.

**The one real design question here, not a detail:** `ReviewTasksController`
says plainly today — *"SCOPED TO A PRACTICE like everything else that carries
practice data... not a thing to hand across tenants."* An "assigned to me"
queue is meaningless if it can only ever show one practice at a time; a
platform operator's actual queue spans every practice they cover. That is a
deliberate cross-tenant read, which CONVENTIONS.md §6 requires be justified
individually rather than assumed — the same shape `ActingAsService.list()`
already uses (`practiceId ? { practiceId } : {}`, only ever reached by a
platform operator, never derived from a request header the way practice scope
is). Follow that precedent, do not invent a second pattern.

### 2. Focus mode

One task on screen. Decide it. Advance to the next one in the *same filtered
set* — do not bounce back to the list and make the reviewer re-apply their
filter and re-find their place.

This is the click-through Carl described, and it is a **route, not a new
system**: the data and the resolve endpoint already exist. The work is
sequencing through a filtered id list client-side (or a `?next=` cursor
server-side, if the filtered set needs to be stable across a session rather
than recomputed after every resolve — recompute is simpler and should be
tried first).

Applies to every kind, high-stakes included. Focus mode is about *not losing
your place*, not about skipping a decision — nothing here should make a
high-stakes task faster to wave through.

### 3. Accept-many, low-stakes only

Bulk-accept for `practice_amended` and `recertification_due` — the two kinds
already marked `autoResolvable` in code. **Each acceptance is still recorded
individually against the person**, the same `resolvedBy` / `resolvedAt` /
`resolvedAutomatically: false` shape as a one-at-a-time accept — a bulk action
must not read as "the system decided ten things", it has to still read as "one
person decided ten things, quickly".

The five high-stakes kinds are explicitly NOT eligible, and that gate is
enforced server-side (checking `autoResolvable` on the kind, not trusting a
client-supplied list of ids) — this is the anti-fraud half of the queue and no
amount of triage tooling should make it cheaper to wave through. That sentence
is from TODO.md verbatim because it is the one constraint this whole task
exists inside of.

### 4. Age on the card, oldest-first as a stated promise

The query already sorts `raisedAt asc`. What is missing is showing it: an age
("3 days") on each card, and the ordering being something the screen visibly
guarantees rather than an implementation detail a reviewer has to trust.

---

## Build order

1. `assignedTo` / `assignedAt` columns + migration (small, unblocks nothing
   else but is the one schema change in this task — do it first so everything
   after works against final shape).
2. The cross-practice read for "my queue" (§1's design question) — get this
   agreed/settled before writing the endpoint, not after.
3. Assign endpoint + filter + UI.
4. Age + ordering-as-a-promise on the card (cheap, do it alongside #3).
5. Focus mode.
6. Accept-many, last — it is the one piece touching the resolve path for
   multiple tasks at once, and should land after focus mode has already
   exercised single-resolve-and-advance.

## Explicitly out of scope

Everything under "Reconsider an external tracker when any of these becomes
true" in TODO.md: platform ops growing past ~8 people, work arriving from
sources we do not own, or somebody needing SLA reporting. None of that is
close, and none of it is this task.

Also out of scope: the automated checker that would actually reduce volume at
a spike ("the lever against a spike is the checker, which nothing calls yet"
— TODO.md). That is a real, separate piece of work and a bigger one.
