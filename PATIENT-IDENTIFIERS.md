# PATIENT-IDENTIFIERS.md — the several numbers a patient has, and which one to paste
### v1.0 · 12 September 2026 · Owner: Carl. Describes what is BUILT, plus one gap to close. Companion to `CLAUDE.md` §2 (hard rules 1 and 9) and `PRACTITIONER-QUEUE-PAGE.md`.

Carl, 12 September 2026: *"We need to also maintain a practice-patient-id on the
patient table or whatever we named it. This is so that we can manage the records
through the API or if no API a practitioner can copy the practice-patient-id and
paste into the PMS when preparing to see a patient."*

**It already exists.** It is `patients.patientRecordNumber`. What does not exist
is the copy control where a practitioner needs it — see §4.

---

## 1. The four identifiers, and who each one belongs to

| Column | Whose number is it? | What it is for | Shown to whom |
|---|---|---|---|
| `patients.id` | **Ours.** A UUID we minted | Naming the same row in the console, the vault events and a support call | On the desk with a Copy control, at Carl's request (7 Sep 2026) |
| `patients.patientRecordNumber` | **The practice's.** Their own number for their own patient | Finding the patient in the practice's own software. **This is Carl's "practice-patient-id"** | In the portal and the new-agreement panel today; NOT yet where a practitioner would copy it (§4) |
| `patients.pmsLinkageKey` | **The practice software's.** The key the connector joins on | Machine matching during a sync. Never a human's handle | Nowhere, correctly |
| `patients.ihi` | **The Commonwealth's.** Individual Healthcare Identifier | An approved identity identifier | Held, rarely shown |

**There is no Medicare number column anywhere in the schema, and there must
never be one used as an identifier** (hard rule 1, REQ-VER-02). Confirmed by
inspection, 12 September 2026. This is the single most likely design mistake in
the product and the absence is deliberate.

## 2. Which one to paste into the practice's software

**The record number, never our UUID.** Pasting `2c22c2cb-685e-…` into a practice
management system finds nothing — it is meaningless outside this platform. The
record number is the practice's own, is what their software indexes on, and is
what a practitioner means when they say "look her up".

Both are legitimate to copy and they serve different jobs, so a screen that
offers both must label them so plainly that nobody has to guess. Suggested
wording: **"Practice record number"** and **"AoBPlatform record"**. Never "ID"
alone for either.

## 3. What the record number is, in the regime's terms

The patient record number is **one of the six approved identity identifiers** —
name, date of birth, gender, address, patient record number, IHI. That is the
non-configurable set (hard rule 1). Two consequences that constrain everything
below:

1. **It is an identifier VALUE.** It may appear on a screen for the practice that
   owns it. It must never appear in a log, an error message, a URL, or a vault
   event; verification records store identifier TYPES and outcomes only (hard
   rule 9, REQ-VER-04).
2. **It is the practice's, not ours.** The practice management system is the
   source of truth (REQ-DATA-10). We mirror it and must not invent, reformat or
   normalise it — the string that came from them is the string that goes back.
   Where it is absent, the answer is blank, never a generated substitute.

## 4. The gap to close

The record number is held, mirrored and kept current. It is simply not on the
screens where somebody would reach for it.

| Where | What is needed |
|---|---|
| The practitioner queue (`PRACTITIONER-QUEUE-PAGE.md`) | The record number with a Copy control, on the row and in whatever detail the page shows. This is the case Carl described: a practitioner about to see a patient, pasting into their own software |
| The front desk page (`FRONT-DESK-PAGE.md`) | The same, on the patient panel. Reception looks people up more often than anybody |
| The patient work page | Already reachable but not copyable |

**Copy, not select-and-drag.** A one-press control with a confirmation, the same
pattern already used for the platform record on the desk. A number that has to
be highlighted by hand gets mis-copied, and a mis-copied record number opens the
wrong patient's file, which is the worst outcome on this page.

**A blank is a blank.** Where the practice has no record number for somebody,
say so — "No practice record number" — and do not offer a Copy control with
nothing behind it.

## 5. On the API

The record number is already the join key on the arrival contract
(`Arrival.pmsPatientRecordNumber`), which is how a practice's software tells us
somebody has walked in. So "manage the records through the API" is served today
for arrivals. What is not yet settled is whether the record number is accepted
as a lookup key on other endpoints; that follows the connector work and blocker
D-01, and should not be guessed at ahead of it.

## 6. Named tests

- `the_record_number_is_never_written_to_a_log_or_an_event` — hard rule 9.
- `a_medicare_number_is_never_accepted_as_an_identifier` — exists already; named here because this document is where somebody will come looking.
- `the_record_number_is_mirrored_exactly_as_the_practice_sent_it` — no trimming, no case change, no padding.
- `a_patient_with_no_record_number_offers_no_copy_control`.
- `the_two_copy_controls_are_labelled_so_they_cannot_be_confused`.

## 7. Open

- **Does the practitioner queue show the record number to a screen that faces a
  door?** The consulting-room-screen question in `PRACTITIONER-QUEUE-PAGE.md` §6
  applies with more force here: a record number is an identifier, and a card
  number is not.
- **Is the record number ever writable from our side**, or is it always the
  practice's to change? Today it is mirrored; if reception can correct a typo in
  it, that is a change to the source of truth and needs its own rule.

## Change log
| Date | Change |
|---|---|
| 12 Sep 2026 | v1.0. Written when Carl asked for a practice-patient-id. It already exists as `patientRecordNumber`; the gap is the copy control and where it is shown. |
