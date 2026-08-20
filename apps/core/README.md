# Core application

NestJS modular monolith hosting modules M1–M8 and M12–M14 (see
`.claude/docs/aob-functional-requirements.md` for what each module does).
Module boundaries are enforced in code: one Nest module per M-module, module
APIs only, **no cross-module table access** (CLAUDE.md §4).

Every module:

- validates agreement payloads through the Rules service pre-signature and at
  storage (contract: `@aobplatform/contracts` → `RulesEngineClient`);
- emits vault events through the outbox pattern (`VaultOutboxRow`) — a domain
  write and its vault event commit atomically or not at all (FR-11.2);
- respects Postgres RLS practice scoping; a cross-practice access test must
  fail closed (definition of done, CLAUDE.md §6);
- keeps every user-facing string in the string table (REQ-LANG-01) and PII out
  of logs.
