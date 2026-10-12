# GOVERNMENT-QUESTIONS.md: open questions for government, and who to ask

**What this is:** every question the docs say must go to a government body,
grouped by body, with the channel to use. Collected 11 Oct 2026 from all the
md files and from `TELEHEALTH-RULES-RESEARCH.md` (research from official
sources, the same day). **When an answer comes back,** record it in
`DECISIONS.md` with the date, who answered and the channel, and mark the
question ANSWERED here.

**Contact status:** nobody has been contacted yet. GA-PLAN A4 is still
"Carl to state".

Questions for the practice are in `PRACTICE-QUESTIONS.md`.

## Who owns what

| Body | Owns | Channel |
|---|---|---|
| **Department of Health, Disability and Ageing: the AoB project** | AoB policy, the s 65C particulars, verbal assignment, enduring agreements | AssignmentofBenefit@health.gov.au |
| **Department of Health, Disability and Ageing: AskMBS** | What an MBS item means, telehealth eligibility and exemptions | askMBS@health.gov.au |
| **Services Australia: Developer Liaison** | Software integration, conformance, any registration API | developerliaison@servicesaustralia.gov.au, 1300 550 115 |
| **Services Australia: provider line** | Claiming, provider numbers, payee arrangements | 132 150, option 2 |
| **Services Australia: eBusiness Service Centre** | Setting up online claiming | 1800 700 199 |
| **ACMA** | The SMS Sender ID Register | the ACMA's sender ID registration |
| **Medical Board of Australia / Ahpra** | Professional standards for telehealth; the practitioner register and its data | Ahpra |

The Department's FAQ gives 132 011 for "which Services Australia form"
questions. Services Australia's own page lists 132 150 for providers.

---

## Send first

1. **G1, enduring registration (D-11).** Send to both the AoB project and
   Developer Liaison, together with G2.
2. **G10, telehealth: is our flow still a post-agreement?** It changes the
   telehealth design if the answer is no.
3. **G20, conformance (D-10).**
4. **G30, the ACMA Sender ID.** This is a registration, not a question. It has
   months of lead time and blocks go-live.

---

## Department of Health, Disability and Ageing: AoB project
**Channel:** AssignmentofBenefit@health.gov.au

### Enduring agreements

**G1. How does an enduring agreement get registered (D-11)?**
- Who is legally meant to register it?
- Can a software vendor register on the practitioner's behalf?
- Is a portal or API planned, and when?

*Why it matters:* enduring agreements made on or before 30 June 2027 stop after
12 months unless registered, and from 1 July 2027 registration is a validity
requirement. No mechanism is published (F2026L00824, ss 65CA(8)(e) and
65CB(5)(h)). Also send to Developer Liaison. Sources: aob-requirements.md
REQ-END-04; aob-addendum-v2.md; aob-faq-reconciliation.md; GA-PLAN A4.

**G2. Will you accept terminations from platforms, and send cessations back?**
*Why it matters:* registration without deregistration is half a design, and
practices would claim against agreements that have ended without anyone
knowing. Also send to Developer Liaison. Source: aob-design-decisions.md.

**G3. Do two locations of one practice depend on a single MyMedicare
registration?** And when provider numbers are per location, is "the
practitioner" in the agreement the person or the number?
Source: TODO.md, enduring locations entry.

**G4. Is a telehealth service, given by the named GP from home under the
practice's provider number, rendered "at or from" the agreement location
(s 65CA(5)(d))?** Source: TELEHEALTH-RULES-RESEARCH.md Q5.

**G5. Can nurse practitioners, midwives or Aboriginal health workers enter
enduring agreements when working as a GP equivalent?** Low priority.
Source: aob-addendum-v5.md.

### Telehealth and remote signing

**G10. Is our telehealth flow still an episodic post-agreement?**
- In our flow, the practice records the patient's agreement to a telehealth
  consultation before the call, and offers the assignment only after the
  service.
- What wording before the consultation would make it an "offer" under
  s 65C(3)(b)(i), which would make the agreement a pre-agreement instead?

*Why it matters:* a pre-agreement needs different particulars. Until this is
answered, the step before the call must stay clearly separate from the
assignment (TELEHEALTH-PLAN.md §9; D-2026-10-11-07).
Source: TELEHEALTH-RULES-RESEARCH.md Q1.

**G11. What identity assurance do you expect for an SMS or email link signed
on the patient's phone?**
- Is "identity confirmed by the doctor on the call, plus a 6-digit code, plus
  a link to the mobile number on the patient record" enough to "reliably
  identify" the assignor (Electronic Transactions Act s 10)?
- And for a link with nobody on the phone: are three typed identifiers enough?

*Why it matters:* no government source names a method. The FAQ says only
"potentially" for an SMS reply. D-2026-10-11-07 reopens on the answer.
Sources: aob-requirements.md REQ-VER-07; TELEHEALTH-RULES-RESEARCH.md Q2.

**G12. After 30 June 2027, is any replacement for verbal assignment planned
for patients who cannot use a link (no smartphone or email)?** Is an extension
of the transition being considered?
*Why it matters:* VERSION-2.md §3c says remote patients are left with only a
link on a phone, in exactly the cohorts least able to use one.
Source: TELEHEALTH-RULES-RESEARCH.md Q6.

**G13. Can practice staff record a verbal agreement and its date under
s 65C(8), or must the treating practitioner?**
Source: TELEHEALTH-RULES-RESEARCH.md Q7.

### Records and copies

**G14. Which date does the 2-year retention count from?** The claim date, the
agreement date, or (as s 127A(5) reads) the later of 2 years after the
agreement stops being in force and 2 years after it was created?
Source: TELEHEALTH-RULES-RESEARCH.md Q3.

**G15. Must the assignor get a copy before the claim is lodged (FAQ section
4), or only on request (Act s 127(1))?**
*Why it matters:* it decides whether the "send me a copy" offer is optional or
a step that must happen before the claim.
Source: TELEHEALTH-RULES-RESEARCH.md Q4.

### The form and its language

**G16. Does an agreement in a language other than English, or in two
languages, satisfy s 65C?**
*Status:* sidestepped for the DB4 by D-2026-10-11-07 (English DB4 plus a
translated reading page), but not answered. It reopens on legal advice.
Sources: aob-addendum-v2.md; AoB_requirements.md REQ-LANG-02.

**G17. Do you have a position on the amount and the Medicare number appearing
on the signed form?** We reproduce both verbatim from the practice's DB4
(D-2026-09-14-02, -03).

**G18. When an agreement "ends 2 business days after written notice", does
that mean the start of that day, the end of it, or 48 business hours?**
*Why it matters:* it decides whether a patient who ended their agreement this
morning is covered this afternoon. It is Carl's ruling until answered.
Sources: TODO.md; PATIENT-WORKFLOW-PAGE.md.

**G19. May a patient who can consent but cannot draw use tap-to-sign on the
practice tablet, and where does staff help end and signing begin?**
*Status:* Carl allowed both drawn and tap signatures on 25 Aug
(CONSULTATION-CAPTURE-PLAN.md Part 6 Q4). The regulatory confirmation is
still open in TODO.md.

---

## Department of Health, Disability and Ageing: AskMBS
**Channel:** askMBS@health.gov.au

**G25. How is "unsociable hours" defined for items 92210 and 92211?** Is there
a phone equivalent? Relevant to scenario B (after hours).
Source: TELEHEALTH-RULES-RESEARCH.md Q8.

**G26. Does the pre-agreement service category for GP attendances separate
telehealth (video or phone) from face to face?** In other words, can a
pre-agreement for a face-to-face visit cover a telehealth service?
Source: TELEHEALTH-RULES-RESEARCH.md Q9.

**G27. Please confirm the scenario table in the 1 November 2025 telehealth
advisory, and whether anything has changed since.**
Source: TELEHEALTH-RULES-RESEARCH.md Q10.

**G28. May the same MBS item appear on more than one row of one DB4, and on
what terms?** The reprint logic currently keeps duplicates as legitimate.
Source: DECISIONS.md Q-2026-09-28-01.

**G29. What is the MBS item-number format?** Rule C7 assumes 1 to 5 digits.
This may be answerable from MBS Online without asking.
Source: REVIEW-REQUIRED.md.

---

## Services Australia
**Channels:** Developer Liaison (developerliaison@servicesaustralia.gov.au,
1300 550 115) for software questions; the provider line (132 150, option 2)
for claiming questions.

### Developer Liaison

**G20. What is the "conformance process" that the Department's FAQ says
software vendors completed (D-10)?** Can a vendor that does not lodge claims
complete it?
*Why it matters:* practices are told to ask their vendor whether it completed
conformance, so this comes up in every sale.
Sources: aob-requirements.md; aob-faq-reconciliation.md;
aob-servicesaustralia-developer.md.

**G21. What is the status of the digital telehealth AoB form on the Health
Systems Developer Portal since 1 July 2026?**
Source: TELEHEALTH-RULES-RESEARCH.md Q14.

**G22. How does anyone tell an updated (post-1-July-2026) DB4E or DB020 from
an earlier version?**
*Why it matters:* the platform's version check, and the practice question P1,
both depend on knowing what marks the current form.
Sources: aob-requirements.md REQ-TEST-03; DB4-AND-AOBL.md §1d.

**G23. Does reading a Medicare card to check eligibility count as using it to
verify who someone is (hard rule 1)?**
*Caution:* reading eligibility through any Services Australia API brings the
product into scope, including IRAP and onshore-only development.
Source: TODO.md; aob-servicesaustralia-developer.md.

**G24. Is there really no fee to register, or for an NOI?** Low priority.
Source: aob-servicesaustralia-developer.md.

### Provider line

**G31. When a GP consults by telehealth from home, which provider number
should the claim and the assignment carry (reg 51(2)(c), s 65C(5)(b)(ii))?**
And how is the service attributed to a bulk billing incentive (BBPIP)
location? Relevant to scenario B.
Source: TELEHEALTH-RULES-RESEARCH.md Q12.

**G32. Is any telehealth indicator needed on the claim beyond the item
number?** Source: TELEHEALTH-RULES-RESEARCH.md Q13.

**G33. Can Medicare Easyclaim bulk bill telehealth items since 1 July 2026?**
The page saying it cannot is from March 2025.
Source: TELEHEALTH-RULES-RESEARCH.md Q11.

**G34. How does a compliance audit of assignments work?**
- What do auditors ask the practice for?
- What is the legal basis?
- What key do they match an agreement to a claim on?

*Why it matters:* it shapes the GovAudit workflow and what goes in its
extract. Sources: GovAudit.md Q1 and Q3; DB4-AND-AOBL.md.

**G35. What exactly is the payee arrangement registered between a practice and
Services Australia (forms HW027, HW029, HW052)?** Low priority.
Source: ORG-MODEL-PROPOSAL.md.

**G36. Can you release counts of active provider numbers by profession and
SA3?** Market sizing, low priority. Source: PracticeCensus.md.

---

## ACMA

**G30. Register the SMS Sender ID, and decide whether it is one per practice or
one for the platform.**
*Why it matters:* an unregistered sender shows as "Unverified" and is grouped
with scams, which destroys response rates. This blocks go-live and every real
telehealth message (REQ-VER-05, REQ-SMS-01/02).
Sources: GA-PLAN A3; PRACTICE-ONBOARDING.md; TELEHEALTH-PLAN.md §8.

---

## Medical Board of Australia / Ahpra

**G40. Is there guidance on how a doctor should confirm a patient's identity
on a phone-only consultation, beyond "to the best of your ability"?** This is
a professional standard, not a Medicare rule.
Source: TELEHEALTH-RULES-RESEARCH.md Q15.

**G41. Does the PIE data-usage agreement allow lookups on behalf of
practices?** Includes the licence decision ($4,000 install, $1,000 a year,
$1 per practitioner), and the terms of use for the bulk register.
Sources: TODO.md; IDENTITY-STRENGTH-DESIGN.md; PracticeCensus.md.

---

## Not government, kept here so they are not lost

These are not for the practice or for government. Each goes to its owner:
- **RACGP:** does the 6th edition draft really lower the minimum to two
  identifiers (CG2)? It needs a page-by-page check. Also: what is the
  current patient-feedback criterion?
- **AGPAL / QPA:** does continuous patient feedback satisfy accreditation, or
  only contribute to it?
- **Medtech (D-01):** the write-back mechanism into Evolution. Open for Medtech
  practices only; Powell Street's write-back is AOBPRINTER (D-2026-09-28-02).
- **The PracSoft / Medical Director vendor:**
  - Does the licence have an "automated extraction" clause a print driver
    might breach?
  - Is there a documented import API?
  - (Also P1 and P13 in PRACTICE-QUESTIONS.md.)
- **Lawyers:**
  - the legal basis for audit and the wording of audit emails;
  - the agreement template wording;
  - Disability Discrimination Act duties;
  - the collection notice;
  - the Elastic License v2;
  - s 133 and Spam Act wording for recall campaigns.
