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
