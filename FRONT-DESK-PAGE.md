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

- **Where it lives and who lands there.** A separate route (`/practice/desk`?)
  that new staff are pointed at, or the default for everybody with the current
  desk behind a "detailed view" link? The second teaches the product to itself
  over time; the first is safer for experienced staff who like what they have.
- **Is it one patient at a time, strictly?** The single-column design assumes so.
  A busy Monday with four people at the counter may want two open at once, which
  changes the shape more than it sounds.
- **Does it cover the post-service second push too**, or only pre-service? The
  second push is reception's job as well, and leaving it off the beginner page
  means a beginner still has to visit the expert one.

## Change log
| Date | Change |
|---|---|
| 12 Sep 2026 | v1.0. Written when Carl asked for a front-desk page a day-one starter could work. Not built. |
