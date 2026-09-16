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
| `DECISIONS.md` | Running log of product and regulatory decisions from working sessions, dated and attributed, with what would reopen each. Check it before proposing a change to something already decided |

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

Repo shape (suggested, adjust with a recorded decision): monorepo — `apps/core`, `apps/rules`, `apps/vault`, `apps/web` (console, portal, tester and — from 3 Sep 2026 — the kiosk at `/kiosk`; `apps/kiosk` is retired once the port lands), `apps/connector`, `packages/domain`, `packages/contracts` (OpenAPI + shared types), `infra/` (Terraform).

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

*The rules, not the reasoning. Every one of these came from something that went wrong or a decision Carl made, and `wow.md` holds those accounts — read it at the start of a session. This section is the checklist; keep it short. A rule earns its place here only if removing it would cause a mistake.*

### 7a. Method

1. **Confirm what "done" means before starting.** If the requirements are ambiguous, ask once, in a single round, then proceed on stated assumptions rather than stalling.
2. **Minimal changes.** No unrelated refactors, renames or reformatting; match the neighbouring code. Read `INVENTORY.md` before writing a component or a helper — reuse beats a new one — and say in the report what you imported and what you wrote, with a line justifying each new thing.
3. **Bugs: a failing test first, then fix the root cause.** The test stays afterwards.
4. **If a fix fails twice, stop.** Report what you tried, what you saw, and your theory. Not a third variation.
5. **Never delete, skip, weaken or `.only` a test to make a run pass.** A test you believe is wrong is a finding to report, not an edit to make quietly (wow.md §11).
6. **Run the tests the change touches, not the suite:** `npx jest --findRelatedTests <files>` in `apps/core` or `packages/domain`; `npm test -w apps/web -- <path>` for Vitest (the root runner is broken); name the e2e spec, never the whole config. **Full suite only if Carl asks or a shared module changed** — `packages/domain`, `packages/contracts`, the Prisma schema, the string table, config — and then **ask first**. Say which tests ran and why. The named hard-rule test for any rule the change touches always runs, whatever `--findRelatedTests` picks up.
7. **Unsure of an API? Read the installed package or the docs.** Never reconstruct a signature from memory.
8. **Finish with:** files changed, tests run and why those, assumptions, risks.
9. **Compact before ~40% of the 5-hour budget or ~100k tokens,** recording the next step in the plan doc first. **When compacting, preserve the list of modified files, the test commands run, and any hard rule under discussion.**

### 7b. Git

1. **Never work on `main`.** Branch `<type>/<short-description>`.
2. **Small commits, conventional prefixes** (`feat: fix: test: refactor: docs: chore:`), one concern each. `carls_notes_1.txt` rides along whenever it has been modified.
3. **Commit only on a passing exit code** from the targeted tests — the code, not the impression.
4. **Show `git diff --stat` before each commit** and check the file count is the one you expect. `git add <paths> && git commit` commits **the whole index**, not those paths: use `git commit -o <paths>` (wow.md §5a).
5. **Never `push --force`, `reset --hard`, `clean -fd`, or rewrite pushed history.** Denied in `.claude/settings.json`; a denial is the rule working, not an obstacle to route around. Undo with `git revert`.
6. **Never commit secrets, `.env` files, logs or large generated files.**
7. **`git log` / `git blame` before changing unfamiliar code.** The commit usually names a decision; `DECISIONS.md` says why.
8. **PRs with `gh`:** summary, changes, tests run, risks. One concern per PR.

Rules 1, 4 and 6 are enforced by `.claude/hooks/git-commit-guard.mjs`, which runs before every `git commit`.

### 7c. Project rules

- **Human-authored zones:** the vault service, the s 65C rules engine, anything touching key management. Assist with tests, review and refactors; never author wholesale.
- **Model split:** builds run in Opus subagents; mechanical fix-ups and test re-runs on Sonnet; **every review that touches a hard rule is Opus**.
- **Cost-aware agent builds:** pilot the environment, agree a ceiling, scope agents to modules not files, cap turns ~40–60, separate write from verify, give a pre-flight estimate. A reviewer reports only what affects correctness or requirements — plus any hard-rule violation, at any severity.
- **Zero-footprint kiosk:** nothing installed on a tablet and nothing written to it but one revocable pairing credential; no PII in any storage API. Enforced by a lint rule and `kiosk_persists_nothing_but_pairing`.
- **Choose tech for iteration speed:** "a look costs a build" is a defect in the choice, not a cost of doing business. Prefer the toolchain the monorepo already runs.
- **Option lists are content, not code:** a versioned file under `packages/domain/content/`, schema-validated at load, labels in the string table, rendered in file order.
- **Shortcuts to the answer, not directions to a screen:** every blocked, wrong or waiting message names its specific reason and links to the exact item where it is fixed; an unmapped reason code shows its code.
- **Never invent regulatory facts.** Section numbers, dates, data elements and thresholds come from the requirements docs. Missing one? Flag it — this regime changed in 2025–26 and your priors are stale.
- **Ask before:** adding any dependency to any `package.json` (dev dependencies included), changing an ADR, touching auth flows, or sending a real SMS or email (the dev sandbox gateway is there for this).
- **Security in every change:** no secrets in code, fixtures or logs; parameterised queries only, never concatenated SQL; validate at the boundary with the DTO validators; no PII in logs, events or test names; RLS respected; identifier types, never values. Fixtures use obviously fake identities and invalid-checksum Medicare numbers.
- **Conventional commits; one module per PR where feasible; CI green** (tests, SAST, dependency scan) before merge — release-blocking, not advisory.

## 8. Out of scope — do not build

Claim lodgement, payment processing, clinical features of any kind, capacity assessment, a patient mobile app, pathology/DI agreement types (s 65C(4) items 1–4), DVA/CDBS handling, FHIR server (deferred), Kafka, Kubernetes (Fargate now), multi-cloud abstractions, and anything that chases an 89AA notice.

---

*Questions this file cannot answer go to Carl. When in doubt on regulation: stop, cite the requirement you're unsure about, and ask.*
