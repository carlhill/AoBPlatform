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
