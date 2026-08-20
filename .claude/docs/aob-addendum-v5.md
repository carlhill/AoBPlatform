# Addendum v5 — Cryptographic architecture, and the segment guide
### 19 August 2026

---

## PART A — "Encrypt everything so a breach yields nothing"

### A1. What encryption can and cannot do — the honest version

Encryption defends against a **stolen copy**. It does not defend against a **working session**.

| Attack | Does encryption help? |
|---|---|
| Stolen database backup or snapshot | **Yes, completely** |
| Misconfigured object storage | **Yes** |
| Stolen disk, decommissioned hardware | **Yes** |
| Malicious or compromised DBA with direct database access | **Yes, if keys are outside the database** |
| Cloud provider insider | **Yes, if we hold the keys** |
| **Compromised application credentials** | **No** — the application must decrypt to function |
| **Compromised admin session** | **No** |
| **Compromised practice login** | **No** — that account is entitled to that data |

So the design goal is not "unreadable to everyone". It is: **a stolen copy of the data is worthless, and a live compromise is narrow, loud and short.**

Anyone who tells you a database can be made useful to the application and useless to an attacker who owns the application is selling something.

### A2. Envelope encryption, with per-practice key separation

**REQ-CRY-01 — Every agreement, artefact and identity record is encrypted with its own data key.** Those data keys are wrapped by a **per-practice key-encryption key** held in a managed HSM. The application never holds a plaintext key at rest; it calls the key service, per operation, with an authorisation context that is itself logged.

**Why per-practice separation matters:** it makes the blast radius one practice rather than the national dataset. It also enables the two capabilities below, which nothing else gives you.

**REQ-CRY-02 — Application-layer encryption for sensitive fields, not just transparent disk encryption.** Transparent database encryption protects the disk. It does nothing against a dump taken through the database itself. Fields that identify a person must be encrypted **above** the database, so that a dump is ciphertext even to someone holding database credentials.

**REQ-CRY-03 — Crypto-shredding as the deletion mechanism.** Destroy the data key and the record is unrecoverable, everywhere, including in backups. This is how retention expiry (REQ-REG-09) is actually enforced — deleting rows from a system with point-in-time backups does not delete anything.

**REQ-CRY-04 — Practice containment can revoke a key.** REQ-SEC-08 containment mode gains real teeth: suspend the practice's key and the data is inert until an authorised human re-enables it. Minutes, reversible, and it does not destroy evidence.

**REQ-CRY-05 — ASD-approved algorithms, Australian jurisdiction, keys never leaving it.** Required anyway if Services Australia integration is ever in scope.

### A3. The searchable-data problem, and how to solve it

Verification needs equality lookups — *does this date of birth match?* — and encrypted fields cannot be searched. The wrong answer is to leave identifiers in plaintext "because we have to search them".

**REQ-CRY-06 — Blind indexes for equality matching.** Store a keyed HMAC of the normalised identifier, with a **per-practice pepper held in the key service**. Equality matching works; the plaintext is never stored; and a stolen index is not reversible without the pepper.

**Two cautions, stated plainly:**
- A deterministic index leaks equality — an attacker can see that two records share a value, even without knowing it. Acceptable here, but it must be a decision, not an accident.
- Low-entropy fields are guessable. There are only ~40,000 plausible dates of birth. **A blind index over a low-entropy field is only as strong as its pepper**, so the pepper must live in the HSM, never in the application, and lookups must be rate-limited per actor (REQ-BOT-07).

### A4. Data minimisation is still the strongest control

**Nothing not held can be stolen.** This is the security case for the position in Addendum v3 §7 — don't mirror the practice management system, never store the Medicare number, never store identifier values in logs. Encryption is the second line. Not holding the data is the first.

---

## PART B — Non-repudiable logs

You have the right instinct and the right instinct has a precise name. Three properties are needed, and they are not the same thing:

| Property | What it means | Mechanism |
|---|---|---|
| **Tamper-evident** | Alteration is detectable | Hash chain |
| **Independently verifiable** | A third party can check it without trusting us | Published verification tool + signatures |
| **Non-repudiable** | *We* cannot later deny or rewrite it either | **External anchoring** |

The third is the one people skip, and it is the one that matters. A hash chain we control is a chain we could rewrite end-to-end. Without an outside anchor, the log proves nothing against **us** — only against an outsider.

### B1. Requirements

**REQ-LOG-01 — Append-only hash chain.** Every entry carries the hash of the previous entry. Any insertion, deletion or edit breaks the chain from that point forward, permanently and visibly.

**REQ-LOG-02 — Per-entry signature with a segregated key.** Each entry (or each period's root) is signed with a key held in an HSM that **the application cannot read and cannot use for anything else**. This is your "key check": the signature proves the entry was written by the logging service, not injected by whoever compromised the application.

**REQ-LOG-03 — Merkle tree per period, with an externally anchored root.** Build a Merkle root hourly. Anchor it outside our control — an RFC 3161 timestamp authority, a third-party WORM store, or both. **Anchoring is what converts tamper-evident into non-repudiable.** Once yesterday's root is anchored elsewhere, nobody — including us, including a court-ordered us — can rewrite yesterday.

**REQ-LOG-04 — Write-once storage with object lock**, retention-locked for the full period, so deletion is impossible rather than merely prohibited.

**REQ-LOG-05 — Separate trust domain.** The logging service has its own credentials, its own key, and its own storage account. Compromising the application must not confer the ability to write, alter or delete log entries. If one credential can do both, there is one control, not two.

**REQ-LOG-06 — A published verifier.** A tool that takes an exported log segment plus the anchored roots and confirms: the chain is intact, the signatures are valid, the root matches the anchor. Ship it with the audit pack (REQ-DEL-08) so a practice, an auditor or a regulator can check without taking our word for anything.

**REQ-LOG-07 — Log the reads, not only the writes.** Who viewed which agreement, when, from where. After an incident, "what did the attacker see" is the question that must be answered within 30 days, and it can only be answered from read logs.

**REQ-LOG-08 — Logs carry no plaintext identifiers.** Reference records by identifier, not by content. A log that is impossible to alter and full of personal information is a liability with excellent integrity.

### B2. What this buys, concretely

A practice under audit can prove **when** an agreement was created and that the record has not been altered since — verified against an anchor held by a party with no interest in the outcome. That is a materially stronger evidentiary position than any competitor offers, and it costs very little to build if it is built from the first line.

---

## PART C — Cryptographic identity for practitioners

### C1. Why the instinct is right

Practitioners are the payees. **Provider number misuse is a documented Australian fraud vector** — the $7.5 million Melbourne prosecution involved compromised provider credentials and the impersonation of twenty doctors — and the Philip Review found the assessing engine *"does not readily allow for … matching to provider identity details."*

So binding high-risk practitioner actions to a key only that practitioner holds closes a gap the payment system itself does not close.

### C2. But do not build a PKI

I would push back on the mechanism, not the goal.

Running a real X.509 public key infrastructure means a certificate authority, key ceremonies, revocation lists, OCSP responders, certificate lifecycle management, and an audited operational practice statement. It is a **specialist operational business**, and it is a large ongoing cost for a small vendor.

Also relevant: **NASH PKI — the existing health certificate infrastructure — reaches end-of-life in September 2026 and ceases in 2028.** Building on it would be building on something being retired.

**Use WebAuthn credentials with hardware attestation instead.** You get the same security properties with a fraction of the operational burden:

| | X.509 PKI | WebAuthn / passkey with attestation |
|---|---|---|
| Private key never leaves the device | Depends on implementation | **Yes — hardware-backed keystore, Secure Enclave, TPM** |
| Phishing-resistant | No | **Yes — bound to our domain** |
| Requires a CA, CRL, OCSP | **Yes** | No |
| Revocation | Certificate revocation infrastructure | Delete the registration |
| Device attestation | Possible, complex | **Built in** |
| Operational cost | High and permanent | Low |

Same cryptographic guarantee — a signature only that device could produce — without becoming a certificate authority.

### C3. Requirements

**REQ-PKI-01 — Practitioner enrolment ceremony.** Before a key is bound: verify current AHPRA registration, verify the provider number and its location, and verify the person by video or in person. **The key is only as good as the ceremony that bound it.** A key issued to whoever answered the email proves nothing.

**REQ-PKI-02 — High-risk actions require a practitioner signature.** Not every action — that would be unusable. Specifically: initiating a bulk enrolment campaign, terminating agreements in bulk, initiating a re-consent campaign, changing a practice's banking or contact configuration, and approving a receiving practitioner during a transfer of care.

**REQ-PKI-03 — Signature binds content, not intent.** Each signature covers a hash of the exact action payload, so it proves *what* was approved, not merely that something was.

**REQ-PKI-04 — Revocation on deregistration or departure**, checked against AHPRA status at a defined cadence and on every high-risk action.

**REQ-PKI-05 — Recovery without a lock-out.** A lost phone must not stop a practice billing. Re-enrolment requires a stepped-up ceremony, is rate-limited, notifies the practice principal, and is logged as a security event. **This is the weakest point in any device-bound scheme, and it is where an attacker will apply pressure.**

**REQ-PKI-06 — Multiple devices per practitioner**, each independently enrolled and independently revocable. One phone is a single point of failure.

**REQ-PKI-07 — Never a second factor for patients.** This is a practitioner control. Patients get passkeys as described in Addendum v3 §8.3, with the three-identifier path always available.

### C4. What it does not solve

A practitioner who is themselves the fraudster will happily sign. Cryptographic identity defeats **impersonation**; it does not defeat **intent**. What it does is remove the "someone must have used my provider number" defence — which is why it pairs with, rather than replaces, the anomaly detection in REQ-ANOM-01.

---

## PART D — How each segment actually uses assignment of benefit

### D1. The short version

| Segment | Medicare exposure | Which agreements | Enduring? | Priority |
|---|---|---|---|---|
| **General practice** | Very high | Episodic pre and post; 6-month plan | **Yes** | Core |
| **Specialists** | Moderate — 28–37% bulk billed | Episodic only; 6-month plan | **No** | High value, low volume |
| **Allied health** (physio, podiatry, dietetics, exercise physiology, speech, OT, audiology) | Moderate — 28m attendances a year | Episodic only; 6-month plan | **No** | Greenfield |
| **Psychology and mental health** | High volume under Better Access | Episodic only; 6-month plan | **No** | Greenfield, high confidentiality sensitivity |
| **Chiropractors and osteopaths** | Low per patient — chronic disease management referrals only, capped | Episodic only | **No** | Low priority |
| **Optometry** | High — >11m items, ~94% bulk billed | Episodic only; 6-month plan | **No** | High density, zero coverage |
| **Dentists** | **Almost none** | See D2 | No | **Do not pursue** |
| **Nurse practitioners, midwives, Aboriginal health workers** | Moderate | Episodic; enduring only where practising as a GP-equivalent — verify | Mostly no | Follows the host practice |
| **Pathology and diagnostic imaging** | Very high raw volume | **Their own data sets** — different required fields | No | Out of v1 scope |

### D2. Dentists — the answer is "mostly not at all"

This is worth being clear about, because dental looks like a large market and is not.

- **Most dentistry is not Medicare.** It is paid privately or by private health insurance, claimed through HICAPS or HealthPoint terminals. That is a **private health fund** claim, not a Medicare assignment of benefit, and none of these rules apply.
- **The Child Dental Benefits Schedule is explicitly excluded.** The Department's FAQ states it plainly: these requirements *"do not apply to patients accessing health care funded by the Department of Veterans' Affairs or under the Child Dental Benefits Scheme."*
- **Public dental** is state-funded and outside the MBS.
- **The genuine exception** is a small number of MBS items for **oral and maxillofacial surgery** and certain specialist dental procedures, mostly performed by registered specialists in hospital settings — which puts them into simplified billing and ECLIPSE, a separate regime under ss 65D–65E with **no transition concession at all**.

**So a general dental practice has essentially no assignment-of-benefit obligation.** They do have a claiming and consent workflow — it is just a private health insurance one, owned by HICAPS and HealthPoint. Selling AoB compliance into dental would be selling a solution to a problem they do not have, and it would damage credibility with everyone they talk to.

### D3. Chiropractors and osteopaths

Their Medicare exposure is narrow: allied health items under a **chronic disease management referral**, where a patient with a GP management plan is entitled to a capped number of allied health items per calendar year across *all* allied health providers combined. The cap makes the per-patient volume low, and the referral requirement makes each item traceable to a GP.

Practically:
- Episodic post-agreement is the default
- The item is known and small, so capture is simple
- A **6-month plan agreement** fits a course of treatment neatly, and is the only volume tool available
- Rejection code 160 — *maximum claimable services already reached for care plans* — will be a routine occurrence, and a good product surfaces the remaining entitlement before the item is delivered rather than after the claim is rejected

Large practice count, low value per practice. A self-serve tier, not an account-managed one.

### D4. Specialists

- Episodic only. No enduring pathway, permanently.
- Referred attendances — the referral is a separate compliance artefact, and a pre-agreement must still describe the item.
- Only 28–37% bulk billed, so the AoB volume per specialist is far lower than per GP — but the ones who do bulk bill are often in high-volume settings.
- **The 6-month plan agreement fits scheduled review sequences well** and is the strongest pitch to this segment.
- **In-hospital work runs on simplified billing and ECLIPSE**, a separate regime with its own requirements and no transition concession. Do not conflate the two in a sales conversation with a specialist — it is the fastest way to sound like you do not understand their practice.
- Software concentration: Magentus (Genie, Gentu, Clinic to Cloud, Shexie), which has publicly stated its release does not store the signed agreement.

### D5. Psychology and mental health — flagged separately for a reason

High Medicare volume under Better Access, and the **most confidentiality-sensitive segment in the product**. Every rule in Addendum v3 §5 applies with extra force: content-blind messaging, no third-party routing, fail-closed on confidentiality status.

A mental health practice will ask about this in the first meeting. Having a specific, considered answer is a competitive advantage; not having one is disqualifying.

### D6. The pitch, by segment

- **General practice:** *"Enduring agreements make most of this disappear, and we handle the notification obligation that comes with them."*
- **Everyone else:** *"Episodic capture is permanent for you — there is no relief mechanism coming. So the capture workflow has to be excellent, and the six-month plan agreement is the only lever you have. Nobody else has built either."*
- **Dental:** *"This does not apply to you."* Said early, it buys more credibility than any feature.
