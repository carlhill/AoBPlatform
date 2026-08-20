# AoBPlatform — Threat Model: Stolen Patient Data
### 19 August 2026 · Extends Requirements v0.3 and all addenda

---

## 1. The finding that matters most

**Three-identifier verification is a shared-secret model, and a breach means the secret is no longer shared.**

The six RACGP-approved identifiers are name, date of birth, gender, address, patient health record number and IHI. Every one of them sits in a stolen practice database. So an attacker holding that database can satisfy REQ-VER-01 perfectly, every time, for every patient in it.

This is not a flaw in the RACGP Standard — the Standard was written for a receptionist confirming they have the right person, not for defending a self-service web form against an adversary with the answer key. It is a flaw in *our* application of it, and it needs saying plainly:

> **Knowledge-based verification proves the person knows the answers. After a breach, so does the attacker.**

Everything below follows from that. The design has to move from *what the person knows* to *what the person holds*, with knowledge as a fallback rather than the primary control.

---

## 2. What an attacker can and cannot do — the structural mitigation

Before designing controls, be precise about what stolen patient data is actually worth here. It is less than it first appears, and knowing why tells you where to spend.

**The money does not flow to the patient.** A bulk-billed Medicare benefit is paid to the **practitioner**, against a **provider number**, into a bank account registered to that provider. An attacker holding ten thousand patient records has no way to receive a cent.

| Attacker holds | Can they extract money? |
|---|---|
| Patient data only | **No.** No provider number, no payee, no path to funds |
| Patient data + a compromised or complicit provider number | **Yes** — this is the real threat |
| Provider number only | Limited — fabricating patients is harder than using real ones |

**So AoB fraud at scale requires provider-side capability.** Patient data is the accelerant, not the fire. That reframes the priority: the anomaly detection in REQ-ANOM-01 — which watches practitioner-side behaviour — is a **more important control than patient-side identity verification**, because it targets the part of the chain the attacker cannot avoid.

It also means the harms from a patient-data breach alone are mostly **privacy harms**, not financial ones. That does not make them small. Knowing which patients attended which practice, when, and with whom is sensitive information, and for some patients it is dangerous information.

---

## 3. Threat scenarios

### T1 — Compromised or complicit provider plus a bought patient list
**The one that matters.** A provider number under an attacker's control, combined with a purchased patient list, produces mass fabricated agreements and mass claims against real patients who never attended.

*Detection:* practitioner-side anomaly signals — enrolment velocity, claims for patients with no attendance history, signature stroke uniformity, device fingerprint reuse, undeclared bulk activity. **This is what REQ-ANOM-01 and REQ-BOT-01 to 09 exist for.** Patient-side verification is largely irrelevant here, because the attacker controls the capture surface.

*Also:* a real patient may notice — which is why the patient portal and the 24-hour notice (for enduring agreements) are integrity controls, not just conveniences. They are the only channel that reaches a person with no reason to lie.

### T2 — Impersonation of the patient or assignor to reach the portal
An attacker with three identifiers logs in and reads consent history: which practitioners, which dates, which practice.

*Harm:* privacy, not money. But for a patient at a sexual health clinic, a family violence service, or a mental health practice, disclosure of *attendance alone* can be dangerous — which is exactly why the confidentiality rules in REQ-CHILD-01 to 08 are not only about minors.

*Response:* possession-based authentication for portal access (§4), never knowledge alone.

### T3 — Phishing that impersonates us
**The highest-probability scenario and it requires no breach of anything we control.** We have trained an entire population to expect an SMS with a link asking them to sign a Medicare consent. An attacker with a patient list sends a very convincing version of that message.

*Harm:* harvested credentials, harvested further identity data, malware. And reputationally it lands on us, whether or not we were involved.

*Response:* ACMA Sender ID registration (already REQ-VER-05), consistent short branded domains, and — the strongest control — **the portal as an independent verification channel**: a patient can always open the app or site themselves and see whether a request is genuinely pending. Say this in every message: *"Not sure this is real? Open AoBPlatform yourself and check."*

### T4 — Social engineering a practice using stolen data
An attacker calls a practice with a patient's full identifiers and asks to be recorded as a nominated assignor, or to change the contact mobile on file.

*Harm:* the attacker becomes a legitimate-looking assignor and can consent on the patient's behalf. Combined with T1 this becomes financially viable.

*Response:* a contact-detail change is a **security event**, not an administrative one — see REQ-SEC-05. And REQ-NOM-05 already prevents anyone other than the patient from creating nominations.

### T5 — AoBPlatform itself as the target
We aggregate consent records across many practices. That makes us a more valuable target than any single practice, and a single point of failure for all of them.

*Response:* §6. This must be treated as the most likely serious incident, not the least.

### T6 — The breached practice keeps operating
Underrated. A practice is compromised on a Monday, discovers it on a Friday. Between those days, agreements are being created through systems the attacker may control.

*Response:* a practice-level **containment mode** (REQ-SEC-08) that can be triggered in minutes, quarantining everything captured in a defined window without destroying evidence.

---

## 4. The design response — layered identity

Replace a single knowledge check with four layers. No single layer is trusted alone, and the mix adapts to risk.

| Layer | What it proves | Defeated by a data breach? |
|---|---|---|
| **Knowledge** — three RACGP identifiers | The person knows the answers | **Yes, completely** |
| **Possession** — the mobile or mailbox we already hold, and one-time links bound to it | The person holds the device we previously reached | Only if the attacker also controls the number |
| **Device binding** — passkey with biometric | *This device, this person, this domain* | **No** — cannot be phished, cannot be replayed |
| **Behaviour and context** — device history, timing, location consistency, stroke dynamics | Consistency with the real person's past | **No** — not present in any stolen record |

### Requirements

**REQ-SEC-01 — Knowledge alone is never sufficient for a repeat interaction.** First contact may use identifiers. Every subsequent one requires possession or device binding, with identifiers as a step-up fallback rather than the primary path.

**REQ-SEC-02 — Passkeys become the primary factor, not an optional nicety.** This upgrades REQ-CLIENT-01 from a convenience to a security control. A passkey is bound to our domain, so it cannot be phished, and to a device, so it cannot be replayed from a stolen database.

**REQ-SEC-03 — Risk-based step-up.** Elevate verification when: the device is new, the contact detail changed recently, the request arrives from an unusual location or at an unusual hour, the patient has no prior agreement with this practitioner, or the practice is under an active anomaly flag.

**REQ-SEC-04 — Verification data is never reusable across sessions.** No identifier values stored (HARD-04 already), no answers cached, no "remember my details".

**REQ-SEC-05 — A contact-detail change is a security event.** Changing the mobile or email on file: notify the **old** address as well as the new, impose a cool-down before that channel can be used for consent capture, log it as a distinct event, and feed it into the risk score. This is the standard account-takeover pattern and it is how T4 succeeds.

**REQ-SEC-06 — Breach-aware verification posture.** When a practice reports a compromise, that practice's patients move to elevated verification automatically — knowledge-based paths disabled, possession or device binding required, or capture routed to staff-assisted in-practice only.

**REQ-SEC-07 — Never disclose which identifier failed.** "Those details do not match" and nothing more. Telling an attacker that two of three matched turns a lookup into an oracle.

**REQ-SEC-08 — Practice containment mode.** One action, available to us and to the practice principal: suspend all remote capture for that practice, quarantine everything captured in a defined window for review, preserve every artefact, notify affected patients through independent channels. Minutes, not days.

---

## 5. When a practice is breached — obligations, and an opportunity

### 5.1 The legal position

- **Notifiable Data Breaches scheme** (Privacy Act 1988, Part IIIC): an eligible data breach — unauthorised access likely to result in serious harm — must be notified to the OAIC and to affected individuals as soon as practicable, with a maximum of **30 days to assess** a suspected breach.
- **Health service providers are covered regardless of turnover.** The small-business exemption does not apply to them, so a two-GP practice carries the same obligation as a hospital.
- **Health has repeatedly been the top-reporting sector** in OAIC's Notifiable Data Breaches reports, and 2025 set an all-time high for notifications overall.
- **A statutory tort of serious invasion of privacy commenced 10 June 2025.** Individuals can now sue directly, and — significantly — **damages do not require proof of financial loss**. This materially raises the consequence of a health data breach beyond regulatory action.
- **We are almost certainly a separate APP entity holding the same information.** Both the practice and AoBPlatform may have obligations for the same incident. Who assesses, who notifies, and who speaks to affected patients must be settled in the contract **before** an incident, not during one.

### 5.2 Requirements

**REQ-BR-01 — Contractual breach protocol** in every practice agreement: who assesses, who notifies the OAIC, who contacts patients, timeframes, evidence preservation, single point of contact each side. Signed before go-live.

**REQ-BR-02 — Impact report on demand.** For any practice and any date range: which patients had data processed, which agreements exist, which notices were sent, which verification events occurred, what was accessed and by whom. This is the report the practice cannot produce from its own systems and needs within days.

**REQ-BR-03 — Compromise indicators feed forward.** Where a breach is confirmed, every agreement captured in the exposure window is flagged for review — not voided automatically, because most will be legitimate and voiding them destroys the practice's ability to claim.

**REQ-BR-04 — Independent patient channel.** Notification to affected patients must not route through the compromised practice's systems.

**REQ-BR-05 — Evidence preservation.** Containment mode preserves; it never deletes. The audit log is append-only (REQ-NFR-04) precisely so it survives an incident intact.

### 5.3 The opportunity, stated carefully

A breached practice is in the worst week of its professional life and must, within 30 days, work out **who was affected and how**. Almost no small practice can do that from its own records.

A platform holding a complete, append-only, per-patient record of every interaction can produce that answer in an afternoon. **REQ-BR-02 is genuinely valuable, and it is worth building whether or not it is ever sold separately.**

But sell it as *breach readiness*, never as breach insurance. We reduce the cost of responding to an incident. We do not prevent one, we do not discharge the practice's obligations, and we should never imply either.

---

## 6. If we are the ones breached

We become the aggregation point for consent records across many practices. That is a bigger prize than any single practice, and it is the incident that would end the company.

**REQ-SEC-09 — Data minimisation is the primary defence.** Everything not held cannot be stolen. This is the security rationale for the position taken in Addendum v3 §7 — do not mirror the PMS. **Never store the Medicare number** (HARD-03). Never store clinical data. Never store identifier values in logs (HARD-04). Every field admitted must pass the test: *do we need this to prove an agreement was valid, or to fulfil an obligation arising from it?*

**REQ-SEC-10 — Segregation by practice.** No credential or query path can traverse practices. The worst outcome is one compromised practice account yielding the national dataset.

**REQ-SEC-11 — Encrypt at rest with per-practice key separation**, ASD-approved algorithms, Australian jurisdiction only (already REQ-NFR-01).

**REQ-SEC-12 — Signed artefacts are tamper-evident.** Every agreement's rendered content is hashed at signature (REQ-SIG-02). After any incident we can prove which artefacts were altered and which were not — which is what lets a practice keep claiming against the ones that were not.

**REQ-SEC-13 — Incident obligations, if we ever integrate with Services Australia.** Their Integrated Third Party Security Policy requires **cyber incident notification within 12 hours** and **data breach notification within 2 business days**. Build the on-call process to that standard now, whether or not we integrate — it is stricter than the Privacy Act and easier to design in than to retrofit.

**REQ-SEC-14 — Rehearse it.** A tabletop exercise before go-live and annually: practice breach, our breach, mass phishing campaign. An incident plan nobody has practised is a document, not a capability.

---

## 7. What I would change in the design today

Three things, in order:

1. **Stop treating three identifiers as the security control.** They are an *accreditation-alignment* control — they satisfy RACGP C6.1A and they are a real differentiator against tap-to-approve-on-a-link competitors. They are not an anti-fraud control against an adversary holding the data. Keep them; stop relying on them.

2. **Move passkeys from v2 to v1.** They were proposed as a conversion improvement. They are actually the only proposed factor that survives a data breach and cannot be phished. That reclassifies them as foundational.

3. **Elevate practitioner-side anomaly detection above patient-side verification in the build order.** Money flows to providers. A fraud at scale needs a provider number. Watch the end of the chain the attacker cannot avoid.

---

## 8. Honest limits

- **We cannot prevent a practice being breached**, and we should never suggest otherwise in any material.
- **We cannot make stolen identifiers un-stolen.** Layered identity contains the consequence; it does not undo the exposure.
- **A determined attacker with a complicit provider can create valid-looking agreements**, because a complicit provider can also do it on paper. The platform's contribution is that the fabrication leaves a signature-dynamics, device and velocity trail that a paper pad does not.
- **Anomaly detection needs a baseline** (REQ-ANOM-02). In the first months of operation this control is weak, and that should be planned for rather than discovered.

---

### Sources

- [Notifiable Data Breaches scheme — OAIC](https://www.oaic.gov.au/privacy/notifiable-data-breaches)
- [Data breach notifications increase to all-time high in 2025 — OAIC](https://www.oaic.gov.au/news/media-centre/data-breach-notifications-increase-to-all-time-high-in-2025,-new-ndb-stats-show)
- [Health sector tops latest OAIC breach report, yet again — Healthcare IT News](https://www.healthcareitnews.com/news/anz/health-sector-tops-latest-oaic-breach-report-yet-again)
- [Statutory tort for serious invasions of privacy — OAIC](https://www.oaic.gov.au/privacy/your-privacy-rights/more-privacy-rights/statutory-tort-for-serious-invasions-of-privacy)
- [Statutory tort comes into force 10 June 2025 — MinterEllison](https://www.minterellison.com/articles/statutory-tort-for-serious-invasions-of-privacy-comes-into-force)
- [RACGP Standards for general practices 5th ed, C6.1 Patient identification](https://www.racgp.org.au/running-a-practice/practice-standards/standards-5th-edition/standards-for-general-practices-5th-ed/core-standards/core-standard-6/criterion-c6-1-patient-identification)
- Services Australia Integrated Third Party Security Policy v2.1
