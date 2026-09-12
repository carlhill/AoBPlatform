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
  list enough to start?

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
