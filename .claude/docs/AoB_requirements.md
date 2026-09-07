# AoB_requirements — Capability Requirements Baseline
### v1.0 · 20 August 2026

**What this document is.** The business model is settled and slide 6 of *AoBPlatform-Business-Case.pptx* ("Why the incumbents have not closed this") states the twelve capabilities AoBPlatform provides and no competitor fully does. This document takes each of those twelve capabilities and breaks it into requirements and sub-requirements. It is the **capability-level master index**: where a capability is already specified in detail in *aob-requirements.md v0.4* (the regulatory working draft, which remains authoritative for statutory detail), this document cross-references those REQ IDs; where slide 6 asserts a capability the detailed draft had not yet fully specified — multilingual agreements, the non-repudiable evidence vault, the monitoring metrics set — the sub-requirements are new and numbered in new families here.

**Requirement language.** MUST = release-blocking. SHOULD = target for the release, deferrable with a recorded decision. MAY = roadmap.

**Companion documents (all in this project):** aob-requirements.md v0.4 (statutory detail) · aob-functional-requirements.md (module-by-module behaviour, onboarding flows) · aob-solution-architecture.md · aob-tech-stack.md · aob-build-plan.md.

---

## C1 — Digital AoB capture

*Slide 6 row 1. Competitors: Bp yes; MD thin; HotDoc yes (Bp/MD/Zedmed only); AutoMed SMS DB4(e) only; Cubiko monitors only.*

- **C1.1 (MUST)** Generate episodic pre- and post-agreements carrying the full s 65C(4) data set D1–D7. → REQ-REG-01, REQ-REG-02.
- **C1.2 (MUST)** Basic Service Description mapping ingested quarterly from MBS Online (XML/CSV; 1 Jan / 1 Mar / 1 Jul / 1 Nov), versioned; every agreement records the mapping version that produced it. → REQ-REG-03.
- **C1.3 (MUST)** Particulars rendered and locked before the signature control enables; signing a draft is structurally impossible. → REQ-REG-06, REQ-SIG-04.
- **C1.4 (MUST)** Electronic signature meeting the ETA 1999 s 10 test: drawn signature on tablet, tap-to-approve or drawn on remote link; every signature event binds the hash of the exact rendered agreement, rule-set version, mapping version, verification event, timestamp, channel, device, IP, assignor identity and authority basis. → REQ-SIG-01..04.
- **C1.5 (MUST)** Treatment Plan Assignment: a single pre-agreement enumerating multiple services over ≤6 months (same practitioner, specified dates), with schedule monitoring, break detection at occurrence level, and occurrence-level remediation. → REQ-PLAN-01..06.
- **C1.6 (MUST)** Same-day and multi-practitioner scoping rules enforced automatically (one agreement per practitioner × patient × day; multi-provider visits split; mismatch = invalid for that claim). → REQ-SCOPE-01..04.
- **C1.7 (MUST)** Decline and resubmission paths: declined → private bill with claimable invoice; pre-1-July-2026 assignments resubmitted after that date detected and flagged for a new agreement. → REQ-DEC-01..03.
- **C1.8 (MUST)** Verbal fallback recorded and risk-flagged until 30 June 2027, auto-disabled after, with explicit override + reason thereafter. → REQ-REG-10, REQ-CAP-05.
- **C1.9 (MUST)** Patient copy delivered automatically on completion (SMS/email link or print), not only on request. → REQ-REG-08.
- **C1.10 (MUST)** Retention: 2 years from the related claim, legal-hold override, scheduled deletion/de-identification on expiry. → REQ-REG-09, REQ-INT-04.

## C2 — Tablet / kiosk at the desk

*Slide 6 row 2. Nobody has shipped one; AutoMed's kiosk does check-in, not AoB. This is the primary channel and the differentiator.*

- **C2.1 (MUST)** Pre-agreement capture at check-in on practice-owned tablet (BYOD ≥10″), staff-assisted verification, drawn signature, target < 45 seconds end-to-end. → REQ-CAP-01.
- **C2.2 (WITHDRAWN, Carl 3 Sep 2026)** ~~Offline-first: capture and queue locally through an internet outage; validate on sync; alert on any post-sync validation failure.~~ Superseded by the zero-footprint kiosk decision (CLAUDE.md §7): the kiosk is cloud-served, persists nothing, and on outage shows "see reception"; care is never blocked (REQ-REC-04) and capture falls back to post-service or paper.
- **C2.3 (MUST)** Kiosk mode: locked-down browser on a managed tablet (a device setting, not our software), no OS escape, auto-reset between patients, no residual patient data on device after submission (memory-only render; **nothing persisted at all** beyond one revocable pairing credential — Carl, 3 Sep 2026).
- **C2.4 (MUST)** Accessibility on device: large-text mode, high contrast, read-aloud, staff-assisted mode. → REQ-NFR-05, REQ-VUL-08.
- **C2.5 (MAY — roadmap, Carl 3 Sep 2026)** RACF visiting-provider batch mode for a resident list, per practitioner. Was MUST with an offline tablet session; moved to roadmap when offline-first was withdrawn (C2.2). When revisited the answer is a connected device or the assignor-remote path (REQ-VUL-03), not an offline queue. → REQ-VUL-07.
- **C2.6 (SHOULD)** Queue-integration hooks so a practice already running AutoMed check-in can trigger our AoB step from their arrival event rather than running two tablets. (Coexist; do not demand the front desk choose.)

## C3 — Email channel

*Slide 6 row 3. Bp has no email channel; HotDoc restricts SMS to telehealth; AutoMed is SMS-only. Email is free and reaches a different cohort.*

- **C3.1 (MUST)** Email as a first-class capture channel with identical verification, expiry, single-use and validation rules as SMS. → REQ-CAP-03, REQ-SMS-03.
- **C3.2 (MUST)** Send both SMS and email where both are held; first completed channel wins and cancels the other.
- **C3.3 (MUST)** DMARC/DKIM/SPF-aligned sending domain per platform, practice-branded display name, published "how to tell our messages are real" page. → REQ-VER-05.
- **C3.4 (MUST)** Bounce, complaint and unsubscribe handling feeding the routing rule (hard bounce ⇒ channel marked dead ⇒ cascade proceeds to next stage).

## C4 — Identity verification (RACGP 3-point)

*Slide 6 row 4. No competitor verifies identity before signature; a link to a phone is not identification.*

- **C4.1 (MUST)** Three approved identifiers challenged and matched before the form renders, remote channels self-stated in input fields (never Y/N confirmation screens); in-practice staff-verified with staff identity recorded. → REQ-VER-01..03.
- **C4.2 (MUST)** Medicare number excluded from the identifier set, non-configurably. → REQ-VER-02.
- **C4.3 (MUST)** Identifier count configurable per practice with a floor (default 3); CG2.A-style "record which identifiers were used" behaviour on by default. → REQ-VER-06.
- **C4.4 (MUST)** Rate limiting, lockout after N failures, practice notification; verification logs store identifier types and outcomes, never values. → REQ-VER-03, REQ-VER-04, REQ-NFR-01.
- **C4.5 (MUST)** Positioning guardrail enforced in all generated text: ETA s 10 "reliably identify the assignor" is the claim; "Medicare requires three identifiers" is never stated. → REQ-VER-07.
- **C4.6 (MUST)** Bot and velocity controls on all public capture endpoints (invisible challenge, device fingerprinting, per-practice and per-number velocity ceilings). → REQ-SEC family (addendum v5).

## C5 — s 65C element check

*Slide 6 row 5. Nobody certifies the answer — the Department refuses to review templates. The versioned validator is the substitute for certification.*

- **C5.1 (MUST)** Rules engine validating every payload pre-signature and again at storage: rules C1–C14 (block/warn as specified). → REQ-65C-01.
- **C5.2 (MUST)** Versioned rule set; every stored agreement records rule-set + mapping version. → REQ-65C-02.
- **C5.3 (MUST)** Exportable s 65C Conformance Statement per practice. → REQ-65C-03.
- **C5.4 (MUST)** Public, free compliance tester (PDF/DOCX/image-OCR/pasted text/API) sharing the same rule engine; distinguishes pre/post-1-July-2026 DB4E/DB020 versions; flags obsolete practitioner-signature blocks; never says "certified/approved/accredited". → REQ-TEST-01..09.
- **C5.5 (MUST)** Regulatory change watch: named owner, monitored sources, every check logged even when nothing changed. → REQ-65C-04.

## C6 — Enduring lifecycle + anniversary

*Slide 6 row 6. Bp shipped basic creation; nobody runs the lifecycle. Per-practitioner, GP-only; the anniversary registration fuse (65CA(8)(e)) is tracked by no one.*

- **C6.1 (MUST)** Enduring agreement objects for all three pathways (MyMedicare / ACCHO–AMS / residential aged care), modelled practitioner × patient, carrying the full reg 65CB content set. → REQ-END-01, -01a, -02.
- **C6.2 (MUST)** Anniversary-fuse tracking with 90/60/30-day warnings for pre-1-July-2027 agreements; registration integration reserved for when Services Australia publishes the mechanism. → REQ-END-03, -04, open decision D-11.
- **C6.3 (MUST)** Scope commitment made visible: item-level scope preview and count before signature; scope change = terminate + recreate as a first-class workflow. → REQ-END-06a, -06b.
- **C6.4 (MUST)** Termination handling: either party, written notice, effective 2 business days; the patient may terminate even when not the assignor; provider-initiated termination generates the required advance notice. → REQ-END-06.
- **C6.5 (MUST)** Cessation monitoring: MyMedicare deregistration/transfer, leaving the ACCHO, discharge from residential care, patient's 14th birthday; hospital admission does not end an aged-care agreement. → REQ-END-07, REQ-CHILD/OFF families.
- **C6.6 (MUST)** Batch enrolment campaign tool for converting a practice's eligible book. → REQ-END-08.
- **C6.7 (MUST)** GP-only rule enforced: enduring pathways never offered for specialist, allied or optometry providers; Treatment Plan Assignment offered instead. → REQ-END-01a, REQ-PLAN-06.

## C7 — 24-hour (89AA) notice engine

*Slide 6 row 7. The obligation nobody prices: enduring converts consent capture into a perpetual per-claim notification duty. MyMedicare pathway only.*

- **C7.1 (MUST)** On every claim under a MyMedicare enduring agreement, deliver written notice to the assignor within 24 hours: practitioner name, patient name, service date, benefit amount. → REQ-END-05.
- **C7.2 (MUST)** Delivery per the notification method recorded in the agreement; per-assignor channel preference; full audit of exactly what was sent, when, to whom.
- **C7.3 (MUST)** Error correction within 24 hours of awareness, as a tracked workflow with its own audit entries.
- **C7.4 (MUST)** Never sent for aged-care or ACCHO pathways; never chased — the notice is one-way and non-response has no effect on payment. → REQ-CHASE-02.
- **C7.5 (MUST)** SLA instrumentation: time-to-notice distribution reported; breach of the 24-hour window alarmed to us and visible to the practice.

## C8 — Patient portal + self-termination

*Slide 6 row 8. No vendor gives patients any view; nobody has an operational revocation mechanism.*

- **C8.1 (MUST)** Patient view of full agreement history with the rendered artefact as signed, downloadable as PDF. → REQ-PORT-01, -02.
- **C8.2 (MUST)** Active enduring agreements with plain-language coverage explanation; all 89AA notifications visible. → REQ-PORT-03, -04.
- **C8.3 (MUST)** One-click enduring termination generating and delivering the written notice. → REQ-PORT-05.
- **C8.4 (MUST)** "Verify this message is genuine" — the pending request visible after login; the structural anti-phishing answer. → REQ-PORT-06.
- **C8.5 (MUST)** Assignor-scoped views; portal access never a precondition of signing. → REQ-PORT-07, -08.
- **C8.6 (MUST)** Offboarding and anti-fraud controls: patient self-removal, dual-path (patient and practitioner) offboarding, termination signal to the practice, assignor nomination with active flags. → REQ-OFF family (addenda).
- **C8.7 (SHOULD)** AI chat channel for plain-language requests ("I don't see this GP anymore — stop these messages"), executing only reversible actions itself and routing the rest to the practice. → addendum v4.
- **C8.8 (SHOULD)** Experience feedback (smiley questionnaire) after signature events, per the module already specced. → aob-experience-feedback.md.

## C9 — Multilingual agreements

*Slide 6 row 9. AutoMed's bookings do 100 languages; nobody renders the agreement itself multilingually. New family.*

- **REQ-LANG-01 (MUST)** All patient-facing capture surfaces (tablet, SMS/email landing, portal, paper) renderable in supported community languages; v1 set: English, Arabic, Vietnamese, Simplified Chinese, Greek, Italian, Samoan, Tongan; architecture string-tabled so adding a language is content, not code.
- **REQ-LANG-02 (MUST)** Bilingual artefact: the signed agreement renders the s 65C particulars in English **and** the selected language side by side, so the stored evidence is auditable by an English-reading auditor while the assignor signed what they could read. (Open legal question — whether a non-English-only agreement satisfies the requirement — is thereby avoided rather than answered; flagged on the "close the open questions" slide.)
- **REQ-LANG-03 (MUST)** Translations professionally produced and versioned like the rule set; machine translation never used for the statutory particulars; the mapping's basic service descriptions carried in English with translated glosses.
- **REQ-LANG-04 (MUST)** Language preference stored per patient (and per assignor, who may differ); cascade messages sent in that language with English fallback lines.
- **REQ-LANG-05 (SHOULD)** Read-aloud in the selected language on tablet where a quality voice exists.
- **REQ-LANG-06 (MAY)** Interpreter-session flag: record that TIS National or another interpreter assisted, as part of the verification/consent evidence.

## C10 — Non-repudiable evidence vault

*Slide 6 row 10. The core of "the record, not the form". New family consolidating the security addenda into requirements.*

- **REQ-VAULT-01 (MUST)** Append-only, tamper-evident event log: every agreement state transition, verification attempt, validation result, signature event, notification, access and export is an event in a hash-chained log whose integrity is machine-verifiable (each entry binds the hash of its predecessor; the log itself carries a key check). No update or delete path exists at the application layer.
- **REQ-VAULT-02 (MUST)** Signed artefacts: the rendered agreement PDF is hashed at signature time; hash recorded in the event log; artefact stored encrypted; any later render is re-derived and re-verified against the stored hash before display or export.
- **REQ-VAULT-03 (MUST)** Server-authoritative trusted time on every event; periodic external anchoring of the log head (e.g. RFC 3161 timestamp or equivalent external witness) so backdating requires compromising a third party as well as us.
- **REQ-VAULT-04 (MUST)** Practitioner and staff actions bound to strong credentials: WebAuthn/passkey mandatory for practitioner- and admin-level actions, so "who did this" in the log is phishing-resistant. → design decision (WebAuthn over PKI; NASH EOL Sep 2026).
- **REQ-VAULT-05 (MUST)** Encryption at rest with per-patient data keys; crypto-shredding implements deletion/de-identification on retention expiry (destroy the key, keep the tombstone event); blind indexes for searchable identifiers. Legal hold suspends key destruction. → REQ-REG-09, REQ-NFR-01.
- **REQ-VAULT-06 (MUST)** Signing and root keys in HSM-backed KMS; documented key ceremony; key usage itself audited into the same log.
- **REQ-VAULT-07 (MUST)** Auditor export: a self-contained evidence bundle per agreement or per period (artefacts + event chain + verification report + conformance statement) that an auditor can verify without access to our systems, including an offline chain-verification tool.
- **REQ-VAULT-08 (MUST)** Transparency to the practice: the practice can see and export everything held about its patients' agreements; no capability exists that shows the practice less than an auditor would see.
- **REQ-VAULT-09 (SHOULD)** Verification API: given an artefact hash, confirm existence, timestamp and chain position without disclosing content — the hook for a future Services Australia or PSR verification conversation.

## C11 — Pending-AoB monitoring & metrics

*Slide 6 row 11. Cubiko's one Yes — they surface the gap; we surface it AND close it. Extends REC with a defined metric set.*

- **C11.1 (MUST)** Outstanding-agreements queue ranked by days remaining on the 12-month lodgement window, with one-click resend and bulk actions. → REQ-REC-01.
- **C11.2 (MUST)** Full status model as specified. → REQ-REC-02.
- **REQ-MON-01 (MUST)** Metric set, per practice / provider / channel / day: capture rate; in-practice share; SMS/email response rate; time-to-signature distribution; outstanding count and ageing by chase band; verbal usage with 30-June-2027 countdown; rail-captured share; retention-gap count; enduring conversion rate; anniversary-fuse pipeline; 89AA SLA; resolution rate by band/channel/attempt (→ REQ-CHASE-13); revenue-forgone log with reason codes.
- **REQ-MON-02 (MUST)** Every ranked queue and metric is exportable (CSV/API) — practices already using Cubiko must be able to reconcile our numbers against theirs, not choose between consoles.
- **REQ-MON-03 (SHOULD)** 10997-adjacent view: unbilled/unagreed services surfaced in the same shape Cubiko reports missed billings, easing the "Cubiko flags it, we fix it" partnership motion.
- **REQ-MON-04 (MUST)** Design-partner instrumentation: no ROI figure enters marketing until measured. → REQ-COST-01.

## C12 — Medtech / Magentus / allied coverage

*Slide 6 row 12. The territory row: every competitor's No. Medtech first (design partner), adapter-first architecture for the rest.*

- **C12.1 (MUST)** Medtech Evolution integration: read demographics/appointments/providers/invoices; **write the signed artefact into the patient record**. Write-back is the product; it is proven before anything else is built. → REQ-INT-01, -02, decision D-01.
- **C12.2 (MUST)** PMS adapter interface from day one; no Medtech-specific concept leaks into the core domain. → REQ-INT-03.
- **C12.3 (MUST)** Claim linkage per adapter capability, conservative default where unobservable. → REQ-INT-04.
- **C12.4 (MUST)** Rail coexistence: detect, suppress, ingest; retention-gap report. → REQ-RAIL-01..06.
- **C12.5 (SHOULD)** Adapter order after Medtech: Gentu/Genie (Magentus), then allied (Cliniko/PracSuite/Nookal/Splose/Coreplus/Zanda), then Bp/MD/Zedmed via Halo Connect when channel strategy calls for it.
- **C12.6 (MUST)** No GP-specific vocabulary in the core; provider-type-aware throughout. → REQ-MP-01..03.

---

## Traceability

| Slide 6 capability | This doc | Detailed families in aob-requirements.md v0.4 |
|---|---|---|
| Digital AoB capture | C1 | REG, SIG, PLAN, SCOPE, DEC |
| Tablet / kiosk at the desk | C2 | CAP-01, VUL-07/08 |
| Email channel | C3 | CAP-03, SMS |
| Identity verification | C4 | VER, SEC |
| s 65C element check | C5 | 65C, TEST |
| Enduring lifecycle + anniversary | C6 | END |
| 24-hour notice engine | C7 | END-05, CHASE-02 |
| Patient portal + self-termination | C8 | PORT, OFF, CHILD |
| Multilingual agreements | C9 | **REQ-LANG-01..06 (new)** |
| Non-repudiable evidence vault | C10 | **REQ-VAULT-01..09 (new)**, NFR-01/04 |
| Pending-AoB monitoring & metrics | C11 | REC, CHASE, **REQ-MON-01..04 (new)** |
| Medtech / Magentus / allied | C12 | INT, RAIL, MP |

## Change log

| Version | Date | Change |
|---|---|---|
| 1.0 | 20 Aug 2026 | Initial capability baseline derived from business-case slide 6; new families REQ-LANG, REQ-VAULT, REQ-MON; traceability to aob-requirements.md v0.4. |
