# GovAudit — a government audit of a practice's bulk-billing consent records
### v0.1 · 5 September 2026 · Plan and solution. Owner: Carl. Status: proposed, not yet built.

## 0. The requirement, as stated (Carl, 5 Sep 2026)

> The Gov may want to do an audit on a practice. We need to determine the key data elements the gov will need and create an extract for a given period. We need a full workflow for the Gov to make an AuditRequest on a Practice. This has to be recorded in a GovAuditQueue. Then an email will be sent to the Practice to AcceptAudit or RejectAudit with a reason. Either way an email will be sent to the Gov. If the Practice Accepts, a csv file or files will be exported for the given period and sent to a shared SFTP folder for download. Both the Gov and Practice will receive an email to this effect. All downloads must be tracked and fully audited. No uploads allowed. The data will be available for 30 days before download access is removed. For past downloads (kept for only two years) the Gov or the Practice can request permission to download by email to the Platform. So we need a full application for this.

This document turns that into a module (**M15 — Government Audit**), a state machine, a data extract, the infrastructure, the tests, and the decisions Carl has to make before it is built. Nothing here changes any hard rule in CLAUDE.md; several of them shape it.

---

## 1. What the product already has that this reuses

| Already built | Used for |
|---|---|
| Evidence Vault: append-only events, hash chain, RFC 3161 anchoring, **auditor bundle export + offline verifier** (REQ-VAULT-07, FR-11.1) | The extract IS an auditor bundle: the government can verify every record independently of us |
| One deterministic render path; PDF/A artefacts hashed at render (hard rule 13) | The artefacts in the extract are the signed documents, byte-identical, with their hashes |
| Outbox pattern: a domain write and its vault event commit together or not at all (hard rule 11) | Every state change in this workflow is evidenced or does not happen |
| Messaging module, four-audience correspondence log, sandbox gateway in dev | Every email in the workflow; every send is logged as a state, never a body |
| Review tasks (high-stakes kinds, practice-scoped, staff actor required) | The practice's Accept/Reject is a review task with a reason |
| Practice console with passkey-only staff auth (hard rule 15); platform console | The practice acts from its console; the platform oversees from its own |
| RLS practice scoping at the database (ADR) | An extract can only ever contain one practice's records, by construction |
| Retention module (two years from the related claim date; destroy or de-identify) | The extract's own two-year life aligns to the record's |
| Verification logs store identifier TYPES and outcomes, never values (hard rule 9) | The extract carries the same: how the patient was verified, never what they said |

The new work is the workflow, the government audience, the extract assembly, and the SFTP delivery with download auditing.

---

## 2. Actors and trust

| Actor | Who | How they are known to us |
|---|---|---|
| **Government auditor** | A named officer of the auditing agency | A registered **government organisation** on the platform (legal name, ABN checked against the register, agency domain), with named officers who sign in with **passkeys** (rule 15 extends to every admin-class user). Registration is done by the platform operator on documentary evidence, never self-service |
| **Practice administrator** | The practice's own administrator(s) | Existing console users |
| **Platform operator** | Us | Existing platform console |
| **Patient** | Whose records are in the extract | Not an actor in the workflow, but sees the disclosure in their portal's "Who has looked" timeline (C8, FR-8.2) |

**The disclosure decision is the practice's, never ours.** The practice is the entity that collected the record and the entity the Privacy Act binds for the disclosure; we are its processor. The platform records the request, carries the messages, assembles the extract and audits the downloads, but it never releases a practice's records on a government request without the practice's Accept. A compulsory process (a notice served on the platform itself) is handled by Carl and counsel outside this workflow, through the existing legal-hold path on the vault — it is deliberately not a button.

**How the practice knows the request is genuine.** The request arrives in the practice's console, not only by email. The email says "an audit request is waiting in your console" and links to it; the request itself shows the registered agency, the named officer, the agency's reference number and the period. No action is ever taken from a bare link in an email (the anti-phishing rule the portal follows, REQ-PORT-06).

---

## 3. The workflow — states and who moves them

```
                 gov officer            practice admin              platform (automatic)          platform operator
 requested  ──►  practice_notified ──►  accepted ──► extracting ──► available (30 days) ──► access_expired ──► archived (to 2 yrs) ──► destroyed
                                    └►  rejected (reason) ─────────────────────────────────────────────────────────────────────────►  closed
                                                                                          └► reaccess_requested ──► reaccess_granted (new 30-day window) │ reaccess_denied
```

| State | Entered by | What happens | Emails |
|---|---|---|---|
| `requested` | Government officer submits `AuditRequest` (practice, period, scope, agency reference, purpose text) | Row in `gov_audit_requests` (the **GovAuditQueue**); vault event `gov_audit.requested` | — |
| `practice_notified` | Automatic, same transaction | Review task `gov_audit_request` raised for the practice's administrators; email to every practice administrator: "An audit request from <agency> is waiting in your console" + deep link | Practice |
| `accepted` | Practice administrator, from the console, passkey-signed-in, with an optional note | Vault event `gov_audit.accepted` naming the administrator; extraction job queued | Gov: "The practice has accepted; your extract is being prepared" |
| `rejected` | Practice administrator, **reason required** (from a versioned reason list + free text) | Vault event `gov_audit.rejected` with the reason key (free text stored on the row, not in the event); request closed | Gov: "The practice has declined, reason: …". Practice: confirmation |
| `extracting` | Automatic | The extract (§4) is assembled inside RLS for that practice only, hashed, manifest written, uploaded to the request's SFTP folder | — |
| `available` | Automatic on upload | `availableUntil = now + 30 days`; SFTP access provisioned (read-only, this folder only); vault event `gov_audit.extract_available` with the manifest hash | Gov AND Practice: "The extract for <period> is available until <date>. Files: …, manifest hash: …" |
| `access_expired` | Scheduler at `availableUntil` | SFTP access removed; files stay in the archive bucket; vault event | Gov and Practice: "Download access has ended" |
| `archived` | Same moment | Files retained **two years** from `availableUntil` under Object Lock; then `destroyed` (crypto-shred + tombstone, as the vault does) | — |
| `reaccess_requested` | Gov officer or practice administrator, from their console (the "email to the Platform" in the requirement becomes a request the platform console shows, with an email notification to the operator — so it is tracked, not a mailbox) | Vault event | Platform operator |
| `reaccess_granted` / `reaccess_denied` | Platform operator, reason required | A new 30-day window is provisioned for the same immutable files; or denied with the reason sent back | Requester (and the other party on grant) |

**Every download is an event.** Each file fetched over SFTP is logged with: request id, file name, byte count, the SFTP user, source IP, time. Written to the vault as `gov_audit.file_downloaded`. Visible to the practice (its console), the government (its console), and the platform. The patient's portal shows "Your practice disclosed records to <agency> under an audit on <date>" in "Who has looked" — that is the honest answer to "what do you do with my data".

**No uploads, structurally.** The SFTP identity's policy allows `GetObject`/`ListBucket` on its own prefix and denies everything else. There is no write path at all, so nothing needs to detect one.

**Rule 8 holds.** Nothing here touches capture, signing or billing; an audit in any state never blocks a patient being seen.

---

## 4. The extract — what the government gets

### 4.1 Principle
The extract is the **auditor bundle** the vault already knows how to produce (REQ-VAULT-07), sliced to one practice and one period, plus CSVs that make it readable without a tool. Data minimisation applies: what an auditor needs to establish that valid assignments of benefit exist for the services claimed, and nothing else. **The exact statutory data elements come from the s 65C data set in `aob-requirements.md`, not from this document** — the list below is the working proposal for Carl to confirm against it (CLAUDE.md §7: never invent regulatory facts).

### 4.2 Files (one folder per request: `<agency>/<practice-abn>/<request-id>/`)

| File | One row per | Columns (proposed) |
|---|---|---|
| `README.txt` | — | What this is, the period, how the period was defined (§6 Q2), how to verify the hashes with the offline verifier, our contact |
| `manifest.json` | file | SHA-256 of every file in the folder, the vault chain head at extraction, the RFC 3161 anchor, the rule-set and mapping versions in force, extract generated-at, signed by the platform |
| `agreements.csv` | agreement | agreement id · type (episodic_pre / episodic_post / enduring / treatment_plan) · status · **provider number** and provider name · service date · basic service description (D6a) and mapping version · rule-set version · capture channel · signature timestamp (UTC and AEST) · signature method (drawn / tap-to-approve / verbal-with-flag until 30 Jun 2027) · assignor is patient (Y/N) · assignor relationship key · supersedes agreement id · artefact file name · artefact SHA-256 |
| `patients.csv` | patient appearing in agreements.csv | patient id (ours) · **practice's patient record number** · family name · given names · date of birth · address (as held at the time) · IHI if held. **No Medicare card number — we do not hold one (hard rule 1)**; see §6 Q3 for how the auditor reconciles |
| `verification.csv` | verification event | agreement id · identifier TYPES challenged · outcome · method (kiosk self / staff-verified / remote link) · staff principal id where staff-verified · timestamp. **Never a stated value (hard rule 9)** |
| `events.csv` | vault event touching those agreements | event id · type · timestamp · hash · previous hash — the chain the verifier checks |
| `notices-89aa.csv` | 89AA notice sent in the period (if the agency asks for them) | notice id · date · provider · patient id · benefit amount — the one place an amount appears, and only in this file |
| `artefacts/` | signed agreement | The PDF/A as signed, file name = agreement id, byte-identical to the vault copy |

**Not included, ever:** anything clinical (CLAUDE.md §8), message bodies, staff names beyond principal ids, identifier values stated at verification, records of any other practice, drafts never signed (unless the agency's scope explicitly asks for attempted-but-unsigned, which is a §6 decision).

### 4.3 Assembly rules
- Runs under `prisma.withPractice(practiceId)` — RLS is the floor; a cross-practice row is impossible, and the test `gov_audit_extract_never_crosses_a_practice` proves it fails closed.
- Deterministic: the same request assembled twice yields byte-identical CSVs (sorted, fixed column order, UTC ISO timestamps) so the manifest hash is reproducible — the same discipline as the render path (hard rule 13).
- Artefacts are copied from the vault store with their hash re-verified on the way out; a mismatch aborts the extract and raises a platform incident, it never ships a file that does not verify.
- Assembled once, stored immutably (S3 Object Lock, compliance mode, two years). Re-access serves the same bytes.
- Size: CSVs are small; artefacts dominate. A year of a large practice is tens of thousands of PDFs — assemble as a zip per month plus the CSVs, and stream, never buffer.

---

## 5. Solution architecture

### 5.1 Module and data
- **`apps/core/src/gov-audit/`** (M15). Tables (all with RLS on `practiceId` where a practice is the subject; government-org scoping on the requester side):
  - `gov_organisations` — the registered agencies (legal name, ABN, domain, status). Operator-managed.
  - `gov_officers` — named officers, Keycloak principal id, organisation, active flag.
  - `gov_audit_requests` — the **GovAuditQueue**: practice, organisation, officer, agency reference, period start/end and **period basis** (§6 Q2), scope flags (include 89AA notices? include unsigned attempts?), state, timestamps per transition, `availableUntil`, `archiveUntil`, decision note, rejection reason key + text.
  - `gov_audit_extracts` — one per assembled extract: manifest hash, chain head, anchor id, file list with sizes and hashes, storage prefix.
  - `gov_audit_downloads` — one per file download: extract, file, bytes, sftp user, source IP, at. Fed from the transfer service's logs (§5.3), reconciled every few minutes.
  - `gov_audit_reaccess_requests` — requester (gov/practice), reason, operator decision, window granted.
- Vault events (all through the outbox): `gov_audit.requested`, `.practice_notified`, `.accepted`, `.rejected`, `.extract_generated`, `.extract_available`, `.file_downloaded`, `.access_expired`, `.archived`, `.destroyed`, `.reaccess_requested`, `.reaccess_granted`, `.reaccess_denied`. No PII in any of them; reason keys not text.
- Content files (option lists are content, CLAUDE.md §7): `gov-audit-rejection-reasons.json`, `gov-audit-scopes.json`, `gov-audit-period-bases.json`.

### 5.2 Surfaces
| Route | Audience | Purpose |
|---|---|---|
| `/gov` (new audience `gov_auditor`, Keycloak client `gov`, passkeys mandatory) | Government officers | Make a request (pick practice by ABN/name from a search that returns only practices on the platform; period; scope; reference; purpose), see their queue and each request's state, see downloads made under their organisation, request re-access, download the manifest and the SFTP connection details |
| `/practice/audits` | Practice administrators | The queue of requests against this practice; Accept / Reject with reason; see every download the agency has made; request re-access to their own past extract |
| `/platform/audits` | Platform operator | Every request in every state; register agencies and officers; grant/deny re-access with reason; incidents (a failed extract, a hash mismatch); never Accept on a practice's behalf |
| Patient portal "Who has looked" | Patient | "Disclosed to <agency> under an audit, <date>" — from the events, no new surface |

All copy in the string table; UK/AU spelling; never "certified/approved/accredited"; every blocked state carries its reason and a link to where it is fixed.

### 5.3 Delivery — SFTP without a server we run
- **AWS Transfer Family (SFTP) in ap-southeast-2** with an S3 backend, Terraform-managed, account-per-environment as the rest of the platform.
- One S3 prefix per request; **one SFTP user per request per window**, SSH-key authenticated (the officer registers a public key in `/gov`; no passwords), scoped by IAM session policy to `GetObject`/`ListBucket` on that prefix only. `PutObject`, `DeleteObject` and everything else are denied — **no uploads by policy, not by detection**.
- Access windows are the user's existence: created at `available`, deleted at `access_expired`; re-access creates a fresh user. Nothing to "revoke" — the credential simply stops existing.
- Files: SSE-KMS with a key per environment; **optionally** also encrypted to the agency's registered PGP public key so even a mis-delivered file is unreadable (§6 Q6).
- Download auditing: Transfer Family structured logs → CloudWatch → a small consumer that writes `gov_audit_downloads` rows and vault events. Reconciled against S3 server access logs so a missed log line is caught.
- Bucket: Object Lock (compliance) for the two-year archive; lifecycle deletes at expiry; deletion emits `gov_audit.destroyed`.
- The practice's own copy: the same files are downloadable from `/practice/audits` for the same 30 days (they are the practice's records), logged the same way.

### 5.4 Emails
Through the existing messaging module and correspondence log. Templates (content, human-reviewed before go-live): `gov_audit_request_received` (practice), `gov_audit_accepted` (gov), `gov_audit_rejected` (gov + practice), `gov_audit_extract_available` (gov + practice, with manifest hash and expiry), `gov_audit_access_expired` (both), `gov_audit_reaccess_requested` (operator), `gov_audit_reaccess_decided` (requester, and both on grant). Every email says what to do next and where, and none contains a file, a credential or a bare action link.

---

## 6. Decisions Carl has to make before the build (and who else is needed)

| # | Question | Why it matters | Proposed default |
|---|---|---|---|
| Q1 | **Legal basis.** Under which power does the agency request these records, and is the practice free to refuse? | Decides whether "Reject" is a real choice or a recorded objection, and what the emails may say. Must come from the requirements docs / counsel — not inferred | Build Reject as a real choice with a reason; counsel confirms the notice type |
| Q2 | **What defines "the period"** — service date, signature date, or claim date? | The three differ for post-service and enduring agreements | Service date for episodic; for enduring, agreements active at any point in the period; stated in README |
| Q3 | **How the auditor reconciles our records against claims without a Medicare number.** We do not hold one (hard rule 1) | The agency matches claims by Medicare number; we can offer provider number + service date + practice patient record number + name/DOB | Confirm with the agency what key they will accept; if they insist on Medicare numbers, the practice supplies that mapping from its PMS, not us |
| Q4 | **Scope options** the officer may tick: 89AA notices; unsigned/attempted agreements; verification events | Each widens disclosure | Signed agreements + verification by default; others opt-in and visible to the practice before it accepts |
| Q5 | **Do government officers get a portal in v1**, or is v1 email-plus-SFTP with the platform operator entering requests on the agency's behalf? | The `/gov` audience with passkeys is the largest single piece | v1: portal for officers (the request must be authenticated and attributable; a mailbox cannot be) |
| Q6 | **Encrypt extracts to the agency's PGP key** in addition to S3 encryption? | Protects a mis-delivered file; costs the agency a key exchange | Offer, default off, per agency |
| Q7 | **Who at the platform grants re-access**, and does the *other* party get a say? | The requirement says "request permission by email to the Platform"; the practice may want a veto on a government re-access to its records | Operator grants; the practice is notified and can object within 48 h before the window opens |
| Q8 | **Two-year archive** — from availability, or aligned to the underlying record's retention (two years from the related claim)? | The extract may outlive the records it copied | From `availableUntil`, but destroyed earlier if every underlying record has been destroyed |
| Q9 | **Notify patients** individually of a disclosure, or only show it in the portal? | APP obligations vs. alarming thousands of patients | Portal timeline only, plus the practice's collection notice naming audits as a disclosure |

---

## 7. Build plan (after Q1–Q5 are answered)

| Phase | Scope | Est. |
|---|---|---|
| **P1 — request → decision → extract** | M15 module, GovAuditQueue, practice `/practice/audits` Accept/Reject, emails, extract assembly (CSVs + manifest + artefacts) to S3 with hashes, `/platform/audits` oversight, vault events, RLS and named tests. Officer requests entered by the operator (Q5 fallback) | 5 agent-days + 1 human day (extract columns confirmed against the s 65C data set) |
| **P2 — delivery and download audit** | Transfer Family + Terraform, per-request users and windows, download log consumer, `access_expired` scheduler, Object Lock archive, both-party emails | 3 agent-days + 1 infra day |
| **P3 — government portal** | `gov_auditor` audience, Keycloak client with passkeys, agency and officer registration, request form, SSH key registration, download and re-access views | 4 agent-days |
| **P4 — re-access and archive lifecycle** | Re-access requests and operator decisions, new windows on immutable files, two-year destruction with tombstones, patient portal timeline entry | 2 agent-days |
| **Review** | Legal review of emails and README; pen-test scope extended to Transfer Family; incident runbook entry for a failed extract or hash mismatch | Carl + counsel + vendor |

Roughly 14 agent-days plus review. Not on the April 2027 GA critical path unless a customer or an agency asks for it before then; it belongs in Phase 4 of GA-PLAN unless Carl moves it.

## 8. Named tests (the ones that encode the rules)

`gov_audit_extract_never_crosses_a_practice` · `gov_audit_extract_carries_no_medicare_number` · `gov_audit_extract_carries_identifier_types_not_values` · `gov_audit_extract_is_byte_identical_on_reassembly` · `gov_audit_artefact_hash_mismatch_aborts_the_extract` · `gov_audit_nothing_ships_without_practice_accept` · `gov_audit_reject_requires_a_reason` · `gov_audit_sftp_policy_denies_every_write` · `gov_audit_access_ends_at_thirty_days` · `gov_audit_every_download_is_an_event` · `gov_audit_reaccess_serves_the_same_bytes` · `gov_audit_amount_appears_only_in_the_89aa_file` · `gov_audit_platform_cannot_accept_for_a_practice` · `gov_audit_never_blocks_capture` (rule 8).

## 9. Out of scope
Uploads of any kind; the platform changing a record at an agency's instruction; agencies seeing across practices; clinical data; any automated response to a compulsory notice served on the platform (human process).

---

## Change log
| Version | Date | Change |
|---|---|---|
| 0.1 | 5 Sep 2026 | First plan and solution from Carl's requirement. Open questions Q1–Q9. |
