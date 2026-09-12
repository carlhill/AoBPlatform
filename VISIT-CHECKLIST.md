# VISIT-CHECKLIST.md — everything this patient is here for today, and what is still outstanding
### v1.0 · 12 September 2026 · Owner: Carl. A plan, not yet built. Companion to `FRONT-DESK-PAGE.md` (the panel this lives in), `PRACTITIONER-QUEUE-PAGE.md`, `ARRIVAL-WHO-IS-SEEN.md`, `VISIT-WORKFLOW.md`.

Carl, 12 September 2026, annotating the front desk page: *"a list of all services
to the patient on today's visit (this is the per patient workflow)"* — check
whether an agreement is needed, create it, get it approved on the tablet, see the
doctor, do a blood test, see the nurse, approve the post-service agreement, make
a payment. *"We need to track that these steps have been completed… the dr will
flag their card as complete. The nurse and the blood-test will do the same."*

---

## 1. The idea is right, and one distinction decides whether it is buildable

The eight steps are **two different kinds of thing**, and the plan lives or dies
on keeping them apart:

| | Steps | Whose they are |
|---|---|---|
| **Paperwork** | 1 needs an agreement · 2 create it · 3 approve on the tablet · 7 post-service agreement | **Ours.** The platform decides, creates, captures and proves these |
| **The visit itself** | 4 see the provider · 5 blood test · 6 see the nurse · 8 payment | **The practice's.** Clinical and financial events we do not run |

**We must never direct the second kind.** Clinical features of any kind are out
of scope, and so is payment processing (CLAUDE.md §8). `VISIT-WORKFLOW.md` says
the practice management system is the register of patients and we keep no shadow
list.

**But we may LISTEN to them, and we already need to.** The post-service agreement
exists precisely because a service was rendered; there is already an endpoint for
being told so. A doctor pressing "seen" is that same signal wearing a friendlier
hat.

So the checklist is **a record of what has happened, arranged so the paperwork
that depends on it becomes obvious.** It is not a workflow engine, it never tells
a clinician what to do next, and it cannot stop anything.

## 2. What each step actually is

| # | Carl's step | What it is here | State comes from |
|---|---|---|---|
| 1 | Needs an agreement approved | Already answered by the versioned visit policy at arrival — enduring, episodic or none | `decideVisitAgreement`, today |
| 2 | Create the agreement | Already automatic. Drafted, validated, rendered, locked | The agreement lifecycle, today |
| 3 | Approve on the tablet | The push and the signature | Tablet session, today. **Carl's second note: the send card appears here** |
| 4 | See the provider | A milestone the provider marks | New — a "seen" mark |
| 5 | Blood test | A milestone the phlebotomist marks | New — same mechanism |
| 6 | See the nurse | A milestone the nurse marks | New — same mechanism |
| 7 | Post-service agreement | Already built. A rendered service decides, drafts and locks | `POST /arrivals/service-rendered`, today |
| 8 | Payment | **Out of scope as an action.** See §4 | Not ours |

**Steps 1, 2, 3 and 7 already exist.** The genuinely new thing is one mechanism —
a person marking their part of the visit done — and a panel that shows all of it
in one list.

## 3. The model: a visit has services, not steps

A numbered list implies an order that the room does not keep. A patient may see
the nurse first, give blood after the consultation, or never see the doctor at
all. So:

**A visit is a set of SERVICES for today, each with a state.** Not a sequence.
The panel lists them in the order they were added and marks each one, which is
what Carl's tick-or-"Completed (was pending)" tag describes.

Each service carries: who it is with (a provider, a nurse, a phlebotomist — the
`seeingAffiliationId` work makes this expressible), what it is in the practice's
own words, and one state: **outstanding**, **done**, or **not needed**.

The paperwork rows sit in the same list so reception reads one thing, but they
are computed, never marked by hand.

## 4. Payment, and why it is only a line of text

Bulk billing means the patient pays nothing — that is the entire point of the
regime this product serves. A payment step therefore only exists where the
patient **declined** to assign, or where the service is private, which is
already modelled: a declined agreement leads to a private bill with a claimable
invoice.

So step 8 is **a fact the panel may show — "this visit will be billed privately"
— and never an action, a total, or an amount.** No dollar figure appears on any
agreement artefact (hard rule 4), and payment processing is out of scope. If a
practice wants to take money, that is their software.

## 5. Who may mark what

| Who | May mark |
|---|---|
| The provider | Their own consultation, on their own queue page |
| The nurse, the phlebotomist | Their own service, on theirs |
| Reception | Any service, because a clinician who forgot is the ordinary case and the desk is who notices |

**Marking is not clinical documentation.** It records that an encounter happened,
by whom and when — never what was found, done or prescribed. A free-text box
here would become a clinical note within a week, so there is none.

**It is a write on the practitioner queue page**, which `PRACTITIONER-QUEUE-PAGE.md`
§3 currently forbids. That rule was written to keep agreement controls off a
clinician's screen and it still should. Marking your own attendance is not acting
on an agreement, so the rule narrows rather than falls: **the only control a
practitioner ever gets is "I have seen this patient".**

## 6. The payoff

This is what makes the work worth doing rather than merely tidy.

**The post-service agreement becomes automatic and visible.** Today something has
to tell us a service was rendered. When the doctor marks the consultation done,
that IS the signal, so step 7 appears on the list by itself, already drafted, and
reception sees it the moment it is needed rather than discovering it later.

**The covering-doctor trap gets caught.** An enduring agreement is per
practitioner. If the patient is marked as seen by somebody other than the one
their agreement names, the list says so immediately instead of the practice
billing a visit with nothing behind it.

**A nurse's or phlebotomist's visit resolves cleanly.** A blood test with no
claim shows "nothing to sign" and the visit closes with nobody chasing anything.

## 7. Rules

1. **Never blocks anything** (hard rule 8). Nothing on this list gates care, and
   an unmarked service never prevents a patient being seen or billed.
2. **No clinical content.** No reason, no note, no result, no diagnosis. Types,
   times and who — nothing else.
3. **No amounts, ever** (hard rule 4).
4. **Marking is attributable** — who marked it and when, from the token, never a
   typed name.
5. **Reversible.** A mis-marked service is un-marked, and the correction is
   recorded rather than the original being erased.
6. **The list is not a record of care.** It is today's working view. The evidence
   of what was agreed lives in the vault; this is scaffolding around it.
7. **Where the practice has a feed, it wins.** If the practice management system
   already knows the visit's services, we read them rather than asking reception
   to type them twice.

## 8. Named tests

- `the_checklist_never_gates_a_consultation_or_a_bill`
- `marking_a_service_done_records_who_and_when_and_no_clinical_detail`
- `a_marked_consultation_raises_the_post_service_agreement_by_itself`
- `a_patient_seen_by_somebody_other_than_their_enduring_provider_is_flagged`
- `a_blood_test_with_no_claim_closes_with_nothing_to_sign`
- `no_amount_appears_anywhere_on_the_checklist`
- `a_practitioner_may_mark_their_own_service_and_nothing_else`
- `a_mis_marked_service_can_be_un_marked_and_the_correction_is_recorded`
- `the_checklist_across_a_practice_boundary_finds_nothing`

## 9. Build order

1. **The list, read-only**, in the front desk panel: the four paperwork rows that
   already exist, computed. This alone replaces the placeholder panel and is
   useful on its own.
2. **The send card in row 3** — Carl's second note. The existing numbered strip,
   shown in place when reception picks a patient, so the whole job is on one page.
3. **Services and marking.** The new column, the mark, the queue-page control.
4. **The automatic post-service row**, once marking exists.

## 10. For Carl

- **Where do the non-paperwork services come from** before a practice has a feed?
  Reception adding them by hand is the honest answer, but it is typing, and
  typing at a busy desk is what does not get done. An alternative is to infer
  them from who the patient is booked with and let reception add only the extras.
- **Does an unmarked visit ever chase anybody?** Recommendation: no. A list that
  nags about a doctor who forgot to press a button trains people to press it
  without meaning it, and then the signal is worthless.
- **Is step 8 acceptable as a line of text** rather than an action (§4)?
- **Should the checklist survive the day?** It is a working view; a visit that
  spills past midnight is rare but real.

## Change log
| Date | Change |
|---|---|
| 12 Sep 2026 | v1.0. Written from Carl's annotated front-desk screenshot. Not built. |
| 12 Sep 2026 | **§9 phases 1 and 2 BUILT**, in the front desk panel (`apps/web/app/practice/frontdesk/`). Phase 1: the four paperwork rows, computed by `visitChecklist.ts` from the queue row and today's covered line — `GET /tablet-sessions/pushable` and `GET /tablet-sessions/covered`, both already read by the desk. No new endpoint. Phase 2: the existing numbered send card renders as row 3's own body. Phases 3 and 4 — services, marking, the automatic post-service row — are NOT built. |
| 12 Sep 2026 | **The distinction that makes row 3 honest.** The queue holds only UNSIGNED agreements, so a signature takes the row off it and "Done" cannot be read from the queue at all. It is read from the covered line instead: `covered` means the item was covered by the agreement the patient signed on the way in, so they DID sign and row 3 is Done; `covered_by_enduring` means an ongoing agreement already stood and nobody signed anything today, so it reads "Nothing to sign" and never "Done". Test: `a_signature_today_reads_as_done_and_an_ongoing_agreement_does_not`. |
| 12 Sep 2026 | **Row 4 says "Nothing to sign" until something is billed after the visit**, rather than being hidden. A row that appears out of nowhere at checkout is a surprise; a row that says why it is quiet is not. No amount appears on it and there is no field for one (hard rule 4). |
