# CLAUDE.md — AoBPlatform build brief
### v1.0 · 20 August 2026 · Drop this file in the repo root. It is the orientation document for Claude Code sessions building AoBPlatform.

You are building **AoBPlatform**: a consent-and-compliance-record product for Australia's Medicare Assignment of Benefit (bulk-billing consent) regime. It captures, verifies, validates, stores and proves patient consent to bulk billing — and writes the evidence back into the practice's clinical system. The first customer is a general practice on **Medtech Evolution**. GA must land by **April 2027**; the statutory verbal-consent fallback ends **30 June 2027**.

This is a real product with statutory exposure, not a demo. When this brief and your own judgement conflict on a regulatory point, this brief wins; if something here seems wrong, stop and ask Carl rather than silently "fixing" it.

---

## 1. Document map — what is authoritative for what

Read in this order before writing code. All are provided alongside this file.

| Document | Authoritative for |
|---|---|
| `AoB_requirements.md` | The twelve capabilities (C1–C12) and new families REQ-LANG / REQ-VAULT / REQ-MON. **Start here.** |
| `aob-requirements.md` (v0.4) | Statutory detail — the s 65C data set, verification, enduring, chase bands, every REQ-* family. When a capability doc cross-references a REQ ID, this is where it resolves |
| `aob-functional-requirements.md` | Module decomposition M1–M14, FR-x.y behaviour, the four onboarding journeys |
| `aob-solution-architecture.md` | Service boundaries, data stores, the eight-link non-repudiation chain, ADRs A-01..A-08 |
| `aob-tech-stack.md` | Every technology choice, with reasons. Do not substitute technologies without a recorded decision |
| `aob-build-plan.md` | Phase order, gates, and the cost-aware agent-build policy |
| `aob-faq-reconciliation.md`, addenda v2–v5, `aob-threat-model.md` | Background: why the rules below exist. Consult when a requirement seems arbitrary |
| `glossary.md` | Every acronym. If you introduce a new acronym in code docs, add it here |

Requirement language: MUST = release-blocking, SHOULD = deferrable with a recorded decision, MAY = roadmap.

## 2. Hard rules — encode these; never "improve" them

These are legal/regulatory invariants. Each MUST be enforced **in code** (validators, type system, DB constraints), not in comments or policy. Most have a test named after them.

1. **The Medicare card number is NOT an identity identifier.** The approved set is: name, DOB, gender, address, patient record number, IHI. Exclusion is non-configurable. (REQ-VER-02 — the single most likely design mistake in this product.)
2. **Particulars complete and locked before signature.** The signature control cannot enable until the payload passes validation; signing a draft is the criminal offence in this regime. (REQ-REG-06)
3. **No practitioner signature field anywhere.** Abolished 1 July 2026. The validator blocks it defensively. (rule C10)
4. **No benefit or dollar amount on any agreement artefact.** Not in the data set; adding it is risk. (REQ-REG-04; 89AA notices are the one place a benefit amount appears)
5. **Verbal capture works until 30 June 2027, then auto-disables.** Risk-flagged while it works; explicit override + reason after. (REQ-REG-10)
6. **Enduring agreements are per practitioner × patient, and GP-only.** Never per practice. Never offered for specialists/allied/optometry — offer Treatment Plan Assignment instead. (REQ-END-01/-01a)
7. **89AA notices are one-way.** They never gate payment, never have approval semantics in copy or UI, and are never chased. MyMedicare pathway only. (REQ-END-05, REQ-CHASE-02)
8. **The platform never blocks care.** No flow may prevent a patient being seen or billed; a platform outage slows evidence, never service. (REQ-REC-04)
9. **Verification logs store identifier TYPES and outcomes — never values.** (REQ-VER-04)
10. **Assignor rules:** practice-staff assignors hard-blocked against the staff list; assignor acting for another person must be 18+; a patient 14+ may self-assign; the UI never asks staff to assess capacity. (REQ-VUL-04/-05, addendum v4)
11. **The vault is append-only.** No update or delete endpoint exists on the Evidence Vault service. Domain writes and vault events commit via the outbox pattern — one without the other must be structurally impossible. Deletion is crypto-shredding + tombstone event only. (REQ-VAULT-01/-05, ADR A-02)
12. **Never generate the words "certified", "approved", "accredited" or "government-approved"** in any UI, template, email or doc about our forms. Permitted: "checked against the s 65C data set", "self-assessment". (REQ-65C-05, REQ-TEST-08)
13. **One deterministic render path.** Agreements render server-side to PDF/A, are hashed at render, and any later display re-verifies the hash. Two renders of the same agreement must be byte-identical. (REQ-VAULT-02)
14. **Rule sets and Basic Service Description mappings are versioned content.** Every stored agreement records both versions. Never hardcode a mapping or a rule threshold. (REQ-REG-03, REQ-65C-02)
15. **Practitioner and admin auth is WebAuthn passkeys — no password-only paths.** (REQ-VAULT-04)

## 3. Terminology (enforced in the domain model)

"**Provider**", not "GP"; "**service**", not "consult" (REQ-MP-01). "**Assignor**" is the person who signs — often but not always the patient; never conflate them in types (`assignorIsPatient` is an explicit field, D7). "**Agreement**" ≠ "item/claim" — 358m items a year does not mean 358m contracts; never price or count per item as if per agreement. UK/AU spelling in user-facing text.

## 4. Stack summary (full detail: aob-tech-stack.md)

TypeScript everywhere. NestJS modular monolith (M1–M8, M12–M14 as enforced modules — no cross-module table access) + two satellite services: **Rules & Conformance** (zero PII, hosts the public tester) and **Evidence Vault** (immudb, hash chain, RFC 3161 anchoring, S3 Object Lock). Next.js + Radix (console, portal, tester; WCAG 2.2 AA). The kiosk is a **cloud-served web app with zero device footprint** — no native build, no installer, nothing persisted on the tablet beyond one revocable pairing credential (Carl, 3 Sep 2026; supersedes the Expo offline-first native shell — see §7 and TODO.md). There is **no patient mobile app**. Postgres with RLS (practice scoping at the DB layer), Redis, SQS. Keycloak (OIDC, passkeys). Site-installed Windows connector for Medtech Evolution, outbound-only mTLS. AWS Sydney, ECS Fargate, Terraform, account-per-environment, GitHub Actions. Tests: Vitest, Playwright, Maestro, k6.

Repo shape (suggested, adjust with a recorded decision): monorepo — `apps/core`, `apps/rules`, `apps/vault`, `apps/web`, `apps/kiosk`, `apps/connector`, `packages/domain`, `packages/contracts` (OpenAPI + shared types), `infra/` (Terraform).

## 5. Build order and current blockers

Follow `aob-build-plan.md`. Phase 1 internal order: **vault first** (everything writes events from its first commit) → rules engine → domain core + Medtech adapter + write-back → verification → kiosk app → console → onboarding.

**Do not build against unpublished specs.** Two open blockers gate real integration work:
- **D-01 (Medtech write-back mechanism)** — until resolved, code the adapter behind the FR-9.1 interface with a mock adapter; do not guess Medtech's API.
- **D-11 (Services Australia enduring registration)** — no portal/API is published anywhere. Keep the data registrable-shaped, keep the integration behind a feature flag, build nothing speculative.

Regulatory whipsaw is the top project risk (the rules changed twice and reversed once, eight days before go-live, costing a competitor ~$1m). Versioning (rule 14) is the defence — respect it everywhere.

## 6. Definition of done — every feature, every PR

- Validated by the rules engine where it touches an agreement payload; blocked states unreachable in the UI.
- Emits its vault events through the outbox; the continuous chain-verifier still passes.
- Unit tests incl. one named test per hard rule it touches (e.g. `medicare_number_rejected_as_identifier`); Playwright/Maestro coverage for user-visible flows.
- RLS respected — a cross-practice access test fails closed.
- All user-facing strings in the string table (REQ-LANG-01), none inline; WCAG 2.2 AA checks pass on patient surfaces.
- No PII in logs, error messages, or the rules service. No identifier values anywhere outside the encrypted stores.
- OpenAPI contract updated; migration reversible; feature-flagged if patient-facing.

## 7. Working rules for Claude Code sessions

- **Human-authored zones:** the vault service, the s 65C rules engine, and anything touching key management are written and reviewed by humans. You may assist (tests, review, refactors) but not author them wholesale. (Build-plan policy.)
- **Cost-aware agent builds:** before any multi-agent fan-out, pilot the environment (can it run Expo builds, Postgres, immudb?), agree a budget ceiling, scope agents to whole modules not files, cap turns ~40–60, separate write from verify with fresh fix-up agents, and give a pre-flight cost estimate. (cost-aware-agent-builds-SKILL.md, adopted as policy.)
- **Compact the chat before it gets expensive.** Every tool call re-sends the whole conversation; once a session passes roughly 40% of the 5-hour budget or ~100k context tokens, run `/compact` (or start a fresh session briefed from the plan docs) rather than continuing. Long chat history chews through the limit for no gain in output quality. Record the next step in the plan doc first so nothing is lost. (Carl, 3 Sep 2026.)
- **Model split (Carl, 3 Sep 2026).** Fable orchestrates: plan reading, regulatory and design judgement, terse. Every build runs in a subagent on **Opus** (`model: "opus"`); mechanical fix-ups and test re-runs on **Sonnet**. Fable draws the 5-hour limit down faster per token, and builds are the high-volume, well-specified work that does not need its headroom. Subagent output counts against the same limit, so brief tightly and ask for a short report.
- **Zero-footprint kiosk (Carl, 3 Sep 2026).** There may be thousands of tablets. Nothing is installed on them and nothing is written to them: no native app, no offline queue, no PII in localStorage/IndexedDB/service-worker caches — the one exception is a single opaque pairing credential, revocable from the console. Every session loads the current build from the cloud, so a bad release is fixed by a deploy and a rollback, never by visiting a device. Releases to kiosks are staged per practice with instant rollback. Outage posture: the kiosk says "see reception"; care is never blocked (rule 8) and capture falls back to post-service. Enforced by a lint rule on storage APIs in the kiosk and a named test `kiosk_persists_nothing_but_pairing`.
- **Never invent regulatory facts.** Section numbers, dates, data elements and thresholds come from the requirements docs. If a needed fact is missing, flag it — do not infer it from training data; this regime changed in 2025–26 and your priors are stale.
- **Ask before:** adding a dependency with network access at runtime, changing an ADR, touching auth flows, or writing anything that sends a real SMS/email (use the sandbox gateway config in dev — real sends require a registered sender and cost money).
- Secrets never in code or fixtures; sample data uses obviously fake identities (no real Medicare-format numbers in fixtures — generate invalid-checksum ones).
- Conventional commits; one module per PR where feasible; CI green (tests, SAST, dependency scan) before merge — these gates are release-blocking, not advisory.

## 8. Out of scope — do not build

Claim lodgement, payment processing, clinical features of any kind, capacity assessment, a patient mobile app, pathology/DI agreement types (s 65C(4) items 1–4), DVA/CDBS handling, FHIR server (deferred), Kafka, Kubernetes (Fargate now), multi-cloud abstractions, and anything that chases an 89AA notice.

---

*Questions this file cannot answer go to Carl. When in doubt on regulation: stop, cite the requirement you're unsure about, and ask.*
