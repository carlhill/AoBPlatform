# AoB Consent & Compliance Record — Requirements
### v0.4 · 19 August 2026 · Working draft

> **v0.3 incorporates the Departmental FAQ (16 July 2026).** See the companion **FAQ Reconciliation** document for the full delta. Two corrections are material: enduring agreements are **per practitioner**, not per location; and the Basic Service Description **is** published as XML/CSV on MBS Online, updated quarterly.

**Product thesis.** Not a generic AoB form platform. A **consent-and-compliance-record product**, using the Medicare Assignment of Benefit obligation as the wedge, aimed at the PMS segments the engagement layer has ignored — Medtech first.

**Design partner:** a general practice running **Medtech Evolution**, which has no AoB solution and no publicly announced plan for one.

**Window:** now → 30 June 2027 (when the verbal-assignment concession ends). After that the urgency evaporates and the majors will have caught up.

---

## 0. Scope

### 0.1 In scope for v1

- Episodic **pre-agreement** and **post-agreement** capture for ordinary MBS services (s 65C(4) table items 5 and 6)
- In-practice capture (tablet/kiosk) as the primary channel; SMS/email link as fallback
- Patient identity verification before form display
- Compliant agreement generation, storage, retrieval and 2-year retention
- Audit trail and evidence export
- Medtech Evolution integration

### 0.2 Explicitly out of scope for v1

- Pathology and diagnostic imaging agreements (s 65C(4) items 1–4 — different data sets, R-type statements, determinable-services statements)
- Simplified billing / ECLIPSE (ss 65D–65E — separate regime, no transition concession, already live)
- **DVA and the Child Dental Benefits Scheme (CDBS)** — confirmed excluded at primary source: *"AoB requirements outlined in this factsheet do not apply to patients accessing health care funded by the Department of Veterans' Affairs or under the Child Dental Benefits Scheme."* (FAQ p. iii)
- Claim lodgement itself (we produce and hold the agreement; the PMS or rail lodges)
- Payment processing

### 0.3 Deferred but architecturally reserved

- **Enduring agreements** (MyMedicare, residential aged care, ACCHO/AMS) — largest open gap in the market, nobody has shipped it, spec reportedly never provided to vendors. Data model must not preclude it.
- Additional PMS integrations (Gentu/Genie, Clinic to Cloud, Shexie, and the allied stack: PracSuite, Nookal, Splose, Coreplus, Zanda)
- Adjacent consent types (MyMedicare registration, chronic disease management, telehealth, privacy, financial consent)

---

## 1. Regulatory requirements — the s 65C data set

Source of truth: **Health Insurance Regulations 2018, Division 7A, s 65C**, inserted by [F2025L00983](https://www.legislation.gov.au/F2025L00983/asmade/text).

### REQ-REG-01 — Mandatory data elements (s 65C(4))

Every generated agreement MUST contain:

| ID | Element | Source | Notes |
|---|---|---|---|
| D1 | Name of the person to whom the service is/will be rendered | PMS patient record | The **patient**, not necessarily the assignor |
| D2 | Date the agreement is proposed to be entered into | System | Not the service date |
| D3 | Whether it is an episodic **pre**-agreement or **post**-agreement | System | Drives which of D5/D6 applies |
| D4 | Identifying details of the professional | PMS provider record | See REQ-REG-02 |
| D5 | Date the service **will be** (pre) or **was** (post) rendered | PMS appointment/invoice | |
| D6a | **Basic description** of the service — pre-agreements only | Mapping table | See REQ-REG-03 |
| D6b | **MBS item number(s)** — post-agreements only | PMS invoice | |
| D7 | Whether the assignor is the patient | Capture flow | s 65C(6)(b) — explicit field, not inferred |

### REQ-REG-02 — Provider identifying details (s 65C(5))

System MUST support **either**:
- (a) provider name **+** address of the place of practice at time of service, **or**
- (b) provider number for that place of practice

**A provider number is NOT mandatory.** Implement (a) as the default and (b) as an option — this materially lowers the data-quality bar for onboarding a new practice.

### REQ-REG-03 — Basic Service Description mapping

Pre-agreements require a "basic description" drawn from a Departmental document incorporated by reference into the regulations, mapping ~4,600 MBS items into a set of broad categories.

- **✅ RESOLVED (FAQ p. 24).** The *Health Insurance Regulations 2018 - Basic Service Description for Assignment of Medicare Benefit* document is published in the **downloads section of MBS Online**, available as **XML and CSV**, and **updated quarterly on 1 January, 1 March, 1 July and 1 November** in line with the MBS XML fee file.
- **Note:** the standard MBS XML fee file does **not** contain the basic service description classifications. It is a separate download.
- **Action:** build an ingest job against those four quarterly dates. Every generated agreement records which mapping version produced it — the mapping moves four times a year, so versioning is essential, not optional.
- Scope test on pre-agreements is **containment, not equality**: if the rendered service falls inside the basic service description, the agreement stands; outside it, a post-service agreement is required (FAQ p. 16). The description is deliberately broad so providers can vary MBS items without re-signing.
- Constraint observed in Bp: one basic service description per pre-agreement form. Decide whether we accept the same constraint or support multiple (see §9, D-04).

### REQ-REG-04 — NOT required (do not add)

- **No benefit or dollar amount.** The data set contains no fee or benefit figure.
- **No prescribed assignment wording.** No mandated form of words was found anywhere in ss 65A–65E.

Adding either creates a field to maintain, a thing to get wrong, and a reason for a patient to query. Keep the artefact minimal.

### REQ-REG-05 — Form requirements (s 65C(6))

The agreement MUST: contain the D1–D7 data; state whether the assignor is the patient; be a **written document**; be **signed by the assignor**.

- Practitioner signature is **abolished** (since 1 July 2026). Do not collect one.
- Assignor may be someone other than the patient — parent, partner, carer, relative, POA holder, or friend. Capture assignor name and relationship.

### REQ-REG-06 — Particulars complete before signature

All D1–D7 particulars MUST be rendered and locked **before** the signature control is enabled. Presenting a blank or partially completed form for signature is the specific offence (up to $1,000 or 3 months imprisonment, MBS Note AN.0.18).

**Implementation:** the signature control is disabled until the agreement payload validates. The system MUST NOT permit signature capture against a draft.

### REQ-REG-07 — Signature

- Wet ink OR electronic. Test is **intention**, satisfying the **Electronic Transactions Act 1999**. Signature must be "identifiable and auditable".
- No cryptographic or digital-certificate requirement. A tick-box, an APPROVE button, or a drawn signature all qualify.
- **Decision:** capture a drawn signature on tablet (highest evidentiary quality, lowest incremental cost) and a tap-to-approve on remote link.

### REQ-REG-08 — Patient copy

Provide a copy of the completed agreement to the patient **as soon as practicable on request**. Not automatic under the regulation — but implement automatic delivery (SMS/email link to a copy, or print) as the default, because it is cheap and removes an entire class of complaint.

### REQ-REG-09 — Retention

- **2 years from the date of the related claim** — not from the service date. The retention clock is anchored to an event our system may not observe directly (see REQ-INT-04).
- Longer in defined cases: late claims, adjustments, notifications, active compliance activity. System MUST support a **legal hold** flag that suspends deletion.
- Obligation to destroy or de-identify when no longer required — implement scheduled deletion, not indefinite retention.
- Simplified billing records: 7 years (out of v1 scope, but do not build a 2-year assumption into the schema).

### REQ-REG-10 — Timeline behaviour

| Date | System behaviour |
|---|---|
| Now → 30 Jun 2027 | Verbal assignment recordable as a **fallback only** — FAQ p. 12: *"Verbal agreement is ok when other options are unavailable."* Enter "assignor verbally agreed" in the signature field, store the completed agreement, **and send it to the patient electronically**. Verbal removes the signature, not the document. Surface a compliance-risk warning: as at 16 July 2026 the enabling regulation **had not yet been made** — *"Medicare regulations need to change. The department is prioritising this work."* |
| 1 Jul 2027 | Verbal capture disabled by default; requires explicit override with reason recorded |

**Treat verbal as forbearance, not law.** No instrument authorising verbal assignment was found; s 65C(6) on its face has required a signed written document since 1 July 2026. The product should let practices use it while making the risk visible — that framing is also the sales argument.

---

## 2. Patient verification

### REQ-VER-01 — Three approved identifiers before form display

> **How do you verify the person clicking the link is the assignor?**
>
> Patient verification is required. We comply with the RACGP *Standards for General Practices* (5th edition) and require **three points of identification before the form is displayed**.

Implements **RACGP Standards 5th ed, Criterion C6.1, indicator C6.1A** — *"Our practice identifies patients using a minimum of three approved patient identifiers."* C6.1 explicitly extends to identifying patients "over the telephone or electronically."

### REQ-VER-02 — Approved identifier set

The **only** valid identifiers (RACGP 5th ed):

1. **Name** (family + given names together count as **one** identifier)
2. **Date of birth**
3. **Gender** (as identified by the patient)
4. **Address**
5. **Patient health record number**
6. **Individual Healthcare Identifier (IHI)** — 16-digit

**⚠️ The Medicare number is explicitly NOT an approved identifier.** RACGP excludes it because not all residents have one and family members share a card number, so it is not unique to an individual. This is counter-intuitive in a Medicare product and must be enforced in code — it is the single most likely design mistake in this feature.

### REQ-VER-03 — Verification flow

- Remote link: challenge for **three identifiers the patient states**, not identifiers we display for confirmation (RACGP guidance is that staff ask the patient to state them). For a self-service form this means **input fields, never a "is this you? Y/N" confirmation screen**.
- Match against PMS-held values. Form is not rendered until all three match.
- **Rate limiting and lockout** after N failed attempts (see §9, D-06 for N), with practice notification.
- Configurable identifier set per practice (which three we challenge), because data completeness varies — but minimum three enforced, and the excluded-Medicare-number rule is not configurable.
- In-practice tablet flow: verification is performed by **staff at check-in** against the same three identifiers, recorded as staff-verified with the staff member's identity.

### REQ-VER-04 — Evidence

Every verification event records: identifiers challenged (types, **never values**), outcome, timestamp, channel, IP/device fingerprint, and — for staff-verified — the staff member. Retained with the agreement.

### REQ-VER-05 — Anti-impersonation

- **ACMA SMS Sender ID Register** registration is mandatory before go-live. Unregistered sender IDs display to patients as "Unverified" and are grouped as potential scams — which destroys response rates and creates a genuine phishing-confusion risk.
- Links must be practice-branded, short-lived (see §9, D-05), single-use, and non-enumerable.
- Publish a "how to tell our SMS is real" page the practice can point patients to.

### REQ-VER-06 — Watch item: RACGP 6th edition

A **draft 6th edition** was released for consultation in September 2025. The identification criterion is renumbered to **CG2** and the draft indicator appears to require a **minimum of TWO** approved identifiers, plus documenting which identifiers were used in the patient health record. AGPAL corroborates the direction ("not prescriptive, unlike the 5th edition").

- **Not in force.** As at 19 Aug 2026 RACGP still says the 6th edition "will be published shortly"; the 5th edition remains the accreditation standard. A 12-month transition from publication is expected (vendor-sourced, unconfirmed).
- **⚠️ The "two identifiers" reading is single-sourced from a machine read of the draft PDF and must be verified page-by-page before it appears in any customer-facing claim.**
- **Requirement:** make the identifier count **configurable with a floor**, defaulting to 3. Add CG2.A's "document the identifiers used in the patient health record" behaviour now — it is cheap and is likely to become the standard.

### REQ-VER-07 — Honest positioning

⚠️ **REVISED after the FAQ.** There is still no rule mandating a three-identifier check on an AoB link — but the position is stronger than first stated. FAQ p. 19 sets out the **Electronic Transactions Act 1999, Part 2, Division 2, s 10** test that an electronic signature MUST meet:

> - **reliably identify the assignor**
> - **reliably indicate assignors' agreement (by requiring an action)**
> - meet all other privacy and information technology requirements

"Reliably identify the assignor" is a statutory element of a valid electronic signature. A link sent to a phone number does not, on its own, satisfy it.

**Permitted positioning:** *"The Electronic Transactions Act requires an electronic signature to reliably identify the assignor. We verify three RACGP-approved identifiers before the form is displayed, so the signature meets the ETA reliability test and aligns with RACGP Standards 5th ed C6.1A."*

**Still not permitted:** "Medicare requires three identifiers." It does not.

Supporting argument, from the Department, twice (FAQ pp. 14, 31): the assignor is being presented with **health-related information about the patient**, and *"protecting the patient's privacy is important and should be taken into account in all transactions."*

---

## 3. The s 65C conformance check

**Context.** There is **no approval, certification or registration process** for third parties producing compliant AoB forms. The approved-form mechanism was deliberately abolished. Vendors self-assess against s 65C.

Nobody can claim a certified moat — so the substitute is a **documented, versioned, auditable self-certification** that a practice can hand to an auditor. Build the check as a product feature, not an internal test.

### REQ-65C-01 — Conformance validator

A rules engine that validates every agreement payload **before** the signature control is enabled (per REQ-REG-06) and again at storage.

| Rule | Assertion | Failure mode |
|---|---|---|
| C1 | D1 patient name present and non-empty | Block |
| C2 | D2 agreement date present, valid, not future-dated beyond tolerance | Block |
| C3 | D3 pre/post flag set explicitly | Block |
| C4 | D4 satisfies s 65C(5)(a) OR (b) — name+address, or provider number | Block |
| C5 | D5 service date present; consistent with D3 (pre ⇒ future/today, post ⇒ today/past) | Block |
| C6 | If pre: D6a basic description present and drawn from the current mapping version | Block |
| C7 | If post: D6b at least one valid MBS item number present | Block |
| C8 | D7 assignor-is-patient flag set; if false, assignor name and relationship present | Block |
| C9 | Signature present, non-empty, with capture method recorded | Block |
| C10 | No practitioner signature collected | Block (defensive) |
| C11 | No benefit/dollar amount present in the artefact | Warn |
| C12 | Particulars locked before signature timestamp | Block |
| C13 | Verification event present and passed (REQ-VER-01) | Warn — not legally required, but our standard |
| C14 | Agreement created before claim lodgement, where lodgement is observable | Warn |

### REQ-65C-02 — Versioned rule set

The rule set is versioned and every stored agreement records the **rule-set version** and **Basic Service Description mapping version** that validated it. When the regulation moves — and it has already moved twice, plus one reversal eight working days before go-live — practices must be able to prove what standard applied on the day.

### REQ-65C-03 — Conformance statement

Generate an exportable, human-readable **s 65C Conformance Statement**: which regulation version, which rules, what evidence is held, what the retention position is. This is the artefact a practice manager hands to an auditor, and it is the thing that makes an unaccredited product credible.

### REQ-65C-04 — Regulatory change watch

Named owner, documented process, monitoring: legislation.gov.au (Health Insurance Regulations 2018 compilations), MBS Notes AN.0.12 and AN.0.18, DoHDA AoB collection, RACGP advocacy pages. **Log every check with a date, even when nothing changed** — this is itself evidence of a compliance process.

### REQ-65C-05 — No overclaiming

Marketing MUST NOT use "certified", "approved", "government-approved" or "accredited" in relation to the form. No such status exists. Permitted framing: "built to the s 65C data set", "self-assessed against s 65C with a documented conformance statement".

---

## 4. Capture channels

### REQ-CAP-01 — In-practice tablet/kiosk (PRIMARY, and the differentiator)

**No vendor has shipped a documented kiosk or tablet AoB capture flow.** Best Practice explicitly states tablet capture is unavailable. The trade press ranks in-practice signature-before-the-patient-leaves as the best workflow precisely because it eliminates the non-response problem that generates all the downstream labour.

- Pre-agreement capture at check-in
- Staff-assisted verification (REQ-VER-03)
- Drawn signature
- Accessible: large text mode, high contrast, screen-reader support, staff-assisted mode for patients who cannot use the device
- Works offline with deferred sync — practices lose internet and cannot stop seeing patients

### REQ-CAP-02 — SMS link (FALLBACK)

For patients who left without signing, telehealth, and pre-appointment capture.

- ACMA-registered sender ID (REQ-VER-05)
- Practice-branded, expiring, single-use link
- Configurable reminder cadence
- **Design assumption: 15–20% will not respond.** The reconciliation workflow (REQ-REC-01) is not an afterthought — it is where the customer's pain actually lives.

### REQ-CAP-03 — Email link

Best Practice has **no email channel** and HotDoc restricts SMS to telehealth only. Email is cheap, has no per-message cost, and is a genuine gap. Same verification, expiry and single-use rules.

### REQ-CAP-04 — Paper fallback

Print a compliant agreement with all particulars pre-filled, for wet signature and scan-back. Scanned artefact attaches to the same record with the same validation and retention. Rural, elderly, and no-mobile-coverage patients are not an edge case — RACGP's stated objection to the whole regime is precisely about this cohort.

### REQ-CAP-05 — Verbal (until 30 June 2027)

Record "assignor verbally agreed" per Departmental guidance, with staff identity, timestamp, and a mandatory acknowledgement that this is a transition-period position. Auto-disable after 30 June 2027 (REQ-REG-10).

---

## 5. Reconciliation and practice workflow

### REQ-REC-01 — Outstanding agreements queue

The core operational screen. Modelled burden: a practice seeing 60 bulk-billed patients/day should expect **9–12 chase calls/day plus 30–45 minutes of end-of-day admin**. Cost estimates run **$4,000–5,000 per FTE GP in year one**. Reducing that is the ROI story.

- All services without a valid agreement, ranked by claim-lodgement urgency
- One-click resend across channels
- Bulk actions
- Age indicators against the claim window (bulk bill claim lodgement window is now **1 year**, reduced from 5 years in Sept 2025)

### REQ-REC-02 — Status model

`draft → verification_pending → verification_failed → awaiting_signature → signed → validated → stored → claim_linked → retention_expiry_scheduled`, plus `expired`, `declined`, `verbal_recorded`, `legal_hold`.

### REQ-REC-03 — Practice dashboard

Capture rate by channel, by provider, by day. Non-response rate. Average time-to-signature. Outstanding count and ageing. Verbal-usage count with a countdown to 30 June 2027 — visible risk drives behaviour change and renewals.

### REQ-REC-04 — Never block care

The system must never prevent a service being rendered or a patient being seen. AoB capture failure is a billing-workflow problem, not a clinical gate. Any design that leans on withholding care is both wrong and unsellable.

---

## 6. Integration — Medtech Evolution first

### REQ-INT-01 — Design-partner integration

**Medtech Evolution.** No public AoB communication found from Medtech Global (owned by Banyan Software since Feb 2025) — the most conspicuous silence among GP PMS vendors. The engagement layer (HotDoc, HealthEngine) supports only Best Practice, MedicalDirector and partially Zedmed. Medtech practices currently have **no path**.

Required from the integration:
- Read: patient demographics (for the three identifiers), appointments, providers, invoices/item numbers
- Write: the signed agreement artefact **into the patient record**, so the compliance evidence lives where an auditor looks

### REQ-INT-02 — Write-back is the product

If the artefact cannot land in the PMS patient record, this is a form, not a compliance product. **Establish the write-back mechanism before building anything else.** In order of preference: documented API → supported integration partner program → file/HL7 drop → scan-in as a last resort.

### REQ-INT-03 — Integration abstraction

Build a PMS adapter interface from day one. Second and third integrations are the growth path and must not require re-architecting. Candidate order after Medtech: Gentu/Genie (Magentus admits its release does not store the signed form), then the allied stack (Coviu is already at Gentu/Cliniko/Nookal — that is validation and competition simultaneously).

### REQ-INT-04 — Claim linkage

Retention runs 2 years **from the claim**, not the service. Either observe the claim event via the PMS, or record the practice's asserted lodgement date. Where neither is available, default the clock conservatively to the service date + buffer and flag the record.

### REQ-INT-05 — Payment rail coexistence

Practices using Tyro Easyclaim get a **paper-only** artefact with no digital file returned to the PMS. HICAPS captures AoB data on-terminal. The product must **not** double-capture where a rail already has it — detect and suppress, or the front desk will hate it within a week. Positioning: rail integration alone does not deliver compliance; we complete it.

---

## 7. Non-functional requirements

### REQ-NFR-01 — Privacy and data

- Australian health information under the Privacy Act 1988 and APPs; state health records legislation where applicable
- **Australian data residency**, no offshore processing
- Encryption in transit and at rest
- Data minimisation: hold the minimum to produce the artefact. **Never store identifier values in verification logs** — types and outcomes only.
- Deletion/de-identification on retention expiry, with legal hold override

### REQ-NFR-02 — Automated decision-making transparency

**APP 1.7 / 1.8** (Privacy and Other Legislation Amendment Act 2024) commence **10 December 2026**. They require privacy-policy disclosure of personal information used in automated decision-making, decisions made solely by ADM, and decisions where ADM performs a substantially and directly related function. The trigger is a computer program using personal information to make or substantially support a decision that "could reasonably be expected to significantly affect the individual's rights or interests" — and it captures rules-based tools, not just AI.

Identity-verification matching is plausibly in scope. **Draft the privacy policy disclosure now**, before December, and keep any verification logic explainable and human-overridable.

### REQ-NFR-03 — Availability and resilience

- Capture must degrade gracefully: offline tablet mode, paper fallback always available
- No single point of failure that stops a practice billing
- Target availability and RPO/RTO: see §9, D-07

### REQ-NFR-04 — Auditability

Immutable, append-only audit log. Every state transition, every verification attempt, every validation result, every access to a stored agreement. Exportable in a form a Services Australia auditor or PSR committee would accept.

### REQ-NFR-05 — Accessibility

WCAG 2.2 AA on all patient-facing surfaces. This is not box-ticking: RACGP's central objection to the AoB regime is that it disadvantages elderly, disabled, low-literacy, homeless and digitally excluded patients. A product that handles that cohort well has a real advantage, and one that doesn't will be blamed for the regime's own flaws.

### REQ-NFR-06 — Security posture

Anticipate practice and PMS-vendor security review. If Services Australia integration is ever in scope, their **Integrated Third Party Security Policy** and Interface Agreement apply. Assume a security questionnaire on every enterprise deal.

---

## 8. Commercial and competitive constraints on the build

These are requirements because they constrain design, not just pricing.

- **HotDoc and HealthEngine bundle AoB capture at zero marginal cost** into subscriptions covering 10,000–20,000+ practices. We cannot win on price on the AoB feature alone. The product must carry value they don't — in-practice capture, uncovered PMS, enduring agreements, and the broader consent record.
- **Reference prices:** Bp Premier ~$1,489/yr per full-time doctor (~$124/mo); HotDoc from ~$170/mo for 2 practitioners; AutoMed's AoB utility is **$125 + GST once-off per location**; Bp Comms SMS at 4c. Pricing must land against a $4,000–5,000/FTE-GP year-one pain figure, not against a free bundled feature.
- **Regulatory whipsaw is the top risk.** Deferred twice, materially reversed eight working days before go-live. Best Practice burned ~$1m and rolled back a build already shipped to 1,500 clinics. **Do not build deeply against unpublished spec** — this is the direct argument for the versioned mapping (REQ-REG-03) and versioned rule set (REQ-65C-02).
- **Single-feature products get absorbed.** The retained value must be the consent-and-compliance record, not the AoB form.

---

## 9. Open decisions

| ID | Decision | Options | Owner |
|---|---|---|---|
| D-01 | Integration route into Medtech Evolution | Documented API / partner program / file drop / scan-in | **Blocking — resolve first** |
| D-02 | Pricing model | Per-practice / per-provider / per-agreement / bundled | |
| D-03 | Standalone product vs white-label to a PMS vendor | | |
| D-04 | One basic service description per pre-agreement (match Bp) or many | | |
| D-05 | Link expiry window | 24h / 48h / 7 days | |
| D-06 | Failed-verification lockout threshold and unlock path | | |
| D-07 | Availability target, RPO/RTO | | |
| D-08 | Enduring agreements — v1.1 or v2? | Largest gap, but spec reportedly not published | |
| D-09 | Hosting | AU region, which provider | |
| D-10 | ⚠️ **REVISED.** Pursue the Services Australia **AoB conformance process** / Notice of Integration? | FAQ p. 11 tells providers to ask whether their vendor completed it — so it becomes a purchasing question regardless of technical need. Call the Developer Liaison. | |
| D-11 | Enduring **registration with Services Australia** — does it exist? | Instrument text says yes (65CB(5)(h), 65CA(8)(e)); the 16 Jul 2026 FAQ never mentions it. **Highest-priority verification.** | |

---

## 10. Verification actions before build

1. **Confirm the Medtech write-back path exists.** If the artefact cannot land in the patient record, stop and rethink. (D-01)
2. **Email `AssignmentofBenefit@health.gov.au`** for the Basic Service Description document and any machine-readable form. Keep the reply.
3. **Read the DoHDA AoB FAQ (July 2026) manually** — see §11.
4. **Verify the RACGP 6th edition draft CG2.A identifier count page-by-page** before it appears in any customer-facing material.
5. **Verify the DVA exclusion** with DVA or Services Australia directly — currently single-sourced from a vendor KB.
6. **Interview 15–20 practice managers** on Medtech, Gentu and allied systems to confirm they have no path and know it.
7. **Register the ACMA Sender ID** before any SMS goes out.

---

## 11. What the "robots-blocked" note actually means

`health.gov.au` and `servicesaustralia.gov.au` publish a `robots.txt` that instructs automated clients not to retrieve their pages, and my web-fetching tools honour it. The pages are perfectly public and load normally in a browser — **I simply couldn't read them programmatically**.

Practical consequences for this document:

- Details about the **government templates** (that there are five, that they're editable PDFs, that use is optional) come from **RACGP's restatement** of the Departmental position, not from the Department's own page.
- The **primary AoB FAQ** (`health.gov.au/sites/default/files/2026-07/assignment-of-medicare-benefits-for-bulk-billing-frequently-asked-questions.pdf`, July 2026) has not been read at source.
- The **Basic Service Description** document location remains unfound, which is why REQ-REG-03 is flagged as a blocker.

It is not a sign the information is wrong — RACGP, the PHNs and the vendor knowledge bases agree with each other, which is decent corroboration. But before anything here becomes a contractual or marketing claim, **open those pages in a browser and read them directly.** Anyone can; it takes ten minutes. That is the single cheapest risk reduction available on this document.

---

---

## 12. Additions — v0.2 (19 Aug 2026)

Detailed design for these is in the companion **Solution Design v0.1**. Requirement statements below are authoritative.

### 12.1 Rail coexistence

- **REQ-RAIL-01** Detect whether Tyro (Easyclaim / Tyro Health Online) or HICAPS has already captured AoB for a service before initiating any capture.
- **REQ-RAIL-02** Suppress all patient contact where a rail already captured. Double-capture is a churn risk, not a redundancy.
- **REQ-RAIL-03** Ingest the rail artefact where digital (Tyro Health Online: downloadable). Validate against s 65C, store, write to PMS, start the retention clock.
- **REQ-RAIL-04** Where the rail artefact is **paper only** (Tyro Easyclaim; HICAPS terminal receipts), record the assignment metadata, flag `paper_only_at_rail`, and offer scan-capture.
- **REQ-RAIL-05** Provide a **retention gap report**: services with consent at the rail but no retrievable artefact in the practice's records.
- **REQ-RAIL-06** Never intercept claim lodgement, never require a terminal switch.

### 12.2 SMS and email

- **REQ-SMS-01** Clinic-dedicated sending number per practice, via a tier-1 enterprise gateway.
- **REQ-SMS-02** ACMA Sender ID Register registration completed before any practice goes live.
- **REQ-SMS-03** Email as a first-class equal channel, not a fallback. (Bp has no email channel; HotDoc restricts SMS to telehealth.)
- **REQ-SMS-04** Configurable reminder cadence, quiet hours, reply-STOP handling.
- **REQ-SMS-05** Outcome written to the PMS visit note, not only to our console.
- **REQ-SMS-06** Per-message cost visible to the practice in real time.

### 12.3 Electronic signature

- **REQ-SIG-01** Drawn signature on tablet (vector + raster); tap-to-approve or drawn signature on remote link.
- **REQ-SIG-02** Every signature event binds: hash of the **exact rendered agreement**, rule-set version, mapping version, timestamp, channel, device fingerprint, IP, preceding verification event, assignor identity and authority basis.
- **REQ-SIG-03** No cryptographic/PKI requirement — the test is intention under the Electronic Transactions Act 1999. Do not over-engineer.
- **REQ-SIG-04** Signature control disabled until particulars validate and lock (reinforces REQ-REG-06).

### 12.4 Patient portal

- **REQ-PORT-01** Patient can view full agreement history: date, provider, practice, service/class, type, channel, and the rendered artefact as signed.
- **REQ-PORT-02** Download any agreement as PDF — automates the s 65C copy-on-request obligation.
- **REQ-PORT-03** View active enduring agreements, coverage, and plain-language explanation.
- **REQ-PORT-04** View all reg 89AA claim notifications (date, provider, benefit amount).
- **REQ-PORT-05** **Terminate an enduring agreement** — the patient holds this right under 65CA(7)(b) even when not the assignor. Generate and deliver written notice.
- **REQ-PORT-06** Verify a pending request is genuine — the structural answer to AoB phishing.
- **REQ-PORT-07** Assignors get a scoped view of the patients they act for.
- **REQ-PORT-08** Portal access MUST NOT be a precondition of signing.

### 12.5 Vulnerable patients and assignors

- **REQ-VUL-01** Assignor is a modelled entity: name, relationship, authority basis (parent / spouse / co-resident relative 18+ / guardian / health EPOA / other-with-note), contact details.
- **REQ-VUL-02** Authority recorded as self-declaration per reg 65CB(5); optional evidence attachment (reg 89A(2)(b) requires keeping documents recording consent where not signed by the patient).
- **REQ-VUL-03** **Assignor-remote capture** — present the agreement to a person not physically present with the patient. Essential for aged care.
- **REQ-VUL-04** Hard block: practitioner employees cannot be assignors (Departmental FAQ).
- **REQ-VUL-05** The system MUST NOT ask staff to assess capacity. Record that an assignor acted and their authority basis; nothing more.
- **REQ-VUL-06** Digital exclusion is a routing rule, not a failure state — no-mobile/no-email routes straight to paper or in-practice.
- **REQ-VUL-07** RACF visiting-GP batch mode: capture for a resident list in one offline tablet session.
- **REQ-VUL-08** Read-aloud, large text, high contrast on all patient-facing surfaces; interpreter/translated forms on roadmap.

### 12.6 Enduring agreements

- **REQ-END-01** ⚠️ **CORRECTED.** All pathways are **per practitioner**. FAQ (pp. 6, 34, 37, 38): *"Agreements are per practitioner, but multiple agreements can be made at the same practice."* ACCHO/AMS agreements are made with the organisation via its authorised agent; multiple agreements permitted with multiple ACCHOs/AMSs. Residential aged care: multiple agreements with different practitioners. **Data model is practitioner × patient, not practice × patient** — a 10-GP practice converting 2,000 MyMedicare patients may generate up to 20,000 agreements.
- **REQ-END-01a** **Enduring is GP-ONLY.** FAQ p. 38: *"this excludes a consultant physician, or a specialist, in a particular speciality other than general practice."* Specialists, allied health and optometry have **no enduring pathway** — episodic capture is their only option, permanently.
- **REQ-END-02** Capture the reg 65CB content set: enduring declaration, patient name, covered service classes (MBS Group/Subgroup), anchor, **notification method**, **termination method**, assignor name, assignor-is-patient, responsible-person basis, patient written declaration (patient 14+ where not the assignor), signature and date.
- **REQ-END-03** **Anniversary fuse tracking.** Agreements entered on or before 30 Jun 2027 cease unless registered with Services Australia before their **first anniversary** (65CA(8)(e)). Countdown with 90/60/30-day warnings.
- **REQ-END-04** Reserve the Services Australia **registration** integration (65CB(5)(h) makes it a validity requirement from 1 Jul 2027). **No portal, form, API or guidance has been published — open question.**
- **REQ-END-05** **Reg 89AA notification engine** — MyMedicare pathway only. Within 24 hours of each claim: practitioner name, patient name, service date, **benefit amount**. Error correction within 24 hours of awareness. Full audit. Do not send for aged care or ACCHO pathways.
- **REQ-END-06** ⚠️ **CORRECTED.** Termination: either party by written notice; **the patient may terminate even where another person entered the agreement on their behalf**; the agreement ends **2 business days** after written notice. A provider intending to terminate must notify the assignor at least 2 days beforehand. (FAQ p. 37)
- **REQ-END-06a** **Scope commitment.** FAQ p. 39: *"once the agreement is agreed upon, the provider is required to bulk bill the patient (or assignor) for any future in-scope services until the agreement is terminated."* Scope may be set at MBS **Category, Group, Subgroup or Item level, or a combination**. Provide a **scope preview** showing the exact item numbers the practice is committing to bulk bill, and the count. Suggested default scope: **BBPIP-eligible services** (the Department's own example).
- **REQ-END-06b** **Scope change = terminate + recreate.** Model as a first-class workflow, not an edit.
- **REQ-END-07** Cessation monitoring (65CA(8)): MyMedicare deregistration or transfer, leaving the ACCHO/AMS, discharge from residential care, patient turning 14. Temporary hospital admission does **not** end an aged-care agreement (65CA(9)).
- **REQ-END-08** Batch enrolment campaign tool: eligibility filter, bulk send, progress tracking, exceptions.
- **REQ-END-09** Record keeping per reg 89A: agreement, consent documents where not patient-signed, all 89AA notifications sent, termination notices. 2 years.

### 12.6a Treatment Plan Assignment (6-month episodic pre-agreement)

FAQ p. 27: regulations permit an episodic pre-agreement covering **multiple known services for up to six months** — aimed at patients receiving regular dialysis, cancer treatment or palliative care. It requires the information for **each service** to be specified, delivered by the **same practitioner**, on **specified dates**. Any change (date, practitioner, service) requires a new agreement for the affected claim.

- **REQ-PLAN-01** Create a single pre-agreement covering an enumerated series: one practitioner, specified dates, specified services, ≤6 months.
- **REQ-PLAN-02** **Schedule monitoring.** Continuously compare the PMS appointment book against the agreement's enumerated dates, practitioner and services.
- **REQ-PLAN-03** **Break detection.** On any date change, practitioner substitution or service change, mark the affected occurrence `assignment_void` immediately and raise it.
- **REQ-PLAN-04** **Occurrence-level remediation.** Generate a replacement pre-agreement where the change is known in advance, or queue a post-agreement where it is not. **Only the affected occurrence breaks — the remaining dates stand.**
- **REQ-PLAN-05** Dashboard: plans at risk, occurrences voided, remediation outstanding.
- **REQ-PLAN-06** Because enduring agreements are GP-only, this is the **only volume mechanism available to specialists, allied health and optometry**. Prioritise accordingly.

### 12.6b Agreement scoping and same-day rules

FAQ pp. 26, 30, 36.

- **REQ-SCOPE-01** An agreement is scoped to **practitioner × patient × day**. Multiple services by the **same** practitioner on the same day **may** share one agreement where the services correspond to those listed.
- **REQ-SCOPE-02** Multiple practitioners require **separate agreements — including at the same practice**. The system must detect multi-provider visits and split automatically.
- **REQ-SCOPE-03** If the rendering practitioner differs from the one named on a pre-agreement, an updated pre-service or a post-service agreement is required. FAQ p. 26: *"If the information in the AoB agreement does not match the claim, it does not meet legal requirements for that claim."*
- **REQ-SCOPE-04** Home visits: where one assignor assigns for **multiple patients**, each patient's assignment must be **separately documented** and clearly identify the relevant patient and service.

### 12.6c Decline and resubmission paths

- **REQ-DEC-01** `declined → private bill` path: issue an invoice enabling the patient to claim from Services Australia. In pre-assignment, allow the patient to defer the decision until after the service.
- **REQ-DEC-02** Surface the **90-day pay doctor cheque scheme** for unpaid or partially paid accounts.
- **REQ-DEC-03** **Resubmission trap.** Where the original assignment was obtained before 1 July 2026 and the claim is resubmitted or adjusted after that date, a **new compliant agreement is required** (FAQ p. 29). Detect and flag.

### 12.7 s 65C compliance tester (public, free)

- **REQ-TEST-01** Public tool accepting PDF, DOCX, image (OCR), pasted text, or structured payload via API.
- **REQ-TEST-02** Returns per-rule pass/fail/warn against the s 65C(4)/(6) data set and, for enduring forms, reg 65CB.
- **REQ-TEST-03** ⚠️ **CORRECTED.** DB4E and DB020 have been **updated** and are valid from 1 July 2026 for **post**-assignment. The tester must distinguish **pre- vs post-1 July 2026 versions** — prior versions no longer meet the requirements (FAQ p. 8). Also flag **obsolete practitioner signature blocks** (abolished 1 Jul 2026).
- **REQ-TEST-04** Flags a benefit/dollar amount as unnecessary risk (not required by the data set).
- **REQ-TEST-05** Checks that layout permits particulars to be completed **before** the signature block (REQ-REG-06 offence).
- **REQ-TEST-06** Output: plain-English fix list, regulation citation per finding, rule-set version and date, downloadable PDF the practice files as evidence of self-assessment.
- **REQ-TEST-07** Shares the REQ-65C-01 rule engine — one rule set, two front ends.
- **REQ-TEST-08** Language guardrail: never "certified", "approved" or "accredited". Permitted: "checked against the s 65C data set", "self-assessment tool", "not a government service".
- **REQ-TEST-09** Do not publish comparative results against named competitors' forms.

### 12.8 Multi-profession

- **REQ-MP-01** No GP-specific vocabulary in the core domain model — "provider" not "GP", "service" not "consult".
- **REQ-MP-02** Provider-type-aware service descriptions driven by the Basic Service Description mapping (GP, Specialist, Allied Health, Nurse Practitioner, Optometry), not hardcoded.
- **REQ-MP-03** Pricing tiers must accommodate a solo allied practitioner and a multi-site GP or specialist group.

### 12.9 Cost-reduction targets (to be validated, not claimed)

| Metric | Baseline (published modelling) | Target |
|---|---|---|
| Chase calls/day @ 60 bulk-billed patients | 9–12 | 1–2 |
| End-of-day reconciliation admin | 30–45 min | <5 min |
| Year-one cost per FTE GP | $4,000–5,000 | — |
| Steady-state cost per FTE GP | ~$1,750/yr | Addressable saving ~$1,400/yr |

- **REQ-COST-01** Instrument capture rate by channel in the design-partner practice. **No ROI figure goes into writing until measured.**

---

---

## 13. Managed follow-up — scope and the deadline-driven stop rule (v0.4)

### 13.1 What may be chased

- **REQ-CHASE-01** Outbound calling is triggered **only** where an unsigned episodic agreement is blocking a claim — the item has been rendered, the benefit cannot be claimed, and only the assignor can release it.
- **REQ-CHASE-02** The **reg 89AA post-claim notice is never chased.** It is one-way, nothing is approved, and non-response has no effect on payment. Chasing it is cost against no benefit and reads as harassment.
- **REQ-CHASE-03** Excluded from all outbound chase: **confidentiality-flagged patients** (REQ-CHILD-02), anyone who has **declined** (a decision, not a non-response), anyone who has invoked reply-STOP, and any patient at a practice in containment mode (REQ-SEC-08).
- **REQ-CHASE-04** Escalation ladder: automated cascade → AI call attempt 1 → AI call attempt 2 → human call attempt 3 → stop and hand back. Human escalation is immediate, at any point, on confusion, distress, a safeguarding signal, a complex assignor situation, or a request to speak to a person.

### 13.2 The stop rule is driven by the lodgement deadline, not a fixed week

A bulk-billed claim must be lodged within **twelve months of the date of service**. After that the item is unbillable, permanently — so the value of another attempt is a function of how much of that window is left, not of how many days have passed since the first message.

**REQ-CHASE-05** Chase intensity is banded by **days remaining on the twelve-month lodgement window**, not by elapsed days since the first contact.

| Band | Days remaining | Cadence | Escalation | Handback |
|---|---|---|---|---|
| **Standard** | 365 – 180 | 3 attempts over 7 days | AI, AI, human | After attempt 3 |
| **Compressed** | 179 – 90 | 3 attempts over 3 days | AI, human, human | After attempt 3 |
| **Urgent** | 89 – 30 | 3 attempts over 48 hours | **Human first** — skip AI attempt 2 | Immediate on attempt 3 |
| **Last chance** | 29 – 7 | 1 human attempt, same day | Human only | Immediate, to the **practice principal**, not the front desk |
| **Expired** | < 7 | No further attempt | — | Close the item; record as revenue forgone with a reason code |

**REQ-CHASE-06** Bands are configurable per practice, with the boundaries as defaults. The **direction** is not configurable: intensity rises and handback accelerates as the deadline nears. A practice cannot configure a slower cadence in the urgent band.

**REQ-CHASE-07** **The private-billing decision point.** In the Urgent band, the handback must present the practice with the alternative explicitly: *"this item cannot be bulk billed without an agreement, and there are N days left. Convert to a private bill now, or accept it will be forgone."* The handback must occur with enough time remaining for an invoice to be raised and, if relevant, for the patient to claim from Services Australia.

**REQ-CHASE-08** **Never chase past the deadline.** Once the window closes the item is unbillable; a further contact is a cost with no possible return and a poor experience for the patient. Close it, record it, surface it in the reconciliation report as revenue forgone.

### 13.3 The economic rule underneath

**REQ-CHASE-09** No item is chased beyond the point where the cumulative cost of contact is disproportionate to the benefit at stake.

A standard metropolitan Level B attendance carries roughly **$65.70** of Medicare benefit. Three attempts — two AI, one human — cost in the order of **$10–12** fully loaded, about 18% of the item's value. A fourth attempt starts to erode it materially, and the marginal probability of success after three attempts is low.

**REQ-CHASE-10** Where a single encounter carries an unusually high benefit, or where an unsigned agreement is blocking a **6-month plan agreement** covering many future items, the cap may be raised — but only with the practice's explicit instruction, recorded.

### 13.4 Reporting

- **REQ-CHASE-11** Every handback records: attempts made, channel and timestamp of each, outcome, band at the time, days remaining, and the recommendation given.
- **REQ-CHASE-12** The practice dashboard shows items by band, with the Urgent and Last chance bands surfaced first. A practice must never discover a lost item from the reconciliation report alone.
- **REQ-CHASE-13** Measure and report **resolution rate by band, by channel and by attempt number**. This is what tells you whether three attempts is the right cap, and it is the number that should change the defaults over time.

---

## Change log

| Version | Date | Change |
|---|---|---|
| 0.4 | 19 Aug 2026 | Added §13: managed follow-up scope — calls only where an approval blocks a claim, never for post-claim notices; exclusions; and a stop rule banded by days remaining on the twelve-month lodgement window rather than a fixed elapsed period. |
| 0.3 | 19 Aug 2026 | Reconciled against Departmental FAQ (16 Jul 2026). Corrections: enduring is per-practitioner and GP-only; Basic Service Description published as XML/CSV quarterly; DB4E/DB020 updated not retired; DVA+CDBS excluded at source. Added: Treatment Plan Assignment (6-month pre-agreement), agreement scoping and same-day rules, decline/resubmission paths, enduring scope commitment, revised ETA-based verification positioning. |
| 0.2 | 19 Aug 2026 | Added §12: rail coexistence, SMS/email, e-signature, patient portal, vulnerable patients and assignors, enduring agreements (incl. registration fuse and reg 89AA), public s 65C compliance tester, multi-profession, cost targets. |
| 0.1 | 19 Aug 2026 | Initial draft. Regulatory data set, patient verification (3 identifiers, RACGP C6.1A), s 65C conformance validator, capture channels, Medtech-first integration, NFRs, open decisions. |
