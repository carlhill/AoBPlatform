# REVIEW REQUIRED — two draft files in human-authored zones

### Raised 21 August 2026 · Owner: Carl · Status: **open**

Two files were agent-authored at Carl's explicit instruction inside zones the
build plan reserves for humans (CLAUDE.md §7: "the vault service, the s 65C
rules engine, and anything touching key management are written and reviewed by
humans"). Both carry `DRAFT` headers. Neither may be relied on for a real
agreement until this document is closed out.

**Why this file exists:** a wrong rule here is statutory exposure — signing a
non-compliant agreement is the criminal offence the product exists to prevent.
The conformance tests prove the code does what I *think* the rules say. They
cannot prove I read the regulation correctly. That is the review.

---

## File 1 — `apps/rules/src/rules/rule-set-2026-08.draft.ts`

The s 65C rule set: all fourteen rules C1–C14, each carrying the REQ-65C-01
table row and the regulation reference given in that table.

**Current exposure: NONE.** Registers only when `RULES_REGISTER_DRAFT_SET=true`
(set in the dev `.env`). Production default remains the honest 501.

**Verified:** passes all 34 conformance tests in `rule-set.contract.ts`, which
were written first, from the requirements table, before any implementation.

### Decisions needed

| # | Item | What I did | Why it needs you |
|---|---|---|---|
| **1** | **C5 service-date consistency** ⚠ **most important** | Validates the service date against the **agreement date** (pre ⇒ service on/after agreement; post ⇒ service on/before) | REQ-65C-01 says "pre ⇒ future/today, post ⇒ today/past" — i.e. relative to **now**, not to the agreement date. Mine is defensible for an agreement validated days after signing, but it is **not what the table literally says**. This is a deliberate deviation and needs an explicit yes/no. |
| **2** | **C2 future-date tolerance** = `AGREEMENT_DATE_FUTURE_TOLERANCE_DAYS = 200` | 200 days | The table says "not future-dated beyond tolerance" without fixing a number. I chose 200 so a 6-month Treatment Plan pre-agreement (REQ-PLAN-01) fits inside it. Is 200 right, or should the tolerance differ by agreement type? |
| **3** | **C7 MBS item format** = `/^\d{1,5}$/` | Numeric, 1–5 digits | A format *guess*. Not verified against the MBS item-number specification. |
| **4** | **`DEV_MAPPING`** | Five hand-typed basic service descriptions | The file says never ship a hand-typed mapping, and it means it. The real mapping is the quarterly XML/CSV ingest from MBS Online (1 Jan / 1 Mar / 1 Jul / 1 Nov, REQ-REG-03) with human-reviewed diff. **That job does not exist yet** — see "Separately" below. |
| **5** | **Block/warn split** | C11 (benefit amount) and C13 (verification) **warn**; everything else blocks | Taken straight from the REQ-65C-01 table. Confirm that is still the intended posture — particularly C13, since verification is our differentiator but not a legal requirement. |
| **6** | **Stage split** (added while building) | `pre_signature` defers C9 (signature present) and C12 (locked-before-signature); `storage` asserts everything | REQ-65C-01 runs the validator twice. A signature cannot exist at the pre-signature pass — it is the lock that pass gates. The split is logically forced, but the *boundary* is my judgement. |

### What to do

1. Read the file against `.claude/docs/aob-requirements.md` §3 (REQ-65C-01),
   rule by rule. Each rule's `push(...)` call names its table row.
2. Answer the six items above.
3. Give a verdict: **keep as-is** / **keep with marked fixes** / **rewrite yourself**.
   - If you mark fixes, I apply them and the conformance suite re-verifies
     automatically — no new test code needed.
   - If you want it gone, say so and I revert the file in one commit, leaving
     the interface and the 34 waiting tests exactly as they were.

---

## File 2 — `apps/vault/src/chain/immudb-chain-store.ts`

The durable chain store: evidence in immudb (client-side Merkle proof on every
write), locator index in Postgres.

**Current exposure: THIS ONE IS LIVE.** `CHAIN_STORE=immudb` is the default in
`docker-compose.yml` and the dev `.env`. Lower stakes than the rule set — it is
a storage choice, and the alternative (`CHAIN_STORE=memory`) loses all evidence
on restart — but you should know it is on. Reverting is one env var.

**Verified:** passes the same `chainStoreContractTests()` as the reference
store, against real immudb, in CI. Evidence confirmed to survive a vault
restart with the chain still verifying.

### Decisions needed

| # | Item | What I did | Why it needs you |
|---|---|---|---|
| **1** | **The architecture itself** | Index in Postgres, evidence in immudb; reads resolve keys via the index and only then `verifiedGet` | This is a workaround for a **client-library defect**: probing `immudb-node@1.1.1` showed that *any* missing-key lookup permanently poisons its local verification state (every later read resolves `undefined`). With an index, the store never looks up a key that might not exist. A library defect is now shaping the evidence design — you may prefer a different client, a different store, or a different accommodation. |
| **2** | **Crash-window ordering** | Evidence written first, index row second | A crash between them orphans an immudb entry (harmless, recoverable). The reverse order could index evidence that never landed (much worse). Confirm the direction. |
| **3** | **Single-writer assumption** | Appends serialise in-process only | A second vault instance would **fork the chain**. Needs a distributed claim before anything runs two replicas. Documented in the file, not enforced. |
| **4** | **Merkle state path** | `IMMUDB_STATE_PATH`, explicit, gitignored | The client otherwise persists proof state to a file literally named `root` in the process CWD; stale state silently breaks every verified operation. Worth knowing this exists and needs an ops story (backup? per-instance?). |
| **5** | **Server/client version pin** | immudb **1.1.0** ↔ `immudb-node@1.1.1` | The pair ReferralPlatform proved. Newer immudb servers exist; upgrading the pair together is a deliberate later step, not a default. |

### Explicitly NOT written (still yours, untouched)

- Per-entry signing with a segregated HSM key — **REQ-LOG-02**
- Hourly Merkle root + RFC 3161 external anchoring — **REQ-LOG-03 / REQ-VAULT-03**
  (this is the link that converts tamper-*evident* into non-*repudiable*; without
  it the chain proves nothing against **us**)
- S3 Object Lock / WORM artefact buckets — **REQ-VAULT-04 family**
- Key ceremony — **REQ-VAULT-06**

I stayed out of all of it: that is key management.

### What to do

1. Read the file, particularly the header comment explaining the index design.
2. Answer the five items above.
3. Same three-way verdict: keep / keep-with-fixes / revert to the empty
   implementation plus its contract suite.

---

## Separately — a real blocker neither file fixes

**The Basic Service Description ingest does not exist.** REQ-REG-03 requires
the mapping to be ingested from MBS Online as versioned content, quarterly,
with human-reviewed diff. Until that job exists, rule C6 validates against five
hand-typed strings, and no rule set — mine or yours — can be honest in
production. This is a Phase 0/1 job in its own right and is not blocked by the
review above.

---

## Sign-off

| File | Verdict | Reviewed by | Date |
|---|---|---|---|
| `rule-set-2026-08.draft.ts` | | | |
| `immudb-chain-store.ts` | | | |

When both rows are filled, delete the `DRAFT` headers, rename the rule-set file
without `.draft`, and close this document.
