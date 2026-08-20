# Departmental FAQ — Reconciliation and Corrections
### Source: *Assignment of Medicare Benefits for Bulk Billing — Frequently Asked Questions*, DoHDA, as at 16 July 2026 (40pp)
### Reviewed 19 August 2026 · Corrections to Brief v1, Requirements v0.2, Solution Design v0.1

This is the primary source I had been unable to read. It **overturns two things I told you**, **resolves four open blockers**, and **surfaces six requirements nobody had**.

---

## PART A — Corrections. I was wrong about these.

### A1. ❌ MyMedicare enduring agreements are PER PRACTITIONER, not per location

**What I told you:** the MyMedicare pathway anchors to the practice/location — one agreement covering all GPs there. I also told you ClinicComply was "wrong or loosely worded" for saying one-per-practitioner.

**What the FAQ says**, stated four separate times (pp. 6, 34, 37, 38):

> "A patient registered with MyMedicare will be able to make enduring agreements to receive services from all general practitioners at their MyMedicare practice, if offered. **Agreements are per practitioner, but multiple agreements can be made at the same practice.**"

**ClinicComply was right and I was wrong.** I should not have called it against a secondary reading of the instrument.

**Why this matters more than it looks.** Every enduring pathway is now **per-practitioner**: MyMedicare, aged care, and (effectively) ACCHO via the organisation's agent. A 10-GP practice converting 2,000 MyMedicare patients isn't creating 2,000 agreements — it's potentially creating **up to 20,000**. The batch-enrolment tool (REQ-END-08) moves from useful to essential, and the data model must be practitioner×patient, not practice×patient.

### A2. ❌ The Basic Service Description IS published, and IS machine-readable

**What I told you:** blocker — location unfound, no machine-readable schema, 16 vs 28 categories disputed, build the mapping as a hand-maintained table.

**What the FAQ says** (p. 24):

> "the 'Health Insurance Regulations 2018 - Basic Service Description for Assignment of Medicare Benefit' document will be uploaded to the downloads section on **MBS Online**... The document will be available as an **XML and CSV**. The Basic Service Description will be **updated quarterly** in line with regular updates to the XML fee file (being **1 January, 1 July, 1 March, and 1 November**)."

Also confirmed: the **standard MBS XML fee file does NOT contain** the basic service description classifications — it's a separate download.

**REQ-REG-03 is unblocked.** Ingest the XML/CSV from MBS Online. Build a quarterly refresh job against those four dates. The versioned-mapping design stands and is now more clearly right, because the mapping moves four times a year.

---

## PART B — Blockers resolved

### B1. ✅ DVA and CDBS are out of scope — confirmed at primary source

> "AoB requirements outlined in this factsheet **do not apply to patients accessing health care funded by the Department of Veterans' Affairs or under the Child Dental Benefits Scheme**." (p. iii)

Removes the single-sourced-vendor-KB caveat. Requirements §0.2 stands; add CDBS to the exclusion list.

### B2. ✅ DB4E and DB020 are updated and usable — for post-assignment only

> "You will be able to use an **updated** DB4e or DB020 form from 1 July 2026 to make an episodic **post**-assignment of benefit agreement... **Prior versions of 'approved forms' will no longer meet the requirements** for a valid AoB agreement. All other DB forms will continue to be available through the existing stationery ordering process." (p. 8)

**Design consequence for the compliance tester (REQ-TEST-03):** don't flag "DB4E/DB020" as legacy. Flag **pre-1 July 2026 versions** of them. The tester needs to distinguish the updated form from the old one — which is exactly the check a practice can't do by eye, and therefore exactly the check worth offering.

### B3. ✅ No form certification — confirmed, in the Department's own words

> "**The Department is unable to review, approve or provide assurance on assignment of benefit agreement templates developed by individual providers.** Providers are responsible for ensuring their agreements comply with legislative requirements and should seek independent legal advice if required." (p. 11)

This is the strongest possible validation of the s 65C compliance tester. The Department has explicitly declined to do this job and told providers to go get legal advice. A free, versioned, documented checker sits precisely in that vacuum.

### B4. ⚠️ But there IS a conformance process — with Services Australia, for software

> "Providers are encouraged to consult their software vendor to determine whether assignment of benefit agreements can be created, recorded and retained through their practice management software. **Many software vendors have completed a conformance process undertaken with Services Australia** in preparation for incoming AoB requirements." (p. 11)

And separately (p. 28): a **Notice of Integration (NOI)** is referenced for connections to Services Australia's systems, via the Health Systems Software Developer Portal.

**This changes my advice on Requirements D-10.** I said "probably don't pursue Services Australia developer registration in v1, we don't lodge claims." That may be wrong. If practices are being told by the Department to ask whether their vendor completed conformance, then **"we completed the Services Australia conformance process" becomes a purchasing question you will be asked**, regardless of whether you technically need it. Worth a direct call to Services Australia's Developer Liaison to establish what the AoB conformance process actually covers and whether a non-claiming vendor can complete it.

---

## PART C — Six requirements nobody had

### C1. 🔴 The 6-month episodic pre-agreement — and it is fragile by design

You flagged this and you were right to. From p. 27:

> "Regulations also provide for an episodic pre assignment agreement to cover **multiple known services for a period up to six (6) months**. This will enable patients who are scheduled to receive regular medical care (for example patients who receive regular dialysis, are undergoing cancer treatment, or receiving palliative care) to make **one agreement which captures all known appointments**."

> "will require the information for **each service** to be specified, and delivered by the **same medical professional, on specified dates**. If any of the information set out in changes (for example the date of a service is changed, or a different professional renders a service at an appointment), then a **new episodic pre or post assignment agreement will be required**."

**This is a trap dressed as a convenience.** A 6-month dialysis or chemo schedule is exactly the kind of thing that changes — a rescheduled appointment, a covering doctor, a treatment adjustment. Any one of those voids the agreement for that service. And the cohort is the least able to absorb a billing failure: dialysis, oncology, palliative care.

**Feature: Treatment Plan Assignment (new, REQ-PLAN-\*).**

- Create one pre-agreement covering a scheduled series: same practitioner, enumerated dates, specified services
- **Watch the schedule.** Monitor the PMS appointment book against the agreement's enumerated dates and practitioner
- **Break detection.** On any date change, practitioner substitution, or service change, immediately mark the affected occurrence `assignment_void` and raise it
- **Auto-remediate.** Generate a replacement pre-agreement for the changed occurrence if known in advance, or queue a post-agreement if not — without touching the rest of the series
- **Never silently void the whole plan.** Only the affected occurrence breaks; the remaining dates stand
- Dashboard: plans at risk, occurrences voided, remediation outstanding

Nobody is building this. It is high-value, low-competition, and it protects the most vulnerable billing in the practice.

### C2. 🔴 Enduring agreements are GP-ONLY

> "Medical professionals who are **General Practitioners (GPs)** within these settings can enter an enduring agreement (**this excludes a consultant physician, or a specialist, in a particular speciality other than general practice**)." (p. 38)

> "**Any GP services** can be entered into an enduring agreement." (p. 39)

**Corrects my solution design.** I presented enduring as the compounding lever across the product. It is not available to specialists, allied health, optometry, or any non-GP provider. For the entire non-GP market — 28m allied health attendances, 11m optometry services, 35.6m specialist attendances — **episodic capture is the only option, forever.**

That actually sharpens the multi-profession thesis rather than weakening it: allied health and optometry have **no relief mechanism at all**, no enduring escape hatch, and the worst software coverage in the market. The 6-month treatment plan agreement (C1) becomes their only volume tool.

### C3. 🔴 Enduring agreements bind the provider to bulk bill

> "once the agreement is agreed upon, **the provider is required to bulk bill the patient (or assignor) for any future in-scope services until the agreement is terminated**. If a provider wishes to change the scope of services under an enduring agreement, **the existing agreement will need to be terminated and a new enduring agreement with a revised service scope made**." (p. 39)

This is a **commercial commitment, not just an admin convenience** — and no vendor is framing it that way to practices. Design consequences:

- **Scope selection is a serious decision.** Service scope can be set at MBS **Category, Group, Subgroup, or Item level, or a combination**. A practice that scopes broadly has bound itself to bulk bill broadly.
- Provide a **scope preview**: "this scope commits you to bulk bill these item numbers for this patient until terminated." Show the items. Show the count.
- **Scope change = terminate + recreate.** Model it as a first-class workflow, not an edit.
- Suggested default: scope to **BBPIP-eligible services**, which the FAQ itself offers as the example (p. 39). It aligns the commitment with the incentive the practice is already claiming.

### C4. 🔴 Termination is 2 BUSINESS DAYS, and the patient always holds the right

> "An enduring agreement may be terminated at any time by either party providing written notice to the other party. **A patient may also terminate an enduring agreement, even if another person originally entered into the agreement on their behalf.** Once written notice is given, **the agreement ends after 2 business days**." (p. 37)

Two business days, not two days. And the patient's termination right over an agreement they didn't sign confirms the patient-portal revocation feature (REQ-PORT-05) is not a nice-to-have — it is the only practical way to honour a right the regulation grants.

### C5. 🔴 Multiple services and multiple practitioners — the same-day rules

From p. 30:

| Scenario | Rule |
|---|---|
| Multiple services, **same practitioner**, same day | **May** be covered by a single AoB agreement, if the services correspond to those listed |
| Multiple services, multiple practitioners, **different practices**, same day | **Separate** AoB agreements required |
| Multiple services, multiple practitioners, **same practice**, same day | **Separate** AoB agreements required |

And from p. 26, on pre-assignment: if the rendering practitioner differs from the one named, you need an updated pre-service or a post-service agreement — **"If the information in the AoB agreement does not match the claim, it does not meet legal requirements for that claim."**

**Design consequence:** the agreement is scoped to **practitioner × patient × day**, and the system must split automatically when a patient sees two providers in one visit. A patient seeing the GP and then the practice nurse under a separate provider number needs two agreements. Getting this wrong produces invalid claims that look fine.

Also p. 36, home visits: where one assignor assigns for **multiple patients** in a single home visit (a parent for several children, a carer in a household), **each patient's assignment must be separately documented and clearly identify the relevant patient and service.**

### C6. 🟡 Electronic signature — the ETA test is more specific than I said

> "Where an electronic signature is used, it must meet the requirements of the **Electronic Transactions Act 1999 Part 2, Division 2, Section 10**. It must:
> - **reliably identify the assignor**
> - **reliably indicate assignors' agreement (by requiring an action)**
> - meet all other privacy and information technology requirements." (p. 19)

> "Examples of an electronic signature may include a patient **signing on a tablet or touch screen**, **typing their name** into an electronic form where this is used to indicate agreement, **clicking 'I accept'** on an online form, or using a **secure digital signature process**." (p. 35)

**A partial correction to what I told you.** I said there is "no legal requirement to verify identity" and that your three-point check is purely a differentiator above the floor. That's still substantially true — the ETA test is about the *reliability of the method*, not identity-proofing of the person — but **"reliably identify the assignor" is a statutory element of a valid electronic signature**, and it appears in the Department's own guidance.

**Revised positioning, which is stronger and still honest:**

> The Electronic Transactions Act requires an electronic signature to *reliably identify the assignor*. A link sent to a phone number does not, on its own, do that. We verify three RACGP-approved identifiers before the form is displayed — so the signature we capture meets the ETA reliability test and aligns with RACGP Standards 5th ed C6.1A.

Still don't say "Medicare requires three identifiers." Do say the ETA requires the signature to reliably identify the signer, and explain how you achieve that. That is defensible, accurate, and a genuine competitive argument against every tap-to-approve-on-an-SMS-link implementation in the market — which is nearly all of them.

Note also the FAQ's explicit privacy warning, twice (pp. 14, 31): the assignor is being shown **health-related information about the patient**. Protecting patient privacy "should be taken into account in all transactions." That is an argument for verification, from the Department, in the Department's own document.

---

## PART D — Clarifications worth capturing

**Verbal assignment is a fallback, not a free choice.** > "**Verbal agreement is ok when other options are unavailable.**" (p. 12) Not "verbal is fine for 12 months." The compliance-risk warning in REQ-REG-10 should reflect that framing.

**And the verbal regulation still isn't made.** > "To enable these agreements, **Medicare regulations need to change. The department is prioritising this work.** The intent is that changes cover agreements made from 1 July 2026." (p. 12) As at 16 July 2026 the verbal concession was **still an announced intention, not law** — confirming the earlier flag. Practices relying on verbal today are relying on retrospective regulation that has not yet been made.

**Verbal still requires the full agreement.** Present the assignor with the same details used to make a written agreement, enter `assignor verbally agreed` in the signature field, store the completed agreement, **and send it to the patient electronically.** Verbal removes the signature, not the document.

**Patient declines → private bill.** (p. 21) Issue an invoice so they can claim from Services Australia. In a pre-assignment scenario the patient may defer the decision until after the service. For unpaid/partially paid accounts, the **90-day pay doctor cheque scheme** applies. The product needs a clean `declined → private bill` path, not a dead end.

**Public hospital patients:** public patients under the NHRA — no MBS claims at all. Privately elected patients follow normal AoB, capturable at private election or check-in. (p. 32)

**Pathology transitional:** request forms issued **before 1 July 2026 remain valid for AoB for up to 12 months**. Old printed notepads used after that date need the missing data added at specimen collection — typically assignment type and assignor-is-patient. (pp. 18, 22–23)

**Rejected and resubmitted claims:** if the original assignment was obtained before 1 July 2026 and the resubmission occurs after, the practice **must obtain a new compliant agreement**. (p. 29) This is a live, dated trap for any practice reworking old rejections — and a good hook for the compliance tester.

**Pre-assignment capture points, named by the Department:** > "online booking applications, **check-in kiosks**, or other mechanisms." (p. 25) The Department explicitly contemplates kiosk capture. Nobody has shipped it.

**Scope tolerance on pre-agreements:** if the rendered service falls **inside** the basic service description, the agreement stands. Outside it, a post-service agreement is required. (p. 16) The basic service description is deliberately broad so providers can vary MBS items without re-signing — so the system should check *scope containment*, not item equality.

**The new data set could be used before 1 July 2026** (p. 28), and AoB agreements **are not submitted to Services Australia** except for manual claims — they are held by the provider (p. 20). Confirms the distributed-evidence model.

---

## PART E — The one thing the FAQ does NOT resolve

**The Services Australia registration requirement for enduring agreements.**

My earlier research read `65CB(5)(h)` (registration required for agreements entered on or after 1 July 2027) and `65CA(8)(e)` (pre-30 June 2027 agreements cease unless registered before their first anniversary) directly from the instrument text of F2026L00824.

**This 40-page FAQ, dated 16 July 2026 — three weeks after that instrument was made — does not mention registration anywhere.** It describes termination and automatic cessation in detail (p. 37) and lists the cessation triggers without including a registration deadline.

Three possibilities, and I can't yet tell which:

1. The registration requirement exists and the FAQ simply hasn't caught up (it is described as a living document, "we will continue to update guidance and FAQs")
2. My earlier reading of the instrument was wrong
3. It was drafted and then removed or deferred

**This is now the single highest-priority verification item**, because it determines whether every enduring agreement your design partner creates has a 12-month fuse. Resolve it by reading F2026L00824 §65CA(8) and §65CB(5) directly, and by emailing **AssignmentofBenefit@health.gov.au**. Until then, treat REQ-END-03 and REQ-END-04 as **suspected but unconfirmed** — build the anniversary tracking (it's cheap and harmless if unnecessary) but do not make it a marketing claim.

---

## Actions

| # | Action | Priority |
|---|---|---|
| 1 | Resolve the enduring **registration** question — instrument text + Departmental email | 🔴 Highest |
| 2 | Download the **Basic Service Description XML/CSV** from MBS Online; build quarterly ingest (1 Jan / 1 Mar / 1 Jul / 1 Nov) | 🔴 Unblocks REQ-REG-03 |
| 3 | Rework the enduring data model to **practitioner × patient** | 🔴 Corrects A1 |
| 4 | Call Services Australia Developer Liaison re the **AoB conformance process** and NOI — is it available to a non-claiming vendor? | 🟠 Revises D-10 |
| 5 | Spec **Treatment Plan Assignment** (6-month pre-agreement with break detection) | 🟠 New, uncontested |
| 6 | Add **scope-commitment preview** to enduring; model scope change as terminate+recreate | 🟠 |
| 7 | Update the compliance tester to distinguish **pre- vs post-1 July 2026 DB4E/DB020** | 🟠 |
| 8 | Revise verification positioning to the **ETA s 10 "reliably identify the assignor"** argument | 🟢 Stronger and still honest |
| 9 | Add `declined → private bill` path incl. 90-day pay doctor cheque scheme | 🟢 |
| 10 | Enforce **practitioner × patient × day** agreement scoping; auto-split multi-provider visits | 🟢 |

---

*Reconciled against: Brief v1 (19 Aug 2026), Requirements v0.2, Solution Design v0.1.*
