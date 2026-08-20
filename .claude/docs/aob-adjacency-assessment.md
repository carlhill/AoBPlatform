# Adjacency Assessment — where else this platform can go
### 19 August 2026 · Companion to the cost model notes (§9, the ceiling)

---

## 1. The thesis

The Australian AoB market has a ceiling of roughly **$37.6m–$51.7m of annual revenue at 100% share**. That is the constraint the business case runs into, and no amount of execution changes it.

**The fix is not another country. It is a second consent type sold to a practice you already have.**

Selling a second product into an existing customer means one integration, one relationship, one security review, one contract, and a sales conversation that starts from trust. Selling a first product in a new jurisdiction means rebuilding the regulatory core, a new integration set, a new competitive field and a cold start.

**And there is a structural reason this works here specifically.** Roughly 60–70% of the platform is domain-agnostic: capture, verify identity, sign, validate against a schema, retain, notify, audit, reconcile. The other 30–40% is the schema, the integrations and the go-to-market — which is the whole business, but is also the part you rebuild per *market*, not per *country*.

---

## 2. The pattern to look for

> A legally required consent or agreement artefact, captured at or near the point of service, that **gates a payment** from a payer to a provider, must contain **prescribed information**, must be **retained**, and is **auditable**.

Where that pattern holds, the engine transfers. Where it doesn't, you are building a different product.

---

## 3. Scoring

| Market | Buyer overlap | Artefact strength | Payment gating | Vendor gap | Timing | **Overall** |
|---|---|---|---|---|---|---|
| **NDIS therapy providers** | ●●●●● | ●●○○○ | ●●●○○ | ●●●●● | ●●●●● | **Strongest** |
| **Support at Home** | ●○○○○ | ●●●●● | ●●●●● | ●●●○○ | ●●●●○ | Strong legal fit, wrong buyer |
| **Workers comp / CTP** | ●●●●● | ●●●○○ | ●●○○○ | ●●●○○ | ●●○○○ | Cheap add-on, small |
| **Child Care Subsidy** | ○○○○○ | ●●●●● | ●●●●● | ●○○○○ | ●●○○○ | Pattern twin, different company |
| **New Zealand (ACC)** | ●●○○○ | ●●●●○ | ●●●●● | ●●○○○ | ●●○○○ | Later |
| **Ireland (GMS)** | ●○○○○ | ●●●●● | ●●●●● | ●●●○○ | ●○○○○ | Reference model, not a market |
| **United States (AOB)** | ○○○○○ | ●●○○○ | ●●●○○ | ●○○○○ | ●●○○○ | Largest, hardest, crowded |

---

## 4. NDIS — the recommended adjacency

### 4.1 Scale

| | Value | As at |
|---|---|---|
| Active participants | **782,013** | 30 Jun 2026 |
| Total payments | **$51.5bn** for FY2025-26, +10.5% | 12 months to Jun 2026 |
| Active providers (paid in quarter) | **280,258** | 30 Jun 2026 |
| Registered providers | ~17,374 — about **6%** | mid-2026 |
| **Therapy / allied health providers** | **~53,600** (7,274 registered + 46,330 unregistered) | 6 months to Dec 2025 |
| Therapy spend | **~$5.4bn annualised**, ~10% of the scheme | ibid. |

**The buyer overlap is the point.** Those 46,330 unregistered therapy providers average **$22,000 a year** of NDIS billings each — sole traders and micro-practices, already running Cliniko, Splose, Halaxy, Nookal and coreplus. That is precisely the cohort your AoB product targets in allied health, and precisely the cohort the engagement layer has never served.

### 4.2 The integrity pressure — and why the timing is right

- **$3.7bn of "integrity leakage" in FY2024-25 — 8.3% of $45bn in payments** (John Dardo, Head of Integrity Transformation, parliamentary hearing, 1 May 2026).
- **Minister Mark Butler, same hearing: 90% of claims have "no evidence" behind them.**
- ~94% of providers have never been audited in thirteen years.
- Enforcement is scaling hard: 25 prosecutions, 600+ active investigations, 2,500+ providers removed, 77 warrants in the last year against 30 across 2018–2021 combined.
- Budget 2026-27: **$280.1m over five years** for fraud detection, **$358.5m over five years** for a new claims platform.

**Compare that to the "less than 10% of risks progressed" finding that underpins the Medicare reconciliation pitch.** NDIS has the same problem, an order of magnitude worse, and government has just funded the response.

### 4.3 What is changing, and when

The NDIS is moving from *"no prescribed agreement, two-year claim window, unaudited"* to the same posture that produced the Medicare AoB reform — arriving 6 to 24 months later.

| Change | Effect | When |
|---|---|---|
| **7-year record retention** (new s45B) | Records relating to claims, from date of claim. Civil penalty 120 penalty units | 7 days post-assent |
| **Claim window cut to 90 days** (from 2 years) | s45A(5)(a) | **1 Dec 2026** |
| **Record-falsification offences** (ss59A–59AF) | New fraud offences incl. falsifying records | 7 days post-assent |
| **Automated claim-to-record matching** | "Every claim automatically checked against your service delivery records, the participant's plan and your registration" | Rollout from Jul 2026, complete 2030 |
| Integrity checks on older claims | Claims 6+ months old held up to 28 days to verify evidence | **Live since 16 Jul 2026** |
| Mandatory registration expands | SIL and digital platforms Jul 2026; personal care and daily living Jul 2027; universal target 2030 | staged |

⚠️ **Verify status:** the *NDIS Amendment (Securing the NDIS for Future Generations) Bill 2026* passed the Senate on **18 August 2026** and was awaiting House concurrence. It was **not law** at the time of this research. Confirm before relying on any commencement date.

### 4.4 The artefact — where the analogy is weak, and where it is strong

**Weak:** an NDIS service agreement is **generally not legally mandatory.** The NDIA states plainly that written service agreements are only mandatory for **Specialist Disability Accommodation**, with prescribed content in the Practice Standards Rules (Schedule 7 Module 5) and for SIL (Schedule 7A). There is **no prescribed data set** for general service agreements, and no NDIS equivalent of s 65C.

**Strong — and this is the opening:** the record-keeping rules require that **"support logs require signatures from the participant, child representative, nominee, or legal guardian documenting individual supports delivered."**

That is a **point-of-service participant signature attesting that a support was delivered**, required as claim evidence, currently handled on paper or ad hoc. It is the closest existing NDIS analogue to an assignment of benefit — and it is the artefact most likely to be formalised as the automated claim-to-record matching comes online.

**When 90% of claims have no evidence behind them and every claim is about to be automatically checked against service delivery records, a signed, timestamped, retained support log stops being paperwork and becomes the thing that determines whether a provider gets paid.**

### 4.5 The vendor gap

NDIS practice management is served — Lumary, Brevity, ShiftCare, Careview, SupportAbility, FlowLogic — and allied health by Cliniko, Splose, Halaxy, Nookal, coreplus.

**But none of them treats the agreement as a consent artefact.** Lumary's "NDIS service agreement" object is a *financial* construct: NDIS number, funding type, dates, allocation limit, management type, overclaim handling. **No e-signature capability is documented.** E-signature for NDIS agreements is served by generic tools like Secured Signing, disconnected from claiming.

HICAPS and Tyro Health both process NDIS payments. **Neither captures consent.** Exactly the same shape as the Medicare market: the rail delivers the transaction, nobody holds the record.

### 4.6 What you would build

Most of it already exists. What is new:

- **Support log signature capture** — participant, nominee, guardian or child representative, at the point of support, on the same tablet, offline-capable, with the same signature binding and audit trail
- **Service agreement capture and retention**, with e-signature and the SDA/SIL prescribed content where it applies
- **Authority modelling** — participant, guardian within scope, financial administrator for financial matters only, EPOA holder, plan nominee. Your assignor model already does exactly this shape
- **7-year retention** — a configuration change, since retention is already parameterised
- **Claim-to-record reconciliation** — the three-way reconciliation engine, pointed at NDIS claims instead of Medicare claims
- **90-day claim window tracking** — the deadline-banded chase logic, with a much tighter window

**The confidentiality, safeguarding and authority work already done for aged care and vulnerable patients transfers directly.** NDIS participants are, by definition, the cohort those rules were written for.

---

## 5. Support at Home — strongest legal fit, wrong buyer

| | Value |
|---|---|
| People with access to services | **364,723** (338,049 receiving care) |
| Approved providers | **950** |
| Commenced | 1 November 2025 |

**The legal gating is the strongest of any market in this document.** Under the Aged Care Act 2024 a provider must have a compliant service agreement in place to deliver funded care **and to claim subsidy**, in place before or on the day services start. And explicitly: *"Claims may be denied immediately or retrospectively if the Department later identifies that services were provided without a valid agreement."*

Prescribed content is defined: provider and participant rights and responsibilities, services and agreed pricing, process for determining unknown prices, and how the participant pays contributions.

**There is a live compliance failure right now.** Transitioned participants had 90 days from receiving their confirmed contribution rate — most received it 3 November 2025 — and law firms are publishing guidance on what to do about unsigned agreements after that deadline. A material number are unsigned.

**But 950 providers, mostly aged care organisations rather than health practices, is a different buyer with a different sales motion.** And Tyro Health already has the Support at Home claiming rail.

**Verdict: a strong product fit with weak customer leverage.** Worth revisiting once the RACF work is mature — the aged care assignor and authority model is already built for it.

---

## 6. Workers compensation and CTP — cheap add-on, limited upside

Same practitioners: GPs, physiotherapists, psychologists. Scheme scale is real — NSW $5.3bn in claim costs, WorkCover Queensland $2.9bn in claims expense with 74,976 accepted claims, TAC $1.87bn.

**The artefact exists and is prescribed:** the SIRA **Certificate of Capacity / Certificate of Fitness** carries an explicit signed consent block covering information exchange between practitioner, employer, insurer and regulator, signed by both the injured person and the practitioner. Equivalents exist in every scheme, and in NSW the same form covers workers comp and CTP.

**Two reasons it is a smaller prize than it looks:**

1. **It gates benefits, not each invoice.** Payment to the provider is authorised by claim acceptance, not by a signature per service. So the artefact is per-claim or per-period, not per-service — a fraction of the volume of bulk-billing AoB.
2. **The rails are taken.** HICAPS covers WorkSafe Victoria, TAC, icare NSW, WorkCover Queensland and ICWA. Tyro Health adds Comcare and QBE. Halaxy processes icare natively.

**But the consent capture itself is still a PDF workflow.** Cheap to add once the engine exists, sells as "one more thing we handle", and costs almost nothing to build. **Treat it as a retention feature, not a growth strategy.**

---

## 7. Child Care Subsidy — the pattern twin

Legally the closest analogue of all, and commercially the furthest away.

| | Value |
|---|---|
| CCS expenditure | **$13.6bn** (2023-24); $3.98bn in the December 2025 quarter alone |
| Approved services | **15,271** |
| Families using approved care | **1,011,600** |
| Children | 1,502,040 |
| Estimated non-compliance | **$484.1m — 3.6% of payments** (2023-24) |

The **Complying Written Arrangement** is a near-perfect structural match: legally required under the CCS Secretary's Rules s9, with prescribed minimum content, held by the provider and produced on audit rather than submitted, **7-year retention**, and the explicit rule that *"CCS can only be paid for care provided under a CWA."*

It even has the two-sided loop your platform implies: provider lodges an enrolment notice, government relays it to the parent, **parent confirms via myGov**, and only then does subsidy flow.

**But the buyer overlap is zero.** Different decision-makers, different regulator, different incumbents — Xplor Education, OWNA, SmartCentral, Kidsoft, QikKids — all of whom handle the CWA in-product already.

**Verdict: a pattern analogue, not an adjacency. If you ever build it, it is a different company.**

---

## 8. Overseas — later, and for a specific reason

**New Zealand — ACC** is the most instructive design precedent. 2.04m new claims a year, over $4bn in treatment and rehabilitation, and the consent artefact is a **prescribed verbal authorisation script** recorded in the clinical record — three declarations covering records collection, truthfulness, and authority to lodge. That is *consent as structured data captured in the PMS at the point of service*, which is exactly the thing you are building, with a decade of precedent.

**And Medtech Global is New Zealand-origin** with a major NZ presence and ACC integration. If your design partner relationship with Medtech in Australia works, the same vendor is your route into New Zealand. That is the only geography with a genuine warm path.

**Ireland — GMS** is the closest overseas match to Australian AoB: GPs must hold a contemporaneous record with **"the patient signature confirming the service was received"**, retained **6 years**, produced on audit, gating a state payment. Small market. Treat it as a reference model that proves the pattern is not an Australian oddity.

**United States** is the largest and worst fit. AOB exists and is near-universal, but there is **no federal prescribed data set**, content is payer- and state-specific, signature is annual or episodic rather than per-service, and the No Surprises Act partly displaces the need. It is bundled into intake packets, and the intake market is occupied — Phreesia at $480.6m revenue across ~4,514 clients, plus Clearwave, Luma, and Epic and Oracle bundling natively.

Worth noting from Phreesia's numbers: only ~46% of its revenue is subscription and ~29% is pharma-funded network solutions. **Pure intake and consent software does not appear to support a large ACV on its own, even at US scale.** That is a caution about the standalone-consent thesis generally, not just about America.

**One finding worth holding onto:** I could not find any jurisdiction that has recently legislated a prescribed consent data set for health claiming. Australia's 1 July 2026 change appears to be without a recent international precedent. That cuts both ways — no proven overseas playbook to copy, and no overseas competitor arriving with one.

---

## 9. What transfers, and what does not

| Transfers — build once | Rebuild per market |
|---|---|
| Capture surfaces: tablet, kiosk, SMS, email, paper | The prescribed data set and validation rules |
| Identity verification and layered authentication | Payer integration and claim linkage |
| Signature capture, binding and audit trail | Retention periods and legal hold rules |
| Multilingual rendering and translation memory | Notification obligations |
| Authority and assignor modelling | Practice management integrations |
| Encryption, key separation, tamper-evident logging | Go-to-market and the sales motion |
| Delivery evidence chain | Regulatory monitoring |
| Reconciliation engine | Conformance and security review |
| Deadline-banded chase logic | |
| Safeguarding and confidentiality rules | |

**Roughly 60–70% of the build is reusable.** The reusable part is also the expensive, slow, security-reviewed part. The market-specific part is the fast part.

---

## 10. Recommendation

**Sequence: Medicare AoB → NDIS → workers comp as a retention feature → New Zealand via Medtech → everything else, later or never.**

**Do not start NDIS until the Medicare product has real customers.** The adjacency argument only works if the second product goes to a practice you already have; without customers there is no adjacency, only two cold starts.

**But start the groundwork now, because it is free:**

1. **Model authority polymorphically from the outset.** Participant, nominee, guardian, financial administrator, EPOA holder — the NDIS authority set is a superset of the AoB assignor set. Building it once costs nothing extra; retrofitting it is a rewrite.
2. **Parameterise retention.** 2 years for Medicare, 7 for NDIS and CCS, 6 for Ireland. Never hardcode.
3. **Make the validation schema data-driven, not code.** The s 65C rule set is one schema. NDIS support logs are another. If the rules live in code, every market is a fork.
4. **Ask allied health design partners about their NDIS work in the same conversation.** Many of them do both. The question costs nothing and tells you whether the overlap is as strong in practice as it is on paper.

### The numbers that decide it

| | Australian AoB | NDIS therapy |
|---|---|---|
| Ceiling at current pricing | $37.6m–$51.7m | Not sized — but ~53,600 providers vs ~19,000 |
| Payer scale | $32.4bn Medicare benefits | **$51.5bn scheme payments** |
| Estimated leakage | $1.5–3.0bn (5–10%) | **$3.7bn (8.3%)** |
| Claims lacking evidence | Not published | **~90%** |
| Retention obligation | 2 years | **7 years** (pending) |
| Claim window | 12 months | **90 days** from 1 Dec 2026 |
| Consent product in market | None | **None** |

**A 90-day claim window with automated claim-to-record matching and a 7-year retention obligation, against a provider base where 90% of claims reportedly have no evidence behind them, is a larger and more urgent version of exactly the problem this platform was built to solve.**

---

## 11. Verify before acting

1. **Status of the NDIS Amendment (Securing the NDIS for Future Generations) Bill 2026** — passed the Senate 18 Aug 2026, awaiting House concurrence. Every date in §4.3 depends on assent.
2. **Whether the signed support log is being formalised** as part of the new claims platform. Ask the NDIA and the NDIS Commission directly, as you did with the Department on AoB registration.
3. **Whether any NDIS vendor has shipped participant e-signature linked to claiming.** I found none, but absence of evidence is not proof.
4. **The 7,274 / 46,330 therapy provider split** — from an analyst reading of the NDIA Annual Pricing Review, not the primary document.
5. **Medtech Global's Australian and New Zealand practice counts** — unverified, and it is the hinge of the New Zealand path.
6. **Support at Home annual program spend** — my $14–15bn is arithmetic, not a published figure.

---

### Sources

- [NDIS Quarterly Report Q4 2025-26 — National Dashboard](https://www.ndis.gov.au/media/8768/download?attachment) · [Summary Part A](https://www.ndis.gov.au/media/8795/download?attachment)
- [ANAO Report No.2 2025-26 — NDIS Quality and Safeguards Commission](https://www.anao.gov.au/sites/default/files/2025-10/Auditor-General_Report_2025-26_2.pdf)
- [ABC News — NDIS funding integrity leakage, 1 May 2026](https://www.abc.net.au/news/2026-05-01/ndis-funding-integrity-leakage-parliamentary-hearing/106630496)
- [Conway Group — NDIS Annual Pricing Review 2026-27, allied health](https://www.conwaygroup.com.au/insights/ndis-apr-2026-27-allied-health)
- [NDIS — Record keeping requirements](https://www.ndis.gov.au/providers/working-provider/reporting-and-recording-keeping/what-are-record-keeping-requirements)
- [NDIS — What is a service agreement](https://www.ndis.gov.au/participants/working-providers/arranging-supports/what-service-agreement)
- [NDIS — Increasing integrity checks on older claims, 15 Jun 2026](https://www.ndis.gov.au/news/11575-increasing-integrity-checks-older-claims)
- [NDIS Commission — Mandatory registration](https://www.ndiscommission.gov.au/about-us/ndis-commission-reform-hub/mandatory-registration)
- [Department of Health — Service agreements for Support at Home](https://www.health.gov.au/our-work/support-at-home/managing-support-at-home-services/service-agreements-for-support-at-home)
- [Russell Kennedy — Unsigned Support at Home agreements after 90 days](https://www.russellkennedy.com.au/insights-events/insights/unsigned-support-at-home-agreements-after-90-days-what-to-do-next)
- [AIHW GEN — Support at Home Program Data Report Q3 2025-26](https://www.gen-agedcaredata.gov.au/getmedia/88363448-d30b-4958-8823-df697cb5f769/Support-at-Home-Program-Data-Report-Q3-2025-26-corrected)
- [SIRA — Certificate of capacity / certificate of fitness](https://www.sira.nsw.gov.au/__data/assets/pdf_file/0010/821548/SIRA08719-Certificate-of-capacity-certificate-of-fitness-for-treating-physiotherapist-or-psychologist-interactive.pdf)
- [WorkCover Queensland Annual Report 2024-25](https://www.worksafe.qld.gov.au/__data/assets/pdf_file/0019/151048/WorkCover-Queensland-Annual-report-2024-2025-FINAL.pdf)
- [Family Assistance Guide 2.6.5 — Complying Written Arrangements](https://guides.dss.gov.au/family-assistance-guide/2/6/5)
- [ANAO — Child Care Subsidy compliance](https://www.anao.gov.au/work/performance-audit/management-and-oversight-of-compliance-activities-within-the-child-care-subsidy-program)
- [ACC — Lodging a claim for a patient](https://www.acc.co.nz/for-providers/lodging-claims/lodging-a-claim-for-a-patient)
- [HSE PCRS — Handbook for Doctors](https://assets.hse.ie/media/documents/PCRS_handbook_for_Doctors.pdf)
- [ACEP — Assignment of Benefits FAQ](https://www.acep.org/administration/reimbursement/reimbursement-faqs/assignment-of-benefits)
- [Phreesia FY2026 results, 30 Mar 2026](https://www.businesswire.com/news/home/20260330072462/en/Phreesia-Announces-Fourth-Quarter-Fiscal-2026-Results)
- [HICAPS — statutory funders](https://www.hicaps.com.au/partners/statutory-funders) · [Tyro Health — insurers](https://www.tyrohealth.com/insurers/)
