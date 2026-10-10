# Decisions

A running log of product and regulatory decisions taken in working sessions,
each dated and attributed, with the requirement it rests on and what would
reopen it. Earlier decisions live in `.claude/docs/aob-design-decisions.md`
(19 Aug 2026) and are cross-referenced from `TODO.md`; from 4 Sep 2026 new
decisions are recorded here first.

Format: **what was decided · who · when · why · what changes it.**

---

## D-2026-09-04-01 — Verification stays at three identifiers; two is not enough

**Decided:** A patient verifying themselves on the kiosk must match **three**
approved identifiers. Family and given names together count as **one**, so
name + date of birth is two, and a failed address is a failed verification —
the patient is told the generic "some details don't match" and, after three
attempts, to see reception. The floor is not lowered for the in-practice
kiosk. — Carl Hill, 4 September 2026, after asking whether name + DOB with a
non-matching address was "enough of a security check".

**Why:**
- RACGP *Standards for General Practices* 5th ed., criterion C6.1, indicator
  C6.1A: a minimum of **three** approved patient identifiers, explicitly
  including identification "over the telephone or electronically". Adopted as
  REQ-VER-01. The identifier set is configurable per practice but the floor of
  three is not (REQ-VER-03; C4.3 default 3).
- Name is one identifier, not two (REQ-VER-02: "family + given names together
  count as one").
- A screen we design that passes a patient on two matches would put the
  practice below the accreditation standard it is assessed against.

**What we do instead of lowering the bar:**
- Address is the identifier most likely to fail for non-identity reasons
  (abbreviations, a moved patient, a stale PMS line). The match is already
  component-based (`addressMatches`, 3 Sep 2026); the address-validation
  service on the TODO (G-NAF / PAF canonicalisation of both sides) completes
  it. A genuine patient with an out-of-date address still fails — correctly —
  and reception updates the record.
- In the reception-push flow the patient types nothing: staff performed the
  three-identifier check across the counter and the push records it as the
  staff-verified verification event (REQ-VER-03, REQ-VER-04). Kiosk address
  mismatches therefore only affect unsupervised walk-ups, for whom "see
  reception" is the right outcome.

**What would reopen it:** the RACGP 6th edition. The draft (Sept 2025
consultation) appears to require a minimum of **two** identifiers (criterion
renumbered CG2). It is not in force, the 5th edition remains the accreditation
standard, and that reading is single-sourced from a machine read of the draft
PDF (REQ-VER-06) — it must be verified page by page before it appears in any
customer-facing claim. If it lands as read, the floor becomes a practice
setting with a default of two, and name + DOB becomes a legitimate
configuration. Until then: three.

**Where it is enforced:** `apps/core/src/verification/identifier-matching.ts`
(`evaluateChallenge` — every challenged type must match; no partial pass),
`apps/core/src/kiosk` (`POST /kiosk/claim` evaluates all three), the
practice's `identifierTypes` setting (floor enforced server-side). Named test
to add: `two_matching_identifiers_do_not_pass` (see TODO).

---

## D-2026-09-04-02 — Patient passkeys live in core, not in Keycloak

**Decided:** FR-8.2's passkey half is implemented in `apps/core` with WebAuthn
directly — `@simplewebauthn/server@14.0.0` in core and
`@simplewebauthn/browser@14.0.0` in web, both pinned exactly, neither making a
network call at runtime. Patients are **not** Keycloak users and there is no
second realm for them. — Carl Hill, 4 September 2026 ("Implement"), on the seam
left by the portal build.

**Why:**
- **Patients are not staff.** Hard rule 15 and the Keycloak realm exist for
  practitioners and admins, who have console accounts, roles and an
  organisation. A patient has none of those and must never need one
  (REQ-PORT-08).
- **The portal already owns the account and the session.** `portal_accounts`,
  `portal_sessions` and the httpOnly `aob_portal` cookie are core's; adding a
  second identity provider would mean two systems believing they own the same
  session.
- **The bootstrap is the binding, and only core can perform it.** What makes a
  patient's credential mean anything is the three-identifier check against ONE
  practice's record, run through the verification module under that practice's
  RLS scope, against PMS-held values. Keycloak has no access to any of that and
  could not do it.
- **A patient realm would put PII in Keycloak for no gain.** Every Keycloak user
  carries a username and usually an email. The portal account deliberately holds
  neither — the practice's patient row is the master (REQ-DATA-10) — so a realm
  would create a second, weaker copy of patient identity outside the encrypted
  stores.

**What was NOT done, and why it is worth recording.** `portal-authenticator.ts`
predicted that an enrolled passkey would make the identifier path insufficient
(`nextStepKey: 'passkey_required'`). That was wrong. A patient who enrols a
passkey and then loses, sells or breaks the phone would be locked out of the one
path that does not need the phone. REQ-PORT-08 says the portal is never a
precondition of anything; a second factor that can strand somebody behind a lost
device is exactly that, one layer down. **The two doors stay independent.** The
seam remains for a factor that must be satisfied *in addition* to the identifier
check — a practice-level policy, or a step-up for an account flagged in a
dispute.

**What would reopen it:** a requirement for **federated patient identity** (myGov
/ Digital ID, or a national consumer identity the regime later assumes), or SSO
for a patient across the practices they attend. Either makes an identity provider
the right home and this decision the wrong one. A change in the patient portal's
threat model that demanded credential recovery flows would also reopen it — we
have none by design, and building them is what an IdP is for.

**Where it is enforced:** `apps/core/src/portal/portal-passkey.service.ts` (the
four rules: bootstrap first, single-use challenge, counter regression refused,
revoking the last is allowed), `portal-passkey.controller.ts` (six routes; the
four session-bound ones resolve the cookie first), `portal-webauthn.ts` (the
library behind the `PORTAL_WEBAUTHN` seam — one file imports it),
`apps/core/prisma/migrations/20260904090000_portal_passkeys`. Named tests:
`passkey_registration_requires_a_bootstrapped_session`,
`passkey_challenge_cannot_be_replayed`,
`passkey_counter_regression_is_refused`.

**Still to record:** `aob-tech-stack.md` says "Keycloak (OIDC, passkeys)" without
distinguishing staff from patients. It needs a line saying patient passkeys are
core's — **Carl to add; not edited by the agent that made this change.**

---

## D-2026-09-07-01 — Console sign-ins end after four idle hours, not thirty minutes

**Decided:** The `aobplatform` realm's `ssoSessionIdleTimeout` is 14400 s
(4 hours); `ssoSessionMaxLifespan` stays 36000 s (10 hours); the access token
stays 300 s. Set in `infra/keycloak/realm-export.json` and applied to the dev
realm by the admin API the same day. The console copy reads the figure from
`NEXT_PUBLIC_SESSION_IDLE_MINUTES` so the sentence "Sign-ins end after N
minutes without activity" never disagrees with the realm. — Carl Hill,
7 September 2026 ("do both - fix the copy and raise the idle timeout").

**Why:**
- **A reception desk is idle in bursts.** Thirty minutes without a console
  action is normal mid-morning; the person is still at the desk. Each expiry
  cost a passkey ceremony and, on 7 Sep, confusion — the page said "You are not
  signed in" to somebody who had signed in an hour earlier.
- **The short-lived credential is the access token, not the SSO session.**
  Tokens still expire after five minutes and refresh silently; a stolen token is
  worth five minutes either way. The idle timeout only decides how long a
  browser that has gone quiet can come back without a passkey.
- **Ten hours is the hard ceiling** and is unchanged: a session opened at
  8 am ends by 6 pm whatever happens.

**What would reopen it:** a customer's security policy requiring a shorter
idle window (make it per-realm configuration, not a code change); shared
reception PCs where several staff use one browser profile (the answer there is
a per-user profile or a kiosk-style lock, not a shorter timeout); evidence from
the access log that unattended consoles are being used by someone other than
the signed-in user.

## D-2026-09-10-01 — The who-is-signing panel keeps its draft across Close

**Decided:** On the practice console (`/practice/tablet` and the patient work
page), what reception types into the "Who is signing" panel for a row — the
other person's name, relationship, mobile, email and the 18+ attestation —
is kept in page memory when the panel is closed and shown again when it is
reopened, until it is saved, the row is pushed, the row leaves the list, the
practice changes, or the page is left. Nothing is written to the browser.
— Carl Hill, 10 September 2026 ("keep it and record it"), after a carer's
details were lost to a missed 18+ tick followed by Close.

**Why:**
- **Reception types these once, at a busy desk.** Losing four fields to a
  missed tick and a reflex Close costs the patient's time as well as the
  desk's.
- **It is a carer's contact details, not the patient's clinical record.** The
  correction panel two sections up deliberately drops a PATIENT's details on
  Close so nothing sits on a monitor facing the room; this panel holds less,
  and the page is behind a passkey sign-in with a four-hour idle limit
  (D-2026-09-07-01).
- **Memory only.** No localStorage, no IndexedDB; a reload forgets it. The
  asymmetry with the correction panel is accepted, not accidental.

**What would reopen it:** a practice raising the monitor-facing-the-room
concern for carer details; the access log showing unattended consoles; or the
draft outliving its usefulness in practice (then age it out after N idle
minutes, or forget on sign-out and navigation). Tracked in TODO.md.

## D-2026-09-11-01 — A contact-only change to the other signer does not supersede the agreement

**Decided:** When the person signing for the patient keeps the same identity —
same `assignorIsPatient`, name, relationship, authority basis and note — and
only their mobile or email changes, the change is recorded in place on the
agreement's current signer record with a vault event
`assignor.contact_changed` (ids and field names, never values). The agreement,
its particulars, its render and its hash are not touched. A change to WHO
signs still supersedes after the lock, exactly as before. — Carl Hill,
11 September 2026 ("yes - build the contact-only change"), on the fact that
no signer contact is rendered into the artefact.

**Why:**
- **Contact is not a particular.** The s 65C particulars type carries the
  signer's name and relationship and nothing else about them; the only phone
  and email on the rendered agreement belong to the practice letterhead
  (checked 11 Sep 2026: `packages/domain/src/agreement.ts`,
  `apps/core/src/render/*`). A mobile correction therefore moves no rendered
  byte and no hash, so hard rules 2 and 13 are not engaged.
- **Superseding for a typo was the wrong size of answer.** It produced a second
  agreement, render and hash to fix a number that appears on none of them, and
  it is what let a mobile change vanish on 10 Sep when the same-answer check
  compared names only.
- **Reception expects a typo fix to fix the typo.** One press, one record
  updated, the row unchanged.

**Boundaries:** only on the newest agreement in a supersession chain
(otherwise `409 agreement_moved_on`); never on a patient-signer, whose contact
lives on the patient record (REQ-DATA-10); rule 10 checks unchanged. Rules
collected in ASSIGNOR-RULES.md.

**What would reopen it:** the Department adding signer contact to the s 65C
data set or to a prescribed form; a template that prints the signer's contact
(then it becomes rendered and the change must supersede — the classifier and
the renderer must be kept in step, and a test should pin that no template
renders signer contact while this decision stands).

---

## D-2026-09-11-02 — The post-service second push: a rendered service is decided by a versioned table, and a signed pre-agreement for the day covers it

**Decided:** A service the practitioner has rendered reaches the platform as
`POST /arrivals/service-rendered` — the practice's own handle for the patient,
the practitioner by any of the four keys an arrival may use, the day the service
was rendered (D5) and its MBS item numbers (D6b), and nothing else. A second
table in `packages/domain/content/visit-agreement-policy.json` (bumped to
`visit-policy-2`) decides what is owed: a SIGNED episodic pre-agreement for this
patient × this practitioner × this day means `covered` and the patient does
nothing; a live enduring agreement for that practitioner and patient means
`covered_by_enduring`; anything else means a new `episodic_post`, drafted,
validated, rendered, locked and put on reception's desk for the same tablet.
— Carl Hill, 11 September 2026, from TODO.md "Two front doors" decision (b) and
"Still to build: Post-service push".

**Why:**
- A post-agreement is s 65C(4) table item 6 and its data set differs from a
  pre-agreement's: D5 is the date the service **was** rendered and D6b is the
  MBS item number(s), "post-agreements only" (REQ-REG-01; source: the PMS
  invoice). D6a — the Basic Service Description — is "pre-agreements only" and
  is deliberately not assembled onto a post-agreement.
- The tap is a **signature in its own right** (REQ-REG-07), never a
  confirmation of the earlier one: the pre-step's signature covers only what its
  description covered. What the pre-step carries forward is that reception has
  already verified this person, so the second push records a **fresh**
  staff-verified event with the same staff identity (REQ-VER-03) at zero cost to
  the patient.
- One signature per episodic visit, not two (TODO.md). Asking a patient whose
  billed item is already covered would collect a second consent for one service.
- The decision is versioned content and never the PMS's (hard rule 14). The
  regulator changed the rules twice and reversed once; a mapping hardcoded in a
  system we do not control is the failure versioning exists to prevent.
- Coverage is per practitioner × patient, never per practice (hard rule 6,
  REQ-END-01) — there is no input here that could widen it.
- `covered_by_enduring` is its own answer rather than a second `covered`,
  because an ongoing agreement's **claim** carries a reg 89AA notice, and that
  is the claim's business: one-way, never gating payment, never chased (hard
  rule 7, REQ-END-05, REQ-CHASE-02). Nothing in this path fires one, and wiring
  a notice to an invoice would put the 24-hour clock in the wrong place
  (CONSULTATION-CAPTURE-PLAN §3.1).

**Two things deliberately deferred, and said out loud rather than guessed:**
- **The containment check.** "Is the billed item INSIDE that pre-agreement's
  Basic Service Description" needs the REQ-REG-03 mapping of MBS items to
  descriptions, which does not exist — it is the quarterly MBS Online ingest
  with a human-reviewed diff, and CONSULTATION-CAPTURE-PLAN §3.1 already records
  the check as blocked on it. Until it lands, a signed pre-agreement for the
  practitioner, patient and day **counts as covering** the service, which is
  the behaviour that plan records. There is deliberately **no**
  `itemInsidePreAgreementDescription` input in the table: an input nothing can
  compute would be a lie in a rule table, and the loader refuses one.
- **Item numbers are shown as numbers, not as words.** The tablet shows D5 and
  the item numbers; it cannot show "their Basic Service Descriptions" because
  the same mapping is missing. Nothing was invented to fill the gap.

**Where the endpoint lives, and why not the print-job lane.** Both doors are
real and mean different things. `POST /inbound/print-jobs` carries an INVOICE
and feeds the **remote** cascade — the patient has gone and a link goes out to
them. This is the patient still standing at the desk, and it produces an
**in-practice** capture request on the same tablet reception used an hour ago.
Nothing in either names a Medtech endpoint (D-01 is unresolved, CLAUDE.md §5).

**What it refuses, out loud rather than silently:** any field whose name matches
/medicare/i (hard rule 1, REQ-VER-02) and any field that looks like money (hard
rule 4, REQ-REG-04 — an invoice has a figure on it and an assignment of benefit
does not). It carries no patient details at all and never creates a record from
a billing message: an unknown record number is refused with the fix named, and
the mirror is refreshed only by an arrival (REQ-DATA-10).

**Who signs.** The signer of the day's pre-agreement is carried onto the
post-agreement draft so step ① is one press — but the **confirmation** is not:
`assignorConfirmedAt` stays null and the push still refuses
`assignor_not_confirmed` until somebody answers. A new agreement owes its own
confirmation (ASSIGNOR-RULES rule 1).

**The thirty-minute nudge.** `PostServiceChaseSweep` opens the existing
cascade's first rung when no signature lands within thirty minutes of the
platform learning of the service — the visit where the patient left another way,
or a telehealth service with no desk to come back to (TODO.md: "they run only
when the patient did not come back to the desk"). After that rung the cadence is
banded by days left on the lodgement window, not elapsed time (REQ-CHASE-05),
and the existing ladder owns it. **Behind `POST_SERVICE_CHASE_ENABLED`, off by
default**, because `ChaseAttemptsService` records what a person did and exposes
no way to start a cascade, so there was no existing entry point to wire to — and
it sends real messages, which CLAUDE.md §7 says to ask about rather than switch
on. Never past the deadline (REQ-CHASE-08), never a confidentiality-flagged
patient (REQ-CHASE-03), never a notice.

**What would reopen it:** the REQ-REG-03 mapping landing (which adds the
containment input and its row, and lets the tablet show descriptions beside the
item numbers); D-01 resolving, which may change where the message comes from but
not what it says; or a decision that a covered visit should still be shown the
agreement it is covered by on the tablet rather than only at the desk.

**Built:** 11 September 2026. Named tests
`post_service_push_drafts_an_episodic_post_from_the_rendered_service`,
`a_covered_service_drafts_nothing_and_says_so`,
`post_agreement_carries_d5_and_d6b_and_no_amount`,
`post_agreement_locked_before_the_tablet_can_sign`,
`post_push_records_a_fresh_staff_verified_event`,
`tablet_skips_the_details_check_after_a_same_day_verified_session`,
`tablet_runs_the_details_check_when_nothing_was_verified_today`,
`no_signature_in_thirty_minutes_enters_the_cascade`,
`service_rendered_endpoint_rejects_a_medicare_number`,
`desk_shows_post_service_rows_with_the_numbered_strip`.


## D-2026-09-11-03 — a contact address is never typed on the tablet

**Date:** 11 September 2026. **Decided by:** Carl. **Asked because:** W6
"send me a copy" has to reach the patient somewhere, and the obvious design is a
box on the tablet's complete screen.

**The decision.** The tablet OFFERS to send the copy to the contact already on
file, shown partly masked so the patient can recognise it without it being
readable across the room. It does not accept a new one. When the address is
wrong or missing, the tablet says to see reception, and reception makes the
change on the desk where it already can.

**Why.** Three things line up on the same answer.

- A contact change is a change to a record, and the patient surface is not where
  records are edited. "Nothing on the patient surface is ever staff entry"
  (4 Sep) is the same principle from the other side.
- For a patient signing for themselves, the contact lives on the PATIENT record
  and the practice management system is the source of truth (ASSIGNOR-RULES
  rule 6, REQ-DATA-10). A box on the tablet would write to the wrong place, or
  quietly create a second copy of it.
- Zero footprint: an address typed on glass has to live somewhere between the
  keystroke and the send, and the tablet is the one place it may not.

**What this closes.** The open question in ASSIGNOR-RULES.md §4 — "whether a
contact-only change should be offered on the tablet as well as the desk" — is
answered no.

**What would reopen it.** A practice where reception cannot reach the desk
during the ceremony (the roaming-assistant flow, TODO), or evidence that
patients are routinely leaving without the copy because the address on file is
stale. Either would be a reason to revisit, and neither is a reason to put a
free-text box on patient glass without deciding it again.

## D-2026-09-12-01 — Passkey enrolment carries its own per-platform steps, on the page, in a Keycloak theme

**Decided:** The "Passkey Registration" page shows a guidance panel beside the
box listing the browser and operating-system dialogs the person is about to
see, chosen from a picker with four entries — Windows PC, Mac, Android, iPhone
or iPad. The panel lives in a Keycloak **login theme** (`aobplatform`), not in
`apps/web`, because the page is Keycloak's and always will be. — Carl Hill,
12 September 2026, from screenshots of his own Windows enrolment.

**Why:**
- Enrolment is the one moment the platform hands the person to dialogs it did
  not draw and cannot annotate. Three or four of them appear in a row, none
  mentions AoBPlatform, and the page behind them says nothing.
- On Windows the FIRST of those dialogs offers the wrong provider by default.
  Microsoft Password Manager enrols happily and its PIN unlocks its own vault
  rather than verifying the person, so the assertion arrives without the UV
  flag and the next sign-in is refused with a message that explains none of it
  (CRITICAL-ISSUES.md item 2 — it cost the best part of a day to diagnose the
  first time). Step 3 of the Windows list, and the note under it, exist to stop
  that happening to anybody else.
- Four platforms rather than one, and the picker defaults from the user agent
  but gates nothing: the person setting a colleague up is frequently not on the
  colleague's machine.

**Where it is:** `infra/keycloak/themes/aobplatform/login/` — the template
`webauthn-register.ftl` (stock keycloak.v2 markup, wrapped), the steps in
`messages/messages_en.properties`, the layout in `resources/css/aob-login.css`.
The realm binds it via `loginTheme` in `infra/keycloak/realm-export.json`,
asserted by `npm run validate:realm` so a rebuild cannot quietly lose it.

**Assumption Carl still has to confirm.** Only the **Windows** steps are taken
from real screenshots. The Mac, Android and iPhone/iPad steps are written from
the current shape of those dialogs and have not been walked through on a real
device. They are content, not code — a wrong line is fixed by editing the
properties file, with no template or code change.

**What would reopen it:** Keycloak shipping usable per-authenticator guidance
of its own; a decision to front enrolment with our own page in `apps/web` and
hand Keycloak only the ceremony; or Windows retiring the two-provider dialog,
which would make the Windows note obsolete rather than merely unnecessary.

## D-2026-09-12-02 — We offer the queue, not the calendar

**Date:** 12 September 2026. **Decided by:** Carl. **Asked because:** many
practices schedule manually or in hybrid systems, and offering scheduling free,
or free for a year, looked like an easy way to sweeten adoption and to give the
front desk everything in one place.

**The decision.** AoBPlatform does not build scheduling. It builds the QUEUE —
who is here, who is next, who is with whom — and reads the appointment book when
a practice's own software offers one.

**Why.**

- **It would invert hard rule 8.** The platform never blocks care, and that is
  keepable today because we are not on the critical path: an outage slows
  evidence while the practice keeps working. Own the appointment book and an
  outage stops the practice seeing anybody. Different availability bar,
  different on-call duty, different insurance.
- **It is a second product**, against HotDoc, AutoMed, HealthEngine and the
  scheduler inside every PMS, competing for the months before an April 2027 GA
  and a 30 June 2027 statutory deadline.
- **It makes us a competitor to the vendors we need**, with D-01 still open and
  Medtech the first customer's PMS.
- **Free is the expensive part**: migration off an existing book, dual entry
  through any hybrid period, and double-booking when two systems both think they
  own a slot.

**What we do instead.** The manual-card mode and the front desk page
(`QUEUE-TICKETS.md`, `FRONT-DESK-PAGE.md`) already give a practice with no feed a
working queue. That is the part a small practice feels, at a fraction of the
cost.

**What would reopen it.** Evidence from the first ten practices that they are
refusing specifically because we cannot see their book, rather than on price or
effort. Worth asking directly; cheap to find out.

## D-2026-09-12-03 — A substitution asks two questions, and both are questions

**Date:** 12 September 2026. **Decided by:** Carl. **Asked because:** when a
practitioner is away and a patient will be seen by somebody else, it is tempting
to send one message carrying the new agreement — which reads as "sign this" when
the honest question is "is this all right?".

**The decision.** Two separate questions, in this order, and each phrased as a
question.

1. **The substitution.** *"Do you agree to see Dr Okafor at the same time as your
   current booking?"* Answerable yes, or no with a way to rebook.
2. **The assignment.** Only after the first is answered yes. The pre-visit
   agreement for the covering practitioner, sent the way any pre-visit agreement
   is sent.

**Why they cannot be one message.** They are different consents. Agreeing to see
a different clinician is a decision about care; assigning a Medicare benefit is a
decision about money. Bundling them means a patient who only wanted to say "yes,
that's fine about the doctor" has also signed a financial instrument, and a
patient who wanted to rebook has been asked to sign something irrelevant.

**The nuance that must not be lost.** This governs the MESSAGES and the invitation
flow. It does not touch the wording of the agreement artefact itself, which is
regulated content — the assignment statement on the signed instrument stays
exactly as it is, and nobody should "improve" it into a question. The questions
lead up to the ceremony; the ceremony's own words are not ours.

**And it never gates care** (hard rule 8). A patient who answers neither question
is seen as normal and signs at the desk. Pre-check-in is a convenience.

**What would reopen it.** A patient-experience finding that two messages are worse
than one — in which case the answer is better sequencing inside one flow, never
one bundled consent.

## D-2026-09-12-04 — Who names the billing provider for a nurse's arrival, and how a waiting arrival is fixed

**Date:** 12 September 2026. **Decided by:** Claude, mid-build, from Carl's
5–7 September ruling — **an assumption for Carl to confirm or overturn**, written
up as one rather than left in a code comment (wow.md §9).

**Asked because** `ARRIVAL-WHO-IS-SEEN.md` §3 says a `works_under_provider`
arrival is accepted and the agreement is drafted "under the supervising
provider, **once named**", and §5 says "the desk offers the fix, with the person
seen already filled in" — but the spec does not say who may name that provider,
by what route, or what carries the fix. Without an answer, "once named" is
unreachable and the middle row of §3 has no ending.

**The decision, in three parts.**

1. **The arrival contract gains one optional field, `billingAffiliationId`** —
   whose provider number the claim goes under, when it is not the person the
   patient came to see. The four existing keys keep their meaning and name WHO
   WAS SEEN.
2. **It is `reception` only**, fenced out loud from every other source by
   `assertNothingForbiddenWasSent`, exactly as D5, D6a and D7 are. This is the
   7 September ruling KEPT rather than reopened: a `supervisingProviderId` from
   the PMS was considered then and rejected, because it would have the
   practice's software deciding whose name goes on a contract. A person at the
   desk may say it; a machine may not.
3. **The fix is a resend under the same idempotency key**, not a new endpoint.
   An arrival that was accepted, has no billing provider and drafted nothing is
   re-decided when the same key comes back with one named — the same shape a
   refused arrival's retry has always had, and it supersedes the waiting row
   rather than putting one person on the queue twice.

**Why a resend rather than an endpoint like `POST /arrivals/:id/provider`.**
That endpoint replays the sender's own held message (`refusedPayload`), and the
database refuses to hold a payload on anything but a refused arrival
(`arrivals_payload_held_only_while_refused`). A waiting arrival is ACCEPTED — its
patient row is the record from that moment (REQ-DATA-10) — so there is no held
message to replay, and holding one would be a second copy of the patient record
sitting in a JSON column. Widening that constraint to make the endpoint work
would trade a clean invariant for a route.

**`mayBeProviderOnAgreement` is untouched by all of this** (hard rule 6's
neighbour). `billingAffiliationId` runs the identical check the arrival always
ran: naming a nurse there is refused with `provider_not_servicing`, pinned by
`a_nurse_still_cannot_be_the_provider_on_an_agreement` in both
`packages/domain/src/billing-roles.test.ts` and
`apps/core/test/arrivals.e2e-spec.ts`.

**And `provider_not_servicing` narrowed rather than disappeared.** At the arrival
door it now means only two things: a billing role this platform does not
recognise (fail-closed — "we do not know what this person's services need" is
never allowed to become "nothing needs signing"), and a `billingAffiliationId`
naming somebody who may not be the provider on an agreement. An arrival naming
nobody resolvable is still refused, still with the code it had —
`provider_not_anchored` — which is `ARRIVAL-WHO-IS-SEEN.md` §5's last row read as
"this case is unchanged", the safest reading of a row whose code column is
loose.

**What would reopen it.** Carl saying the desk should get a first-class endpoint
and screen for naming the billing provider (in which case the payload-holding
constraint is the thing to revisit, deliberately); or D-01 resolving in a way
that makes the PMS the natural place to state a supervising provider, which
would reopen the 7 September ruling itself and not just this.

## D-2026-09-12-05 — The console has two homes: the day's work, and setting up

**Date:** 12 September 2026. **Decided by:** Carl Hill, rejecting a thirteenth
card on the setup hub — *"I asked for the practice/practitioner link to be on the
attached card. That is the wrong place. We need a better starting point for the
practice-admin, practice-manager or practice-reception."* Name confirmed the same
day: *"Today is the right word — build the navigation."*

**Decided:**

1. **`/practice/today` is the day's work and the default landing for practice
   staff.** Five destinations and no more: the front desk, who is waiting, the
   tablet desk, the patients, the messages.
2. **`/practice/setup` keeps configuration and oversight** — devices, templates,
   users, the application, reports, reviews, reconciliation — and carries **one**
   link back to the day's work.
3. **Nobody lands on the setup hub any more.** Reception, a manager and an
   administrator all land on `/practice/today`; a practitioner keeps
   `/practice/practitioner` (D-2026-09-12 landing rule, ROLES.md §6 rule 5); a
   platform operator acting as a practice lands where practice staff land,
   because they are standing in for them.
4. **Nothing moved URL.** Every route is where it was and every bookmark still
   works; what changed is what links where and where an arrival is put down.

**Why.** The hub had reached twelve destinations in 752 lines, because it was
where everything already was. A receptionist starting a shift and an
administrator changing the letterhead landed on the same screen and each had to
read past the other's work. The fault is that the hub is organised by WHAT A
THING IS — and nobody arrives at a practice console thinking "I need a
configuration page". `today` is organised by why somebody came.

**Where it is enforced.** `landingPath` in `packages/domain/src/landing.ts` (the
one home for the rule — never a redirect on `/practice/setup`, which would be a
second answer to a question that already has one); the page map entry for
`/practice/today` in `packages/domain/src/page-access.ts`; the page itself at
`apps/web/app/practice/today/`. Named tests:
`practice_staff_land_on_todays_work_not_the_setup_hub`,
`a_practitioner_lands_on_their_own_page`,
`an_operator_acting_as_a_practice_lands_where_practice_staff_land` (in
`landing.test.ts`), `the_setup_hub_still_opens_from_its_own_url` (in
`page-access.test.ts` and `SetupHub.test.tsx`),
`every_daily_destination_is_reachable_from_today_in_one_click` (in
`today.test.tsx`), and
`reception_sees_every_practitioner_queue_and_a_practitioner_sees_only_their_own`
(already held by `practitioner.test.tsx`, unchanged by this).

**Two calls made inside this build, both Carl's to overturn.**

- **The outbound queue (`/practice/queue`) stayed on the setup hub**, although
  PRACTICE-NAVIGATION.md §1 counts it among the five daily destinations. It is
  `platform`-only in the page map — every practice's messages, not this
  practice's — so no practice user has ever seen it there, and moving it to
  `today` would put a cross-practice operator tool on reception's first screen.
  Messages on `today` is `/practice/correspondence`, which is the practice's own
  log. Reopen it by making the outbound queue practice-scoped.
- **`today` carries no link to `setup`.** §3 says setup is "one click away" for a
  manager; today it is one click from the main menu, not from the page. Adding a
  quiet footer link is a one-line change if Carl wants the page itself to carry
  it — it was left off because §2 says five destinations and nothing else, and
  the hub is what accumulated.

**What would reopen it.** A practice manager who never touches the counter
telling us they want to land on setup (§7 asks one real practice this); or a
sixth thing that is genuinely daily, which is a change to §2 and not a card
somebody adds.

## D-2026-09-12-07 — "Completed" records the visit; it raises a post-service agreement only where the invoice has already said what was done

**Status: an ASSUMPTION made mid-build, and Carl's to confirm or overturn**
(wow.md §9). Recorded 12 September 2026 while building
PRACTITIONER-QUEUE-PAGE.md §3a.

**The rule as built.** Setting a visit's state to **Completed** on
`/practice/practitioner/waiting` records the state — who, what, when — and hands
the service-rendered signal to the existing
`ArrivalsService.serviceRendered`. That path raises the post-service agreement
**only where the practice's own software has already told us what was done**: an
undecided `service_records` row for the patient carrying its own MBS item
numbers and its own service date, which is what `PmsSyncService` writes from an
invoice. Where no such row exists — which is the ordinary case at the moment the
doctor presses the button — the state is recorded, the reason
`awaiting_item_numbers` is recorded beside it, and **nothing is drafted**. The
existing invoice and reconciliation paths raise the agreement when the invoice
arrives, exactly as they do today.

**Why it is not wired straight through.** A post-service agreement's particulars
include **D6b — the MBS item number(s)** — and REQ-REG-01 sources them from the
PMS invoice. `lockParticulars` requires them, and hard rule 2 forbids putting a
signature control in front of anybody over an incomplete payload: signing a
draft is the criminal offence in this regime. A practitioner pressing
"Completed" does not know the item numbers, and CLAUDE.md §7 is explicit —
*"Never invent regulatory facts... do not infer it from training data"*. Deriving
D6b from a service description, from the visit policy, or from "what this
practitioner usually bills" would be inventing a statutory particular and
writing it into a contract's record.

**What §3a rule 3 says, and how far this honours it.** *"Completed is the
service-rendered signal. It is what raises the post-service agreement
automatically."* The SIGNAL is wired: Completed calls the one path that owns the
decision, and it reimplements none of it (hard rule 14 — a second copy of the
post-service table's answer is exactly what that rule exists to prevent). What
is missing is not the wiring but the DATA, and it is missing from the page
rather than from the platform.

**Nothing is blocked either way** (hard rule 8, REQ-REC-04). The press never
fails, the state is always recorded, the patient is seen and billable, and a
failure in the post-service path is caught, logged without a patient value, and
recorded as `not_raised` on the state row.

**The three ways Carl could close this.**

1. **Leave it.** The invoice arrives minutes later and the existing path raises
   the agreement then. Reception loses nothing; the doctor's press is
   attendance, which is what §3a's table says it is.
2. **Ask reception for the item numbers** at the desk when a Completed visit has
   no invoice yet. Honest, and it is typing at a busy desk — the same objection
   VISIT-CHECKLIST.md §10 raises about services.
3. **Wait for D-01.** A Medtech write-back/read-back mechanism would let the
   connector answer "what was billed" without anybody typing. Blocked; build
   nothing speculative.

**What would reopen it.** A published source of D6b at the moment of the
consultation (D-01 resolving, or a practice feed that carries the item before
the invoice); or Carl deciding that reception should be asked.

**Where it is enforced.** `raiseTheServiceRendered` in
`apps/core/src/practitioner-queue/practitioner-queue.service.ts`, with the
outcome codes on `SERVICE_RENDERED_OUTCOMES`. Named tests
`completed_raises_the_post_service_agreement` (the invoice-known case, end to
end) and `completed_records_the_state_and_invents_no_item_numbers` (the ordinary
case — the state lands, no agreement is drafted, nothing is invented), both in
`apps/core/test/practitioner-queue.e2e-spec.ts`.

## D-2026-09-12-08 — A practitioner has one login per practice, but stays one person

**Date:** 12 September 2026. **Decided by:** Carl: *"if a practitioner is
working at 3 practices, the practitioner will have 3 logins, one for each
practice. Add to todo to review this design decision later."* And: *"We cannot
use the same email for the passkey. We need email + PracticeId, and for a
practitioner seeing all their practices the passkey is just the practitioner
email."*

**RE-RECORDED.** First written as D-2026-09-12-05 and lost when two agents edited
this file at once; that number now belongs to the console-homes decision.

**The decision.** A practitioner signs in AT a practice and sees only that
practice's queue, holding one login per practice. Their cross-practice view of
themselves is reached with their own email alone.

**The constraint that must not break.** Duplicating the LOGIN must never
duplicate the PERSON: enduring coverage is per practitioner across locations
(hard rule 6), so a second practitioner row for the same doctor would silently
stop their standing agreements covering them at the second clinic. Every
per-practice account carries the same `practitioner_id` claim plus the
`practiceId` that scopes it. Full rules in `PRACTITIONER-IDENTITY.md`.

**What would reopen it.** Several passkeys proving unmanageable, or the review
Carl asked for concluding one login can choose a practice at sign-in.

## D-2026-09-12-09 — Billing identity is practice × location × practitioner; enduring coverage is not

**Date:** 12 September 2026. **Decided by:** Carl, checking an understanding:
*"are we super clear that for billing purposes the biller code with the
government is at the practice + location + practitioner level and not just
practice + practitioner level."*

**Confirmed, and stronger than the question put it.** The location is
load-bearing whichever way a practice satisfies the rule, not only on the
provider-number branch. s 65C element D4 is met by EITHER (a) the provider's
name **plus the address of the place of practice at the time of service**, or
(b) **the provider number for that place of practice** (`aob-requirements.md`
lines 63–64; check C4; a provider number is optional by design, REQ-REG-02).
**There is no route to a conforming agreement that does not name the location.**

**The model already reflects it:** `Affiliation` is unique on
`(practitionerId, locationId)` and carries the `providerNumber`.

**Two grains coexist and both are correct.**

| | Grain | Why |
|---|---|---|
| **Billing identity** | practice × location × practitioner | D4. Two sites, two provider numbers, two correct answers |
| **Enduring coverage** | practitioner, ACROSS locations | Hard rule 6, REQ-END-01a. The standing agreement follows the doctor between sites |

**Confusing them in either direction is a defect.** Collapsing the location
loses conformance; spreading it into coverage silently stops an enduring
agreement covering the visit. The tempting mistake is to "simplify" one into the
other.

**What would reopen it.** A change to the s 65C data set — the regulatory
whipsaw the versioning defence exists for, not a modelling convenience.

## D-2026-09-12-10 — The practice is bound to the login; the location is chosen once per session

**Date:** 12 September 2026. **Decided by:** Carl, answering how a practitioner
who works at several practices should sign in.

**The reasoning, which is his and is the point:** *"If we let the Dr choose which
practice they are working at, it is a way of committing fraud. A Dr could do
tele-appointments for a practice A on practice B time. However, when a Dr logs
in to a Practice, immediately after the login, if the Dr is working at two
locations, then the Dr must pick which location he/she is at. If they choose the
wrong location, they have to log out and log back in — same reason."*

**Why it is right in this regime specifically.** The location is a PARTICULAR of
the agreement: s 65C element D4 is met by the provider's name plus the address of
the place of practice at the time of service, or the provider number for that
place of practice (D-2026-09-12-09). A control that switches location mid-session
rewrites which provider number the next agreement carries. The practice is not a
particular, which is exactly why it must be bound harder — to the login itself,
so "which practice was I working for" is never a per-click choice.

**The decision.**

1. The practice is bound to the login and cannot be switched without signing out.
2. Where a practitioner works at more than one location, they choose which one
   immediately after signing in. Nothing is preselected.
3. The choice stands for the session. Changing it means signing out and back in.
4. Both are recorded as evidence — who, which, when — and inherited by every
   agreement made in that session.
5. Nothing here blocks care (hard rule 8).

**And the practice code is allocated, not derived.** Carl asked how uniqueness
can be guaranteed. Not by truncating a UUID: 8 hex characters is 32 bits, and
across ~10,000 Australian practices the chance that some pair collides is about
1.2% — a birthday problem, not a one-in-four-billion one. The code is instead
allocated at practice registration from a readable slug, stored, enforced unique
by the database, extended deterministically on collision, and never reused.

**The username is the person's FULL email, then the code** — Carl, revising his
own first suggestion: `jsmith@outlook.com.xlevelup`, not `jsmith.xlevelup`. The
full email is already unique to the person and the code to the practice, so the
username is unique BY CONSTRUCTION and no second collision rule is needed.

**One consequence, measured on the running realm.** Three accounts for one
doctor all carry the same email — their own — and the realm today has
`loginWithEmailAllowed: true` with `duplicateEmailsAllowed: false`, which
refuses the second. The two are mutually exclusive. So the realm must allow
duplicate emails and stop offering email as a way to sign in. That is a
correction rather than a concession: hard rule 15 is passkeys with no
password-only path, nobody types an identifier at all, and email-as-login serves
a flow this product does not have. The change belongs in the committed realm
export and in the realm guard, or a rebuilt container restores it.

Full design: `PRACTICE-SCOPED-LOGIN.md`.

**What would reopen it.** Evidence that asking for a location every session is
answered carelessly — in which case the answer is a better moment to ask, never
a remembered default.

## D-2026-09-12-11 — Authentication is tiered; hard rule 15 narrows to platform operators and patients

**Date:** 12 September 2026. **Decided by:** Carl. **This changes CLAUDE.md hard
rule 15**, which reads "Practitioner and admin auth is WebAuthn passkeys — no
password-only paths (REQ-VAULT-04)". It is recorded here rather than absorbed.

**Why the rule could not hold.** Carl: *"We cannot have the passkey solution. The
login has to be independent of the device being used."* A doctor works from
whatever computer is in whatever room they are in, in a practice or a hospital.
Those machines are shared, often locked down, frequently without Bluetooth and
often without a usable USB port. Every route to a passkey needs the credential on
that machine (wrong — it stays for the next person), the phone in Bluetooth range
(no adapter), a security key (no port), or the doctor signing the browser into
their own account (wrong on a shared machine). There is no fourth option;
`PRACTITIONER-PASSKEY-DEVICE.md` works through each.

**The decision — three tiers** (`AUTH-TIERS.md`):

1. **Tenant single sign-on** for practices and hospitals with a Microsoft or
   Google tenant. The target for large practices, not a fallback: more
   device-independent than anything we could build, and their conditional access
   does the work. We require a minimum asserted authentication strength and
   refuse the sign-in otherwise.
2. **Platform accounts** — username, password and a one-time code — for
   practices with no tenant.
3. **Passkeys** remain available to anyone who can use them, and remain the
   strongest option. Never removed.

**What hard rule 15 still governs, unchanged:** platform operators (our own
people, on their own machines, with no shared-terminal problem) and patients
(whose portal passkeys live in core, not Keycloak — D-2026-09-04-02).

**What makes the weaker tier defensible.** The practitioner signs nothing: hard
rule 3 abolished the practitioner signature field on 1 July 2026, so an
agreement's evidential weight rests on the PATIENT's signature captured at a
paired tablet. Practitioner authentication governs who may operate the desk and
read records — important, and a different bar from the one the statute leans on.

**What tier 2 must carry to earn it:** the authentication method recorded on
every session so an audit can tell them apart; a fresh second factor before
high-stakes acts; recovery by administrator re-invitation; and a password policy,
with passwords never logged.

**Costs nothing and needs nobody's permission.** One-time codes are an open
standard. There is no registration with Google or Microsoft, no API key, no fee:
we generate the secret, the app reads a QR, we check the codes. A domain IS
needed for the product's own address, for email deliverability and for tier 1 —
but not for the codes.

**What would reopen it.** Clinical terminals that reliably carry Bluetooth or
accept a security key, which would make tier 3 practical as the default again.
Or a finding that REQ-VAULT-04 rests on something stronger than the
now-abolished practitioner signature — worth checking before tier 2 ships.

## D-2026-09-12-12 — A practice may run without practitioner accounts; reception does it instead

**Date:** 12 September 2026. **Decided by:** Carl: *"Some practices may not want
their doctors to use the AoBPlatform. In this case the frontdesk will do what the
doctor does. However, I believe a better system is if the doctor does it."*

**The decision.** Practitioner accounts are OPTIONAL per practice. Where a
practice does not give its doctors access, reception performs every act a
practitioner would, and nothing about the platform stops working.

**It already works, and that is not an accident.** `maySetVisitState` returns
true for the `practice` scope on any patient, and only narrows for a
practitioner, who may act on their own patients alone. The practitioner queue has
two modes for the same reason: a practitioner sees their own list, practice staff
see every list grouped. So a practice with no practitioner accounts uses the same
pages with one of the two audiences absent.

**What is lost when the doctor does not do it, and why Carl's preference is the
right one.**

1. **The moment is guessed.** "Completed" is the service-rendered signal that
   raises the post-service agreement. A doctor presses it when the consultation
   ends; reception presses it when they notice, or when told. The paperwork
   follows the room less closely.
2. **The assertion moves.** Marking a consultation complete is a statement that
   an encounter happened. When reception marks it, the record says reception
   asserted it — which is honest and recorded, but it is second-hand. **This is
   operational rather than evidential**: hard rule 3 abolished the practitioner
   signature, so an agreement's weight rests on the PATIENT's signature at a
   paired tablet, and none of it moves with this.
3. **The covering-doctor check loses its best trigger.** An enduring agreement is
   per practitioner, so a patient seen by somebody other than the one their
   agreement names needs new paperwork. The doctor knows immediately who they
   saw; reception may not.

**So the platform must make it easy to prefer the better arrangement**, while
never requiring it. The practice setting exists so the console stops offering
what a practice does not use, not so the platform behaves differently.

**What this needs, and does not yet have:** a practice setting recording whether
practitioners have accounts; onboarding not inviting doctors where they do not;
and the front desk not implying somebody else will do a thing nobody will do.

**What would reopen it.** Evidence that reception-marked visits produce
materially later or less accurate post-service agreements — which would argue
for pushing practices harder towards practitioner accounts, not for removing the
option.


## D-2026-09-12-13 - A manual practice must be able to type what was billed; the post-service screen is release-blocking

**Date:** 12 September 2026. **Decided by:** Carl, answering `INTEGRATION-MODES.md`
section 7 Q1: *"Is a fully manual practice expected to raise post-service
agreements at go-live? If yes - we need a screen to manually type these
details."* Yes.

**The decision.** A practice with no interface of any kind MUST be able to raise
a post-service agreement, and that means a screen where a person types the
service date (D5) and the MBS item numbers (D6b). It is release-blocking, not a
gap in a table.

**What is actually missing.** The door exists - `POST /arrivals/service-rendered`
takes exactly those two things - and nothing calls it from a screen. The
practitioner queue's "Completed" control does call it and then gives up with
`awaiting_item_numbers` unless a service record already exists, and service
records arrive only from invoice sync. So today the whole post-service branch of
s 65C(4) table item 6 is closed to any practice without a feed. That is the most
serious finding in `INTEGRATION-MODES.md` and this decision is the answer to it.

**Why it is release-blocking rather than deferrable.** Mode 1 is the only mode
that is not waiting on somebody outside this project (D-01). If mode 1 cannot
produce a post-service agreement, then the one integration posture we can ship
without help covers half the statute. A practice in that position would have to
either bill outside the platform or not bill - and hard rule 8 says the platform
never blocks care or billing.

**What it must not become.** A screen for typing item numbers is not a claiming
screen and must never grow into one: no benefit, no fee, no dollar amount
anywhere on it or on anything it produces (hard rule 4). It records WHAT WAS
DONE so the agreement can name it, and nothing about what it is worth.

**What would reopen it.** A first customer who is genuinely mode 2 or mode 3 at
the back end from day one, AND a decision that no mode-1 practice is sold to
before the connector lands. Both, not either.

## D-2026-09-12-14 - A practice records its posture per integration point, and the mode is derived from it

**Date:** 12 September 2026. **Decided by:** Carl, answering `INTEGRATION-MODES.md`
section 7 Q2: *"agree - lets add a column to the practice table or a table
linked to the Practice table called `practice_posture` and lets record the mode
the practice is working in and what postures / integrations are automated and
what is manual."*

**The decision.** A linked table, not a column. Each row is one integration
POINT and how that practice runs it.

The points, because they move independently: **appointments** (the day's
bookings), **arrivals**, **service rendered** (what was billed), **write-back**,
and **patient demographics**. The posture of each is `manual`, `automated` or
`not_used`.

**Why a table rather than a column, and why per point.** A practice is almost
never in one mode. The ordinary case is automated at the front and manual at the
back - which is exactly gap A - and a single `mode` column would have to round
that to a lie. The points also change at different times: a practice goes live
manual and turns on the invoice feed months later, and nothing else moves.

**The mode is DERIVED, never stored.** "Mode 1", "mode 2" and "mode 3" are a
reading of the postures, computed in one place in the domain. Storing both would
let them disagree, and the day they disagreed nobody would know which one the
platform had believed.

**It is dated, because the postures are evidence.** An agreement made in March
was made under March's posture, and an audit asking "was this typed or did it
arrive from the practice's software" must get March's answer, not today's. So
rows carry effective dates and are never edited in place.

**The first thing it fixes is gap B.** Write-back needs a linkage key that only
sync sets, so a hand-keyed patient can never be written back to and shows as
stale after four hours, forever. With a posture of `not_used` on write-back that
warning does not fire, because there is nothing to write back into and nothing
is wrong. Today the platform cannot tell that practice apart from one whose
connector has died - which is the actual defect.

**What would reopen it.** Evidence that practices really do sit in exactly one
mode across all five points, which would make the table a column after all.

## D-2026-09-12-15 - A resend of corrected details supersedes; it never edits, and never silently vanishes

**Date:** 12 September 2026. **Raised by:** Carl: *"we have to consider how to
handle exceptions: If the PMS sends incorrect details, they must be able to
resend and AoB should be able to handle it."*

**The decision.** A resend is handled by the stage the agreement has reached, and
the three answers are the platform's existing rules rather than new ones:

| When the correction arrives | What happens |
|---|---|
| Before the particulars are locked | The draft is updated. Nothing else is needed |
| Locked, not yet signed | It SUPERSEDES - a new agreement, `supersedesAgreementId` naming the old one, exactly as a reception correction already does (HARD-02: a locked agreement is corrected by superseding, never by editing) |
| Signed | The signature stands and the record is immutable (hard rule 11). A correction raises a NEW agreement; the signed one remains as evidence of what was actually agreed, because that is what it is |

**The one new thing needed, and it is the dangerous part.** The arrival contract
carries an `idempotencyKey` so a RETRY is safe. A resend of CORRECTED details is
not a retry, and if a connector sends it under the same key the platform will
recognise a duplicate and do nothing - **the correction disappears silently and
both sides believe it landed.** That is the worst available outcome and it is
reachable today.

So the contract must let the two be told apart: a corrected message carries a NEW
idempotency key and names what it corrects. The same key means "you may not have
heard me". A new key naming a prior arrival means "what I told you was wrong".
Anything else is refused with a reason that says which of the two the sender
meant.

**Every resend is a vault event**, carrying ids, the stage it arrived at and what
it did - never the corrected values (hard rule 9). An audit must be able to see
that the practice's software changed its mind, and when.

**It never blocks care** (hard rule 8). A resend that cannot be applied - a
signed agreement, an unparseable message - becomes a task at the desk with the
patient named and the reason given, and the patient is seen and billed
regardless.

**What would reopen it.** A regulator's position that a superseded pre-signature
agreement must be destroyed rather than retained, which would change what the
chain keeps rather than how a correction is applied.



## D-2026-09-12-16 - A tablet says which front door it offers, and a reception-driven one never says "Begin"

**Date:** 12 September 2026. **Decided by:** Carl, looking at `/kiosk`: *"if the
reception is pushing to the tablet (not kiosk mode where the patient enters all
their details) then it should not say Begin (it will confuse the user/patient)
as the user will press begin and it will go to kiosk mode. It should say
'Please wait. Loading your details'."*

**The decision.** A tablet carries `acceptsWalkUps`, set from the console and
nowhere else. With it off, K-1 drops the heading and the button entirely and
says **"Please wait. Loading your details"** - no control of any kind, so there
is nothing to press that could start the wrong flow.

**Default ON, so no tablet in service changes behaviour.** The walk-up path is
a deliberate feature (K-2, the claim-by-three-identifiers front door) and this
does not retire it. It says WHICH tablets offer it.

**Why the setting is per DEVICE and not per practice.** The same practice runs
both: a tablet on the counter anybody may pick up, and a tablet reception hands
to a named person whose agreement has already been sent to it. The confusion
Carl saw is specific to the second, and a practice-wide switch would force a
practice to give up one to fix the other.

**Why not solve it with copy alone.** The harm is not the wording, it is the
button: a patient who presses Begin on a tablet meant for them is asked to type
details the platform already holds, which is both confusing and a second place
those details could be got wrong. Removing the control removes the harm; the
sentence only explains the wait.

**The transient window is NOT solved, and that is recorded rather than
papered over.** On a walk-up tablet there is still a gap between reception
pressing Send and that tablet's next poll, during which it truthfully offers
Begin because it has no information yet. Every poll on the kiosk runs at the
same cadence, so no existing signal arrives earlier, and inventing a "a session
is coming for you" signal would not land any sooner. On the tablets Carl was
describing the problem is gone completely, because they never show Begin at
all.

**Still recoverable, always** (hard rule 8). Return to Begin works on a
walk-ups-off tablet and lands it back on the waiting message rather than on a
button, so a tablet stuck waiting is cleared by reception exactly as any other
is. Named test: `walk_ups_off_tablet_is_still_recoverable_by_reception`.

**Evidenced** as `device.walk_up_capture_set`, carrying the device label, the
flag and who set it - no patient data (hard rule 9).

**What would reopen it.** A tablet that genuinely needs both at once: a pushed
queue AND a walk-up door on the same screen. That is a different screen, not a
different default.



## D-2026-09-12-17 - Every location carries its own timezone, and so does head office

**Date:** 12 September 2026. **Decided by:** Carl: *"We have to adjust times to
local when showing it on the screen. Hence, we need to know which timezone each
location of the practice is in and the timezone of the headoffice."*

**The decision.** An IANA timezone is stored on **every practice location** and
on the **practice** (its head office). It replaces `REPORT_TIMEZONE`, a single
hardcoded `'Australia/Sydney'` that is currently the only answer the platform
has for anybody.

**Which one applies.** The LOCATION's, always, for anything that happened at a
location - an arrival, a service, a signature. That is where the clock on the
wall was. The practice's head-office zone is the fallback for practice-wide
views that belong to no single site, and for a practice that has not yet
recorded a location zone.

**A list that spans zones must SAY so.** A practice with a Perth site and a
Sydney site showing a column of bare times is not merely unhelpful, it is
wrong: two rows reading "09:30" happened three hours apart. Where a list mixes
zones the rows carry theirs; where it does not, the page states the one zone
once.

**It is NOT derivable from the state, and that trap is the reason this is
stored rather than computed.** Broken Hill is in New South Wales and keeps
Adelaide time. Eucla is in Western Australia and keeps +8:45. Brisbane and
Sydney share an offset for half the year and differ by an hour for the other
half, because Queensland does not observe daylight saving. So the state
PROPOSES a zone at onboarding and a person confirms it; what is stored is what
they confirmed.

**Store the zone NAME, never an offset.** `Australia/Adelaide`, not `+09:30`. An
offset is right until daylight saving moves, and an agreement rendered last
March must still say what it said last March.

**What it governs, in order of how much it matters:**

1. **Which DAY a record belongs to.** The day register, the waiting list, the
   front desk and "today" everywhere else. This is where the four disagreeing
   definitions of today already live (`TODO.md`, 12 Sep).
2. **The agreement date (D2) and the service date (D5) - and this one is not
   cosmetic.** They are statutory particulars on a signed instrument. A date
   computed in UTC is simply the wrong date for the first ten hours of an
   eastern-Australian morning, and for the first eight of a Perth one. An
   agreement stating the wrong day is a defective agreement.
3. **Every time shown on a screen**, which is where Carl came in.

**What must NOT change.** Timestamps are stored as instants and stay that way;
the zone is applied when a record is READ, displayed or bucketed into a day.
Storing local times would make the same record mean different things depending
on who wrote it.

**This supersedes the open question** raised while building `/practice/day`
("timezone is platform-wide, not per practice - fine for the first customer,
wrong for Perth or Brisbane"). It was right, and this is the answer.

**What would reopen it.** A practice that operates one site across two zones,
which no Australian practice does, or a regulator specifying the zone a
particular date must be stated in.



## D-2026-09-12-18 - The queue number has three sources in precedence, and AoBPlatform may allocate the last of them

**Date:** 12 September 2026. **Decided by:** Carl, on `/practice/frontdesk`:
*"Show the practice-queueid - the card with the number or from the PMS or the
Q-id AoB allocated."*

**What changes.** `QUEUE-TICKETS.md` section 3 said the number is *"never
generated by us: the practice's card box is the source of truth, and a number
we invented would be a second, competing queue."* That is now narrowed rather
than kept, and the reasoning survives intact.

**Three sources, in this order:**

1. **The practice's own card**, where they hand out cards. Typed at the desk.
2. **A number from the practice's software**, where a feed carries one.
3. **One AoBPlatform allocates**, where there is neither.

**Why this does not contradict the original worry.** The danger was a SECOND
queue competing with the practice's own. Where a practice has no cards and no
feed there is no other queue, so ours is not a competitor - it is the only
handle the patient has. Where they DO have one, precedence means we never
invent a rival to it. The rule was right; it was just written as "never" when
it meant "never instead of theirs".

**Record which source it came from.** "A12, off their card box" and "we made
this up" are different facts, and an audit or a support call needs to tell them
apart. So the source travels with the number.

**Everything else in `QUEUE-TICKETS.md` stands unchanged**, and the important
ones bear repeating because an allocated number makes it tempting to treat them
as ours to bend:

- It lives on the **arrival**, never the agreement. It is not a particular, it
  is never rendered, and it must never be caught up in supersession - replacing
  who signs does not hand the patient a new card.
- **Optional always**, and no flow refuses for want of one (hard rule 8).
- **A duplicate warns and never blocks.** A card box wraps around.
- **Practice-scoped and day-scoped.** A number means nothing outside either.
- **The event records that it was set, not what it was**, and it never appears
  in a log, an error or a URL.
- **It is the patient's handle, not the running order** (section 5a). Number 14
  called before number 9 is an ordinary morning, and nothing on screen may
  suggest otherwise.

**What would reopen it.** A practice running our allocated numbers alongside a
card box they forgot to tell us about, which would be the competing queue the
original rule feared - the fix there is precedence being applied, not the
allocation being withdrawn.



## D-2026-09-12-19 - An outage never empties the screen

**Date:** 12 September 2026. **Decided by:** Carl, looking at the front desk
with the service unreachable: *"we need better messaging when the app is
down."*

**What he was looking at.** A page title, two banners, and nothing else. The
list of who was in the waiting room had been replaced by an apology.

**The decision.** A staff screen that cannot reach the service **keeps its last
good data**, marked with the time it was true, and refuses only the things that
actually cannot be done.

**This is hard rule 8 in the interface**, and that is why it is a decision
rather than a styling preference. The platform never blocks care: a patient is
seen and billed whatever the screen says. A page that erases the waiting room
does worse than fail to help - it takes away information the practice already
had, at the exact moment the practice cannot get it back another way.

**Five requirements**, set out in full in `OUTAGE-MESSAGING.md`:

1. **The list stays**, with "Showing the list from 9:42. Not live." The
   staleness is a TIME, never a word: "out of date" cannot be acted on, and a
   time lets a receptionist judge for themselves whether it still describes the
   room.
2. **Reading and writing are separated.** Looking at a stale list is safe and
   stays live. Sending to a tablet is not, and is refused ON THE CONTROL with
   its reason - not by a banner at the top of the page that the eye has already
   skipped.
3. **The page retries itself and says so.** "Please try again in a moment" is
   an instruction to do what the page should be doing, and it names no control.
   **A write is never retried automatically**: a send that may or may not have
   landed is a person's decision.
4. **One message, not two.** The reassurance folds into the outage line.
5. **Typed input survives.** Losing a half-finished "who is signing" is a second
   failure caused by the first, and it is the one that makes people stop
   trusting the screen.

**It belongs in one shared component.** Twenty-eight surfaces carry their own
`notLoaded` wording today. The words stay per-page; the behaviour must not, or
a page opts out by accident and a fix reaches only one of them.

**How stale is too stale: ONE HOUR** (Carl, same day, answering the question
this entry left open).

What expires is the CLAIM, not the list. Under an hour the screen says
*"Showing the list from 9:42. Not live."* Over an hour it says *"This is the
last list we had, from 9:42. It is more than an hour old and is no longer the
waiting room"*, the rows go visibly quiet so nothing looks like a next action,
and the screen names the platform's documented outage posture: keep seeing
patients, the paperwork is caught up after the service (CLAUDE.md 7).

**The rows never disappear**, because an hour into an outage a blank page is
worse rather than better, and that list is the best record anybody has of who
was in the room - it is what reception reconciles against afterwards. It simply
stops looking like a work queue, because acting on an hour-old queue is how the
wrong person gets called.

**One hour is a SETTING, not a constant** (Carl, confirming: *"keep the hour a
configurable settign"*). `staleListMinutes` on the practice, default 60, beside
`linkExpiryHours` (48) and `kioskIdleTimeoutSeconds` (300), which already have
exactly this shape. Minutes, because hours cannot express twenty. A threshold
compiled into a component is what hard rule 14 exists to prevent, and practices
will disagree: a single-site clinic where reception can see the whole room may
want twenty minutes, a large practice where the list IS the room may want
longer.

It has no screen, and nor do its two siblings - `PATCH /practices/:id/config`
is endpoint-only, already recorded as a gap in `INTEGRATION-MODES.md`.

**What would reopen it.** Evidence that a stale list gets somebody called who
should not have been, which would argue for a shorter hour rather than for
going back to an empty page.



## D-2026-09-12-20 - "Finished" means the visit is over, not that the paperwork is done

**Date:** 12 September 2026. **Decided by:** Carl, with the front desk and the
practitioner queue side by side: *"on /frontdesk the patient goes to 'Finished
list' yet on /waiting the dr has not seen the patient as yet. Hence, we need a
step 'Consultation completed'."*

**He is right and the word was doing the lying.** The front desk moves a patient
to Finished when the agreement is signed. Signing happens in the waiting room,
BEFORE the consultation. So the desk was announcing that a patient was finished
while the practitioner had not yet called them in.

**The decision, in two parts:**

1. **The visit checklist gains a step: the consultation itself.** It sits after
   "signed on a tablet" and before anything about billing afterwards.
2. **A patient reaches "Finished" only when the paperwork is done AND the visit
   is complete.** Either one alone leaves them on the desk.

**AMENDED THE SAME DAY, and generalised.** Carl: *"What you call 'Paper work'
per patient, I call the patient service list... Only when all services are
completed or some are cancelled does the client go to Finished."* The rule is
therefore: **a patient is Finished when every service on their list is
resolved - each one completed, or cancelled.** Part 2 above is what that
reduces to while the only services on the list are the computed paperwork rows
and the consultation, so nothing built today changes - but the code is written
as the general rule, so adding a practice's own item changes what Finished means
without changing a line. See `VISIT-CHECKLIST.md` section 3a, which also splits
`cancelled` (was on the list, dropped) from `not_needed` (never required).

**Nothing new has to be invented for it.** The visit state already exists and is
already set by the person who knows - `pending`, `with_patient_now`,
`completed`, `reassign`, set from `/practice/practitioner/waiting`, and
`completed` is already the service-rendered signal (D-2026-09-12-07). What was
missing is that the front desk could not see it. The step READS that state; it
does not mint a second one, and there must never be two places that disagree
about whether a patient has been seen.

**It gates nothing** (hard rule 8). A patient can be seen, billed and sent home
whatever this checklist says, and the step is a report rather than a
precondition.

### One visit or two? The test is whether it needs its own agreement

Carl's note raises two more cases, and they resolve in opposite directions:

> *"if the patient has to see a nurse or do bloods then these will also be
> steps here before the patient goes to the Finished List. Also, if the patient
> has to see another doctor in the practice and that doctor is a specialist
> then the patient will need to added to the Queue again and assigned to the
> specialist with the episodic agreement process."*

**The rule that separates them: does this encounter need its own agreement?**

| | Needs its own agreement? | So it is |
|---|---|---|
| Seeing a nurse, giving bloods, a dressing | No - the claim still goes under the servicing provider already named on the agreement | **A STEP** inside this visit |
| Seeing a second practitioner who bills under their own number, e.g. a specialist | Yes | **A SECOND VISIT** - back on the queue, assigned to them, its own episodic agreement |

**Why that is the right line and not an arbitrary one.** Billing identity is
practice x location x practitioner (D-2026-09-12-09). An encounter that does not
change whose provider number the claim goes under has not changed the contract,
so it cannot need a second one. An encounter that does change it needs its own,
because the agreement names the provider.

**Episodic for the specialist, never enduring, permanently** (hard rule 6,
REQ-END-01a). Ongoing agreements are per practitioner x patient and GP-only.
Carl's note says episodic and that is not a preference, it is the rule.

**The step LIST is versioned content, not code.** Nurse, bloods and whatever a
practice adds next are options a practice picks from, so they live in a
versioned content file under `packages/domain/content/` with their words in the
string table, on the standing rule for every option list (CLAUDE.md 7, first
instance `assignor-relationships.json`). Hardcoding "bloods" into a component is
how the next practice's list becomes a code change.

**Built now:** the consultation step, and Finished requiring both. **Not built:**
the configurable ancillary steps and the second-visit flow, which are recorded
here so they are not re-decided.

**What would reopen it.** A practice where reception genuinely wants the desk to
clear on signature alone - which would be a per-practice setting rather than a
return to the current behaviour, because the current behaviour states something
untrue.



## D-2026-09-12-21 - Every practitioner has their own queue, and sending a patient on is one click

**Date:** 12 September 2026. **Decided by:** Carl: *"For a patient to see the
specialist after the GP, it should be a one-click process to assign the patient
to the specialist and add the patient to the specialist queue. I just realised
that every doctor/practioner in the practice will have their own queue. So we
need to have the /waiting page show the patients in the queue order and on the
/frontdesk the name of the doctor and the position in the Dr's queue."*

**Three things, and only one of them is new.**

### 1. Per-practitioner queues already exist

`/practice/practitioner/waiting` already groups today's arrivals by the
affiliation the patient came to see, and orders each group by arrival. That IS
a queue per practitioner. What was missing is that it was never called one and
the position was never shown.

### 2. The position is shown, and it is DERIVED - never stored

A patient's place in a practitioner's queue is their index in that
practitioner's group. It changes every time somebody ahead of them is called,
so it is computed on read and written nowhere.

**The dangerous part is that this is a SECOND number on the same row**, and
`QUEUE-TICKETS.md` section 5a already warned about exactly this: *"the ticket is
not the running order."* The two must never be confused:

| | What it is | Does it change? |
|---|---|---|
| **The queue ticket** (D-2026-09-12-18) | The patient's own handle - the card in their hand, or one we allocated | **Never.** They are holding it |
| **The position** | Where they are in one practitioner's queue right now | **Constantly.** Somebody ahead gets called and it drops |

**So the position is never rendered as a bare number.** It is said WITH the
practitioner - *"3rd for Dr Savva"* - which is what Carl asked for anyway when
he asked for the doctor's name beside it. A lone "3" next to a lone "12" on one
row is how a receptionist calls the wrong person.

### 3. The new thing: one click to send a patient on

**CORRECTED BY CARL, same day, and the correction matters more than the
mistake.** I had reached for the existing `reassign` state. Carl: *"the Reassign
in Dr Queue means the Dr cannot see the patient. Lets call the other scenario
'See Second Dr' or something - to see the specialist. So the patient had two
appointments on the same day."*

**They are opposite events and must never share a state:**

| | `reassign` | The new one - **see another practitioner** |
|---|---|---|
| What happened | The practitioner **cannot** see this patient. Called away, running late, wrong list | The practitioner **has** seen this patient, and now they need somebody else too |
| Is it a fault? | Yes. Something has gone wrong with the day | No. This is an ordinary two-appointment day |
| Did the first encounter happen? | **No** | **Yes** |
| What the first visit does | Does not complete. It is moved or it is cancelled | **Completes normally.** The patient really was seen |
| What is owed | Nothing new. The same encounter, somebody else | **A second agreement**, for a second encounter under a second provider number |

Collapsing the two would put "the doctor was unavailable" and "the patient needs
a specialist as well" through one code path, and the evidence would then be
unable to say which had happened - on a record whose entire purpose is saying
what happened.

**So a new option, key `see_another_practitioner`.** It is a visit-state option
like the others, versioned content with its display words in the string table
(the practice may well call it "See second doctor"; the key stays in the
domain's own vocabulary, because "Dr" is not a word this codebase uses -
provider and practitioner are, CLAUDE.md 3).

**What exists and what does not.** `reassign` exists and already raises a
front-desk task, which is the right mechanism and the wrong meaning. The new
option, and the ACTION on the task either of them raises, are both unbuilt.

**What the one click does:** creates a SECOND VISIT for the same patient today,
naming the specialist's affiliation, and puts them in that practitioner's queue.

**Two appointments on one day is the ordinary shape of this**, not an edge case,
and it is worth saying plainly because it is the thing the model now expresses
that a one-visit-per-day model could not.

**A second visit, not a move**, and this follows from D-2026-09-12-20 rather
than being a fresh choice: a second practitioner billing under their own number
needs its own agreement, and an encounter needing its own agreement is a second
visit. The first visit stays, keeps its own service list, and reaches Finished
on its own terms - the patient really was seen by the GP, and that record must
not be rewritten because they then saw somebody else.

**Episodic, never enduring** (hard rule 6, REQ-END-01a). Ongoing agreements are
per practitioner x patient and general-practice only. A specialist gets an
episodic agreement or a Treatment Plan Assignment, permanently, and the one-click
must not be able to produce anything else.

**It goes through the front door everything else goes through.** The click posts
the arrival contract with `source: 'reception'`, exactly as the new-agreement
panel does, so the versioned visit policy decides what the second visit needs -
reception never chooses the agreement type (hard rules 6 and 14).

**One click means one click.** The patient's details are already held; the
practitioner is named on the task. Nothing is re-keyed, and the only thing
reception may have to answer is who is signing, which is the one question a
machine cannot answer for them.

**It gates nothing** (hard rule 8) and it is reversible - a second visit created
in error is cancelled like any other, and cancelling it leaves the first visit
untouched.

**What would reopen it.** A practice where the specialist keeps their own
separate waiting room and does not want our queue at all, which is a display
question rather than a model one.


## D-2026-09-12-22 - A practitioner's list can be moved to somebody else at the desk, and a signed agreement is superseded rather than refused

**Date:** 12 September 2026. **Decided by:** Carl: *"the assigned practioner has
called in sick or all patients have to be notified and reassigned to new
practitioner. For now just built a feature to select the patients and then
select a practioner to move them to."* And, on the case the first brief said to
refuse: *"In this case the patient will have to resign a new agreement when they
come in."*

**Supersedes nothing; it answers TODO.md "Moving a practitioner's whole list"
item 2, which is struck through there and points here.**

### What was decided

**1. The move is mechanical, and the asking is not part of it.** Reception
selects patients on `/practice/practitioner/waiting`, chooses a practitioner,
and presses once. `D-2026-09-12-03` still stands in full: a substitution is TWO
questions asked in order, and this action asks neither. No message is sent, no
remote signature is offered, and there is no field on the endpoint for either -
because building the asking inside a bulk action is precisely how the two
questions get bundled into one. TODO.md item 1 keeps the debt visible.

**2. The agreement is SUPERSEDED, never edited** (HARD-02, hard rule 2). D4 is
the provider's name and the address of their place of practice (s 65C(5)(a)), so
an agreement made for Dr A does not describe a service by Dr B. The successor
names the new practitioner; the parent keeps its own particulars, hash and
status.

**3. And that is true whether or not it was signed** - which is the part Carl
settled and the first brief had wrong. It was going to REFUSE a signed row on
hard-rule-11 grounds. That reading was backwards: supersession never writes to
the parent, which is exactly what makes it the right tool. The signed agreement
stays byte-identical with its signature event intact, a true record of what was
agreed before the day overtook it. Nothing is voided, cancelled or annotated,
and nothing is billed under it because the practitioner it names never rendered
the service.

| Parent agreement | What the move does | What the patient owes |
|---|---|---|
| Unsigned | Supersede with one naming the new practitioner | Sign, as they always would |
| **Signed** | **Supersede with one naming the new practitioner** | **Sign again, at the desk, when they come in** |

**When they come in - not before.** They are already on their way to the
practice, so the second signature is a desk act and never a message.

**4. What the visit needs is RE-ASKED, never carried over** (hard rules 6 and
14). An ongoing agreement is per practitioner x patient and GP-only, so it does
not travel: a patient moved from a general practitioner to a specialist needs
something different from what they had, and a patient moved TO somebody who
already holds one with them needs nothing at all. The same versioned
`decideVisitAgreement` the arrival ran answers it, and reception never chooses
the type. Where the answer is `none`, the arrival stops pointing at the
agreement drafted for the practitioner they left - the row is untouched, but
`arrivals_none_drafts_nothing` is right that a visit deciding `none` while
naming an agreement it drafted is two stories.

**5. A target who cannot take the list is refused, per row, with a CODE.** They
must pass `mayBeProviderOnAgreement` - a nurse cannot take a general
practitioner's list (REQ-REG-02) - and they must hold a live affiliation AT THE
LOCATION the patient came to, because D4 is the person AND the place and billing
identity is practice x location x practitioner (D-2026-09-12-09).

**6. Partial failure is never silent.** Twelve moved and three refused applies
the twelve and reports all three, each with a reason code the console maps to
words and, where the fix is on another page, a link to it (CLAUDE.md 7). An
unmapped code shows its code.

**7. It never blocks care** (hard rule 8) and the page says so.

### Two things decided in the build that Carl has not confirmed

Written as assumptions, in the open (wow.md 9), and to be rewritten as decisions
or reversed when he answers.

**(a) The control is RECEPTION'S ONLY.** It renders solely in the practice-wide
mode of the waiting page - the mode the SERVER chooses from the token - and the
endpoint is practice-scoped, so a practitioner's own token cannot reach it.
Reasoning: PRACTITIONER-QUEUE-PAGE.md 3 says a practitioner's list carries no
control that acts on an agreement, and this one supersedes; 3a rule 4 already
puts "who sees them instead" at the front desk. If Carl wants a practitioner to
be able to hand their own list over, it is a scope change on both surfaces.

**(b) A move moves BOTH facts.** The arrival's `seeingAffiliationId` (who the
patient came to see) and `affiliationId` (whose number the claim goes under)
both become the new practitioner. Reasoning: the desk is saying "this person
will see them now", and the target has already been checked as somebody the
claim can go under. The alternative - moving only the billing anchor and leaving
a nurse as the person seen - is a different act, and nothing on the screen asks
for it.

### What would reopen it

- A practice that wants the patient asked BEFORE the desk move takes effect,
  rather than after; that is TODO.md item 1 landing rather than this changing.
- A signed parent whose successor must carry something forward from the
  signature (it carries none today, deliberately - the second signature is a
  fresh act).
- Undo, which the domain can only express as a second move plus a second
  supersession (TODO.md item 6).



## D-2026-09-14-01 - The benefit amount is shown on the tablet screen and never on the Signed Assignment Agreement — REVERSED the same day by D-2026-09-14-02

**Reversed within the hour, and left here rather than deleted**, because the
reasoning is still right about the rule and wrong about the practice. It was
made on my reading of what the practice wanted (the patient to be *informed*).
The practice then said what it actually wants: the exact DB4, with the cost and
the signature on it, one form in the folder. See D-2026-09-14-02.


**Date:** 14 September 2026. **Decided by:** Carl, ruling on `DB4-AND-AOBL.md`
section 2a: *"Show the amount on the tablet screen only, not on the artefact."* (Carl's word; the proper name is the Signed Assignment Agreement, and it is used below)
Asked because the test practice says the patient must be informed of the cost,
and hard rule 4 / REQ-REG-04 says no benefit or dollar amount on any agreement
document - *"do not add"*.

**The decision.** The benefit amount the PMS reports for each service is shown
to the patient **on the tablet, before the ceremony, as information**. It does
not appear on the Assignment Agreement, is not in the locked particulars, is not
hashed, and is not in the document written back to the practice's system.

**What the Signed Assignment Agreement is, so the line is unambiguous.** It is
the agreement document itself: rendered server-side to PDF/A by the one deterministic
render path, hashed at render, signed by the patient, stored in the vault, and
re-verified against its hash whenever it is shown or copied (hard rule 13,
REQ-VAULT-02). **The file written back into the practice's patient folder is
that document, byte for byte.** Screen and Signed Assignment Agreement are therefore
different things: the screen is what the patient looked at; the Signed Assignment Agreement is what they
signed and what the practice keeps.

**Why this satisfies both parties.** The practice's concern is that the patient
knows the cost. The regulation's concern is that the Signed Assignment Agreement carries no
benefit figure. Showing it on screen and leaving it off the instrument does
both. The PMS's own DB4, which does carry the amounts, stays in the record as
supporting evidence beside ours, so the figure is not lost to the practice.

**The consequence to know about.** Because the signed document does not carry
the amount, it also does not prove the patient was told it. If that ever
matters, the kiosk records **that the cost screen was shown** as a vault event
carrying ids and the fact - never the figure (hard rule 4, and the same
discipline as hard rule 9). Not built; recorded so the gap is deliberate.

**What would reopen it.** The requirements being re-read to say a benefit figure
belongs on the instrument, or a regulator saying so. Nothing the practice says
about its own preference reopens a hard rule.



## D-2026-09-14-02 - The Signed-DB4: the practice's exact form, reproduced by us, with the cost and the signature on it

**Date:** 14 September 2026. **Decided by:** Carl, relaying the test practice:
*"The Practice wants to see the exact same DB4 form with the patient's signature
at the bottom. They do not want two forms in the document folder. So we need to
print the cost on the form and print it out in the Signed-DB4. The patient's
signature must be in the Signed-DB4."* And: *"Lets call the artefact the
Signed-DB4."*

**This reverses D-2026-09-14-01**, made an hour earlier on a narrower reading
of the practice's concern.

**The decision, in three parts:**

1. **The name.** The post-service document is the **Signed-DB4**. It is a kind
   of Signed Assignment Agreement, which stays the general term for the other
   agreement types, none of which are DB4s.
2. **What it is.** **Our deterministic reproduction of the PracSoft DB4's
   layout, rendered from the DB4 Print Record, with the patient's signature at
   the bottom** — NOT PracSoft's PDF bytes with a signature stamped on. The
   practice sees a form identical to the one it prints today; we render it,
   hash it, and can re-render it byte-identically (hard rule 13 intact). One
   form goes into the folder. We no longer keep a copy of the PracSoft DB4
   at all: the DB4 Print Record and its source hash are the provenance.
3. **The cost is printed on it.** The benefit amounts, **reproduced verbatim
   from what PracSoft printed**, carried in the DB4 Print Record.

**Hard rule 4 is NARROWED, not removed.** REQ-REG-04 says the data set has no
fee and *"do not add"*, naming the risk as ours introducing a figure. It is not
a statutory prohibition — the government's own approved form prints the
amount. The rule becomes: **AoB never originates or computes an amount; it may
reproduce the amount the practice's billing software printed on its own form.**
A dispute about the figure is a dispute with the claim, not with the consent.

**Hard rule 12 is kept with a footer.** The DB4's own heading — *"the approved
form as prescribed under section 20A"* — is the government's statement about
the government's form and is reproduced verbatim; altering the DB4's words would
be the stranger act. A provenance line in the footer says the page was rendered
by AoBPlatform from the practice's billing record, so nobody reads the heading
as a claim about us.

**Hard rule 1 was left open here and is decided in D-2026-09-14-03**: the
Medicare card number and IRN are printed in full.

**What does not change.** The validator still runs on every element of the data
and still refuses to send an incomplete set (hard rule 2). The form VERSION is
still PracSoft's choice and still the first question to the practice. The
pathology tick box stays on the practice's paper (out of scope). Nothing in the
model is dropped: the Signed-DB4 needs the patient, both practitioners, the
location, the service rows, the render path, the hash, the signature event, the
Evidence Vault and the write-back.

**What would reopen it.** The practice accepting two documents in the folder,
which would let the PracSoft DB4 carry the amount and ours carry none; or a
regulator's position on amounts on the signed form.



## D-2026-09-14-03 - The Medicare card number and IRN are printed in full on the Signed-DB4

**Date:** 14 September 2026. **Decided by:** Carl: *"No need to mask the
medicare number as the medicare number is what the patient can recognise and
validate. Also when audited, the gov will need the medicare number / IRN to
easily link a form to a valid medicare number."*

**The decision.** The Signed-DB4 reproduces the Medicare card number and IRN
exactly as the PracSoft DB4 prints them. They travel in the DB4 Print Record.
No masking.

**Why.** Two reasons, both the practice's and both about the form doing its
job. The patient reads their own card number on the page and knows the form is
theirs, the way they know their own name. And the form is the document an
auditor links to a claim, and the claim is keyed by that number - the
government's own approved form prints it for exactly that reason.

**What hard rule 1 says, and why it does not move.** *"The Medicare card number
is NOT an identity identifier."* That was always a rule about **verification**:
the approved set for proving who somebody is is name, date of birth, gender,
address, patient record number and IHI, and the Medicare number is excluded
from it, non-configurably (REQ-VER-02). Printing the number on a form is not
using it to verify anybody. So the rule stands unchanged, and it is worth
saying plainly what it still forbids:

- **Never used to verify** a patient's identity, on the kiosk, the remote link
  or anywhere else. The three-identifier floor is unchanged.
- **Never used to find or match** a patient. The practice's record number is
  the join key; the Medicare number is content on a form.
- **Never in a log, an error message or a vault event** (hard rule 9). Events
  carry ids and types; the number lives inside the Signed-DB4 and the locked
  particulars of that one agreement, nowhere else.
- **Never sent to the rules service**, which is zero-PII by design and has no
  rule that needs it - it is not in the s 65C data set.
- **Never a searchable column.** It is not added to the patient record.

**What does move: the security posture.** The derived rule "we hold none" is
gone. The Evidence Vault now holds Medicare numbers inside every Signed-DB4, and
they cross the wire from AOBPRINTER. Both are already covered by what exists -
encryption at rest, mutual TLS outbound-only from the practice, append-only
storage - but **`aob-threat-model.md` was written on the assumption that no
Medicare number is held anywhere and needs a section that says it now is**,
treated as the high-value fraud identifier it is. Recorded in `TODO.md`.

**Fixtures still never carry a real one.** Sample data uses an invalid checksum
(CLAUDE.md 7), as before.

**What would reopen it.** A regulator's position that the number must not
appear on the signed form - which would be surprising, given it is on the
government's own.



## D-2026-09-14-04 - The signing product is the first slice of AoB, feature-flagged, and it keeps the name

**Date:** 14 September 2026. **Decided by:** Carl: *"Put in the plan to build it
as the first slice of AoB, feature flagged. However, lets keep calling it AoB. I
realise that we do need the customer data at a minimum. Not so sure on the
entire practitioner functionality we built. However, leave everything in place -
do not change anything."*

**The decision.**

1. **One product, one name.** There is no AOBL. The DocuSign-like experience the
   test practice wants - print the DB4 to AOBPRINTER, sign on a tablet or by
   remote link, Signed-DB4 back in the folder - is **the first customer-visible
   slice of AoB**, built on the codebase that exists.
2. **Feature-flagged, per practice.** The first customer sees the DB4 path and
   nothing else: no waiting-room kiosk walk-up, no ongoing agreements, no queue
   rails, no reconciliation screens, no portal, no practitioner pages. Those
   stay built and stay off. Turning one on for a practice is a flag, never a
   rebuild.
3. **Nothing is removed and nothing is changed.** Carl is unsure the
   practitioner functionality earns its place; the ruling is to leave it in
   place and decide later, with a customer in front of it, rather than delete
   work on a hunch.
4. **The validator's two jobs are split.** Completeness of the data - patient,
   provider at that place, items, dates - still gates the signature, because
   that is hard rule 2 and is not softened. The form-version check (is this the
   post-1-July DB4E?) **warns** rather than gates, because it cannot be
   determined from a print and would otherwise block every signature at a
   practice whose software is behind. The form version is not one of the
   particulars, so this touches no hard rule.

**Why the first slice and not a fork.** Filing a signed PDF in the right folder
with the right name already needs the chart number, the form reference, the
provider, the location, a render, a hash, a signature event and the write-back.
That is not the compliance product; it is the plumbing of a signing product,
and it exists. A separate thin codebase would rebuild it and then become the
product forever, because it is the one customers are on.

**What this settles for the build order** (`DB4-AND-AOBL.md` section 13): the
DB4 document type and the DB4-shaped template first, because they are the
visible thing and can be demonstrated by posting a DB4 Print Record by hand to
the endpoint that already exists; AOBPRINTER second, because it is a separate
codebase and the slice works without it; the write-back pull and the telehealth
link after.

**What would reopen it.** A second customer whose practice management system
has a documented interface, which would make the print driver the fallback
rather than the door; or evidence that the flagged-off surfaces cost more to
carry than to delete.



## D-2026-09-17-01 - No patient data rests on a practice PC: keep receipts, not records

**Date:** 17 September 2026. **Decided by:** Carl: *"only keep for the day or
maybe even for 1 hour... we cannot keep PII on user's PC."*

**The decision.** AOBPRINTER's local outbox keeps a DB4 Print Record only until
the server acknowledges it. Retention is an **event, not a clock**: on a 2xx the
payload is deleted immediately, and what remains is a **receipt** - sha,
formReference, server job id, timestamps, template version, byte count, attempt
count, final state - which holds no patient data and answers "did this form get
through, and when" for as long as anybody needs to ask.

**The three tiers, and the distinction is the whole point.**

| Folder | Holds | Retention |
|---|---|---|
| `pending/` | not yet acknowledged | **until ack. No TTL, ever.** Older than an hour alarms on every sweep and in the startup banner |
| `sent/` | acknowledged | **deleted on ack, immediately** - not an hour |
| `poison/` | rejected and unpostable | 1 hour default, configurable, hard cap 24 hours, then deleted with a loud record that a form was destroyed |

**Why `pending/` has no expiry.** A form nobody can post is an alarm, not a
candidate for deletion. Deleting unsent work to satisfy a retention rule would
destroy the only copy of a patient's signed intent to satisfy a tidiness policy,
and hard rule 8's spirit runs the other way: an outage slows evidence, it never
destroys it.

**Why encryption and not shredding.** Overwriting a file does not reliably erase
it on an SSD - wear levelling and TRIM mean the old blocks survive the
overwrite. So every payload that waits is encrypted at rest (AES-256-GCM under a
key wrapped by Windows DPAPI at machine scope), and deletion is therefore
crypto-shredding: the same control the Evidence Vault uses under hard rule 11,
applied at the other end of the wire. The key is wrapped, never the payload, so
no patient data is ever passed on a command line. If the key cannot be
unwrapped, the program refuses to start rather than quietly writing plaintext.

**What industry practice this follows.** A store-and-forward client keeps a
payload until acknowledged and no longer: PCI-DSS forbids retaining sensitive
authentication data once an authorisation completes and keeps a truncated
reference instead; secure print release purges on release; site connectors for
clinical systems are pipes, not filing cabinets. The general privacy frame is
destroy-or-de-identify once the purpose is served - to be stated properly in
`aob-threat-model.md` alongside the Medicare-number section D-2026-09-14-03
already requires, not asserted from here.

**Sequencing, which matters more than the policy.** This ships **disabled**. The
server currently discards the DB4 record - `ValidationPipe({ whitelist: true })`
strips every field the envelope DTO does not declare - so `sent/` is at present
the **only complete copy of a DB4 Print Record anywhere**. Turning deletion on
before piece 1 keeps the record would acknowledge a form and then lose it. With
the flag off, receipts are still written and stale `pending/` still alarms; the
flag goes on when piece 1 lands.

**Also settled here:** the spooler must not retain printed documents
(`Set-Printer -KeepPrintedJobs $false`), because a Windows-held copy of the page
would defeat all of the above; and the claimed spool PDF is deleted the moment
it is parsed, so the full form image never waits on disk at all.

**What would reopen it.** A practice whose network is unreliable enough that
`pending/` routinely holds forms for days, which would make the alarm the normal
state and need a different answer (probably a local encrypted store with an
explicit, visible queue depth rather than a silent folder).



## D-2026-09-17-02 - One version per machine, and a LAN practice shares the host rather than the queue

**Date:** 17 September 2026. **Decided by:** Carl: *"you are building an app for
the medical industry. Hence, include all guard rails. Add guard rail to only
allow a single version of the AOBPrinter to be install locally on a machine. If
a large Practice can the Printer be setup as a LAN printer - we need this option
to allow easy maintenance and central Queue for admin to maintain."*

### One version, enforced at four layers

| Layer | What it stops |
|---|---|
| An exclusive lock file per data directory | Two PROCESSES. A second instance refuses to start and names the pid and build holding the lock |
| An install marker, compared numerically | A DOWNGRADE. Same version is idempotent, newer upgrades in place, older is refused |
| A format version in the outbox | A downgrade READING a folder a later build wrote, and half-understanding payloads it may not be able to decrypt |
| The version in the banner, every receipt and every post | Not knowing what is actually in the field, as against what was deployed |

**Why four and not one.** One layer is a wish. The layer that prevents harm
today is the lock: the port is a single file path and claiming is a rename, so
two watchers either claim the same bytes twice - one form, two records, two
arrivals in front of a receptionist - or one reads while the other renames and a
complete form parks as incomplete. A practice acquires a second copy of this
program by the most ordinary means imaginable: a service already installed, plus
a technician running it in a console to see what it does.

### A LAN practice shares the HOST, not the QUEUE

One AOBPRINTER host - an always-on PC or server - carries **one queue per
workstation**, each with its own port and its own spool file, all watched by one
service. Workstations install nothing; they connect to a shared queue.

**Why not one shared queue, which is the obvious design.** The port is a single
fixed file path and the spooler OVERWRITES it. Two jobs seconds apart destroy
the first before the watcher claims it - a consent form lost, silently, at
exactly the busy moment that produced it. One queue per workstation reduces the
collision to the same workstation printing twice within the claim window, which
is the single-workstation case that is already handled.

A single-workstation install is the same code path with a list of one. There is
deliberately no second "single" path to drift out of step.

**What it buys the practice**, which is what Carl asked for: one install, one
outbox, one certificate, one version, one place to maintain - and, as a
by-product, attribution. A record now carries the queue and label it came from,
so the desk can see that a form came from Room 3.

### The reconciliation alarm, which is the guard rail that matters most

If the spooler completed ten jobs on a queue and AOBPRINTER claimed nine, a
patient's form was printed and never became a record. Nobody would otherwise
find out. So the installer enables the Windows Print Service operational log
(off by default) and the program compares counts per queue, alarming on a gap.
It reads **counts and job ids only, never document titles**, because a print
job's name can carry a patient's name (hard rule 9). It never blocks printing
and warns once rather than every cycle.

### What the review then found, and the rule it produced

Both blocking findings were the same mistake in different clothes: **a guard
rail that fails open is worse than no guard rail, because it reports success.**
Reconciliation scored a queue the spooler had never heard of as "zero printed",
which can never exceed claimed, so it said "checked, no gaps" forever - and
every config written before that day names a queue `default` that no printer
matches. The marker reader returned `null` for a file it could not parse, and
`null` means "nothing installed", so a corrupt marker silently disabled the
version guard. **Absent is a fact; unreadable is an unknown; an unknown fails
closed.** That sentence is the rule, and it applies to every check in this
product, not only these two.

### For the threat model

**In LAN mode the spool stream crosses the practice network.** A DB4 as a PDF
travels from each workstation to the host over SMB. That is new: a
single-workstation install never put a form on a wire inside the practice. SMB
encryption or an equivalent control is the practice's requirement and belongs in
`aob-threat-model.md` alongside the two sections `TODO.md` already asks for
(holding Medicare numbers, D-2026-09-14-03; and the practice-PC retention
surface, D-2026-09-17-01). Recorded in `TODO.md`.

**What would reopen it.** A Windows port monitor we control, which would give
per-job output paths and make a single shared queue safe - and would mean a
signed driver package, which is the cost this whole design was chosen to avoid.


## D-2026-09-27-01 - The patient reads their own DB4 on the tablet, with the cost, and the Medicare number masked there

**Date:** 27 September 2026. **Decided by:** Carl: *"patient sees the db4 with
the cost on it"*, and, on the waiting-room question, *"mask on the tablet, full
on the form"*.

**What prompted it.** Carl looked at the kiosk mid-ceremony and said it *"does
not look like what is on the sample DB4 form I shared last week"*. It did not,
and it was not meant to: the tablet was drawing the Assignment Agreement's own
ceremony while the Signed-DB4 -- the reproduction of the practice's form -- was
rendered only after signing and had no screen anywhere. The patient was signing
one presentation and the chart folder was receiving another.

**The decision, in four parts.**

1. **The tablet shows the DB4's own particulars, laid out as the form**, for any
   session that came from a DB4 Print Record. Same heading, same patient block,
   same service rows, same assignment statement. A patient who has seen the
   practice's paper form recognises the screen.
2. **The benefit amount is shown**, reproduced verbatim from what PracSoft
   printed. This restores the intent of D-2026-09-14-01 -- the patient must be
   informed of the cost -- which -02 reversed as to the *artefact* and never
   ruled on as to the *screen*, leaving the requirement in a gap between two
   records. It is display only; it does not enter the agreement's particulars,
   is not hashed into the Assignment Agreement, and is not computed by us.
   Hard rule 4 as narrowed by D-2026-09-14-02: **AoB never originates an
   amount; it may reproduce the one the practice's billing software printed.**
3. **The Medicare card number is MASKED on the tablet and printed in full on the
   Signed-DB4.** This is the one place the screen deliberately differs from the
   form, and D-2026-09-14-03 is amended only here. That decision's reasoning --
   the patient recognises their own number, and the auditor needs it to link a
   form to a claim -- holds for a sheet of paper handed to one person. A tablet
   is held up in a waiting room with other patients three seats away, and a
   Medicare number is a high-value fraud identifier. Masked is enough to
   recognise, not enough to harvest. The form in the chart folder is unchanged.
4. **We do not adopt DocuSign-style signing on a rendered PDF.** Considered and
   refused, for four reasons that are each independently sufficient:
   - **Hard rule 13.** A stamped PDF is a blob whose only evidence is its bytes.
     Our path re-renders byte-identically from locked data forever, and
     `signed-db4.service.ts` renders twice and compares before it stores
     anything. That is a stronger chain than a signed blob, not a weaker one.
   - **Hard rule 2.** The signature control is gated on the server's lock. A PDF
     viewer has no such gate, so it would have to be rebuilt around one.
   - **WCAG 2.2 AA on patient surfaces is release-blocking** (CLAUDE.md section
     6). A page image does not reflow, carries no screen-reader semantics, and
     needs pinch-zoom to read 9pt type on a 10-inch tablet. The same ceremony
     serves the portal on a phone.
   - **Zero-footprint kiosk.** A viewer means either a new dependency or the
     browser's native one, which writes the file to the tablet -- the one thing
     that surface may not do.

   What DocuSign is *right* about is that the signer should see the document
   rather than an abstraction of it, and that is what part 1 adopts. The
   mechanism already existed: `ParticularsScreen` states that the words on the
   screen *"come back from the lock as part of the rendered document, which is
   the same object the PDF is drawn from and hashed against. One source of
   truth, rendered twice."* This decision adds a third rendering of the same
   source, not a second source.

**What would reopen it.** A regulator requiring a signature affixed inside the
document object; or a practice reporting that patients do not recognise the
masked number as their own.


## D-2026-09-27-02 - A practice with no PMS gets the `standard` surface profile, and there is no second kiosk URL

**Date:** 27 September 2026. **Decided by:** Carl: *"We may still want a version
that we have for a small practice that does not have a PMS system. So keep the
current build. Can we make these new features a separate url like kioskdb4 or
something."*

**The decision.** No second URL. The small no-PMS practice is served by a third
surface profile, **`standard` -- every surface except `db4`** -- and the DB4 form
view on the tablet is **additive**: the screen draws it only when the lock
response carries a `db4Form` block, and a session with no DB4 Print Record
renders exactly what it renders today.

**Why a profile and not a route.** `PRACTICE-SURFACES.md` section 6b, written
when piece 6 landed on 17 September, already named this as the missing piece:
*"Both shipped profiles include the `db4` surface, so there is no setting you
can give a practice that refuses a DB4 print job... Closing it needs one more
profile -- something like `standard`, everything except db4 -- which is a
product decision about what we sell, not a code change."* This is that product
decision. It also retires the mis-named test in section 6c, which is named for a
refusal it never demonstrates because no shipped profile could refuse.

**And why a route would have been the wrong axis.** Four reasons:

1. **The discriminator is the session, not the practice.** `Agreement.sourcePrintJobId`
   is nullable, and a practice that prints DB4s still has walk-ups. A tablet
   parked on `/kioskdb4` could not serve them.
2. **Reception pushes sessions to tablets.** A tablet on the wrong URL for the
   session being pushed is a support call, and the front desk would have to know
   which URL each tablet sits on.
3. **The hard rules live in the ceremony.** Rules 2, 3 and 13 are enforced
   inside `Ceremony.tsx`, along with pairing, heartbeat, outage, inactivity and
   the way out. A second route either duplicates all of that -- two places for a
   rule to drift, and the copy is the one that rots -- or shares it, in which
   case it is the same app at a different path.
4. **A URL is not a guarantee.** What the decision actually protects is *"the
   current build keeps working, untouched, for a practice with no PMS"*, and
   what protects that is the additive draw plus a named test, not a path.

**The one exception.** A preview of the DB4 screen without a print job, for
demonstrations, rides on the existing TEST-device branch as a query parameter.
It is not a production route.

**What would reopen it.** A DB4 flow needing a different pairing model, a
different device class, or a different tenant -- that would be a different
product, and would deserve its own app.


## D-2026-09-27-03 - The kiosk is designed against a 10-11 inch tablet in landscape, in large print

**Date:** 27 September 2026. **Decided by:** Carl, from a live tablet: *"we
need to make the content legible for an old person to see. So lets see how we
can format the page to make the font bigger and easier to read."* Two further
rulings the same afternoon, on the first cut: *"on Step 2 page 1 or 3 can we
put the Practice details on the left and the Patients on the right"* and *"can
you format it little better space between the header text and the details
below."*

**The decision.** Three things that had never been written down anywhere -- not
in this file, not in `TODO.md`, not in the kiosk README -- are now settled.

1. **The device.** The kiosk is designed against a **10-11 inch tablet in
   landscape**, design target **~1180x820 CSS px**. It must remain usable at
   **820x1180 portrait** -- the same tablet turned over -- and must not affect
   the portal's or the console's rendering at any width.
2. **The type scale.** Large print. Body text **20px** (1.25rem), rising to
   **22px** where the words are the operative words of the agreement. **Nothing
   on a patient-facing screen below 18px** (1.125rem) -- a hard floor, not a
   guideline. Headings **28-32px**. Touch targets **at least 44x44 CSS px**
   (WCAG 2.2 **AAA** 2.5.5, chosen over the AA minimum of 24px because of who
   is standing at this device).
3. **2A reads across, not down.** On page 1 of 3 of the DB4 the practice's
   details are the left column and the patient's are the right. The form's
   heading lines stay full width above both, separated from them by space and
   a rule. The date of this agreement and who is signing are neither, so they
   are a full-width band below both columns. In portrait the two columns stack,
   practice first.

**Why the floor is a variable and not a convention.** `app/tokens.css` already
carries a scale (`--text-xs` .. `--text-2xl`); it is the CONSOLE's, it bottoms
out at 12px and its base is 14px, and raising it would have restyled every
staff surface in the product. `kiosk.module.css` never used it -- it wrote rem
literals, and forty of them had drifted to 11px and 13px. The kiosk now
declares its own five (`--kiosk-text-note` 18 / `-body` 20 / `-lead` 22 /
`-h3` 24 / `-h2` 28) at the shell, and every rule in the file takes one. A
floor written in a comment is a floor the fortieth rule forgets; a floor that
is the smallest token in the scale is one a reviewer can see missing from a
diff.

**Why these numbers.** 20px body at arm's length on a tablet held or propped on
a counter is roughly what 14px is at a desk. 18px is the point below which a
reader with presbyopia and no glasses to hand starts guessing rather than
reading, and a bulk-billing consent ceremony is the wrong place to guess. 44px
is the AAA target size; the AA minimum of 24px is written for pointing devices
and not for an unwell person's thumb.

**What this cost, and where.** The footer's audit identifiers (build, device,
session, patient and print-job ids) were 11 and 13px and are now 18px, so the
row is taller and wraps sooner on a pushed session. That was the alternative to
a floor with an exception in it on its first day. The 560px query that dropped
the services table to 14px is gone: the screen with least room is not the
screen to make hardest to read, so the table's fixed columns give a character
back to the description and the type does not move.

**The one exemption, and it is not a patient surface.** `.db4Payload`, the
masked JSON block in the K-3 rail, stays at 11px. It renders only behind
`showsWaitingList`, on a test device, under a permanent "TEST DEVICE" banner,
and no patient can reach it. Setting a JSON dump at 18px in a 320px rail would
make it useless to the only person who ever sees it and legible to nobody.

**The breakpoints are the device's.** 900px, 600px and 560px came over from the
portal and were nobody's device. There are now two, and both sit in the gap
between 820 and 1180 so the same tablet crosses exactly one of them when it is
rotated: **1023px**, below which the 320px rail no longer fits beside a 620px
column and the columns stack; and **767px**, below which we are no longer on
the device we design for and controls that sit beside their text go under it
at full width.

**What would reopen it.** A different device class -- the 7-inch tablets some
practices already own, or a wall-mounted screen read from two metres -- would
need its own target and its own scale, and the tokens are where that would be
expressed. A read-aloud or a patient-controlled text-size control (both still
outstanding from C2, REQ-NFR-05/REQ-VUL-08) would change what the floor is FOR,
though not that there is one. Nothing in the regime moves it: this is an
accessibility decision, not a statutory one.

**Where it is enforced:** `apps/web/app/kiosk/kiosk.module.css` (the
`--kiosk-text-*` block on `.screen, .inactivity`, and every rule below it),
`apps/web/app/kiosk/README.md` section "The device and the type scale".


---

## D-2026-09-27-04 - The details check is asked once per SESSION, and the step chip is latched at arrival

**Decided:** The tablet asks the patient to check their details **once per
tablet session** - not once per patient per day, and not once per agreement. A
re-push makes a new session, so it asks again. And the step chip's arithmetic
is **captured when the ceremony starts** and never re-read afterwards. - Carl
Hill, 27 September 2026, from a live tablet, across four reports: *"still go
to step 3 when I push to tablet"*, *"never goes to step 1"*, *"force the
patient to step1 for each agreement - this is a better rule"*, *"Still jumps
to step 2 somtimes"*.

**Why:**
- The boundary was originally the PATIENT and the DAY: any confirmation that
  day suppressed the question. A patient with five agreements in a morning was
  asked once and then pushed straight into the form four times, which is the
  "never goes to step 1" Carl saw.
- Narrowing it to the AGREEMENT was still too wide, because a re-push of the
  same agreement creates a NEW session and the earlier session's answer still
  suppressed the question. That is the "still jumps to step 2 sometimes".
- The session is the right boundary because the session is the ceremony. The
  patient is holding the tablet for this one; what they answered on a previous
  handover is not an answer they have given on this one.

**And the latching is a separate rule with its own reason:**
- `detailsCheck` flips to `confirmed_today` the instant the patient answers,
  and `particularsLockedAt` is written mid-ceremony by the lock. Both are
  inputs to how many steps the ceremony has.
- Read live, the chip renumbers **under the patient's hand**: "Step 1 of 3"
  becomes "Step 1 of 2" and then "Step 2 of 2" without the patient doing
  anything the chip is describing. A progress indicator that moves backwards is
  one nobody believes.
- So the route facts are latched once, at arrival, in `Ceremony.tsx`
  (`kp1Skipped`), and `ceremonySequence` is a pure function of them. This same
  mistake was made twice in one evening - first with `particularsLockedAt`,
  then with `detailsCheck` an hour after guarding against it - which is why it
  is written down as a rule rather than left as a fix.

**What changes it:** A ruling that a same-day confirmation should carry across
sessions (it should not; the patient is being handed a device). Or a fifth
route, which is one more entry in `ceremonySequence` and nothing else.

**Where:** `apps/web/app/kiosk/rules/ceremony-steps.ts` (the four routes),
`apps/web/app/kiosk/Ceremony.tsx` (the latch),
`apps/core/src/tablet-sessions/tablet-sessions.service.ts` (the boundary).
Named test:
`a_reload_mid_ceremony_does_not_ask_the_patient_the_same_questions_again`.

---

## D-2026-09-27-05 - Four digits of the Medicare number on the tablet, not one

**Decided:** The masked Medicare number on the tablet shows the **last four
digits** - `2454 23237 1` renders as the mask plus `237 1` - and the note
beside it asks the patient to check what is shown against the card in their
hand, including the IRN. - Carl Hill, 27 September 2026: *"In that case show
the last 4 digits of the medicare number. Showing just a single digit does not
help"*.

**Why:**
- The screen exists so a patient can compare what we hold against the card they
  are carrying. One digit is not a comparison; it is a formality that looks
  like one, which is worse than showing nothing.
- Masking is still server-side and the tablet is never sent the full value
  (D-2026-09-27-01). The device cannot leak what it was never given.
- Four digits of a card number that is **not an identity identifier** (hard
  rule 1, REQ-VER-02) and is never a sole authenticator anywhere in this
  product is a disclosure to the person the number belongs to, on a paired
  device, at the moment they were asked to check it.

**One thing Carl asked for was NOT built as asked.** His wording was *"Validate
you are the right number on the medicare card"*. That frames the screen as
identity verification against the Medicare card, which hard rule 1 forbids
outright. The intent - check the IRN beside your name - was delivered as a
**data-accuracy check on the form**, never an identity check.

**What changes it:** A privacy assessment that four digits plus a name on a
waiting-room-adjacent screen is too much. The count is one constant
(`DIGITS_SHOWN`).

**Where:** `apps/core/src/agreements/db4-form-view.ts`,
`strings.particulars.db4.maskedCardNote`.

---

## D-2026-09-27-06 - The push refuses a DB4 Print Record we cannot reproduce, at the desk, naming what and which

**Decided:** When reception presses **Send to tablet**, the platform checks the
DB4 Print Record behind the agreement and refuses the push if it cannot
reproduce it. The refusal carries **every** failed check and **which print
record** it is about. Six checks: no patient identified, **a Medicare card
number with no IRN**, no services, no servicing provider name or number, no
date of service, and **no benefit against any service row**. - Carl Hill, 27
September 2026, from a live tablet: *"If no $ do not allow the approval to
progress. Check all details when the reception pushes to the tablet."*, then
*"if a medicare# is provided then the IRN must also be provided. Check this on
button 'Send to tablet' at reception"*, then *"message needs to say what data
is missing on the print and also some unique id to identify the print"*.

**Why it is not a statutory validation, and why that distinction is the whole
design:**
- **No dollar amount is in the s 65C data set** (hard rule 4, REQ-REG-04). An
  agreement with no amount anywhere near it is statutorily **complete**. None
  of these codes means the agreement is invalid, and an agreement that never
  came off a printed DB4 is never asked any of them.
- What they measure is **confidence in our own reproduction**. A real PracSoft
  DB4 for a bulk-bill claim prints a benefit against its rows, so a record
  carrying none most likely means the parser template did not read the form -
  the ordinary cause being a PracSoft layout change. The patient is about to be
  shown that reproduction and asked to check it against what they know, so a
  reproduction we do not believe should not reach them.
- **Nothing originates, parses or computes an amount.** `benefitAssigned` is
  tested for PRESENCE, as a non-empty string. `0.00` passes - deciding that a
  zero means "no amount" would be AoB forming an opinion about a figure, which
  is exactly what hard rule 4 forbids (D-2026-09-14-02).

**Why the IRN check is conditional:** card number present means IRN required;
neither present means nothing required. Carl found the case that makes it
matter. `ParticularsScreen` draws the IRN row only when there is a value, while
the note beside it tells the patient to check *"the IRN beside your name"*. A
half-read card therefore produces a screen asking somebody to check a field it
has not shown them. It is a **presence** check on a parsed field and **not** an
identity check - the card identifies nobody (hard rule 1, REQ-VER-02).

**Why at the desk and never on the tablet.** The tablet-side block was put to
Carl and he rejected it. Hard rule 8 (REQ-REC-04) is the reason: a refusal at
the desk is a redirect a staff member acts on in seconds - reprint, or paper,
or after the service - and the patient is seen and billed either way. A dead
Continue button in front of somebody who has already sat down is the failure
that rule exists to prevent, and they are the one person in the building who
cannot fix a print record.

**Which record, and the file that does not exist.** The refusal names the form
reference (printed on the page), the print queue it came off, when it was
captured and received, the parser template version, and `sourceSha256` -
**AOBPRINTER's own ref, and the row's audit key**
(`@@unique([practiceId, documentType, sourceSha256])`). There is **no file path
and there never was one**: the driver parses at the practice and sends the
parsed record plus a hash of the source bytes - *provenance without possession*
(8.2) - so no path, spool id or filename is captured by the envelope, accepted
by the DTO or stored on the row. The band says so in a line rather than showing
a blank field. Timestamps are trimmed to the second, because milliseconds
(`...54.953Z`) read as a dollar amount to the named hard-rule-4 guard, and the
data loses a precision nobody wanted rather than that guard learning
exceptions.

**Three of the six are a backstop, not protection.** `db4-assignment.handler.ts`
is the only writer of `Agreement.sourcePrintJobId` and gates on chart number,
service items and service date first, so those three cannot fire on any
agreement that exists today. That is a fact about today's code and not a
structural invariant, so `DB4_PRINT_RECORD_CHECK_GATED_AT_INGEST` states the
correspondence field by field and a named test pins it. **Live today:** the
benefit check, the IRN check, and the provider-NAME half of the provider check.

**What changes it:** An ingest gate that starts requiring an amount (the
benefit check then becomes a backstop too). A PracSoft form that legitimately
prints no benefit anywhere - which would make the benefit check wrong rather
than merely strict.

**Where:** `packages/contracts/src/db4-print-record-check.ts` (the codes and the
identity), `apps/core/src/agreements/db4-form-view.ts` (`checkDb4PrintRecord`),
`apps/core/src/tablet-sessions/push-refusal.ts`,
`apps/web/app/practice/tablet/pushDesk.tsx` (the band).

---

## D-2026-09-27-07 - Continue waits for the tick on its own page

**Decided:** On a paginated DB4, each page's **Continue** is blocked until the
affirmations **on that page** are ticked. A page carrying no affirmation is
open. - Carl Hill, 27 September 2026, from a live tablet: *"on page 1 or 3
Continue button should be enabled after the box is ticked. Same rule on the
next page"*.

**Why:** The gate used to be one gate at the end of the document: pages turned
freely and every box anywhere had to be ticked before signing. That is sound
and it reads wrong. Carl watched a live Continue sitting under an unticked box
reading *"I confirm the details above are correct"*, which invites somebody to
page straight past an affirmation and meet it again later as a blocked button
on a page they have left behind.

**It is a second gate, never a replacement.** `readyToSign` still spans every
page and is what hard rule 2 (REQ-REG-06) rests on - no arithmetic on a page
can open the signature path, and `GuardedButton`'s blocked branch has no
handler at all. This only stops a patient reaching the last page with work
behind them.

**It never blocks care** (hard rule 8): Back turns the page, "See reception" is
in the chrome on every page, and a patient who will not tick is a patient
reception handles - the same answer this screen always gave, one page earlier.

**What changes it:** A ruling that a patient should be able to read the whole
form before affirming any part of it. Which affirmation sits on which page is
`apps/web/app/kiosk/rules/db4-pages.ts` - presentation, never the instrument.

**Where:** `apps/web/app/kiosk/screens/ParticularsScreen.tsx`. Named tests:
`a_pages_continue_waits_for_that_pages_own_tick`,
`a_page_with_no_statements_is_not_gated_at_all`.


## D-2026-09-28-01 - We do not police the providers on a DB4; we only need one to anchor the agreement

**Decided:** The platform does **not** verify the providers printed on a DB4
Print Record. It does not check that a provider number is genuine, that it
belongs to the person whose name is printed beside it, that it is current with
Services Australia, or that the named practitioner actually rendered the
service. - Carl Hill, 28 September 2026, looking at a form composed with the
wrong doctor's name against a known provider number: *"we do not check the
Providers - Servicing and Payee against our Dr's in the practice. Just for
signing - I think we do not need to check the Dr (even though this may be a
way for fraud) - however, it is not our job to police"*.

**The fraud vector is acknowledged and accepted.** Somebody with access to a
practice's printer could put any name on a form. This product captures and
proves CONSENT; it is not a claims auditor, and claim lodgement is explicitly
out of scope (CLAUDE.md section 8). A check we cannot perform properly is
worse than no check, because it would imply an assurance we are not giving -
the same reasoning hard rule 12 applies to the word "certified".

**WHAT THE CODE ACTUALLY DOES, AND THE ONE PLACE IT IS NOT QUITE THIS.**
Recorded because the decision as put is true of three of the four fields and
not of the fourth, and a decision that quietly disagrees with the code is
worse than no decision.

| On the form | What we do with it |
|---|---|
| Servicing provider NUMBER | **Resolved** against this practice's affiliations. Must match exactly one |
| Servicing provider NAME | Never checked against anything |
| Payee provider NUMBER | Recorded verbatim. Never resolved, never checked |
| Payee provider NAME | Never checked against anything |

**Resolving the servicing number is not policing - it is the party.** An
assignment of benefit is an agreement **with** a practitioner (s 65C(5)(a)),
and the platform anchors the visit on that practitioner. A number that names
nobody at this practice leaves the agreement with no counterparty, which is
not an agreement. So `resolveAnchor` refuses a number no affiliation holds
(`provider_not_found`) and refuses one held by two (`provider_number_ambiguous`,
a records fault rather than a coin toss on a contract). That is the absence of
a party, not a judgement about a doctor.

**It never blocks care** (hard rule 8, REQ-REC-04). The refusal is a 404
caught by the DB4 handler, written as a reason on the print-job row, and
logged. Nobody is stopped from being seen or billed; the evidence is slower,
the service is not.

**The name is deliberately not substantive, and the reprint rule says so.**
`db4ParticularsChanged` does not compare provider names at all: a form
corrected only in a printed name REPOINTS rather than supersedes, because the
agreement resolves its provider from the NUMBER through the affiliation.
Carl's own test - "Dr Zachariah Hilll" against `9999999X` - is exactly that
case, and it is intended behaviour rather than a gap.

**What changes this.** A ruling that the platform should verify provider
identity, which would need a source of truth we do not have and a decision
about what to do when it disagrees - neither of which exists today. If the
practice's own records are wrong, that is fixed on the affiliation, which is
the screen the refusal already points at.

**Where:** `apps/core/src/arrivals/arrivals.service.ts` (`resolveAnchor`),
`apps/core/src/inbound/db4-assignment.handler.ts` (`reasonFor`,
`no_servicing_provider`), `apps/core/src/inbound/db4-reprint.ts`
(`db4ParticularsChanged` compares `servicingProviderNumber` and no name).


## Q-2026-09-28-01 - OPEN: may the same MBS item number appear twice on one DB4?

**Status: OPEN.** Not a decision. Recorded so the answer has somewhere to land
and so the assumption the code is already running on is visible. - Carl Hill,
28 September 2026, looking at two identical service rows in the AOBPrinter
test tool: *"does the gov rule allow for two item ids to exist more than once
on the same invoice"*.

**The question.** A DB4 prints a table of services. May the same item number
appear on more than one row of it - two units of one item, or two genuinely
separate attendances in a day - and if so, under what constraint?

**What the documents actually say: nothing.** The closest is **REQ-SCOPE-01**
(`aob-requirements.md`, and the same-day table in
`aob-faq-reconciliation.md` C5): *"An agreement is scoped to practitioner x
patient x day. Multiple services by the same practitioner on the same day may
share one agreement where the services correspond to those listed."* That
settles MULTIPLE SERVICES. It says nothing about the same ITEM NUMBER
repeating, and nothing in `packages/domain` or the rules engine treats a
repeat specially. CLAUDE.md section 7c: priors on this regime are stale and
section-level facts come from the documents, so the gap is flagged rather than
filled.

**Why it does not block anything today.** Claim lodgement is out of scope
(CLAUDE.md section 8) and hard rule 8 forbids a flow that blocks care, so even
a Medicare restriction on a pairing is not ours to enforce - refusing a form
over it would be inventing a gate the regime never asked for. And the DB4 on
the tablet is a REPRODUCTION of what the practice printed (D-2026-09-14-02):
if PracSoft printed item 23 twice, two rows is the faithful reproduction and
collapsing them would be editing their form.

**The assumption the code already runs on, stated so it can be overturned.**
`db4ParticularsChanged` compares the item list order-insensitively but KEEPS
DUPLICATES, so two of an item is not one of it. A corrected reprint that drops
one of two identical rows is therefore a CHANGED PARTICULAR and supersedes,
rather than repointing. That is the conservative direction either way: a
legitimate duplicate is never silently lost, and a printing artefact that gets
corrected produces a new agreement rather than a quiet alteration of a locked
one.

**What would close this.** A citation - an MBS rule, a Services Australia
claiming rule, or a line in the requirements - saying whether a repeat is
permitted and on what terms. If repeats turn out to be FORBIDDEN, nothing here
changes: we still reproduce what was printed, and the wrongness is the
practice's claim to fix, not ours to block.

**Where:** `apps/core/src/inbound/db4-reprint.ts` (`sameItems`), named test
`the_same_item_twice_is_not_the_same_as_once` in `db4-reprint.spec.ts`.
Seeded as `duplicate-items`, set 3.


## Index of decisions taken 3–4 September 2026 (recorded in TODO.md at the time)

## D-2026-09-28-02 - Write-back on the print channel is a COLLECTION, and the folder drop is what earns `writtenBackAt`

**Decided:** On the print channel, the platform does not write anything into
the practice's PMS. It **publishes** what is signed and waiting; AOBPRINTER
**collects** it and writes the pair into the PMS's document-import folder;
and the desktop's confirmation - carrying the hash of the bytes it actually
wrote - is what sets `writtenBackAt`. There is one meaning of "written back"
and one vault event (`agreement.written_back`), with `pms: 'import_folder'`
naming the route taken. - Carl Hill, 28 September 2026: *"build the
import-folder write-back"*, and *"where do we write the signed copy to send
back to [the PMS] (folder)"*.

**Why:**
- **Printing cannot write back.** Nothing prints *into* a PMS, and REQ-INT-02
  says write-back is the product. `CONSULTATION-CAPTURE-PLAN.md` 8.6 named
  this the honest limit and the import-folder drop the answer; `GA-PLAN` B13
  scoped it at a day.
- **It is a pull because a practice's network is outbound-only** (ADR, mutual
  TLS). A server that pushed would need an inbound port on a receptionist's
  PC (`DB4-AND-AOBL.md` 6b, which weighed and rejected email-plus-agent and
  writing to the PMS's document table).
- **What existed before was a fiction.** `MockPmsAdapter.writeArtefact` put
  the PDF/A in an in-memory `Map`, returned `mock-doc-<sha8>`, and the
  agreement was marked written back. Real hash, real row, real vault event,
  document nowhere outside core's heap. D-01 stays unresolved and stops being
  the blocker: the print channel answers it for this practice.
- **The hash is re-checked at the door.** `writtenBackAt` is the platform's
  claim that a practice HOLDS the signed agreement, and a claim taken on
  trust from a client is a claim about nothing (hard rule 13, applied to a
  copy rather than to a display).

**What goes in the folder:** `<chart number>/<form reference>.pdf` with the
Write-back Manifest beside it as `<form reference>.json`
(`DB4-AND-AOBL.md` 6a, 7 row 3b). The **Signed-DB4** - our reproduction of
the practice's own form with the signature on it - not the Signed Assignment
Agreement: *"what the practice wants to see in the folder - one form, not
two"* (12).

**Scope, named rather than implied:** an agreement with no Signed-DB4 is not
published. Its own artefact is re-rendered from `rendererVersion` rather than
stored as bytes, so publishing one would mean rendering inside a polled read.
For the first customer the set is empty (D-2026-09-14-04). Closing it is a
stored-artefact change, not a change to this lane.

**What changes it:** a PMS that documents a real document API (PracSoft, or
Medtech if D-01 resolves) makes the adapter path the better route for that
practice; both coexist, because `WriteBackService` skips a practice with a
`documentFolderKey` and writes for one without. A practice that files
documents somewhere other than a per-patient folder needs a second answer,
which is D-2026-09-28-03 below.

**Built:** `apps/core/src/inbound/write-back-collection.service.ts` and two
routes on the connector's own prefix (`GET /inbound/print-jobs/signed`,
`POST /inbound/print-jobs/signed/:id/collected`); `apps/aobprinter/src/collector.ts`
and `collection-client.ts`. Tests: `write-back by collection` in
`db4-assignment.e2e-spec.ts` (5), `collector.test.ts` (14), and the
`collection_is_off_until_somebody_says_where` block in `config.test.ts` (3).

---

## D-2026-09-28-03 - Which key names the patient's document folder is a per-practice ANSWER, and nothing is filed until it is given

**Decided:** `Practice.documentFolderKey` is null until somebody has asked the
practice which key names its patient document folders. While it is null the
platform publishes nothing for collection and AOBPRINTER files nothing. The
only value the code understands is `patient_record_number`, enforced by a
database CHECK. - 28 September 2026, implementing D-2026-09-28-02; the
requirement is `DB4-AND-AOBL.md` 6a's own correction.

**Why:** the scanned DB4 from the test practice carries the chart number and
the practice's annotation says to use it *"for filename for folder
structure"*, so `patient_record_number` is right **there**. 6a's correction is
the whole reason this is a column: *"the Chart number must be confirmed to be
the folder name at this practice, not assumed. PMS installations differ, and
the day the folder turns out to be named for something else is the day fifty
signed consents land in the wrong place."* That failure is **silent** - the
files are written, nothing errors, and nobody finds out until an audit.

**The shape of the gate matters more than the gate.** Forgetting to ask must
mean write-back does not start, never that it starts and is wrong. So the
default is null, null publishes nothing, and the desktop's own
`collection.enabled` defaults to false with `enabled`-without-a-folder
refusing to start. Two gates for one question, at both ends, deliberately.

**What changes it:** a practice that names its folders for something else -
an IHI, a PMS-internal id, a surname-and-DOB convention. That is a
conversation and a new allowed value with code behind it, not a string
somebody types into a settings page.

**Built:** migration `20260928010000_document_folder_key`, read by
`WriteBackCollectionService.pending` and by `WriteBackService.attempt` (which
leaves a folder practice alone - per practice, not per process, because one
deployment serves both routes and the adapter is a singleton). Pinned by
`a_practice_that_has_not_said_which_key_names_its_folder_is_published_nothing`.

**Still open, and it is the next question to the practice:** nobody has
actually asked Powell Street yet. The column is the place to record the
answer; the answer is not in it.

---

## D-2026-09-28-04 - AOBPRINTER keeps its state in SQLite (`node:sqlite`), and ships its own Node.js

**Date:** 28 September 2026. **Decided by:** Carl: *"go with sqlite and ship
our own node."*

**The decision.** AOBPRINTER's local state moves from the folder outbox
(`outbox/pending|sent|poison/<sha>.json` plus `receipts.jsonl`) to one SQLite
database under its data folder, using Node.js's built-in `node:sqlite` - no
npm package, nothing native to compile. AOBPRINTER is installed with **its own
pinned Node.js** rather than relying on whatever a practice PC has.

**Why this reverses what was built.** The 3 September plan
(`CONSULTATION-CAPTURE-PLAN.md` 8.4) said *"durable local outbox (SQLite)"*.
The 14 September design (`DB4-AND-AOBL.md` 5a) switched to a folder in one
sentence - *"so if the practice ever wants to see what was sent, or drag one
in by hand, it is there"* - and the 17 September build followed it. That
switch was never recorded here. The likely unwritten reason was that SQLite in
Node then meant `better-sqlite3`, a native dependency; `node:sqlite` removes
that cost. What a database gives that a folder does not:

- **A record of every interaction, both directions.** Today the PC records
  forms going out (`receipts.jsonl`) and nothing at all about signed forms it
  files back into the PMS folder. It cannot say what it filed last Tuesday.
- **Something a support screen can read.** A folder answers "what is waiting";
  it does not answer "what happened this week".
- **State changes as transactions.** Queued -> sent -> acknowledged becomes one
  row updated atomically, instead of files renamed between folders.
- **Easier code to write against it** (Carl): queries, not directory walks.

**Why ship our own Node.js.** `node:sqlite` exists only from Node 22.5; the
repo's floor is Node 20; most practice PCs have no Node.js at all. A pinned
runtime makes the version ours, present on every PC, and immune to anything
else installed on the machine. Cost: about 88 MB (`node.exe` 24.19, measured),
against about 2 MB of AOBPRINTER code - an install made once per PC.

**What does NOT change.**
- **D-2026-09-17-01 holds in full.** No patient data rests on the PC: a form's
  record is encrypted while it waits and deleted on acknowledgement; only the
  no-PII receipt stays. Deleting a row does not reliably erase it from disk any
  more than deleting a file does, which is why encryption-then-delete remains
  the mechanism, not deletion alone.
- **The platform cannot reach this database.** The practice network is
  outbound-only (mutual TLS). AOBPRINTER may *report* no-PII facts from it,
  the way it already posts forms and confirmations; the platform never reads
  it directly.
- **Idempotency stays keyed on `sourceSha256`**, now a primary key rather than
  a filename.

**SQLite has no user id or password.** It is a file, not a server. Access
control is the file's Windows permissions: the data folder is restricted to
the AOBPRINTER service account and Administrators. `node:sqlite` has no
whole-file encryption; the protection for patient data is the per-record
encryption above, not the database.

**Still to decide before building (put to Carl 28 Sep):** where support sees
and uses the database. The existing "AOBPrinter test tool" (`/aobprinter` in
`apps/web`) is a dev-only page that fabricates print jobs and posts them to
the platform; it never touches a practice PC and renders nothing in
production, so it cannot open this file.

**What would reopen it:** `node:sqlite` proving unfit on the pinned Node (a
stability or corruption problem found in testing), or a packaging constraint
that makes a bundled runtime impossible at a practice.

**Not built yet.** Rework of `outbox.ts`, `receipts.ts`, `retention.ts` and the
collector's local trail, a one-time import of any existing folder outbox, and
the bundled-runtime installer. `TODO.md` carries the item.

### Amended 29 September 2026 - one database per practice, on the host's own disk

Two questions were put and answered after this was first written.

**Should the platform be the queue instead, with no database at the practice?**
Considered and not chosen. The platform already is the per-practice queue
(`inbound_print_jobs`, practice-scoped, with its own states) and the local
buffer only has to cover the seconds between a print and an acknowledgement.
Carl kept SQLite anyway: *"it will make screens / consoles over the db easier
to write. Then in the future we can move this to full sql db if required."*
So the storage sits behind an interface of its own, and nothing outside that
module writes SQL - moving to SQL Server or Postgres later is a new
implementation of one interface, not a rewrite.

**One queue per practice, however many receptionists.** Carl: *"there must be
only one AOBPrinterQueue talking to AoB."* That is LAN mode as already decided
(D-2026-09-17-02): one AOBPRINTER service on one host - an always-on PC or the
practice server - carrying one Windows print queue per workstation;
workstations print to it and install nothing. **The database lives on that
host's own disk**, beside the service that owns it.

**Never on a shared drive that several machines open.** SQLite's own
documentation: WAL mode *"does not work over a network filesystem"* because it
needs shared memory on one host, and file locking on network filesystems *"has
been known to operate incorrectly"*, which *"has led to database corruption"*.
Its recommended pattern is the one LAN mode already has - every read and write
from processes on the machine that stores the file, others relaying to it. The
instance lock (`instance-lock.ts`) has the same boundary: it proves a holder is
alive by pid, and a pid means nothing across machines. So a data folder on a
network path is refused at start-up, not merely advised against.

**`node:sqlite` status, checked:** Node.js 24's documentation marks it
*Stability 1.2 - Release candidate*, not yet stable. Accepted for this use -
a single-process database on local disk - with the storage interface as the
exit if it misbehaves.

**Build order (Carl, 29 Sep):** SQLite storage first, then the heartbeat, then
the console page. Branch `feat/aobprinter-sqlite`.

---

## D-2026-09-29-01 - AOBPRINTER keeps an end-to-end audit trail with no gaps: stages per form, and an append-only, hash-chained event log

**Date:** 29 September 2026. **Decided by:** Carl: *"In the db we need to track
which pdf and json was saved in what folder. We need and end-to-end audit
trail. No gaps in the audit trail"*, *"an append only log"*, and *"yes to all
three, build it"* to the stage model, the always-present key and the archive
below.

**The shape.** Not seven queues but one row per form with a **stage**, plus an
**event log**. A form moving between tables is the folder model again - a
moment when it is in neither, or both. A stage change is one update.

| Direction | Keyed by | Stages |
|---|---|---|
| Out (`prints`) | hash of the print | `received` -> `queued` -> `sent`; `parse_exception`; `send_exception` |
| Back (`returns`) | agreement + artefact hash | `received` -> `filed` -> `confirmed`; `received_exception`; `filing_exception` |

"Waiting to send" is `queued` and is **not** an exception - the internet is down
or AoB is busy - and alarms when old. "Filed, not yet confirmed" is a real state:
the file exists and AoB does not yet know.

**No gaps is structural, not promised.**
- **Every stage change writes its audit event in the same transaction.** A
  change without its event cannot exist.
- **The log is append-only in the database.** Triggers abort any UPDATE or
  DELETE on `audit_events`, from this program or any tool that opens the file.
- **It is hash-chained.** Each event carries the hash of the one before; an
  insert whose `prev_hash` is not the current head is refused by the database,
  and a verifier walks the chain. An edited or removed row breaks it.
- **Honest limit:** someone with administrator rights on the host could drop
  the triggers and rewrite the whole chain consistently. The defence is the
  heartbeat (to come) carrying the chain head to the platform, so a rewritten
  local log cannot match what the platform already holds.
- **Rows are no longer deleted.** When a payload is destroyed (acknowledged
  with retention on, or refused and expired) its patient data is removed and
  the row stays as the audit subject. The "reprint after purge is posted
  again" gap in the outbox closes as a side effect.

**Also recorded as events:** a duplicate print (same bytes again); the
reconciler's "printed but never received" gap (the one gap before stage 1);
the PDF archive and its destruction; exceptions resolved and by whom; the
program starting, stopping, changing version and restarting after an unclean
stop - a missing form at 10:15 is explained by the program not running.

**Where files went, and rule §6.** Every file event records its location. The
return folder is the chart number - a patient record number - and `CLAUDE.md`
§6 says *"No identifier values anywhere outside the encrypted stores"*, so
locations are **encrypted** in the database and decrypted on that host by the
support screen. Print archives are named by hash and carry no identifier.

**The form reference joins the two directions** into one story per form:
printed, parsed, sent, signed, returned, filed, confirmed.

**Deferred to the heartbeat:** "processed by AoB" (the platform already
records each job's outcome; the heartbeat reply can carry it) and anchoring
the chain head on the platform.

---

## D-2026-09-29-02 - The encryption key always exists on an AOBPRINTER host

**Date:** 29 September 2026. **Decided by:** Carl, *"yes"*, to the question
whether the key may be created even with retention off.

**Why:** audit locations and archived PDFs are encrypted from day one
(D-2026-09-29-01, D-2026-09-29-03), so the key cannot wait for
`retention.enabled`. `buildRetentionDeps` now always loads or creates it and
always returns a cipher. `retention.enabled` keeps its meaning for the outbox
payload: plaintext and kept (off) or encrypted and destroyed on
acknowledgement (on).

**What this reverses:** the guarantee that, with retention off, nothing
touches DPAPI or PowerShell. Tests that pinned that guarantee now pin the
opposite, and inject a stand-in wrapper so the suite still runs on Linux CI.

**Key management is a human-authored zone (`CLAUDE.md` §7c).** `keystore.ts`
is unchanged; only the wiring in `retention.ts` moved. Flagged for Carl's
review before any practice runs it.

---

## D-2026-09-29-03 - A captured PDF is archived, encrypted, for 7 days

**Date:** 29 September 2026. **Decided by:** Carl: *"PDF should not be deleted
once parsed but archived for say 7 days, just in case there are issues"*, and
*"yes"* to doing it encrypted.

**This overrides D-2026-09-17-01's 24-hour cap** for one thing: the captured
spool PDF. It is written to `archive/<sha>.pdf.enc` under the same AES-256-GCM
key, named by hash so the filename carries nothing, and destroyed by the sweep
after `retention.archiveDays` (default 7, allowed 1-30; the upper bound is
Claude's, to stop a typo keeping PDFs for years). Archiving and destruction
are both audit events.

**What does not change:** the outbox payload rules, and `unparsed/`, which
still keeps an unreadable print as plaintext for a human to look at - a
pre-existing gap now named in `TODO.md`, to close when the support screen can
open an encrypted archive.


| Date | Decision | Where |
|---|---|---|
| 3 Sep | Name rule: family name + first given name, any order | TODO "The practice flow" (a) |
| 3 Sep | No QR card; post-service approval is a second push to the reception tablet | TODO "The practice flow" (b, reversed) |
| 3 Sep | The agreement gates the claim, never the consultation | TODO "The practice flow" (c) |
| 3 Sep | Zero-footprint kiosk: nothing installed on or written to the device but one pairing credential | CLAUDE.md §7; TODO |
| 3 Sep | C2.2 offline-first withdrawn; C2.3 tightened; C2.5 RACF batch mode → roadmap | `.claude/docs/AoB_requirements.md` |
| 3 Sep | Kiosk folds into `apps/web` (Next.js); Expo retired | CLAUDE.md §4/§7; TODO |
| 3 Sep | Choose tech for iteration speed; option lists are content files | CLAUDE.md §7 |
| 3 Sep | Nothing on the patient surface is ever staff entry; a mismatch stays on K-2 | TODO |
| 4 Sep | Two front doors: walk-up kiosk stays; reception push is its own use case | TODO "Two front doors" |
| 4 Sep | Walk-up list is testing-only (per-device console flag); Begin → confirm details; no count | TODO |
| 4 Sep | Verification stays at three identifiers | **D-2026-09-04-01 above** |
| 4 Sep | Patient passkeys live in core, not Keycloak | **D-2026-09-04-02 above** |
| 11 Sep | Post-service second push; a signed pre-agreement for the day covers the service | **D-2026-09-11-02 above** |
| 11 Sep | A contact address is never typed on the tablet; the offer goes to what is on file | **D-2026-09-11-03 above** |
| 12 Sep | Passkey enrolment carries per-platform steps, in a Keycloak login theme | **D-2026-09-12-01 above** |
| 12 Sep | We offer the queue, not the calendar — no scheduling product | **D-2026-09-12-02 above** |
| 12 Sep | A substitution asks two questions: the doctor first, the benefit second | **D-2026-09-12-03 above** |
| 12 Sep | A nurse's arrival waits for a billing provider named by RECEPTION, and the fix is a resend | **D-2026-09-12-04 above** |
| 12 Sep | Two homes: `/practice/today` for the day's work, `/practice/setup` for configuration; nobody lands on the hub | **D-2026-09-12-05 above** |
| 12 Sep | "Completed" records the visit and raises a post-service agreement only where the invoice already carries D6b — no item number is ever invented (ASSUMPTION) | **D-2026-09-12-07 above** |
| 12 Sep | A practitioner has one login per practice, but stays one person (re-recorded; was -05) | **D-2026-09-12-08 above** |
| 12 Sep | Billing identity is practice × location × practitioner; enduring coverage is per practitioner across locations | **D-2026-09-12-09 above** |
| 12 Sep | Practice bound to the login, location chosen once per session; practice codes allocated and unique | **D-2026-09-12-10 above** |
| 12 Sep | Authentication is tiered: tenant SSO, platform accounts, passkeys. Hard rule 15 narrows to platform operators and patients | **D-2026-09-12-11 above** |
| 12 Sep | Practitioner accounts are optional per practice; reception can do everything a doctor would | **D-2026-09-12-12 above** |
| 12 Sep | A manual practice must be able to type what was billed; the post-service screen is release-blocking | **D-2026-09-12-13 above** |
| 12 Sep | Practice posture is recorded per integration point; the mode is derived, never stored | **D-2026-09-12-14 above** |
| 12 Sep | A corrected resend supersedes, needs a new idempotency key, and must never vanish silently | **D-2026-09-12-15 above** |
| 12 Sep | A tablet says which front door it offers; a reception-driven one never shows Begin | **D-2026-09-12-16 above** |
| 12 Sep | Every location carries its own IANA timezone, and so does head office; it is stored, never derived from the state | **D-2026-09-12-17 above** |
| 12 Sep | The queue number has three sources in precedence -- their card, their software, then one we allocate -- and the source is recorded | **D-2026-09-12-18 above** |
| 12 Sep | An outage never empties the screen: last good data kept and timestamped, writes refused on the control, the page retries itself | **D-2026-09-12-19 above** |
| 12 Sep | "Finished" needs the consultation done, not just the signature; a step that needs its own agreement is a second visit | **D-2026-09-12-20 above** |
| 12 Sep | Every practitioner has a queue; position is derived and always said with the practitioner's name; sending a patient on is one click and creates a SECOND visit | **D-2026-09-12-21 above** |
| 12 Sep | A practitioner's list is moved to somebody else at the desk; the agreement is superseded whether or not it was signed, and a patient who had signed signs again at the desk | **D-2026-09-12-22 above** |
| 14 Sep | The benefit amount is shown on the tablet screen only, never on the Signed Assignment Agreement | **D-2026-09-14-01 above** |
| 14 Sep | The Signed-DB4: our deterministic reproduction of the PracSoft DB4 with the cost printed verbatim and the signature on it; reverses -01; hard rule 4 narrowed, 12 kept with a footer, 1 still to decide (mask recommended) | **D-2026-09-14-02 above** |
| 14 Sep | The Medicare card number and IRN are printed in full on the Signed-DB4; hard rule 1's identity meaning is unchanged; the threat model needs a section for holding it | **D-2026-09-14-03 above** |
| 14 Sep | The signing product is the first feature-flagged slice of AoB, same name, nothing removed; data completeness gates, form version warns | **D-2026-09-14-04 above** |
| 17 Sep | No patient data rests on a practice PC: the outbox keeps a payload only until it is acknowledged, then a receipt with no PII; `pending/` never expires; encrypt-then-delete because overwriting an SSD does not erase; ships disabled until piece 1 keeps the record | **D-2026-09-17-01 above** |
| 17 Sep | One version per machine at four layers; a LAN practice shares the host and not the queue, because one fixed-path port overwrites; reconciliation alarms on a printed form that never became a record; a guard rail that fails open is worse than none | **D-2026-09-17-02 above** |
| 27 Sep | The patient reads their own DB4 on the tablet with the cost on it; the Medicare number is masked there and printed in full on the form (amends -14-03 for the screen only); DocuSign-style PDF signing considered and refused | **D-2026-09-27-01 above** |
| 27 Sep | A no-PMS practice gets the `standard` profile (every surface except db4), closing PRACTICE-SURFACES section 6b; no second kiosk URL, because the discriminator is the session and not the practice | **D-2026-09-27-02 above** |
| 27 Sep | The kiosk is designed for a 10-11in tablet in landscape (~1180x820), large print: 20px body, 22px for the operative words, an 18px floor on every patient surface, 28-32px headings, 44x44 targets; 2A reads practice-left/patient-right | **D-2026-09-27-03 above** |
| 27 Sep | The details check is asked once per SESSION, not per patient-day or per agreement; and the step chip is LATCHED at arrival, because `detailsCheck` and `particularsLockedAt` both move mid-ceremony and the chip renumbered under the patient's hand | **D-2026-09-27-04 above** |
| 27 Sep | The tablet shows the LAST FOUR digits of the Medicare number, not one; "validate you are the right number" was declined as identity verification (hard rule 1) and delivered as a data-accuracy check on the form | **D-2026-09-27-05 above** |
| 27 Sep | Send to tablet refuses a DB4 Print Record we cannot reproduce - six checks, every failure reported at once, naming the form reference, the queue and AOBPRINTER's `sourceSha256`; a card number with no IRN is refused; there is no file path and never was | **D-2026-09-27-06 above** |
| 27 Sep | Each DB4 page's Continue waits for the affirmations on THAT page; a second gate, never a replacement for the signature gate that spans the document | **D-2026-09-27-07 above** |
| 28 Sep | Write-back on the print channel is a COLLECTION: the platform publishes what is signed, AOBPRINTER files `<chart>/<reference>.pdf` plus its manifest into the PMS import folder, and the desktop's hash-checked confirmation is what sets `writtenBackAt`. One meaning, one vault event, `pms: 'import_folder'` | **D-2026-09-28-02 above** |
| 28 Sep | Which key names a patient's document folder is a per-practice answer (`documentFolderKey`), null until somebody asks; null publishes nothing and files nothing, so forgetting to ask means write-back does not start rather than starting wrong | **D-2026-09-28-03 above** |
| 28 Sep | AOBPRINTER keeps its state in SQLite (`node:sqlite`, built into Node.js) instead of the folder outbox, and ships its own pinned Node.js; D-2026-09-17-01's no-PII rule unchanged; the platform never reads the database | **D-2026-09-28-04 above** |
| 29 Sep | D-2026-09-28-04 amended: SQLite kept over "the platform is the queue" for ease of building screens, behind a storage interface so a full SQL database can replace it; one AOBPRINTER per practice (LAN mode), database on the host's own disk, a network-path data folder refused at start-up | **D-2026-09-28-04 above** |
| 29 Sep | AOBPRINTER audit trail: one row per form with a stage (out: received/queued/sent + two exceptions; back: received/filed/confirmed + two exceptions), every stage change writing its event in the same transaction, the event log append-only by database trigger and hash-chained; locations encrypted (rule §6); rows no longer deleted, only their payloads | **D-2026-09-29-01 above** |
| 29 Sep | The AOBPRINTER encryption key always exists, not only with retention on; reverses the "retention off never touches DPAPI" guarantee; key-management wiring flagged for human review | **D-2026-09-29-02 above** |
| 29 Sep | Captured PDFs archived encrypted for `retention.archiveDays` (default 7, 1-30), overriding D-2026-09-17-01's 24-hour cap for that one thing; archive and destruction are audit events | **D-2026-09-29-03 above** |

---

## D-2026-10-10-01 - An agreement left unsigned at midnight: the tablet says so, and the post-service chase is switched on

**Date:** 10 October 2026. **Decided by:** Carl, choosing from four options
Claude set out after Carl asked what happens to an agreement that is not signed
by midnight, when it drops off the practice tablet's list. Carl picked options 1
and 4 to build now, and 2 and 3 for the to-do list.

**What was true before.** Nothing happens to the agreement at midnight. The
tablet's list (`readPushableRows`) shows only today's rows, so an unsigned
agreement simply stops being shown and stays unsigned indefinitely. What
happens next depends on the case:

- **Linked to a service record:** it is banded on `/practice/reconciliation`
  (resend, convert to private, forgo the benefit, keep chasing).
- **A desk draft whose invoice arrived later:** orphaned, because pms-sync links
  only a `stored` agreement to a service record.
- **A no-show:** orphaned for ever.

The tablet gave no sign of any of this, which breaks `CLAUDE.md` §7c
("shortcuts to the answer").

**1. The tablet notice (build now).** The practice tablet shows "Unsigned from
earlier days: N". Each entry links to the exact place it is fixed: its
Reconciliation item when a service is linked, otherwise the draft itself. Each
entry says what the system observed, and nothing more (§7c, wow.md §13). This
changes no agreement's behaviour.

**4. The post-service chase is ON (build now).** `POST_SERVICE_CHASE_ENABLED`
is true in development, where SMS goes to the sandbox gateway
(`SMS_GATEWAY_MODE=sandbox`) and email to Mailhog (`MAIL_SANDBOX_SMTP_HOST`), so
nothing reaches a real patient. **Production stays off until Carl says it is
live**, because it sends real messages, which costs money and needs a
registered sender. The code default stays `false`, so a deployment that omits
the variable sends nothing.

**2 and 3 are deferred to `TODO.md`:**

- **2:** link an unsigned draft to the service record for the same patient,
  provider and day.
- **3:** close a draft with no service after N days, with a vault event.

Both change how agreements behave.

**What would reopen it:** Carl declaring the chase live (this then becomes a
production configuration change, with a registered sender); or option 2 or 3
being built, which removes most of the orphans the tablet notice now lists.

---

## D-2026-10-10-02 - The AOBPRINTER heartbeat and its console: fifteen decisions

**Date:** 10 October 2026. **Decided by:** Carl, *"All good"*, accepting all
fifteen of the defaults that Claude's planner set out. Before that, he made
three choices of his own:
- re-baselining is a platform operator's act only (decision 7);
- the `x-practice-id` transport is accepted until mTLS lands (decision 12);
- one full-suite run at the end, not one per shared-module step.

**The fifteen are in `PRINTER-HEARTBEAT.md`, with a reason for each.** That file
also holds the plan they belong to. In brief:
- a 60-second heartbeat carrying stage counts, versions and the audit chain head, with no PII;
- stale after 3 missed beats, offline after 15 minutes, and an ALERT log on silence;
- a regression is one vault event on the transition, plus a console flag that stays until a platform operator re-baselines;
- the chain head is anchored in the vault at most hourly;
- a new chain for a practice that already has one is the regression `chain_replaced`;
- "processed by AoB" is recorded as host audit events, with no SQLite schema bump;
- the heartbeat is on by default when a practice upgrades.

**What would reopen it:** mTLS landing (decision 12 then closes); a practice
running two hosts on purpose (decision 6); or the vault's anchoring cost making
hourly too often (decision 5).

**Amended the same day (Carl, two answers).** The build found that decisions 4
and 6 clash: the platform cannot tell a log rewritten on the same host from a
second host started beside it.
- **A new chain beside an existing one is always `chain_replaced`**, with its
  vault event. If both chains keep reporting, the two-hosts notice appears as
  well. A rewrite must never pass as a second host.
- **A restart keeps the previous chain status (rule 6).** It does not reset to
  `unverified`.

**Third amendment, 10 October 2026 (Claude, implementing decision 6 after the
build found a gap; Carl to confirm).** A review found that re-baselining could
leave a practice with every chain retired, after which decision 6 stopped
applying: accept one replacement (the old chain and the second replacement
are retired), then re-baseline the second replacement, and the accepted chain
was retired in turn. Four rules close it:
- **Re-baselining a replacement retires the old chains.** Re-baselining a
  `chain_replaced` row retires every other chain still counted, in the same
  transaction, and the vault event carries `retiredChains` (as decision 7
  already said). A retired chain that has reported since is stamped afresh.
- **The accepted row is un-retired.** Re-baselining a row clears that row's
  own `retiredAt` / `retiredBy`, so the chain the operator accepts is never
  left retired.
- **A retired row cannot be re-baselined.** `409` with the reason code
  `aobprinter_chain_retired`. The web twin does not offer it.
- **A retired chain that reports again counts.** It is a host still running.
  "Retired" everywhere means the stamp *unless* the chain has reported after
  it (`effectiveRetiredAt` in `aobprinter-hosts.service.ts`): rule 1, the
  two-hosts notice, the silence sweep, the console row and re-baselining all
  read that one predicate, and it matches `core.aobprinter_hosts_overview()`.

Enforced by the e2e tests
`accepting_one_replacement_then_rebaselining_another_cannot_retire_every_chain`,
`a_retired_chain_that_reports_again_counts_for_rule_1`,
`rebaselining_a_retired_chain_that_reports_again_clears_its_own_retirement`
and `the_silence_sweep_says_nothing_of_a_retired_chain`.
**What would reopen it:** Carl preferring that a retired chain stays retired
even when it reports again (it would then need its own console state, since
it would be neither the practice's chain nor a second host).

---

## D-2026-10-10-04 - The product builds, tests and runs on Node.js 24 LTS

**Date:** 10 October 2026. **Decided by:** Carl, *"do it - move everything to
Node 24"*, after Claude found that the product still ran on Node 20.
**Built on:** branch `chore/node-24`, based on `main`. `main` does not yet hold
this file, so the record lives here with the others.

**Why.** Node 20 reached end of life on 30 April 2026 and gets no security
fixes. The four service images (core, rules, vault, web) and CI were still
built and tested on it. CI also could not run AOBPRINTER's tests, because
`node:sqlite` needs 22.5 or later (D-2026-09-28-04). Node 24 is the current LTS
line, supported until April 2028. It is what the development machine runs and
what AOBPRINTER ships with, so one version covers every place the code runs.

**What changed:**
- the four Dockerfiles: `node:24-alpine`;
- `.github/workflows/ci.yml`: `node-version: 24`;
- the root `engines` floor: `>=24.0.0`;
- `@types/node`: `^24.19.0` in every workspace.

**Why not 26.** Node 26 becomes LTS around the end of October 2026. Moving to
a release line in its first weeks of LTS, months before a GA with statutory
exposure, is a risk with nothing to show for it. Revisit after GA.

**What would reopen it:** a Node 24 security end-of-life notice, or a
dependency that needs 26.


---

## D-2026-10-10-05 - The kiosk tablet is locked with Android screen pinning, not a lockdown launcher

**Date:** 10 October 2026. **Decided by:** Carl, *"Pinning - do it"*, after
asking whether screen pinning was the better option than an app-like full
screen.

**Decision.** The kiosk's "locked-down launcher, no OS escape" requirement is
met by **Android screen pinning**, a setting built into Android. The setup and
daily steps are in `apps/web/app/kiosk/README.md` ("Locking the tablet to the
kiosk") and `PRACTICE-ONBOARDING.md` (§6). No code changes.

**Why.** Pinning installs nothing, so the zero-footprint kiosk rule (Carl,
3 Sep 2026) still holds. It stops a patient reaching the home screen,
notifications or another app, and unpinning needs the tablet's PIN. An
app-like full screen only hides the browser bars, and a swipe brings them back.
An installed web app (PWA) would need HTTPS in the practice and puts something
on the device, so it would reopen the zero-footprint decision.

**Known limit, accepted.** Pinning locks the tablet to the browser app, not to
the kiosk page. A patient can still open a tab or type an address, and the
kiosk's auto-reset does not run on a page that is not the kiosk.

**Amended the same day: full screen is built, and pinning is optional.**
Carl, on learning that pinning is done by hand on each tablet: *"in that case
write code to make the app full screen. We cannot have dependency on the
tablet"*. The kiosk now asks for full screen on the patient's first tap
(branch `feat/kiosk-fullscreen`). Recorded with it, so nobody reads more into
it than it gives:
- **A tap is needed to start.** Browsers refuse full screen without a user
  gesture, so it cannot happen when the page loads.
- **The patient can always leave it.** A system swipe brings back Android's
  bars, and no web page can prevent that. The next tap goes full screen again.
- **No web page can turn on pinning.** Android lets only an installed app or
  device management start a lock. Automatic lockdown therefore needs something
  installed on the tablet, which would reopen the zero-footprint decision
  (Carl, 3 Sep 2026). Not decided; Carl was told the options.

Pinning stays documented as optional extra lockdown for a practice that wants
it.

**What would reopen it:** patients leaving the kiosk page inside the browser in
real use, or a practice that needs the tablet locked to one page. The next step
would be a managed kiosk mode such as Samsung Knox, a device-management product
that needs its own decision against the zero-footprint rule.

---

## D-2026-10-10-07 - The 14" kiosk tablet is designed portrait first; landscape still works

**Date:** 10 October 2026. **Decided by:** Carl, *"yes switch to portrait
first"*, after asking whether portrait or landscape is better for the patient
on the 14" Galaxy Tab S10.

**Decision.** For the 14" tablet, the kiosk is designed for **portrait first**:
one readable column, the DB4 text at the top, the tick boxes and Back/Continue
always in view below it, and a full-width signature pad. Landscape must still
work well, with the two-column layout. The orientation is never locked (WCAG
1.3.4): a patient with the tablet on their lap may turn it either way.

**Why.** It is not more screen; the area is the same. But the content is a
form, and the DB4 is an A4 portrait page: in portrait more of each page shows
at once, and lines stay a readable length without columns. A 14" tablet handed
to a patient is held like a clipboard. The signature pad is wider in portrait
(about 850px) than it was in landscape, and the on-screen keyboard takes a
smaller share of the screen.

**What it supersedes.** The 27 Sep premise that the kiosk is designed for a
10-11in tablet in landscape (~1180x820), for the 14" device only. The type
scale, 44px targets and 18px floor from that decision are unchanged.

**Practice setup to note:** a 14" tablet in portrait on a desk stand is about
36 cm tall, so the stand's height and angle matter for seated and wheelchair
users (see the physical-impairment entry in TODO.md).

**Built on:** branch `fix/kiosk-tablet-fit`.

**What would reopen it:** practices choosing a 10-11in tablet, or real patients
finding portrait harder to sign on.

---

## D-2026-10-10-10 - Ticking stays as it is, no box on a kiosk page scrolls, and the tablet stays zero-footprint

**Date:** 10 October 2026. **Decided by:** Carl: *"keep ticking as is, stay
zero-footprint"* and *"Ticking before reading: Do not have boxes that
scroll."*

**1. Ticking stays as it is.** A patient may tick a page's affirmations
without scrolling through its text first. There is no scroll-to-end gating.
Each DB4 page's Continue still waits for that page's ticks (D-2026-09-27-07).

**2. No box on a kiosk page scrolls.** Every ceremony page fits whole on the
tablet screen. The DB4 text does not sit in its own scrolling box beside or
above the tick boxes. Where a page's text is too long to fit at the kiosk type
scale, it splits onto more pages, each with its own Back, Continue and ticks,
decided by `rules/db4-pages.ts` (presentation, never the instrument). The one
exception is a genuinely tiny viewport or heavy zoom (under 480px tall), where
the whole page scrolls like an ordinary web page, as WCAG 1.4.10 requires.
That is the page scrolling, not a box.

**3. The tablet stays zero-footprint** (Carl, 3 Sep 2026, confirmed). Full
screen on the first tap is the default; Android screen pinning is optional
(D-2026-10-10-05). Automatic lockdown by an installed app is recorded on the
TODO, not built.

**Amended the same day: pages are sized to the screen** (Carl: *"go with
option 1 for page sizing"*). With the scrolling box gone, even a normal
three-page DB4 overflowed at every target size, because each page repeats its
heading and form header. So the DB4 is split into blocks (heading lines,
practice and patient details, each provider, each service row, each privacy
paragraph, each statement), and the kiosk fills each page by measuring the
space on the screen:
- each section's ticks sit on that section's last page, and each page's
  Continue waits for its own ticks;
- page counts differ between portrait and landscape, and turning the tablet
  re-flows the pages, keeping the patient's place and the ticks already given;
- `rules/db4-pages.ts` still decides which blocks and ticks belong to which
  section; measuring only decides where pages break;
- where nothing can be measured, it falls back to the three fixed pages;
- on a test device, whose developer panels cannot fit, the whole page may
  scroll, never a box inside it.

Declined: fixed splits sized for the smallest screen (option 2), and freeing
height as a separate choice (option 3).

**The smallest screen the rule holds on: 1280×800** (Carl: *"1280×800 is
fine"*). At 1280×800 and larger, including every size of the 14" tablet, every
page fits whole and nothing scrolls. Below that (shorter than 800px, or
narrower than 1280px in landscape), a DB4 page that cannot fit may scroll as a
whole page, never a box inside it. The signature step fits at 1280×800 and up.
Below that it falls just short (25px at 1024×600, 52px at 960×600, with Edge's
bars showing); there the signature page scrolls as a whole and every control
stays reachable. Carl chose to accept this rather than shrink the kiosk footer:
*"go with (a) for the signature step"*. Landscape on the 14" tablet confirmed
working by Carl the same night.

**Built on:** `fix/kiosk-tablet-fit` (items 1 and 2).

**What would reopen it:** evidence that patients tick without reading in a
way that matters to a dispute (item 1); a practice whose tablets must lock
without staff action (item 3, see the TODO).
