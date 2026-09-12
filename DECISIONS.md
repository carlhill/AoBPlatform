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
`drjhuang.xlevelup`, not `drjhuang.821709fb`.

Full design: `PRACTICE-SCOPED-LOGIN.md`.

**What would reopen it.** Evidence that asking for a location every session is
answered carelessly — in which case the answer is a better moment to ask, never
a remembered default.

## Index of decisions taken 3–4 September 2026 (recorded in TODO.md at the time)

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
