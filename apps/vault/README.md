# Evidence Vault service (M11)

Append-only, tamper-evident event log (REQ-VAULT-01) wrapping immudb; artefact
hash binding (REQ-VAULT-02); server-authoritative time + RFC 3161 external
anchoring (REQ-VAULT-03); per-patient envelope encryption and crypto-shredding
with legal hold (REQ-VAULT-05); auditor bundle export + offline verifier
(REQ-VAULT-07); hash verification API (REQ-VAULT-09).

**No update or delete endpoint exists on this service — ever** (rule 11,
ADR A-02). Domain writes and vault events commit via the outbox pattern
(FR-11.2): one without the other must be structurally impossible.

> ⚠ **Human-authored zone.** Per CLAUDE.md §7 and the build plan, the chain,
> anchoring, and key-management code here is written and reviewed by humans.
> Claude/agents may write tests (including chain-verifier property tests),
> review, and refactor — not author these wholesale.
