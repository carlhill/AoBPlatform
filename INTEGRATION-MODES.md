# INTEGRATION-MODES.md — the three ways a practice feeds AoBPlatform
### v1.2 · 12 September 2026 · Owner: Carl. Companion to `PMS_to_AoB_Workflow.md` (the input SHAPES, cases 1-7) and `PRACTICE-ONBOARDING.md`.

Carl, 12 September 2026:

> I/we need to clearly write down the workflow for these scenarios. I think we
> did do them at a high level.
>
> 1. **BASIC:** AoB is used in a completely manual fashion — no API interface.
>    All data will be keyed in.
> 2. **Semi-Automatic:** Some data is keyed in manually — say when the patient
>    arrives, but then the PMS will send the post-consultation automatically.
> 3. **Full-Automation:** PMS sends all scheduled appointments and
>    post-consultation data to AoB.
>
> I think we will have all these scenarios when we go live.

He is right that all three will exist, and right that they were only ever
written down at a high level. This file is the detailed version.

**How this differs from `PMS_to_AoB_Workflow.md`, since both files number
things.** That one asks *what SHAPE the input arrives in* and numbers the
answers **case 1 to 6**, plus the seventh it added later: raw elements, a PDF,
both, typed by hand, dropped as a file, emailed in. This one asks *HOW MUCH arrives without a person* and numbers
the answers **mode 1 to 3**. Two different questions, two numbered lists, and
they are easy to confuse — which is why §1a below says exactly how they meet,
and `PMS_to_AoB_Workflow.md` §0a says the same thing from the other side.

---

## 1. The one-line answer

**Mode 1 works today for the pre-service path and cannot produce a
post-service agreement at all.** Modes 2 and 3 depend on a connector that does
not exist yet: `apps/connector` today is the FR-9.1 interface plus a mock, and
`PmsModule` wires the mock unconditionally. Everything the connector would
drive is real, tested code sitting behind that interface.

That is the finding that matters, so it is first. The rest of this file shows
the working.

## 1a. Which cases each mode is built from

A mode is not an alternative to a case. **A mode is made of cases.**

| Mode | Built from | Why |
|---|---|---|
| **1 — Basic** | **Case 4** — reception types the elements | Cases 1 to 3 all need an interface and this mode has none. Case 4 IS mode 1 |
| **2 — Semi** | **Case 4** for the arrival, **case 1** for the post-consultation elements, **cases 2/3** where a document is sent instead | The split is by MOMENT, not by shape: a person announces the visit, a machine reports the service |
| **3 — Full** | **Case 1** throughout, or **2/3** where documents are sent | Same pipeline, nobody types |

**Cases 6 and 7 — drag-and-drop and email-in — belong to every mode.** They
are not a fourth mode and not a lesser one. They are what a mode-2 or mode-3
practice falls back to on the morning its interface is down, and what a mode-1
practice uses when it would rather forward a letter than retype it. Hard rule 8
is why they exist: a failed integration slows the evidence, never the care.

**A practice can be in two modes at once**, and will be. The appointment feed
and the post-consultation feed are separate, so the same practice can be mode 3
for bookings and mode 1 for what was billed. Nothing in the pipeline cares: the
arrival contract and the service-rendered contract each accept a machine or a
person, and the versioned visit policy decides the agreement type either way.
**This is the ordinary case, not the exception** — §4's gap A is exactly a
practice that is mode 3 at the front and has no mode at all at the back.

## 2. The table Carl asked for

Rows are the steps in the process. Columns are the three modes. Each cell says
**who supplies it**.

Legend: **Keyed** = a person at the desk types it · **PMS** = arrives over the
interface · **AoB** = the platform derives or decides it · **Patient** = the
person at the tablet · **—** = not applicable in that mode.

### Setup — once per practice, before any patient

These are identical in all three modes. Nobody's PMS sends them, and no amount
of automation removes them.

| # | Step | Data | Mode 1 | Mode 2 | Mode 3 |
|---|---|---|---|---|---|
| S1 | The practice | Legal and trading name, ABN (checked against the register), address, contacts | Keyed | Keyed | Keyed |
| S2 | Letterhead and logo | The words and marks that top every rendered agreement | Keyed | Keyed | Keyed |
| S3 | Locations | Address per site, validated — **this is D4's "place of practice"** | Keyed | Keyed | Keyed |
| S4 | Practitioners | AHPRA number, name, discipline, email | Keyed | Keyed | Keyed |
| S5 | Affiliations | Practitioner × location, **provider number for that place of practice**, billing role | Keyed | Keyed | Keyed |
| S6 | Staff accounts | Who may work the desk, and their role | Keyed | Keyed | Keyed |
| S7 | Tablets | Paired devices, minimum build | Keyed | Keyed | Keyed |
| S8 | Practice defaults | Default service description, channels, identifier types, whether ongoing agreements are offered | Keyed | Keyed | Keyed |

**S5 is the one people underestimate.** Billing identity is practice ×
location × practitioner, because the provider number is issued per
practitioner per place of practice. A practitioner at three sites is three
affiliations and up to three numbers, and the agreement names the one for the
place the service happened at.

### The visit — every patient, every time

| # | Step | Data | Mode 1 | Mode 2 | Mode 3 |
|---|---|---|---|---|---|
| V1 | The day's bookings | Who is expected, when, with whom | **—** (no source) | **—** (no source) | PMS |
| V2 | The patient | Record number, family and given names, date of birth, address, mobile, email | Keyed | Keyed | PMS |
| V3 | Who they came to see | Affiliation, or practitioner and location, or provider number | Keyed | Keyed | PMS |
| V4 | Arrival | The fact and the time they walked in | Keyed | Keyed | PMS *(or keyed for a walk-in)* |
| V5 | Does this visit need an agreement, and which kind | Ongoing, one-off, or nothing | AoB | AoB | AoB |
| V6 | Who is signing (D7) | The patient, or a named other person with a relationship and an authority basis | Keyed | Keyed | Keyed |
| V7 | Service description (D6a) | The Basic Service Description, from the current mapping | AoB default, Keyed to override | AoB default, Keyed to override | AoB default, Keyed to override |
| V8 | Identity verification | Three identifiers checked; **types and outcome recorded, never values** | Patient at the tablet | Patient | Patient |
| V9 | Lock, validate, render | The s 65C set validated, locked, rendered and hashed | AoB | AoB | AoB |
| V10 | Signature | The assignor's mark, hash-bound to the exact rendered bytes | Patient | Patient | Patient |
| V11 | The service was rendered (D5, D6b) | Service date and MBS item numbers | **GAP — see §4** | PMS | PMS |
| V12 | Post-service agreement, where one is owed | Raised, sent, chased | **—** (follows V11) | AoB | AoB |
| V13 | Write the evidence back | The artefact into the practice's own system | **GAP — see §4** | PMS | PMS |

**V5 is AoB's in every mode, deliberately, and it is not a detail.** Whether a
visit needs an ongoing agreement depends on whether this patient already holds
one with *this practitioner*, whether the practitioner is a general
practitioner, and what the practice offers by default. That is the versioned
visit policy. If a PMS said "make an ongoing one" and we obeyed, the rule that
defends us against the regulator moving again would live in every customer's
software instead of in one place we control. An arrival that claims an
agreement type is ignored on that point.

**V6 is keyed in all three modes, also deliberately.** Who is signing is an
answer somebody at the desk gives, because a machine has nobody to ask. The
arrival contract refuses the assignor block from any source other than
reception.

**V8 and V10 are always the patient's.** No mode has staff entering an
identifier on the patient's behalf or signing for them.

## 3. Mode 1 in full — what reception keys, and whether a screen exists

This is the list Carl asked for. Read against the code on 12 September 2026.

### Once per practice

| Data | Screen today |
|---|---|
| Practice entity, ABN, contacts | ✅ `/practice/entity` and the application form |
| Letterhead and logo | ✅ `/practice/templates` |
| Locations, addresses, validation | ✅ `/practice/locations` |
| Departments | ✅ `/practice/locations` |
| Practitioners | ✅ `/practice/practitioners` |
| Affiliations, provider number, billing role | ✅ `/practice/affiliations` |
| Staff users and roles | ✅ `/practice/users` |
| Tablets | ✅ `/practice/devices` |
| Default service description | ✅ `/practice/channels` |
| **Identifier types, link expiry, channels, kiosk idle timeout, ongoing-by-default** | ❌ **endpoint only, no screen** |

### Once per patient

| Data | Screen today |
|---|---|
| Names, date of birth, address, mobile, email, record number | ✅ created through the arrival; corrected at the patient's page |
| **Gender as identified** | ❌ **an approved identifier with a column and no way to key it** |
| **IHI** | ❌ **same** |
| **Preferred language** | ❌ no screen |
| **MyMedicare registered** | ❌ no screen — and it gates the ongoing-agreement pathway |
| **Confidentiality flag** | ❌ no screen |

### Every visit

| Data | Screen today |
|---|---|
| The whole arrival: patient, practitioner, time, service date, description, who signs | ✅ `/practice/patients` — the new-agreement panel, which posts the same arrival a connector would |
| Preview of what the visit needs before submitting | ✅ same panel |
| Who is signing, later or changed | ✅ `/practice/tablet` and the front desk |
| Service description on an existing draft | ✅ `/practice/tablet`, `/practice/reconciliation` |
| Send to a tablet, recall, resend | ✅ `/practice/tablet`, `/practice/frontdesk` |
| Mark the visit seen | ✅ `/practice/practitioner/waiting` |
| **The day's bookings** | ❌ **no create endpoint, no screen, no import** |
| **MBS item numbers after the service (D6b)** | ❌ **endpoint only — and this is the blocker** |
| **Verbal capture, and the paper channel** | ❌ no screen, though both are modelled |
| **A printed copy at the desk** | ❌ needs a staff artefact route and a signed-agreements list |

## 4. The two gaps that decide whether mode 1 is a product

Everything else above is a missing screen over a working endpoint. These two
are different.

**Gap A — a fully manual practice cannot raise a post-service agreement at
all.** The post-service door needs the service date and the MBS item numbers.
No screen posts them, and the "Completed" control on the practitioner queue
gives up unless a service record already exists — and service records arrive
only from invoice sync. So the whole post-service branch of the statute is
closed to a practice with no PMS feed. **This is the single most important
thing on this page.**

**Gap B — a hand-keyed patient can never be written back to.** Write-back
needs the practice's own linkage key on the patient, and that is set only by
sync. A patient typed at the desk has none, so their evidence stays with us
and never reaches the practice's system, and shows as stale after four hours.
For a mode-1 practice that may be acceptable — there may be nothing to write
back INTO — but it must be a decision, not a surprise, and the staleness
warning must not fire at a practice that was never going to sync.

## 5. What each mode actually needs built

| Mode | What is missing | Size |
|---|---|---|
| **1 — Basic** | A post-service screen (Gap A); a day list reception can build by hand; the identifier fields with no input; the practice-config screen; a write-back posture for practices that will never sync (Gap B) | Weeks, all of it ours, none of it blocked by anybody |
| **2 — Semi** | Everything in mode 1 EXCEPT the post-service screen, plus a real connector for the invoice feed | Blocked on **D-01** |
| **3 — Full** | Mode 2 plus the appointment feed | Blocked on **D-01** |

**Mode 1 is not the fallback, it is the unblocked path.** Nothing in it waits
on Medtech, on Services Australia, or on anyone outside this project. Modes 2
and 3 are mode 1 with a machine typing instead of a person, and they cannot be
finished until D-01 is answered. That is an argument for finishing mode 1
first regardless of which mode the first customer wants.

## 6. What is NOT a difference between the modes

Worth stating, because it is easy to assume otherwise:

- **The agreement is ours in every mode.** Whatever the source, the thing the
  patient signs is rendered by the one deterministic path, hashed at render,
  and re-verified whenever it is shown. A PMS-supplied document is evidence
  and input; it is never the instrument.
- **The rules engine runs in every mode.** No mode skips validation because
  the data came from a machine. A connector's payload is as untrusted as a
  typed one.
- **The versioned visit policy decides the agreement type in every mode.**
- **The vault gets the same events in every mode**, through the same outbox.
- **Nothing blocks care in any mode.** A practice with no integration, a
  practice whose connector is down, and a practice with a dead tablet all see
  the patient and bill them.

## 7. Answered by Carl, 12 September 2026

Q1 and Q2 below were questions when this file was written. Carl answered both
the same day, and added a third thing nobody had asked. All three are recorded
as decisions D-2026-09-12-13, -14 and -15.

### 7.1 Gap A — yes, and it is release-blocking (D-2026-09-12-13)

Carl: *"we need a screen to manually type these details."*

A practice with no interface MUST be able to raise a post-service agreement, so
there must be a screen where a person types the service date (D5) and the MBS
item numbers (D6b). The door already exists and nothing calls it from a screen.

**It is release-blocking rather than a gap in a table**, because mode 1 is the
only mode not waiting on somebody outside this project. If mode 1 cannot produce
a post-service agreement, the one posture we can ship without help covers half
the statute.

**It is not a claiming screen and must never become one.** No benefit, no fee,
no dollar amount on it or on anything it produces (hard rule 4). It records what
was DONE so the agreement can name it, never what it is worth.

### 7.2 Gap B — a posture per integration point, and the mode is derived (D-2026-09-12-14)

Carl: *"lets add a column to the practice table or a table linked to the Practice
table called `practice_posture` and lets record the mode the practice is working
in and what postures / integrations are automated and what is manual."*

**A linked table, not a column.** One row per integration POINT, because the
points move independently:

| Point | Postures |
|---|---|
| Appointments — the day's bookings | `manual` · `automated` · `not_used` |
| Arrivals | `manual` · `automated` · `not_used` |
| Service rendered — what was billed | `manual` · `automated` · `not_used` |
| Write-back | `manual` · `automated` · `not_used` |
| Patient demographics | `manual` · `automated` · `not_used` |

**The mode is derived from the postures and never stored.** §1a already said a
practice can be in two modes at once and usually will be; a single stored `mode`
would have to round that to a lie, and if both existed they could disagree.

**The rows are dated and never edited in place**, because the posture is
evidence. An agreement made in March was made under March's posture, and an
auditor asking whether it was typed or arrived from the practice's software must
get March's answer.

**This is what closes gap B.** A write-back posture of `not_used` means the
stale-artefact warning does not fire, because there is nothing to write back
into and nothing is wrong. Today the platform cannot tell that practice apart
from one whose connector has died, which is the actual defect.

### 7.3 The exception nobody had asked about — a corrected resend (D-2026-09-12-15)

Carl: *"we have to consider how to handle exceptions: If the PMS sends incorrect
details, they must be able to resend and AoB should be able to handle it."*

**The three answers are the platform's existing rules**, chosen by how far the
agreement has got:

| Stage | What a correction does |
|---|---|
| Not yet locked | Updates the draft |
| Locked, unsigned | **Supersedes** — a new agreement naming the old one, exactly as a reception correction already does |
| Signed | Nothing to the signed record, which is immutable. A correction raises a new agreement and the signed one stands as evidence of what was agreed |

**The dangerous part is the idempotency key.** The arrival contract carries one
so a RETRY is safe. A resend of CORRECTED details is not a retry, and a
connector that sends it under the same key gets silence: the platform sees a
duplicate, does nothing, and both sides believe the correction landed. **That is
reachable today and it is the worst available outcome.**

So the two must be distinguishable on the wire. The same key means "you may not
have heard me". A new key naming a prior arrival means "what I told you was
wrong". Anything else is refused with a reason saying which the sender meant.

### 7.4 Still open

- **Which domain the product is served from.** It gates real email, real
  passkeys and tenant single sign-on alike.
- **Gender as identified, and the IHI.** Both are in the approved identity set,
  both have columns, and neither can be keyed anywhere. Either they become
  keyable or they should not be offered as verification types.

## Change log
| Date | Change |
|---|---|
| 12 Sep 2026 | v1.0. Written when Carl asked for the three modes as one table, with the data at each step down the rows. The two gaps in §4 were found by reading the controllers rather than recalled. |
| 12 Sep 2026 | §1a added. Carl pointed out the two files both number things and neither said how the numbers relate. A mode is made of cases; drag-and-drop and email-in belong to every mode; a practice can be in two modes at once, which is what gap A actually describes. |
| 12 Sep 2026 | v1.2. Carl answered §7 Q1 and Q2 and raised the resend exception. Section 7 is now answers, not questions: the post-service screen is release-blocking, practice posture is per integration point with the mode derived, and a corrected resend supersedes and must never vanish behind an idempotency key. Recorded as D-2026-09-12-13, -14, -15. |
