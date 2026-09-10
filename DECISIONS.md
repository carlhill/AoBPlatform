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
