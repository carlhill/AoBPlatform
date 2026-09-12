# FRONT-DESK-SMALL-PAGE.md — the front desk on a small screen

### v1.0 · 12 September 2026 · `/practice/frontdesksmall`, built. Companion to `FRONT-DESK-PAGE.md` (the wide desk, which stays exactly as it is). Hard rules from CLAUDE.md §2 apply unchanged.

Carl, 12 September 2026: *"If the Practice has small screens, we will need to go
to a different design. Lets leave that for later, unless you want to propose a
design."* → the proposal in `SESSION-HANDOVER.md`, "A proposal for the
small-screen version" → *"build this new design at frontdesksmall and add it to
the same card on /setup under frontdesk."*

---

## 1. The one idea

**One list, not five rails.**

`/practice/frontdesk` stacks five rails, and the five rails are five STATES.
They exist because the day has to partition so the desk and the day register
reconcile. **That is a requirement on the DATA, not on the layout.** A
receptionist does not think in states; they think *"who do I deal with next"*.

So this page prints **everybody here today in arrival order, each row carrying
its own state marker**, and moves the partition into one strip of filter chips
above the list.

## 2. What it buys, in pixels

On the morning this was written four of the five rails were empty and still
carried a heading, a count and an explanatory paragraph each — most of the
column, spent on nobody. Three things collapse:

| The wide desk | Here |
|---|---|
| Five headings, five counts, five empty-state paragraphs | One row of chips |
| A card per person in a rail | One hairline-separated line per person |
| Three stacked notices before any content | One sentence carrying three facts |

Target: a receptionist on a **1366x768** screen sees the room without scrolling.

## 3. What it costs, stated honestly

**At-a-glance grouping.** On the wide desk you can see "three people are
finished" without reading anything; here the chip has to carry it, and a chip is
smaller than a heading. That is the trade, and it is only worth taking when the
room is bigger than the screen — which is why **both pages exist and neither
replaces the other**.

## 4. The rules this page keeps

1. **Arrival order is the only ordering rule.** Nothing re-sorts past it, and
   the states interleave inside it. `stableByFirstSeen` (the wide desk's own)
   stops a poll shuffling rows under somebody's hand.
2. **The chips add up to the day register.** `Here now + On a tablet + Needs a
   look + Finished` IS the number `/practice/day` prints for the same day —
   asserted by `frontdesk_small_chips_add_up_to_the_day_register` on the
   rendered page, against the chips AND against the rows beneath them.
3. **Everything about the patient is on this page** (Carl, §13). The detail
   opens IN PLACE under the row; the list never leaves the screen; nothing in
   the detail is a link. This honours the rule more literally than a second
   column does, because there is nowhere to be sent.
4. **Nothing blocks care** (hard rule 8) and the page keeps saying so — one
   quiet line on an ordinary morning, a full notice the moment the platform
   cannot be reached, which is when it is worth the room.
5. **Both ids, in one order** (Carl: *"ok. In that case show both ids."*). The
   practice's own patient number is on the collapsed row, prominent, because it
   is the handle reception reads out; the AoBPlatform record id with its Copy
   control is in the opened detail, because a support ticket is not raised
   while scanning the room. Rendered by the shared `PatientIdentity`, so the
   three front-desk surfaces cannot name one person three ways again.
6. **No Medicare card number anywhere** (hard rule 1, REQ-VER-02); no amounts
   (hard rule 4); no identifier values in logs (hard rule 9).
7. **Receptionist vocabulary**, enforced by `check-strings.mjs`, which now
   scans `frontdeskSmall` as well as `frontdesk`, and by
   `frontdesk_small_never_uses_a_domain_word_from_the_banned_list`.

## 5. The colours

From `tokens.css`, nothing invented, and the same assignment the wide desk uses
so the eye does not have to relearn where to land:

| State | Token | On `--surface` |
|---|---|---|
| Here now | `--ink` — the strongest treatment, because it is the work | 15.9:1 |
| On a tablet | `--ok` #1a6c37 | 6.5:1 |
| Needs a look | `--warn` #7a5300 | 6.6:1 |
| Finished | `--info` #1f4d7a | 8.6:1 |
| Expected, Not arrived today | `--ink-muted` #55595e | 7.4:1 |

Colour is on the chip's LABEL and its NUMBER, and it is never the only carrier
(WCAG 2.2 AA, 1.4.1): every chip says what it is in words, every row repeats
the state as a word beside the name, and the pressed chip carries
`aria-pressed` and a filled wash.

## 6. Where it lives

- Route `/practice/frontdesksmall`, audience `practice` — **identical** to
  `/practice/frontdesk`. It grants nothing the wide desk does not: the same
  practice-scoped reads behind the same RLS, the same `@PracticeScoped` acts.
- Linked from `/practice/setup`, in the Tablets card, beside "Open the front
  desk" — the third way into one morning, not a third job.
- Back goes to `/practice/setup`, where that card is. **Not** `/practice/today`:
  that page is five destinations and `is five things and no more` holds it
  there deliberately (see §8).

## 7. Reuse — it is a second VIEW of one dataset

Nothing about the day is computed twice. `dayRails` decides every state and is
imported, not copied; `usePushDesk` owns the reads, the poll and every act;
`SendSteps`, `SessionActions`, `AgreementBands`, `CorrectionPanel` and the
dispute notices are the tablet desk's own components. `deskLines.ts` only
re-orders what `dayRails` hands back, which is why the reconciliation holds by
construction rather than by two screens happening to agree.

One deliberate duplicate, flagged in its own docstring:
`frontdesksmall/useDayReads.ts` is a second copy of the two fetches
(`GET /arrivals/expected`, `GET /arrivals/day`) that live un-exported inside
`FrontDeskView.tsx`. **The third caller extracts it, and `FrontDeskView` moves
onto this hook in the same commit** (wow.md §10, the rule of three). Only the
fetches are copied; every decision about what the answers mean is `dayRails`.

## 8. Open for Carl

1. **Should `/practice/today` gain a sixth card for this page?** It is the
   shift's home and it is where the wide desk's Back goes, but
   `today.test.tsx`'s `is five things and no more` fails on a sixth — the guard
   Carl asked for after the setup hub reached twelve one reasonable card at a
   time. Until he says otherwise, Back goes to `/practice/setup` and the page
   is reached from the Tablets card there. Changing it is a change to
   `PRACTICE-NAVIGATION.md` §2.
2. **"Not arrived today" has no permanent chip.** It sits outside the
   register's total on purpose, so a permanent chip would put a count on the
   strip that is not part of the sum the strip exists to prove. Its rows are
   always listed and its chip appears only when somebody is in it. If Carl
   wants it always visible, the strapline has to say which chips are in the sum.
3. **A read-only platform twin** does not exist for either desk, so
   `toViewPath` lands an operator on the practice hub — truthful, and the same
   answer the wide desk gives.
4. **No browser screenshot was taken.** The console needs a WebAuthn passkey
   (hard rule 15) and there is no dev seam past `AccessGuard`, so the page was
   verified by 15 named tests, a typecheck, a lint, and `mayReach` against the
   BUILT domain package. Carl sees it first.
