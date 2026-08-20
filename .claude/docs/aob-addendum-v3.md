# Addendum v3 — Data model, clients, delivery evidence, safeguarding
### 19 August 2026 · Extends Requirements v0.3, Solution Design v0.1, Design Decisions, Addendum v2

---

## 1. Two corrections on enduring agreements

### 1.1 No, a practice cannot hold one agreement covering all its GPs

You asked whether the practice could have a single agreement. It cannot, on the MyMedicare pathway.

The FAQ wording is easy to misread. It says a MyMedicare patient *"will be able to make enduring agreements to receive services from **all** general practitioners at their MyMedicare practice, if offered"* — which sounds practice-wide. The very next sentence resolves it: *"**Agreements are per practitioner**, but multiple agreements can be made at the same practice."*

So the patient can be covered for every GP at the practice — by holding a **separate agreement with each of them**. Ten GPs means ten agreements for that patient.

**But there is one genuine exception, and it matters:**

| Pathway | Anchor | One agreement covers |
|---|---|---|
| **MyMedicare** | Individual practitioner | One GP |
| **Residential aged care** | Individual practitioner | One GP |
| **ACCHO / AMS** | **The organisation**, entered via its authorised agent | **All professionals the organisation employs, across all its clinics** |

The ACCHO/AMS pathway is organisation-level. The agreement records the **name of the authorised agent** and the **practice address or provider number of the agent** rather than an individual practitioner. A patient may also hold multiple agreements with multiple ACCHOs or AMSs.

**Design consequence:** the anchor is polymorphic — `practitioner` for MyMedicare and aged care, `organisation` for ACCHO/AMS. Modelling everything as practitioner-anchored will make the ACCHO pathway impossible to represent, and ACCHO is the pathway serving the population with the greatest need.

### 1.2 How the excluded segments actually operate

You asked how specialists, allied health and optometry use AoB if enduring is closed to them. **Episodic capture, every single time, forever.** There is no relief mechanism.

Their toolkit is exactly three things:

**(a) Episodic post-agreement** — after the item, with the MBS item number. The default, and the one that generates all the chase labour.

**(b) Episodic pre-agreement** — before the item, using a basic service description. Valid as long as the delivered item falls **inside** that description. Better for allied health than for general practice, because an allied health appointment is far more predictable — a physiotherapy consultation is a physiotherapy consultation. A high-yield position for that segment.

**(c) The 6-month multi-item pre-agreement** — one agreement covering an enumerated schedule: same practitioner, specified dates, specified items, up to six months. **This is their only volume tool**, and it maps almost perfectly onto how these segments actually work:

| Segment | Fit |
|---|---|
| Allied health | Course-of-treatment plans — a chronic disease management referral is capped at five items a year, all with the same practitioner |
| Oncology, renal, palliative | The Department's own worked examples: dialysis, cancer treatment, palliative care |
| Optometry | Highest bulk-billing rate of any segment (~94%), and highly repeatable item patterns |
| Specialists | Scheduled review sequences |

The catch is the fragility already noted: any change to date, practitioner or item voids that occurrence. Which is precisely why the Treatment Plan Assignment feature (REQ-PLAN-\*) — schedule monitoring, break detection, occurrence-level remediation — is **not a general-practice feature at all**. It is the core product for everyone else.

**Positioning consequence.** For general practice, the pitch is *"enduring agreements make most of this disappear."* For every other segment it is *"episodic is permanent, so the capture workflow has to be excellent, and the 6-month plan agreement is the only lever you have."* Two different pitches, two different products emphases, same platform.

---

## 2. Delivery evidence for the 24-hour notice

Adopted. This turns the weakest point of the enduring model into its strongest compliance artefact.

**Why it matters.** The obligation is to notify the assignor in writing within 24 hours of the claim, by the method named in the agreement. A practice that cannot evidence delivery cannot answer an auditor. A practice that can, answers in one export.

### 2.1 The delivery evidence chain

Five states, each independently evidenced, per notice:

| State | Evidence captured | Meaning |
|---|---|---|
| **Composed** | Payload hash, four mandatory elements present, agreement reference, claim reference, timestamp | The obligation was correctly formed |
| **Dispatched** | Gateway accept, message ID, sender ID, channel, method-matches-agreement check, timestamp | It left our system inside the window |
| **Delivered** | Carrier delivery receipt (SMS DLR), SMTP acceptance + no bounce, or push receipt | It reached the device or mailbox |
| **Read** | Open event, portal view, link click, app open | Best-effort only — see below |
| **Failed** | Failure code, reason, retry history, fallback attempted | The obligation is at risk; act |

**REQ-DEL-01** Every notice records all five states with independent timestamps and immutable evidence. Never collapse to a single `sent` boolean.

**REQ-DEL-02** **Method fidelity check.** Reg 89AA requires the method named in the agreement. If the agreement says email and the practice sends SMS, that is a breach even if it arrives. Validate channel against the agreement at compose time and block a mismatch.

**REQ-DEL-03** **The 24-hour clock is explicit.** Countdown from claim lodgement, visible, with escalation at 12 and 18 hours. Timezone-correct — this is a national product and a Perth practice is three hours behind a Sydney one.

**REQ-DEL-04** **Fallback cascade on failure**, within the window: retry the named method, then the agreement's alternate if one is recorded, then alert the practice for manual action with the deadline shown. Never let the window expire silently.

**REQ-DEL-05** **Bounce and churn detection.** A dead mobile or bounced mailbox means every future notice under that agreement fails. Flag the agreement for contact refresh; do not accumulate a year of silent failures.

**REQ-DEL-06** **Error correction path.** The regulation requires errors corrected within 24 hours of the practice becoming aware. Model correction as a linked, superseding notice — never edit the original.

### 2.2 Read receipts — be honest about their limits

Open tracking is unreliable by design. Image-blocking, privacy proxies, and Apple Mail Privacy Protection all break it, and SMS has no read receipt at all.

**REQ-DEL-07** Read state is **evidential colour, never a compliance measure.** The obligation is to *send*, not to be *read*. A dashboard that scores compliance on read rates will read as a failing system when it is fully compliant. Report on **dispatch within window** and **delivery confirmation**; show read as supplementary.

### 2.3 The audit pack

**REQ-DEL-08** One action produces a **Notification Compliance Pack** for any date range, practitioner or patient: every claim under an enduring agreement, its matching notice, dispatch and delivery evidence, elapsed time against the 24-hour requirement, exceptions with reasons and remediation. Timestamped, hashed, exportable.

**This is what a practice hands an auditor.** It is also the demonstration that sells the product — "here is what you would produce if Services Australia asked" is a more persuasive thirty seconds than any feature list.

**REQ-DEL-09** Continuous compliance rate on the dashboard: notices dispatched within 24 hours as a percentage, by practitioner, with a trend. A practice that can see it slipping will act before an auditor does.

---

## 3. Safeguarding and elder abuse — build it properly, ship it later

Locked in as a deliberate later build. Your read is right: Australian government has sustained policy attention on elder financial abuse, and traceable authority over a vulnerable person's financial decisions is exactly the kind of capability that attracts favourable attention rather than scrutiny.

**REQ-SAFE-01** **Authority ledger.** Every nomination, activation, deactivation, agreement signed by a third party, and change of assignor is an immutable event with actor, timestamp, channel, prior state and evidence. The complete history of who held financial authority over this patient, and when.

**REQ-SAFE-02** **Pattern detection, surfaced to the practice only.** Signals worth watching:

- One actor removing multiple nominated assignors in a short window
- A newly added assignor immediately followed by removal of long-standing ones
- An assignor acting for an unusually large number of unrelated patients
- Agreements signed by a third party where the patient has capacity and attends alone
- Contact details for several unrelated patients converging on one phone number or email
- Enduring agreements created for a cohort in rapid succession from a single actor

**REQ-SAFE-03** **Never notify the suspected party.** No alert, no confirmation, no "your authorisation was changed" message to a removed or flagged assignor. Alerts go to the practice, and only the practice.

**REQ-SAFE-04** **The platform does not make findings.** It surfaces patterns to a clinician. It does not label anyone an abuser, does not compute a risk score about a named person, and does not act automatically. That line is both an ethical requirement and what keeps this outside the automated-decision-making exposure in APP 1.7/1.8.

**REQ-SAFE-05** **Patient-visible authority list.** In the portal, in their language: *"These people can currently consent to bulk billing on your behalf."* Most abuse depends on the subject not knowing. Simply showing them is the single highest-leverage control here, and it costs almost nothing.

**REQ-SAFE-06** **Escalation to the practice, never to police or a regulator.** The clinician holds the relationship, the context and the mandatory reporting obligations. The platform's job ends at putting the pattern in front of them.

**⚠️ One caution.** Do not market this as elder abuse detection until it has been reviewed by people who do safeguarding for a living — the Older Persons Advocacy Network, an elder law practitioner, and a clinician with safeguarding experience. A detection capability that is wrong, or that notifies the wrong person, causes real harm to real people. It is a strong asset built carefully and a liability built quickly.

---

## 4. Hard rules, locked

These are architectural invariants. They go in the schema and the code review checklist, not in a design document nobody reads.

**HARD-01 — The practitioner on an agreement is immutable.**
No update path. No admin override. No migration script. Changing practitioner means terminating one agreement and creating another, with fresh consent and fresh verification. Enforced at the database layer (no `UPDATE` permission on the column), in the domain model (no setter), and in code review.

**HARD-02 — The agreement's rendered content is immutable once signed.**
Corrections create a superseding agreement linked to the original. Nothing rewrites a signed artefact.

**HARD-03 — The Medicare number is never stored.**
Not an RACGP approved identifier, not in the s 65C data set, no compliance value, pure identity-theft exposure.

**HARD-04 — Identifier values never appear in verification logs.**
Types and outcomes only.

**HARD-05 — Signature capture is impossible against an unvalidated payload.**
The control cannot be enabled until validation passes. This one is a criminal offence, not a bug.

**HARD-06 — Practice staff cannot create or amend a patient's assignor nominations.**
They may record a paper nomination as an attributed, distinct event.

**HARD-07 — A confidentiality-flagged patient never has anything routed to a third party.**
See §5.

---

## 5. Child safety rules

**REQ-CHILD-01** **Confidentiality flag on the patient record.** Set automatically when a patient aged 14–17 self-assigns; settable manually by a clinician at any age. Once set, it is **removable only by the patient or a clinician** — never by an assignor, never by administrative staff.

**REQ-CHILD-02** **Total routing suppression for a confidentiality-flagged patient.** No notice, portal view, agreement copy, reminder, receipt, chase message, delivery report or audit extract that names the patient goes to any third party — including a person who is a nominated assignor for that patient and including a parent.

**REQ-CHILD-03** **Self-assignment from 14.** A patient aged 14 or over may be their own assignor. When they do, no third-party assignor is engaged for that agreement, and no assignor is notified that it exists.

**REQ-CHILD-04** **Content-blind messaging for this cohort.** No message names the practitioner, the practice specialty, or the item. *"You have a document to review"* plus a link — nothing that discloses attendance at a sexual health, mental health or family violence consultation to whoever picks up the phone.

**REQ-CHILD-05** **The 14th-birthday transition is silent to third parties.** When an enduring agreement automatically ceases because the patient turned 14, notify the **practice** and prompt re-papering. Do not notify the former assignor with an explanation that discloses the patient's new autonomy.

**REQ-CHILD-06** **No aggregate view leaks it.** A parent who is assignor for three children must not be able to infer a fourth relationship, or the loss of one, from a dashboard, a list, a count or an audit export.

**REQ-CHILD-07** **Fail closed.** If confidentiality status cannot be determined, suppress. An unsent notice is a compliance issue. A disclosed consultation is a safety incident, and potentially a life-threatening one.

**REQ-CHILD-08** Tested explicitly, with named test cases, in every release. This is the class of rule that regresses silently when someone adds a convenient new notification.

---

## 6. Behaviour and anomaly tracking

**REQ-ANOM-01** Continuous monitoring across four families:

| Family | Signals |
|---|---|
| **Enrolment velocity** | Agreements per practitioner per day far above baseline; campaigns converting near 100% — real ones do not; enrolment outside business hours; enrolment clustered in seconds |
| **Relationship plausibility** | Agreements with patients who have no appointment history with that practitioner; enrolment concentrated in patients who have never attended; re-consent for a departed practitioner's whole list |
| **Consent quality** | High verification-failure-then-success rates; unusual proportion of verbal after the transition; the same device fingerprint signing for many unrelated patients; identical signature strokes |
| **Lifecycle integrity** | Claims lodged against ceased agreements; notices not dispatched; agreements past anniversary without a registration record; termination followed immediately by re-enrolment |

**REQ-ANOM-02** **Baseline first, thresholds second.** No anomaly detection ships until there is enough real usage to know what normal looks like. Static thresholds on a new platform produce false positives that train users to ignore alerts.

**REQ-ANOM-03** **Practice sees its own; we see the aggregate.** A practice sees its own anomalies and can act. Cross-practice patterns are ours, and are the basis for anything reported onward.

**REQ-ANOM-04** **Reporting to Services Australia is structured, evidenced, factual and never a conclusion.** Report *what happened* — 400 agreements created in nine minutes for patients with no attendance history — never *what we think it means*. We are not an investigator and should never present as one.

**REQ-ANOM-05** **Human review before any onward report.** No automated referral of a named practitioner to a regulator, ever. That is the Robodebt-shaped mistake, and it would end the company.

**REQ-ANOM-06** Every alert is explainable in plain language: what fired, which signals, over what window, against what baseline.

---

## 7. What AoBPlatform captures — and where I disagree with you

You asked directly, so here is a direct answer: **partly yes, and one part I would push back on.**

### 7.1 Agreed

**AoBPlatform is the system of record for consent, and the PMS just wants the answer.** That is exactly right and it is the product's core insight. The complexity — verification evidence, signature binding, rule-set versions, delivery chains, cessation triggers, anniversaries, safeguarding ledgers, multilingual artefacts — belongs here. What the PMS receives is: *a valid agreement exists, here it is, here is its status.*

### 7.2 Where I disagree

**"Capture what the PMS captures and more" would be a mistake.**

Capture what the PMS captures and you have built a shadow practice management system. That gets you:

- **Synchronisation problems that never end.** Two systems holding the same patient demographics diverge within days. Every divergence is a potential verification failure, and verification failure is your core function.
- **A much larger privacy surface** for no compliance value, and a correspondingly heavier security review on every deal.
- **A competitive posture with the partner you depend on.** Medtech will integrate with a consent product. It will be considerably less enthusiastic about a product that has copied its patient database.
- **Scope creep into clinical data**, where the regulatory bar is far higher.

**The better frame: AoBPlatform holds everything the *agreement* needs, and nothing the *practice* needs.**

Not a mirror of the PMS. The authoritative record of a legal instrument — which happens to reference patients, practitioners and items that live elsewhere.

The test for any proposed field: **would we need this to prove an agreement was valid, or to fulfil an obligation arising from it?** If yes, hold it. If it is there because the PMS has it, do not.

### 7.3 The entity model

**Patient** — the minimum to verify identity and route correctly.
Family name, given names, **date of birth**, gender as identified, address, patient health record number, IHI (optional), preferred language, accessibility needs, mobile, email, **confidentiality flag**, MyMedicare status, residential aged care status and facility, ACCHO/AMS relationship, PMS linkage key.
*Never: Medicare number, clinical data, diagnoses, medications, notes.*

**Assignor** — a person, not a field on the patient.
Name, date of birth (for the 18+ rule), relationship to patient, authority basis, contact details, preferred language, optional evidence attachment. One assignor may act for many patients; one patient may have many assignors. **Modelled separately from Patient even when they are the same human.**

**Practitioner** — identity sufficient for the data set.
Name, practice address, provider number (optional — either satisfies s 65C(5)), AHPRA registration status and check date, GP flag (enduring eligibility), practice and location linkage.

**Practice / Organisation** — including the ACCHO/AMS authorised agent construct.

**Agreement** — the centre of everything.
Type (episodic pre / episodic post / 6-month plan / enduring); pathway; **immutable practitioner or organisation anchor**; patient; assignor; assignor-is-patient flag; the complete s 65C or 65CB data set as rendered; scope (basic service description, or item numbers, or MBS Category/Group/Subgroup for enduring); status; rule-set version; Basic Service Description mapping version; language(s) rendered; the rendered artefact and its hash; retention clock and legal hold; anniversary and registration state.

**Verification event** — identifier types challenged, outcome, timestamp, channel, device fingerprint, IP, staff member if staff-verified. **Values never stored.**

**Signature event** — method, image or action, rendered-artefact hash, timestamp, channel, device, the verification event that preceded it, assignor identity and authority basis.

**Notice** *(reg 89AA)* — agreement, claim reference, four mandatory elements, channel, method-fidelity check, the five delivery states with evidence, elapsed time against the window, correction linkage.

**Nomination** — patient, nominated assignor, scope, active flag, effective dates, full change history.

**Cessation event** — type, trigger, effective timestamp, initiating party, notice generated, Services Australia transmission state.

**Treatment plan** — enumerated occurrences, monitored schedule, break events, remediation state.

**Audit log** — append-only, over everything.

### 7.4 The integration contract with the PMS

**Inbound (we read, we do not own):** patient demographics, appointments, providers, invoices and item numbers, MyMedicare and facility status where held.

**Outbound (the answer):** a validated agreement artefact into the patient record; a status the PMS can act on — *valid agreement exists / does not exist / ceased*; a linkage key; the audit reference.

**REQ-DATA-10** Patient demographics are **read-through with a short cache**, not a synchronised copy. The PMS is the source of truth for who the patient is. We are the source of truth for what they consented to.

**REQ-DATA-11** Where a field is required by the s 65C data set, we snapshot it **onto the agreement** at signature time. The agreement must remain valid even if the patient later changes address — the artefact records what was true when signed.

That distinction — **cache the person, snapshot the agreement** — is the whole data architecture in five words.

---

## 8. Clients and devices

You listed six. Here is where I would push back on two of them, and one alternative for the "Yes it is me" moment that I think is better than an app.

### 8.1 The recommendation

| # | Client | Build | Why |
|---|---|---|---|
| 1 | **Practice tablet — iPad and Android** | **Native, v1** | Needs true offline capture, kiosk lockdown, reliable signature capture on glass, and background sync. This is the differentiating surface and the only one that genuinely requires native. |
| 2 | **Kiosk** | **Same native app, kiosk mode, v1** | Not a separate product. Same binary in single-app mode with staff-assist, idle reset, privacy screen and an accessibility mode. |
| 3 | **Patient / assignor on their own phone** | **Web (PWA), v1 — not an app** | See below. |
| 4 | **Practice management app** | **Web, v1; native later if asked** | Practice managers work on a desktop. A native app is a nice-to-have here, not a requirement. |
| 5 | **Patient app** | **PWA v1; native v2** | Same reasoning as 3. |
| 6 | **Assignor app** | **PWA v1; native v2 for high-frequency assignors only** | See 8.3. |

### 8.2 Why I would not build a patient app first

**App install friction will destroy your conversion rate, and conversion is the entire product.**

A patient receives a message asking them to consent to bulk billing for a consultation they have already had. If the next step is *download an app, create an account, verify an email, log in* — most will not. Your 15–20% non-response becomes 60–70%. The single number the product exists to improve gets worse.

A web link opens instantly, works on every device, needs no store approval, ships fixes the same day, and works for the 78-year-old who has never installed an app. A PWA can still be added to the home screen, send push notifications, and work offline.

**Ship native when there is a reason.** The practice tablet has one — offline and kiosk. The patient does not, until you have high-frequency users.

### 8.3 The "Yes it is me" moment — a better answer than an app

Your instinct is right: the one-tap approval needs to be trustworthy. But an app is a heavy way to get there, and it does not actually solve identity — anyone holding the unlocked phone can tap the button in an app just as easily as in a browser.

**Use passkeys, bound to the device, with biometric confirmation.**

- **First contact:** three RACGP-approved identifiers, in the browser. No install.
- **On success:** offer to remember this device. A passkey is created, bound to that device, protected by Face ID / fingerprint / device PIN.
- **Every subsequent time:** the link opens, the phone asks for the fingerprint, done. Two seconds.

Why this beats an app:

| | App | Passkey in browser |
|---|---|---|
| Install friction | High | **None** |
| Works first time, immediately | No | **Yes** |
| Phishing resistant | Not inherently | **Yes — bound to our domain** |
| Confirms a *person*, not just a device | No | **Yes — biometric** |
| Works for infrequent users | Poorly | **Well** |
| Store review on every release | Yes | **No** |

Passkeys are supported natively on current iOS and Android and in every major browser. This is a standard mechanism, not a novelty.

**REQ-CLIENT-01** Progressive identity: three identifiers first time, passkey thereafter, with the three-identifier path always available as fallback for a new or shared device.
**REQ-CLIENT-02** Passkey enrolment is **optional and never a barrier**. A patient who declines uses identifiers every time.
**REQ-CLIENT-03** The biometric confirms the person **for our purposes**. The s 65C signature remains the recorded action; the passkey is verification evidence attached to it, not a substitute for the signature.

### 8.4 Where a native assignor app does earn its place

One cohort genuinely benefits: **high-frequency assignors** — an aged care facility liaison, a family member acting for several residents, an ACCHO care coordinator, a group-home manager. They may handle dozens of agreements and hundreds of notices. For them: a list view, batch actions, offline access, push.

That is a v2 build for a known, small, identified user group — not a v1 bet on patient adoption.

---

## 9. Adjacent commercial ideas

### 9.1 Your idea — managed capture and follow-up

**Strong. Possibly stronger than the software on its own.**

The practice's pain is not the form. It is **9–12 chase calls a day and 30–45 minutes of end-of-day reconciliation, modelled at $4,000–5,000 per FTE GP in year one.** That is labour. A product removes some of it; a managed offering removes all of it.

Shape:
- **AI voice and messaging handles the bulk** — outbound reminder, identity verification, walk the assignor through signing, escalate on confusion, all in the patient's language
- **A small human team handles what AI should not** — distress, confusion, safeguarding signals, complex assignor situations, anyone who asks for a person
- **The practice sees a queue that empties**, not a queue that grows

Why it is commercially strong:
- **Priced against labour, not against software.** Your competitor at zero marginal cost bundles a form. Nobody bundles staff.
- **Sticky.** Software gets switched. An outsourced function does not.
- **It is the actual job.** "We remove the follow-up" beats "we provide a form" in any conversation with a practice manager.
- **The AI improves with your own data** — you can see which message, in which language, at which hour, in which channel converts.

Constraints to design in from the start:
- **The AI never determines consent.** It reminds, explains and assists. The assignor signs on a deterministic screen.
- **Confidentiality-flagged patients are excluded from outbound chase entirely** (REQ-CHILD-04).
- Recorded, consented, retained calls; identity verified before any patient information is disclosed.
- Human escalation always available and offered proactively.

### 9.2 Enduring enrolment campaigns, done for you

A practice converting its MyMedicare book faces a one-off project of thousands of agreements, per practitioner. It has no capacity for that. **Priced per completed agreement**, this is a substantial one-off alongside the subscription — and every agreement created deepens the platform's hold.

### 9.3 The notice engine as a component for PMS vendors

Not every PMS will build the 24-hour notice engine — most have not built enduring agreements at all. A white-label API sold to PMS vendors reaches practices you will never sell to directly. It is a different motion with a longer cycle, but it turns the incumbents from competitors into distribution.

### 9.4 Audit response

When Services Australia or the PSR asks, the practice must produce agreements, delivery evidence and retention records. **A managed audit-response offering** — assemble the pack, identify gaps, prepare the narrative — is high-value, low-volume, and reached exactly when the practice most values you. Naturally paired with the Notification Compliance Pack (§2.3).

### 9.5 Registration management — after the mechanism exists

Once Services Australia publishes how enduring agreements are recorded, managing millions of anniversary-bound records is a service in itself. **Do not build a business on it yet** — no mechanism has been published, and the requirement could still be deferred.

### 9.6 One I would not pursue yet

**Benchmarking and data products.** The aggregate consent data would be commercially interesting. It is also patient health information, and monetising it — even de-identified — invites a privacy conversation you do not want while establishing trust. Revisit in three years, or never.

---

## 10. Actions

| # | Action | Priority |
|---|---|---|
| 1 | Make the agreement anchor **polymorphic** — practitioner or organisation — before any schema is written | 🔴 ACCHO is impossible to retrofit |
| 2 | Enforce **HARD-01 to HARD-07** at the database layer, not just in application code | 🔴 |
| 3 | Adopt **cache the person, snapshot the agreement** as the data architecture rule | 🔴 |
| 4 | Build the **five-state delivery evidence chain** into the notice engine from the first line | 🔴 Retrofitting evidence is impossible |
| 5 | Write the **child-safety test cases** now, and run them every release | 🔴 |
| 6 | Prototype the **passkey flow** before committing to native patient apps | 🟠 |
| 7 | Re-pitch the **non-GP segments** on episodic excellence + the 6-month plan agreement | 🟠 Different pitch, same platform |
| 8 | Scope the **managed capture and follow-up** offering — it may be the stronger business | 🟠 |
| 9 | Have the **safeguarding capability reviewed** by OPAN, an elder law practitioner and a clinician before it ships | 🟢 Before launch, not before build |
