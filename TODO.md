# To-do

Things agreed but not built. Not a backlog of ideas — everything here has been
decided, and is written down so it does not get re-decided.

Convention: each entry says what it is, WHY it was deferred rather than done,
and what it depends on. An entry with no "why deferred" is just an unfinished
task and belongs in the code as a TODO comment instead.

---

## Contact details on locations and departments

Asked 23 Aug 2026, while adding the practice page a practitioner sees. At least
`phone1`, `phone2`, `email1`, `email2` on **both** `practice_locations` and
`departments`, shown on that page under each site.

### Why two of each, and not one

A site has a number people ring and a number that is answered when the first is
not — reception and the back office, or the rooms and the after-hours service.
Modelling one and letting practices cram both into a single field produces
`"9555 1234 / 9555 5678 (after hours)"`, which nothing can dial, nothing can
validate, and every screen has to render as free text.

The same for addresses: the one the practice publishes, and the one that
actually reaches somebody.

### The decision to make first

**These are PUBLIC, like `practices.businessPhone` and `businessEmail`.** That
is the whole reason they are new columns rather than a reuse of something
existing — every address already on a location's practice belongs to a person
(`adminEmail` holds a credential) or to us (`groupEmail` is an internal notices
mailbox), and showing either to answer "how do I contact this site" publishes
somebody's personal details.

So they need the same treatment as the practice ones:

- [ ] Added to `reporting.outbound_messages`? **No.** They are contact details,
      not volumes, and the reporting surface stays free of anything that
      identifies a way to reach a person.
- [ ] Returned by `practice_places_for_practitioner`, which already exists and
      already carries the affiliation check.
- [ ] Shown on `/practitioner/practices/[id]` under each location, and later on
      the patient-facing equivalent.
- [ ] Editable by the practice on `/practice/locations`, with the same
      review-task treatment as other contact changes? **Probably not.** A
      location's phone number is not a credential and redirecting it does not
      let anybody receive a sign-in link — the review task on `adminEmail`
      exists because that address holds an account, and copying it here would
      be ceremony without a reason.

### Worth deciding at the same time

- **Should a department inherit its location's numbers when it has none?**
  Inheriting is friendlier and hides whether anybody actually set them. I would
  show the location's and say it is the location's, rather than silently
  presenting it as the department's own.
- **Validation.** An Australian number has a shape; an obviously malformed one
  should be refused at entry rather than discovered by a patient who cannot get
  through.

## A patient or carer terminating an agreement

Asked 23 Aug 2026. A practitioner can now end their own affiliation
unilaterally, and the reasoning applies at least as strongly one level down:
**the person who gave consent should be able to withdraw it without asking the
party who benefits from it.**

If a practice had to agree, a practice could keep an agreement alive after the
patient wanted it gone — which is the same shape as a practice keeping a
departed practitioner listed, and the same fraud.

### The blocker is the definition, not the mechanism

**Get the Health department's definition of a carer before building this.** Not
a detail to fill in later: it decides who may end somebody else's agreement,
and getting it wrong means either a carer who cannot act for the person they
care for, or a stranger who can.

The statutory ground already in play is reg 65CB(5) — an assignor acting for
another person, self-declared. Whether "carer" there is the same set as the
department's carer definition is exactly what needs establishing, and it is a
question for somebody who can read the instrument, not for us to infer.

### What is already decided by things we have built

- **Termination is a fact, not a negotiation.** Same as a practitioner leaving:
  recorded, the other side told, nobody asked.
- **It cannot be retroactive.** Consent captured before the withdrawal stands —
  the agreement ceases, it is not erased. `enduring.ts` already holds this for
  reg 65CA(8) cessation.
- **Evidence is retained in full.** Withdrawing consent does not delete the
  record that it was given; that record is what protects the practice against a
  later claim that it never was.

### What is genuinely open

- [ ] **Whose act is it when a carer does it?** Recorded as the carer's, on the
      patient's behalf — never as the patient's own. A record that cannot
      distinguish them cannot answer "did the patient know".
- [ ] **Is the patient told when a carer acts for them?** Almost certainly yes,
      and the exception (a patient who cannot be told) is the hard case.
- [ ] **Can a patient reverse a carer's termination, and vice versa?** Related to
      the assignor revocation question already open.
- [ ] **What reaches the practice, and how fast?** A terminated agreement changes
      what can be billed, so a practice learning late is a practice billing
      wrongly in the meantime.

**Blocked on the same relationship model as patient and assignor reporting.** An
assignor's authority is per-patient and expires; a role cannot say which patient
or until when, and neither can a termination endpoint that trusts a role.

## Family reporting

Asked 22 Aug 2026, flagged as a selling point rather than a requirement.

Once patient and assignor reporting exists, an assignor who acts for several
people — a parent, a carer, an adult child — should be able to see them
together rather than one at a time. "What has been assigned in my family this
year" is a question no practice can answer and we can.

**It cannot be built before the relationship model is settled.** An assignor's
authority is per-patient and must expire; a family view is that authority
plotted over time, so it inherits every question the relationship has and adds
one more — whether somebody may still see a period they were authorised for
AFTER the authority ends. Probably yes for what they could see at the time, and
certainly not for anything after it, but that is a decision rather than an
obvious answer.

Also worth stating plainly before anybody builds it: a family view makes one
person's records visible to another. That is a feature the patient must be able
to see and revoke, not a convenience granted by whoever set it up.

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

### ~~Platform-admin sign-in~~ — BUILT, 2026-08-22
**Status:** done. Passkey-only, via Keycloak, on the `console` client.

A platform administrator is minted by CLI invitation
(`infra/keycloak/invite-platform-admin.mjs`), enrols a passkey at a link, and
the reviewer screens take the name from the session. The typed-name fallback is
gone from those screens.

**What it cost, and what was learnt:** most of an afternoon and six wrong
theories, all of them recorded in PASSKEYS.md. Read that first next time; the
decision tree at the bottom is the useful part.

**Still open, and tracked in CRITICAL-ISSUES.md:**

- **§2 — the Windows Password Manager trap.** DECIDED 2026-08-22: leave the
  rules as they are, revisit later. `userVerification` stays `required`, no
  password fallback, and the enrolment-time AAGUID check is not being built
  yet. Reasonable while the affected population is two administrators who both
  know about it; **stops being reasonable the moment practitioner sign-in is
  built**, because Windows makes the wrong provider the default and every
  practitioner would meet it alone, at first sign-in, with nobody to ask.
- ~~**Nothing backs up the `keycloak` database.**~~ — `backup-keycloak.mjs`,
  2026-08-22. Dumps it, prunes to the last fourteen, and will restore-test the
  file into a throwaway database on request. The verify checks the USER count
  rather than whether the file loaded, because realms and clients come back
  from the realm import on every start — a backup holding only those looks
  healthy and contains nobody, which is exactly how the H2 store was lost.
  **Still to decide:** where the files go. On the same disk as the database
  they survive a mistake and not a disk, and they name every administrator.
- **`admin/admin` is still in `docker-compose.yml`,** and is now the most
  valuable credential in the system: it is the last resort for admin recovery.

### Practitioner sign-in, and what an acceptance is worth
**Status:** not started. **The affiliation flow is built and works without it.**
**Found:** 2026-08-22, while building the invitation.

A practitioner accepts an affiliation today by opening a link emailed to their
own address and typing a six-digit code from the same message. That is recorded
honestly — `acceptanceMethod = 'email_link_and_code'`, and the evidence says in
words that it proves access to an inbox and not who was at the keyboard.

**What it is good enough for.** The ordinary failure it prevents is not fraud:
it is a practice adding a doctor who never agreed, through haste or a locum
arrangement that fell through, and then capturing consent in that doctor's
name. It stops that completely.

**What it is not good enough for.** It is one factor, and the practice chose
which address to invite. A practice willing to commit fraud can invite an
address it controls — what makes that expensive is CONVENTIONS.md §8b (creating
a practitioner at all requires a validated practice), not this ceremony.

**The fix is the practitioner passkey (FR-1.9),** and the pieces are already
there: `Practitioner` carries `keycloakUserId`, `invitedAt` and
`passkeyEnrolledAt`, and the platform-admin work proved the ceremony on real
hardware. `ACCEPTANCE_STRENGTH` in the domain already ranks passkey above an
emailed code above the practice's own word, so both can coexist and stay
distinguishable in evidence for ever.

**Do NOT retrofit the strength of the old records when it lands.** An
affiliation accepted by email was accepted by email. Upgrading the label later
would be rewriting evidence.

**Depends on:** re-opening the §2 decision, which was deliberately deferred on
2026-08-22 on the grounds that only two administrators were affected. Building
practitioner sign-in is precisely the event that invalidates that reasoning, so
the two have to be picked up together.

---

## Capture

### Telehealth: the call IS the acceptance
**Status:** not started.
**Decided:** 2026-08-22, Carl.

For a telehealth consultation the practitioner calls the patient through the
app, the patient accepts the call, and that acceptance is the consent
ceremony — no separate link, no SMS, no second device.

**Why this is attractive:** it removes the weakest step in remote capture. A
link sent to a phone proves somebody holds that phone; a patient answering a
call they were expecting, in a consultation they booked, with a practitioner
they can see, is a materially stronger act — and it happens inside the
appointment rather than beside it.

**What has to be worked out before it is built,** because each of these
changes what the record means:

- **What exactly is captured.** Accepting a call is consent to the CALL. The
  s 65C data set and the assignment of benefit are a different agreement, and
  the ceremony has to present them, not assume them. A patient who thinks they
  answered the phone has not assigned a benefit.
- **What the evidence is.** A signature is an artefact; an accepted call is an
  event. The record needs something durable — the call metadata, the
  timestamps, what was displayed and read, and whether the patient was told
  what they were agreeing to. Whether that includes a recording is a separate
  decision with its own consent question.
- **Identity.** The call proves the patient answered, not who they are. The
  identifier check (FR-1.4, minimum three, never Medicare) still has to happen
  and probably has to happen visually, on the call.
- **Failure modes.** Dropped calls, the patient handing the phone to somebody
  else, a call accepted while the patient is driving. A ceremony that cannot
  be safely abandoned mid-way is not safe.

**Depends on:** the capture channel work, and a decision on whether telehealth
calls run in our app at all or through a PMS-provided channel.

---

## Testing

### ~~The e2e suite is flaky across suites~~ — SOLVED, and it was not flakiness
**Diagnosed 2026-08-22.**

`org-model.e2e-spec.ts` failed four tests in a full run and passed all
fifty-five alone, which read exactly like fixture interference. It was not.

**The cause: `localhost` resolves to `::1` first on Windows.** Docker Desktop
publishes a port on both stacks, but its IPv6 forwarding accepts the TCP
connection and then fails the protocol handshake. So:

- a raw socket test reports the port **OPEN**
- Prisma reports **"can't reach database server"**
- an SMTP send **hangs** until it times out rather than refusing

The intermittency came from whichever address the resolver returned first,
which is why it looked like a race between suites. It got dramatically worse
the moment registration started sending an acknowledgement email — a second
protocol, over a second port, with the same fault.

**The fix: 127.0.0.1 everywhere in `apps/core/.env`, never `localhost`.** All
150 e2e tests pass.

**The lesson worth keeping:** the symptom is the worst kind — everything looks
up, and only the things that speak a protocol fail. When a connection test
passes and a client says "cannot reach", suspect the address family before
suspecting the service.

---

## Identity

### ~~The two identity-strength dashboards~~ — BUILT, 2026-08-22
**Status:** done. `/review/identity`, platform-admin only, linked from the
review queue.

Two tabs, each answering one operational question, because a dashboard without
a question is a report nobody opens twice:

- **Practices** — which applications are stuck, and on what. Score, the checks
  behind it, time in queue, and the weakest link stated in words rather than
  left for the reader to infer from a number.
- **Practitioners** — whose verification is going stale, and who is moving
  unusually. Blocked first, then weakest, then stalest.

**Practitioner strength DECAYS**, which is the part that needed a new domain
module (`practitioner-strength.ts`). Practice identity is mostly stable facts;
a registration is a snapshot, and "Registered, verified in January" says very
little in December. Each row also shows what one fresh check would restore.

**The "would fail" count is the point of soft mode.** It is on the page: how
many real practices hard enforcement would be turning away today. That is the
number that decides when the threshold is safe to switch on, and it cannot be
seen once you are already enforcing it.

**Still open from §10 of the design**, unchanged and still needing Carl: the
PIE data-usage question, the §7 sign-off for the website fetch, the collection
notice, the retention conflict, and whether a sole trader can reach six points
at all.

---

## Rostering — a practitioner who works at more than one practice

Raised 22 Aug 2026: *"Some practitioners may work 2 days at practice A and 2
at practice B."* Recorded rather than built, per that instruction.

### What already works

**The identity and affiliation model already handles this**, and it was
designed to. A practitioner is one person on the platform; an affiliation is
per practice AND per location, and FR-1.8 refuses a second affiliation at the
same location rather than at the same practice. A provider number belongs to
a place, not a person, which is exactly the multi-site shape.

So Dr X at Practice A on Mondays and Practice B on Thursdays is already two
affiliations, each with its own provider number, each accepted by the
practitioner themselves.

### The one thing that is NOT solved

**Keycloak enforces one email address per realm.** We already hit this in the
e2e logs: the same person at a second practice cannot get a second account on
the same address. It needs either a different address or the existing account
linked rather than duplicated — and linking is the right answer, since it is
one person. Unresolved, and it is the real blocker, not rostering.

### The rostering idea

Also raised: build a simple roster — *"which Dr is working when"* — offered
free or at minimal fee as a sweetener for small practices.

**Worth taking seriously for a reason beyond goodwill.** A roster would let
the platform answer a question it currently cannot: *was this practitioner
actually at this location on the day that consent was captured?* Today an
affiliation says they work there in general. A roster says they were there on
the Tuesday. That is a genuine strengthening of the consent record, and it
would feed the same strength scoring as every other check.

**But note the risk before building it.** A roster is operational data that
changes constantly, and this platform is an evidence store where things are
append-only and retained for two years. If a roster becomes evidence, every
shift swap becomes a record we cannot delete. That is not a reason to refuse
— it is a reason to decide up front which it is:

| If the roster is… | Then |
|---|---|
| **A convenience feature** | Keep it out of the evidence chain entirely. Mutable, deletable, no vault events |
| **Evidence of presence** | Append-only like everything else, and a shift correction is a new record rather than an edit |

Deciding that late would be expensive, because the storage shape follows from
it. Deciding it early costs nothing.

### If it gets built

- [ ] Decide the question above FIRST — convenience or evidence
- [ ] Resolve the one-email-per-realm constraint; account linking, not a second account
- [ ] Roster entries per affiliation, not per practitioner — the affiliation is what carries the location
- [ ] A capture-time check: is this practitioner rostered here today? Warning, not a block, until it is trusted
- [ ] Keep it optional. A practice that does not roster must not be worse off
## Outbound queue — when to reach for a broker

Asked 22 Aug 2026: should we use BullMQ, RabbitMQ or Pulsar instead of the
Postgres queue?

### Decision: no external tracker (ServiceNow / Jira / Zammad) for review tasks

Asked 22 Aug 2026: at a 100-500/day spike, is there an open-source ServiceNow
or Jira we could hold outstanding tasks in, assign to different platform
users, and click through one at a time?

### Why we did not, and what would change that

They exist and they are good. Closest to ServiceNow: **iTop** or **GLPI**
(both ITSM, both GPL/AGPL). Closest to Jira: **Plane** or **Redmine**. For a
general operations desk any of them would beat writing our own.

Three things stop it being right HERE:

1. **The task carries the practice’s data.** A review task is not a pointer —
   it holds the before and after values of what changed, including admin
   contact details. Today that sits behind RLS and a practice can only ever be
   seen by somebody scoped to it. In every tracker listed, everyone with
   access to the project sees every ticket. That is not a configuration we
   would be tightening; it is the absence of a tenancy model.

2. **The resolution IS the evidence.** "A named person looked at this change
   and accepted it" is the compliance record — that is the whole reason the
   queue exists rather than the change just applying. It has to be in the
   vault chain and retained with everything else. Recorded in Zammad instead,
   our evidence chain has a hole at exactly the point a human decided.

3. **Two systems would disagree.** Closed there, open here; and our own
   automated checks resolve tasks from this side, so the sync is
   bidirectional, not a feed.

### The volume argument points the other way

If 500 tasks a day are reaching a person, the AI check has failed, and a
tracker would be organising work that should not exist. The mix matters:
`practice_amended` and `recertification_due` are low-stakes and already
`autoResolvable`. The other three — admin contact changed, address changed
after confirmation, acting-as occurred — are high-stakes and a person MUST
decide them. That is deliberate: they are the anti-fraud controls, and no
amount of queue tooling should make them cheaper to wave through.

So the lever against a spike is the checker, which nothing calls yet.

### What to build here instead (~1 day)

- [ ] Assign a task to a named platform user (claim already exists; this is
      claim-on-behalf, plus an "assigned to me" filter)
- [ ] Focus mode — one task at a time, decide, advance to the next in the
      filtered set. This is the click-through Carl described and it is a route,
      not a system.
- [ ] Accept-many for low-stakes kinds, with each decision still recorded
      individually against the person
- [ ] Age on the card, and oldest-first ordering

**Reconsider an external tracker when any of these becomes true:**

- [ ] Platform operations grows past ~8 people, or runs shifts needing handover
- [ ] Work arrives from sources we do not own (support email, phone) and needs
      to sit in one place with these
- [ ] Somebody needs SLA reporting we would otherwise build

**If it comes to that, mirror — do not move.** Push a task STUB out (id, kind,
practice name, age; no changed values) and treat the tracker as the worklist,
while the decision is still made and recorded here. That keeps both the
tenancy boundary and the evidence chain intact, and it is the same shape as
the outbox decision above.

## Why we did not, and what would change that

All three are out-of-process brokers, which means the enqueue cannot be in
the same transaction as the evidence write. That gives two failure modes we
cannot accept: a notice with no send, and a send with no notice. The standard
fix is a transactional outbox — so **we build this table either way**, and
the only real question is whether a broker is needed IN ADDITION.

At the modelled 750,000 notices/day (~21/second average) it is not. Verified:
two workers claiming concurrently through `FOR UPDATE SKIP LOCKED`, zero
overlap, no coordinator.

**Adopt RabbitMQ when any of these becomes true:**

- [ ] Sustained throughput above ~100/second, or peaks the database feels
- [ ] Cross-region fan-out, where a single Postgres is the wrong hub
- [ ] Non-Node consumers that would otherwise need their own claim logic
- [ ] A second product needs the same messages, and polling our table is worse than subscribing

**RabbitMQ over the other two, if it comes to that.** BullMQ needs Redis, and
Redis as a durability-critical store for "must not lose this" makes AOF and
fsync tuning a compliance question — the wrong shape for evidence. Pulsar’s
tenancy sounds like a fit and is not: our tenant boundary is Postgres RLS
(CONVENTIONS.md §6), and moving notice CONTENT into a broker takes it outside
that boundary and re-implements isolation in a second system.

**The migration is cheap because the outbox exists.** The relay changes
destination; nothing else moves. That is the point of building it this way,
not an accident.

## "What was sent to me" — a separate screen from the queue

Raised 22 Aug 2026 alongside the queue viewer: practitioners should see
notices for their practices, and patients/carers should see their own.

**Agreed on the need. Not from the queue table, though**, and the reason is
not fussiness:

| | Queue (`outbound_items`) | Evidence (`Notice`) |
|---|---|---|
| Retention | **Pruned after ~30 days** | Full statutory period |
| Question it answers | "Did this leave? Is it stuck?" | "What was sent, and what happened to it" |
| Audience | Operators, practice admins | Practitioners, patients, regulators |

A patient looking at the queue would watch their own records vanish. The
queue is transport and is deliberately disposable.

**And patients have no accounts, by design.** REQ-PORT-08: a patient signs
from a single-use link and must never need one. A patient-facing history
screen means building patient authentication — a large new surface, and one
that reverses an existing decision rather than extending it. Worth doing
deliberately if we want it, not as a side effect of a queue viewer.

### If it gets built

- [ ] Source it from `Notice` + `NoticeDeliveryEvent`, never `outbound_items`
- [ ] Decide the patient auth question FIRST — token-scoped view, or real accounts
- [ ] A practitioner spanning practices needs a deliberate cross-tenant read; RLS forbids it by default and every exception is individually justified (CONVENTIONS.md §6)
- [ ] A carer selecting a patient is an authority question, not a filter — who may act for whom has to be recorded before it can be offered
## View-only view of a practice, cascading

Carl: from `/practice` we may just want to LOOK at a practice and its
relationships without acting as it — the same seven-card hub, read-only, and the
read-only must cascade into practitioners, locations and everything below.

Worth doing, and the cascade is the hard half: a read-only hub that links to
editable children is worse than no read-only mode, because it looks safe and is
not.

- [ ] One flag carried in the URL is NOT enough — a page reached directly is
      then editable. The scope has to be decided per request, not per link
- [ ] Simplest honest shape: an operator with no acting-as session gets read-only
      by construction, because every mutating endpoint already needs a practice
      claim they do not have. The UI then reflects what the server would do
      rather than inventing a second rule
- [ ] Which means the work is mostly: let an operator READ a practice's pages,
      and hide every control that would fail. Not a new permission — a truthful
      rendering of one that exists
- [ ] Cascade by rendering from the same "may I act" answer on every page,
      sourced once (`effectivePractice.ts` is the natural home)
- [ ] A banner saying plainly: viewing, not acting. With the way to start acting
      if that is what they meant
- [ ] Nothing read-only may show provider numbers or anything else that must not
      cross a practice boundary — read-only is not a licence to read MORE

## Practitioners working a long way from the practice

Carl's question: if a practitioner is affiliated to a practice a long way from
where they appear to work, flag it quietly? Or does that read as big-brother?

**Both, and the resolution is in WHO it is shown to.**

The signal is real. A practice adding practitioners who have no plausible
connection to it is one of the clearest shapes of the fraud this platform
exists to stop — provider identities collected to bill under, rather than
people who actually see patients there. Ignoring geography throws away one of
the few signals available before anything is billed.

The fear is also real, and it is not paranoia. Australian practitioners
legitimately work across enormous distances: locums, fly-in-fly-out, telehealth,
rural outreach, a specialist rotating through four towns. A flag that treats
distance as suspicion insults exactly the people doing the hardest work, and it
would be **wrong far more often than it was right**.

### What makes it safe

**Never shown to the practice, and never named as suspicion.** A quiet flag that
the practice can see is not quiet — it teaches somebody committing fraud which
distance to stay under, and it accuses somebody innocent to their face.

**It is a REVIEW input, not a decision.** It changes nothing about whether the
affiliation works. Nobody is refused, nothing is blocked, no message is sent.
It moves a practice up a reviewer's list, and a human decides.

**It is only interesting in aggregate.** One practitioner 900 km away is a
locum. Six practitioners at one practice, all far away, none sharing a
location, added the same week, is a different object entirely — and the second
is the one worth a person's time. Alerting on the first would bury the second.

**Say it out loud in the collection notice.** "We look at how far affiliations
are from the practice" is a sentence people accept when they read it up front
and resent when they discover it. Quiet must mean "not shouted at the
practitioner", never "concealed from them".

### If it gets built

- [ ] Compute from POSTCODES only. Never a street address, never a coordinate
      for a person — HARD-03 territory in spirit: the least precise thing that
      answers the question
- [ ] Distance from the practice LOCATION they are affiliated to, not head office
- [ ] Bands, not metres: same area / same state / interstate / remote. A number
      invites a threshold, and a threshold is a thing to stay just under
- [ ] Raise a review task ONLY on the aggregate pattern, never on one person
- [ ] Absent from every practice-facing screen and from every message
- [ ] Never blocks an affiliation, an invitation or a capture
- [ ] In the collection notice before the first real applicant
- [ ] Test the honest cases explicitly: the locum, the FIFO doctor, the
      telehealth practitioner, the specialist across four towns. If the design
      flags those individually, it is the wrong design

**Recommendation:** worth building, and worth building last of the AI-checker
signals. On its own it is a bad predictor; alongside "added five practitioners
in a week", "none has ever captured consent" and "no register check recorded",
it is one column in a picture that a person then reads.

## groupEmail changes apply instantly, with no proof

Carl caught it directly: "group email changed - no email verification sent."

`groupEmail` is one of the plain `AMENDABLE_FIELDS` -- it changes on save like
a phone number, with no hold and no proof, unlike `adminEmail` (held pending
the new address answering a code) and unlike a practitioner's own address
(same, plus a backup-address warning). This was not an oversight so much as
never having been asked: the field's own schema comment says "NOTHING ENROLS
AGAINST THIS ADDRESS. It receives notices only" -- so an unverified groupEmail
cannot by itself be used to obtain a credential, which is a real and different
risk profile from adminEmail.

**It is not nothing, though.** `groupEmail` is the CO-WITNESS for an
`adminEmail` handover -- `pending-email.service.ts` warns both the old admin
address and `previousGroupEmail` when a handover is requested, specifically so
a second channel can object. An attacker who can amend the practice at all
(any practice-admin session) can repoint `groupEmail` to an address they
control, THEN request the adminEmail handover -- and the witness meant to
catch it is now them. Two steps, no proof required for either, and the second
step's protection depends on the first step being trustworthy.

- [ ] Decide whether `groupEmail` needs its own held/proof cycle -- a third
      copy of the `PendingEmailChange` shape (practice admin's is the model),
      or a lighter one, since nothing enrols against it and the stakes are
      narrower
- [ ] At minimum: warn the OLD groupEmail when a change is saved, mirroring
      the admin-email pattern, even before deciding whether to hold it
- [ ] `SENSITIVE_CONTACT_FIELDS` already names `groupEmail` alongside
      `adminEmail`/`adminPhone` (review-tasks.ts) -- so a groupEmail change
      already raises a review task at `admin_contact_changed` stakes. The gap
      is specifically that it takes effect BEFORE anybody reviews it, not that
      it goes unrecorded

## Can somebody read another practice by editing the URL?

Carl asked about `/platform/practices/<uuid>/practitioners`. Answered here
because the answer is not obvious and the obvious fix is the wrong one.

**No, and the reason is not the URL.** `auth.guard.ts` line 193:

    if (principal.practiceId) request.headers['x-practice-id'] = principal.practiceId;

A practice user's token claim **overwrites** whatever practice id the request
carried. So a practice administrator who edits the URL, or forges the header,
gets their OWN practice back — the id they typed is discarded before any query
runs. That is the control, and it is a good one: it cannot be forgotten at a
call site, because it happens once, above all of them.

A platform operator has no practice claim, so the header is not overwritten and
they can read any practice. That is the intent of these routes.

**Masking or encrypting the id would protect nothing.** It is security by
obscurity: anybody who has a real id — from a support email, a screenshot, a
previous session — defeats it, and it makes every log and bug report harder to
read. A UUIDv4 is 122 unguessable bits, so the list cannot be walked; what stops
a *known* id being misused is the guard, and it already does.

**What is genuinely open, and should be closed:**

- [ ] `AUTH_ENFORCE=false` in dev means a request with NO token passes and the
      `x-practice-id` header is trusted as sent. So in DEV, anybody who can
      reach the API can read any practice. That is the staging, deliberately —
      but it means the dev environment is not evidence that production is safe,
      and nobody should read it as such
- [ ] Verify each read endpoint under `AUTH_ENFORCE=true` before launch. The
      claim-overwrite protects everything that reads the header, but a query
      taking a practice id from a PARAM rather than the header would bypass it —
      audit for that shape specifically
- [ ] `assertPracticeScope` only checks that a claim EXISTS, not that it matches
      the request. Today that is sufficient because of the overwrite; if the
      overwrite is ever removed or made conditional, this becomes the hole. Add
      a test that pins the overwrite, so it cannot be deleted quietly
- [ ] Nothing on a read-only practice page may show a provider number. The
      guard `assertNoProviderNumber` exists; make sure these routes are covered

## TAUTALA — the assistant, and the reminders that come first

Full design in **tautala_ai.md**. `tautala` is Samoan for "to speak".

**Phase 0 first, and it needs no AI.** A practice approved and then stuck is the
commonest failure we have — Throwaway Verification Clinic is approved with a
signed-in administrator and no location; Sampletown has four locations and
NOBODY who can sign in. Neither is hard. Both are somebody not finishing a
four-concept task they will do once in their life.

- [ ] Reminder email to the administrator, the manager and the group address,
      naming the ONE thing outstanding and linking straight to it. The setup
      gaps already carry a label, a sentence and a destination, so the email
      writes itself
- [ ] A decaying schedule — day 3, day 10, day 30, then stop. A reminder that
      arrives forever is one nobody reads
- [ ] How to reach a person, in every one
- [ ] Measure completion. If this alone fixes it, TAUTALA is a convenience
      rather than a rescue — better known before building it than after

**Then TAUTALA, in the order that keeps it safe:**

- [ ] Phase 1, READ ONLY: what is missing, why, who works here, what happened to
      this affiliation. Write tools do not exist yet — absent, not disabled.
      Most of the value, almost none of the risk
- [ ] Phase 2, DRAFT: the model proposes a typed intent; the platform validates
      it with the SAME rules the forms use; the user sees exactly what will be
      created and presses a button; the server writes it as THEM, through the
      ordinary endpoint
- [ ] `createdVia: 'tautala'` on every record, so a reviewer can tell whether a
      human typed an address or a model parsed one

**Why this may act where the support chat may not:** the user is signed in and
scoped, and TAUTALA grants no authority the session did not already hold. It is
a faster path to something they can already do. That is the whole licence, and
everything in the design exists to keep it true.

**It can never accept an affiliation.** Only the practitioner can, from the
invitation sent to their own address. If TAUTALA could create AND accept, the
rule that a practice cannot accept on a practitioner's behalf collapses — and
that rule is load-bearing for the fraud model. Enforced by the tool not
existing, never by a prompt.

Never touches a provider number or a Medicare card number, never records a
register check (ours, not theirs), never approves a practice, never issues a
credential.

Needs Carl: an LLM in the request path (CLAUDE.md 7), transcript retention, and
whether TAUTALA is offered beyond practice staff — recommendation is not at
first.

## Support, lockouts and passkey recovery

Full design in **support.md**. The short of it:

- [ ] `/support` page, reachable signed in or out, listed in the menu for everybody
- [ ] Lane A (signed in) — chat immediately, ticket bound to the verified identity
- [ ] Lane B (signed out, no credential involved) — public, rate-limited, unverified contact
- [ ] Lane C (signed out, needs a credential) — **never resolved in chat**; a ticket
      plus an out-of-band challenge to the channels we already hold
- [ ] Ask what they typed, contact what we hold, store only whether the two matched
      (REQ-VER-04 / HARD-04: identifier types and outcomes, never values)
- [ ] Never confirm whether an account exists — the same answer either way, or the
      chat becomes a lookup service for valid practitioner identities
- [ ] `passkey_compromised` disables first and verifies after; it is an incident,
      not a request

**Before any of that, the cheap work that removes most of the need:**

- [ ] Prompt for a **second passkey** at enrolment; nag while somebody holds one
- [ ] **Verified mobile** on practitioners and practice admins — captured at
      enrolment, because one collected during an incident proves nothing.
      `practitioners` has no phone column today
- [ ] Self-service add / remove passkey, and self-service "my key was stolen"

**Resolution paths, which are stronger than any question a chat could ask:**

- [ ] A practice admin, signed in, requests re-enrolment for their affiliated
      practitioner — the introduction chain, run in reverse
- [ ] Two platform operators, different people, for a locked-out practice admin
- [ ] Cooling-off and old-channel notification on every reissue, reusing the
      pending-email-change pattern

Needs Carl: LLM in the request path (CLAUDE.md 7), a third-party bot check,
mobile numbers in the collection notice, and what to do about a practitioner
whose introducing practice no longer exists.

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
- **The Windows passkey provider trap** — every practitioner will hit it, and
  Windows defaults them into it. Three ways to go, recorded in full in
  CRITICAL-ISSUES.md §2; the recommendation is to detect the AAGUID at
  enrolment and refuse a non-UV provider there and then.
- **Can a sole trader reach 6 points?** If not, the identity threshold quietly
  excludes them, which is a policy decision and not a scoring detail.

## The MBS basic-service-description mapping (D6a)

Raised 25 Aug 2026 from CONSULTATION-CAPTURE-PLAN.md §2.4 / Part 6 Q2. A
pre-agreement needs a Basic Service Description from a versioned mapping, and
**no MBS item → description mapping exists anywhere in the repo** —
`basicServiceDescription` is a free-text DTO field and `mappingVersion` is
recorded against nothing. Until this is settled the containment check
("does the billed item fall inside the pre-agreement's description",
plan §3.1) cannot be built, and a pre-agreement + a differently-billed item is
treated as covered.

- [ ] Decide: source the real quarterly MBS mapping (versioned, from the
      Department's schedule) — or accept the practice-maintained interim list
      (plan §2.4) for the first practices?
- [ ] If interim: the list is a small versioned table per practice, and
      `mappingVersion` records ITS version honestly rather than pretending to
      be the MBS mapping.
- [ ] Either way: the containment check is deferred, and the deferral is
      stated in code with the REQ reference — never an implicit equality.

## Reminding the practice to do its part

Carl, 25 Aug 2026: "We need a solution to remind the PRACTICE to do this."
The print channel (plan Part 8) depends on a human pressing Print — the
morning appointment list and each invoice — and on the practice maintaining
its interim description list above. Nothing today notices when they stop.

- [ ] A daily "expected vs received" check per practice: appointments seen
      this morning but no invoices arrived by evening ⇒ a nudge to the
      practice's group address. Plan §8.6 limit 2 names this; it is not built.
- [ ] No morning appointment list received by (configurable) 9am on a working
      day ⇒ a nudge. Public-holiday aware — `public-holidays.ts` exists.
- [ ] Where the PMS supports auto-print rules ("print invoice on finalise"),
      the onboarding guide for that PMS says how to set them, so the reminder
      is the fallback and not the mechanism.
- [ ] The interim description list not reviewed in N days ⇒ a low-stakes
      review task, not an email — it is housekeeping, not a breach.
- [ ] Every nudge is Correspondence (plan §4.1) and follows CONVENTIONS.md §9d
      like every other message.

## A platform-wide view of messages — states, not bodies

Carl, 25 Aug 2026: "How does a platform-user see all messages — in queue /
sent and so on?" Today: one practice at a time, through the view-only twin
(`/platform/practices/[id]/queue` for transport state, and since 3 Sep 2026
`/platform/practices/[id]/correspondence` beside it — which passes the
`platform` audience, so it shows states and never bodies). There is deliberately no cross-practice
list of message CONTENT — `outbound.controller.ts` says why: a body search
"would let somebody trawl for a patient name across a practice", and across
every practice it is worse.

- [ ] Build the platform view as an OPERATIONS view: per practice, per lane /
      channel — queued, leased, sent, failed, dead, oldest age. Counts and
      states, never subject lines or bodies. `outbound_timeseries` and
      `/inbound/print-jobs/metrics` already give most of it.
- [ ] Drill-down into ONE practice for content goes through the existing
      view-only twin, and every read of a body is an `access.read` vault event
      (REQ-LOG-07) — a platform operator reading a patient's message is
      exactly the kind of read that has to be answerable later.
- [ ] Cross-practice reads are individually justified SECURITY DEFINER
      functions returning ids and counts (CONVENTIONS.md §6) — the same shape
      as `outbound_due_practices`, never a weakened policy.

## "Consultation" in the purpose labels, against the terminology rule

Carl, 3 Sep 2026, specifying the correspondence log's purpose column:
`Episodic-Agreement-Pre-Consultation`, `Episodic-Agreement-Post-Consultation`,
`Enduring-Agreement-Pre-Consultation`, `Episodic-Notice-Post-Consultation`, and
`-Reminder-1|2|3` on a reminder. Built exactly as asked.

### Why it is written down rather than silently changed

CLAUDE.md section 3 sets the terminology the domain model enforces:
**"service", not "consult"** (REQ-MP-01), alongside "provider" not "GP". The
labels above say Consultation, so they cut across a rule the rest of the
product follows. It was raised once and Carl's wording stands -- he knows the
regime, and the plan documents themselves talk about pre- and
post-consultation capture, so the rule may well be aimed at the billable
event rather than at the appointment.

This entry exists so that the decision is FINDABLE if a reviewer asks why one
screen says Consultation and everything else says service, rather than being
rediscovered as a bug.

### If it is ever reversed

- [ ] It is a one-word change: every label is composed in
      `apps/web/app/strings.ts` and nothing is inlined (REQ-LANG-01), so
      Pre-Consultation becomes Pre-Service in one place per label.
- [ ] The agreement TYPES do not change -- `episodic_pre` and `episodic_post`
      are the domain's own names and are not user-facing text.
- [ ] Check the patient's half of the log at the same time. The same labels
      render there, and a patient reading "Pre-Service" may need plainer
      words than a practice does; the two audiences share one string table.
- [ ] Nothing else needs touching: the label is composed from the agreement
      type carried on the row, never from a subject line.

## The message copy itself, in every channel

Carl, 3 Sep 2026, looking at the correspondence log: "The email and SMS content
itself will have to be updated."

The templates were written to prove the pipeline, not to be read by a patient.
Seen side by side on one screen -- which is what the correspondence log made
possible -- they are inconsistent in voice, and the SMS ones were written to a
length nobody checked against a real segment count.

- [ ] Every template reviewed as COPY, by channel: SMS, email, and the printed
      letter, which has different constraints again.
- [ ] SMS costs money per segment. Count segments and say so, rather than
      discovering it on a practice's bill (REQ-SMS-06 already puts spend on
      the console).
- [ ] The guardrail words stay out: never "certified", "approved",
      "accredited", "government-approved" (REQ-65C-05). A lint rule catches
      these in the string table; templates must obey it too.
- [ ] No benefit or dollar amount on anything about an agreement. The 89AA
      notice is the one place an amount belongs (REQ-REG-04).
- [ ] An 89AA notice never acquires approval semantics or a chase (REQ-END-05,
      REQ-CHASE-02) -- its copy says a service WAS billed, and asks nothing.
- [ ] Templates are versioned content like everything else here, and each
      stored message already records the version it was sent under. Changing
      copy must mint a new version rather than editing one in place.
- [ ] Plain English, and the reading level checked. The audience is every
      patient, not a confident one.

Depends on nothing; blocked by nobody. It is a writing task with a review, and
it should happen before a real practice sends any of them.

## From the Claude Design handoff (25 Aug 2026) — what was built, what was not, and why

`.claude/claude_design/AoBPlatform UI Design Request.zip` covers the kiosk
and console at high fidelity and seven surfaces at wireframe level. Carl's
rule: build only what it designs.

- [x] **Reconciliation queue** (wireframe `1d`, R-1 list + R-2 item detail) —
      BUILT as `/practice/reconciliation` and its view-only platform twin,
      using the app's existing components. The cascade's "why this patient
      was not asked" word sits beside each item (`service_records.captureSuppressedReason`).
- [x] **R-3 convert-or-forgo (FR-7.3)** — BUILT 25 Aug 2026: append-only decision record, `reconciliation.decided` vault event, `POST /reconciliation/:id/decide`, the R-3 panel in the item detail. (Was: drawn but had NO backend: no
      decision record, no vault event type, no endpoint. Needs a small domain
      item first — a `reconciliation.decided` event carrying the deciding
      person, the choice (private billing / forgo / keep chasing) and the
      reason. Then the screen.
- [ ] **R-2's "Escalate to a person" / "Hand back"** are drawn; the ladder is
      shown from the band policy but nothing records an AI or human chase
      attempt yet (only capture requests and correspondence exist). Attempt
      tracking is its own item.
- [x] **Practice correspondence screen (M-1)** — BUILT 3 Sep 2026 as
      `/practice/correspondence` and its view-only platform twin, off the
      existing `GET /correspondence`. The patient's half (P-1, Messages tab)
      was built with it at `/patient/messages/[token]`, off
      `GET /agree/:token/messages` — one query, one string table, one
      component (`apps/web/app/correspondence/MessageLog.tsx`), which the
      practitioner's own list now uses too. Purpose, chase-ability and
      audience rules are `packages/domain/src/correspondence-log.ts`
      (`eightynineAA_rows_have_no_chase_action`). Three parts of the drawing
      are NOT built, each for want of a source rather than for want of a
      screen:
      - **Per-message cost** (the M-1 Cost column and "$18.40 this week").
        Nothing records what a send cost — no rate card, no gateway price on
        the row. The column is absent and the page says so; a made-up figure
        would be worse. Needs REQ-SMS-06 pricing before it can be drawn.
      - **"Stop reminders"** (P-1). No cross-channel stop/opt-out mechanism
        exists anywhere — grep found no STOP handling in `outbound/`,
        `capture/` or `messaging/`. The control renders disabled with its
        reason. STOP must apply across every channel at once, so this is one
        item: a stop record on the patient, honoured by every sender.
      - **"Reminder 2 of 3"** — the ordinal is derived and shown ("Reminder
        2"); the *of 3* is the chase band's allowance and would need the band
        policy on this screen.
      M-1's two header buttons are also not built: **Export** (the log as a
      file) has no endpoint behind it, and **Message templates** is a settings
      screen of its own, not part of the log. Both are their own items.
      P-1's Agreements and Access tabs are not built: there is no patient
      portal session (REQ-PORT-08 — no account), so the Messages tab is
      reached by the same link the patient already holds.
- [ ] **A forbidden-word lint rule** for "certified", "approved",
      "accredited", "government-approved" in user-facing strings. The design
      handoff and CLAUDE.md rule 12 both assume it exists; `eslint.config.mjs`
      only carries the `medicareNumber` identifier rule. Needs a pass over
      `strings.ts` first — the patient's own approval copy uses "approve"
      legitimately, so the rule needs to be about our forms, not every use.
- [ ] **The Industry token set** (Barlow, `#5980a6`, square corners) — the
      handoff asks for it to be ported into the theme layer. That re-themes
      every screen and is a product decision, not a side effect of one page.
      Decide before the kiosk build, where the hi-fi screens depend on it.
