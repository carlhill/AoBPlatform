# Pre- and post-consultation capture, correspondence visibility, retention — plan

**Status:** APPROVED 2026-08-25 by Carl — all eleven Part 6 decisions answered (three with amendments, recorded inline there). Build order in Part 7. Items 1–5 BUILT 2026-08-25 (AutoCaptureModule, InboundModule, AgreeModule + /patient/agree/[token], CorrespondenceModule; e2e green). Item 6 BUILT 2026-09-03 (RetentionModule: hourly sweep, three SECURITY DEFINER due-lists, Correspondence + artefact tombstones, `retention.expiry_scheduled` with clock source; e2e green); item 7 next.
**Written:** 2026-08-25, from Carl's brief plus claude-cowork's read of the design
docs, then checked against the code that actually exists (every claim below
names the file). **Revised the same day** for Carl's two corrections: the PMS
reaches us by printing (Part 8), and different document types need different
queues (Part 9).

Carl's brief, verbatim in substance: the practice PMS sends data elements to an
iPad/kiosk so the patient can approve entering an enduring or episodic
agreement; the PMS also sends data after the appointment; for enduring
agreements that is just an email to the patient with no approval; for episodic
the patient must approve the post-appointment details; every email recorded as
now; practice, doctor and patient can sign in and see everything sent and
received; data kept two years, as a soft setting.

---

## Part 0 — Two framing corrections, before the plan

Both come straight out of the existing design rules, and both change the shape
of what gets built. Neither is a disagreement with the goal.

### 0.1 The PMS sends to us by PRINTING. The kiosk only ever talks to us.

**Revised 2026-08-25 after Carl's correction.** The first draft of this said
"the PMS never sends anything, we pull through its API." That assumes the PMS
*lets* us — and it may not have the capability, or may charge the practice for
it, or its licence may forbid it. Carl's answer: the one thing every PMS can
do is **print**. An **AoBPrinterApp** installed on the desktop is a virtual
printer. When the PMS prints an appointment list or an invoice to it, that
print job *is* the PMS's outbound API to AoBPlatform — and the app sits
outside the PMS entirely, so there is no API to license and no vendor to ask.
Part 8 is the design.

What does NOT change: REQ-INT-01 and REQ-DATA-10 still make the PMS the system
of record for *who the patient is and what happened*, and us the system of
record for *what they consented to*. And the adapter contract
(`packages/contracts/src/pms-adapter.ts`) is still the seam — print capture is
simply another `PmsAdapter` implementation behind the same interface, so
nothing else in this plan had to be redesigned. The kiosk gets its data from
AoBPlatform, never from the PMS; "the PMS sends data to the kiosk" means "the
PMS printed, we received, the kiosk reads what we hold."

One honest limit, developed in 8.6: printing can't write *into* a PMS, and
REQ-INT-02 says write-back is the product. The same desktop app closes that
loop from the other side.

### 0.2 "Just an email" for enduring is "just a notice, by the method the patient chose"

For an enduring agreement, the thing that goes to the patient after a
consultation is the reg 89AA notice, and the code already enforces two rules
about it that Carl's phrasing skips:

- **REQ-DEL-02, method fidelity** (`packages/domain/src/notice.ts:54`,
  `EnduringDetail.notificationMethod` — `sms | email | post | portal`): the
  notice goes by the method *named in the agreement*. Sending by email when the
  patient chose SMS breaches 89AA even if it arrives. So it is an email only
  for patients who chose email.
- **REQ-END-05**: notices are **MyMedicare-pathway only**. Aged-care and
  ACCHO/AMS enduring agreements get *no* notice, by regulation, and
  `NoticesService.recordClaim` records that suppression as a decision rather
  than a silence.

Also: the 24-hour clock starts at **claim lodgement**, not the consultation or
the invoice (`Notice.claimLodgedAt`). Where the adapter cannot observe claims,
the practice asserts lodgement or the clock defaults conservatively
(REQ-INT-04) — this is already modelled on `ServiceRecord.retentionClockSource`.

Everything below assumes both corrections.

---

## Part 1 — What already exists (so we build the gaps, not the system)

More of this is built than the brief assumes. Backend first:

| Piece | Where | State |
|---|---|---|
| Four agreement types incl. `episodic_pre` (D6a description) / `episodic_post` (D6b items) / `enduring`; D1–D7 particulars locked before signature (HARD-05) | `packages/domain/src/agreement.ts`, `agreements.service.ts` (`createDraft → lockParticulars → sign → transition`) | **Built** |
| Capture cascade: `CaptureRequest` with channels `in_practice \| sms_link \| email_link \| paper`; single-use, non-enumerable, hashed remote tokens (REQ-VER-05); `@Public` link open + verify; one-open-request-per-channel (FR-2.7); expiry sweep | `capture/capture.service.ts`, `capture-token.ts`, `capture.controller.ts` | **Built** |
| Verification (staff-verified in-practice, three identifiers) and `SignatureEvent` (`drawn \| tap_to_approve \| typed_name \| wet_ink_scan \| verbal_recorded`) binding artefact hash + versions | schema `verification_events`, `signature_events` | **Built** |
| Enduring coverage query (FR-5.5): "is this patient already covered for this provider" | `EnduringService.coverage()` | **Built** |
| PMS invoice pull → `ServiceRecord`, linking a stored agreement by practitioner × patient | `pms/pms-sync.service.ts` | **Built** (see gap 2) |
| Reconciliation queue (M7): services without a stored agreement, banded by days left on the 12-month window; chase ladder ai/human | `reconciliation/`, `packages/domain/src/chase.ts` | **Built** |
| 89AA notice: compose on claim, method fidelity, 5 delivery states, correction, never chased | `notices/notices.service.ts` | **Built** |
| Write-back of the signed artefact to the PMS, with retry sweep | `pms/write-back.service.ts` | **Built** against the mock adapter. The print channel (Part 8) can't do it directly — 8.6 is the import-folder answer |
| Retention as a *rule*: 2 years from claim (REQ-REG-09), "parameterised, never hardcoded"; `retentionExpiryDate` + `legalHold` on Agreement; lifecycle state `retention_expiry_scheduled`; content tombstone with `retention.crypto_shredded` vault event | `agreement.ts:142`, `lifecycle.ts`, `artefacts.service.ts:tombstone` | **Rule exists, mechanism does not** (see gap 5) |
| Patient "sign in": REQ-PORT-08 — a patient signs from a single-use link and **must never need an account** | `auth.guard.ts:37`, `public.decorator.ts` | **Decided**, and it decides Part 4 |

And the gaps, which are exactly the work:

1. **Nothing consumes `readAppointments`.** The adapter exposes it; no service
   calls it. There is no appointment-driven pre-agreement trigger.
2. **An invoice with no agreement goes to the queue and stops.**
   `ReconciliationService.resend` refuses with *"No agreement exists for this
   service yet — create one (choosing the assignor) before sending a capture
   link"* (`reconciliation.service.ts:107`). Nothing auto-creates the
   `episodic_post` draft. The refusal is there for a real reason — D7, the
   assignor, is a human choice — which constrains how far this can be
   automated (Part 3).
3. **No containment check**, and no data to do it with. `basicServiceDescription`
   is a free-text field on the DTO; `mappingVersion` is recorded but there is
   **no MBS item → basic-service-description mapping anywhere in the repo**. The
   "billed item falls outside the pre-agreement's description" test that
   cowork identified cannot be built until that mapping exists.
4. **No kiosk, and no patient-facing capture UI at all.** `apps/web/app/` has
   `apply/ practice/ practitioner/ platform/ review/ status/ verify/` — nothing
   for signing. The backend capture endpoints exist; the screens do not.
5. **No retention sweep, and no home for the parameter.** No `Setting`/config
   model, no `RETENTION_*` env, no scheduled job touches `retentionExpiryDate`.
6. **"What was sent" is read from the disposable store.** `/practitioner/messages`
   reads the `practitioner_message_detail` view over `outbound_items`, which
   `pruneSent` deletes after 30 days (`outbound.service.ts:923` — "SAFE ONLY
   BECAUSE THIS IS NOT THE EVIDENCE STORE"). A two-year visible history cannot
   come from there. TODO.md ("What was sent to me") already says so.

---

## Part 2 — Pre-consultation: the kiosk

### 2.1 The trigger (gap 1)

Two documents feed it, and they arrive on different lanes (Part 9):

- **The morning appointment list**, printed once by reception. One print job,
  the whole day's appointments. This does the real work: it **pre-stages** a
  draft and an `in_practice` capture request for every booked patient *hours
  before they arrive*. Bulk, not urgent — the `standard` lane.
- **The arrival slip** for one patient, printed at check-in. This is the
  fallback for walk-ins, same-day bookings and anyone the morning list missed
  — and it is the one that must reach the kiosk in seconds, because the
  patient is standing at the desk. The `critical` lane.

Both land as adapter data (8.3), so from here on a new `AppointmentSyncService`
in `pms/` — mirroring `PmsSyncService` in shape — consumes
`readAppointments(today)`: on an interval for the bulk list (the
`@Interval` / `@Cron` pattern every other sweep here uses), and immediately on
arrival for a critical-lane job. Plus a manual `POST /pms/sync-appointments`
like `/pms/sync` for the console button. For each appointment, in order:

1. Mirror patient/provider rows by linkage key if absent — same code path as
   the invoice sync, extract and share it rather than copy it.
2. **Coverage first** (`EnduringService.coverage(patientId, providerId)`). If
   covered by a live enduring agreement: **do nothing.** Record the decision as
   a vault event (`capture.suppressed`, reason `enduring_covered`), because a
   silence and a decision look identical in a table.
3. Rail already captured it (Tyro/HICAPS)? — **not buildable yet**, no rail
   adapter exists. Named here so it is a known absence, not a forgotten one.
4. Otherwise create a draft `episodic_pre` — D5 = appointment date, D6a =
   description (see 2.4), `assignorIsPatient: true` by default (see 3.2 for
   why that default is safe *here* and not always) — and open a
   `CaptureRequest` on channel `in_practice`. Idempotent on
   `pmsAppointmentKey`: the sync runs repeatedly, one appointment must never
   open two requests (FR-2.7 already refuses a duplicate per channel; key the
   draft on the appointment too).

### 2.2 The kiosk screen (gap 4)

A new route group `apps/web/app/kiosk/` — practice-scoped, tablet-sized,
nothing else on screen. Flow, all against endpoints that exist:

1. **Today's list** — open `in_practice` capture requests for this practice,
   by appointment time. Staff taps the arriving patient.
2. **Verify** — staff confirms three identifiers against the PMS-held values
   (the `VerificationEvent` path; ADR A-08 says match at challenge time, which
   `readPatient` by linkage key gives us).
3. **Render** — the pre-agreement with particulars locked
   (`lockParticulars`), bilingual per REQ-LANG-02, rendered artefact hash
   written before the signature control enables (REQ-VAULT-02 / HARD-05).
4. **Sign on glass** — `SignatureEvent.method = 'drawn'` (or `tap_to_approve`
   if we decide a tap is enough — that is a REQ-SIG decision, not a UI one).
5. **Stored → written back** — `writeArtefact` via the existing write-back
   sweep. Kiosk shows "done", clears, returns to the list. Target under 45
   seconds (solution design §4.4).

Every screen shows an `EmailStatusChip`-style state where anything is pending,
and registers with the top-bar refresh registry — CONVENTIONS.md §9d and
`refresh.ts` apply here as everywhere.

**Kiosk trust — a decision (Part 6, Q3).** How does an iPad become a
practice-scoped client? Simplest honest shape: a practice staff member signs
in on the device with their passkey, exactly as they would on a laptop — the
existing Keycloak `web` client, no new auth surface. The kiosk is then "a staff
session in a big-buttons layout", every verification is attributed to that
staff member (`verifiedByStaffId` already exists for this), and a session
expiring is a feature. A dedicated long-lived device credential is the
alternative and is a new concept with its own revocation story; I would not
build it first.

### 2.3 Enduring at the kiosk

Offered, not defaulted. Enduring needs GP-only, a pathway, an `EnduringDetail`
(notification method, termination method, scope, patient declaration where the
assignor is not the patient — REQ-END-02), and the scope preview. That is a
staff-led conversation, not a 45-second tap. The kiosk gets a "set up an
enduring agreement instead" path that walks the existing
`EnduringService.create` inputs; episodic_pre is the fast default.

### 2.4 D6a — the description (gap 3, partially)

The pre-agreement needs a Basic Service Description from the current mapping
version, and no mapping exists. Until it does: the description is chosen by
staff from a short practice-maintained list (a new small table, versioned), and
`mappingVersion` records that list's version. Honest, auditable, and it does
not pretend to be the MBS mapping. Sourcing the real quarterly mapping is its
own piece of work (Part 6, Q2).

### 2.5 Fallback

Patient not at the desk (telehealth, home visit): open `sms_link` /
`email_link` instead of `in_practice` — the remote capture path exists end to
end, including the public link + verify endpoints. Nothing new.

---

## Part 3 — Post-consultation

### 3.1 The trigger extends the invoice sync (gap 2)

`PmsSyncService.syncInvoices` already creates the `ServiceRecord` and links a
stored agreement where one matches. Extend the "no agreement linked" branch:

- **Covered by enduring** → nothing to capture. The 89AA notice is a *claim*
  event (`NoticesService.recordClaim`), not an invoice event; where the
  adapter has `claimEvents` it fires from those, otherwise from practice-
  asserted lodgement. Do not wire the notice to the invoice — that would put
  the 24-hour clock in the wrong place.
- **No agreement at all** → create draft `episodic_post` — D5 = invoice
  service date, D6b = `mbsItemNumbers` — and open a remote capture
  (`email_link` if `patient.email`, else `sms_link`), subject to REQ-CHASE-03
  (confidentiality flag suppresses ALL outbound — already enforced in
  `resend`, reuse that check) and REQ-CHASE-08 (never past the window).
- **Pre-agreement exists** → today, that counts as covered
  (practitioner × patient × day). The containment check ("is the billed item
  inside the description") is **deferred until the mapping exists** — stated
  in code as a deferral with the REQ reference, not left as an implicit
  equality.

### 3.2 The assignor rule — why `resend` refuses today, and what we may automate

D7 says `assignorIsPatient` is explicit, never inferred, and the assignor may
be a parent, guardian, EPOA. `resend` refuses to open a link on a record with no
agreement because *somebody has to choose who is signing*. Automation is safe
only where the answer is not a choice:

- Patient is 14 or older (DOB known from the PMS mirror; `MIN_AGE_SELF_ASSIGN`,
  REQ-AGE-02 — the Australian self-assign age) → default
  `assignorIsPatient: true`, auto-create, auto-send.
- Patient is under 14, or DOB unknown → **no auto-create.** It lands in the
  reconciliation queue exactly as today, for a human to choose the assignor.

Same rule for the pre-agreement in 2.1 step 4.

### 3.3 The patient approves — from a link, never an account

REQ-PORT-08 settles the "patient auth" question TODO.md left open: the patient
opens the single-use link, passes the verification challenge (floor 3,
REQ-VER-06), sees the locked post-agreement — practitioner, date, item
numbers, **no dollar amount** (Rule 4) — and approves with `tap_to_approve`.
That is `openLink` → `verifyLink` → `sign` → `complete`, which exist. New here
is only the patient-facing screen (a public `apps/web/app/patient/agree/[token]/`
route, styled like `/verify` and the confirm-email pages — the pattern Carl
has already approved twice this week).

### 3.4 Unanswered → the existing ladder

Not approved by the time the band says so → it is already in
`ReconciliationService.outstanding()`, banded, with the chase policy from
`chase.ts`. Nothing to build; the auto-created draft simply makes `resend`
work without the manual "create one first" step.

---

## Part 4 — Correspondence: what was sent, visible to practice, doctor, patient

### 4.1 The store (gap 6) — the one real design decision in this part

Two stores exist and neither fits: `outbound_items` is transport and is
deleted at 30 days; `Notice` is durable but is *specifically* the 89AA notice
(`claimReference`, `benefitAmountCents`, the 24-hour clock). The
pending-email confirmations, the acting-as notices, the invitation, the new
pre/post capture links — none of them is a `Notice`, and all of them are what
Carl wants visible for two years.

Proposal: a durable **`Correspondence`** record, written in the same
transaction as every `outbound.enqueue` and every `NoticesService.dispatch` —
the *evidence* twin of the transport row:

```
correspondence
  id, practiceId (nullable, same CHECK as outbound_items — a practitioner's
                  personal message has no practice), recipientType
                  (practice | practitioner | patient | assignor),
  recipientRef (practitionerId / patientId / assignorId — never the address
                alone, so a changed address does not orphan history),
  to, channel, subject, bodyText, bodyHtml,
  subjectType / subjectId (Agreement, PendingEmailChange, ActingAsSession …),
  sentAt, deliveredAt?, failedAt?, failureReason?,
  retentionExpiryDate, legalHold, contentRemovedAt   ← Part 5
```

RLS as everywhere; the `practitioner_own_messages`-style policy widened to
`recipientType`. **Not** a rewrite of `Notice` — the 89AA notice keeps its
statutory shape and *also* writes a `Correspondence` row, so one screen can
show everything.

Then `/practitioner/messages` and `/practice/queue`'s "what was sent" reading
move from the `outbound_items` view to this table. The queue screen stays on
`outbound_items` for its actual job — "did it leave, is it stuck".

### 4.2 Who sees what

- **Practice** — its own correspondence, practice-scoped. Straightforward.
- **Doctor** — their own personal messages plus, for each practice they are
  affiliated with, correspondence about *them* (their invitation, their
  agreements' capture links). Spanning practices is a deliberate cross-tenant
  read, individually justified per CONVENTIONS.md §6 — `ActingAsService.list()`
  and the review-queue work in QUEUE-TRIAGE.md §1 are the precedents.
- **Patient** — from a link, never an account (REQ-PORT-08). Each agreement's
  approval page carries a "everything we have sent you about this" view,
  token-scoped to that patient. A carer seeing a patient's history is an
  *authority* question (who may act for whom) that TODO.md already flags as
  needing a record before it can be a feature — **out of scope here**.

### 4.3 "Received"

AoBPlatform has no inbound email. Nothing is "received" as mail. What we do
receive is the patient's *answers* — an approval, a stop, a verification
attempt — and those are already events (`SignatureEvent`, `pending_email_changes.outcome`,
vault events). The correspondence screen shows them inline as the reply to the
message that asked. Building inbound mail ingestion would be a new system and
is not proposed.

---

## Part 5 — Retention: two years, soft

Already the rule, and already phrased the way Carl wants it: *"Retention runs
2 years from the related claim (REQ-REG-09, REQ-INT-04) — parameterised, never
hardcoded"* (`agreement.ts:142`). What is missing is the mechanism.

- **The parameter.** No settings model exists. Start where every other
  platform value lives: `ConfigService` — `RETENTION_YEARS`, default `2`,
  read through one domain function (`retentionExpiryFor(anchorDate)`), never
  inlined. A per-practice override is a later, separate decision; the
  function's signature should leave room for it (`practiceId?`).
- **"Soft" means three things this codebase already believes:**
  1. Configurable, not compiled in.
  2. **Content is removed, the row survives.** `artefacts.service.ts:tombstone`
     is the precedent — bytes gone, hash and provenance kept, vault event
     `retention.crypto_shredded`. Same for `Correspondence.bodyText/bodyHtml`
     and the agreement artefact. History says *that* a message was sent and
     what it was about; the text itself is gone.
  3. **`legalHold` wins**, always — already on Agreement and Artefact, added to
     Correspondence.
- **The sweep.** Hourly `@Cron`, like `affiliation-sweep.service.ts`. Two
  passes: move due agreements to `retention_expiry_scheduled` (the lifecycle
  state exists and is terminal), then tombstone content for anything past
  expiry and not on hold. Every removal a vault event. Anchored on the
  claim/service date via `retentionClockSource` — where the clock was
  defaulted conservatively (REQ-INT-04), it says so in the event.

---

## Part 6 — Decisions needed before code (Carl)

All answered by Carl, 2026-08-25. Amendments in **bold**.

1. **YES** — the two framing corrections in Part 0 stand.
2. **YES, deferred to TODO.md** — the MBS basic-service-description mapping
   (source quarterly, or the practice-maintained interim list in 2.4) is
   recorded there as an open item; the containment check waits on it. **Plus,
   Carl's addition: the practice needs reminding to keep doing its part** —
   pressing Print each morning and on each invoice (8.6 limit 2), and
   maintaining the interim description list. Also in TODO.md.
3. **YES** — kiosk trust is a staff passkey session on the device. No new
   device credential for the kiosk.
4. **BOTH** — drawn *and* tap-to-approve are acceptable signature methods on
   the kiosk; either suffices. The kiosk offers both; `SignatureEvent.method`
   already carries which was used.
5. **YES** — the `Correspondence` store as shaped in 4.1, and the 89AA `Notice`
   writes to it as well as keeping its own table.
6. **YES, corrected by Carl: the threshold is 14, not 18.** A patient may
   self-assign from 14 in Australia (REQ-AGE-02; `MIN_AGE_SELF_ASSIGN` in
   `packages/domain/src/guards.ts` already says 14). So: patient 14+ ⇒ the
   patient is the assignor, auto-created; under 14 or DOB unknown ⇒ a human
   chooses. The code uses the domain constant, never a literal.
7. **YES** — `RETENTION_YEARS` platform-wide now, per-practice later.
8. **YES** — parse on the desktop, ship fields only. **Carl's note: parser
   templates will need to be PMS-specific** — which 8.2 already assumes
   (a template per PMS per document type, versioned); recorded here so it is
   a requirement rather than an implementation detail.
9. **YES, BOTH** — device enrolment with an asymmetric per-device key is the
   default, **and a shared practice key must also be supported**: a large
   practice or a hospital with many desktops may prefer one credential
   managed by its IT rather than enrolling each machine. The practice chooses
   per practice; every payload records which model authenticated it, so
   attribution is never ambiguous about *what kind* of credential it rests on.
10. **YES** — the lane table in 9.2 and its SLOs, including that the 89AA
    notice's lane is slower but bounded by its 24-hour clock.
11. **YES** — import-folder write-back is an acceptable interim answer to
    REQ-INT-02.

## Part 7 — Build order and an honest estimate

This is not a day. It is backend triggers (small), a durable store plus screen
changes (medium), a retention sweep (small), and a greenfield kiosk plus a
patient approval page (the bulk). Against the mock adapter, with tests, in the
order that lets each step be verified alone (Carl's rule: one piece at a time):

| # | Piece | Depends on | Size |
|---|---|---|---|
| 1 | Invoice sync auto-creates `episodic_post` + opens remote capture (3.1, 3.2) | Q6 | ½ day |
| 2 | `AppointmentSyncService` → coverage → draft `episodic_pre` + `in_practice` request (2.1) | Q6 | ½ day |
| 3 | Inbound queue: `inbound_print_jobs` table with lanes, per-lane workers, `202` ingest endpoint, `print_capture` adapter reading from it (8.3, 9.3) | Q8, Q10 | 1½ days |
| 4 | Patient approval page `/agree/[token]` (3.3) | 1 | 1 day |
| 5 | `Correspondence` table, written from `outbound.enqueue` + `NoticesService.dispatch`; move `/practitioner/messages` onto it (4.1) | Q5 | 1–1½ days |
| 6 | Retention: `RETENTION_YEARS`, `retentionExpiryFor()`, hourly sweep, tombstoning incl. Correspondence (Part 5) | 5, Q7 | 1 day |
| 7 | Kiosk MVP: list → verify → render → sign → done, episodic_pre only, fast poll while waiting (2.2, 9.4) | 2, 3, Q3, Q4 | 2–3 days |
| 8 | AoBPrinterApp v1: virtual printer, local parse against downloaded templates, lane-aware outbox, device enrolment (8.2, 8.4, 8.5) | 3, Q8, Q9 | 3–4 days, **a separate codebase** |
| 9 | Doctor + patient correspondence views (4.2) | 5, 4 | 1 day |
| 10 | Enduring at the kiosk (2.3) | 7 | 1 day |
| 11 | Import-folder write-back in the desktop app (8.6) | 8, Q11 | 1 day |
| — | Containment check (3.1) | Q2 | blocked |
| — | Rail suppression (2.1 step 3) | a rail adapter | blocked |

**A credible "today":** items 1 and 2. They are the two seams cowork found,
they reuse every existing service, they are testable end-to-end against the
mock adapter with the same e2e shape as `practitioner-email-change.e2e-spec.ts`,
and everything after them builds on drafts that now exist — including the
print channel, which only changes *where the appointment and invoice data
comes from*, not what happens once it arrives. Item 3 (the inbound queue) is
the natural second day, because item 8 cannot be tested without it.

---

## Part 8 — The print channel: AoBPrinterApp

### 8.1 Why it is the right baseline

Every PMS can print. No vendor cooperation, no per-practice API fee, no API
terms to accept — the practice is printing its own data to a device it chose,
and virtual printer drivers are a decades-old pattern (PDF printers, fax
drivers). It turns D-01 from "blocked on Medtech" into "solved for every PMS at
once", with a real API as an *upgrade* for practices whose PMS allows one and
who want the fidelity. Three tiers behind one adapter interface:

```
print capture  (universal baseline — day one for any practice)
   → import-folder write-back  (most PMSs — 8.6)
      → full PMS API  (where available and worth paying for)
```

### 8.2 Parse on the desktop. Ship the fields. Never ship the document.

A print job is a rendered document. Its text is extractable — print spools
carry text, this is not OCR — but the layout differs per PMS and per practice
template, and **a print job can contain things we must never hold**: Medicare
numbers, dollar amounts (Rule 4), clinical notes if somebody prints the wrong
document. So:

- The app extracts **only the s 65C fields** — patient name, DOB, provider,
  appointment date/time or invoice number and MBS items — and discards
  everything else *before anything leaves the practice*. Data minimisation by
  construction, and the strongest privacy claim this product can make.
- It sends a **SHA-256 of the source print job** with the fields, so a dispute
  can prove "this record came from exactly this document" without the
  document ever having been stored. Same idea as `renderedArtefactHash`.
- **Parser templates are data, not code.** Versioned, signed, downloaded from
  AoBPlatform. A layout fix for one PMS version ships in minutes with no
  reinstall, and every payload records `parserTemplateVersion`. The repo's
  "catalogue as data" habit (resend reasons, the check catalogue), applied
  here.
- **Low confidence → don't guess.** Send the failure signal — never the
  document — and the practice keys it in from a review task. The existing
  review-task machinery, unchanged.

### 8.3 It is just another adapter

`pms: 'print_capture'`, capabilities `readAppointments: true`,
`readInvoices: true`, `readPatient: partial` (whatever the document carried),
`writeArtefact: false`, `claimEvents: false`. The interface is pull-shaped
(`readAppointments(date)` returns a list) and print is push-shaped (a job
arrives) — reconciled by the inbound queue: jobs land in `inbound_print_jobs`,
and the adapter's `read*` methods **read from that table**. The core's
existing "degrade explicitly per missing capability" behaviour handles the
absence of `claimEvents` (conservative retention clock, REQ-INT-04) and of
`writeArtefact` (8.6) without a line of special-casing.

**Refined in item 3 (2026-08-25): the payload IS the contract.** The desktop
ships the parsed fields already shaped as `PmsPatientRecord` / `PmsProvider` /
`PmsAppointment` / `PmsInvoice` (`contracts/print-capture.ts`), and the
processor hands them straight to the same cascade the mock adapter feeds. An
adapter *object* reading from the table would have needed a per-practice
adapter registry — the interface is pull-shaped and practice-blind — for no
gain: the seam the contract exists to protect (the core never learns a
PMS-specific shape) is protected just as well by the wire format being the
contract. `readAppointments`/`readInvoices` stay for adapters that pull.

### 8.4 Queues: two tiers, not three

**No practice-server tier.** Not even for large practices. It is a server
somebody has to host, patch and monitor — the thing a small practice cannot do
and a large practice's IT will refuse as "another box" — and it adds nothing:
print jobs are independent and idempotent (keyed on `pmsInvoiceKey` /
`pmsAppointmentKey`, as the sync already is), so fifty desktops each pushing to
the cloud are already horizontally scaled with zero coordination. Egress
restrictions are a proxy setting, not a queue.

**Tier 1 — the desktop outbox.** Capture → local parse → durable local outbox
(SQLite) → background sender with retry and backoff. Survives offline, survives
reboot, tray icon shows "3 waiting." Store-and-forward: the same shape as
`outbound_items`, mirrored onto the client. **Lane-aware** (9.3): a critical
job is sent immediately and alone; a 200-row appointment list never sits in
front of one arrival slip.

**Tier 2 — the cloud ingestion queue.** Traffic is bursty by nature — every
practice prints its appointment list at eight in the morning. The ingest
endpoint is fast-accept: verify the device signature, validate the schema,
insert into `inbound_print_jobs`, return `202`. Per-lane workers process
asynchronously — dedup, mirror patient/provider rows, create the service
record or appointment, fire the Part 2/3 flows. This is
`outbound-worker.service.ts` (`@Interval`, claim/lease) inverted, in Postgres,
practice-scoped under RLS, with a `dead` state that is never pruned — exactly
the queue philosophy TODO.md already decided on, and with the same honest
caveat it records: at ~10k practices the 8am peak approaches the ~100/second
mark it names as the trigger to reconsider a broker. Partition by month; keep
the worker interface broker-shaped so that swap is configuration later.

### 8.5 Device trust — the passkey ceremony, for a machine

A payload is only as trustworthy as the knowledge of *which desktop sent it*.
REQ-PKI-01's principle — "the key is only as good as the ceremony that bound
it" — applied to a device: the console issues a one-time enrolment code; the
app enrols and generates an asymmetric key, private half in the Windows
credential store; every payload is signed; the server verifies and attributes
the job to practice **and device**. Devices are listed on the practice console
and revocable in one click. A shared practice API key would be simpler and
would make every desktop indistinguishable — the acting-as work this week is
the argument against that.

### 8.6 Two honest limits

1. **Printing cannot write back.** REQ-INT-02 says write-back is the product,
   and nothing prints *into* a PMS. The same desktop app closes the loop from
   the other side: it drops the signed PDF/A into the PMS's document-import
   folder (Best Practice's incoming documents, Medical Director's holding
   file — most PMSs have one). Still outside the PMS's API, still legally
   clean, semi-automatic: a person in the practice files it. The app becomes
   symmetric — print-capture in, import-folder out — and `WriteBackService`
   gets a second implementation behind the same `writeArtefact` call.
2. **A human has to press Print.** Where the PMS supports auto-print rules
   ("print invoice on finalise" — many do), use them. Where not, the
   reconciliation queue already catches "a service with no agreement", and a
   daily "appointments seen, no invoices arrived" check nudges the practice.
   Design for the missed print; do not pretend it will not happen.

Not a lawyer's view, but worth saying once: a print driver is clearly outside
any PMS *API* terms, and a few vendor licences carry "automated extraction"
clauses. Read the licence for the first two or three PMSs targeted.

---

## Part 9 — Priority lanes: not every document is equally urgent

### 9.1 Why one queue is wrong

Carl's rule, and it is the right one: **a new agreement the patient must
approve is critical.** It has to be on the tablet *while the patient is
talking to the person at the front desk*. The post-consultation approval is
equally critical for a blunter reason — without it the practice does not get
paid, and the twelve-month lodgement window is running. The 89AA notice on an
enduring agreement is FYI to the patient; the same speed is fine, slower is
acceptable.

A single FIFO queue makes the critical case wait behind the bulk one: the
morning appointment list — hundreds of rows, not urgent, printed by every
practice at once — would sit in front of the one arrival slip for the patient
at the desk. Head-of-line blocking is the failure, and it is the *ordinary*
morning, not a spike. So: lanes, with **separate workers per lane**, so
starvation is impossible by construction rather than by tuning.

### 9.2 The lane table

Declared as data in `packages/domain` — like `REVIEW_TASK_KINDS` declares
stakes — so no document type is urgent by accident, and a new type must say
which lane it is on. Proposed:

| Document / message | Lane | Why | SLO |
|---|---|---|---|
| Arrival slip → pre-agreement on the kiosk (2.1) | **critical** | patient at the desk | p95 < 5 s desk-to-kiosk |
| Invoice → post-agreement approval link (3.1) | **critical** | no approval, no payment; 12-month clock | p95 < 60 s to dispatch |
| Patient approval **response** (3.3) | **critical** | somebody is waiting on the screen | p95 < 5 s |
| Morning appointment list (2.1) | standard | pre-staging, needed in hours not seconds | done before the first appointment |
| 89AA notice on an enduring claim (0.2) | **fyi** | FYI to the patient — **but a 24-hour regulatory clock** (`Notice.claimLodgedAt`); slower, never unbounded | dispatched with hours of margin inside the window |
| Correspondence / history writes (4.1) | fyi | evidence, nobody waiting | minutes |

"FYI" is a speed, not a licence to drop: the fyi lane has its own SLO, its own
dead-letter state, and the 89AA row in particular inherits the deadline
machinery `NoticesService` already has (`noticeDeadline`, `escalationLevel`).

### 9.3 How the lanes are built

- **One table, a `lane` column, a partial index per lane**, and **one worker
  pool per lane** whose claim query names its lane and nothing else. The
  critical worker can never be busy with a bulk job; the bulk worker can never
  block a critical one. Claim with `FOR UPDATE SKIP LOCKED`, oldest-first
  within the lane — the pattern `outbound-worker` already uses.
- **Critical lane wakes on `LISTEN/NOTIFY`**, not a 15-second poll: an insert
  fires a notification, the worker wakes in milliseconds. Native Postgres,
  no broker, and it is the difference between "under 5 seconds" being a
  design and being luck. Standard and fyi lanes poll on the existing
  `@Interval` cadence. **As built in item 3 (2026-08-25):** the critical
  worker polls every second (`LANE_POLICIES.critical.pollMs`), which keeps the
  worker hop inside the SLO; `LISTEN/NOTIFY` needs a raw `pg` connection,
  a dependency the codebase does not carry, and adding one is a deliberate
  change rather than a side effect of this item. The upgrade is one class.
- **Under load, lower lanes yield.** If the critical lane has a backlog, the
  standard/fyi workers pause. Priority means preemption, or it is only
  ordering.
- **Per-lane metrics** into the REQ-MON-01 families: depth, age of oldest,
  p95 latency, dead count. An SLO nobody measures is a wish.
- The **desktop outbox** (8.4) honours the same lane table: critical jobs are
  sent immediately and individually; standard jobs may batch.
- The same classification **extends to outbound dispatch**. Today
  `outbound_items` has no priority at all (checked — no such column or concept
  anywhere in `outbound/`). The approval-link email is critical and the 89AA
  notice is fyi; that is the same lane column on the outbound side, as a
  follow-on once the inbound lanes exist.

### 9.4 The kiosk's side of "real time"

Two things make the desk experience fast, and the lane is only the second:

1. **Pre-staging does most of the work.** The morning appointment list puts
   every booked patient's draft on the kiosk hours early. At check-in the
   kiosk already *has* it; nothing traverses the queue in real time at all.
   The critical lane is for the exceptions — walk-ins, late bookings — not the
   rule.
2. **The kiosk polls fast, but only while waiting.** `useLiveRefresh.tsx`
   argues for polling over push, and its reasoning is right for the screens it
   was written for — "the event arrives minutes or hours later, a handful of
   times a week." The kiosk is the case where those conditions fail: seconds,
   many times a day, a person standing there. The consistent answer is still a
   poll — the same hook, with a 1–2 second interval **only while an arrival is
   expected** and the tab is visible — because, as that file says, polling
   fails visibly and a dead socket fails silently. If measured desk-to-kiosk
   latency does not meet the SLO, SSE is the upgrade, and it is a change to
   one hook.

## Out of scope, named so it is not forgotten

- D-01 (Medtech write-back via API) stays unresolved and stops mattering as a
  blocker: the print channel (Part 8) is the universal baseline and the
  import-folder drop (8.6) is the interim write-back. A Medtech API adapter
  becomes an upgrade, not a prerequisite.
- The AoBPrinterApp itself is a separate codebase (a Windows print driver +
  tray app) and is only *specified* here, not scoped in detail.
- Inbound email (4.3). Carer authority over a patient's history (4.2).
- The AI check that would keep the reconciliation queue small at volume
  (QUEUE-TRIAGE.md, "the lever against a spike is the checker").
