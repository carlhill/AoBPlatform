# AoBPlatform — Build & Delivery Plan
### v1.0 · 20 August 2026 · The plan behind Roadmap Phase 0 ("Prove wedge — AoB GA by Jun 2027 · 50+ practices")

**The date that runs the plan.** The verbal fallback ends **30 June 2027**. GA must land with enough runway for 50+ practices to be live before that date, which puts GA no later than **March–April 2027** and the design partner live on core capture by **December 2026**. Everything below is sequenced backwards from that.

---

## Phase 0 — Unblock (Sep 2026, ~4 weeks) — spend almost nothing until these close

Nothing of scale is built until the four blocking facts are proven. This is the *pilot the environment before the fan-out* rule from cost-aware-agent-builds-SKILL.md applied to the whole venture, not just to code.

1. **Medtech write-back spike (D-01).** Prove a signed artefact can land in an Evolution patient record at the design-partner practice — API, integration program, file/HL7 drop, or scan-in, in that order of preference. Output: a working proof and a chosen mechanism. **If no mechanism works, stop and re-plan; nothing else proceeds.**
2. **Regulatory verifications:** Basic Service Description document ingested from MBS Online and parsed; enduring-registration question (D-11) put to the Developer Liaison in writing; conformance/Notice-of-Integration question (D-10) asked in the same conversation; Health Systems Developer Portal registration lodged (free).
3. **Procurement:** SMS gateway selected against the §2 criteria; ACMA Sender ID registration started (lead time!); AWS accounts + Terraform skeleton stood up (account-per-environment from day zero).
4. **Field validation:** the fifteen practice-manager interviews (Medtech, Gentu, allied) from the "what happens next" slide — confirming the wedge before the money is spent confirms it.

**Gate P0:** write-back proven · mapping ingested · sender ID in flight · interviews support the thesis. Only then does the build team scale.

## Phase 1 — Core compliance product (Oct–Dec 2026, ~10 weeks) → design partner live

Scope (build order inside the phase): Evidence Vault service first (everything else writes to it from its first commit) → Rules & Conformance engine → domain core + Medtech adapter + write-back → verification service → tablet capture app (offline-first) → practice console (go-live checklist, outstanding queue v1) → practice/practitioner onboarding (M1.A/M1.B).

**Milestone M1 (mid-Dec 2026): the design-partner practice captures real agreements on tablet, validated by the rules engine, vaulted, written back to Medtech, with staff on passkeys.** Instrumentation on from the first live agreement (REQ-MON-04).

## Phase 2 — Reach & reconciliation (Jan–Feb 2027, ~8 weeks) → beta cohort of 5–10 practices

SMS + email cascade (registered sender live) · paper flow · assignor pathway (episodic Tier 1) · reconciliation queue with chase bands (automated cascade only — AI calling is **not** in this phase) · patient copy delivery · portal v1 (history, download, verify-a-message) · patient/assignor onboarding (M1.C/M1.D Tier 1) · multilingual v1 (English + Arabic + 2 further languages as translation vendor delivers).

**Milestone M2 (end Feb 2027): beta practices running the full cascade; measured in-practice capture share ≥ 75% (the G1 write-back/capture gate from the roadmap); chase volume measured against the 9–12/day baseline.**

## Phase 3 — GA + public authority (Mar–Apr 2027)

Hardening from beta findings · pen test + incident runbook + on-call (GA gates) · public s 65C tester launched (the funnel, timed for the pre-deadline panic quarter) · conformance statements · Tyro/HICAPS detection + retention-gap report (the sales demo) · pricing switched on.

**Milestone M3 / GA (no later than Apr 2027): open onboarding, targeting 50+ practices by 30 June 2027 via the channel motion.**

## Phase 4 — The compounding features (May–Aug 2027, overlapping GA growth)

Enduring lifecycle (all three pathways, anniversary fuse, batch enrolment) · 89AA notification engine · portal termination flows · Tier-2 standing assignors · remaining languages · RACF batch mode. Enduring lands **before** 1 July 2027 forces per-practitioner registration on new agreements — the market's attention peak.

**Milestone M4 (Jun–Jul 2027): first practice converts its MyMedicare book in one campaign; 89AA SLA holding at scale.**

Managed follow-up with AI calling (REQ-CHASE) follows in Phase 5 once resolution-rate data from Phases 2–4 defines what the AI must beat — that sequencing is deliberate: the ladder's economics (REQ-CHASE-09) need measured baselines.

## Team

Lean until Gate P0, then: 2 senior engineers (the $250k IT specialists already in the cash model) + 1 product-minded founder/lead (Carl) + fractional: designer (tablet + portal), security reviewer (vault + pen test), translator vendor, and the AI-agent build partner deferred to Phase 5. The cash model's headcount lines hold; no new hires are implied by this plan before GA.

## Using agentic builds — the cost rules applied

Large code-generation runs (adapter scaffolds, the console's many screens, test suites) will use multi-agent builds under the rules in *cost-aware-agent-builds-SKILL.md*, adopted verbatim as build policy: pilot the build environment first (can it run Expo builds, Postgres, immudb, the PMS connector's Windows packaging?); an agreed budget ceiling per run, enforced; agents scoped to cohesive modules (one per M-module, not one per file); 40–60 turn caps; write-verify separation with fresh fix-up agents; a pre-flight cost estimate before every fan-out. The vault, the rules engine and anything touching key management are **human-written and human-reviewed** — agent assistance yes, agent authorship no.

## Risks the plan absorbs

| Risk | Absorption |
|---|---|
| Write-back has no path (D-01) | Phase 0 gate; nothing scales before it proves |
| Regulation moves again | Versioned rules/mapping ship in Phase 1; the change-watch process starts in Phase 0 |
| Enduring registration mechanism appears suddenly (D-11) | Data already in registrable shape; integration behind a flag; Developer Liaison relationship opened in Phase 0 |
| ACMA/sender or translation lead times | Both started in Phase 0, months before needed |
| Beta shows capture share < 75% | G1 fails → GA date holds but pricing/ROI claims re-based on measured numbers; the deadline still sells |
| Team of 2+1 slips | Phases 2 and 4 have deliberate scope shed lines: languages beyond 4, Tier-2 assignors, RACF batch, tester OCR can each slip without moving GA |

## The one-line version

Prove the write-back and the market in four weeks for almost nothing; put the vault and rules engine under everything; get one Medtech practice signing on glass by December; get the cascade measured by February; go GA with the free tester as the megaphone by April; land enduring before the July 2027 registration cliff — and let the AI follow-up wait until the data says what it must beat.

## Change log

| Version | Date | Change |
|---|---|---|
| 1.0 | 20 Aug 2026 | Initial build plan: Phase 0 gates, phased delivery to GA ≤ Apr 2027, team, cost-aware agentic build policy, risk absorption. |
