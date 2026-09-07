# Recertification and acting-as — proposal

**Status:** APPROVED 2026-08-22 by Carl, with three additions in Part 5. Build order in Part 4.
**Written:** 2026-08-22.

Two designs in one document because they meet in a place neither reaches alone,
and that meeting point turns out to be the most important thing here.

---

## Why these two belong together

Annual recertification is **the** moment a platform administrator acts for a
practice. The practice has not logged in for a year, the admin who onboarded
has left, the passkey is on a laptop nobody has, and somebody at AoBPlatform
opens the file to get it done before the deadline.

So the impersonation design has to be right *before* recertification ships, or
the first large-scale use of impersonation will be the one nobody was watching.

And there is a sharper reason, in §3.1. It is the part of this proposal I would
most like disagreed with if it is wrong.

---

## Part 1 — Recertification

### 1.1 What an approval currently is, and why that breaks

An approval today is a **state**, not an event:

```
validationState  = 'validated'
validatedByName  = 'carl@hillsempire.com'
validatedAt      = 2026-08-22
```

and `decide_organisation_validation` refuses to run twice, saying
*"re-deciding would overwrite the record of who approved it"*. That refusal is
exactly right for a single decision and exactly wrong for a recurring one: next
year's approval would **overwrite** this year's, and the evidence that the
practice was properly approved in 2026 would be destroyed by approving them in
2027.

For a compliance obligation the history *is* the artefact. "Approved" is worth
little; "approved every year since 2026, by these people, on this evidence" is
the thing a regulator asks for.

### 1.2 Approvals become a series

A new append-only table. The practice keeps `validationState` as a **projection
of the newest row**, so nothing that reads it today has to change.

```
practice_validations
  id
  practiceId
  sequence            1, 2, 3 … — the certification year
  decision            validated | rejected | lapsed
  decidedByName       never "the system"
  decidedAt
  note

  -- The scoring, as it stood THAT year. These columns already exist on
  -- practices and move here, which is what makes them meaningful.
  identityScore
  identityScoringVersion
  identityWouldPass
  identityEnforcement

  -- Recertification only
  supersedesId        the validation this renews
  dueAt               when the NEXT one is due
  actingAsSessionId   set when done under impersonation (Part 2)
```

**The scoring version is why this works.** `identityScoringVersion` is already
stamped at the decision, deliberately, so that *"a re-weighting must never
rewrite what a past reviewer was shown"*. That is precisely the property a
yearly series needs: 2026's approval stays true under 2026's rules even after
the weights change in 2028.

### 1.3 Checks have to expire, and they do not

`summariseChecks` takes the latest outcome per key and gives it full weight for
ever. A phone call made in January 2026 still scores three points in December
2027.

That is defensible for a one-off admission decision and indefensible for an
annual one — recertification would be a formality in which last year's evidence
approves this year's practice.

Practitioner strength already solved this: `sightingFreshness()` decays a
register sighting linearly between the recheck window and three times it. The
same shape applies here, and I would reuse it rather than invent a second
notion of staleness.

⚠ **DECISION: how long is a practice check good for?**

| | Argument |
|---|---|
| **12 months, full weight, then zero** | Matches the certification year. Simple to explain. Cliff-edged. |
| **12 months full, decaying to zero at 24** *(recommended)* | Mirrors practitioner strength. A practice that recertifies slightly late is not instantly unverified. |
| **Per-check** | An ABN lookup ages differently from a phone call. Most accurate, most to maintain, and the accuracy is probably false precision. |

I recommend the middle one, and specifically **not** per-check until there is
evidence the difference matters.

### 1.4 What happens when it lapses

⚠ **DECISION, and the one with real consequences.**

**Capture must not stop silently.** The design documents warn repeatedly about
silent invalidation — an agreement that has quietly ceased while claims are
still being made against it is the worst failure this platform has. A practice
discovering at 9am on a clinical morning that consent capture has stopped,
because of a date, would be that failure wearing a different hat.

Proposed ladder:

| When | What happens |
|---|---|
| 90 days before | The hub says so. One card, worst-first, as everything else. |
| 30 days before | Email to the practice admin. Escalating, not nagging. |
| Overdue | Loudly overdue everywhere. **Capture continues.** |
| 60 days overdue | A platform administrator must decide: extend, or suspend. **A human, named.** |

The last row is the point. **No automatic suspension.** Suspending a practice
stops it recording consent for patients who are in front of it today, and that
is not a decision a date should make. It is a decision a person makes, and
signs.

### 1.5 What recertification actually asks

Not the whole onboarding again. The questions that go stale:

- Is the ABN still ACTIVE, and does the name still match?
- Is the entitlement still true — is this person still the one who speaks for
  this practice? (People leave. This is the one most likely to have changed.)
- Are the locations still real and still theirs?
- Are the practitioners still registered? *(Already continuous — practitioner
  strength decays on its own.)*

The ABN check is an API call. The entitlement check is a phone call to a number
we find ourselves, exactly as at onboarding — and it is the expensive one,
which is the honest reason recertification costs something.

---

## Part 2 — Acting-as

### 2.1 What is wrong today

Nothing is recorded. Literally: the practice screens have **no notion of who is
acting at all**. `x-practice-id` is the only scope, the audit trail for a
location records no actor, and with `AUTH_ENFORCE=false` anyone who can reach
the service can send that header.

So this is not "impersonation is badly recorded". It is "action is
unattributed", and impersonation is the case that makes it obvious.

### 2.2 The session, and the key

A platform user opens a session **against a practice**, and it mints a key.

```
acting_as_sessions
  id              the correlation key. SERVER-MINTED.
  principalSub    who is acting — any platform user, not only platform_admin
  principalName
  practiceId      who they are acting FOR
  reason          typed at open. REQUIRED.
  openedAt
  expiresAt       time-boxed; an open session is a live capability
  closedAt
  endReason       closed | expired | revoked
```

**For a practice, not for a user.** The commonest support case is that no
practice-admin user exists yet — often that is *why* somebody is acting. A
user-to-user model has a null in the column that matters most. A person is
named only when one was actually involved.

**The server mints it and validates it on every write:** it exists, is open, is
unexpired, belongs to *this* principal, and is scoped to *this* practice. A
client-supplied key taken at face value would let a caller stamp records with
somebody else's session — or, worse, stamp a genuine practice action as
impersonated, which is a way to disown your own act.

**Stamped by an interceptor, never passed as a parameter.** If every service
method has to remember to thread it through, one will not, and the one that is
missed will be the one that matters.

### 2.3 Where the key is written

The vault already carries `actor` and `subject` on every event and is
tamper-evident. Putting the session id **in the actor** makes "everything
session X did" one query, with no schema change across sixteen tables.

That works *now* because the four audit holes are closed — `location.added`,
`department.added`, `credential.added` and `credential.removed` all emit.
Before that, stamping would have inherited the gaps.

A real column is proposed in only two places, where a record's provenance must
be readable without the vault:

- **`practice_locations`** — the address prints in the s 65C(5)(a) particulars
  block of every agreement captured there.
- **`practice_checks`** — they are evidence in their own right. See §3.1.

**Null means the practice did it themselves.** That distinction must survive;
null is "not impersonated", never "unknown".

### 2.4 What the person acting sees

Not the practice-admin chrome. A banner, in the grammar the dev-bypass banner
already uses, because *a bypass that looks like a normal signed-in state is how
one reaches production*:

> **Acting as XLEVELUP.** Everything you do is recorded as you, and the practice
> will be told. Reason: *practice admin locked out, ticket 412*.

### 2.5 The practice is told, afterwards

**Notification, not permission.**

Carl proposed an OTP to the practice admin before a session opens. I argued
against it and still would, for three reasons:

1. **It fails exactly when it is needed.** The commonest reason to act for a
   practice is that they cannot get in. An OTP to the inbox they cannot read is
   a lock with the key inside.
2. **It teaches the wrong reflex.** We would be training practice admins that
   AoBPlatform sends codes and our staff ring up asking them to read one out.
   That is the shape of every OTP-relay scam, and we have spent real effort
   making our emails *not* look like that.
3. **An OTP is authentication, not authorisation.** It proves somebody read an
   inbox. It does not prove they understood what they were agreeing to.

⚠ **DECISION.** If you want a gate rather than a notice, I would put it only on
**irreversible** acts, and never on the ones that unblock a locked-out practice.

### 2.6 No deletes

Agreed, and it is already the house rule everywhere else — agreements cease and
are retained, checks are append-only, affiliations end. The one violation was
`removeCredential`, and it is fixed.

Under an acting-as session the rule should be **stronger, not merely equal**: a
platform user acting as a practice may not perform any destructive act at all,
including the soft ones. Removing a credential while impersonating is
indistinguishable from tidying away inconvenient evidence.

---

## Part 3 — Where they meet, and the rule I care most about

### 3.1 A platform user must not manufacture the evidence that approves a practice

This is the reason the two designs had to be read together, and it is not
obvious from either alone.

The identity score counts **verified credentials**. The flow is:

1. the practice adds a credential — `addCredential`, **scores nothing**
2. somebody at AoBPlatform checks it — `verifyCredential`, and **now it scores**

Step 1 is the practice's assertion. Step 2 is our verification of it. The score
means something *because those are two different parties*.

**Impersonation collapses them.** A platform user acting as the practice
performs step 1, then as themselves performs step 2 — and the practice's score
rises on evidence AoBPlatform created and then confirmed. Nothing in the record
would show it, because both acts look perfectly ordinary on their own.

At recertification this stops being hypothetical. Somebody is trying to get a
lapsing practice over the line before a deadline, they hold both roles, and the
quickest path is to supply the missing credential themselves.

**Proposed rule.** Evidence created inside an acting-as session is **marked, and
does not score**:

- `practice_checks` and `practice_credentials` carry the session id
- `summariseChecks` ignores anything created under one
- the dossier shows it as *"added by AoBPlatform on the practice's behalf; does
  not count toward the score"*

It is **not blocked**. There are legitimate reasons to enter something for a
practice over the phone. But it must not be worth points, because the entire
basis of the score is that entry and verification are separate parties.

⚠ **DECISION: ignore entirely, or discount?** I recommend **ignore**. A partial
weight is a number nobody can explain, and "some of your score came from us
typing it in" is not a sentence worth having in a compliance conversation.

### 3.2 Recertification under impersonation is recorded as such

`practice_validations.actingAsSessionId`. A recertification performed while
acting for the practice is a real thing that will happen, and the record should
say so plainly — including on any certificate or evidence pack.

---

## Part 4 — Build order

Each step is useful on its own, deliberately: none of this is a big-bang.

1. **`acting_as_sessions` + the interceptor + the banner.** Attribution first,
   before anything depends on it.
2. **Session id into the vault actor.** "Everything session X did" as one query.
3. **§3.1 — evidence created under a session does not score.** Small, and the
   most important rule here.
4. **Notification to the practice.**
5. **`practice_validations`** as a series; `validationState` becomes a
   projection of the newest row.
6. **Check decay**, reusing `sightingFreshness`.
7. **The due-date ladder and the escalations.**
8. **The recertification screen**, which is mostly the dossier again.

Steps 1–4 are the impersonation work and stand alone. Steps 5–8 are
recertification, and depend on 1–3 only for the case where the two meet.

---

## Decisions needed

| # | Decision | Recommendation |
|---|---|---|
| 1 | How long a practice check stays good | 12 months full, decaying to zero at 24 |
| 2 | What happens when certification lapses | Warn and escalate; **no automatic suspension** — a named human decides |
| 3 | OTP before an acting-as session | No. Notify afterwards; gate only irreversible acts, if anything |
| 4 | Evidence created under impersonation | **Ignore it in the score**, do not discount it |
| 5 | May a platform user remove anything while acting | No |

---

## What this proposal does NOT cover

- **Reads.** A platform user *looking at* a practice's data is a privacy event
  even when nothing changes, and it is the thing a practice would most want in
  a disclosure request. The session record shows that somebody opened one
  against them, which is a start and is not the whole answer.
- **Who may open a session.** Any platform user, per Carl's instruction — but
  whether that needs its own role, separate from `platform_admin`, is open.
- **Certificates.** If recertification produces something a practice shows to
  anybody, its format is a separate question with legal input.

---

---

## Part 5 — Carl's additions, 2026-08-22

Three requirements added on approving the above. All three are stronger than
what was proposed, and one of them replaces the weakest control in it.

### 5.1 Impersonation forces re-approval (rule 6)

Any acting-as session puts the practice back through approval, **even if it is
currently active**.

This is what turns impersonation from *logged* into *costly*. A log nobody reads
is not a control; a consequence somebody feels is. And it makes the quick path
and the safe path the same path, which is the only kind of control that survives
a busy afternoon.

### 5.2 The re-approval must be a different person (rule 7)

**This replaces §3.1 as the load-bearing control**, and it is better.

§3.1 said evidence created under impersonation must not SCORE. That works only
while the scoring exclusion is implemented correctly and stays correct — it is a
rule enforced by arithmetic, and arithmetic gets "fixed".

Rule 7 does not depend on any of that. The person who acted as the practice
cannot be the person who blesses the result. If the scoring exclusion were
removed tomorrow by mistake, one individual still could not manufacture evidence
and approve it.

Keep both. §3.1 stops impersonated evidence counting; rule 7 stops it being
signed off by the same hand. The second holds when the first fails.

**A hard refusal, not a warning.** Carl asked for it as a refusal, and a warning
would be worthless here: the person clicking past it is exactly the person the
rule exists to stop.

### 5.3 Recertification is self-service, and every point must be addressed

The practice gets a link. Against each data point already held they either
confirm it or change it — **no "confirm all"**.

The reason this is right is not thoroughness for its own sake. It is that a
tick-every-point list is **harder to do carelessly than to do properly**. A
single confirm button gets pressed without reading; a list of twenty points
where one has been left blank shows exactly where the attention ran out.

It also produces something worth having: an explicit, dated statement from the
practice about each fact, rather than a global "still fine" that means nothing
when a fact turns out to be wrong.

Soft, not mandatory — so it warns and escalates, per recommendation 2, and never
suspends by itself.

### 5.4 What this costs, stated plainly

Support becomes more expensive. Acting for a practice to fix one field now
triggers a re-approval that a second person has to perform.

That is the intended trade. It is also an argument for making practices more
self-sufficient — better self-service, clearer errors, a working recertification
flow — rather than for softening the rule when it becomes inconvenient.

### 5.5 The deadlock to watch

Rule 7 means a **single** platform operator cannot impersonate and then
re-approve at all. With two, one impersonates and the other signs off.

That is arguably correct rather than a bug — a lone operator being able to act
as a practice and then approve their own work is the exact thing rule 7 exists
to prevent. But it makes the second administrator **load-bearing rather than a
convenience**, and that should be a deliberate operational decision rather than
something discovered the first time somebody is on leave.


## Related

- [IDENTITY-STRENGTH-DESIGN.md](IDENTITY-STRENGTH-DESIGN.md) — the scoring this rests on, and §2 on why enforcement is soft
- [CONVENTIONS.md](CONVENTIONS.md) — §6 on RLS exemptions, which the session lookup will need
- [PRACTICE-ONBOARDING.md](PRACTICE-ONBOARDING.md) — the chain recertification repeats
- [TODO.md](TODO.md) — practitioner sign-in, which shares the passkey questions
