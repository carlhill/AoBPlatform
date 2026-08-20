# CONVENTIONS.md

**Read CLAUDE.md first, then this, before writing any code in this repo.**
CLAUDE.md carries the regulatory hard rules and document map; this file carries
the engineering conventions that keep parallel contributors (human or agent)
consistent. Where there was a choice to make, it is already made below — raise
and change it here for everyone, or follow it. Most conventions are inherited
deliberately from ReferralPlatform (`C:\Users\carl\OneDrive\Documents\2026\ReferralPlatform\CONVENTIONS.md`),
where they were proven across a 26-agent build; deviations are noted.

---

## 1. Directory layout

```
AoBPlatform/
├── apps/
│   ├── core/        # NestJS modular monolith — modules M1–M8, M12–M14 (port 3001)
│   ├── rules/       # Rules & Conformance service — zero PII, public tester (port 3002)  ⚠ human-authored zone
│   ├── vault/       # Evidence Vault service — immudb, hash chain, anchoring (port 3003) ⚠ human-authored zone
│   ├── web/         # Next.js — console (M12), portal (M8), public tester UI (port 3100)
│   ├── kiosk/       # Expo/React Native tablet app (C2) — placeholder until Phase 1
│   └── connector/   # Site-installed Windows PMS connector — mock adapter until D-01
├── packages/
│   ├── domain/      # Pure TS domain model + structural hard-rule guards. Zero deps.
│   └── contracts/   # FR-9.1 adapter interface, rules + vault service contracts
├── infra/           # postgres init-schemas, keycloak realm (later), terraform (Phase 0)
├── docker-compose.yml
├── CLAUDE.md        # The build brief — regulatory rules win over everything here
└── CONVENTIONS.md   # This file
```

Unlike ReferralPlatform's 13 microservices, this is a **modular monolith + two
satellite services** (ADR A-01). New capability goes into a module inside
`apps/core` — not a new deployable — unless it has a genuine isolation need
recorded as an ADR.

## 2. Package manager: npm workspaces

One `npm install` at the root installs everything. Never `cd` into a workspace
and install there. Internal packages are referenced as
`"@aobplatform/domain": "*"` (npm resolves `*` to the local workspace). Root
scripts fan out via `--workspaces --if-present`; target one workspace with
`npm run test -w packages/domain`.

## 3. Version pins — deliberate, don't "fix"

| Pin | Why |
|---|---|
| TypeScript `^5.6.3` | ts-jest does not support TS 7.x |
| Jest `^29.7.0` repo-wide | jest-expo needs `@jest/globals ^29`; mixing 29/30 in one workspace tree causes hoisting collisions |
| NestJS `^11.1.0` | Proven template from ReferralPlatform |
| Prisma `^6.19.0` (when added) | Pre-v7 schema syntax; Prisma 7 removed it |
| Next `^16.3.0`, React `^19.1.0` | Matches the proven ReferralPlatform pins |

## 4. The NestJS service template

`apps/core` is the reference copy: `main.ts` (ValidationPipe global,
ConfigService port binding), thin `app.module.ts`, `health/` module with unit +
e2e smoke tests, `tsconfig`/`tsconfig.build`, `jest.config.js` +
`jest.e2e.config.js`, committed `.env.example`, gitignored `.env`. One Nest
module per bounded concept; DTOs as classes with class-validator decorators,
never plain interfaces.

## 5. Domain model and terminology

Every service/app imports domain shapes from `@aobplatform/domain` — never
redeclare them locally. IDs are branded types; passing the wrong ID is a
compile error.

Terminology is enforced (CLAUDE.md §3 + design decisions §0): **provider** not
GP, **service** not consult, **assignor** never conflated with patient
(`assignorIsPatient` is an explicit field). Reserved domain words (claim,
agreement, assignment, benefit, practice, service, register, notice, provider,
record) are never used in their ordinary English sense in identifiers, columns,
API fields or UI copy.

**There is no Medicare-number field anywhere in this codebase** — domain types,
DTOs, columns, logs, fixtures (HARD-03; ESLint enforces it). Fixtures use
obviously fake identities and never real Medicare-format numbers.

## 6. Database

One Postgres instance, one schema per deployable (`core`, `rules`, `vault`),
created by `infra/postgres/init-schemas.sql`. **Practice scoping is enforced
with row-level security at the database layer** — every feature's definition of
done includes a cross-practice access test that fails closed. Inside
`apps/core`, modules own their tables: no cross-module table access, module
APIs only. The vault's Postgres schema is bookkeeping only; evidence lives in
immudb. No role ever holds DELETE on evidence stores (rule 11).

ORM is Prisma (when persistence is added), migrations hand-reviewed and always
committed; never `prisma db push` outside local scratch.

## 7. Vault events: the outbox pattern is structural

Every write to an agreement/consent-relevant record inserts a
`VaultOutboxRow` (shape in `@aobplatform/contracts`) **in the same DB
transaction** as the domain write; a relay publishes rows to the vault service.
A direct vault call in a request handler is acceptable only for genuinely
non-consent events. When unsure, use the outbox.

Event types are a closed union (`VAULT_EVENT_TYPES`). To add one, extend the
union in contracts AND the vault service's runtime whitelist — **never cast**.
(ReferralPlatform lesson: casts silenced the compiler while the service
rejected events with 400, and evidence went unrecorded for months.)

## 8. Docker

Every Node service Dockerfile uses the **monorepo root** as build context (it
needs `packages/*`). Copy `package.json` files before source so npm install
caches correctly; run `prisma:generate` in the Dockerfile when the service has
that script; healthchecks probe `127.0.0.1`, never `localhost`. Host ports live
in the 21000+ range (see docker-compose.yml header, including the Windows
stale-`wslrelay.exe` port-conflict note).

## 9. Testing

- Services: unit `src/**/*.spec.ts`, e2e `test/**/*.e2e-spec.ts`
  (@nestjs/testing + supertest). Packages: `src/**/*.test.ts`.
- Every service ships a passing `GET /health` smoke test both ways — the
  baseline bar.
- **Every hard rule a feature touches gets a named test** (e.g.
  `medicare_number_rejected_as_identifier`) — see
  `packages/domain/src/hard-rules.test.ts` for the pattern and CLAUDE.md §6
  for the obligation. Do not rename these tests; the names are traceability.
- Playwright for web flows, Maestro for kiosk — added when the first real user
  flow exists. k6 priority scenarios: the 8–10 am check-in burst and the 89AA
  dispatch batch.

## 10. Lint/format

One root ESLint flat config, zero-warning tolerance (`--max-warnings=0`);
Prettier at the root. The `no-restricted-syntax` Medicare-number rule is
load-bearing — do not disable it outside the named test files.

## 11. Human-authored zones (build-plan policy — not negotiable)

The **s 65C rule implementations** (`apps/rules`), the **vault chain /
anchoring / key management** (`apps/vault`), and anything touching key
management are written and reviewed by humans. Agents assist (tests, review,
refactors) but do not author them wholesale. Never invent regulatory facts —
section numbers, dates and thresholds come from `.claude/docs/` or they don't
go in.

## 12. Ask Carl before

Adding a dependency with runtime network access; changing an ADR; touching auth
flows; anything that sends a real SMS/email (dev uses the sandbox gateway).
Conventional commits; one module per PR where feasible; CI green before merge.
