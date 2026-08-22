# Cube — the reporting layer

Report requests arrive faster than reports can be built by hand, and each
hand-built one is another place a total can come from. Cube answers questions
nobody anticipated, from one definition of what a message is.

## Getting to it

| | |
|---|---|
| **Playground** (build queries by clicking) | <http://localhost:21030> |
| REST API | `http://localhost:21030/cubejs-api/v1/load` |
| SQL API (connect Metabase, Excel, psql) | not enabled yet — see below |
| Health | `http://localhost:21030/readyz` |

```bash
docker compose up -d cube
```

The **Playground** is the thing to open first. Pick `OutboundMessages`, drag a
measure and a dimension, and it builds the query and the chart. That is the
whole point of it: the next report request does not need a developer.

## What you can ask about today

One cube, `OutboundMessages`, over everything this platform has sent.

- **Measures** — Messages, Sent, Failed, Still waiting, Delivery attempts, Resends
- **Dimensions** — Organisation, Site, Department, Channel, Format, State
- **Time** — When (sent if sent, raised otherwise), Raised, Sent

Group by anything, filter by anything, at any grain Cube supports — hour to
year. The two-year retention limit is built into the view, so it applies
however the question is asked.

**Not in here, deliberately**: no recipient, no address, no message body or
subject, no patient, no practitioner, no provider number. Those are answerable
in the console, scoped, by somebody allowed to. They are not answerable here at
any scope, and a test asserts the columns stay absent.

## How practices are kept apart

Cube composes its own SQL. That is its value and its risk: whatever it can
reach, it can be asked for. So the boundary cannot be "our queries are
careful" — there are no queries of ours. It has to be something the database
refuses to answer.

**Three layers, none load-bearing alone.**

1. **Identity.** Tokens are verified against Keycloak's JWKS. No second user
   store, no shared secret. A request either carries a token this realm signed
   or it is refused.

2. **The database — this is the real one.** `reporting.outbound_messages` is a
   `security_invoker` view, so the RLS policies of the underlying tables apply
   to *the connecting role* rather than to the view's owner. Cube connects as
   `cube_reader`, which those policies apply to, on a connection whose
   `app.practice_id` is fixed for that tenant. Pinned on the **connection**, not
   per query, so it survives Cube's pooling — a request cannot leave a setting
   behind for the next one to pick up.

3. **The query.** `queryRewrite` injects a mandatory practice filter, so the
   narrowing is visible in the SQL Cube composes and not only in what Postgres
   is willing to answer.

Plus a fourth thing that is not a layer but bounds the damage: the reporting
view holds counts and coarse dimensions. If all three failed at once, what
leaks is volumes rather than anybody's data.

**A platform report reads across practices** — that is what it is. It uses a
separate credential, `cube_platform_reader`, carrying `BYPASSRLS`, reachable
only through a token carrying `platform_admin`. The difference between one
practice and all practices is a different database login, not a wider filter.

### Proved, not asserted

`apps/core/test/reporting-isolation.e2e-spec.ts` connects as those roles
directly and checks that a scoped reader sees its own practice and *only* its
own, that a connection with no practice reads nothing, that going around the
view to the raw tables reads nothing either, and that no column naming a person
has appeared in the reporting surface.

It also asserts two practices have data first — every other assertion is
"X cannot see Y", and all of them pass trivially against an empty database.

```bash
npx jest --config jest.e2e.config.js --testPathPattern reporting-isolation
```

### About dev mode

`CUBEJS_DEV_MODE=true` is on because the Playground needs it, and Cube logs
that "authentication checks are disabled in developer mode".

**That log line overstates it here.** Because `jwt.jwkUrl` is configured, tokens
are still verified against the realm's JWKS — checked, not assumed:

| Request | Result |
|---|---|
| No token | refused |
| Unsigned / forged token | refused |
| Valid Keycloak token, no scope claims | refused |
| Valid token with `platform_admin` | all organisations |

And underneath that, layer 2 does not depend on any of it: a connection with no
practice reads nothing, because the database refuses.

Still set `NODE_ENV=production` outside a laptop. The Playground goes, and Cube
enforces the JWT itself rather than relying on the configuration below it.

### No background refresh, on purpose

Cube's scheduled refresh runs with an *empty* security context, which
`driverFactory` refuses. That refusal is correct: a refresh job with no practice
would either read nothing or — if somebody "fixed" it by handing it the platform
credentials — become a background process reading every tenant's data on a
timer.

Pre-aggregations still build, lazily, on the first query for a tenant, under
that tenant's own scoped connection. Turning the scheduler on later means
naming the contexts to refresh (`scheduledRefreshContexts`), not relaxing the
check.

## Adding a cube

1. Add a view to the `reporting` schema in a migration. Counts and dimensions;
   nothing that names a person.
2. `GRANT SELECT` on it to both roles **explicitly**. Grants are per-object on
   purpose, so a new view is a decision rather than an inheritance.
3. Add the model under `infra/cube/model/cubes/`.
4. Carry `practiceId` as a hidden dimension, or `queryRewrite` has nothing to
   filter on and the tenancy layer silently does not apply to it.
5. Extend the isolation test to cover it.

Step 4 is the one that is easy to miss and impossible to notice afterwards.
