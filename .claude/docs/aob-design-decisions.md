# AoBPlatform — Design Decisions
### 19 August 2026 · Extends Requirements v0.3, Solution Design v0.1, Addendum v2

---

## 0. A documentation rule, adopted

**Rule: use different words to the words of the domain.**

This domain already owns *claim*, *agreement*, *assignment*, *benefit*, *practice*, *service*, *register*, *notice*, *record* and *provider*. Every one of those is a defined term here. Using any of them loosely — "the real claim is…", "in practice…", "the benefit of this approach…" — makes a document ambiguous exactly where it must not be.

So throughout AoBPlatform documentation:

| Domain term (reserved) | Use instead, for the ordinary meaning |
|---|---|
| claim | assertion, position, finding, point |
| agreement | alignment, consensus, concurrence |
| assignment | task, work item, allocation |
| benefit | upside, value, advantage |
| practice | habit, convention, approach *(and never "in practice")* |
| service | product, platform, capability, offering |
| register | record, log, note *(as a verb)* |
| notice | attention, observation |
| provider | supplier, vendor |
| record *(v.)* | capture, log, store |

Applies to requirements, design documents, code identifiers, database column names, API field names and UI copy. A field called `status` on a table called `agreement` is fine. A variable called `agreement` holding a boolean about whether two systems concur is not.

---

## 1. ⚠️ Correction — the notification does NOT gate bulk billing

You asked:

> *"So you are saying — in this scenario, which will be very common — if the Assignor does not approve the SMS/email then the Practice cannot proceed with the bulk billing?"*

**No. The opposite.** This distinction is the single most important thing in the enduring model, and if it were the other way round the whole mechanism would be worthless.

**The reg 89AA notification happens AFTER the Medicare claim is lodged. It is a one-way message. Nothing is being approved.**

FAQ p. 37: *"When a Medicare claim is made using an enduring agreement for a MyMedicare registered patient, the provider must notify the assignor in writing **within 24 hours of making the claim**."*

Sequence: consent captured once, at enrolment → service rendered → claim lodged → notification sent within 24 hours. The assignor receives a statement of what was lodged in their name. They do not respond, approve, decline, acknowledge or click anything.

| | Episodic capture | Enduring + notification |
|---|---|---|
| When | **Before** the claim | **After** the claim |
| Direction | Two-way — needs the patient to act | One-way — no response expected |
| If ignored | **Claim cannot be lodged.** Revenue blocked. | **Nothing.** The claim stands. |
| Automatable | No — a human must sign | **Fully** |

So the practice bulk bills, lodges, and gets paid regardless of whether the assignor opens the message. Non-response has **zero** effect on revenue.

**The exposure, if notification fails, is compliance — not revenue.** The obligation is breached. It is a record-keeping and conduct failure, discoverable on audit, not a blocked payment. That is a far better risk to hold, and it is precisely why enduring agreements are worth pursuing.

**Where I was imprecise earlier:** I wrote that enduring "converts work rather than removing it." Accurate, but it led you to the wrong inference. The clearer statement: *enduring replaces blocking, two-way, human-dependent work with non-blocking, one-way, fully automatable work.* The volume of obligations goes up; the cost of each goes to near zero once automated; and nothing blocks the money.

**Second-order point worth holding onto:** the assignor cannot opt out of these messages. A statutory notification is not marketing. See §5.4.

---

## 2. Reporting termination to Services Australia

**Assessment: correct instinct, and it completes a mechanism that is currently half-built.**

Your reasoning is sound. If Services Australia holds a record of which enduring agreements are live, it can detect a practitioner lodging claims against a patient who has terminated. That is a clean, deterministic integrity check — no inference about anyone's conduct, just a set difference.

**And it fits the registration requirement exactly.** The regulations already oblige registration of enduring agreements with Services Australia (65CB(5)(h), 65CA(8)(e)). A record that can only be created and never closed is a record that decays into uselessness within a year. **Registration without deregistration is an incomplete design**, and that is a concrete, constructive observation to put to Services Australia rather than an abstract offer to help.

Three cessation categories, and they behave differently:

| Category | Who knows first | Should notify SA? |
|---|---|---|
| Patient terminates | AoBPlatform (if via portal) or the practice | **Yes** — this is your case |
| Practitioner terminates | The practice | **Yes** |
| Automatic cessation (65CA(8)) — MyMedicare deregistration, leaving residential care, turning 14, practitioner departure | Often **Services Australia already knows**, before the practice does | Not needed for some; SA is the better source |

That third row is the interesting one. Services Australia holds MyMedicare registration status. It is better placed than any practice to know that an enduring agreement has automatically ceased — which means the ideal design is **bidirectional**: platforms report terminations up, Services Australia reports automatic cessations down. That is a materially better proposal than one-way reporting, and it is the version worth putting in an email.

**Requirements**

- **REQ-SA-01** Capture every termination and cessation as a structured event: agreement identifier, patient, practitioner, cessation type, effective timestamp, initiating party.
- **REQ-SA-02** Hold the event queued for transmission to Services Australia. Build the queue now; the channel does not yet exist.
- **REQ-SA-03** Design for **bidirectional** reconciliation — accept inbound cessation notices from Services Australia as well as sending outbound.
- **REQ-SA-04** Until a channel exists, produce an **exportable cessation report** the practice can retain as evidence and supply on request.
- **REQ-SA-05** ⚠️ **Do not describe this externally as fraud detection.** It is agreement lifecycle integrity. Framing it as catching fraudulent practitioners makes every practice you sell to a suspect, and makes Services Australia the customer instead of them. Frame it as: *practices should not be exposed to lodging against an agreement that has ceased without their knowledge.* Same mechanism, and the party you are selling to is protected rather than policed.

---

## 3. Patient pre-nominates approved assignors

**Assessment: good idea, with one design constraint that must not be got wrong.**

**Why it is good.** Nothing in the regulations requires the assignor to be pre-approved — the test is only that they are the person who would otherwise meet the cost. That is a weak control for something as consequential as consenting to a claim in someone else's name. Pre-nomination is a real safeguard above the regulatory floor, it is cheap, and it directly answers the question a practice cannot otherwise answer: *is this person actually authorised to act for this patient?*

It also fits the platform's shape. You already hold patient identity, assignor identity and the relationship. Adding an authorisation state is a small extension of an object that must exist anyway.

**The constraint: it must be a soft control, never a hard gate.**

A hard gate fails in exactly the situations that matter most. A patient collapses and a neighbour brings them in. A patient is admitted to residential care and a new adult child takes over. A carer changes. A patient is unconscious. If a nominated-assignor list is the only route to consent, the product becomes the reason a vulnerable patient is not bulk billed — which is the failure mode RACGP has spent two years warning about, and which REQ-REC-04 already forbids.

**Requirements**

- **REQ-NOM-01** A patient may nominate approved assignors, each with name, relationship, authority basis, contact details, and an **active/inactive flag** with effective dates.
- **REQ-NOM-02** Nomination status is **advisory**. A pre-approved assignor gets a fast path. A non-nominated assignor is **not blocked** — capture proceeds, flagged `assignor_not_nominated`, with the reason recorded and the event surfaced on the exception queue.
- **REQ-NOM-03** Nominated assignors are **scoped**: which patient, which practitioners or practices, episodic vs enduring, and an optional expiry.
- **REQ-NOM-04** **Removal must be instant, one action, and private.** The removed person is not told who removed them or why. A notification that says "Sarah removed your authorisation" is a safety incident in a coercive-control household.
- **REQ-NOM-05** **A nominated assignor cannot nominate other assignors.** Only the patient can, or a guardian/health-EPOA holder with recorded authority. Otherwise the list can be captured by the first person on it.
- **REQ-NOM-06** **Practice staff cannot create or modify nominations.** Nomination originates with the patient. Staff may record a paper nomination form, which is captured as a distinct, attributed event.
- **REQ-NOM-07** Nomination changes are logged immutably with actor, timestamp, channel and prior state.
- **REQ-NOM-08** Reviewed at least annually; nominations older than 24 months are surfaced for confirmation rather than silently trusted.

**⚠️ The elder-abuse consideration, stated plainly.** A nominated-assignor list is a list of people with financial authority over a vulnerable person. A controlling family member who gets themselves nominated and the patient's real supporters removed has built exactly the structure this feature could otherwise help detect. Mitigations: the patient-only nomination rule (REQ-NOM-05), silent removal (REQ-NOM-04), and an alert to the practice — **never to other assignors** — when a single actor removes multiple nominees in a short window.

---

## 4. Practitioner off-boarding, loss of registration, and moving patients

You asked about a bulk mechanism to move patients to a new practitioner when a GP or a whole site loses registration, with the receiving practitioner approving the onboarding. And you asked whether that opens a fraud hole.

**It does — and the fix is a single legal point that also happens to close it.**

### 4.1 An agreement cannot be transferred. Ever.

An AoB agreement names a practitioner. It is consent to assign a Medicare entitlement **to that person**. When the practitioner is deregistered, leaves, or dies:

- the agreement **ceases** (65CA(8) — the practitioner leaves the nominated location; and a deregistered practitioner cannot render a Medicare-eligible item at all)
- a different practitioner needs a **new agreement**, freshly consented

**So "bulk transfer" is not a feature that should exist**, and building it would be building the fraud. What can exist is a **bulk re-consent campaign**: an invitation to each patient to enter a new agreement with a named new practitioner, which the patient must affirmatively accept.

That distinction — **invite, never migrate** — is the whole control. It is also the honest description of what is happening.

### 4.2 The fraud that would otherwise be possible

Without that rule, a practice whose GP is deregistered could sweep that GP's patient list onto another practitioner's provider number and keep lodging claims — with consent that the patient never gave to that practitioner. Every claim would be invalid, and the patient would have no idea. Concentrated in exactly the cohort least able to notice: aged care, ACCHO, and anyone who signed once and never looked again.

### 4.3 Controls

- **REQ-XFER-01** **No transfer path exists in the data model.** An agreement's practitioner is immutable. Changing practitioner means terminating one agreement and creating another. There is no code path that does otherwise.
- **REQ-XFER-02** Re-consent is **affirmative and explicit**. No pre-ticked boxes, no "you will be moved unless you object", no implied consent through continued attendance. The new practitioner is named prominently, in the patient's language.
- **REQ-XFER-03** **Full verification on re-consent** — the same three approved identifiers as an original agreement. Re-consent is a new agreement, not an amendment.
- **REQ-XFER-04** **Receiving-practitioner eligibility check** before any invitation goes out: current AHPRA registration, valid Medicare provider number at the location, and — for enduring — that they are a GP (enduring is GP-only). Do not invite patients to consent to someone who cannot lawfully render the item.
- **REQ-XFER-05** **Both-sides approval.** Patient consents; the receiving practitioner accepts. Neither alone creates an agreement.
- **REQ-XFER-06** **Anomaly monitoring.** Flag: a single practitioner accumulating agreements far faster than a plausible enrolment rate; a campaign with a conversion rate near 100% (real campaigns do not achieve that); re-consent captured for patients with no appointment history with the receiving practitioner; bulk activity outside business hours.
- **REQ-XFER-07** **Independent patient channel.** Every new agreement produces a notification to the patient through the portal and their own contact details, **not routed through the practice**. A patient must be able to learn independently that an agreement was created in their name.
- **REQ-XFER-08** **Deregistration is a hard stop.** On loss of AHPRA registration, immediately cease all that practitioner's agreements, halt all their notifications, block new capture, and alert the practice. Do not wait for the practice to tell you.
- **REQ-XFER-09** **Campaign rate limits and a cooling period**, with volume caps per practitioner per day and full campaign audit — who initiated, target list, list derivation, message content, timestamps.
- **REQ-XFER-10** **Do not automate the invitation list from the departed practitioner's claim history alone.** Require the practice to affirm the clinical relationship exists. That is the step that makes a fraudulent campaign a deliberate false statement by a named person rather than a button press.

**One honest reservation.** This feature is genuinely useful — a deregistered GP's patients need continuity, and doing it on paper is worse. But it is also the highest-abuse-potential capability in the product, and it should not ship in v1. Build it once the base product has real usage, so anomaly detection has a baseline to detect anomalies against.

---

## 5. AI conversational channel — "stop contacting me"

**Assessment: yes, build it — but the AI classifies intent, it never executes the legal act.**

### 5.1 The trap in the example

*"I do not see Dr X anymore. Please stop sending me SMS and emails from this practice."*

That sentence is ambiguous between two very different acts:

1. **Stop the messages** — a communications preference
2. **Terminate the enduring agreement** — a legal act with a 2-business-day effect, which stops the practice bulk billing that patient

A patient who wanted (1) and got (2) may find themselves billed privately at their next visit. A patient who wanted (2) and got (1) still has a live agreement with a practitioner they have left, and claims may continue to be lodged in their name. **Both errors are serious, and an LLM must not choose between them.**

### 5.2 Design

- **REQ-CHAT-01** The AI **classifies intent and presents options**. It does not terminate agreements, change nominations, or alter consent.
- **REQ-CHAT-02** On detecting either intent, present both explicitly and plainly:
  - *"Stop messages from this practice, but keep your agreement with Dr X"*
  - *"End your agreement with Dr X — after this they can no longer bulk bill you, and you may be charged at your next visit"*
  - *"Both"*
- **REQ-CHAT-03** Every consequential action requires **explicit confirmation on a deterministic screen**, outside the conversation, showing exactly what will happen and when.
- **REQ-CHAT-04** Full transcript retained with the resulting action, as part of the audit trail.
- **REQ-CHAT-05** Available in all supported languages (REQ-LANG-\*). This is the surface where a language barrier does the most damage.
- **REQ-CHAT-06** **Escalation to a human** always offered, and offered proactively on any signal of distress, confusion, coercion or a safeguarding concern.
- **REQ-CHAT-07** No dark patterns. No retention flow. No "are you sure?" beyond the single required confirmation.

### 5.3 What we can and cannot stop

| Message origin | What we can do |
|---|---|
| Sent by AoBPlatform | **Stop it directly**, immediately, by patient, practice and channel |
| Sent by the practice's own systems | **Forward the request** as a structured, timestamped, auditable item to the practice, with a response deadline and escalation if unactioned. We cannot switch off someone else's sender. |

- **REQ-CHAT-08** Requests we cannot fulfil directly are transmitted as structured items with acknowledgement tracking, not fired into an inbox and forgotten.

### 5.4 ⚠️ You cannot opt out of a statutory notification

The reg 89AA notification is a **legal obligation on the practitioner**, not marketing. It is not subject to unsubscribe.

While a MyMedicare enduring agreement is live, the notification must be sent within 24 hours of each claim, by the method specified in the agreement. A patient who wants them to stop has exactly one route: **terminate the agreement**.

- **REQ-CHAT-09** The AI must state this clearly and without hedging: *"These messages are required by law while your agreement with Dr X is active. They cannot be switched off separately. If you want them to stop, you can end the agreement — here is what that means."*

Suppressing a statutory notification because someone asked nicely would place the practice in breach. This is one of the few places in the product where the honest answer is "no, but here is the thing you can do."

---

## 6. Age rules and identity data

### 6.1 What the regulations set

- Where the patient is **14 or older** and someone else acts as assignor, the patient must give a **written declaration**.
- At 14, a patient may enter their own enduring agreement or choose an assignor.
- An enduring agreement **automatically ceases** when a patient covered under someone else's agreement turns 14 (65CA(8)).
- For enduring "responsible person" purposes, one category is expressly *a relative aged **18 or over** living in the same household*.
- **No general minimum age for an assignor is stated anywhere.**

### 6.2 The platform rule I would adopt

**Assignor acting for another person: 18+. Patient self-assigning: 14+.**

Rationale:

- An assignor takes on a **financial position** — they are the person who would otherwise meet the cost. Contractual capacity of a minor is legally fragile, and the regulations already use 18 as the threshold where they name an age at all.
- The Department's own worked example of a non-parent assignor is an **adult** accompanying a child.
- This is **stricter than the regulation**, deliberately, and should be documented as a platform policy rather than presented to customers as a legal requirement. Same discipline as the identifier verification: above the floor, honestly labelled.

**One exception to design for, not to ignore:** a mature minor aged 14–17 attending independently — which is precisely the confidential-consultation cohort (sexual health, mental health, family violence). Under the regulations they can self-assign at 14. Support it, and make sure nothing in the product routes a notification or a portal view to a parent for a patient who has self-assigned. **Getting this wrong is a serious clinical-safety failure, not a billing error.**

- **REQ-AGE-01** Assignor acting for another: minimum 18, enforced.
- **REQ-AGE-02** Patient self-assigning: minimum 14, enforced.
- **REQ-AGE-03** Patient 14+ with a third-party assignor: capture the **written declaration** as a distinct artefact.
- **REQ-AGE-04** Age derived from **date of birth**, never self-attested.
- **REQ-AGE-05** Where a patient aged 14–17 self-assigns, suppress all assignor-directed routing for that patient. Confidentiality is the default, not an option.

### 6.3 Patient data AoBPlatform must hold

You are right that the 14th-birthday trigger forces this. Minimum patient record:

| Field | Why |
|---|---|
| Family name, given names | s 65C(4)(a); RACGP identifier |
| **Date of birth** | RACGP identifier; drives REQ-AGE-\* and REQ-OFF-13 |
| Gender as identified by the patient | RACGP identifier |
| Address | RACGP identifier |
| Patient health record number | RACGP identifier; PMS linkage |
| IHI (optional) | RACGP identifier |
| Preferred language | REQ-LANG-01 |
| Mobile, email | Capture channels |
| MyMedicare registration status | Enduring eligibility and cessation |
| Residential aged care status + facility | Enduring pathway and cessation |
| ACCHO/AMS relationship | Enduring pathway and cessation |
| Accessibility and communication needs | Routing |
| Confidentiality flag | REQ-AGE-05 |

**Explicitly NOT held:** the Medicare number. It is not an RACGP approved identifier, it is not in the s 65C data set, and holding it adds identity-theft exposure for no compliance value. **Do not store it.**

- **REQ-DATA-01** DOB is mandatory. Without it, age rules and the 14th-birthday job cannot run.
- **REQ-DATA-02** Data minimisation: hold only the above. Verification logs store identifier **types and outcomes, never values**.
- **REQ-DATA-03** Nightly scheduled job evaluates all age-derived transitions.

---

## 7. Yes — AoBPlatform tracks agreement status for every party

To confirm your closing question directly: **yes**, and it is the core of the data model.

An **AoB agreement** is the central entity, with two parties and a lifecycle:

```
    PRACTITIONER  ←──── AoB AGREEMENT ────→  ASSIGNOR
    (immutable)          (status)             (may be the patient)
                              │
                              └────────→  PATIENT
                                          (always named)
```

Note that **assignor and patient are distinct roles even when the same person fills both.** Modelling them as one entity because they usually coincide will break on the first aged-care resident.

**Status lifecycle**

`draft → verification_pending → verification_failed → awaiting_signature → signed → validated → active → ceased`

with `expired`, `declined`, `verbal_recorded`, `void` (treatment-plan break), `legal_hold`, and — for enduring — `registration_pending`, `registered`, `registration_overdue`.

**Both parties see status, scoped:**

- **Practitioner / practice:** every agreement naming them; live vs ceased; what is billable today; what is at risk; outstanding capture; enduring anniversaries; notification delivery health.
- **Assignor / patient:** every agreement they signed or are covered by; what each permits; who can bulk bill them; every notification received; one-action termination.

**And this is the actual product.** Not the form — the form is free, government-published and uncertifiable. The defensible asset is **the authoritative, verified, bilingual, audited record of who has consented to what, with whom, and whether it is still live.** Everything else in this design is a way of populating that record accurately or acting on it.

---

## 8. Glossary

### Medicare and claiming

| Term | Meaning |
|---|---|
| **AoB** | Assignment of Benefit — the patient assigning their Medicare entitlement to the practitioner in exchange for no out-of-pocket cost. What bulk billing legally *is*. |
| **Assignor** | The person who assigns the entitlement — the patient, or someone who would otherwise meet the cost (parent, partner, carer, relative, guardian, EPOA holder, friend). Cannot be an employee of the practitioner. |
| **Episodic pre-agreement** | AoB captured **before** the item is rendered. Requires a basic service description rather than an item number. |
| **Episodic post-agreement** | AoB captured **after** the item is rendered. Requires the MBS item number. |
| **Enduring agreement** | A standing AoB covering future items, for MyMedicare, residential aged care or ACCHO/AMS patients. **GP-only.** |
| **MBS** | Medicare Benefits Schedule — the ~5,900-item list of subsidised medical items, with Categories, Groups, Subgroups and item numbers. |
| **Basic Service Description** | Departmental mapping of MBS items into broad categories, used on pre-agreements. Published as XML and CSV on MBS Online, updated quarterly. |
| **Bulk billing** | Accepting the Medicare entitlement as full payment. Requires a valid AoB. |
| **BBPIP** | Bulk Billing Practice Incentive Program — 12.5% loading, from 1 Nov 2025, for practices bulk billing all eligible patients. |
| **MyMedicare** | Voluntary patient registration with a nominated practice. Gates one enduring pathway. |
| **ECLIPSE** | Electronic Claim Lodgement and Information Processing Service Environment — in-hospital and simplified billing to Medicare and insurers. |
| **Easyclaim** | Medicare claiming through an EFTPOS terminal. |
| **DVA** | Department of Veterans' Affairs. **Out of scope** for these AoB requirements. |
| **CDBS** | Child Dental Benefits Schedule. **Out of scope.** |
| **DB4E / DB020** | Services Australia forms for post-assignment. Updated 1 July 2026; prior versions invalid. |
| **PSR** | Professional Services Review — investigates inappropriate practitioner conduct in Medicare. |
| **HIA / HIR** | Health Insurance Act 1973 / Health Insurance Regulations 2018. **s 65C** sets the episodic data set; **65CA/65CB** cover enduring; **89A/89AA** cover retention and post-claim notification. |

### Settings and organisations

| Term | Meaning |
|---|---|
| **RACF** | Residential Aged Care Facility — a nursing home. ~196,000 permanent residents, >4.8m GP attendances a year. |
| **ACCHO** | Aboriginal Community Controlled Health Organisation — primary health care operated by and for the local Aboriginal community. 148 nationally, 550+ locations, ~410,000 people. |
| **AMS** | Aboriginal Medical Service — often used interchangeably with ACCHO. |
| **PHN** | Primary Health Network — 31 regional bodies coordinating primary care. A common guidance channel. |
| **RACGP** | Royal Australian College of General Practitioners — sets the accreditation Standards, including C6.1A patient identification. |
| **AGPAL** | Australian General Practice Accreditation Limited — the larger of the two bodies that assess practices against the RACGP Standards and issue accreditation. Not-for-profit, founded 1997. Accreditation is what makes a practice eligible for the Practice Incentives Program, so losing it has direct revenue consequences. |
| **QPA** | Quality Practice Accreditation (Quality Innovation Performance / QIP) — the other accrediting body. A practice chooses one or the other; both assess against the same RACGP Standards. |
| **Accreditation** | The three-yearly cycle in which a practice is assessed against the RACGP Standards. Relevant here because the Standards require patient identification using approved identifiers (C6.1A) and require practices to seek and act on patient feedback — the two hooks this product attaches to. |
| **AMA** | Australian Medical Association. |
| **Ageing Australia** | Peak body for aged care providers. |

### Government and regulators

| Term | Meaning |
|---|---|
| **DoHDA** | Department of Health, Disability and Ageing — owns AoB policy. |
| **Services Australia** | Operates Medicare claiming and payment. Publishes the forms; will hold enduring agreement registrations. |
| **AHPRA** | Australian Health Practitioner Regulation Agency — practitioner registration. |
| **ADHA** | Australian Digital Health Agency — My Health Record, e-prescribing, secure messaging, HI Service conformance. |
| **ACMA** | Australian Communications and Media Authority — runs the SMS Sender ID Register. |
| **OAIC** | Office of the Australian Information Commissioner — privacy regulator. |
| **ANAO** | Australian National Audit Office. |
| **TIS National** | Translating and Interpreting Service. Free interpreting for medical practitioners providing Medicare-rebateable items. |
| **NAATI** | National Accreditation Authority for Translators and Interpreters. |

### Technical and integration

| Term | Meaning |
|---|---|
| **PMS** | Practice Management Software — Best Practice, MedicalDirector, Zedmed, Medtech Evolution, Genie/Gentu, Cliniko, Halaxy. |
| **NOI** | Notice of Integration — Services Australia's certification that a software version passed integration testing for specified claiming functions. |
| **NOC** | Notice of Connection — the ADHA equivalent. |
| **CCD** | Conformance Compliance and Declaration — ADHA self-assessment. |
| **PRODA** | Provider Digital Access — the government identity system for health providers. |
| **HPOS** | Health Professional Online Services — the Services Australia provider portal. |
| **IHI** | Individual Healthcare Identifier — 16-digit unique patient identifier. An RACGP approved identifier. |
| **HPI-I / HPI-O** | Healthcare Provider Identifier — Individual / Organisation. |
| **NASH** | National Authentication Service for Health — PKI certificates. **End-of-life September 2026**, ceasing 2028. |
| **Minor ID** | Per-site identifier a software vendor issues to each customer location. |
| **SVT / DTSS** | Software Vendor Test environment / Developer Testing and Support System. |
| **IRAP** | Infosec Registered Assessors Program — government security assessment. **Vendor-funded.** |
| **ETA** | Electronic Transactions Act 1999. s 10 sets the electronic signature test: reliably identify the assignor, reliably indicate concurrence by requiring an action. |
| **APP** | Australian Privacy Principles. **APP 1.7/1.8** — automated decision-making transparency, from 10 December 2026. |

---

## 9. Actions arising

| # | Action | Priority |
|---|---|---|
| 1 | Put the **bidirectional cessation reconciliation** proposal to Services Australia alongside the registration question — registration without deregistration is incomplete | 🔴 |
| 2 | Make **practitioner immutable** on the agreement entity, with no transfer path in the schema | 🔴 Architectural, hard to retrofit |
| 3 | Adopt the **terminology rule** (§0) across documents, schema, API and UI copy | 🔴 Cheap now, expensive later |
| 4 | Model **assignor and patient as distinct roles** even when the same person | 🔴 |
| 5 | Confirm the age policy: assignor 18+, self-assign 14+, with confidentiality suppression for 14–17 | 🟠 |
| 6 | Defer the **re-consent campaign** capability past v1 until anomaly baselines exist | 🟠 |
| 7 | Build the AI channel as **intent classification only**, with deterministic confirmation screens | 🟠 |
| 8 | Confirm in writing that the platform **never stores a Medicare number** | 🟢 |
