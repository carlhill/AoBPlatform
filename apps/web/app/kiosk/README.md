# The kiosk (C2) — `/kiosk`

**Pair the tablet first**, then the waiting-room ceremony: **verify → (who is
signing) → locked particulars → sign → done**. `episodic_pre` only, channel
`in_practice` only.

**There is no list at the front of it any more** (Carl, 4 Sep 2026). Begin
opens K-2, the patient types three details, and `POST /kiosk/claim` finds the
one waiting row of this practice that matches all of them — verifying in the
same call. Nobody's name is on the screen until somebody has proved it is
theirs. The list survives only on a **test device**, flagged from the console,
under a permanent banner. See "The walk-up front door" below.
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

`showsWaitingList: true` in that body makes it a **test device** — the only
kind that still sees the list. Without it you get what a patient gets.

To flip an **already-paired** dev tablet without re-pairing it (no console
session needed):

  ```bash
  # the device id comes from GET /devices, or from the POST above
  curl -s -X PATCH http://127.0.0.1:3001/dev/kiosk-device/$DEVICE_ID \
    -H 'content-type: application/json' -H "x-practice-id: $PRACTICE_ID" \
    -d '{"showsWaitingList":true}'
  ```

The tablet picks it up on its **next poll** — no reload, no re-pairing. The
product path is the toggle on `/practice/devices`, which does the same thing
through `PATCH /devices/:id` with a signed-in staff member attached.

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

## The walk-up front door (Carl, 4 September 2026)

> "Remove the 'x people ready to sign' text — this is a security feature. Then
> on the next page do not show the list. Go straight to 'Confirm your details',
> match these details to the list on AoBPlatform and then go to the next page.
> The list page is only for testing purposes."

Three things follow, and all three are enforced on the SERVER rather than only
in the UI.

1. **No count on the idle screen.** `waitingCount` is deleted from the string
   table, not softened. A count names nobody, which is why it survived the
   first pass; "1 person is ready to sign" beside one person at the desk is not
   anonymous, and a tablet on a counter announcing how busy the waiting room is
   still describes the room to the room.
2. **Begin goes to K-2.** `POST /kiosk/claim` takes the same `stated` shape the
   attempt endpoint has always taken, evaluates **every** open `in_practice`
   waiting row of the device's practice against it with the existing matchers,
   and — on exactly one match — records the verification through
   `VerificationService` (the ordinary in-practice path, PMS read and all) and
   returns that one row. **Zero matches and several matches are the same
   generic refusal**, both spend an attempt, and both point at reception:
   "nobody by that name" and "two people here match" are equally facts about
   other people. Three failures per **device** and the tablet hands over
   (`kiosk/claim-rate-limit.ts` — per device, because a failed claim has
   identified nobody to key a counter to).
3. **The list is test-only.** `GET /kiosk/waiting-list` answers a device without
   `showsWaitingList` `{ waiting: [], hidden: true }` — no rows and no count —
   and the query is not run at all rather than run and filtered. The flag is set
   from the console (`PATCH /devices/:id`), never from the tablet, and the list
   renders under a permanent "TEST DEVICE — names visible" banner. `hidden` is
   inside the ETag, so the toggle reaches a tablet on its next poll.

The poll survives all of this as a **heartbeat**: it carries the forced reload
and it is how the idle screen knows the platform is reachable. It just no
longer carries names.

## K-5 is skipped on a locked agreement (Carl, 4 September 2026)

K-5 used to render the self option, then — exactly where "Someone else is
signing for …" belongs — a panel explaining that who signs is locked, then a
Continue. Carl read the panel as the second option, which is the only sensible
reading of a box sitting in an option's slot.

The fix was not better wording. **When the particulars are locked there is
nothing to choose**, so the ceremony goes from verification straight to K-3,
whose "Signing" line already states who signs; a one-line note under it says
"Set at reception — ask our staff if this is wrong". Back is withdrawn on K-3
for the same reason — there is nothing behind it. When the agreement is
**not** locked, K-5 renders both options as real options exactly as before.

**The rule:** never render an option-shaped box that is not an option.

This is also the shape the reception-push flow wants: a pushed agreement is
always locked before it reaches a device, so the tablet will never show K-5 for
one.

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
| A walk-up tablet shows no other patient | `apps/core/src/kiosk/kiosk.service.ts` (`claim`, and the list's `hidden` gate); `screens/IdleScreen.tsx` | `claim_matches_exactly_one_waiting_row_of_this_practice`, `claim_failure_is_generic_for_none_and_for_many`, `claim_never_returns_other_rows`, `claim_records_types_not_values`, `claim_locks_out_after_three_per_device`, `waiting_list_hidden_unless_device_is_a_test_device`, `begin_goes_to_verify_not_the_list`, `idle_shows_no_count`, `list_only_on_a_test_device_and_bannered` |
| No option-shaped box that is not an option | `Ceremony.tsx` skips K-5 when `particularsLockedAt` is set; `screens/ParticularsScreen.tsx` carries the one-line note | `k5_is_skipped_when_particulars_are_locked`, `k5_shows_both_options_when_unlocked` |
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
