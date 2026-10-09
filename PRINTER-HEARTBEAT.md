# PRINTER-HEARTBEAT.md: the AOBPRINTER heartbeat and its console page

**Status:** planned 10 Oct 2026. The decisions below were agreed by Carl on
10 Oct 2026 ("All good") and are recorded as **D-2026-10-10-02**. Not yet built.
**Closes:** items 1–3 of the TODO.md entry "AOBPRINTER state moves to SQLite"
(the heartbeat, the console page, and the case where a return was filed but
never recorded as confirmed).

---

## The 15 decisions

| # | Decision | Agreed | Why |
|---|---|---|---|
| 1 | Heartbeat interval | **Every 60 s**, configurable from 15 s to 10 min (outside that range the program refuses to start). First beat 5 s after start. | Frequent enough that the console is current; light enough that a practice's link does not notice it. |
| 2 | Stale / offline | **Stale** after 3 missed beats *at the interval the host reported*; **offline** after 15 min. The server decides; the console only renders it. | Same principle as the tablet heartbeat (`deviceHeartbeatIsStale`). The host is meant to be always on, so offline overnight is a real finding. |
| 3 | Alert on silence | A **5-minute server sweep** logs `ALERT` once when a host goes offline, and once when it comes back. Log only, no vault event. | A console page only helps someone looking at it; silence is the alarm that matters. |
| 4 | Audit log no longer matches | **One vault event on the transition** into `regressed` (`aobprinter.chain_regressed`), plus an `ALERT` log and a console flag. The flag stays until someone re-baselines. | Rare, and it is evidence about evidence. |
| 5 | External anchor | `aobprinter.chain_anchored` written to the vault **at most hourly** while the chain is consistent and has advanced. | Otherwise the "external anchor" is a Postgres row a DBA can edit. |
| 6 | New audit log for a practice that already has one | Treated as the regression **`chain_replaced`** until re-baselined. **Two hosts reporting at once** is logged as an ALERT and shown on the console, with no vault event. | A full rewrite changes the hash of event 1. Calling that "a new host" would defeat the anchor. Two hosts breaks the "one AOBPRINTER per practice" rule (D-2026-09-28-04 amendment). |
| 7 | Who may re-baseline | **Platform operator only**: `PLATFORM_ADMIN`, the existing `@FreshSecondFactor`, a reason code from a fixed list (`reinstalled`, `database_restored`, `investigated`), and an `aobprinter.chain_rebaselined` vault event. | A practice may not verify its own evidence. Reuses existing guards; no auth-flow change. |
| 8 | "Processed by AoB" on the host | Stored as **audit events** (`print.processed`, `print.processing_failed`, `print.not_on_platform`), not a new stage or column. **No SQLite schema bump.** | The stage model of D-2026-09-29-01 stays as decided, and rolling the host back to an earlier build still opens its database. |
| 9 | Which prints the heartbeat asks about | Prints in `sent` with no recorded platform outcome, sent in the **last 14 days**, at most **100 per beat**. Returns in `filed`, at most 100. | Bounded payload; older ones are visible on the platform anyway. |
| 10 | Console audience | **Practice admin** sees their own host at `/practice/aobprinter-host`. **Platform admin** sees the same page for any practice, plus an overview of every host at `/platform/aobprinter-hosts`, worst first. | "Each practice's host" reads as the overview. |
| 11 | Existing installs that upgrade | Heartbeat **on by default**. | Unlike collection, it writes nothing into a PMS folder. |
| 12 | Transport | **Accept `x-practice-id` header auth** (the same as print ingest) until mTLS lands. A forged beat could raise a false regression or hide a silent host; recorded on the transport TODO. | Same posture as ingest today. |
| 13 | Links for print exceptions | No platform page shows a print job, so a print exception shows its **reason code** and the **first 8 characters of its hash**, and says the print is held on the host. Return exceptions link to `/practice/patients/{patientId}`. An agreement anchor on the patient page is deferred. | §7c: link to the exact item where one exists; never invent one. |
| 14 | The host's own check fails | Reported in the heartbeat (`localCheck`) and logged once at error level; **no local audit event**. | Appending to a chain already known to be broken muddies the forensics. |
| 15 | Small items | Warn when the host's clock is **more than 5 min** out. The sequence column is a 32-bit `Int` (2.1 billion events per host). | Skew breaks every timestamp comparison; `Int` is ample. |

**Testing posture (Carl, 10 Oct):** targeted tests at each step, and **one
full-suite run at the end**, before the reviewer. The suite runs against
`aobplatform_test`, never `aobplatform`.

---

## What the code already settles

- **The head reader exists; the verifier does not scale.** `store.ts`
  `auditHead()` already exists. `verifyAuditChain()` loads every event and walks
  the whole chain synchronously, which would block the claim loop every minute
  (hard rule 8). Verification becomes incremental (section 2).
- **Auth is `x-practice-id` + `@PracticeScoped()`**, the same as ingest and
  collection. The heartbeat is `POST /inbound/print-jobs/heartbeat`. It inherits
  the `db4` surface by prefix, so a `standard`-profile practice gets
  `403 practice_surface_not_in_use`.
- **Nothing reads `x-aobprinter-version`** today; the heartbeat body becomes
  where versions are recorded.
- **There is a precedent:** the tablet heartbeat (`devices.service.ts`
  `recordHeartbeat`, `KioskHeartbeatDto`, `deviceHeartbeatIsStale`,
  `deviceSeenAgo`). Copy its shape.
- **Route shadowing:** `InboundPrintJobsController` has `GET :id`, so the
  console read goes on a new base, `/aobprinter-hosts`. The heartbeat POST sits
  in `InboundPrintJobsController` above `:id` (wow §2 item 2).

## 1. Contract types: `packages/contracts/src/aobprinter-heartbeat.ts`

Exported from `index.ts`. Every field is named, nothing is spread, and there is
no free text.

```ts
export const AOBPRINTER_PRINT_STAGES = ['received','parse_exception','queued','sent','send_exception'] as const;
export const AOBPRINTER_RETURN_STAGES = ['received','received_exception','filed','filing_exception','confirmed'] as const;

export interface AobPrinterChainPoint { readonly seq: number; readonly hash: string | null; }

export interface AobPrinterStageCounts {
  readonly prints: Readonly<Record<AobPrinterPrintStage, number>>;
  readonly returns: Readonly<Record<AobPrinterReturnStage, number>>;
  readonly openExceptions: { readonly parse: number; readonly send: number; readonly received: number; readonly filing: number };
  readonly oldestQueuedAt: string | null;
  readonly oldestFiledUnconfirmedAt: string | null;
  readonly staleQueued: number;
  readonly gapsLast24h: number;
}

/** Ids and codes only. Never a form reference, chart number, path or note. */
export interface AobPrinterOpenException {
  readonly direction: 'out' | 'in';
  readonly stage: 'parse_exception' | 'send_exception' | 'received_exception' | 'filing_exception';
  readonly reason: string;            // a code; shown as the code if unmapped
  readonly since: string;
  readonly sourceSha256?: string;     // out
  readonly agreementId?: string;      // in
}

export type AobPrinterLocalCheck =
  | { readonly ok: true; readonly verifiedThroughSeq: number }
  | { readonly ok: false; readonly brokenAtSeq: number; readonly why: 'link' | 'content' };

export interface AobPrinterHeartbeat {
  readonly chainId: string;           // hash of audit event seq 1
  readonly head: AobPrinterChainPoint;
  readonly atAnchor?: AobPrinterChainPoint;   // hash at the seq the platform named last time
  readonly localCheck: AobPrinterLocalCheck;
  readonly counts: AobPrinterStageCounts;
  readonly openExceptions: readonly AobPrinterOpenException[];   // oldest first, max 25
  readonly printerVersion: string;
  readonly templateVersion: string;
  readonly schemaVersion: number;
  readonly runtimeVersion: string;    // process.version
  readonly startedAt: string;
  readonly sentAt: string;            // host clock, for skew
  readonly intervalMs: number;
  readonly queueCount: number;
  readonly collecting: boolean;
  readonly retentionEnabled: boolean;
  readonly awaitingOutcome: readonly string[];                    // decision 9
  readonly filedUnconfirmed: readonly { readonly agreementId: string; readonly sha256: string }[];
}

export const AOBPRINTER_CHAIN_STATUSES = ['unverified','consistent','regressed'] as const;
export const AOBPRINTER_CHAIN_REGRESSIONS = ['went_backwards','same_seq_different_hash','anchor_mismatch','chain_replaced'] as const;

export interface AobPrinterHeartbeatReply {
  readonly receivedAt: string;
  readonly chain: { readonly status: AobPrinterChainStatus; readonly anchorSeq: number };
  readonly jobs: readonly { sourceSha256: string; state: 'waiting' | 'done' | 'dead' | 'unknown'; placed: boolean | null; reason: Db4PlacementReason | null; agreementId: string | null }[];
  readonly returns: readonly { agreementId: string; writtenBack: boolean; sha256Matches: boolean; listed: boolean }[];
}
```

**Console types (same file):**
- `AobPrinterHostRow`: the stored fields plus:
  - server-computed `liveness`;
  - `chain { status, regression {kind, at, expected, received} | null, anchorSeq, anchorVerifiedAt }`;
  - `clockSkewMs`;
  - `exceptions`, with `patientId?` resolved on the server;
  - `filedUnconfirmed`, with the platform's verdict and `patientId`.
- `AobPrinterHostsView = { hosts; secondHostReporting }`.

**Vault event types:** add `aobprinter.chain_anchored`,
`aobprinter.chain_regressed` and `aobprinter.chain_rebaselined` to
`VAULT_EVENT_TYPES`. The vault container must then be rebuilt (wow §2 item 8).

## 2. The AOBPRINTER side (`apps/aobprinter` only)

| File | Change |
|---|---|
| `src/heartbeat.ts` (new) | `class Heartbeat`. `beat(signal)` never throws. It holds the anchor seq, the failure-log state and the verifier frontier in memory. `buildHeartbeat()` names every field. `applyReply()` records outcomes. |
| `src/heartbeat-client.ts` (new) | Same shape as `collection-client.ts`. URL `${ingest}/heartbeat`; same three headers; 15 s timeout combined with the caller's `AbortSignal`; a non-2xx response throws with its status. |
| `src/store.ts` | New methods (below). No schema bump (decision 8). |
| `src/config.ts` | `heartbeat: { enabled: true, intervalMs: 60_000 (15_000–600_000), firstDelayMs: 5_000 }`. |
| `src/main.ts` | Timer, overlap guard, stop tracking, `RunHandles.heartbeat()`, `StartDeps.heartbeatClient?`. |

**Store methods.** All are synchronous, so one snapshot is consistent.
- `heartbeatSnapshot(now, sentWindowDays, limits)`: counts by stage, using `prints_by_stage`. `awaitingOutcome` is `sent` rows with no `print.processed`, `print.processing_failed` or `print.not_on_platform` event.
- `chainId()`: the hash of seq 1. `program.started` is always seq 1.
- `auditHashAt(seq)`.
- `verifyAuditRange(afterSeq, prevHash, limit)`. `verifyAuditChain()` becomes a loop over it; its existing tests stay unchanged.
- `recordPlatformOutcome(sha, outcome)`: one audit event, no stage change.
- `returnConfirmedByPlatform(key)`: moves `filed → confirmed` and writes the existing `return.confirmed` with `detail: { via: 'heartbeat' }`. This repairs TODO item 3.

**Checking the chain without blocking capture.** The frontier is kept in
memory. Each beat verifies at most 2,000 events forward from it. The frontier
resets to 0 every 24 h, so the whole chain is walked daily without holding the
loop.

**The loop in `main.ts`.**
- A `heartbeating` flag: overlap guard, and checked in `finishStopIfIdle`.
- An `AbortController` that `stop()` aborts. Nothing is written before a response arrives, so aborting loses nothing; a reply that has already arrived is still applied.
- A failure is logged once when beats go from succeeding to failing (`heartbeat.unreachable`), and once on recovery. A 4xx is logged once (`heartbeat.refused`).
- **A heartbeat never writes an audit event for itself.** Otherwise each beat would change the head it reports.

## 3. The platform side

**Prisma model `AobPrinterHost` → `aobprinter_hosts`.**
- Key: `@@unique([practiceId, chainId])`, `@@index([practiceId, lastSeenAt])`.
- Host and versions: `lastSeenAt`, `hostSentAt`, `intervalMs`, the versions, `startedAt`, `collecting`, `retentionEnabled`, `queueCount`.
- JSON fields: `counts`, `openExceptions`, `filedUnconfirmed`, `localCheck`.
- Chain: `headSeq`, `headHash`, `headAdvancedAt`, `anchorSeq`, `anchorHash`, `anchorVerifiedAt`, `vaultAnchoredAt`, `chainStatus`.
- Regression and re-baseline: `regressionKind`, `regressionAt`, `regressionDetail`, `rebaselinedAt`, `rebaselinedBy`.

**Migration `20261010010000_aobprinter_hosts`.** Idempotent; follows the shape
of `visit_states`. It contains:
- CHECKs:
  - hashes match `^[0-9a-f]{64}$`;
  - `anchorSeq <= headSeq`;
  - the status and regression lists are copied from the contract constants, with a comment naming them;
  - `regressed` ⇔ `regressionKind` is not null.
- `ENABLE` and `FORCE ROW LEVEL SECURITY`, plus a `practice_isolation` policy.
- `core.aobprinter_hosts_overview()`: SECURITY DEFINER. Counts, versions, times and status only; no ids. Granted to `aob_app`.
- A down path in a comment.

The migration is applied by hand in dev (wow §2 item 7).

**Modules and endpoints.**
- **New module `apps/core/src/aobprinter-hosts/`.** It owns only `aobprinter_hosts`.
  - The service has `record`, `listForPractice`, `overview` and `rebaseline`.
  - `GET /aobprinter-hosts` (`@PracticeScoped`).
  - `POST /aobprinter-hosts/:hostId/rebaseline` (`PLATFORM_ADMIN` + `@FreshSecondFactor`, decision 7).
  - `GET /platform/aobprinter-hosts` (`PLATFORM_ADMIN`).
- **`inbound/aobprinter-heartbeat.service.ts`.** Records the host, then builds the reply from two new methods:
  - `InboundPrintJobsService.outcomesForHost`, which maps pending/leased/failed→`waiting`, done→`done`, dead→`dead`, and missing→`unknown`;
  - `WriteBackCollectionService.statusForHost`, which shares one extracted predicate with `pending()` so the two cannot drift.
- **`InboundPrintJobsController`.** `@Post('heartbeat') @HttpCode(200) @PracticeScoped()` above `:id`, taking a whitelisted `AobPrinterHeartbeatDto`:
  - integer and minimum checks on counts;
  - hash regexes;
  - `@IsUUID` on agreement ids;
  - array caps of 25 and 100;
  - versions `^[0-9A-Za-z.+_-]{1,40}$`;
  - reasons `^[a-z0-9_]{1,40}$`.

  The response carries `Cache-Control: no-store`.
- **`practice-surfaces.json`.** Add `/aobprinter-hosts` to `db4` and bump the version.

**The chain verdict.** A pure function, `aobPrinterChainVerdict(existing, otherChains, beat)` in
`packages/domain/src/aobprinter-host.ts`. Rules, in order:
1. No row for this chain:
   - if another chain for the practice has not been re-baselined → `chain_replaced`;
   - otherwise `unverified`, with the anchor at the head.
2. The row is already `regressed` → it stays regressed. The head is updated; the anchor is not moved.
3. `head.seq < headSeq`, or `head.seq < anchorSeq` → `went_backwards`.
4. The same seq with a different hash → `same_seq_different_hash`.
5. The answer at the anchor has a different hash, or a null hash → `anchor_mismatch`.
6. No answer at the anchor, or an answer for a different seq (the host restarted) → unchanged, or `unverified`.
7. Otherwise → `consistent`, and the anchor moves to the head.

**The service transaction.** Everything runs in one `withPractice` transaction:
- `SELECT … FOR UPDATE`, then the verdict, then the upsert;
- vault events through `enqueueVaultEvent`, in the same transaction (decisions 4 and 5).

**Liveness.** `aobPrinterHostLiveness(lastSeenAt, intervalMs, now)` (decision 2).
`secondHostReporting` is true when two chain ids for the practice have both been
seen within the offline window (decision 6).

## 4. The console pages

| Route | Audience | Surface | Back-link |
|---|---|---|---|
| `/practice/aobprinter-host` | `practice_admin` | `db4.pages` | `/practice/setup` (new AOBPRINTER card on `SetupHub`) |
| `/platform/practices/[practiceId]/aobprinter-host` | platform (inside `ViewOnly`) | always | the practice's platform hub |
| `/platform/aobprinter-hosts` | `platform` | always | `/practice`; one `MainMenu` entry |

The page polls every 30 s with `useRefreshable`, pausing while busy, the same
way `DevicesView` does. Ages use `deviceSeenAgo`. All strings live in
`strings.aobprinterHost`.

**States, worst first.** Each names what was observed. A remedy is shown only
where it is true for that record (§7c, wow §13).
1. **Regressed.** One string per kind, naming the expected and received seq and hash (8 characters each) and the time. An unmapped kind shows its code. Operators see Re-baseline.
2. **Two hosts reporting.**
3. **Local check failed**, at seq N, as a link or content failure.
4. **Offline / stale.** "Not heard from since …", with the last report kept on screen with its age.
5. **Open exceptions.** Returns link to their patient. Prints show the code and the hash prefix (decision 13).
6. **Filed but not recorded as confirmed**, in three cases:
   - written back, reconciling on the next report;
   - not recorded, still offered for collection;
   - not recorded and no longer offered.
7. **Old queue.**
8. **Clock skew** over 5 min.
9. **Healthy**: versions, runtime, stage table, chain head, "anchor verified …".
10. **Never reported**: neutral; not an outage.

## 5. Tests

**`apps/aobprinter`**

`heartbeat.test.ts`:
- `heartbeat_carries_counts_hashes_and_versions_and_nothing_else`
- `heartbeat_counts_every_stage_in_both_directions`
- `heartbeat_counts_only_unresolved_exceptions_as_open`
- `heartbeat_chain_id_is_the_hash_of_the_first_event`
- `heartbeat_carries_the_head_and_the_hash_at_the_anchor_it_was_asked_for`
- `a_heartbeat_that_finds_nothing_new_does_not_extend_the_audit_chain`
- `chain_verification_advances_in_chunks_and_reports_how_far_it_got`
- `an_edited_event_is_reported_by_the_next_heartbeat_with_its_seq`
- `the_reply_records_processed_by_aob_once_per_print`
- `a_print_still_waiting_on_the_platform_writes_nothing_and_is_asked_again`
- `a_print_the_platform_never_had_is_recorded_as_not_on_platform`
- `filed_but_never_recorded_as_confirmed_is_repaired_by_the_heartbeat`
- `a_return_the_platform_has_not_written_back_stays_filed`
- `a_return_written_back_with_a_different_hash_stays_filed_and_is_logged`
- `a_failing_heartbeat_is_logged_once_and_never_throws`
- `a_refused_heartbeat_is_said_once_not_every_minute`

`heartbeat-client.test.ts`:
- `posts_to_the_heartbeat_url_derived_from_the_ingest_endpoint_with_the_practice_header`
- `a_non_2xx_is_a_rejection_carrying_its_status`

`poster.test.ts`:
- `a_heartbeat_already_running_is_not_started_again`
- `stopping_during_a_heartbeat_aborts_it_and_closes_the_database_only_after_it_settles`
- `a_heartbeat_reply_applied_during_stop_still_reaches_the_audit_trail`
- `a_hanging_heartbeat_never_delays_a_tick`

`config.test.ts`:
- `heartbeat_is_on_by_default_every_minute`
- `a_heartbeat_interval_outside_15s_to_10min_refuses_to_start`

`store.test.ts`:
- `audit_hash_at_returns_the_stored_hash_or_null`
- `verify_range_agrees_with_a_full_walk`
- `the_stage_checks_match_the_contract_lists`

**`packages/domain`: `aobprinter-host.test.ts`**
- `a_first_heartbeat_is_unverified_until_its_anchor_is_answered`
- `an_answered_anchor_with_the_same_hash_is_consistent_and_moves_the_anchor_to_the_head`
- `a_head_that_goes_backwards_is_a_regression`
- `the_same_sequence_with_a_different_hash_is_a_regression`
- `an_anchor_answered_with_a_different_hash_is_a_regression`
- `a_new_chain_for_a_practice_that_already_has_one_is_a_regression_not_a_new_host`
- `a_regression_is_sticky_until_rebaselined`
- `a_missing_anchor_answer_after_a_restart_is_unverified_not_regressed`
- `a_host_is_stale_after_three_missed_heartbeats_at_its_own_interval`
- `a_host_is_offline_after_fifteen_minutes`

Plus additions to `page-access` and `practice-surfaces` tests.

**`apps/core`: `test/aobprinter-heartbeat.e2e-spec.ts`**
- `the_heartbeat_answers_at_inbound_print_jobs_heartbeat`
- `aobprinter_heartbeat_strips_anything_not_declared`
- `a_heartbeat_records_last_seen_versions_and_stage_counts`
- `a_chain_regression_writes_one_vault_event_and_stays_flagged`
- `the_chain_anchor_reaches_the_vault_at_most_hourly`
- `the_reply_carries_processed_by_aob_for_each_job_asked_about`
- `the_reply_says_written_back_for_a_return_the_platform_recorded`
- `aobprinter_hosts_are_practice_scoped_and_a_cross_practice_read_fails_closed`
- `a_practice_on_the_standard_profile_is_refused_the_heartbeat`
- `no_identifier_value_reaches_a_heartbeat_vault_event`
- `the_platform_overview_needs_platform_admin`
- `rebaseline_is_the_platform_s_act_and_is_recorded`

**`apps/web`: `practice/aobprinter-host/aobprinterHost.test.tsx`**
- `shows_last_seen_versions_and_stage_counts_for_a_healthy_host`
- `a_stale_host_says_when_it_was_last_heard_from`
- `an_offline_host_keeps_its_last_report_with_its_age`
- `a_regression_names_the_expected_and_received_sequence_and_hash`
- `a_replaced_chain_says_so_and_names_the_previous_one`
- `two_hosts_reporting_is_its_own_state`
- `a_filed_but_unrecorded_return_links_to_its_patient`
- `an_unmapped_reason_code_shows_its_code`
- `no_host_ever_reported_does_not_read_as_an_outage`
- `registers_refresh_and_back_link`

Plus tests for the platform twin and for the overview (`lists_every_host_worst_first`).

## 6. Build order

| Step | Owns | Shared module? | After |
|---|---|---|---|
| A. Contracts | `aobprinter-heartbeat.ts`, `index.ts`, `vault.ts` | yes (vault rebuild) | none |
| B. Domain | `aobprinter-host.ts`, `page-access.ts`, `practice-surfaces.json` | yes | A |
| C. AOBPRINTER | `apps/aobprinter/src/**` | no | A |
| D. Core | Prisma schema + migration, `aobprinter-hosts/**`, `inbound/**` | yes (Prisma) | A, B |
| E. Web | three pages, `SetupHub`, `BackLink`, `MainMenu`, `strings.ts` | yes (string table) | A, B |

A and B run one after the other. C, D and E then run in parallel.
`INVENTORY.md` is regenerated once, at each commit. Targeted tests run per step,
and **one full suite runs at the end** (Carl, 10 Oct). Then a fresh **Opus**
reviewer reads the diff, because it touches hard rules 8, 9 and 11, a migration,
routes and the vault.
