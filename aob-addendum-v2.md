# Addendum — Languages, RACF, Off-boarding, Notification, Registration
### 19 August 2026 · Extends Requirements v0.3 and Solution Design v0.1

---

## 1. Multilingual support

### 1.1 Why this is cheaper here than it looks

An AoB agreement is not a free-text document. It is a **fixed template with seven variable fields** — patient name, agreement date, pre/post flag, provider details, service date, service description or item number, assignor-is-patient. The variables are names, dates and numbers, which need **no translation at all**.

So the translation cost is: **translate the template once per language, then never again** (until the regulation changes). Perhaps 400–600 words of fixed text. That is one of the cheapest genuine differentiators available in this product, and no competitor has it.

### 1.2 ⚠️ The legal question that must be answered first

**The s 65C data set does not specify a language.** Nothing in the regulations, the Departmental FAQ, or any guidance addresses whether an agreement rendered in Arabic or Samoan is a valid agreement.

Two readings, and I cannot resolve which is right:

- **Permissive:** the regulation requires the *information* to be present and the assignor to sign. Language is not mentioned, so any language carrying the data set is valid — and arguably a non-English agreement is *more* compliant, since an agreement the assignor cannot read is a weak evidentiary basis for consent.
- **Conservative:** an auditor at Services Australia or the PSR must be able to read the artefact produced as evidence. An agreement they cannot read invites a dispute the practice does not want.

**Design decision: build bilingual by default.** Every translated agreement renders **English and the target language together** — English as the canonical legal text, the translation alongside it. This satisfies both readings, needs no legal ruling to proceed, and is standard practice for consent documents in Australian health settings.

**Action:** ask `AssignmentofBenefit@health.gov.au` directly whether a non-English agreement satisfies s 65C. Nobody appears to have asked. The answer is useful to you whichever way it goes.

### 1.3 Language set

**Tier 1 — largest non-English languages spoken at home** (2021 Census, approximate, verify before publishing): Mandarin, **Arabic**, Vietnamese, Cantonese, Punjabi, Greek, Italian, Hindi, Nepali, Spanish, Filipino/Tagalog, Korean, Tamil, Turkish, Persian/Farsi.

**Tier 2 — Pacific languages** (your explicit requirement, and systematically neglected by health software): **Samoan, Tongan**, Fijian, Fiji Hindi, Cook Islands Māori, Niuean, Tokelauan, Bislama, Tok Pisin, Rotuman, Kiribati/Gilbertese, Tuvaluan.

Pacific communities concentrate in South Western Sydney, Logan and Brisbane South, Melbourne's south-east and west, and Auckland-linked migration corridors — which overlap almost exactly with the **highest-bulk-billing PHNs in the country** (South Western Sydney PHN records 95.8% GP bulk billing). These are your highest-AoB-density patient populations.

**Tier 3 — Aboriginal and Torres Strait Islander languages.** Relevant to the ACCHO/AMS enduring pathway. Do not attempt this without ACCHO partnership and community-controlled translation governance. Kriol and Yumplatok (Torres Strait Creole) have the widest reach. **Get this wrong and it is worse than not offering it.**

### 1.4 Requirements

- **REQ-LANG-01** Language is a property of the **patient record**, sourced from the PMS preferred-language field where present, selectable at capture, and persisted for future agreements.
- **REQ-LANG-02** **Bilingual rendering by default** — English canonical text plus target language. Both are part of the signed artefact and both are covered by the signature hash (REQ-SIG-02).
- **REQ-LANG-03** **NAATI-certified human translation** of the fixed template. **No machine translation in the legal artefact**, ever. Machine translation is acceptable only for clearly-labelled supporting help content, and even there it should carry a "machine translated" marker.
- **REQ-LANG-04** **Full RTL support** for Arabic, Persian/Farsi, Dari, Urdu and Hebrew — mirrored layout, correct bidirectional handling where Latin-script names and MBS item numbers sit inside RTL text, correct numeral rendering (Eastern Arabic vs Western Arabic numerals is a real decision — default to Western for item numbers, which are identifiers not quantities).
- **REQ-LANG-05** **Full Unicode and diacritics.** Samoan and Tongan use macrons and the ʻokina (U+02BB, a modifier letter — **not** an apostrophe). Getting Tongan `Tonga` vs `Toʻonga` wrong is the kind of error that tells a community you didn't take them seriously. Font stack must render Polynesian diacritics correctly at signature-capture sizes.
- **REQ-LANG-06** **Read-aloud in language.** Several Pacific and Aboriginal language communities have strong oral preference and lower written-literacy rates in the heritage language than spoken fluency. **Audio matters more than text for this cohort**, and no competitor offers it in any language.
- **REQ-LANG-07** **Interpreter workflow.** Surface **TIS National's Free Interpreting Service**, which is available at no cost to medical practitioners providing Medicare-rebateable services — precisely this use case. Record in the audit trail that an interpreter was used, the language, and the TIS job reference where available.
- **REQ-LANG-08** **Plain-language English first.** The English text should be written at roughly a Year 6–8 reading level before translation. Translating bureaucratic English produces bureaucratic Arabic. This also serves the low-literacy English-speaking cohort, which is larger than any single translated language group.
- **REQ-LANG-09** **Assignor language may differ from patient language.** A Samoan-speaking grandmother's agreement may be signed by an English-speaking adult child. Render in the **assignor's** language — they are the one consenting.
- **REQ-LANG-10** SMS and email in the patient's language, including the consent request itself. A link in English to a form in Samoan still loses the patient at the SMS.
- **REQ-LANG-11** Translation memory versioned alongside the s 65C rule set. When the regulation changes the template, every language needs re-translation, and the system must know which languages are stale.

### 1.5 Sequencing

Ship **English + Arabic + Simplified Chinese + Vietnamese** first (largest volume, and Arabic proves the RTL engine). Then **Samoan + Tongan** — small in national terms, disproportionate in the highest-bulk-billing catchments, and the strongest possible signal that this product was built for the patients everyone else's product fails. Then the rest of Tier 1 as demand appears.

---

## 2. RACF — what it is, and the workflow

**RACF = Residential Aged Care Facility.** The nursing-home sector: permanent residential aged care homes, roughly 196,000 permanent residents nationally, receiving over 4.8 million GP attendances a year — about **17 GP visits per resident per year**, the highest per-capita GP contact of any population in Australia.

### 2.1 Why it is the hardest AoB setting

- Residents frequently **cannot sign** — dementia, delirium, physical incapacity, palliative status.
- The person who *can* consent is usually **not present** at the consultation. Family visit on weekends; GPs attend on weekdays.
- The GP is **visiting**, often with a laptop or nothing, sometimes with poor connectivity, seeing 10–20 residents in a session.
- Enduring agreements here are **per practitioner**, so each visiting GP needs a separate agreement with each resident. A home with four regular visiting GPs and 90 residents is up to **360 agreements**.
- The old "patient unable to sign" annotation was **abolished** by the 2025 regulations. The previous workaround no longer exists.
- Aged care residents are one of only three enduring-eligible cohorts — so the payoff for getting it right is larger here than anywhere.

Ageing Australia's Tom Symondson reported members ringing to say **"GPs were saying they just wouldn't come in anymore."** That is the stake: this is not an admin inconvenience, it is a threat to medical attendance in nursing homes.

### 2.2 The workflow, concretely

**Enrolment campaign (once per home, per practitioner):**

1. Practice loads the resident list for the facility
2. System identifies the **responsible person** per resident from PMS/facility records — spouse, adult child, guardian, health EPOA
3. **Assignor-remote capture**: the enduring agreement is sent to the responsible person's own phone or email, not the resident's, with the patient's language and the assignor's language handled separately (REQ-LANG-09)
4. Where the resident has capacity, capture directly on tablet with read-aloud
5. Paper pack for facilities and families who need it, pre-filled, with a scan-back path
6. Progress dashboard by facility, by practitioner, by resident

**Visiting-GP session (ongoing):**

1. GP arrives, opens the facility view on tablet — **works fully offline**
2. Residents with a valid enduring agreement for **this practitioner**: nothing to do, marked covered
3. Residents without: episodic capture queued, with the assignor's contact ready for a remote send after the session
4. On reconnect, everything syncs, validates, writes back to the PMS

**Ongoing monitoring:**

- **Resident leaves the home → the enduring agreement automatically ceases** (65CA(8)). Detect it. An agreement relied on after cessation produces a claim that was never validly assigned.
- **A temporary hospital admission does NOT end the agreement** (65CA(9)) — do not false-positive on this, it will happen constantly in this cohort and a system that keeps voiding agreements every hospital transfer will be turned off.
- Practitioner leaves the practice → their agreements cease.
- Death → close out and stop notifications immediately. Getting this wrong is the single most damaging failure mode in the product.

**Nobody has published an RACF operational workflow** — not the Department, not the peaks, not a vendor. This is uncontested ground in the segment with the highest AoB density in the country.

---

## 3. Off-boarding

You asked for both directions. The regulations treat them differently, and the asymmetry matters.

### 3.1 Patient-initiated

**The patient always holds this right — even over an agreement they did not sign.** FAQ p. 37: *"A patient may also terminate an enduring agreement, even if another person originally entered into the agreement on their behalf."*

- **REQ-OFF-01** Patient can terminate any enduring agreement covering them from the **patient portal**, in one action, in their language.
- **REQ-OFF-02** System generates the **written notice** required by 65CA(7) and delivers it to the practice. The patient should not have to write a letter to exercise a statutory right.
- **REQ-OFF-03** Agreement ends **2 business days** after notice — not 2 calendar days. Business-day calculation must respect state public holidays, because a Friday notice before a long weekend lands differently in each state.
- **REQ-OFF-04** Countdown visible to both parties. Claims in the window remain valid; claims after do not.
- **REQ-OFF-05** **No retention/win-back flow, no friction, no "are you sure?" dark patterns.** This is a consent withdrawal, not a subscription cancellation. Any friction here is both an ethical failure and a regulatory hazard.
- **REQ-OFF-06** Assignor is notified that the patient terminated an agreement the assignor entered — they need to know they are no longer acting.
- **REQ-OFF-07** **Leaving the practice entirely.** Terminate all enduring agreements with all practitioners at that practice in one action; produce a record of what was terminated; retain the historical agreements for the full 2-year period (termination ends the agreement, it does not delete the evidence).

### 3.2 Practitioner-initiated

- **REQ-OFF-08** Practitioner or practice terminates by written notice; must notify the assignor **at least 2 days before** termination takes effect.
- **REQ-OFF-09** **Bulk termination** — a departing GP may hold hundreds or thousands of agreements. This must be one workflow, not one-at-a-time.
- **REQ-OFF-10** **Scope change requires terminate-and-recreate** (FAQ p. 39). Model as a paired transaction so the patient is never left uncovered between the two.
- **REQ-OFF-11** Terminating stops the **89AA notification obligation** for that agreement. Notifications continuing after termination are a privacy incident, not a cosmetic bug.

### 3.3 Automatic cessation — the dangerous category

These require **no notice from anybody** and are the ones that silently invalidate claims (65CA(8)):

| Trigger | Detection |
|---|---|
| Patient no longer registered with the MyMedicare practice | MyMedicare Web Services would give this at source; PMS inference otherwise |
| Practitioner leaves the nominated practice location | Practice/provider record change |
| Patient stops residing in the aged care home | Facility record; **exclude temporary hospital admissions** |
| Patient covered under someone else's agreement **turns 14** | Date of birth — deterministic, so no excuse for missing it |
| Patient ceases to be a patient of the ACCHO/AMS | Organisation record |
| Not registered with Services Australia before the first anniversary | §5 below |

- **REQ-OFF-12** Continuous cessation monitoring against all six triggers, with the affected agreement immediately marked `ceased` and any dependent claims flagged.
- **REQ-OFF-13** **The 14th-birthday trigger is a scheduled job.** At 14, the patient can make their own enduring agreement or choose an assignor. Prompt the practice 30 days ahead to re-paper it, rather than discovering it after an invalid claim.

---

## 4. "An enduring agreement converts work rather than removing it" — am I sure?

**On the fact, yes — and it's on page 37 of the document you sent me:**

> "When a Medicare claim is made using an enduring agreement for a MyMedicare registered patient, **the provider must notify the assignor in writing within 24 hours of making the claim**. The notification must be sent using the method agreed to in the enduring agreement and must include **the name of the professional who provided the service, the patient's name, the date the service was provided, and the amount of Medicare benefit claimed**. Post service notifications are **not required** for enduring agreements entered by patients in a residential aged care home or an ACCHO/AMS."

So: real, per-claim, 24-hour, four mandatory data elements, MyMedicare pathway only, and it must use the delivery method specified in the agreement — which is why that method is itself a required field.

**On my framing, I overstated it.** "Does not remove work" was too strong, and I should correct it. The accurate version:

| | Episodic capture | Enduring + notification |
|---|---|---|
| Direction | **Bilateral** — needs patient action | **Unilateral** — no response needed |
| Failure mode | Patient doesn't respond → **claim cannot be made** | Delivery fails → obligation breached, but the claim stands |
| Chase labour | 9–12 calls/day | **Zero** |
| Automatable | Partially — you cannot automate a human signing | **Fully** |
| Cohort | All bulk-billed patients | MyMedicare only; not RACF, not ACCHO |

**Enduring is a large net win.** It replaces the expensive kind of work (bilateral, blocking, human-dependent) with the cheap kind (unilateral, non-blocking, fully automatable). My point stands in one narrower respect: **the obligation is not zero, it is a build, and no vendor has built it** — so a practice that enrols 2,000 patients in enduring agreements without notification automation has taken on thousands of 24-hour deadlines a month it cannot meet manually. That is the real claim, and it is the reason the notification engine (REQ-END-05) is what makes enduring saleable rather than a trap.

---

## 5. Registration — now confirmed, and your idea is the best government angle yet

### 5.1 Confirmed verbatim in the instrument

I flagged this as unverified. It is now verified, from the text of **F2026L00824**:

> **65CA(8)(e)** — the agreement ceases: *"if the agreement is entered into on or before 30 June 2027 and is **not registered with Services Australia** before the first anniversary of the day the agreement is entered into—when the agreement has been in effect for 12 months."*

> **65CB(5)(h)** — requirements for an enduring agreement: *"if the agreement is entered into **on or after 1 July 2027**—be **registered with Services Australia**."*

**Both provisions are real.** And the Department's own 40-page FAQ, dated **16 July 2026 — three weeks after this instrument was made** — describes enduring agreements across four pages, lists the automatic cessation triggers, and **never mentions registration once**.

That is not a small gap. Every enduring agreement being written in Australia right now carries a **rolling 12-month fuse** that the Department's primary guidance does not tell practices about.

### 5.2 Who registers?

The instrument uses the passive voice — *"be registered with Services Australia"* — and does not name the registering party.

Reading the structure: **65CB(5) is a list of requirements the agreement must meet**, and the obligation to ensure an agreement is valid sits with the **practitioner**, who is the party that cannot claim without one. The patient has no relationship with Services Australia in this context and no means of registering anything.

**So: the practitioner (or the practice acting for them) registers.** That is a strong inference, not a certainty — worth confirming.

**And the mechanism does not exist publicly.** No portal, no HPOS function, no form, no API, no field in the developer portal's programs list, nothing on the Software Developer Impact Roadmap. Services Australia's own AoB page does not mention it.

### 5.3 Your idea — automated registration management — assessed

You asked whether you could work with Services Australia to automate registration annually against rules and tests. **This is the strongest government-facing idea in this project, and it is far better than the AI-fraud-detection angle I argued against earlier.** Here is why:

- **It is a real obligation with no mechanism.** Not a solution looking for a problem — a statutory requirement with a hole where the plumbing should be.
- **It is deterministic, not judgemental.** Registration is a record-keeping act against clear criteria. There is no adverse decision about a person, no automated assessment of entitlement, and therefore **none of the Robodebt exposure** that kills AI-assessment ideas in this portfolio. The APP 1.7/1.8 automated-decision-making disclosures are manageable because nothing here decides anything about anyone.
- **The volume is the argument.** Per-practitioner agreements at national scale means millions of registrations, each with its own anniversary. This is precisely the kind of thing that must be machine-to-machine or it will not happen at all — and if it does not happen, agreements silently cease and claims silently become invalid. Services Australia has an interest in it working.
- **Timing is unusually good.** 1 July 2027 is the hard date, and nothing has been published. A vendor arriving now with a worked design, a data model, and a live design-partner practice is arriving before the requirement has been specified, not after.
- **It is a natural extension of what you are already building.** You will hold the agreements. Registering them is the next field in the same record.

**How I would approach it:**

1. Email `AssignmentofBenefit@health.gov.au` and Services Australia's Developer Liaison with a short, specific question: *what is the mechanism for registering an enduring agreement under 65CB(5)(h), and is a software vendor able to submit registrations on behalf of a practitioner?* Do not pitch. Ask. The question itself demonstrates you have read the instrument more carefully than most vendors.
2. If the answer is "not yet designed," **offer to be a design partner** — you have a Medtech practice, you hold the data model, and you can describe the practitioner's side of the problem concretely.
3. Build the registration record now regardless: capture the fields registration will plausibly need, track every agreement's anniversary, and warn at 90/60/30 days. Harmless if the requirement is deferred; decisive if it is not.
4. **Do not market it until the mechanism is published.** "We handle Services Australia registration" is not a claim you can make against an API that does not exist.

### 5.4 One caution

There is a real possibility the registration requirement is **deferred or removed** before July 2027 — this regime has already been delayed twice and reversed once, eight working days before commencement, and the Department has said it will use the transition period to "explore other regulatory and legislative options."

So: build the tracking (cheap, useful either way), open the conversation (free, and the relationship compounds), but **do not build a business on the registration API alone**. It is a feature of the consent-and-compliance-record product, not a company.

---

## Actions added

| # | Action | Priority |
|---|---|---|
| 1 | Ask the Department whether a **non-English agreement** satisfies s 65C | 🔴 Blocks translation design |
| 2 | Ask the Department + Developer Liaison **how enduring registration works**, and whether a vendor can submit on a practitioner's behalf | 🔴 Highest — and the opening for §5.3 |
| 3 | Confirm **who** must register (practitioner inferred, not stated) | 🔴 |
| 4 | Commission **NAATI translation** of the template — English first at Year 6–8 reading level | 🟠 |
| 5 | Build **assignor-remote capture** and the RACF batch/offline session | 🟠 Uncontested ground |
| 6 | Implement the **six automatic cessation triggers**, with the temporary-hospital-admission exclusion | 🟠 Silent claim invalidation |
| 7 | Build the **89AA notification engine** — 24 hours, four data elements, agreement-specified delivery method, MyMedicare only | 🟠 |
| 8 | Patient-portal **one-action termination** with generated written notice and business-day countdown | 🟢 |
| 9 | Register the organisation in the Health Systems Developer Portal (free) to establish the Developer Liaison relationship | 🟢 |

---

### Sources

- *Health Insurance Amendment (Enduring Agreements) Regulations 2026* — [F2026L00824](https://www.legislation.gov.au/F2026L00824/asmade/text), ss 65CA(8)(e), 65CB(5)(h)
- *Assignment of Medicare Benefits for Bulk Billing — Frequently Asked Questions*, DoHDA, 16 July 2026, pp. 14, 31, 34, 37, 39
- [Assignment of benefit for bulk bill claims — Services Australia](https://www.servicesaustralia.gov.au/assignment-benefit-for-bulk-bill-claims?context=20)
- [RACGP Standards for general practices, 5th edition — C6.1 Patient identification](https://www.racgp.org.au/running-a-practice/practice-standards/standards-5th-edition/standards-for-general-practices-5th-ed/core-standards/core-standard-6/criterion-c6-1-patient-identification)
- [TIS National — Free Interpreting Service](https://www.tisnational.gov.au/en/Agencies/Charges-and-free-services/Free-Interpreting-Service)
- [AIHW — GP care for aged care residents](https://www.aihw.gov.au/reports/aged-care/gen-aged-care-data)
- [Medical Republic — software vendors left holding the assignment of benefit bag](https://www.medicalrepublic.com.au/software-vendors-left-holding-the-assignment-of-benefit-bag/126623)
