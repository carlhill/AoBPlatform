# GA plan — what stands between today and General Availability
### v1.0 · 3 September 2026 · Re-baselines `aob-build-plan.md` against what is actually built. Owner: Carl.

**GA — General Availability** — is the release at which any practice can sign up
and use AoBPlatform in production without us holding their hand: open
onboarding, pricing on, support and on-call in place, pen-tested, with the
public s 65C tester live as the funnel. The build plan fixes it at **no later
than April 2027**, targeting 50+ practices by 30 June 2027 — the day the
statutory verbal-consent fallback ends (REQ-REG-10). Before GA there are two
smaller releases: **M1 design partner live** (one Medtech practice signing on
glass) and **M2 beta** (5–10 practices running the full cascade).

Everything below is ordered by dependency, not by preference. Estimates are
**agent-days with Carl reviewing**, calibrated on this week: a screen is about
half a day, a module with tests about a day, anything touching the PMS or an
external party is gated on that party and not estimable by us.

---

## 1. Where we are

The calendar says Phase 0 (Unblock). The code is well past Phase 1 in most
areas and behind it in two that matter.

| Area | Plan expected by | State on 3 Sep 2026 |
|---|---|---|
| Evidence Vault, outbox, chain verifier | Phase 1 | Built, human-authored |
| Rules & Conformance engine, versioned rule set | Phase 1 | Built; D6a mapping is a **hand-typed dev stub** |
| Domain core, RLS, page-access model | Phase 1 | Built |
| Verification (3 identifiers, constant-time, no values logged) | Phase 1 | Built; name and address matching made tolerant this week |
| Kiosk ceremony (episodic pre) | Phase 1 | Built, **on Next.js as of today**; Expo retired |
| Practice console: setup hub, users, queue, reviews, correspondence, reconciliation | Phase 1–2 | Built |
| Correspondence log (4 audiences), retention sweep, chase-attempt backend | Phase 2 | Built |
| Set-assignor endpoint, D6a staff screen, service-description content | — | Built today |
| **Medtech write-back (D-01)** | **Phase 0 gate** | **Mock adapter only. Unproven.** |
| **Real MBS mapping ingest (REQ-REG-03)** | **Phase 0 gate** | **Not started.** |
| Appointment / invoice sync auto-drafting | Phase 1 | Not built (drafts staged by hand this week) |
| Enduring at the kiosk | Phase 1 | Not built |
| SMS/email cascade with registered sender | Phase 2 | Cascade built; **sender-ID registration status not visible in the repo — Carl to state** |
| Drawn-signature storage (REQ-SIG-02) | Phase 1 | **In build now** — strokes were captured and discarded |
| Device pairing | — | **In build now** — `/kiosk` cannot leave a dev machine without it |
| Passkeys for staff (REQ-VAULT-04) | Phase 1 | Built (Keycloak, WebAuthn required) |
| Public s 65C tester | Phase 3 | Not built |
| Pen test, incident runbook, on-call | Phase 3 | Not started |

Two Phase-0 gate items are still open in September. That is the headline of
this plan: **nothing we build in the console or on the tablet makes this a
compliance product until a signed artefact lands in a Medtech patient record.**

---

## 2. The critical path

Rows are in dependency order. "Gate" rows are external or decision-bound and
cannot be estimated by us; everything after them is estimable.

### A. Phase-0 gates still open (September)

| # | Item | Why it gates | Depends on | Est. | Status |
|---|---|---|---|---|---|
| A1 | **Medtech write-back mechanism (D-01)** — prove one signed PDF/A lands in an Evolution patient record at the design partner: API → integration program → file/HL7 drop → scan-in, in that order | CLAUDE.md §5; without it the product is "a form" | Medtech, design partner | **Gate.** Spike ~2 days once a path is named | Open |
| A2 | **MBS mapping ingest** — quarterly MBS Online XML/CSV → versioned mapping → human-reviewed diff → published to rules | REQ-REG-03; the dev list is a stub the code says never to ship | MBS Online format | 2–3 days + review process | Not started |
| A3 | **ACMA Sender ID registration** started; SMS gateway chosen | REQ-VER-05; lead time is months | ACMA | Gate (calendar) | **Carl to state** |
| A4 | Services Australia: D-11 (enduring registration) and D-10 (conformance) put in writing to Developer Liaison; HSD Portal registration lodged | Keeps enduring registrable-shaped; opens the relationship | Services Australia | Gate | **Carl to state** |
| A5 | Fifteen practice-manager interviews | Confirms the wedge before the spend | Carl | — | **Carl to state** |

**Gate P0 (unchanged from the build plan):** write-back proven · mapping
ingested · sender ID in flight · interviews support the thesis.

### B. M1 — design partner live (target mid-Dec 2026, was mid-Dec)

| # | Item | Depends on | Est. | Notes |
|---|---|---|---|---|
| B1 | Drawn-signature storage, hashed and bound (REQ-SIG-02) | — | 1 day | **In build** |
| B2 | Device pairing; kiosk scoped by device credential; console `/practice/devices`; forced-reload for rollback | — | 1.5 days | **In build** |
| B3 | Real Medtech adapter behind the FR-9.1 interface, using the A1 mechanism | A1 | 2–4 days | Cannot start before A1 |
| B4 | Appointment sync → `episodic_pre` draft + in-practice request (plan §2.1); invoice sync → `episodic_post` + remote capture (§3.1) | B3 for real data; mock for now | 1 day | Plan rows 1–2 |
| B5 | **Enduring at the kiosk** — the GP practice's real front door; sign once, nothing post-service | B4 | 1 day | Plan row 10; REQ-END-01/-01a |
| B6 | Practice setting: which agreement the pre-step offers (enduring default for GP; episodic for decliners and non-GP) | B5 | 0.5 day | Today's flow ruling |
| B7 | Push-to-device from reception (pre-service): reception pushes a locked payload to a paired tablet; the push is the staff-verified record | B2 | 1.5 days | TODO "Push-to-device" |
| B8 | Post-service push (second push, same tablet), fresh staff-verified event, tap-to-approve signature | B7 | 1 day | TODO "practice flow" |
| B9 | Reception status view of the tablet (states, not a mirror) | B7 | 0.5 day | |
| B10 | Console control for the practice default D6a; appointment-type → description mapping per practice | — | 0.5 day | Core done today |
| B11 | Rules-engine D6a check stays exact; remove every remaining place a human types a description | B10 | 0.25 day | Ruling: no staff entry on the patient surface |
| B12 | AoBPrinterApp v1 — virtual printer, local parse, lane-aware outbox, device enrolment | A1 decides whether this is the write-back path or just the ingest path | 3–4 days, **separate codebase** | Plan row 8 |
| B13 | Import-folder write-back in the desktop app | A1, B12 | 1 day | Plan row 11 |
| B14 | Decision: does tablet-side "someone else" survive the push model, or become a hand-over with the endpoint serving the desk | B7 | Decision | TODO |
| B15 | Instrumentation on from the first live agreement (REQ-MON-04) | — | 0.5 day | |

**M1 exit test:** the design partner captures real agreements on the paired
tablet, validated, vaulted with the drawn signature, written back to Medtech,
staff on passkeys. Until A1 closes, B3/B12/B13 cannot; everything else in B can
be finished in **~10 agent-days** and waits on the desk.

### C. M2 — beta cohort (target end Feb 2027)

| # | Item | Depends on | Est. |
|---|---|---|---|
| C1 | Registered-sender SMS live; email domain DMARC/DKIM/SPF aligned (C3.3) | A3 | 1 day after registration |
| C2 | Message copy in every channel, reviewed (TODO "message copy"); "how to tell our messages are real" page | — | 1 day + Carl review |
| C3 | Per-assignor channel preference on the record, honoured by every sender (C7.2) | — | 0.5 day |
| C4 | Chase attempt screen (R-2) — backend done; cascade banded by days-remaining (REQ-CHASE-05), handback with private-billing choice (REQ-CHASE-07) | — | 1 day |
| C5 | Cross-channel STOP record honoured by every sender (REQ-CHASE-03) | C3 | 0.5 day |
| C6 | Address validation service (G-NAF/PAF): fraud check + tolerant remote-link match | Vendor choice | 1.5 days |
| C7 | Paper flow (print, scan-in) for the digitally excluded (REQ-VUL-06) | B12 | 1 day |
| C8 | Portal v1: history, download, verify-a-message (REQ-PORT-08 — link-based, no account) | — | 1.5 days |
| C9 | Multilingual v1: English + Arabic + 2 languages, bilingual artefact under one hash (REQ-LANG-02) | Translator vendor | 1.5 days + vendor |
| C10 | Support, lockouts and passkey recovery (13 open TODO items) | — | 2–3 days |
| C11 | Forbidden-word lint rule ("certified/approved/accredited/government-approved") | — | 0.25 day |
| C12 | Industry token set ported to the theme | Product decision | 0.5 day |
| C13 | Beta onboarding journeys M1.A–M1.D Tier 1 | — | 1.5 days |
| C14 | Signed-in-session fixture so console Playwright stops skipping | — | 0.5 day |

**M2 exit test:** 5–10 practices on the full cascade; in-practice capture
share ≥ 75% (G1); chase volume measured against the 9–12/day baseline.
About **14 agent-days** plus vendor lead times.

### D. GA hardening (Mar–Apr 2027)

| # | Item | Est. |
|---|---|---|
| D1 | Pen test (external), findings fixed | Vendor + 2 days |
| D2 | Incident runbook, on-call rota, status page | 1 day + Carl |
| D3 | Public s 65C tester on the rules service (zero PII), the funnel | 2 days |
| D4 | Conformance statements ("checked against the s 65C data set" — never "certified") | 0.5 day + Carl |
| D5 | Tyro/HICAPS detection + retention-gap report (the sales demo) | 1.5 days |
| D6 | Pricing switched on; open onboarding | 1 day |
| D7 | Staged kiosk rollout per practice with instant rollback, proven in a drill | 0.5 day |
| D8 | Tech-stack doc rows amended (Expo → Next.js kiosk); every ADR touched this quarter recorded | 0.25 day |

**GA exit test (M3):** open onboarding works end to end without us; pen test
closed; on-call live; tester public. **~9 agent-days** plus the pen-test window.

---

## 3. Deliberately after GA (Phase 4, May–Aug 2027)

Enduring lifecycle beyond capture (anniversary fuse REQ-END-03, batch
enrolment, Services Australia registration when D-11 publishes) · 89AA engine
at scale · portal termination flows · Tier-2 standing assignors · remaining
languages · RACF batch mode **(now MAY — Carl, 3 Sep 2026)** · AI calling
(Phase 5, after measured baselines) · walk-ins as the kiosk front door · v2/v3
direction (practice AoB management; front office).

The one Phase-4 item that must not slip: enduring must be live **before 1 July
2027**, when per-practitioner registration becomes a validity requirement for
new agreements (65CB(5)(h)).

---

## 4. Scope-shed lines (if the team of 2+1 slips)

In this order, each can slip without moving GA: languages beyond four · Tier-2
assignors · RACF batch (already shed) · tester OCR · Tyro/HICAPS detection ·
Industry token set · reception status view · address validation (fall back to
tolerant match). **Not sheddable:** A1, A2, B1, B2, B3, B5, C1, C4, D1, D2.

---

## 5. Working rules that apply to every row

From CLAUDE.md §7 as amended this week: Fable orchestrates, Opus builds, Sonnet
fixes · compact the chat early · choose tech for iteration speed · zero
footprint on the tablet · option lists are content files · no staff entry on
the patient surface · agents skip browser walk-throughs when Carl is testing ·
every row ships with its named hard-rule tests, vault events through the
outbox, RLS fail-closed test, strings in the table, OpenAPI updated.

---

## 6. What Carl decides, and when

| Decision | Needed by | Rows blocked |
|---|---|---|
| Which write-back path Medtech allows (or that none does) | **Now** | B3, B12, B13, M1 |
| Sender-ID and Services Australia status (fill §1) | Now | C1, Phase 4 |
| Tablet-side "someone else": keep or hand over | B7 | B14 |
| Industry token set | Before C12 | C12 |
| Address-validation vendor | Before C6 | C6 |
| Fixture `2123 45670 1` checksum-valid? (CLAUDE.md wants invalid) | Any time | none |

---

## Change log

| Version | Date | Change |
|---|---|---|
| 1.0 | 3 Sep 2026 | First re-baseline against the code. Kiosk moved to Next.js; C2.2 withdrawn, C2.5 to roadmap; signature storage and pairing in build. |
