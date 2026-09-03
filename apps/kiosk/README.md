# Kiosk / tablet app (C2)

The waiting-room ceremony, as an Expo/React Native app: **list → verify → who
is signing → locked particulars → sign → done**. `episodic_pre` only, channel
`in_practice` only. There is deliberately **no patient mobile app** — this is a
practice-owned tablet.

## Running it

```bash
npm install                       # at the REPO ROOT, never in here (CONVENTIONS.md §2)
npm run web -w apps/kiosk         # dev server
npm run export:web -w apps/kiosk  # static bundle in ./dist — the verification path
npm run test -w apps/kiosk        # hard-rule tests
npm run lint -w apps/kiosk        # string-table guard + eslint
```

Configuration is three `EXPO_PUBLIC_*` variables, all with dev defaults:

| Variable | Meaning |
|---|---|
| `EXPO_PUBLIC_CORE_URL` | `apps/core`, default `http://localhost:3001` |
| `EXPO_PUBLIC_PRACTICE_ID` | Dev stand-in for the practice claim on the staff session |
| `EXPO_PUBLIC_STAFF_ID` | Dev stand-in for `verifiedByStaffId` |

## Decisions already made

- **Trust is a staff passkey session on the device** (plan Part 6, decision 3).
  No device credential, no enrolment ceremony for the tablet, no new auth
  surface to revoke. Scope is the practice of the signed-in staff member.
  `src/session.ts` holds it **in memory only** — never storage.
- **The Industry token set** from the design handoff (Barlow, `#5980a6`, square
  corners) lives in `src/theme.ts`. The console and portal keep what they have;
  the kiosk shares no components with them.
- **TypeScript 6, pinned for this workspace only.** Every other workspace stays
  on `^5.6.3`; npm nests the second copy, which is intended.
- **Both signature methods are real** (Part 6, decision 4): drawn on glass and
  tap-to-approve, side by side. `SignatureEvent.method` records which.

## The hard rules, and where they are enforced

| Rule | Where | Test |
|---|---|---|
| REQ-REG-06 — no signature before validate+lock | `src/rules/signature-gate.ts`, `src/components/SignatureControl.tsx` (`validation` is a required prop; the enabled branch is unreachable without the one union member the gate produces) | `signature_disabled_until_payload_valid` |
| REQ-VER-02 — the card number is not an identifier | `src/rules/identifiers.ts` (domain guard), root ESLint `no-restricted-syntax`, no label in the string table | `medicare_number_rejected_as_identifier` |
| Generic mismatch, 3 attempts then the desk | `src/rules/verification.ts` | `mismatch_never_names_the_failed_identifier`, `three_attempts_then_lockout` |
| Age gates (14 self, 18 for another) | `src/rules/assignor.ts` — constants imported from `@aobplatform/domain`, never typed here | `patient_14_may_self_assign`, `assignor_for_another_must_be_of_full_age` |
| Practice-staff assignor block, neutral copy | `src/rules/assignor.ts` + `GET /practice-users` | `practice_staff_hard_blocked_as_assignor` |
| No capacity control anywhere | absence, asserted | `ui_never_asks_staff_to_assess_capacity` |
| No amount, no practitioner signature field, no "certified/approved/accredited" | `src/strings.ts` + `check-strings.mjs` | `no_dollar_amount_on_any_agreement_artefact`, `no_practitioner_signature_field`, `never_claims_certification_or_approval` |
| Nothing blocks care (REQ-REC-04) | `src/screens/HandoverScreen.tsx` — every dead end has a door | `nothing_blocks_care` |

## Not built here (and why)

- **Enduring at the kiosk** — build-plan item 10, out of this scope.
- **The offline sync engine** — the encrypted local queue, on-device rule set
  and re-validate-at-sync are C2 requirements and are not here. The UI has the
  offline-queued *state*; the engine behind it does not exist yet.
- **Portal activation on K-6** — an optional account is a whole flow; half of
  one is worse than none.
- **The "someone else is signing" write path** — the gates run, and then the
  kiosk hands over to the desk, because nothing re-points an agreement at a new
  assignor. Stated on screen rather than mimed.
- **Vector/raster signature upload (REQ-SIG-02)** — the pad captures the stroke
  vector and reports ink; the sign DTO takes a method, not a payload, so
  nothing is uploaded. Changing that is a contract change.
- **Read-aloud, language switch, read-through gate, RACF batch mode, kiosk
  lockdown launcher, bot-defence dwell time** — all still outstanding from the
  C2 list below.
- **Maestro e2e** — the repo's kiosk e2e tool needs a device or emulator, which
  this environment does not have. Outstanding.

## Still non-negotiable when the rest is built

- Offline-first: capture and queue locally through an internet outage
  (encrypted SQLite queue); validate on sync; alert on post-sync validation
  failure.
- Kiosk mode: locked-down launcher, no OS escape, auto-reset between patients,
  **no residual patient data on device after submission** (memory-only render).
- Accessibility: large text, high contrast, read-aloud, staff-assisted mode
  (REQ-NFR-05, REQ-VUL-08); WCAG 2.2 AA.
- Signature: drawn, vector + raster, bound per REQ-SIG-02.
- RACF visiting-provider batch mode — one offline session per resident list,
  per provider (REQ-VUL-07).
- Bot-defence never challenges the patient (REQ-BOT-02); minimum dwell time
  before the signature control enables (REQ-BOT-05) — but only after the
  REQ-REG-06 gate passes.
- Maestro is the e2e tool (per tech stack); Jest stays pinned to `^29.7.0`.
