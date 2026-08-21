# The development loop

**Do not rebuild containers to test a change.** A `docker compose up --build
core web` is 60–90 seconds; the loop below is about two.

## Why it was slow

`core` and `web` were running as production Docker images, so every backend
edit meant rebuilding an image, recreating a container, and waiting on a
healthcheck. Nothing about that is necessary in development — the images exist
so the stack can be started by someone who has not installed Node.

The infrastructure (Postgres, immudb, Keycloak, MailHog) genuinely does belong
in Docker: it does not change while you work, and it takes real setup to run
otherwise. So it stays there, and only the two things you actually edit move
out.

## The loop

Run these two, once, and leave them running.

```bash
docker compose up -d postgres immudb keycloak mailhog rules vault
```

```bash
npm run start:watch -w apps/core
```

```bash
npm run dev -w apps/web
```

- **core** on http://localhost:3001 — `node --watch` restarts it in ~2s on any
  `.ts` change under `apps/core`.
- **web** on http://localhost:3100 — Fast Refresh, near-instant, keeps form
  state across edits.
- `apps/web/.env.local` points web at the local core rather than the container.

Stop the containerised `core` and `web` first, or they compete for the same
database rows and you will chase ghosts:

```bash
docker compose stop core web
```

## What still needs a rebuild

| Change | What to do |
|---|---|
| Anything in `apps/core/src` | Nothing — it restarts itself |
| Anything in `apps/web/app` | Nothing — Fast Refresh |
| `packages/domain` and friends | `npm run build -w packages/domain` — the apps consume build output, not source |
| A new migration | Apply it to the running database; see below |
| `docker-compose.yml`, a Dockerfile, a new dependency | `docker compose up -d --build <service>` |

## Migrations without a rebuild

```bash
docker exec -i aobplatform-postgres psql -U aobplatform -d aobplatform -v ON_ERROR_STOP=1 -c "SET search_path TO core;" -f - < apps/core/prisma/migrations/<name>/migration.sql
```

**Write every migration so it can be applied twice.** `DROP FUNCTION IF EXISTS`
before `CREATE FUNCTION`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT
EXISTS`. A migration that only works once passes in development and then breaks
`prisma migrate deploy` on the next container start — which is exactly how this
document came to be written.

Two Postgres traps worth knowing, both hit in one afternoon:

- **`CREATE OR REPLACE FUNCTION` cannot change a return type.** Adding a column
  to a `RETURNS TABLE` needs `DROP FUNCTION` first, or you get *"cannot change
  return type of existing function"*.
- **A running service caches query plans.** After changing a function's shape,
  restart core or the next call fails with *"cached plan must not change result
  type"* — which looks like a code bug and is not one.

## 127.0.0.1, never `localhost`

`apps/core/.env` uses `127.0.0.1` for every service, and that is not a style
preference. On Windows `localhost` resolves to `::1` first; Docker Desktop
publishes on both stacks but its IPv6 forwarding accepts the TCP connection and
then fails the protocol handshake.

The symptom is the worst kind — everything looks up, and only the things that
speak a protocol fail:

| What you see | What is happening |
|---|---|
| A socket test says the port is **open** | The TCP connection really does succeed |
| Prisma says **"can't reach database server"** | The Postgres handshake never completes |
| An SMTP send **hangs** until timeout | Same, without even the courtesy of a refusal |
| Tests fail intermittently | Whichever address the resolver returned first |

This cost an afternoon and was misdiagnosed as flaky tests. When a connection
test passes and a client says "cannot reach", suspect the address family before
suspecting the service.

### But "127.0.0.1 everywhere" is NOT the rule

Two values in `apps/core/.env` are not addresses to connect to, and setting
them to `127.0.0.1` breaks authentication silently:

| Setting | Value | Why |
|---|---|---|
| `KEYCLOAK_PUBLIC_ISSUER` | `localhost` | It is compared against the token's `iss` claim as a STRING. Never fetched. |
| `KEYCLOAK_JWKS_URI` | `127.0.0.1` | We fetch it. Server-to-server. |
| `KEYCLOAK_ISSUER` | `127.0.0.1` | We mint service tokens against it. Server-to-server. |

The issuer is minted from the URL **the browser** used. Get it wrong and every
browser-issued token is refused with `unexpected "iss" claim value` — and it
stays invisible until an endpoint actually verifies one. See CRITICAL-ISSUES.md
§4; this was live for weeks and would have made `AUTH_ENFORCE=true` lock
everybody out.

## `node --watch` forks a child, and killing the parent orphans it

The watcher is not the server. `node --watch` runs the application in a **child
process** and restarts that child on a file change. Kill the watcher — or the
`npm` process above it — and the child keeps running: still bound to port 3001,
still answering requests, still executing **the code it started with**.

It is a genuinely nasty failure because everything looks correct:

| What you see | What is happening |
|---|---|
| `curl localhost:3001/health` returns 200 | The orphan is answering |
| A new endpoint 404s | The orphan predates it |
| A new watcher logs `EADDRINUSE` | It never bound, and you may not be watching its log |
| `prisma generate` fails **EPERM** on `query_engine-windows.dll.node` | The orphan holds the engine open |

That last one is the tell, and it was blamed on OneDrive for several minutes.
Nothing but a running Prisma client holds that file.

Kill by what it runs, not by the process tree:

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*src/main.ts*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"
```

And confirm nothing is left holding the port before starting again:

```bash
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3001 -State Listen | Select-Object OwningProcess"
```

**Regenerate the Prisma client whenever the schema gains a column**, or the
generated types will not have it and `tx.affiliation.inviteToken` is a compile
error that reads like a schema mistake. The generated `index.d.ts` is written
before the engine is copied, so an EPERM on the engine does **not** necessarily
mean the types are stale — check the timestamp before assuming the worst.

## Tests

Run the package you touched, not everything:

```bash
npm run test -w packages/domain
```

```bash
npm run test:e2e -w apps/core -- onboarding-sequence
```

The full sweep (`npm run test && npm run test:e2e`) belongs before a commit, not
after every edit.
