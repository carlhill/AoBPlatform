# PRACTICE-NAVIGATION.md — where a practice user starts, and why not the setup hub
### v1.0 · 12 September 2026 · Owner: Carl. A plan, not yet built. Companion to `FRONT-DESK-PAGE.md`, `PRACTITIONER-QUEUE-PAGE.md`, `ROLES.md`.

Carl, 12 September 2026: *"I asked for the practice/practitioner link to be on
the attached card. That is the wrong place. We need a better starting point for
the practice-admin, practice-manager or practice-reception who will also be able
to see the practitioner-queue."*

---

## 1. What went wrong, measured

`/practice/setup` — the setup hub — now carries **twelve destinations** in 752
lines:

| Kind | Destinations |
|---|---|
| **The day's work** | patients, tablet desk, front desk, queue, correspondence |
| **Configuration** | devices, templates, users, application |
| **Oversight** | reports, reviews, reconciliation |

It is where everything has been added because it is where everything already
was. A receptionist starting a shift and an administrator changing the
letterhead land on the same screen, and each has to read past the other's work
to find their own. Adding the practitioner queue as a thirteenth card makes a
bad page slightly worse, which is why Carl stopped it.

**The real fault is that the hub is organised by WHAT A THING IS, not by WHY
SOMEBODY CAME.** Nobody arrives at a practice console thinking "I need a
configuration page".

## 2. The split

Two homes, divided by how often a person needs them.

### `/practice/today` — the day's work. The default landing for practice staff.

Everything somebody touches during a shift, and nothing else:

- **Front desk** — who is here, who is next (`FRONT-DESK-PAGE.md`)
- **Who is waiting** — the practitioner queues, all of them, grouped by
  practitioner (`PRACTITIONER-QUEUE-PAGE.md`, in its practice-staff mode)
- **Tablets** — the existing send desk, for the experienced user
- **Patients** — the work list
- **Messages** — correspondence

Five things, all of them today's. A person who never opens anything else can do
their whole job from here.

### `/practice/setup` — configuration and oversight. Visited occasionally.

Devices, templates, users, application, reports, reviews, reconciliation. It
keeps its name and its purpose, and it stops accumulating daily work.

## 3. Where each role lands

| Role | Lands on | Why |
|---|---|---|
| practice-reception | `/practice/today` | The shift is the job |
| practice-manager | `/practice/today` | Same, and setup is one click away |
| practice-admin | `/practice/today` | Even an administrator starts the day in the room |
| practitioner | `/practice/practitioner` | Their own landing, with their waiting list |
| platform operator acting as a practice | `/practice/today` | They are standing in for practice staff |

**Nobody lands on `/practice/setup` any more.** It becomes a place you go, not a
place you arrive.

## 4. The practitioner queue belongs to both

This is the point Carl was making. The waiting list is not a practitioner's
private page:

- A **practitioner** sees their own list. Never anybody else's, and the
  cross-practitioner test fails closed.
- **Reception, a manager or an administrator** sees every practitioner's list,
  grouped by practitioner. Knowing who is waiting for whom is reception's job,
  and a front desk that cannot see it is worse than the paper list it replaced.

One page, one set of data, one definition of the three words. Two audiences and
two shapes.

## 5. Rules

1. **Organised by why somebody came, not by what a thing is.** A new page joins
   `today` if it is touched during a shift, and `setup` if it is not. If it is
   genuinely both, it goes in `today` and is linked from `setup`.
2. **Landing is a decision the page map does not currently express** (`ROLES.md`
   §6 rule 5). It needs one home, not a redirect in each page.
3. **Nothing moves URL.** Every existing route keeps working; this is a change to
   what is linked from where and what a person lands on. A bookmark to
   `/practice/setup` must still open the setup hub.
4. **View-only and acting-as keep working.** Both already thread through the hub
   with `toViewPath`; the new home does the same or it silently breaks the
   platform operator's path.

## 6. Named tests

- `practice_staff_land_on_todays_work_not_the_setup_hub`
- `a_practitioner_lands_on_their_own_page`
- `every_daily_destination_is_reachable_from_today_in_one_click`
- `the_setup_hub_still_opens_from_its_own_url` — nothing moves.
- `reception_sees_every_practitioner_queue_and_a_practitioner_sees_only_their_own`
- `an_operator_acting_as_a_practice_lands_where_practice_staff_land`

## 7. For Carl

- **Is `today` the right word?** Alternatives: "Front of house", "The floor",
  "Your shift". "Today" is short, honest and non-clinical, and it says the page
  is about now rather than about records.
- **Should the tablet desk stay on `today`, or move to setup as the expert
  tool** once the front desk page has its actions? It is daily work, so it
  belongs on `today`; but two desks side by side needs one sentence saying which
  is which.
- **Does an administrator want a different landing?** The table above says no —
  everyone starts in the room — but a practice manager who never touches the
  counter may disagree, and that is worth asking one real practice.

## Change log
| Date | Change |
|---|---|
| 12 Sep 2026 | v1.0. Written when Carl rejected a thirteenth card on the setup hub and asked for a better starting point. |
