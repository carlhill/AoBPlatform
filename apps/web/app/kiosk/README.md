# The kiosk (C2) — `/kiosk`

**Pair the tablet first**, then the waiting-room ceremony: **list → verify →
who is signing → locked particulars → sign → done**. `episodic_pre` only,
channel `in_practice` only.
There is deliberately **no patient mobile app** — this is a practice-owned
tablet, and this is a page of the web app rather than an app of its own.

## Where it came from

It was `apps/kiosk`, an Expo/React Native app, until 3 September 2026, when
Carl folded it into `apps/web`: one codebase, one theme, one string table, one
lint config, one test runner. The Expo build's real cost was the loop — a
minute or two of `expo export` per look, against Fast Refresh here — and its
one remaining reason to be native (offline-first) had already been withdrawn
by the zero-footprint decision on the same day. Kiosk lockdown is a device
setting on the practice's own tablet, and signing on glass works on a canvas.

## Running it

```bash
npm run dev -w apps/web        # web on 3100 — the kiosk is at /kiosk
npm run start:dev -w apps/core # core on 3001, which it talks to
npm run test -w apps/web       # Vitest: the hard-rule tests
npm run e2e:kiosk -w apps/web  # Playwright: the ceremony, against both servers
npm run lint -w apps/web       # string-table guard + the zero-footprint rule
```

### Pairing a browser as a tablet

`/kiosk` shows the pairing screen until this browser holds a credential. Two
ways to get one:

- **The product path.** Sign in to the console, open **`/practice/setup` →
  Tablets** (or go straight to `/practice/devices`), press *Add tablet*, name
  it, and type the code it shows into `/kiosk`. The code lasts ten minutes and
  works once.
- **Dev only, no sign-in.** `POST /dev/kiosk-device` with `x-practice-id` and
  `{ "label": "..." }` returns a code without a signed-in user. It exists
  because `POST /devices` refuses an unattributed request by design, and the
  Playwright suite has no Keycloak session:

  ```bash
  curl -s -X POST http://127.0.0.1:3001/dev/kiosk-device \
    -H 'content-type: application/json' -H "x-practice-id: $PRACTICE_ID" \
    -d '{"label":"Reception tablet 1"}'
  ```

To un-pair, **revoke it in the console** — there is deliberately no control on
the device. (Clearing the browser's site data works too, and is the same act
performed by somebody standing at the tablet, which is exactly why revoke does
not live there.)

### Environment

| Variable | Meaning |
|---|---|
| `NEXT_PUBLIC_CORE_URL` | `apps/core`, default `http://localhost:3001` |
| `NEXT_PUBLIC_BUILD_ID` | The build this tab is running. Shown in the footer, sent as `x-kiosk-build`, and compared against the practice's floor for the forced reload. `dev` locally |
| `NEXT_PUBLIC_KIOSK_STAFF_ID` | Dev stand-in for `verifiedByStaffId` |

`NEXT_PUBLIC_KIOSK_PRACTICE_ID` **is gone** (3 Sep 2026). It scoped a public
route from the bundle, so anybody who reached the URL saw that practice's
waiting list. The tablet no longer asserts a practice at all: it sends
`x-device-credential`, the server resolves the practice, and `/kiosk/*` refuses
an `x-practice-id` header outright.

## Decisions already made

- **Trust is a paired device** (3 Sep 2026; this REVERSES plan Part 6 decision
  3, which said "a staff passkey session in a big-buttons layout, no device
  credential"). Like a payment terminal paired to a merchant: the console
  registers a tablet and shows a code, the tablet exchanges it once for an
  opaque credential, and the server resolves the practice from the credential
  on every request thereafter. Revoke and rotate are **console** acts — a
  tablet that can un-pair itself is a tablet a passer-by can un-pair.
  **Pairing is not a Keycloak login**: there is no person to authenticate at a
  tablet, and hard rule 15 (practitioner and admin auth is WebAuthn passkeys)
  is untouched. `/kiosk` stays classified `public` in the page-access map, in
  the same sense `/patient/...` is — no Keycloak session exists or could.
- **The credential is the ONE thing that outlives the tab.** Everything else
  the tablet knows it asks for on load and forgets: no practice name, no
  patient, no draft, no step. That is what makes a tablet found in a taxi worth
  nothing to whoever found it, and what makes "revoke it from the console" a
  complete answer rather than a partial one.
- **The sub-steps are component state, not routes.** One URL, one history
  entry: no back button can walk the next patient into the previous one's
  verification screen, and a reload starts at "Checking in?".
- **Both signature methods are real** (Part 6, decision 4): drawn on glass and
  tap-to-approve, one under the other. `SignatureEvent.method` records which.
- **It does not render `Shell`.** No main menu, no back link, no refresh
  button — a patient must not be able to navigate into the console from the
  waiting room.

## The hard rules, and where they are enforced

| Rule | Where | Test |
|---|---|---|
| REQ-REG-06 — no signature before validate+lock | `rules/signature-gate.ts`, `components/SignatureControl.tsx` (`validation` is a required prop; the enabled branch is unreachable without the one union member the gate produces) | `signature_disabled_until_payload_valid` |
| REQ-VER-02 — the card number is not an identifier | `rules/identifiers.ts` (domain guard), root ESLint `no-restricted-syntax`, no label in the string table | `medicare_number_rejected_as_identifier` |
| Generic mismatch, 3 attempts then the desk | `rules/verification.ts`; shown INLINE on K-2 so nothing entered is lost | `mismatch_never_names_the_failed_identifier`, `three_attempts_then_lockout`, `mismatch_keeps_entered_values_on_screen`, `third_mismatch_hands_over_and_clears` |
| Age gates (14 self, 18 for another) | `rules/assignor.ts` — constants imported from `@aobplatform/domain`, never typed here | `patient_14_may_self_assign`, `assignor_for_another_must_be_of_full_age` |
| Practice-staff assignor block | `rules/assignor.ts` + `GET /practice-users`, and the same refusal on the server inside `buildAssignorForAnother` | `practice_staff_hard_blocked_as_assignor`, `staff_assignor_block_disables_continue_with_reason` |
| REQ-VUL-01 — relationship and authority basis are separate attributes, and the basis is versioned content | `packages/domain/content/assignor-relationships.json` → `authorityBasisFor` → `rules/assignor.ts` | `relationship_options_come_from_content_not_code`, `relationship_list_is_loaded_from_content` |
| No capacity control anywhere | absence, asserted | `ui_never_asks_staff_to_assess_capacity` |
| No amount, no practitioner signature field, no "certified/approved/accredited" | the `kiosk` branch of `app/strings.ts` | `no_dollar_amount_on_any_agreement_artefact`, `no_practitioner_signature_field`, `never_claims_certification_or_approval` |
| Nothing blocks care (REQ-REC-04) | `screens/HandoverScreen.tsx` — every dead end has a door, and every ceremony screen has an exit | `nothing_blocks_care`, `a_way_out_on_every_ceremony_screen`, `leaving_changes_no_agreement_state`, `the_exit_hands_over_and_promises_nothing` |
| Zero footprint (CLAUDE.md §7) | `session.ts` (in memory only); `pairing.ts` is the SINGLE module permitted to write, with a scoped `eslint-disable` naming the reason, and `PERSISTABLE_KEYS` holds its one key. Root ESLint `no-restricted-globals`/`no-restricted-syntax` still bite everywhere else under `app/kiosk/**` | `kiosk_persists_nothing_but_pairing`, `the_pairing_credential_is_the_only_thing_written` |
| A public route is not a public waiting list | `apps/core/src/devices/device.guard.ts` deletes any client `x-practice-id` on `/kiosk/*` and requires a device; K-0 gates the browser | `kiosk_routes_require_device_credential`, `revoked_device_gets_401_and_no_data`, `kiosk_requires_a_paired_device` |
| K-3 asks the patient for nothing | `screens/ParticularsScreen.tsx` — no input, select or textarea in any state | `k3_never_offers_a_field_to_the_patient` |
| Back is navigation, not an exit | `Ceremony.tsx` (one `setStep`, no fetch) | `back_is_navigation_and_changes_no_agreement_state`, `back_is_withdrawn_once_a_signature_is_in_flight` |

## What K-3 does when the rules engine refuses

It hands over. It does not offer a field.

A pre-agreement needs a Basic Service Description (D6a) drawn from the
practice's current mapping, and the rules engine matches it exactly and
case-sensitively. The Expo build put a free-text box for it on this screen,
labelled "staff entry" — on a patient-facing screen, in a waiting room, where
anybody could type a validated particular of a contract into it against a
mapping they could not see. D6a comes from the PMS appointment type through
the practice's versioned mapping (CONSULTATION-CAPTURE-PLAN §2.4); the tablet
supplies no particulars at all.

So there are two refusals and they read differently, because they are
different things:

- **A rules refusal** — "One more detail is needed from reception". Real
  outstanding particulars, which a staff member can act on, on a staff surface.
- **A fault on our side** — "Something went wrong on our side". Not about the
  patient's details at all.

Neither ever shows the server's own words, and neither presents a numbered list
of things the patient is being asked to fix.

## Not built here (and why)

- **Enduring at the kiosk** — build-plan item 10, out of this scope.
- **Portal activation on K-6** — an optional account is a whole flow; half of
  one is worse than none.
- **Vector/raster signature upload (REQ-SIG-02)** — the pad captures both
  representations and neither is uploaded: `SignDto` takes a method, a channel
  and a capture request, not a payload. Changing that is a contract change in
  `apps/core`.
- **Read-aloud, language switch, read-through gate, RACF batch mode, kiosk
  lockdown launcher, bot-defence dwell time** — all still outstanding from C2.
- **The offline queue** — withdrawn, not deferred. C2.2 was dropped with the
  zero-footprint decision (the push model needs the server anyway; an offline
  kiosk cannot receive a push). Outage posture is "see reception", the patient
  is seen, and capture happens post-service or on paper.

## Still non-negotiable when the rest is built

- Kiosk mode: locked-down launcher, no OS escape, auto-reset between patients,
  **no residual patient data on device after submission**.
- Accessibility: large text, high contrast, read-aloud, staff-assisted mode
  (REQ-NFR-05, REQ-VUL-08); WCAG 2.2 AA.
- Signature: drawn, vector + raster, bound per REQ-SIG-02.
- Bot-defence never challenges the patient (REQ-BOT-02); minimum dwell time
  before the signature control enables (REQ-BOT-05) — but only after the
  REQ-REG-06 gate passes.
- Staged rollout per practice. **Built**: the footer carries the build id, every
  request sends `x-kiosk-build`, and a tab below the practice's
  `minimumKioskBuild` hard-reloads — once per tab, and never mid-ceremony. The
  floor is set on `/practice/devices`.
