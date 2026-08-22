# Cube — the reporting layer, and how its isolation was proved

Cube answers reporting questions nobody anticipated, from one definition of
what a message is. This file is the record of **whether one practice can see
another's figures through it**, and how that was checked rather than assumed.

Configuration and day-to-day use: [`infra/cube/README.md`](infra/cube/README.md).
Open the Playground at <http://localhost:21030>.

---

## Why this needed proving at all

Everywhere else in this codebase the tenancy boundary is a query we wrote, with
RLS underneath as the fail-closed backstop. Cube breaks that pattern: **it
composes its own SQL.** That is the whole value of it — somebody asks a question
we never thought of and it writes the query — and it is exactly why "our queries
are careful" cannot be the answer here. There are no queries of ours.

The specific hazard is not hypothetical. Our RLS is keyed on
`app.practice_id`, a transaction-local setting. Cube **pools connections**. The
natural outcome of pointing Cube at this database is that the setting does not
follow a pooled connection, RLS silently stops applying, and a JavaScript config
file becomes the only thing standing between two practices — with nothing
failing, and nothing to find later.

So the arrangement below puts the enforcement back in Postgres, and this file
is the evidence that it landed there.

---

## The arrangement

**Three layers, none load-bearing alone.**

1. **Identity** — tokens verified against Keycloak's JWKS. No second user store,
   no shared secret.
2. **The database — the real one.** `reporting.outbound_messages` is a
   `security_invoker` view, so the base tables' RLS policies apply to *the
   connecting role* instead of being bypassed by the view's owner. Cube connects
   as `cube_reader` (no `BYPASSRLS`, owner of nothing) on a connection whose
   `app.practice_id` is fixed. **Pinned on the connection, not per query**, which
   is what survives pooling.
3. **The query** — `queryRewrite` adds the practice filter too, so the narrowing
   is visible in generated SQL and not only in what Postgres will answer.

**Plus a fourth thing that is not a layer but bounds the damage.** The reporting
view carries counts and coarse dimensions only. If all three layers failed at
once, what leaks is volumes — not names, not addresses, not message content, not
patients, not practitioners, not provider numbers.

Platform-wide reporting reads across practices because that is what it is, so it
uses a **separate database credential** with `BYPASSRLS`, reachable only through
a token carrying `platform_admin`. One practice versus all practices is a
different login, not a wider filter.

---

## The suite

```bash
cd apps/core && npx jest --config jest.e2e.config.js --testPathPattern reporting-isolation
```

Source: [`apps/core/test/reporting-isolation.e2e-spec.ts`](apps/core/test/reporting-isolation.e2e-spec.ts)

```
PASS test/reporting-isolation.e2e-spec.ts
  reporting layer tenancy
    √ has two practices with messages, or this test proves nothing
    √ shows a scoped reader its own practice, so the positive case is real
    √ SHOWS IT NOTHING FROM ANY OTHER PRACTICE
    √ refuses a reader with NO practice on its connection
    √ refuses the same reader going AROUND the view to the tables
    √ lets the platform credential look across, because that is what it is for
    √ keeps MESSAGE CONTENT and identifiers out of the reporting surface
    √ NEVER lets one practice see another practice's recipient names
  a practitioner reading their own figures
    √ has two practitioners with messages, or this proves nothing
    √ shows a practitioner their own messages
    √ SHOWS THEM NOTHING OF ANOTHER PRACTITIONER
    √ reads nothing with no practitioner on the connection
    √ REFUSES the practice-wide view outright, rather than returning it empty
    √ cannot reach the raw table beyond its own rows

Test Suites: 1 passed, 1 total
Tests:       14 passed, 14 total
```

### What each one is actually for

| Test | The failure it exists to catch |
|---|---|
| has two practices with messages | **The suite lying.** Every other assertion is "X cannot see Y", and all of them pass against an empty database. Without this guard a green run proves nothing. |
| shows a scoped reader its own practice | The opposite lie — a boundary so tight the reader sees nothing, which also passes every "cannot see" test. |
| SHOWS IT NOTHING FROM ANY OTHER PRACTICE | The one that matters. Counts distinct practices (must be 1) and then asks for another practice by name in the same session (must be 0). |
| refuses a reader with NO practice | Fail-closed. A connection that forgot to name a practice must read nothing rather than everything. |
| refuses going AROUND the view | The view is not the boundary; the policies are. A second view added later, or Cube pointed at a table, must not be a way through. |
| lets the platform credential look across | That the separation is real and not just everything being broken. |
| keeps message content out of the surface | The fourth layer. Bans `providernumber`, `ahpra`, `body`, `payload`, `subject`, `destination`, `medicare`. **It used to ban anything containing `recipient` or `practitioner`, which was wrong in both directions** — it tripped on `recipientType`, a category rather than a person, and it would have banned the recipient name a practice is entitled to see about its own people. |
| never lets one practice see another's recipient NAMES | Replaced the blunt column check. Names being present is a decision; names crossing a practice boundary is not. Asserted about the **rows returned**, which is where the boundary actually lives, rather than about which columns exist. |
| *(practitioner)* shows them their own messages | The positive case for the second policy, and the awkward one — a practitioner has no practice to name, so without `app.practitioner_id` this reads nothing at all. |
| *(practitioner)* shows them nothing of another | Counts distinct practitioners (must be 1) as well as asking for another by name (must be 0). |
| *(practitioner)* refuses the practice-wide view | A **refusal**, not an empty answer. "Permission denied" says you asked the wrong question; zero rows would say the practice sent nothing, which is a claim about the practice and would be false. |

It runs through `psql` as those roles rather than through Prisma, deliberately —
Prisma connects as the application role, and the entire question is what a
*different* role can see.

---

## The third scope: a practitioner

A practitioner is not scoped to a practice. They work at several, which ones
changes, and "what was sent to me" spans all of them — so the usual policy has
no practice to name and reads nothing. Fail-closed, and here fail-wrong.

**The tempting answer was the platform credential plus a filter in Cube.** That
would put every practitioner's data one config mistake from every other
practitioner's, and take the database out of the argument entirely — the exact
trade refused for practices.

**Instead: a second RLS policy on the same table**, keyed on
`app.practitioner_id`. Policies are OR'd, so:

| Connection carries | Sees |
|---|---|
| `app.practice_id` | that practice's rows |
| `app.practitioner_id` | that practitioner's rows, wherever they are |
| neither | nothing |

Two further policies let a practitioner read the *name* of a practice that has
actually written to them — expressed as a join back through their own messages,
so the set is "practices I have heard from" rather than a list of practices.

They get a **third credential**, `cube_practitioner_reader`, with no `BYPASSRLS`
and **no grant at all** on the practice-wide view. A practitioner asking the
practice question gets `permission denied`, not zero rows — because zero rows
would say the practice sent nothing, which is a claim about the practice, and
would be false.

Their cube is `MyMessages`, separate from `OutboundMessages` rather than a
filtered version of it. The two answer different questions from different
vantage points, and keeping them apart is what keeps the credentials apart.

## End to end, through the API

The suite covers the database. These were run against the live service with
**real Keycloak-signed tokens**, to check the layers above it.

| Request | Result |
|---|---|
| No token | refused |
| Unsigned / forged token | refused — signature not from this realm |
| Valid Keycloak token, no scope claims | refused — *"No practice on this token"* |
| Valid token with `platform_admin` | all three organisations |

The platform query returned:

```
XLEVELUP Medical            | messages 10 | sent 10
Jo Example Medical          | messages  3 | sent  3
Sampletown Family Practice  | messages  3 | sent  3
organisations visible: 3
```

Which matches the console's own summary table exactly — the point being that two
different code paths over the same data agree.

The `platform_admin` role was granted to a service account for that check and
**revoked immediately afterwards**. It is not standing.

### Reproducing the refusal checks

```bash
curl -s -G "http://localhost:21030/cubejs-api/v1/load" --data-urlencode 'query={"measures":["OutboundMessages.count"]}'
```

Expect: `"No practice on this token, so this query is refused."`

### Reproducing the database checks by hand

```bash
docker exec -e PGPASSWORD=cube_reader aobplatform-postgres psql -U cube_reader -d aobplatform -A -t -c "SET app.practice_id='<a-practice-id>'; SELECT count(DISTINCT \"practiceId\") FROM reporting.outbound_messages;"
```

Expect `1`, whatever else is in the database.

---

## What this does **not** prove

Worth stating, because a verification document that only lists successes invites
more confidence than it earned.

- **Dev mode.** `CUBEJS_DEV_MODE=true` is on so the Playground works. Cube logs
  that authentication is disabled; that overstates it here, because `jwt.jwkUrl`
  is set and tokens are still verified — which is what the table above checked.
  It is still not a production setting. Use `NODE_ENV=production` outside a
  laptop.
- **Only one cube exists.** `OutboundMessages` is covered. A second cube added
  without a hidden `practiceId` dimension would have nothing for `queryRewrite`
  to filter on, and layer 3 would silently not apply to it. Layer 2 would still
  hold. The checklist in `infra/cube/README.md` exists for this and the isolation
  test should be extended alongside any new cube.
- **Patient scope is not built.** Platform, organisation and practitioner
  exist. A patient scope would need the same shape — its own policy, its own
  credential, its own cube — and it waits on the assignor relationship model,
  because an assignor acting for a patient is authority that expires, which a
  role cannot express.

  *(An earlier version of this file said practitioner scope was impossible here
  because `outbound_items` had no practitioner column. That was wrong: it
  carries `recipientType` and `recipientId`, and every practitioner message has
  them populated.)*
- **Pre-aggregations build lazily.** The scheduled refresh runs with no security
  context, which `driverFactory` refuses; that refusal is correct, so the
  scheduler is off rather than handed platform credentials — which would make it
  a background job reading every tenant on a timer. Turning it on later means
  naming `scheduledRefreshContexts`, not relaxing the check.

---

*Last verified 22 August 2026 against the local stack: Postgres 16.15, Cube
v1.3.55, Keycloak 26.0.8.*
