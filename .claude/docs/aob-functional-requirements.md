# AoBPlatform — Functional Requirements by Module
### v1.0 · 20 August 2026 · Companion to AoB_requirements.md (capabilities) and aob-solution-architecture.md

**What this document is.** The module decomposition of the platform and the functional behaviour of each module, with the four onboarding journeys (Practice, Practitioner, Patient, Assignor) specified in full. Capability requirements (C1–C12, REQ-*) say *what must be true*; this document says *what each module does*. FR IDs are per-module.

**A borrowed foundation, acknowledged.** The onboarding and identity design below deliberately adopts, with adaptations, the model in *identity-security-recommendations.md* (ReferralPlatform, 13 Aug 2026): the My Health Record two-tier representative split, SMS-link-then-verify-then-branch onboarding, passkeys as the step-up credential, the organisational-carer flow, and shared-phone risk flagging. Where AoB differs (the assignor is a statutory role under reg 65CA(3)/65CB, not just a convenience delegate), the differences are stated inline.

---

## Module map

| # | Module | Delivers capabilities |
|---|---|---|
| M1 | Onboarding & Identity | C4, C8, C10 (foundations) |
| M2 | Capture Cascade | C1, C2, C3 |
| M3 | Verification Service | C4 |
| M4 | Rules & Conformance Engine (+ public tester) | C5 |
| M5 | Enduring Lifecycle | C6 |
| M6 | Notification Engine (89AA) | C7 |
| M7 | Reconciliation & Managed Follow-up | C11 |
| M8 | Patient & Assignor Portal | C8 |
| M9 | PMS Integration (adapter framework) | C12 |
| M10 | Rail Coexistence | C12 |
| M11 | Evidence Vault & Audit | C10 |
| M12 | Practice Console | C11 |
| M13 | Campaigns | C6.6 + REQ-CAMP-* |
| M14 | Language & Accessibility | C9 |

Cross-cutting: every module writes its events to M11; every patient-facing surface renders through M14; every payload passes M4 before signature and storage.

---

## M1 — Onboarding & Identity

The platform has four first-class parties. Their onboarding journeys differ in evidentiary bar and in who initiates.

### M1.A Practice onboarding (initiated by us / channel partner)

- **FR-1.1** Practice record created from ABN lookup (ABR), practice name, locations (each with address — s 65C(5)(a) depends on it), PMS in use, rail(s) in use (Tyro / HICAPS / none), and billing contact. HPI-O captured where the practice has one (optional; supports future rails).
- **FR-1.2** Signed platform agreement + privacy terms captured before any patient data flows; version recorded.
- **FR-1.3** PMS connection established per adapter runbook (M9): credentials/site key issued, connectivity proven by a read of a test patient and a **write-back proof** into a test record. Onboarding cannot complete without the write-back proof passing.
- **FR-1.4** Practice configuration: identifier set for verification (floor 3), link expiry, reminder cadence and quiet hours, chase bands (direction non-configurable), languages enabled, channels enabled, verbal-fallback policy, SMS sender registration (ACMA Sender ID) initiated — go-live blocked until registered.
- **FR-1.5** Staff accounts created with roles (front desk / practice manager / principal); passkey enrolment mandatory for admin roles at first login; staff list feeds the practitioner-employee assignor block (REQ-VUL-04).
- **FR-1.6** Data migration (optional): import of existing signed agreements (PDF batch) validated by M4 and vaulted, so a practice's historical position is in one place.
- **FR-1.7** Go-live checklist enforced in-product: write-back proven, sender ID registered, ≥1 practitioner onboarded, tablet enrolled (if in-practice channel on), conformance statement generated. Checklist state visible to us and to the practice.

### M1.B Practitioner (GP / provider) onboarding (initiated by the practice)

- **FR-1.8** Provider record: name, provider number **per location** (a practitioner has one per place of practice), profession/provider type (drives Basic Service Description categories and the enduring GP-only rule), and active locations.
- **FR-1.9** Identity: invitation from a practice admin; practitioner sets a passkey (WebAuthn, mandatory — no password-only practitioner accounts); recovery is admin-attested re-invitation, not self-service email reset.
- **FR-1.10** Authority display: what the practitioner sees is scoped to their own patients' agreements plus practice-level dashboards per role.
- **FR-1.11** Ahpra registration number recorded and format-validated (existence check manual at onboarding; automated re-verification is roadmap). A practitioner marked inactive (departure, licence loss) triggers: enduring agreements flagged for termination workflow, pending captures reassigned or voided, and the anti-fraud transfer rules (no bulk pre-approval of patients to a new practitioner — each transfer is patient-initiated or patient-confirmed). → addendum v4.
- **FR-1.12** Locum support: time-boxed provider records with the same rules; expiry auto-deactivates.

### M1.C Patient onboarding (initiated by a capture event — never a registration wall)

Patients never "sign up" to sign. Identity is established per capture event by M3 (three identifiers). The *portal account* is optional and layered on top:

- **FR-1.13** First contact is a practice-branded capture link (SMS/email) or the in-practice tablet — a link, not an OTP; verification (M3) happens on the landing page before anything renders.
- **FR-1.14** After a completed signature, offer (never require) portal activation: patient confirms mobile and email, sets a passkey (preferred) or password+OTP fallback. Activation re-uses the just-passed verification event; no second identity interview.
- **FR-1.15** The patient record links all agreements across practices on the platform (keyed on verified identity, blind-indexed); a patient sees everything, per-practice staff see only their practice's records.
- **FR-1.16** 14th-birthday handling: capture patient date of birth consequences — at 14, agreements made on the patient's behalf where the patient was not a party surface for the written-declaration / cessation rules; portal invitation offered to the patient directly. → REQ-CHILD, REQ-END-07.
- **FR-1.17** Sensitive-visit confidentiality flags respected end-to-end: flagged encounters are excluded from assignor visibility and from outbound chase. (Adaptation of the sensitive-category gating in the identity recommendations.)

### M1.D Assignor onboarding (initiated within a capture or enduring flow)

The assignor is a statutory actor, not a convenience delegate — but the two-tier model still applies, mapped as follows:

- **FR-1.18** **Tier 1 — episodic assignor (self-declared, low friction).** Within a capture flow the assignor records: name, relationship, authority basis (parent / spouse / co-resident relative 18+ / guardian / health EPOA / other-with-note), own contact channel. Authority is self-declared per the regulation; optional evidence attachment (reg 89A(2)(b)). Age rule enforced: assignor acting for another person must be 18+; a patient 14+ self-assigning is permitted. → REQ-VUL-01..05, addendum v4.
- **FR-1.19** **Tier 2 — standing assignor (evidence-based, higher friction).** For enduring agreements and for portal-level standing access to a patient's records: the assignor verifies their **own** channel (OTP to their own number/email — never the patient's), and for guardianship/EPOA bases uploads the instrument for review before standing access is granted. Patient (14+) written declaration captured where required. Patient notified on every grant via any independent channel held.
- **FR-1.20** Patient nomination and active flags: a patient may pre-nominate permitted assignors and set flags (e.g. "no one may assign for me except X"); capture flows enforce nominations where present. → addendum v4.
- **FR-1.21** **Organisational assignor flow:** the same person appearing as assignor across many unrelated patients (RACF staff pattern) is detected; routed to an organisational flow — verify the facility/organisation (ABN, name), record the individual as its agent, apply per-organisation velocity monitoring — while keeping the practitioner-employee hard block. (Direct adoption of the bulk-carer recommendation.)
- **FR-1.22** Re-attestation: standing assignor relationships re-confirmed annually ("is X still assisting you?") and on every enduring termination event touching that patient.
- **FR-1.23** Revocation: patient can remove an assignor nomination or standing access at any time from the portal, with no justification; removal is an event (M11) and notifies the practice.

---

## M2 — Capture Cascade

- **FR-2.1** Ordered cascade per solution design §1: enduring? → rail-captured? → in-practice tablet → SMS → email → paper → assignor pathway → verbal (to 30 Jun 2027). Channel is metadata on one agreement record; every stage shares validation and retention.
- **FR-2.2** Tablet flow (C2): check-in trigger, staff verification, render-locked particulars, drawn signature, validated, vaulted, written back, copy delivered; offline queue with sync-time validation.
- **FR-2.3** Remote link flow: single-use non-enumerable token, expiry per practice config, verification challenge, render, tap-to-approve or drawn signature, same downstream path.
- **FR-2.4** Paper flow: pre-filled compliant print, scan-back attaches to the same record, staff attestation of wet signature, M4 validation of the scan's metadata record.
- **FR-2.5** Assignor-remote capture: present to an assignor not physically with the patient, on the assignor's own channel. → REQ-VUL-03.
- **FR-2.6** Verbal flow: staff identity, timestamp, mandatory transition-period acknowledgement, auto-disable 1 Jul 2027.
- **FR-2.7** Cross-channel dedup: one open capture request per service; completing any channel closes the rest; reminders stop instantly on completion, decline, or STOP.

## M3 — Verification Service

- **FR-3.1** Challenge composition per practice config (types only from the approved six; never Medicare number), match against PMS-held values via M9, constant-time comparison, no partial-match disclosure ("some details don't match", never which).
- **FR-3.2** Attempt limits and lockout with practice notification and staff-assisted unlock path.
- **FR-3.3** Evidence record per event: types challenged, outcome, timestamp, channel, IP/device fingerprint, staff identity where staff-verified. Values never stored. → REQ-VER-04.
- **FR-3.4** Bot defence: invisible challenge on public endpoints, velocity ceilings per link/number/practice, disposable-number heuristics, containment mode hooks (REQ-SEC-08).

## M4 — Rules & Conformance Engine

- **FR-4.1** Rule evaluation API: validate(payload, ruleSetVersion?) → per-rule pass/fail/warn with citations; invoked pre-signature (blocking), at storage (assert), and by the public tester.
- **FR-4.2** Rule sets and Basic Service Description mappings as versioned, signed content artefacts; quarterly mapping ingest job with diff report to the regulatory-watch owner.
- **FR-4.3** Conformance statement generator (per practice, per period).
- **FR-4.4** Public tester front end: file/OCR/text/API inputs, report with fix list and citations, downloadable evidence PDF, guardrail language enforced in templates. Lead capture is optional and clearly separated from the free result.

## M5 — Enduring Lifecycle

- **FR-5.1** Create (three pathways, reg 65CB content, scope preview with item counts), per practitioner × patient; GP-only enforcement.
- **FR-5.2** State machine: draft → signed → active → [registered] → terminated/ceased, with cessation reasons enumerated (65CA(8)); anniversary-fuse countdowns and warnings; registration integration stub behind a feature flag awaiting the Services Australia mechanism.
- **FR-5.3** Termination flows: patient-initiated (portal, 2-business-day effect), assignor-initiated, provider-initiated (advance notice generated), practice-initiated on practitioner departure.
- **FR-5.4** Cessation monitors: PMS signals (patient transfer, RACF discharge), MyMedicare status where observable, 14th birthdays; silent-cessation alarms — an agreement relied on after cessation is surfaced before a claim is, wherever ordering allows.
- **FR-5.5** Coverage query API: "is service S for patient P by practitioner X on date D covered by an active enduring agreement?" — used by M2 stage 1 and by reconciliation.

## M6 — Notification Engine (89AA)

- **FR-6.1** Claim-event intake (from M9 or practice-asserted), matched to active MyMedicare enduring agreements; notice composed with the four required elements; dispatched within SLA on the agreement's recorded method.
- **FR-6.2** Correction workflow; per-assignor preference; suppression for aged-care/ACCHO pathways; full dispatch audit; SLA dashboards and breach alarms.
- **FR-6.3** Notices are one-way: no approval semantics anywhere in copy or UI; never chased. (This was decided explicitly: non-response never gates payment.)

## M7 — Reconciliation & Managed Follow-up

- **FR-7.1** Outstanding queue ranked by lodgement-window urgency; bands per REQ-CHASE-05 (Standard/Compressed/Urgent/Last chance/Expired); one-click and bulk resend.
- **FR-7.2** Escalation ladder automation: cascade → AI attempt 1 → AI attempt 2 → human attempt 3 → handback; immediate human escalation triggers; exclusion list honoured (confidentiality flags, declines, STOP, containment). → REQ-CHASE-01..08.
- **FR-7.3** Private-billing decision point at Urgent band with explicit convert-or-forgo prompt. → REQ-CHASE-07.
- **FR-7.4** Economics guard: per-item attempt cap tied to benefit at stake; overrides only on recorded practice instruction. → REQ-CHASE-09/10.
- **FR-7.5** Handback records and band/channel/attempt resolution analytics. → REQ-CHASE-11..13.

## M8 — Patient & Assignor Portal

- **FR-8.1** History, artefact download, enduring view, 89AA feed, pending-request verification, one-click enduring termination, assignor-scoped views, offboarding actions, nomination management, AI chat (reversible actions only), experience feedback. → C8.1–C8.8.
- **FR-8.2** Authentication: passkey-first, with the three-identifier bootstrap; sessions short-lived; every access an event in M11.

## M9 — PMS Integration

- **FR-9.1** Adapter interface: readPatient/readAppointments/readProviders/readInvoices/writeArtefact/writeNote/claimEvents?, with per-adapter capability declaration; core behaviour degrades explicitly per missing capability (e.g. claim clock defaults conservative).
- **FR-9.2** Medtech Evolution adapter first (D-01 resolves the mechanism); write-back lands the signed artefact + outcome note in the patient record.
- **FR-9.3** Sync integrity: idempotent writes, reconciliation report of unsynced artefacts, alert on any artefact older than N hours not yet in the PMS.
- **FR-9.4** Adapter conformance test kit — a scripted suite any new adapter must pass before a practice goes live on it.

## M10 — Rail Coexistence

- **FR-10.1** Detection of rail-captured AoB per service (Tyro Health Online query; terminal-capture inference from PMS transaction records); suppression of all patient contact on detection; ingestion per rail capability (digital pull / metadata + scan offer); `paper_only_at_rail` flagging; retention-gap report. → REQ-RAIL-01..06.

## M11 — Evidence Vault & Audit

- **FR-11.1** Event API (append-only), hash-chained per REQ-VAULT-01; artefact store with hash binding (VAULT-02); trusted time + external anchoring (VAULT-03); per-patient key management and crypto-shredding with legal hold (VAULT-05); auditor bundle export + offline verifier (VAULT-07); verification API (VAULT-09).
- **FR-11.2** Outbox-pattern guarantee: a domain write and its event commit atomically or not at all; it is structurally impossible to change an agreement without a vault entry.

## M12 — Practice Console

- **FR-12.1** Dashboards over the REQ-MON-01 metric set; exports (REQ-MON-02); configuration surfaces (bands, cadence, languages, channels); go-live checklist; conformance statement download; billing/usage view (SMS spend in real time → REQ-SMS-06).

## M13 — Campaigns

- **FR-13.1** Batch enduring enrolment (eligibility filter, bulk send, progress, exceptions → REQ-END-08) and the six specced recall campaign types (REQ-CAMP-*), sharing consent, quiet-hours, STOP and exclusion infrastructure with M2/M7.

## M14 — Language & Accessibility

- **FR-14.1** String-table architecture, bilingual artefact rendering, professional translation pipeline with versioning, per-person language preference, read-aloud, WCAG 2.2 AA audit gates on every patient-facing release. → REQ-LANG-01..06, REQ-NFR-05.

---

## Explicitly not functions of this platform

Claim lodgement, payment processing, clinical triage or capacity assessment, care blocking of any kind (REQ-REC-04), and chasing 89AA notices. Stated here because scope discipline is a requirement, not a preference.

## Change log

| Version | Date | Change |
|---|---|---|
| 1.0 | 20 Aug 2026 | Initial module decomposition and functional requirements; four onboarding journeys; two-tier assignor model adapted from identity-security-recommendations.md. |
