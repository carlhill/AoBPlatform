# AoBPlatform — Technical Stack
### v1.0 · 20 August 2026 · Companion to aob-solution-architecture.md

**Basis and honesty note.** Carl asked whether the ReferralPlatform stack document (*solution-architecture-tech-stack.md*, 13 Aug 2026, in this project) still holds for AoBPlatform. Answer: **most of it holds and is adopted below; five choices change** because AoBPlatform's shape differs — an offline tablet at a front desk, an on-premise PMS integration, a statutory evidence vault, and no patient mobile app. §1 is the item-by-item verdict; §2 is the resulting stack; §3 covers what AoBPlatform needs that ReferralPlatform never did. The guiding principles (boring where it doesn't matter, open source and vendor-neutral by default, AU residency as a hard constraint, K8s-ready without K8s) are adopted unchanged.

---

## 1. What holds from the ReferralPlatform stack, and what changes

| ReferralPlatform choice | Verdict for AoB | Why |
|---|---|---|
| TypeScript + NestJS backend | **Holds** | Same one-language-across-the-team argument; same small team owning everything |
| HAPI FHIR (Java) interoperability service | **Changes — deferred** | Our Phase-1 integration is Medtech Evolution's own interface, not FHIR. Standing up a FHIR server before any counterparty speaks FHIR to us is cost without a consumer. Revisit when Halo Connect (Bp/Zedmed) or MHR integration enters the roadmap — the adapter interface keeps the door open |
| Next.js + React + Radix web portals | **Holds** | Console + portal + public tester are exactly this shape; WCAG 2.2 AA on Radix primitives |
| React Native (Expo) patient app | **Changes** | AoB patients arrive by link; a patient app would suppress response rates. **No patient mobile app.** Expo is redeployed for the **in-practice tablet/kiosk app**, where offline-first, kiosk-mode lockdown and signature capture on glass genuinely need a native shell. The passkey-maturity caveat from the original doc transfers to the tablet app and still deserves a spike |
| PostgreSQL (managed, RLS for consent scoping) | **Holds** | RLS now scopes *practices* rather than consent categories — same mechanism, same rationale |
| immudb for the append-only audit log | **Holds — promoted** | For ReferralPlatform it was an audit trail; for us it is the product. The vault service wraps it; WORM object storage and external anchoring are added around it (§3) |
| Redis | **Holds** | |
| S3 per-user keys / crypto-shredding | **Holds — extended** | Per-patient envelope encryption; Object Lock (WORM) added on evidence buckets |
| Postgres FTS before Elasticsearch | **Holds** | Nothing here needs a search cluster |
| Managed queue (SQS), not Kafka | **Holds** | Cadences, 89AA SLAs, ingest jobs — classic queue work; event streaming is not a current problem |
| Docker everywhere; ECS Fargate now, EKS later | **Holds** | Plus one addition Fargate can't cover: the site-installed PMS connector (§3) |
| AWS ap-southeast-2, Melbourne DR | **Holds** | Same IRAP/precedent reasoning; decision D-09 closes as AWS unless the design partner's constraints say otherwise |
| Keycloak (self-hosted OIDC, WebAuthn) | **Holds** | Carries our passkey-mandatory practitioner policy and the assignor tiers as custom flows; Cognito remains the documented fallback |
| Social login as convenience-only, no Facebook | **Holds** | Same reasoning verbatim; if anything stronger here, given AoB phishing exposure |
| Secrets Manager + HSM-backed KMS for signing/shred keys | **Holds — extended** | Chain-signing keys and anchoring keys join the HSM tier; dual-control ceremony documented |
| OpenTelemetry + Grafana/Prometheus/Loki + Sentry; no ad-tech trackers | **Holds** | AU-residency check on hosted tiers applies unchanged |
| Terraform; GitHub Actions; account-per-environment; SAST + dependency scanning gates | **Holds** | |
| Jest/Vitest, Playwright, Maestro, k6 | **Holds** | Maestro now targets the tablet app; k6's priority scenario is the 8–10 am check-in signature burst and the 89AA dispatch batch |

Also carried over from *identity-security-recommendations.md*: passkeys as step-up (NIST AAL2/AAL3 framing), SMS-link-then-verify onboarding, TDIF/myID as an optional high-assurance path for Tier-2 assignor elevation, branded sender identities. All hold; the AoB-specific twist is that our first-contact verification is the RACGP three-identifier challenge rather than DOB-only.

## 2. The stack, stated plainly

| Layer | Choice |
|---|---|
| Core application | TypeScript · Node.js · NestJS (modular monolith, module boundaries enforced) |
| Rules & Conformance service | TypeScript · NestJS; rule sets + mappings as signed, versioned content artefacts; OCR via Tesseract, with AWS Textract (Sydney) as the accuracy upgrade if needed |
| Evidence Vault service | TypeScript · NestJS wrapping **immudb**; SHA-256 hash chain; RFC 3161 external anchoring; artefacts in S3 with Object Lock; per-patient envelope encryption under KMS/CloudHSM |
| Web (console, portal, tester) | Next.js · React · TypeScript · Radix UI · WCAG 2.2 AA |
| Tablet/kiosk app | React Native (Expo) · offline-first local queue (SQLite, encrypted) · kiosk lockdown (managed-device mode) · vector+raster signature capture |
| PMS connector | Site-installed service (TypeScript/Node, packaged for Windows hosts — Medtech sites are Windows) · outbound-only mTLS · practice-scoped credentials · auto-update channel |
| Data | PostgreSQL (RDS, RLS) · immudb · Redis · S3 (AU) |
| Async | SQS + scheduled jobs (EventBridge) · outbox pattern for domain-write/vault-event atomicity |
| Identity | Keycloak (OIDC) · WebAuthn passkeys mandatory for practitioners/admins · custom flows for assignor tiers · myID/TDIF brokerage optional later |
| Messaging | Tier-1 SMS gateway with dedicated number per practice + ACMA Sender ID registration (gateway selection is a Phase-0 procurement task — evaluate on deliverability SLA, dedicated-number support, AU data handling; do not commit in this doc) · SES or equivalent for email with DKIM/SPF/DMARC |
| Documents | Server-side deterministic PDF render (single render path so the hash is stable); pdf/A output for artefacts |
| AI (Phase 2+) | Managed-follow-up voice/chat agents behind our own API; models hosted with AU data processing; every agent action eventised to the vault; human-handback per REQ-CHASE. Build-out governed by the cost-aware rules (see build plan) |
| Cloud & ops | AWS ap-southeast-2 (+ Melbourne DR) · ECS Fargate · Terraform · GitHub Actions · account-per-environment · OpenTelemetry · Grafana stack · Sentry |
| Testing | Vitest · Playwright · Maestro · k6 · adapter conformance kit (FR-9.4) · chain-verifier property tests |

## 3. What AoBPlatform needs that ReferralPlatform never did

1. **A deterministic render-and-hash pipeline.** Non-repudiation dies if the same agreement renders differently twice. One server-side render path, pinned fonts and layout engine, PDF/A, hash-at-render — treated as a versioned artefact of its own.
2. **WORM + anchoring around immudb.** immudb gives tamper-evidence within itself; Object Lock stops storage-layer deletion; RFC 3161 anchoring stops whole-system rollback. Three layers, three different attackers.
3. **A site-installed connector discipline.** On-premise PMS integration means shipping software into practices: signed builds, staged auto-update, outbound-only connections, practice-scoped secrets, remote kill. This is the operationally hardest part of the stack and is treated as a product, not a script.
4. **Offline-capable kiosk hardware posture.** Managed tablets (MDM-enrolled), kiosk lockdown, encrypted local queue, no residual data after sync — plus a stated posture for BYOD practice tablets (supported, harder guarantees documented).
5. **Quarterly content ingest with human sign-off.** The Basic Service Description mapping and rule set are versioned content deployments with diff review — regulatory content gets the same rigour as code.
6. **A public anonymous endpoint (the tester)** — isolated service, zero PII, aggressive rate limiting, upload scanning, and its own blast-radius assumptions.

## 4. Industrial-strength gates (adopted from the ReferralPlatform doc, with vault additions)

Account-per-environment, all-Terraform, no console changes; TLS 1.2+ everywhere and encryption at rest everywhere; RBAC + Postgres RLS in depth; outbox-enforced "no domain write without a vault event"; vulnerability scanning on every build; incident runbook + on-call before the design partner goes live; feature flags on everything patient-facing; OpenAPI contracts internally; **plus:** chain-verification job running continuously against production (an alarm, not a report); quarterly restore-and-verify DR drill in which the chain must verify end-to-end after restore; annual external penetration test with the tester and capture endpoints in scope; SOC 2 Type II program started once the design partner is stable (enterprise deals and PMS partnerships will ask).

## Change log

| Version | Date | Change |
|---|---|---|
| 1.0 | 20 Aug 2026 | Initial stack. ReferralPlatform stack assessed item-by-item: adopted with five changes (FHIR deferred, patient app dropped, Expo redeployed to kiosk, vault promoted and hardened, site connector added). |
