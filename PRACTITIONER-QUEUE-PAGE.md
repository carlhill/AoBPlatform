# PRACTITIONER-QUEUE-PAGE.md — who is waiting for me, and is their paperwork done
### v1.0 · 12 September 2026 · Owner: Carl. A plan, not yet built. Companion to `FRONT-DESK-PAGE.md` (reception's side of the same queue), `QUEUE-TICKETS.md` and `VISIT-WORKFLOW.md`.

Carl, 12 September 2026: *"for the frontdesk page and queuing patients to see the
doctor, we will also need a doctor page to show their list of patients queued —
so we need a practice/doctordesk — or a better name."*

---

## 1. The name and where it sits

**Decided by Carl, 12 September 2026**, and it overrides the first version of
this section:

> *"We will also need a login for a practitioner via the practice. So the
> practitioner does not land on the practice/setup but on the practice/
> practitioner landing page and from there to any other pages we want to give
> the practitioner e.g. practitioner-queue."*

So:

| Route | What it is |
|---|---|
| `/practice/practitioner` | **New.** Where a practitioner lands when they sign in at a practice. Their home inside the practice console |
| `/practice/practitioner/waiting` | This page — who is waiting for me today, and is their paperwork done |

**"Doctor" stays out of the URL.** The domain says provider and practitioner,
never GP or doctor (CLAUDE.md §3, REQ-MP-01), and a route is the one place a
banned word survives every later rename. That part of the original
recommendation stands; only the parent changed.

**Why this is not a duplicate of the existing `/practitioner`.** They answer
different questions and both should exist:

- `/practitioner` is **about me, across practices** — my details, my
  affiliations, what has been sent to me. Personal, and it follows the person
  wherever they work.
- `/practice/practitioner` is **my work at THIS practice, today** — the queue,
  and whatever else is given to practitioners later. Practice-scoped, and it
  disappears when the affiliation does.

**The landing rule.** A practitioner signing in at a practice lands on
`/practice/practitioner`, never `/practice/setup`. The setup hub is the
administrator's page; sending a provider there is how a person learns to ignore
their own home screen. This needs the page map to route by what the account IS,
not only to gate what it may open — see §6.

**On a card.** Carl asked for the queue to be reachable from the Practitioners
card on the setup hub, beside "Open the practitioners". That is the
administrator's way in; the practitioner's own way in is the landing page above.

## 2. The boundary this must not cross

`VISIT-WORKFLOW.md` is explicit: *"The PMS is the register of patients.
AoBPlatform keeps no shadow patient list."* A page called "your waiting
patients" is the most likely place in the whole product to breach that by
accident and quietly become a second, competing waiting room.

**So the page is about paperwork, not about the waiting room.** It answers one
question per person: *is this patient's agreement in place, so the visit can be
billed?* It shows who is waiting only because that is the list the answer
attaches to.

Concretely, it must never carry a reason for the visit, a clinical note, a
triage category, a duration, or anything a practice management system would call
an appointment status. If somebody asks for "and show me why they are here",
that is the PMS, and the answer is no.

**The exception that justifies the page at all.** In the two modes without a
patient-management feed (`QUEUE-TICKETS.md` §1 — manual card, or AoBPlatform
alone), no other screen holds this list. There the page is not duplicating
anything; it is the only place the practitioner can see that the person walking
in has signed.

## 3. What it shows

One row per patient waiting for **this practitioner** today, in the order
reception has them (`FRONT-DESK-PAGE.md` §12.6 — arrival order, or reception's
call order where they have moved somebody).

| Column | Why |
|---|---|
| Card number, where the practice uses them | It is what the room is calling people by (`QUEUE-TICKETS.md`) |
| Name | |
| Waiting since | The arrival time, not a countdown and not a target |
| Paperwork | One of three words: **Done**, **With the patient now**, **Not yet** |

Nothing else. No buttons that act on an agreement: a practitioner does not send
tablets or correct addresses, and a control they will never legitimately use is
a control that will one day be pressed by mistake.

**The one thing the page may do is tell reception.** Where the paperwork is not
done, a single "Ask reception" control that flags it on the front desk page for
that patient. That is the practitioner's real need — "I am about to see somebody
whose form is not signed" — and it belongs to the desk to fix.

## 4. What it must never do

1. **Never block or delay care.** The page reports; it does not gate. A
   practitioner sees a patient whose paperwork says "Not yet" exactly as they
   always would, and the page should say so in as many words rather than leave
   it to be inferred (hard rule 8).
2. **Never show another practitioner's list.** Scoped to the signed-in
   practitioner, enforced at the query, with a cross-practice and
   cross-practitioner test that fails closed.
3. **Never show a Medicare number, or any identifier value** (hard rules 1, 9).
4. **Never say an agreement is approved, certified or accredited** (hard rule 12).
   "Done" means signed and stored, and the word on screen is "Done".
5. **Never become the record of who was seen.** It is a view of today, not a log.

## 5. Where the facts come from

Nothing new should be needed beyond what the front desk already reads.

| Fact | Source |
|---|---|
| Who is waiting, and in what order | The same read the front desk rail uses, filtered to this practitioner |
| Paperwork state | The row's existing signed / live-session / blocked state, flattened to three words |
| Card number | `Arrival.queueTicket` (`QUEUE-TICKETS.md`) |

The flattening to three words belongs in the domain package beside the front
desk's own view function, so the two pages cannot disagree about what "Done"
means.

## 5a. What was built, 12 September 2026

Sections 1, 3, 4 and 5 are built. What differs from the plan above, and why:

**The audience is wider than §3 assumed** (Carl, 12 Sep 2026): *"we need a
better starting point for the practice-admin, practice-manager or
practice-reception who will also be able to see the practitioner-queue."* So
`/practice/practitioner/waiting` has two audiences and two modes — a
`practitioner` sees their own list and only ever their own, and a `practice`
user sees every practitioner's, grouped. The mode is decided by the SERVER from
the token and reported back in `scope`; the browser cannot ask for the other
one. Everything else in §4 is unchanged.

**There is no card-number column.** §3 wants the practice's queue ticket where
they use them, from `Arrival.queueTicket` — and that column does not exist. A
column that is always blank is worse than no column, and a number derived from
something else would be mistaken for the one the room is being called by. It is
left out entirely until the field lands.

**There is a fourth word, and Carl should confirm it.** §3 names three: Done,
With the patient now, Not yet. `ARRIVAL-WHO-IS-SEEN.md` §3 then landed a case
this section was written before — a patient who came only for a specimen
collection is seen by somebody who bills nothing, so the visit decision is
`none` and *"that is a correct, complete answer"*. Neither "Not yet" (a
permanent false alarm) nor "Done" (a signature that does not exist) is honest,
so that row reads **Nothing to sign**. If Carl wants three words, the change is
one line plus its string.

**The way back is in the header, and it depends who is reading** (Carl, 12 Sep
2026: *"needs a link back to today"*, and then, when it was added to the page
body, *"no back to today link in header"*). The shell's back control is where
every other page puts "up", so this page has none of its own. It could not use
the shell's static route→parent map, though: the page has two audiences, and the
one parent the map held — `/practice/practitioner` — is a `practitioner` page, so
`mayReach` correctly refused it to reception and left them with no back link at
all. It is now decided per audience in `parentOf` (`apps/web/app/BackLink.tsx`),
beside `/practice/reports` and `/practice/correspondence` which already worked
that way: `/practice/today` for a practice user, `/practice/practitioner` for a
practitioner. `mayReach` still checks the answer, so neither audience can be
shown a door that does not open. Tests
`back_to_today_is_in_the_header_for_practice_staff` and
`a_practitioner_is_never_offered_a_door_that_does_not_open`.

**"Ask reception" is not built**, per §6: the read-only list is the first
version.

**It refreshes quietly**, taking §6's suggestion: a thirty-second poll, no
sound, no badge, rows keyed on the arrival so a re-read replaces text in place.

**Where it is.** `packages/domain/src/practitioner-queue.ts` (the one
flattening, and the row shape with no field for a clinical fact),
`apps/core/src/practitioner-queue/` (the read — arrivals for today, filtered at
the query, nothing written), `apps/web/app/practice/practitioner/` (both
pages). The landing rule is in `landingPath` (`ROLES.md` §6 rule 5).

## 6. For Carl to decide

- ~~Whose screen is it?~~ PARTLY ANSWERED (Carl, 12 Sep 2026): the practitioner
  signs in via the practice and lands on `/practice/practitioner`. Still open is
  the **consulting-room screen** — one left facing a door, signed in as the
  practice rather than the person. That needs a different view, probably card
  numbers and no names at all, and it should not be assumed to be this page with
  the names removed.
- **What does the page map do about landing?** Today it gates what an audience
  may OPEN. Landing a practitioner somewhere other than `/practice/setup` is a
  routing decision on top of that, and it needs one obvious place to live rather
  than a redirect scattered through pages.
- **Does it refresh itself, and how loudly?** A list that changes under a
  practitioner mid-consultation is a distraction. Suggested: refresh quietly,
  never move a row the practitioner is looking at, and no sound or badge ever.
- **Is "Ask reception" worth building in the first version**, or is the read-only
  list enough to start? NOT BUILT (12 Sep 2026) — the read-only list shipped
  first, and this stays open.
- **Is a fourth word acceptable?** "Nothing to sign", for a visit that needs no
  agreement at all (§5a). Built as an assumption, and Carl's to confirm.

## 6a. The nurse and the phlebotomist (Carl, 12 Sep 2026)

Carl: *"when a patient goes to see the nurse or phlebotomist, the nurse or
phlebotomist can also land on their page to see the patients in their queue."*

Right, and it needs one thing changed first.

**The obstacle.** The platform already knows that a nurse cannot be the provider
on an agreement — `billingRole` is a separate fact from `providerType`, and only
`servicing_provider` may be named on a contract; `works_under_provider` and
`not_billable` may not (`packages/domain/content/billing-roles.json`). Today an
arrival that names one of them is **refused** with `provider_not_servicing`, and
reception is asked to pick the provider the claim goes under instead.

So the person the patient came to see is REPLACED by the person the claim is
billed to, and the nurse disappears from the record. A nurse's queue cannot be
built on top of that, because nothing anywhere says the patient is here to see
the nurse.

**The change.** An arrival should carry both facts, because they are two facts:

| Fact | Today | Needed |
|---|---|---|
| Who the patient is here to see | `affiliationId`, refused if they cannot bill | Kept as given — a nurse, a phlebotomist, anybody the practice rosters |
| Who the claim goes under | The same field, after reception corrects it | Its own field, and still restricted to a `servicing_provider` |

Nothing about the agreement changes: it is still anchored on the billable
provider, the enduring rules are still GP-only, and an unresolved billing
provider is still a refusal. What changes is that the platform stops throwing
away the clinical half of the answer.

**Then the page falls out for free.** `/practice/practitioner/waiting` filters
on "who the patient is here to see", so a nurse sees their own list, a
phlebotomist sees theirs, and a GP sees the patients coming to them — including
those whose bloods are being taken first.

**And what their page says about paperwork is different.** For a nurse, the
agreement is under somebody else. The three words in §3 still work, but the
sentence beneath must not imply the nurse owns it. "Dr Chen's agreement — done"
is honest; "your agreement" would not be.

**One thing it must not become.** A nurse's list is still not a clinical waiting
room (§2). Same boundary, same reasons, and the temptation is stronger here
because a phlebotomy list looks so much like a work queue.

**Named tests for this section:**

- `an_arrival_naming_a_nurse_keeps_the_nurse_and_asks_only_for_the_billing_provider`
- `a_nurse_still_cannot_be_the_provider_on_an_agreement` — the existing rule, unchanged and re-asserted
- `a_nurse_sees_only_the_patients_here_to_see_them`
- `a_nurses_page_names_whose_agreement_it_is`
- `an_enduring_agreement_is_still_never_offered_for_a_non_gp` — hard rule 6, which this must not loosen

## 3a. A status per patient, set from this page (Carl, 12 Sep 2026)

Carl, annotating the grouped view: *"Need buttons or drop down to say 1. With
patient now 2. Pending (patient in queue) 3. Completed (consultation completed)
4. Reassign (to a different Doctor) — Reception will have a task on the
frontdesk/patient page to reassign the patient to a different doctor and do the
necessary checks and so on."*

This supersedes §3's "no control that acts" for ONE narrowly defined write, and
is the mechanism `VISIT-CHECKLIST.md` §5 describes.

| State | Meaning | Who sets it |
|---|---|---|
| **Pending** | In the queue, not yet seen. The default on arrival | Nobody — it is the starting state |
| **With patient now** | The consultation has begun | The practitioner it is with; reception may also |
| **Completed** | The consultation is over | The practitioner it is with; reception may also |
| **Reassign** | This patient should see somebody else | The practitioner. It creates a TASK for reception; it does not move the patient |

**Rules.**

1. **It is attendance, not clinical documentation.** Who, what state, when — from
   the token. No free text anywhere. A note box here becomes a clinical record
   within a week (`VISIT-CHECKLIST.md` §5).
2. **A practitioner may set a state only on their own patients.** Reception may
   set any. Cross-practitioner and cross-practice writes fail closed.
3. **Completed is the service-rendered signal.** It is what raises the
   post-service agreement automatically (`VISIT-CHECKLIST.md` §6). Nothing else
   about the agreement is touched from here.
4. **Reassign never reassigns.** A practitioner pressing it says "not me". Who
   the patient DOES see is reception's decision on the front desk page, where the
   covering-doctor check (an enduring agreement is per practitioner) runs before
   anything is re-papered (D-2026-09-12-03: the patient is asked first).
5. **Never blocks anything** (hard rule 8). An unset state changes nothing about
   whether the patient is seen or billed.
6. **Reversible and recorded.** A wrong state is corrected, and the correction
   is kept beside the original rather than over it.
7. **One control, not four buttons.** A single labelled select per row — four
   buttons across fifteen rows is sixty targets on a screen a doctor glances at.

### 3b. What was built, 12 September 2026

All seven rules of §3a are built, plus every named test below. What differs from
the plan, and why:

**One select per row, rendered from a content file.** The four states live in
`packages/domain/content/visit-states.json` at version `visit-states-2026-09-1`,
schema-validated at load, with the display words in the string table keyed by
the option key (CLAUDE.md §7: *"Any list a user picks from — relationships,
reasons, categories, STATES — lives in a versioned content file"*). The screen
renders that file in file order and carries no list of its own, so a fifth state
is a content change plus a database CHECK, not a code change. The version
travels onto every record written (hard rule 14). The loader refuses a file with
two starting states, a settable starting state, two service-rendered signals, or
one option that is both the signal and a task.

**Pending is shown and cannot be chosen.** §3a's table gives it no setter, so it
is rendered as the current answer — an untouched row reads honestly — and
disabled in the list, refused by the service, and refused again by a database
CHECK (`visit_states_never_stores_the_starting_state`). A stored `pending` would
be somebody moving a patient backwards into "not yet seen" after the
service-rendered signal had already gone.

**A new table, `visit_states`, and it is append-only.** One row per SAYING,
never one per visit: a correction is an INSERT with a later `setAt`, the row it
corrects survives, and the reader takes the newest (§3a rule 6). Nothing in the
application updates or deletes it. There is no column for a note, a reason, a
triage category, a duration, a result or an amount — §3a rule 1 has nowhere to
be broken. Every write carries its `visit.state_set` vault event through the
outbox in the same transaction (hard rule 11).

**Reassign reuses `review_tasks`.** A new kind, `reassignment_requested`, stakes
HIGH — closing it means a person chose a different practitioner, checked whether
the enduring agreement still covers the visit (it is per practitioner × patient,
hard rule 6) and, where it does not, asked the patient (D-2026-09-12-03). No
automated check can make that comparison. The task's subject is the PATIENT, so
it lands on their own work page at the desk through the existing
`openForPatients` join; the arrival travels in `detail`. No new table, no second
inbox. Nothing about the arrival changes: the named test asserts the whole row
is byte-for-byte what it was.

**"Completed" is wired to the signal, and the DATA is what is missing — Carl's
to decide.** It calls `ArrivalsService.serviceRendered` and reimplements none of
the decision (hard rule 14). But a post-service agreement's particulars include
D6b, the MBS item number(s), and REQ-REG-01 sources them from the PMS invoice —
which a practitioner pressing a button does not have. So the signal is passed
through where the practice's own software has ALREADY said what was done (an
undecided `service_records` row carrying its own D5 and D6b, which is what the
invoice sync writes), and otherwise the state is recorded with
`awaiting_item_numbers` beside it and **nothing is drafted**. No item number is
ever invented (CLAUDE.md §7). Written up as **D-2026-09-12-07** with the three
ways Carl could close it.

**Authorisation is the read's own answer, shared.** `resolveScope` serves both
the GET and the POST, so what a practitioner can SEE and what they can SET
cannot drift apart. Not `@PracticeScoped()`, for the reason the GET already
gives at length: that decorator requires a practice CLAIM and a practitioner's
token deliberately carries none, so it would close the control to the audience
§3a wrote it for. Cross-practice fails closed twice over — the practitioner's
practice is checked against their live affiliations before any scope opens, and
RLS then hides the row, so the answer is "no such visit" and names nobody.

**Where it is.** `packages/domain/content/visit-states.json` and
`packages/domain/src/visit-states.ts` (the list, the loader, `latestVisitState`
and `maySetVisitState`), `apps/core/prisma/migrations/20260912020000_visit_state/`,
`apps/core/src/practitioner-queue/` (the POST, the authorisation, the
service-rendered hand-off, the task), `apps/web/app/practice/practitioner/waiting/`
(the select).

**Named tests:** `a_practitioner_may_set_a_state_only_on_their_own_patients`,
`completed_raises_the_post_service_agreement`,
`reassign_creates_a_front_desk_task_and_moves_nobody`,
`a_state_change_records_who_and_when_and_no_text`,
`an_unset_state_never_gates_a_consultation_or_a_bill`,
`a_state_can_be_corrected_and_the_correction_is_kept`,
`state_changes_across_a_practice_boundary_fail_closed`.

## 7. Named tests

- `the_waiting_list_shows_only_this_practitioners_patients` — fails closed across both practitioner and practice.
- `the_waiting_list_carries_no_clinical_detail` — no reason, no note, no triage, no duration.
- `the_waiting_list_never_gates_a_consultation` — hard rule 8, and the copy says so.
- `paperwork_reads_done_only_when_it_is_signed_and_stored`.
- `the_waiting_list_and_the_front_desk_agree_on_the_same_patient` — one flattening function, driven from the same row.
- `the_waiting_list_carries_no_identifier_values` — hard rule 9.

## Change log
| Date | Change |
|---|---|
| 12 Sep 2026 | v1.0. Written when Carl asked for a practitioner-facing queue page. Not built. |
| 12 Sep 2026 | Route decided by Carl: `/practice/practitioner` landing, with the queue beneath it. Reachable from the Practitioners card. |
| 12 Sep 2026 | §6a: nurses and phlebotomists get the same page, once an arrival can carry who the patient is here to see separately from who the claim goes under. |
| 12 Sep 2026 | Built (§1, §3, §4, §5). Audience widened by Carl: reception, managers and administrators see every practitioner's list, grouped. No card-number column (`Arrival.queueTicket` does not exist). A fourth word, "Nothing to sign", recorded as an assumption in §5a. |
| 12 Sep 2026 | The way back moved into the shell's header and is decided per audience: `/practice/today` for practice staff, `/practice/practitioner` for a practitioner (§5a). |
| 12 Sep 2026 | §3a: a per-patient status set from this page — Pending, With patient now, Completed, Reassign. Completed is the service-rendered signal; Reassign creates a front-desk task. |
| 12 Sep 2026 | §3a **built** (§3b). Four states as versioned content (`visit-states.json`), an append-only `visit_states` table with its vault event, Reassign on the existing `review_tasks` queue as `reassignment_requested`. Completed is wired to `serviceRendered` but raises a post-service agreement only where the invoice already carries D6b — no item number is invented (**D-2026-09-12-07**, Carl's to confirm). |
