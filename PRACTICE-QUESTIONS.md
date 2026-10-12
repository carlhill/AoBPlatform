# PRACTICE-QUESTIONS.md: open questions for the practice (Powell Street)

**What this is:** every question the docs say must be put to the practice, in
one place, in the order to ask them. Collected 11 Oct 2026 from all the md
files. **When an answer comes back,** record it in `DECISIONS.md` (or the
file it belongs to), and mark the question here ANSWERED with the decision ID.

Powell Street uses Medical Director for clinical records and PracSoft for
billing, and prints DB4s to AOBPRINTER (D-2026-09-14-04).

Questions for government are in `GOVERNMENT-QUESTIONS.md`.

---

## Ask first

### P1. Which DB4 version does PracSoft print?
**Ask:** "Is PracSoft printing the updated DB4E, the version valid from
1 July 2026, or an older one?" A recent printed DB4 (with the patient details
blanked) answers it.
**Why it matters:** older versions no longer meet the requirements. The
Signed-DB4 reproduces exactly what PracSoft prints, so an old form gives a
faithful copy of an invalid form. For now the platform shows a warning, not a
block (D-2026-09-14-04).
**Sources:** DB4-AND-AOBL.md §1d and §10 item 0; D-2026-09-14-02.
**The vendor can also answer this** (P13).

### P2. Which folder does a signed DB4 go into?
**Ask:**
- "Which number names the patient's document folder? Is it the Chart number
  (for example `00680`)?"
- "Should the Signed-DB4 go into Medical Director's folder or PracSoft's?"
**Why it matters:** until this is answered, nothing is filed back
(`documentFolderKey` is empty). A wrong answer fails silently: signed consents
land in the wrong folder and nobody notices until an audit.
**Sources:** DB4-AND-AOBL.md §6a; D-2026-09-28-03; GA-PLAN B13.

### P3. How much of the bulk billing is telehealth?
**Ask:**
- "Roughly what share of your bulk-billed services are telehealth (phone or
  video)?"
- "What do you do today for the DB4 when the patient is not in the room?"
- "How often do doctors consult from outside the practice, or after hours?"
**Why it matters:** it decides whether the link to the patient's phone is a
fallback or a main channel once verbal capture ends on 30 June 2027. It also
sizes scenario B (the next-day DB4) in the telehealth plan.
**Sources:** VERSION-2.md §3c and §3h item 1; TELEHEALTH-PLAN.md §8.

---

## Telehealth (TELEHEALTH-PLAN.md)

### P4. Will the doctors do the step before the call?
**Ask:**
- "Would your doctors open AoBPlatform during a telehealth call?"
- "Would they read out the masked mobile, send the link, and read out a
  6-digit code?"
- "How long can that take before it gets in the way? We expect under a
  minute."
**Why it matters:** the design depends on the doctor doing it live (D-2026-10-11-07).

### P5. Who follows up the next day?
**Ask:** "When a doctor consults after hours, who at reception would follow up
the DB4 the next day? Would they phone the patient, or prefer to send a link
alone?"
**Why it matters:** scenario B gives reception both options (D-2026-10-11-08).

### P6. Are the "not done" reasons the right ones?
**Ask:** "When a patient cannot do the step before the call, which reasons
should the doctor choose from?" The starting list is: emergency, language
barrier, technology gap, no mobile or email on file, patient declined the
link, doctor without access, other.
**Sources:** TELEHEALTH-PLAN.md §4.

### P7. Are the mobile numbers and emails in PracSoft up to date?
**Ask:**
- "How current are patients' mobile numbers and emails in PracSoft?"
- "Does reception check them at each visit?"
**Why it matters:** links go only to the contact on file (D-2026-09-11-03 and
D-2026-10-11-07). Stale contacts are where the remote channel fails.

---

## Languages

### P8. Which languages do your patients speak?
**Ask:**
- "Do you record a preferred language in the PMS?"
- "Could you give us a count by language (numbers only, no names)?"
**Why it matters:** the practice's own spread decides which professional
translations are bought first (D-2026-10-11-07 decision 5).
**Sources:** TODO.md, languages entry.

### P9. Do you use interpreters?
**Ask:** "Do you use TIS National or other interpreters, by phone or in the
room? Roughly how often?"
**Why it matters:** it decides whether we record "interpreter assisted"
(REQ-LANG-06; TELEHEALTH-PLAN.md §5c C4).

---

## The DB4 and the tablet

### P10. What do you mean when both boxes on the DB4 are ticked?
**Ask:** "When both the treating-practitioner box and the pathology box are
ticked, what do you intend?"
**Status:** the build is decided. The pathology box stays on the paper and is
not drawn on the page the patient signs (D-2026-09-14-02). The practice's
intent was never asked.
**Sources:** DB4-AND-AOBL.md §1.

### P11. May we try it with real forms?
**Ask:**
- "May we print a real DB4 to AOBPRINTER (with test patient details)?"
- "May we run the folder drop against a test patient in your real import
  folder?"
**Why it matters:** the parser templates and the write-back have only been
proven on test fixtures. D-2026-10-10-08 reopens if the first real print shows
the amount in another shape.
**Sources:** GA-PLAN B13; D-2026-10-10-08.

### P12. Do patients leave the kiosk page?
**Ask (after a few weeks of full screen):** "Have you seen patients leave the
kiosk page, or open other apps on the tablet?"
**Why it matters:** it decides whether one installed lockdown app is worth
breaking the zero-install rule (TODO.md, tablet lockdown entry).

---

## Set-up

### P13. Can PracSoft print the DB4 by itself?
**Ask:** "Can PracSoft print the invoice or DB4 automatically when a bill is
finalised?" The vendor may need to answer this.
**Why it matters:** today the DB4 depends on a person pressing Print. A
missed print is a missed agreement.
**Sources:** TODO.md; CONSULTATION-CAPTURE-PLAN.md.

### P14. Do the shared PCs have Bluetooth, and do they take USB?
**Ask:** "Do the shared PCs in consult rooms have Bluetooth? Do they accept USB
devices?"
**Why it matters:** it decides whether doctors sign in with their phone or
need a security key. Finding out on the first morning is expensive.
**Sources:** PRACTITIONER-PASSKEY-DEVICE.md.

### P15. Is Sydney time right for you?
**Ask:** "Which state is the practice in?" Every practice was defaulted to
Sydney time.
**Why it matters:** the wrong time zone puts day boundaries, and the dates on
agreements, hours out.
**Sources:** TODO.md, timezone entry.

---

## Product interest (when there is time)

### P16. Would anyone ask for an offline evidence pack?
**Ask:** "Would an auditor or your insurer want an evidence pack you can check
yourselves, without us?"
**Sources:** VERSION-2.md.

### P17. Would a practice manager want a different home page?
**Ask:** "Would a practice manager who never works the counter want a
different first page from Today?" Low priority.
**Sources:** PRACTICE-NAVIGATION.md.

---

## Already answered

| What the practice said | Where it is recorded |
|---|---|
| The exact same DB4, with the cost and the signature, and one form in the folder | D-2026-09-14-02 |
| The patient must be told the cost | D-2026-09-27-01 |
| They do not use the pre-consult form (pre-agreement) | DB4-AND-AOBL.md §11a; relied on by D-2026-10-11-07 |
