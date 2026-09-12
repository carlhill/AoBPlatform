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
- ~~`front_desk_get_help_carries_the_patient_to_the_admin_page`~~ — **superseded by
  §13, 12 Sep 2026.** "Get help" no longer carries anybody anywhere. The test
  that stands in its place is
  `front_desk_get_help_reveals_the_expert_controls_without_leaving_the_page`.
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

## 13. Nothing about the patient leaves this page (Carl, 12 Sep 2026)

Carl, approving the build: *"Everything to do with the patient must be on this
page - no going to another page."*

This is a constraint on every earlier section, and it overrides two of them:

- **The placeholder's "Open Send to the tablet" link goes.** Who is signing,
  choose a tablet, send, recall, re-send, fix a detail — all of it happens in the
  right-hand panel for the selected patient. The numbered strip and the
  correction panel already exist on `/practice/tablet`; they are reused in place
  here, not linked to.
- **"Get help" (§4, §6 rule 3) no longer carries the patient to another page.**
  It reveals the expert controls for that patient inside the panel. The admin
  desk stays where it is for the people who prefer it; a beginner is never sent
  there mid-task.

**What still may leave the page:** nothing that is about the patient. Practice
configuration and evidence review are not patient work and keep their own pages.

**The visit checklist (`VISIT-CHECKLIST.md`) lives in the same panel**, above the
actions, so one screen answers "what is this patient here for, what is done,
and what do I do next".

## 14. The rails partition the day, so the two pages reconcile (Carl, 12 September 2026)

Carl, with `/practice/frontdesk` open beside `/practice/practitioner/waiting`:
*"Both pages have to reconcile. Have another list if you have to on frontdesk
as every patient has to be seen."* And, on the `3 people` / `0 people` counts:
*"Make the font bold and a diff colour for the number - so it stands out."*

### 14.1 What was wrong

The waiting page showed **15** people for the day and the desk showed **3**.
Both numbers were right and neither said so, which makes the desk look broken.
Measured on the dev database, the fifteen were:

| | Arrivals | Where they were on the desk |
|---|---|---|
| Signed and finished | 8 | nowhere |
| Replaced by a corrected agreement | 4 | only as their successor, under somebody else's row |
| Something open | 1 | Here now |
| Unsigned, nothing open for them | 2 | **nowhere** |

The last two are the reason this section exists. They came in, they owe a
signature, nothing is waiting for them, and **no screen in the product named
them**. A patient in that state is the worst thing this desk can hold, because
it is the only kind of problem nobody can be asked to fix.

### 14.2 The fix is a partition, not a fourth list

A list that is merely ADDED goes missing again the next time somebody tightens
a filter. A partition cannot. **Every row of the day register lands in exactly
one rail**, so the rails sum to the register's own count by construction rather
than by two screens happening to agree.

| Rail | What is in it | In the total? |
|---|---|---|
| **Here now** | Came in, something to do, no tablet out | yes |
| **On a tablet** | Reading or signing right now | yes |
| **Finished** | Came in, nothing left — signed, or nothing to sign | yes |
| **Needs a look** | Came in, has not signed, nothing open. The anomaly rail | yes |
| **Not arrived today** | Paperwork open at the desk with no arrival recorded today | **no** |
| **Expected** | Booked today, has not come in | **no** |

**The denominator is `GET /arrivals/day` and not the queue.** The queue is a
list of WORK, so it drops a person the moment their paperwork is done, is
replaced, or runs out of road — which is exactly how twelve people went
missing. The register is the only read at this practice that keeps everybody.
Both pages ask the same endpoint the same question with no date, so "today" is
the server's answer by the practice's clock and never the browser's guess.

**Supersession disappears at the join.** A register row carries the NEWEST
agreement in its chain (`newestAgreementInChain`) and the queue only ever
carries the newest (`readPushableRows` excludes anything replaced), so a
corrected patient's arrival and their successor agreement meet on one id. The
four "replaced" rows above now sit under their own names.

**One fallback, on the person.** `offerEpisodicInstead` creates a new agreement
that does not supersede the one it stands in for — it cannot, they are
different instruments with different evidence — so that patient's arrival and
their queue row share no agreement id. What is left over is matched by patient,
in arrival order, one queue row to one arrival. Without it a single visit would
be counted twice: once as an anomaly and once as work.

### 14.3 Rules the new rails obey

1. **Finished and Needs a look are not controls.** There is no queue row behind
   either, so there is nothing for the panel to be about and no act that could
   be offered; a button that fills the panel with nothing is a dead end a
   first-day starter cannot get back out of. They are rows to read (§12.2).
2. **"Needs a look" says what it means, in the room's words.** Nobody was held
   up — they were seen as usual (hard rule 8) — it is the paperwork that has to
   be caught up.
3. **A visit with nothing to sign is Finished, never an anomaly.** "Not yet"
   against somebody who came in for a blood test would be a permanent false
   alarm, and a rail people learn to ignore is the same as no rail. Same
   reasoning as `signedLabel` on `/practice/day`.
4. **The register failing does not empty the desk.** Until it lands, and for as
   long as it fails, the rail is the two queue-only groups the page had before
   and there is no total. Hard rule 8: a read that failed slows the evidence,
   never the service.
5. **The number is picked out of its heading, not shouted.** `--accent`
   (#1f4d7a) on `--surface` (#ffffff) is 8.6:1 — past AA and past AAA — and it
   is already what the "Do this next" mark uses, so no colour was invented.
   Colour is never the only signal (1.4.1): the number is bold and a size
   larger, and the whole count is still spoken as one sentence by the live
   region beside it.

### 14.4 Named tests

- `front_desk_rails_add_up_to_the_day_register` — **the deliverable.** Rendered,
  not only computed, because the drift being guarded against is a SCREEN
  quietly showing fewer people than the day holds.
- `front_desk_every_arrival_is_in_exactly_one_rail` — the same claim made
  structurally, over `dayRails`.
- `front_desk_a_corrected_patient_is_counted_once_not_twice`
- `front_desk_needs_a_look_names_whoever_owes_a_signature_and_has_nothing_open`
- `front_desk_a_visit_with_nothing_to_sign_is_finished_and_never_an_anomaly`
- `front_desk_work_with_no_arrival_recorded_today_is_shown_and_left_out_of_the_total`
- `front_desk_an_agreement_offered_instead_still_belongs_to_its_arrival`
- `front_desk_without_the_day_register_still_shows_everybody_on_the_queue`
- `front_desk_the_count_draws_the_number_apart_from_the_word`

### 14.5 For Carl to decide

- **There is still no control that restarts a "needs a look" patient's
  paperwork.** The rail makes them visible, which was the ask; what reception
  presses next does not exist. The honest options are a "start it again" that
  opens a fresh capture on the existing agreement, or leaving it to the
  post-service chase. Building half of one would be worse than neither
  (§6's reasoning about "ask reception"), so nothing was built.
- **"Not arrived today" is shown only when it has somebody in it**, unlike
  "Expected", which is always visible because its emptiness needs explaining.
  Assumption, made mid-build.
- **The total counts arrivals, not distinct people** — which is what
  `/practice/day` counts, and matching it is the point. On the dev database's
  fifteen-arrival day that is eight people who came in fifteen times. If the
  word should be "visits" rather than "people", it changes on both pages
  together or not at all.


## 15. What the rail says about each person, and in what order (Carl, 12 September 2026)

Six notes, all made with the new rails on screen. They are here rather than
folded into §14 because §14 is about the ARITHMETIC and these are about the
reading.

### 15.1 "Here now" is always in the order people will be seen

Carl: *"always sort Here Now in seq of being seen."* That is arrival order, and
it is the SERVER's answer twice over: `readPushableRows` walks each agreement
back through `supersedesAgreementId` to the arrival that started it (the fix of
11 September 2026, so a corrected card keeps its place), and the day register is
`arrivedAt asc`. **Nothing on this page may re-sort it**, which is what
`front_desk_here_now_is_in_the_order_people_will_be_seen` asserts, by handing
the page a register and a queue whose orders differ and requiring the
register's.

### 15.2 The number on the card leads each row

Carl: *"Show the practice-queueid - the card with the number or from the PMS or
the Q-id AoB allocated."* `QUEUE-TICKETS.md` is the design and its build steps 1
and 3 are now done; see that document's change log. The number is the PATIENT's
handle, never the running order (§5a there), and it is not an identity
identifier (hard rule 1).

### 15.3 A way to see everyone at once

Carl: *"provide a button to go look at all patients here now (like we have in
section [1] of /tablet page)."* It points at `/practice/tablet`, whose section 1
IS that list, rather than growing a second everybody-at-once view here — the
pairing already exists in the other direction ("Work one patient at a time →").
It navigates and acts on nothing, and it is not about a patient, so §13 stands.

### 15.4 The tablet's name on the rows that have one

Small, quiet, under the name, printed exactly as the practice wrote it with
nothing added around it — a sentence built around the label produces "has the
Blue tablet tablet".

### 15.5 "Finished" goes below "Needs a look"

Finished is the one arrived rail nobody has to act on, so it goes last of them.
The order is: Here now, On a tablet, Needs a look, Finished, Expected — with
"Not arrived today" between them when it has anybody in it.

### 15.6 A colour per rail, on the heading and the number

Carl: *"Put colour on the list heading and the number. Reason: I want my eye to
be drawn to each list."*

**The reason decides the design.** This is a set of LANDMARKS, not a severity
scale: Carl is locating the lists, not triaging them, so each rail carries its
own colour and none of them ranks the others. The alternative that was argued
for and rejected — one amber signal on "Needs a look" and everything else
de-emphasised — answers a question he did not ask.

| Rail | Token | Contrast on `--surface` |
|---|---|---|
| Here now | `--ink` (uncoloured, and the strongest treatment: it is the work) | 15.9:1 |
| On a tablet | `--ok` | 6.5:1 |
| Needs a look | `--warn` | 6.6:1 |
| Finished | `--info` | 8.6:1 |
| Not arrived today, Expected | `--ink-muted` | 7.4:1 |

Every value is an existing token and every one passes WCAG 2.2 AA for small
text. **Colour is never the only carrier** (1.4.1): every heading says in words
what its rail is, the counts are spoken as whole sentences by the live region
beside them, and there is no key to learn.

`--info` is the same hex as `--accent`, which `tokens.css` reserves for focus
and the primary action. Carl has decided the blue stays; the distinction is kept
as a TREATMENT — the accent is a solid FILL on a button, this is text on a plain
background.

### 15.7 One person, the same two ids, on both desks

Carl: *"patientid is diff on /tablet and /frontdesk"*, then *"ok. In that case
show both ids."*

**Neither page was wrong, which is why it looked like a bug.** The front desk
printed the PRACTICE's own number — the handle reception reads out and types
into their own software. The tablet desk printed the id this platform minted,
which is what a support ticket needs because a practice number is not unique
across practices. A receptionist moving between the two in the same minute saw
two identifiers for one patient.

So both, in one order, from one component: `PatientIdentity` in
`apps/web/app/ui/index.tsx`, with one pair of words in `strings.recordId`.
The practice's number first and prominent; ours underneath, quieter, keeping
its Copy control. A missing practice number is said out loud; ours always
exists and needs no such twin. Named tests:
`the_tablet_desk_and_the_front_desk_name_a_patient_the_same_way` and
`a_patient_with_no_practice_number_says_so_on_both_desks`.

### 15.8 Named tests

- `front_desk_here_now_is_in_the_order_people_will_be_seen`
- `front_desk_shows_the_number_on_the_card_in_the_patients_hand`
- `queue_tickets_are_invisible_when_the_practice_does_not_use_them`
- `front_desk_offers_a_way_to_see_everyone_here_at_once`
- `front_desk_names_the_tablet_a_patient_has`
- `front_desk_puts_finished_below_needs_a_look`
- `front_desk_gives_each_rail_its_own_colour`
- `the_tablet_desk_and_the_front_desk_name_a_patient_the_same_way`


## 16. "Finished" means the visit is over (D-2026-09-12-20; VISIT-CHECKLIST.md §3a)

Carl, with the two pages side by side: *"on /frontdesk the patient goes to
'Finished list' yet on /waiting the dr has not seen the patient as yet. Hence,
we need a step 'Consultation completed'."* And, reaching the same model from the
other end: *"What you call 'Paper work' per patient, I call the patient service
list… Only when all services are completed or some are cancelled does the client
go to Finished."*

**The word was doing the lying.** Signing happens in the waiting room, BEFORE
the service, so the desk announced that a patient was finished while the
practitioner had not yet called them in.

### 16.1 What was built

- **The service list gains the visit itself**, between "Signed on a tablet" and
  "Signed after the visit" — where Carl drew it. It reads the visit state the
  practitioner already sets from `/practice/practitioner/waiting`; it never
  mints one, because two screens disagreeing about whether a patient has been
  seen is worse than the bug. `PushableRow.visitState` carries it, read through
  the same chain walk that carries the arrival time and the card number.
- **Finished is "every service on the list is resolved"**, written over the
  list (`everyServiceResolved`) rather than as `signed && seen`. Today the list
  holds the signature and the visit, so it reduces to the narrower rule; when a
  practice's own items arrive, Finished changes meaning without that condition
  being edited.
- **`cancelled` joins `done` / `outstanding` / `not_needed`** as a state, and
  counts as resolved. *Nothing produces it yet* — the computed rows are derived
  and cannot be dropped — but the type and the word exist so nobody later has to
  guess what "resolved" was meant to include.
- **A new rail, "Waiting to be seen"**, between "Needs a look" and "Finished".
  Somebody who has signed and has not been called in is not an anomaly (nothing
  is wrong) and is not the desk's work (there is nothing for reception to do).
  Without it, "either one alone leaves the patient on the desk" has nowhere to
  put them.
- **The panel's section is called the patient service list**, Carl's name. The
  scope did not widen with it: it records what the practice said would happen
  and whether it happened, never a reason, a finding, a note, a triage category
  or a duration.

### 16.2 It gates nothing

Hard rule 8, REQ-REC-04. No value of the visit state disables a control,
refuses a send or changes whether a patient is seen or billed. The step is a
report.

### 16.3 Named tests

- `a_signed_agreement_alone_does_not_finish_a_visit`
- `finished_needs_the_paperwork_done_and_the_visit_complete`
- `finished_is_every_service_resolved_and_not_a_pair_of_booleans`
- `the_visit_checklist_carries_the_consultation_between_signing_and_afterwards`
- `the_front_desk_and_the_practitioner_queue_never_disagree_about_who_has_been_seen`
  — driven off `VISIT_STATE_OPTIONS`, so a fifth state fails this rather than
  quietly rendering its key on one page and a word on the other.
- `front_desk_rails_add_up_to_the_day_register`, still green with the new
  membership.

### 16.4 For Carl

- **"Waiting to be seen" is drawn quiet (`--ink-muted`), not coloured.** It is
  inside the day's total but there is nothing for reception to do on it, and a
  sixth colour would start to read as a scale. Say if it should carry one.
- **Nurse, bloods and the second-doctor case are NOT built** — D-2026-09-12-20
  records the rule that separates them and the list will be versioned content.


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
| 12 Sep 2026 | §13: nothing about the patient leaves the page. Build approved by Carl. |
| 12 Sep 2026 | **§4, §13 and VISIT-CHECKLIST §9 phases 1–2 BUILT.** The placeholder panel is gone. The right-hand panel now carries, for the chosen person: one sentence saying what is true for them; the four computed paperwork rows of `VISIT-CHECKLIST.md` §2 (`visitChecklist.ts`, pure and unit-tested, nothing marked by hand); the tablet desk's own numbered send card rendered INSIDE checklist row 3 (Carl's second note on the annotated screenshot); the reason it cannot go with its own fix in it and the who-is-signing form (`AgreementBands`, lifted out of `AgreementRow` in `pushDesk.tsx` and shared — `/practice/tablet` renders the identical DOM and its 69 tests pass unchanged); one primary action labelled as the sentence you would say; and one disclosure for everything else. The "Open Send to the tablet" link and the not-yet notice are removed. |
| 12 Sep 2026 | **§13 changes what "Get help" is.** It is the SAME disclosure as "More", renamed in the one situation §4's table calls *cannot proceed*, and it REVEALS the expert controls (recall, correct, no change needed, re-send, send again) under the same patient rather than opening the admin page. §8's `front_desk_get_help_carries_the_patient_to_the_admin_page` is struck through above. |
| 12 Sep 2026 | **The numbered card is drawn only where it could be used.** A refusal the card can itself clear (`assignor_not_confirmed`, `who_is_signing_unset`) keeps the card, because step ① is its fix. Every other refusal draws no card at all — a strip of three steps over a row that can never go teaches a beginner the page is broken (CLAUDE.md §6) — and the panel shows the reason with its inline fix instead. `SEND_CARD_CLEARS` in `visitChecklist.ts`. |
| 12 Sep 2026 | **A live tablet is answered by the tablet desk's own controls, verbatim** (Carl, testing: *"Why are you not just copying the existing logic."*). The panel briefly had a simplified "Bring it back" of its own with a yes/no question in front of it; it hid the other three controls and said a different thing about the same act, so it went. `SessionActions` — Recall, Correct, "No change needed — the details were right", Re-send — is now the panel's action area for a session, together with `SessionDisputeNotices` and the tablet desk's own "On <device> now · <session>" chip, which is also drawn beside checklist row 3. Where the agreement IS and whether the paperwork is DONE are different facts and both are shown. |
| 12 Sep 2026 | **§6 rule 1 now rests on the sentence that matters.** Recall and Re-send change nothing about the agreement (hard rule 8, REQ-REC-04), so they are one press on both pages. "No change needed" is the claim somebody may be asked about later, and the note saying it is recorded against their name stands beside the button before it is pressed. `front_desk_confirms_in_words_before_anything_irreversible` asserts that pairing. **If Carl wants a question in front of Recall, it should go on BOTH pages, not only this one.** |
| 12 Sep 2026 | **The selection is keyed on the PATIENT, not the agreement** (Carl, testing: the panel dropped back to "Choose a name on the left" after saving who is signing). A party change on a prepared row supersedes, so the agreement id reception had chosen ceases to exist on every SUCCESSFUL save as well as on a refused one. A patient id survives supersession and survives the row moving between rail groups; the panel follows the person onto the successor. Test: `front_desk_keeps_the_patient_when_answering_who_is_signing_replaces_the_agreement`. |
| 12 Sep 2026 | **A refused save now names the rule that refused it** (Carl, testing: "s 65C validation failed" and nothing else). The server answers a refused re-lock with a `failures` array — "C6: D6a: a pre-agreement requires a Basic Service Description" — and `refusal()` in `pushDesk.tsx` was reading the summary line and dropping the array, on BOTH pages. It now reads it and `saveWho` says which rules failed, as the engine named them. The wording around them is ours; the diagnosis is the rule set's, because a friendlier sentence per rule would be a second copy of versioned content (hard rule 14). |
| 12 Sep 2026 | **§4's last row is built.** A signed agreement leaves the queue at once, so the panel used to empty itself under somebody's hand at the one moment the page should be clearest. It now says "Nothing left to do for <name>" with one "Next patient" press. It does NOT say "signed": a row can also leave because the visit was cancelled or another desk dealt with it, and the queue alone cannot tell those apart. |
| 12 Sep 2026 | **§4's "marks exactly one row do this next" is built** — the top of *Here now*, which is the longest wait because the server orders the queue by arrival through the supersession chain and this page never re-sorts. A WORD, not a colour (WCAG 2.2 AA 1.4.1). §12.6's call order is still NOT built. |
| 12 Sep 2026 | **Three things left for Carl.** (a) **The §5 vocabulary rule stops at the strings this page owns.** The shared bands and controls it now renders read from `strings.tablet`, which the lint does not cover, and three of them break §5 in front of a beginner: `toAffiliations` ("Open Affiliations →"), `blocked.enduring_rules_not_authored` ("the enduring rule set") and `whoRefusals.agreement_moved_on` ("superseded"). Fixing them changes the tablet desk's words too, which is a decision rather than a build, so they were left. The alternative — a second wording per surface — is the thing §7 forbids. (b) The per-visit status being built on the practitioner side (`packages/domain/content/visit-states.json`) is NOT read into the checklist: `GET /tablet-sessions/pushable` does not carry it yet, and adding the read would have meant editing core and contracts while another agent held them. (c) Whether Recall should ask a question first — see the row above. |
| 12 Sep 2026 | **§14 BUILT.** The rails partition the day: `Finished`, `Needs a look` and `Not arrived today` join `Here now`, `On a tablet` and `Expected`, and the first four sum to `GET /arrivals/day`'s own count for the same day, printed at the top of the column. `dayRails.ts` is pure and unit-tested; `front_desk_rails_add_up_to_the_day_register` asserts the sum on the rendered page. Two people who had come in, owed a signature and appeared on no screen anywhere now appear on one. |
| 12 Sep 2026 | The group counts draw the NUMBER apart from its word — bold, `--accent`, 8.6:1 on the panel — per Carl's annotation. `count()` stays whole for the live region, because a bare "3" announced minutes after its heading tells nobody anything. |
| 12 Sep 2026 | **§15 BUILT.** Six notes taken with the rails on screen: "Here now" is asserted to hold the server's arrival order; the queue number leads each row; "See everyone here at once" points at the tablet desk's own section 1; the tablet's name sits under the patient's on the rows that have one; "Finished" moved below "Needs a look"; and each rail carries its own colour on the heading and the number, all existing tokens and all past AA. |
| 12 Sep 2026 | **§15.7: both desks name a patient the same way.** `PatientIdentity` (in `app/ui`) renders the practice's own number above our record id, in one order and one set of words, on `/practice/frontdesk` and `/practice/tablet`. `strings.frontdesk.panel.patientRecordNumber` now delegates to `strings.recordId.practiceNumber` rather than being a second copy. |
| 12 Sep 2026 | **§16 BUILT (D-2026-09-12-20).** The service list gains the visit itself, read from the state the practitioner sets and never minted here; "Finished" is now "every service resolved" over the list rather than a two-clause boolean; `cancelled` exists as a resolved state with nothing producing it yet; a "Waiting to be seen" rail holds the people who have signed and not been called in; and the panel's section carries Carl's name for it, the patient service list. |
