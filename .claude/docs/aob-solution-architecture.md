# AoBPlatform — Solution Architecture
### v1.0 · 20 August 2026 · Companion to aob-functional-requirements.md and aob-tech-stack.md

**Design intent.** An industrial-strength consent-and-compliance record: every claim the platform makes about an agreement must be provable to a third party who does not trust us, and everything the platform holds must be visible to the practice and the patient it concerns. Non-repudiation and transparency are architectural properties here, not features. Technology selections are in aob-tech-stack.md; this document is structure, boundaries and guarantees.

---

## 1. System context

```
                       ┌──────────────────────────────────────────────┐
  Patient / Assignor   │                 AoBPlatform                  │    Services Australia
  (SMS / email link,   │                                              │    (future: enduring
   tablet, portal,     │  Capture · Verify · Validate · Vault ·       │    registration, artefact
   paper, AI chat) ───▶│  Notify · Reconcile · Monitor                │───▶ verification API)
                       │                                              │
  Practice staff  ────▶│                                              │◀─── MBS Online (quarterly
  Practitioners   ────▶│                                              │     Basic Service Description
  (console, tablet)    └───────┬──────────────┬───────────────────────┘     XML/CSV ingest)
                               │              │
                        PMS adapters     Rails (read-only)
                        (Medtech first;  Tyro Health Online query,
                        write-back into  terminal-capture inference
                        patient record)
```

Out of frame by design: claim lodgement and payments (the PMS and rails own them), clinical systems, My Health Record.

## 2. Service decomposition

Modular monolith first, services split only where isolation earns its cost. Three deployment units at v1:

**Core application** (one deployable, internally modular — the M1–M8, M12–M14 modules): onboarding & identity, capture cascade, verification, enduring lifecycle, notification engine, reconciliation, portal, console, campaigns, language. Internal module boundaries are enforced in code (no cross-module table access; module APIs only), so later extraction is a deployment change, not a rewrite.

**Rules & Conformance service** (separate deployable): the s 65C engine, mapping/rule-set content store, and the public tester. Separated because it is the only component with an anonymous public attack surface (file upload, OCR) and because the tester must be able to run without any access to patient data — a hard isolation worth a service boundary. It holds no PII at all.

**Evidence Vault service** (separate deployable): append-only event log, artefact store, key management orchestration, anchoring, auditor-bundle export, verification API. Separated because its security domain is stricter (its own credentials, its own datastore, no delete grants anywhere), and because "the vault has no update path" is easiest to prove when the vault is a service whose API simply has no such endpoint.

**Integration edge:** PMS adapters run as per-practice connector processes (site-installed agent where the PMS is on-premise — Medtech Evolution typically is — or cloud-to-cloud where an API exists). Adapters speak one internal contract (FR-9.1); the connector holds practice-scoped credentials only.

Asynchronous work (reminder cadences, notification SLAs, mapping ingest, anchoring, retention timers, chase scheduling) runs through a queue with scheduled jobs; every job idempotent, every dispatch an event.

## 3. Data architecture

Four stores, deliberately not one:

1. **Primary relational store (Postgres).** Domain state: parties, agreements, enduring lifecycles, capture requests, queues, configuration. Row-level security enforces practice scoping at the database layer, mirroring application RBAC — an application bug must not be able to leak another practice's records.
2. **Evidence event log (immutable store).** Hash-chained events per REQ-VAULT-01. Append-only at the engine level, not merely by convention. The domain store references event ids; the log never references mutable rows by content.
3. **Artefact object store (S3, AU region).** Rendered agreement PDFs, scans, exports — encrypted per-patient (envelope encryption; per-patient data keys under HSM-backed master keys). Object Lock/WORM on the evidence buckets.
4. **Cache/session (Redis).** Tokens, sessions, rate counters. Nothing durable.

**Identity data minimisation:** verification challenges compare against PMS-held values fetched at challenge time where the adapter allows, else against a minimised mirror (name, DOB, gender, address, record number, IHI) held encrypted with blind indexes for lookup. Verification logs hold types and outcomes only — never values (REQ-VER-04).

**Crypto-shredding:** retention expiry destroys the per-patient data keys for expired records and writes a tombstone event; the chain stays intact (hashes remain verifiable) while content becomes unrecoverable. Legal hold suspends key destruction (REQ-REG-09).

## 4. The non-repudiation chain

The guarantee, end to end — each link removes a different repudiation:

1. **Who was present:** verification event (three identifiers, or staff-verified with staff identity) precedes every render. *"It wasn't the assignor"* now requires defeating stated-identifier verification, not just holding a phone.
2. **What they saw:** the agreement is rendered server-side, the exact rendered artefact is hashed (SHA-256) and the hash is written to the event log **before** the signature control enables. *"The document was different"* fails against the hash.
3. **That they agreed:** the signature event (drawn vector+raster or tap-approve) binds artefact hash + verification event id + timestamp + channel + device + IP. Particulars are locked first (REQ-REG-06), enforced in code.
4. **Who operated the system:** practitioner and admin actions authenticate with WebAuthn passkeys — phishing-resistant, so log attribution to a staff identity is strong (REQ-VAULT-04).
5. **When it happened:** server-authoritative time on every event, plus periodic **external anchoring** of the chain head (RFC 3161 timestamp authority or equivalent external witness, on a schedule and at every day-close). Backdating now requires compromising us *and* the external witness *between* anchors.
6. **That nothing was altered since:** the hash chain. Every event carries the hash of its predecessor; the offline verifier recomputes the chain from any evidence bundle. An alteration anywhere breaks every subsequent link.
7. **That we can't quietly delete:** append-only store + WORM artefact buckets + no delete grants in any application role. Removal is crypto-shredding, which itself leaves a tombstone event in the chain.
8. **That you don't have to trust us:** the auditor bundle (artefacts + chain segment + verification tool) verifies offline (REQ-VAULT-07); the verification API confirms hash/timestamp/chain-position without content (REQ-VAULT-09).

**Key management.** Chain-signing and master keys live in HSM-backed KMS; dual-control key ceremony, documented; key usage itself logged to the chain. Signing keys rotate on schedule; rotation events are chained, so any artefact verifies against the key valid at its time.

## 5. Transparency architecture

Non-repudiation protects the practice against the auditor; transparency protects the patient and the practice against **us**.

- **Patient:** the portal shows every agreement, every 89AA notice, every pending request, and every access to their artefacts by practice staff (an access log view). Termination and offboarding are self-service and immediate in effect.
- **Practice:** sees and can export everything we hold about its patients' agreements (REQ-VAULT-08) — including our own SLA performance (89AA time-to-notice, chase outcomes) and per-message costs. No metric we use internally about a practice is hidden from that practice.
- **Auditor / regulator:** conformance statements, evidence bundles, offline verification. Nothing requires our cooperation at audit time.
- **Automated decision-making disclosure:** verification matching and chase-band logic documented in the privacy policy per APP 1.7/1.8 (in force 10 Dec 2026); both are rules-based, explainable, and human-overridable (REQ-NFR-02).

## 6. Integration architecture

- **PMS adapters (M9):** one internal contract; capability declaration per adapter; Medtech Evolution first via a site-installed connector (mechanism = decision D-01, resolved in Phase 0). Idempotent write-back with a reconciliation sweep; artefact-not-in-PMS alerts.
- **Rails (M10):** read-only coexistence. Tyro Health Online queried per invoice; terminal captures inferred from PMS transaction records; never in the payment path.
- **MBS Online:** quarterly Basic Service Description ingest with human-reviewed diff.
- **Messaging:** tier-1 SMS gateway, dedicated number per practice, ACMA Sender ID registered; DKIM/SPF/DMARC-aligned email; delivery receipts eventised.
- **Services Australia (reserved):** enduring registration integration behind a feature flag awaiting a published mechanism (D-11); Health Systems Developer Portal registration done in Phase 0 (it is free and establishes the relationship).

## 7. Deployment & availability

- AU region (Sydney) primary, second AU region for DR; every environment (dev/staging/prod) a separate cloud account, fully Terraform-provisioned; no manual console changes.
- Availability target 99.9% for capture APIs; **the cascade degrades, never blocks care**: tablet offline mode, paper always available, PMS outage queues writes — a platform outage can slow evidence, never stop a patient being seen or billed (REQ-REC-04, REQ-NFR-03).
- RPO ≤ 5 min (continuous WAL shipping + queue replay); RTO ≤ 4 h. Vault anchoring makes post-incident integrity provable — after any restore, the chain either verifies or the gap is explicit.
- Load shape to design for: the 8–10 am check-in burst (tablet signatures) and the post-claim 89AA dispatch batches; both are queue-absorbable.

## 8. Security posture (summary; threat model is authoritative)

Defence assumptions from aob-threat-model.md hold: practices get hacked; patient data is purchasable in bulk; our public endpoints will be probed with real stolen identifiers. Hence: stated-identifier verification with lockout + velocity ceilings + containment mode (REQ-SEC-08); non-enumerable single-use tokens; per-practice blast-radius isolation (RLS + per-practice connector credentials); passkeys for anyone with multi-patient access; no PII in the rules service; crypto-shredding limiting what a breach of us can yield; and the portal's "verify this message" as the structural anti-phishing answer. Security reviews and pen tests are release gates, not events.

## 9. Architecture decision records (initial set)

| ADR | Decision | Rationale |
|---|---|---|
| A-01 | Modular monolith + 2 satellite services (rules, vault), not microservices | Team size; the two split-outs carry genuine isolation needs (public attack surface; stricter security domain) |
| A-02 | Vault as append-only service with no update/delete API | "No path exists" is provable; simplest honest non-repudiation claim |
| A-03 | Per-patient envelope encryption + crypto-shredding | Retention law requires deletion; chain integrity requires nothing disappear; this reconciles them |
| A-04 | WebAuthn passkeys, not certificate PKI, for humans | NASH EOL Sep 2026; passkeys give phishing resistance without certificate lifecycle pain (prior design decision) |
| A-05 | External anchoring of the chain head | Converts "trust our clock" into "trust our clock or the external witness" — cheap, large gain |
| A-06 | Site-installed connector for on-premise PMS | Medtech Evolution reality; practice-scoped credentials; no inbound firewall holes at the practice |
| A-07 | Rules service holds zero PII | The only anonymous public surface must have nothing to leak |
| A-08 | Verification against PMS-held values at challenge time where possible | Minimises our identity mirror; the PMS stays the source of truth |

Open architecture questions inherit from the requirements doc: D-01 (Medtech mechanism — blocking), D-11 (enduring registration mechanism), D-05/D-06/D-07 (expiry, lockout, availability targets — proposed defaults above stand until overridden).

## Change log

| Version | Date | Change |
|---|---|---|
| 1.0 | 20 Aug 2026 | Initial architecture: context, service decomposition, data architecture, non-repudiation chain, transparency model, integration, deployment, ADRs. |
