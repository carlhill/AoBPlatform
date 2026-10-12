# AoBPlatform

A consent-and-compliance-record product for Australia's Medicare Assignment of
Benefit (bulk-billing consent) regime. It captures, verifies, validates,
stores and proves patient consent to bulk billing — and writes the evidence
back into the practice's clinical system. First customer: a general practice
on Medtech Evolution. GA by April 2027; the statutory verbal-consent fallback
ends 30 June 2027.

**Read these before writing code, in order:**

1. [CLAUDE.md](CLAUDE.md) — the build brief: hard rules, document map, working rules
2. [CONVENTIONS.md](CONVENTIONS.md) — engineering conventions
3. `.claude/docs/` — the full requirements/architecture document set (start
   with `AoB_requirements.md`)

## Repo shape

Modular monolith + two satellite services (ADR A-01). See CONVENTIONS.md §1
for the directory layout and port map.

| Workspace | What it is |
|---|---|
| `apps/core` | NestJS modular monolith — modules M1–M8, M12–M14 |
| `apps/rules` | s 65C Rules & Conformance service + public tester (zero PII) ⚠ human-authored |
| `apps/vault` | Evidence Vault — append-only, immudb, anchoring ⚠ human-authored |
| `apps/web` | Next.js console / portal / tester UI, and the waiting-room kiosk at `/kiosk` |
| `apps/connector` | Site-installed PMS connector — mock adapter until D-01 resolves |
| `packages/domain` | Pure TS domain model + hard-rule guards + named hard-rule tests |
| `packages/contracts` | FR-9.1 PMS adapter interface; rules + vault service contracts |

## Getting started

```bash
npm install                 # once, at the root — never inside a workspace
npm run test                # unit tests incl. the named hard-rule tests
npm run typecheck
docker compose up -d        # postgres / redis / immudb / mailhog (ports 21020+)
```

## Build status (20 Aug 2026, evening)

Working vertical slice, verified live and in CI:

- **Domain + contracts**: hard rules encoded with named tests; FR-9.1 adapter
  interface; vault event contract (closed union, no update/delete).
- **Vault service**: chain hashing/verification, dev in-memory store,
  property tests proving tamper evidence (immudb store + anchoring:
  `TODO(HUMAN)`, contract suite ready).
- **Rules service**: validate API + versioned registry; returns 501 until the
  human-authored C1–C14 rule set registers (34-test conformance suite ready
  and waiting).
- **Core**: Prisma with fail-closed RLS (non-superuser runtime role),
  HARD-01/02 DB triggers, agreements (draft → lock w/ render-and-hash → sign
  w/ full REQ-SIG-02 binding → stored), M3 verification (constant-time,
  types-only evidence, lockout), M2 capture (hashed single-use tokens,
  content-blind landing, channel dedup, expiry sweep), outbox → vault relay.
- **Web**: dev console driving the whole journey against live services.
- **Infra**: docker-compose full stack incl. containerised services
  (21001–21003); CI runs unit + Postgres-backed e2e on every push.

Next up: practice onboarding (M1.A) to replace dev-seed, the PDF/A render
pipeline, reconciliation queue (M7), and the human-authored zones.

**Open blockers (do not build around them — CLAUDE.md §5):**

- **D-01** Medtech write-back mechanism — adapter stays mocked behind FR-9.1.
- **D-11** Services Australia enduring registration — registrable-shaped data,
  feature-flagged, nothing speculative.

Phase order and gates: `.claude/docs/aob-build-plan.md`. Phase 0 (unblock)
comes before anything scales.
