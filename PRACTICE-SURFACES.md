# PRACTICE-SURFACES.md — which parts of AoB a practice uses
### v1.0 · 17 September 2026 · Owner: Carl. The decision is `DECISIONS.md` D-2026-09-14-04; the list itself is `packages/domain/content/practice-surfaces.json`, which is the authority. This file is the readable copy and the reasoning.

Everything in AoB stays built. A practice sees a subset of it, chosen by one
setting, and turning a part on is a setting change rather than a deploy.

> *"Put in the plan to build it as the first slice of AoB, feature flagged.
> However, lets keep calling it AoB... leave everything in place - do not change
> anything."* — Carl, 14 September 2026

---

## 1. The setting

`Practice.surfaceProfile`, a single string column, **default `full`**. Every one
of the 142 practices in the dev database is `full`, and the default means this
change was a no-op for all of them.

Changed through the one path every other practice setting uses:

```bash
curl -s -X PATCH http://localhost:3001/practices/<practiceId>/config -H 'x-practice-id: <practiceId>' -H 'content-type: application/json' -d '{"surfaceProfile":"db4"}'
```

It is a **permission, not a default**, and that distinction is deliberate: the
other flags on `Practice` (`enduringByDefault`, `usesQueueTickets`) carry
comments in the schema saying "IT IS NOT A PERMISSION AND IT GATES NOTHING".
This one gates. The change is recorded as a vault event,
`practice.surface_profile_set`, in the same transaction as the row.

## 2. The profiles, as shipped

| Profile | Surfaces it holds |
|---|---|
| **`full`** (default) | db4, kiosk_walk_up, enduring_agreements, queue_rails, portal, practitioner_pages |
| **`db4`** | db4 |

An **unrecognised** profile grants the always set and nothing else. That is the
safe direction, and it is also how a future profile behaves before it is added
to the content file.

## 3. The surfaces

| Surface | Console pages | Server endpoints |
|---|---|---|
| **db4** | — | `/inbound/print-jobs` |
| **kiosk_walk_up** | — | `POST /kiosk/claim`, `PATCH /devices/*/walk-ups` |
| **enduring_agreements** | — | `/enduring`, `/notices`, `POST /agreements/*/offer-episodic`, `POST /tablet-sessions/*/offer-episodic` |
| **queue_rails** | `/practice/frontdesk`, `/practice/frontdesksmall` | `GET /arrivals/expected` |
| **portal** | `/patient` (and children) | `/portal`, `POST /agreements/*/portal-invitation`, `POST /dev/portal-session` |
| **practitioner_pages** | `/practice/practitioner`, `/practice/practitioner/waiting`, `/practitioner` | `/practitioner/me`, `/practitioner/departure-reasons`, `/practitioner-queue` |

**Two surfaces have no console page of their own, and that is correct.**
`kiosk_walk_up` is a mode of `/kiosk`, which also serves a pushed session and so
is always on; `enduring_agreements` is a mode inside the kiosk ceremony driven by
`enduringByDefault`, and has never had a route.

## 4. The always set — 39 pages and 32 endpoint prefixes

Nothing here can be turned off. A practice with none of the optional surfaces
still has to sign in, be configured, and record what happened.

- **Getting in and getting set up:** `/`, `/apply`, `/help`, `/callback`, `/invitation`, `/status`, `/verify`, the email-confirmation pages, `/practice`, `/practice/today`, `/practice/setup` and every setup child (entity, application, locations, channels, templates, pms, practitioners, affiliations, users, devices).
- **The platform's own pages:** `/platform/*`, `/review`, `/practice/reviews`, the three `/practice/queue*` pages.
- **The shared machinery:** `/practice/tablet`, `/practice/day`, `/practice/patients`, `/practice/reconciliation`, `/practice/correspondence`, `/practice/reports`.
- **Endpoint prefixes:** `/acting-as`, `/affiliations`, `/agree`, `/agreement-copy`, `/agreement-templates`, `/agreements`, `/applications`, `/arrivals` (except `expected`), `/artefacts`, `/capture`, `/chase-attempts`, `/correspondence`, `/dev`, `/devices` (except walk-ups), `/health`, `/identity`, `/invitations`, `/kiosk` (except `claim`), `/organisations`, `/outbound`, `/patients`, `/pending-email-change`, `/platform`, `/pms`, `/practice-users`, `/practices`, `/practitioners`, `/reconciliation`, `/review-tasks`, `/service-descriptions`, `/tablet-sessions`, `/verification`.

**The tablet desk, the day register and the patient work list are here, not in
`db4`,** and the difference matters. The first customer keeps all three — but so
does a practice that uses the waiting-room kiosk and has never printed a DB4. A
surface is something a practice may not have bought; shared machinery is not.

## 5. How it is enforced

**One classification, two consumers**, so the console and the server cannot
drift into disagreeing about what a practice can see.

- **Console:** `MainMenu`, `TodayView` and `SetupHub` filter their destinations,
  and `AccessGuard` refuses a page whose surface is off — with its own copy
  saying this practice does not use that part of AoB, never the existing "that
  page is not for this account", which would be a lie and would send somebody to
  ask about permissions.
- **Server:** a global `SurfaceGuard` refuses with
  `403 { code: 'practice_surface_not_in_use', surface, message }`. Never a bare
  403: an unmapped refusal must show its code (CLAUDE.md §7c, shortcuts to the
  answer).

All 248 route declarations in `apps/core` are classified, and
`every_core_route_belongs_to_a_surface` fails the build on one that is not.

### An unclassified route is ALLOWED at runtime, on purpose

This is fail-open and it is deliberate. Hard rule 8 says the platform never
blocks care: wrongly refusing an endpoint a practice needs is a worse failure
than a surface leaking into a practice that has not bought it. The build-time
test is what catches a gap; the runtime is what must not stop a patient being
seen. Anyone reading the fail-open and taking it for a bug should read this
paragraph first.

The blast radius is contained for the same reason: `full` is the default and
holds every surface, so a misclassification can only affect a practice somebody
has explicitly moved off `full`.

## 6. What is NOT enforced, and should be read before relying on this

### 6a. Two surfaces are hidden in the console and open at the API

The guard resolves a practice from the token claim, then the `x-practice-id`
header, and **allows the request when neither is present**. These carry neither:

- **all 22 `/portal/*` routes** — a patient cookie session, no practice header;
- **all 9 `/practitioner/me/*` and `/practitioner/departure-reasons` routes** — a
  practitioner token, no practice header.

So `portal` and `practitioner_pages` are effectively console-only settings today.
`/practitioner-queue/*` **is** enforced, because the console sends the header.

### 6b. The db4 gate currently refuses nobody

**Both shipped profiles include the `db4` surface**, so there is no setting you
can give a practice that refuses a DB4 print job. The machinery is correct and
unreachable. Closing it needs one more profile — something like `standard`,
everything except db4 — which is a product decision about what we sell, not a
code change.

Until then, `surfaceProfile` can restrict a DB4-only customer but cannot keep the
print channel out of anybody else, which was the original point of
`TODO.md`'s AOBPRINTER item 5.

### 6c. One test is named for a behaviour it does not demonstrate

`a_db4_print_job_is_refused_when_the_practice_does_not_use_db4` in
`apps/core/test/practice-surfaces.e2e-spec.ts` posts under `db4` (accepted),
switches to `full`, and posts again (accepted). It never refuses. The only real
refusal is in `surface.guard.spec.ts`, using `kiosk_only` — a profile that does
not ship. Both are consequences of 6b and should be fixed with it.

## 7. Two routes nobody could classify confidently

Both left in the always set, which is the safe direction, and both are Carl's.

1. **`/arrivals/*` other than `expected`.** Genuinely shared: `/practice/patients`
   and `/practice/day` both call `needing-a-provider`, `servicing-providers`,
   `preview` and `day`. Gating them on `queue_rails` would break two pages that
   are not the front desk.
2. **`/practice/reconciliation`.** D-2026-09-14-04 says the first customer sees
   "no reconciliation screens", but no reconciliation surface exists in the list,
   so the page and its endpoints are always on. **This needs a ruling:** either a
   `reconciliation` surface, or an amendment to the decision.

## 8. Adding a surface

1. Add it to `packages/domain/content/practice-surfaces.json` with its pages and
   endpoint prefixes, and add it to the profiles that should hold it. **Adding a
   surface to the file does not add it to `db4`** — that is the point, and it is
   why the list is a set of profiles rather than a set of "off" switches.
2. Add its display label to the string table, keyed by surface key. Never put a
   label in the JSON.
3. `every_core_route_belongs_to_a_surface` and the `PAGES` classification test
   will tell you what you missed.

## Change log
| Date | Change |
|---|---|
| 17 Sep 2026 | v1.0. Written when piece 6 landed (`26ac33b`), with the classification as built and the three gaps in section 6 stated rather than left to be discovered. |
