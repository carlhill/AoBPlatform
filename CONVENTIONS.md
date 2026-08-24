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

**RLS exceptions are documented in the migration that creates the table**, in
full, with the reasoning. There are three: `vault_outbox` (a relay that spans
practices, carrying IDs only), the rules service (zero PII), and
`practitioners` (one human across the platform — scoping it would reinstate
the exact limitation it exists to remove). Any table without a
`practice_isolation` policy must carry that justification, or it is a bug.

**Authoring a migration that needs SQL Prisma cannot express** (RLS policies,
CHECK constraints, triggers, SECURITY DEFINER functions) — generate the
mechanical half, then append the hand-authored half under a marked divider:

```bash
npx prisma migrate diff --from-migrations apps/core/prisma/migrations --to-schema-datamodel apps/core/prisma/schema.prisma --shadow-database-url "$SHADOW_URL" --script > migration.sql
```

Then verify each constraint fires, in `psql`, using `SAVEPOINT` per case — a
single transaction aborts on the first error and every later check silently
reports "current transaction is aborted" rather than actually running.

**Windows: `prisma generate` fails with `EPERM ... query_engine-windows.dll.node`.**
Something (a dev server, a stray node process, OneDrive) holds the engine
open. Stopping the container is not enough. Rename the target out of the way
first — Windows permits renaming an open file even though it forbids
overwriting one — then generate and delete the old copy:

```bash
mv node_modules/.prisma/client/query_engine-windows.dll.node{,.old} && npx prisma generate --schema apps/core/prisma/schema.prisma && rm -f node_modules/.prisma/client/query_engine-windows.dll.node.old
```

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

## 8b. A practitioner identity is created by INVITATION only

**MANDATORY (Carl, 21 August 2026).** No self-registration path may ever create
a practitioner identity or lead to a passkey. A practitioner exists on this
platform because a **validated practice invited them**, and for no other reason.

Why it is worth the friction: to mint a fake practitioner an attacker must
first obtain a validated practice — which costs a real ACTIVE ABN, a name that
matches the register, a passed entitlement check and a named human's approval.
That turns identity creation from free into expensive, which is the whole game.

Three clarifications the rule needs, or it does the wrong thing:

1. **The practice INITIATES; the practitioner COMPLETES.** A practice may
   create the stub — AHPRA number, name, email — and send the invitation. It
   must never set the passkey, accept on their behalf, or complete their
   profile. A rule that let a practice create *and control* an identity in a
   doctor's name would build the impersonation REQ-PKI-01 exists to prevent.
2. **It governs identity CREATION, not affiliation.** A practitioner already on
   the platform joining a second practice already has a passkey; what they need
   there is an affiliation invitation, which is a different thing.
3. **An identity outlives its affiliations.** A practitioner whose last
   affiliation ends keeps their identity and their key — they are one human
   across the platform, and being between jobs is not a reason to cease
   existing.

**Owning the practice does not make you a practitioner here.** The same human
may be both, and the two are granted separately because they are verified by
*different evidence*: the admin role rests on the organisation approval (ABN,
name, address, entitlement), the practitioner role on AHPRA registration, a
provider number at a location, and a REQ-PKI-01 ceremony. Nobody checked AHPRA
during the organisation approval, so letting it confer a clinical identity
would be one attestation quietly standing in for another.

## 9a. A new field is not done until it reaches the screen

**When a field is added, take it the whole way in one pass: UI → API/DTO →
service → SQL function → column → migration → test.** Not one layer per pass.

This is a rule because it cost us. The applicant and manager contact fields
were added to the schema, the SQL function, the service and the DTO — and not
to the console. From the outside the feature simply did not exist, and Carl
had to say so. Every layer then had to be re-opened, re-read and re-reasoned
about, which costs far more than doing it once: the context has to be rebuilt,
the migration is already applied so it needs a follow-up, and the tests get
written twice.

Worse than the cost, a half-wired field **fails silently**. The DTO accepted
`managerName` for a while and the service dropped it on the floor: the API
returned 201, the operator saw success, and nothing was stored. A field that
accepts input and discards it is worse than a missing field.

Checklist before calling a field done:

- [ ] It can be entered or seen in the UI (or there is a written reason it cannot).
- [ ] The DTO validates it, and the service actually passes it on — trace the value, do not assume.
- [ ] The column exists, with any CHECK constraint that makes it meaningful.
- [ ] A test asserts it **round-trips**: entered, stored, and read back.
- [ ] Anything that lists or projects the record shows it, where the reader needs it.

### 9a(i). The same rule applies to a SURFACE, not only to a field

**A screen that reads a thing must also write it, or say plainly why it
cannot.** A read-only rendering of something the user is being told to act on
is the same defect as a half-wired field, wearing different clothes.

This cost us a second time, and the second time was more embarrassing than the
first. The reviewer dossier rendered the twelve-check catalogue, headed it
*"Record what you actually did"*, and had no way to record anything. The
strings for the recording form were written. The API endpoint existed. The
domain rules existed and were tested. The button did not. Carl opened the
screen, read the instruction, and asked how he was supposed to follow it.

A read-only surface fails in the same silent way a half-wired field does: it
**looks like the feature**. Nobody files a bug against a missing button as
readily as against an error, because the screen appears finished — so the gap
survives review, survives a demo, and is found by the person trying to do the
job.

The trap here is specific and worth naming: it is easiest to build the display
first, because the display is what you can see. The display then *looks* like
progress, and the write path gets deferred to a next pass that the checklist
above was written to prevent.

Checklist before calling a surface done:

- [ ] Every instruction the screen gives the user can actually be carried out **on that screen**.
- [ ] Every list of things-to-do has an action per row, or a written reason it is read-only.
- [ ] The write path is exercised against a running stack, not only typechecked.
- [ ] A failure from that write path is displayed in words the user can act on.

## 9c. Patch scripts: replace everything, then write everything

**A script that edits several files must perform every replacement first and
write all files at the end.** Never write file A and then assert against file B.

This has now bitten us twice, the same way both times. A patch script updated
`strings.ts`, wrote it, then failed an assertion against `OrgConsole.tsx`
because an anchor had been reformatted. The script aborted — but `strings.ts`
was already on disk. Re-running it applied the strings block a **second** time,
and the build failed with a wall of "object literal cannot have multiple
properties with the same name". The fix then costs more than the original edit,
because the file has to be de-duplicated by hand without eating the first copy.

The failure mode is worth naming: **a half-applied patch is not a failed patch,
it is a corrupted file that looks like a failed patch.** The script reports an
error, so it reads as "nothing happened", and the natural response — run it
again — is exactly the wrong one.

```python
# Right: every replacement, then every write.
a = io.open('a.ts').read()
b = io.open('b.ts').read()
assert anchor_a in a; a = a.replace(anchor_a, new_a, 1)
assert anchor_b in b; b = b.replace(anchor_b, new_b, 1)   # fails here → nothing written
io.open('a.ts', 'w').write(a)
io.open('b.ts', 'w').write(b)
```

Related: prefer anchors that survive formatting. `prisma format` and Prettier
rewrite comments and indentation, so anchor on a distinctive line of code, not
on a comment block or on leading whitespace.

## 9b. Client-side persistence is a claim, not a fact

**Anything persisted outside the server must be revalidated when it is loaded,
and cleared visibly when it is stale.** That covers `localStorage`,
`sessionStorage`, cookies, IndexedDB, URL parameters, and any remembered id in
a CLI or config file.

This is a rule because we got it wrong. The console persisted the selected
practice id so a reload would not strand the user. The practice was later
deleted, the browser still held the id, and the UI confidently displayed
**"Working on: XLEVELUP"** while every practice-scoped call silently returned
nothing. A dangling reference does not announce itself — it degrades into
*wrong but plausible*, which is worse than an error, because the user plans
around it.

- Verify persisted ids still exist before acting on them. Prefer validating
  against data the page already fetches over adding a round trip.
- When a stored value proves stale, **clear it and say so on screen**. Never
  drop it silently, and never keep displaying it.
- Persist the minimum needed to restore context (an id) — never a snapshot of
  server data, which drifts.
- Never persist tokens or credentials. `apps/web/app/auth.ts` keeps the access
  token in memory for exactly this reason, and that is not to be "improved".

## 9d. An email address under verification is a visible, live state

Carl's rule, verbatim: "need an auto-refresh and a tag to say the email
validation is pending or validated. We should do this everywhere we check
emails."

Any screen that shows an email address whose verification matters MUST show:

1. **A status tag beside the address.** `Verified` or `Confirmation pending` —
   a word, never colour alone, and never nothing. An address with no tag reads
   as fine, and "reads as fine" is precisely how an unverified address gets
   relied on. The unverified state is the one that costs something, so it is
   the one that must be loud.

2. **Auto-refresh while anything is pending.** The person who confirms is
   usually in ANOTHER tab or another building — the flip from pending to
   verified happens on the server while this screen sits still. Poll the
   page's own loader (15–30s) while and only while something on it is pending;
   stop when nothing is. A screen that needs a manual reload to notice teaches
   people the tag is stale, and a stale tag is worse than none.

The pieces exist — use them rather than re-cutting them:
`EmailStatusChip` (apps/web/app/EmailStatusChip.tsx) for the tag,
`usePendingRefresh` (same file) for the polling. Applies to: a practitioner's
primary (pending change) and backup, a practice's administrator address, the
applicant's address during onboarding, and every address verification added
later. A new email-bearing screen without these two is not done (see 9a).

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
