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
