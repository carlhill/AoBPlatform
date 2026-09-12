# OUTAGE-MESSAGING.md — what a screen says when it cannot reach the service
### v1.0 · 12 September 2026 · Owner: Carl. A plan, not yet built. Affects all 28 console surfaces that carry a `notLoaded` string. Hard rule 8 governs.

Carl, 12 September 2026, looking at the front desk with the service down:
*"we need better messaging when the app is down."*

---

## 1. What is wrong today

The screen he was looking at had a title, two banners and **nothing else**. The
list of who was in the waiting room was gone.

Four faults, in the order they matter:

1. **The content vanishes.** Everything reception had a second ago is replaced
   by an apology. The patients are still in the room; the screen has simply
   stopped saying who they are.
2. **"Please try again in a moment" names no control.** There is nothing on the
   message to press. The refresh control is a small unlabelled icon in the top
   bar, and nothing says the page is already retrying — or whether it is.
3. **Two banners say overlapping things.** "We could not reach the service" and
   "See the patient anyway" are one thought split in half, and together they
   take more vertical space than the content they replaced.
4. **It does not distinguish looking from sending.** Reading a stale list is
   perfectly safe. Sending an agreement to a tablet is not. The screen treats
   both as equally impossible.

## 2. The rule

**An outage must never empty the screen.**

This is hard rule 8 expressed in the interface. The platform never blocks care:
a patient is seen and billed whatever this screen says. A page that erases the
waiting room does not merely fail to help — it takes away information the
practice already had, and it does it at the exact moment the practice is least
able to get it back.

## 3. What a screen must do instead

### 3a. Keep the last good data, and say when it was true

The rail keeps its patients. Above them, one line: **"Showing the list from
9:42. Not live."** Reception can still see the room and call the next person.

The staleness must be a TIME, not a word. "Out of date" tells somebody nothing
they can act on; "from 9:42" lets them decide for themselves whether it still
describes the room.

### 3b. Separate what can still be done from what cannot

| | While the service is unreachable |
|---|---|
| Look at the list, read a name, read who is signing | **Works**, from the last good data |
| Send to a tablet, confirm who signs, mark a visit, correct a detail | **Refused**, and the control says why on the control |

A write control goes disabled with its reason attached, not with a banner at
the top of the page that the eye has already skipped. A read control stays
live.

### 3c. Retry by itself, and say that it is

"Please try again in a moment" is an instruction to do something the page
should be doing. Replace it with what is actually happening:

- **Trying again…** while a retry is in flight.
- **Back.** for a moment when it succeeds, then gone.
- A **Try now** control in the message itself for somebody who does not want to
  wait — never only the icon in the top bar.

Back off between attempts so a dead service is not hammered, and never retry a
WRITE automatically: a send that may or may not have landed must be decided by
a person.

### 3d. One message, not two

The reassurance folds into the outage line rather than sitting under it as a
separate banner. One box, three sentences at most: what is stale, what still
works, and that nobody is held up.

### 3e. Never lose what somebody typed

If a receptionist was part-way through "who is signing" when the service went,
the words stay in the box. Losing them is a second failure caused by the first,
and it is the one that makes people distrust the screen afterwards.

### 3f. Name it in the user's words

"We could not reach the service" is our word for it. A receptionist knows the
paperwork, the tablet and the practice's own software. Say which of those is
unreachable, because the answer changes what they should do.

## 4. What must never appear

- **A retry that silently repeats a write.** Nothing is sent twice because a
  page reconnected.
- **A technical reason.** No status code, no host name, no stack. The reason
  codes we already map are the vocabulary (CLAUDE.md §7); an unmapped one shows
  its code so it can be diagnosed, and nothing more.
- **A suggestion that care is affected.** The patient is seen and billed.
- **PII in the outage state.** A stale list is the same list, under the same
  rules — no identifier values reach a log because a page failed.

## 5. Where it applies

Twenty-eight surfaces carry a `notLoaded` string today, each with its own
wording. The behaviour above belongs in ONE shared component, so a page cannot
opt out by accident and a fix reaches all of them. The per-page words stay
per-page; the shape does not.

**First instance: `/practice/frontdesk`**, because it is the most used screen in
the product and the one Carl was looking at.

## 6. Named tests

- `an_outage_never_empties_the_waiting_list`
- `a_stale_list_says_the_time_it_was_true`
- `a_write_control_is_refused_with_its_reason_on_the_control`
- `a_read_control_still_works_while_the_service_is_unreachable`
- `the_page_retries_by_itself_and_says_so`
- `a_write_is_never_retried_automatically`
- `typed_input_survives_an_outage`
- `an_outage_never_suggests_a_patient_cannot_be_seen`

## 7. For Carl to decide

- **How stale is too stale?** A list from four hours ago is not the room. At
  some point the honest thing is to stop showing it. My suggestion is that it
  keeps showing with the time attached and never expires, because reception can
  read a clock and the alternative is an empty screen — but it is a judgement.
- **Does the tablet get the same treatment?** The kiosk currently says "see
  reception" on an outage, which is right for a patient holding it. This
  document is about staff screens.

## Change log
| Date | Change |
|---|---|
| 12 Sep 2026 | v1.0. Written when Carl saw the front desk reduced to two banners and said the messaging needs to be better. |
