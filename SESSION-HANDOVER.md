# Session handover — 12 September 2026

Branch `feat/apply-ui`. **79 commits today.** Two build agents were still
running when this was written, both on the front desk; check what they landed
before starting anything that touches it.

Tomorrow has two jobs, both Carl's words: **"test all the modes"** and **"see
if we can have a better UI for this screen. This will be the most used
screen."**

---

## Before anything else tomorrow

```bash
docker compose up -d postgres immudb keycloak mailhog rules vault
```

```bash
npm run build -w packages/domain
```

```bash
npm run start:watch -w apps/core
```

```bash
npm run dev -w apps/web
```

**Build the domain package BEFORE starting the dev servers, and restart them
after any later domain change.** This cost an hour today: `/practice/day`
answered "There is no such page" while the route was perfectly correct, because
`packages/domain/dist` had never been rebuilt and the access guard had
therefore never heard of the page. Rebuilding is only half of it — the Next dev
server holds the old module in memory and needs a restart too. `DEV-LOOP.md`
has the full note; the symptom is never a compile error, which is what makes it
expensive.

**Then check the two agents' work landed**: `git log --oneline -15` and
`git status`. Both were mid-flight at handover.

## Job one — test all three integration modes

`INTEGRATION-MODES.md` is the map. Section 2 is the table of who supplies what
at each step; section 1a says how modes relate to the input cases.

**Only mode 1 is fully testable today**, and that is the finding, not a
limitation of the test plan. `apps/connector` is the interface plus a mock, and
`PmsModule` wires the mock unconditionally, so modes 2 and 3 can only be
exercised by posting the messages a connector would send.

| Mode | How to test it tomorrow |
|---|---|
| **1 — manual** | `bash scripts/dev/stage-kiosk-patients.sh`, or the new-agreement panel on `/practice/patients`. End to end: arrive, confirm who signs, send to a tablet, sign, check the day register |
| **2 — semi** | Key the arrival by hand, then post the service-rendered message as a machine would: `bash scripts/dev/service-rendered.sh` |
| **3 — full** | Post both messages. `POST /arrivals` with `source` set to the connector's, then service-rendered. Nothing keyed |

`test_support.md` has every command and the traps: why arrivals land blocked on
"who is signing", why an arrival can come out as an ongoing agreement that
cannot be pushed, and what refuses to be deleted when clearing down.

**The gap to confirm rather than rediscover:** mode 1 cannot raise a
post-service agreement from any screen. No screen posts the item numbers, and
the queue's Completed control gives up unless a service record already exists.
Carl has ruled that screen release-blocking (D-2026-09-12-13).

**Today's dev data** is seven patients across two practitioners at two
locations: five ready to send, two of those signed for by somebody else, and
two deliberately blocked on "who is signing". All three surfaces agreed at seven
at handover, which is the reconciliation baseline — as people are signed off the
desk should shrink while the day register stays at seven.

## Job two — the front desk UI

Carl: *"We also need to see if we can have a better UI for this screen. This
will be the most used screen."* He is right that it is the most used screen, and
that is the argument for spending real time on it rather than tuning it.

**This belongs in `FRONT-DESK-PAGE.md` and is parked here only because an agent
was editing that file at handover.** Move it across tomorrow.

### It got built, and Carl likes it — so the question has changed

Carl, last thing on 12 September, after using it: *"The frontdesksmall is
growing on me. It is simple and I think effective. Lets review tomorrow."*

`/practice/frontdesksmall` was commissioned as the SMALL-SCREEN answer. If it is
simply the better desk, then the review tomorrow is not "does it work on a small
screen" but **"which one is the front desk"**, and that is a bigger and better
question.

**Two desks is not free, and today already showed the bill.** Every change since
it landed has had to be applied twice — both patient ids, the checklist
alignment, the rail colours. Two implementations of one screen drift, and the
one people use less drifts faster. So the honest options tomorrow are:

1. **Keep both**, and accept that every front-desk change is two changes
   forever. Only worth it if practices genuinely split into two populations.
2. **Make the compact one THE front desk**, and retire the wide one. The wide
   layout's detail panel becomes the wide-screen rendering of the same page
   rather than a different page.
3. **One page, two densities** — the same route, the layout responding to the
   width. This is option 2 done properly and is probably where it ends up.

**Do not decide it from the screenshots.** Decide it from a busy morning: seed
twenty patients across three practitioners, put two on tablets, finish six, and
look at both. Seven patients flatters the wide desk because the rails are short.

### The question that decides the layout, before any pixels

**Is a receptionist working one patient at a time, or watching the room?**

The page is currently built for the first: a rail of names, and a detail panel
that fills in when you choose one. Carl's own §13 rule — *"everything to do with
the patient must be on this page"* — pushed it that way and is right.

But the rail has grown to five lists, and a busy morning is a room, not a
queue of one. If the honest answer is "both", then the shape is a board that can
open a patient, rather than a list that requires choosing one before the screen
does anything. That is a different page, not a restyle, so it is worth settling
before anybody moves a control.

### What is visibly wrong today, from Carl's own screenshots

1. **Three stacked notices before any content.** The reassurance that nothing
   here holds anybody up matters, and it does not need full width above the
   fold every time. Work started roughly a third of the way down the screen.
2. **An empty rail costs as much room as a full one.** Four of the five rails
   were empty and still carried a heading, a count and an explanatory
   paragraph each. Empty should collapse to one line.
3. **Half the screen is idle until a name is chosen.** The detail panel's
   "choose a name on the left" is a large card that does nothing.
4. **Every row says "No time given".** With no appointment feed that column is
   dead weight — and the queue number now being built is exactly what a
   receptionist wants in that slot instead.
5. **Density.** Seven people filled the rail. A real morning is more than that,
   and the whole point of the screen is seeing the room at a glance.

### A proposal for the small-screen version (Claude, 12 September 2026)

Carl: *"If the Practice has small screens, we will need to go to a different
design. Lets leave that for later, unless you want to propose a design."* Here
is one, so that "later" starts from something concrete.

**One list, not five.** The five rails are five STATES, and the reason they
exist is accounting: the day has to partition so the desk and the register
reconcile. That is a requirement on the DATA, not on the layout. A receptionist
does not think in states — they think "who do I deal with next".

So: **a single list of everybody here today, in arrival order, each row
carrying its own state marker.** Above it, one row of filter chips —
`Here now 7 · On a tablet 0 · Needs a look 0 · Finished 0` — which are also
where the colour lives, so the eye still lands on the right thing and the
reconciliation is visible on ONE line instead of in five blocks. Tapping a chip
filters the list.

**What that buys on a small screen.** Five headings, five counts and five
empty-state paragraphs collapse into one strip. On the screenshot from today,
four of the five rails were empty and still consumed most of the column. This
is the difference between seeing three patients and seeing twelve.

**And the detail panel.** Wide screen: the side panel as now. Narrow screen:
the row expands IN PLACE, so the patient's work opens under their name and the
list stays on screen. That also honours §13 more literally than the current
design does — you never leave the list, so there is nowhere to be sent.

**What it costs, stated honestly.** At-a-glance grouping. Today you can see
"three people are finished" without reading anything; in this design the chips
have to carry that, and a chip is smaller than a heading. That is the trade,
and it is only worth taking if the room is bigger than the screen.

**What must survive the change.** The reconciliation test — the chips must sum
to the day register exactly as the rails do now — and arrival order, which is
the one ordering rule on this page.

### What must not change while improving it

- Everything about the patient stays on this page (Carl, §13).
- The rails still partition the day, and the reconciliation total still holds —
  that test is the guard against the two pages drifting apart again.
- Receptionist vocabulary, learnable on day one by somebody aged eighteen.
- Nothing on the page blocks care, and it keeps saying so.

## Still open for Carl

- **Four definitions of "what day is it"** and they disagree (`TODO.md`). Only
  the new `practiceDayWindow` is right wherever it runs. Should the other three
  move? It changes what the tablet desk shows for ten hours a day.
- **Timezone per location** is decided (D-2026-09-12-17) and not built.
- **Practice posture per integration point** is decided (D-2026-09-12-14) and
  not built. It is what stops the write-back staleness warning firing forever at
  a practice with nothing to write back into.
- **The corrected-resend contract** (D-2026-09-12-15). A connector resending
  corrected details under the same idempotency key is silently ignored today.
- **Tier 2 authentication** is built in the sandbox realm and has six questions
  waiting in its report — session length, whether step-up re-runs the whole
  sign-in, and whether the practice administrator is in tier 2.

## Ways of working recorded today

- **`git add <paths>` then `git commit` commits the WHOLE INDEX**, not those
  paths, and with agents running the index is not yours. Use
  `git commit -o <paths>`. One commit today carried thirty-one files while its
  message described six (wow.md 5a).
- **A flaky assertion is fixed at the assertion, never by re-running.** A random
  identifier can contain ten consecutive digits, which turned a
  no-Medicare-number check into a coin toss.
- **Read `INVENTORY.md` before writing a component or helper**, and report what
  was imported versus written.
