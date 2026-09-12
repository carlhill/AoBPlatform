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

### 3a-i. One hour, and then it stops claiming to be the room (Carl, 12 September 2026)

Carl, asked how stale is too stale: **"1 hour"**.

**What expires is the CLAIM, not the list.** The list stays on screen, because
an outage never empties the screen (section 2) and an hour into an outage a
blank page is worse, not better. What changes at the hour is what the screen
says the list IS:

| Age | What the screen says | What the rows do |
|---|---|---|
| Under an hour | *"Showing the list from 9:42. Not live."* | Read normally. Writes refused on the control |
| Over an hour | *"This is the last list we had, from 9:42. It is more than an hour old and is no longer the waiting room."* | Still readable, visibly quieter. Nothing suggests a next action |

**Why the rows go quiet rather than away.** After an hour the list is a record
of who WAS here, and it is still the best record anybody has — it is what
reception will reconcile against afterwards. But it must stop looking like a
work queue, because acting on an hour-old queue is how the wrong person gets
called.

**At the hour, say what to do instead**, because by then the practice has a
morning to run: keep seeing patients, and the paperwork is caught up after the
service. That is not improvised advice, it is the platform's documented outage
posture (CLAUDE.md §7 — capture falls back to post-service), and the screen
should name it rather than leave a receptionist to invent a plan.

**One hour is a SETTING, not a constant** (Carl, 12 September 2026: *"keep the
hour a configurable settign"*). A threshold compiled into a component is the
thing hard rule 14 exists to prevent, even where the rule is about content
rather than statute — and practices will disagree about this one. A single-site
clinic where reception can see the whole room may want twenty minutes; a large
practice where the list IS the room may want longer.

**Where it lives:** on the practice, beside the two timing settings that
already exist and have exactly this shape.

| Setting | Default | Unit |
|---|---|---|
| `linkExpiryHours` | 48 | hours |
| `kioskIdleTimeoutSeconds` | 300 | seconds |
| **`staleListMinutes`** | **60** | **minutes** |

Minutes, because hours cannot express twenty and seconds would invite a value
nobody meant. Read through the practice config the console already serves, so
one number reaches every surface rather than each page carrying its own idea of
stale.

**It has no screen yet, and neither do its two siblings.** `PATCH
/practices/:id/config` is endpoint-only — recorded in `INTEGRATION-MODES.md`
section 3 as one of the gaps a fully manual practice runs into. This setting
joins that list rather than justifying a one-off control of its own.

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
- `a_list_over_an_hour_old_stops_calling_itself_the_waiting_room`
- `a_list_over_an_hour_old_is_still_on_screen`
- `the_staleness_threshold_is_read_from_the_practice_setting`
- `a_practice_that_has_set_no_threshold_gets_sixty_minutes`
- `a_write_control_is_refused_with_its_reason_on_the_control`
- `a_read_control_still_works_while_the_service_is_unreachable`
- `the_page_retries_by_itself_and_says_so`
- `a_write_is_never_retried_automatically`
- `typed_input_survives_an_outage`
- `an_outage_never_suggests_a_patient_cannot_be_seen`

## 7. For Carl to decide

- ~~How stale is too stale?~~ **Answered: one hour** (Carl, 12 September 2026).
  See §3a-i. My suggestion had been that it never expires; Carl's number is
  better, because "reception can read a clock" assumes somebody looks at it,
  and the whole failure mode is a screen that quietly stops being true.
- **Does the tablet get the same treatment?** The kiosk currently says "see
  reception" on an outage, which is right for a patient holding it. This
  document is about staff screens.

## Change log
| Date | Change |
|---|---|
| 12 Sep 2026 | v1.0. Written when Carl saw the front desk reduced to two banners and said the messaging needs to be better. |
| 12 Sep 2026 | §3a-i: Carl set the threshold at one hour. What expires is the CLAIM, not the list — the rows stay, quieter, and the screen names the post-service fallback. |
| 12 Sep 2026 | The hour is confirmed as a SETTING: `staleListMinutes` on the practice, default 60, beside `linkExpiryHours` and `kioskIdleTimeoutSeconds`. It has no screen, and nor do its two siblings. |
