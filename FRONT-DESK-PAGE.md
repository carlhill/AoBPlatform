# FRONT-DESK-PAGE.md — the page a new starter can work on day one
### v1.0 · 12 September 2026 · Owner: Carl. A plan, not yet built. Companion to `VISIT-WORKFLOW.md` (what has to happen), `PATIENT-WORKFLOW-PAGE.md` (what stands for a patient) and `PMS_to_AoB_Workflow.md`. Hard rules from CLAUDE.md §2 apply unchanged.

Carl, 12 September 2026: *"a more effective and efficient page for processing a
customer at the Practice… a new page. We will leave all current pages as is. The
current pages are still effective for an admin style view or a more experienced
reception user. The new page should be designed so that a young person between
18-20 years can start to be productive on day 1."*

---

## 1. The test this page has to pass

A seventeen-week-casual, first shift, no training beyond "this is the screen you
use". They should be able to process the whole morning without asking anybody,
and without being able to do anything they cannot undo.

That is a **presentation** problem, not a new system. Every rule, endpoint and
policy stays exactly as it is; this page shows less of it and says it in the
words the job is done in.

## 2. The one thing the page is for

From `VISIT-WORKFLOW.md`: **the practice cannot bill unless an approved
agreement exists for this practitioner on this day.** Everything the front desk
does about AoBPlatform is in service of that one sentence.

So the page answers one question per person — *is this patient's paperwork done,
and if not, what is the single next thing I do?* — and nothing else. Reporting,
history, corrections, device management and evidence all stay where they are, on
the pages Carl wants kept.

## 3. Why the current desk is hard on a first day

Not because it is badly built. Because it is an expert tool, and it is honest
about a domain that has a lot in it.

- **It is a board, not a queue.** Seven rows, each with its own controls, all
  live at once. A new starter has to decide *which* row to work as well as *what*
  to do, and nothing on screen says which is most urgent.
- **The vocabulary is the regulator's, not the room's.** The strings carry
  "enduring" 15 times, "affiliation" 14, "particulars" 11, "assignor" 11,
  "artefact" 8, "attestation" 5, plus "supersede", "episodic_pre" and
  "episodic_post". Every one is correct. None is a word a nineteen-year-old has
  heard before Tuesday.
- **There are at least eight distinct reasons a row can be stuck**, each with
  its own fix, and telling them apart is the job. An expert reads the reason and
  knows; a beginner reads it and stops.
- **The numbered strip is a good expert affordance and a poor first-day one.**
  ①②③ teaches the sequence beautifully once you know what the steps ARE.

## 4. The shape: one person, one question, one button

**A single column. The queue on the left is a list of names and a status word,
nothing else. Selecting one fills the page with that person and one action.**

The action panel only ever shows one primary button, and its label is the
sentence the person would say out loud:

| Situation | What the page says | The one button |
|---|---|---|
| Nothing on file, patient here | "Jamie needs to agree to bulk billing for today's visit with Dr Huang." | **Ask Jamie on a tablet** |
| Already covered by an ongoing agreement | "Nothing to do. Jamie already has an ongoing agreement with Dr Huang." | **Done — next patient** |
| On a tablet now | "Jamie is reading it on the blue tablet." | **Bring it back** (and a quiet "having trouble?") |
| Patient crossed a detail | "Jamie says their address is wrong. Fix it, then send it again." | **Fix the address** |
| Someone else is signing | "Who is signing for Jamie?" | **It's the patient** / **Someone else** |
| Signed | "Done. Jamie signed at 9:42." | **Next patient** |
| Cannot proceed | "This one needs someone with more access." | **Get help** — hands the same patient to the admin page |

**Secondary actions live behind one "More" control**, never beside the primary
one. A first-day user should not be choosing between two buttons that both look
like the answer.

**The queue orders itself by who has waited longest** (already true since the
arrival-ordering fix) and marks exactly one row "do this next". Not a priority
scheme — the top of the list, said out loud, so there is no decision to make.

## 5. The words

A vocabulary table is part of the build, not a documentation afterthought. All
of it lives in the string table like everything else (REQ-LANG-01).

| Never on this page | Say instead |
|---|---|
| Assignor | The person signing |
| Episodic agreement | Agreement for today's visit |
| Enduring agreement | Ongoing agreement with Dr X |
| Supersede | Replace |
| Particulars | The details on the form |
| Capture request | (nothing — it is our bookkeeping, not their job) |
| Affiliation | Dr X at this clinic |
| Artefact / render / hash | (nothing — never shown here) |
| Attestation | The tick confirming they are 18 or over |
| `assignor_not_confirmed` | "We need to know who is signing first." |

The banned words are the same list CLAUDE.md §2 rule 12 already bans, extended
with the domain terms. **A lint rule on this page's strings** is the enforcement,
the same shape as the kiosk's storage lint — otherwise the vocabulary drifts back
the first time somebody reuses a string.

## 6. What makes it safe for a beginner

1. **Nothing irreversible without a plain sentence.** Recall, replace and "no
   change needed" all confirm in words, naming what will happen and to whom.
2. **No control that can be pressed too early.** The existing gate stays: the
   tablet cannot be sent until who-is-signing is answered. On this page that is
   not a greyed button — the question simply comes first, on its own.
3. **Every dead end has an exit.** "Get help" is always present and always
   carries the patient with it to the admin page. A beginner who is stuck must
   never have to explain which row they were on.
4. **It cannot invent a decision.** Enduring versus episodic is decided by the
   versioned visit policy, exactly as at arrival. This page never offers a
   choice the policy has already made.
5. **The platform never blocks care** (hard rule 8). If AoBPlatform is down, the
   page says "see the patient anyway — we will catch the paperwork up", because
   that is the truth and a beginner is the person most likely to think otherwise.

## 7. Where every fact comes from — reuse, never re-derive

Same rule as `PATIENT-WORKFLOW-PAGE.md`, and it matters more here because a
second implementation aimed at beginners would be the one that quietly goes
wrong.

| Fact | Source |
|---|---|
| Who is waiting and in what order | `GET /tablet-sessions/pushable` — already ordered by arrival through the supersession chain |
| What today needs | `decideVisitAgreement()`, with its rule key and policy version |
| What already stands | `enduring.coverage(practiceId, { patientId, practitionerId })` |
| Why a row is stuck | The server's `blockedReason`, mapped to a sentence and a destination — never a generic fallback (CLAUDE.md §7) |
| Sending, recalling, correcting, confirming who signs | The existing endpoints, unchanged |

**No new endpoint should be needed.** If one is, that is a signal the page is
trying to be a different system rather than a different view, and it should be
questioned before it is built.

## 8. Named tests

- `front_desk_shows_one_primary_action_per_patient` — never two buttons that both look like the answer.
- `front_desk_never_uses_a_domain_word_from_the_banned_list` — the lint plus a test over the page's strings.
- `front_desk_orders_by_who_has_waited_longest` — and marks exactly one row as next.
- `front_desk_asks_who_is_signing_before_it_offers_a_tablet` — the gate as a sequence, not a disabled control.
- `front_desk_maps_every_server_reason_to_a_sentence_and_a_destination` — driven off the reason list so a new code fails the test rather than showing a code to a beginner.
- `front_desk_get_help_carries_the_patient_to_the_admin_page`.
- `front_desk_says_see_the_patient_anyway_when_the_platform_is_unreachable` — hard rule 8.
- `front_desk_never_offers_an_enduring_agreement_for_a_non_gp` — hard rule 6, and the one regulatory mistake a simplified page is most likely to make.
- `front_desk_confirms_in_words_before_anything_irreversible`.
- Cross-practice: `front_desk_across_a_practice_boundary_shows_nothing`.

## 9. How we know it worked

Worth agreeing before building, because "easier" is otherwise unfalsifiable.

- A person who has never seen it processes ten patients with no help and no
  wrong turns that need an admin to undo.
- Time from selecting a patient to the tablet being sent, compared with the
  current desk.
- Count of "Get help" presses — the honest measure. Some is right; a lot on one
  situation names the next thing to fix.

## 10. Phasing

1. **The read and the words.** A `frontDeskView(row)` function in the domain
   package turning a queue row plus the policy answer into `{ situation,
   sentence, primaryAction }`. Pure, fully tested, no UI. This is where the
   thinking is; get it right before anything is drawn.
2. **The page.** One column, the queue, the action panel. Read-only actions
   first — select, look, "next patient".
3. **The actions**, wired to the existing endpoints in the order a shift needs
   them: who is signing, send to tablet, bring it back, fix a detail.
4. **The exits.** "Get help", the outage message, the confirmations.

## 11. For Carl to decide

- ~~Where it lives and who lands there.~~ ANSWERED 12 Sep 2026 (Carl): a
  separate route, `/practice/frontdesk`, linked from the setup hub as "Practice
  Frontdesk". The existing pages stay exactly as they are.
- **Is it one patient at a time, strictly?** The single-column design assumes so.
  A busy Monday with four people at the counter may want two open at once, which
  changes the shape more than it sounds.
- **Does it cover the post-service second push too**, or only pre-service? The
  second push is reception's job as well, and leaving it off the beginner page
  means a beginner still has to visit the expert one.

## 12. The queue rail: who is in flight, who is yet to arrive (Carl, 12 Sep 2026)

Carl: *"we need to have like a queue on the left or the right of the page to
show which patients are in flight and which patients are yet to arrive."*

### 12.1 The honest state of the data

**In flight is fully answerable today.** `GET /tablet-sessions/pushable` already
returns everyone with something open, ordered by when the patient arrived, with
each row carrying its live session and its blocked reason.

**Yet to arrive is not, and this is the important finding.** It comes from the
appointment book, and the appointment book reaches us only when the practice
management system pushes it — `captureForAppointment` writes `Appointment` rows
from the auto-capture path. **The dev database currently holds zero
appointments, today or ever.** In production it depends on the connector, which
is still behind blocker D-01.

So the rail must be built to show a section that is legitimately empty, and to
say WHY it is empty rather than looking broken. "No appointments received from
the practice software" is a true and useful sentence; a blank panel is neither.

### 12.2 The shape

**A rail on the LEFT, not the right.** Reading order puts it first, and it
answers "who am I working on" before "what do I do", which is the order a
beginner needs. The right is where the eye goes last, and this is the thing they
look at between every patient.

Three groups, top to bottom, and the order is the point:

1. **Here now** — arrived, something to do. Ordered by longest wait. Exactly one
   is marked as next.
2. **On a tablet** — sent, being read or signed. Shows the device name, because
   "the blue one" is how the desk talks. Not actionable from the rail; selecting
   one shows what it is doing.
3. **Expected** — appointments today with no arrival yet, in time order. When
   there is no appointment feed, one line saying so, not an empty box.

A count on each group heading. Nothing else: no status chips, no reasons, no
buttons. The rail is a place to LOOK; the panel is where you act.

### 12.3 Rules the rail must obey

- **Selecting never acts.** Clicking a name fills the panel. Nothing is sent,
  recalled or confirmed from the rail, ever. A beginner scanning the list must
  not be able to change anything by accident.
- **The rail does not re-sort under the hand.** The desk polls every few
  seconds, and a list that reorders while somebody is reaching for it is how
  the wrong patient gets selected. New arrivals appear; existing rows hold their
  place until the selection is cleared or the patient leaves the list.
- **It never shows more than a name, a time and a group.** No condition, no
  provider's opinion, no reason. A rail at a front desk faces the room — this is
  the same reasoning that hides the waiting list on the tablet.
- **"Expected" is not a work list.** Nothing there can be actioned; a patient who
  has not arrived cannot sign. It exists so a beginner can see the shape of the
  morning, and so an empty "Here now" does not read as "nothing to do today".
- **One live region, politely announced.** A patient moving from Expected to
  Here now is worth a screen-reader announcement; every poll is not. `aria-live`
  goes on the group counts, not on the rows.

### 12.4 Where each group comes from

| Group | Source | Notes |
|---|---|---|
| Here now | `GET /tablet-sessions/pushable`, rows with no live session | Already arrival-ordered through the supersession chain |
| On a tablet | The same rows, where `activeSession` is set | The device label is already on the row |
| Expected | Today's `Appointment` rows with no matching arrival | **Needs a new read.** The only new endpoint the front desk should require, and it is a read of a table we already write |

The Expected group is the one exception to "no new endpoint" in §7, and it is
worth stating why it is allowed: the data exists, nothing else exposes it, and
the alternative is the page inferring who is missing, which it must not do.

### 12.5 What this needs before it can be finished

- ~~**An appointment feed.** Until the connector pushes the appointment book,
  Expected is permanently empty in every real practice. Worth confirming with
  Carl whether the front desk page ships with the group visible-but-empty (with
  its explanation) or hidden until a feed exists.~~ **BUILT VISIBLE, 12 Sep
  2026, as the recommendation said and as an assumption still for Carl to
  confirm.** The group renders with its count, the line "No appointments
  received from the practice software" and a sentence saying what will fill it,
  so the absence is a visible gap rather than a silent one and a practice
  asking "why can't I see my bookings" gets an answer from the screen. Test:
  `front_desk_expected_group_says_why_it_is_empty`.
- **A decision on the second question in §11** — strictly one patient at a time.
  The rail makes multi-select technically easy and conceptually expensive; the
  design above assumes one.

### 12.6 Reception can change who is next (Carl, 12 Sep 2026)

Carl: *"we need to allow reception to change the place of a patient in the
queue. This is how the walk-ins can be processed between other patients."*

**The distinction that makes this safe.** Two different things are being
confused if this is built carelessly:

| | What it is | May it be edited? |
|---|---|---|
| **Arrival time** | When the patient actually turned up. A fact, recorded on the arrival, and part of the record | **Never.** It is evidence, and it is also what stops a corrected card jumping to the bottom of the queue (the fix of 11 Sep 2026) |
| **Call order** | Who reception intends to see next. An operational decision that changes through the morning | **Yes.** That is the whole request |

So this is a new, optional `callOrder` on the visit that OVERRIDES the display
order, with the arrival time untouched underneath and still the tie-break for
everyone who has not been moved. Sort is: anyone with a call order, in that
order, then everyone else by arrival. Nothing about the agreement, the
supersession chain or the evidence is touched.

**How reception moves somebody.**

- **"See next"** — the common case by far. A walk-in needs to go in front of the
  queue, or a patient has been waiting too long. One button, no arithmetic.
- **Move up / move down** — for the rest. Buttons rather than drag-and-drop:
  drag is hostile to a first-day user, awkward on a touch screen at a counter,
  and effectively unusable from a keyboard or a screen reader. Drag can be added
  later as an *additional* way, never the only one (WCAG 2.2 AA, and
  `FRONT-DESK-PAGE.md` §6's rule that nothing important is reachable one way).
- **"Put back in arrival order"** — clears the manual order for everyone. There
  will be mornings where the list has been shuffled into nonsense, and the way
  out must be one obvious control rather than moving eight people by hand.

**Rules.**

1. **It never edits the arrival.** The arrival time stays exactly as recorded.
2. **It is a display order, not a claim about anything.** Nothing downstream
   reads it — not the agreement, not the policy decision, not the evidence.
3. **It says who moved whom and when.** Being seen before somebody who arrived
   earlier is a decision a practice may be asked about, so it is recorded with
   the staff member and the time. Not a vault event: this is practice operations,
   not agreement evidence.
4. **It resets with the day.** A call order means nothing tomorrow.
5. **It does not touch the card number.** Where a practice uses numbered cards
   (`QUEUE-TICKETS.md`), the number is the PATIENT's handle and the order is
   RECEPTION's; moving somebody up does not renumber their card, and the rail
   shows both without implying they agree.
6. **The rail still must not re-sort under the hand** (§12.3). A manual move is
   the one reorder the user asked for, so it animates and is announced; a poll
   arriving a second later must not undo it.
7. **Moving somebody is not calling them.** This page does not run the waiting
   room; it records who is next so the paperwork follows the room. No display
   board, no announcement, no "now serving".

**Named tests**, in addition to §8:

- `changing_the_call_order_never_changes_the_arrival_time`
- `see_next_puts_a_walk_in_in_front_without_moving_anybody_elses_arrival`
- `an_unmoved_patient_is_still_ordered_by_arrival`
- `the_call_order_is_recorded_with_who_changed_it`
- `putting_the_queue_back_in_arrival_order_clears_every_manual_position`
- `the_call_order_does_not_change_a_queue_ticket`
- `a_poll_does_not_undo_a_move_reception_just_made`

## Change log
| Date | Change |
|---|---|
| 12 Sep 2026 | v1.0. Written when Carl asked for a front-desk page a day-one starter could work. Not built. |
| 12 Sep 2026 | §12: the queue rail — in flight, on a tablet, expected; and the finding that the appointment feed does not exist yet. Route fixed as /practice/frontdesk. |
| 12 Sep 2026 | §12.6: reception can change who is next, as a call order that overrides display without ever editing the arrival time. |
| 12 Sep 2026 | **First slice BUILT** — the route `/practice/frontdesk` (page-access `['practice']`, back link to the setup hub), the "Practice Frontdesk" card beside "Send to the tablet" on the setup hub, and §12's rail. The right-hand panel is a placeholder: it names the chosen person, says what happens next in a sentence and says plainly that §4's one-button action panel is still to come, because its words and its situations need Carl's sign-off first. §12.6's call order is NOT built. |
| 12 Sep 2026 | The one new read of §12.4 exists: `GET /arrivals/expected` (`@PracticeScoped`), today's appointments with no arrival today, carrying an appointment id, a patient id, a name and a time — and nothing else. It lives in the arrivals module because "who has not arrived" is defined by the absence of an arrival. |
| 12 Sep 2026 | §5's vocabulary is enforced twice: a lint over the `frontdesk` block of `strings.ts` inside `npm run lint -w apps/web` (comments exempt, so the block can explain its own rule), and the test `front_desk_rail_never_uses_a_domain_word_from_the_banned_list` over every string the surface owns. |
| 12 Sep 2026 | **A pre-existing defect found while building, NOT fixed here.** "Today" has two definitions in the codebase. `today()` in `tablet-sessions.service.ts` — which `pushable` uses to decide whether an appointment is today's — is the **UTC** date, so on a host running in Australia/Sydney it reads as *yesterday* for the first ten hours of the practice's morning (8am AEST is 22:00 UTC the day before). `GET /arrivals/expected` uses the **local** calendar day, because "who is booked in today" is a question about the room. On a UTC host (Fargate's default, and CI's) the two agree, which is why nothing catches it. They should be one helper; which definition wins is Carl's call, not a build's, so `pushable` was left exactly as it was. |
| 12 Sep 2026 | **Two assumptions for Carl, made mid-build.** (a) Expected renders visible-but-empty, per §12.5's recommendation. (b) Nobody is named twice: a person already on the queue is not also listed under Expected, because a booking can carry a draft before its patient walks in. The queue wins — it is the list with work on it. Test: `front_desk_expected_never_names_somebody_already_on_the_queue`. |
