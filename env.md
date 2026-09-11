# The development environment

**Run the check before you believe anything the console tells you.**

```bash
powershell -File scripts/check-env.ps1
```

Two seconds. Exit 0 means the environment is as it looks; exit 1 lists what is
wrong and the command that fixes it.

---

## Why this page exists

Twice in one morning the console showed something false, and both times the
cause was the environment rather than the code.

**"Your data has been deleted."** Postgres held every record — 42 practices, 11
practitioners, every affiliation. The core API process was simply not running.
`/practice/setup` caught the failure and said *"the practice you selected no
longer exists"*, which reads as data loss to anybody who has ever lost data. It
cost a scare and half an hour, and the fix was `npm run start:watch`.

**"My edits are having no effect."** Two `node --watch` processes were fighting
over port 3001. One held the port and kept answering with the code it had
started with; the other logged `EADDRINUSE` and parked itself *"waiting for file
changes"*. Every edit was correct, every test passed, and the running service
was a different service. Nothing on the screen could have told you that.

Both looked like product bugs. Neither was one. **A wrong answer about the
environment is more expensive than a wrong answer about the code, because
nothing in the code will explain it.**

---

## What runs where

| Piece | Where | Port | Started by |
|---|---|---|---|
| Postgres | container | 21020 | `docker compose up -d` |
| Keycloak | container | 21024 | `docker compose up -d` |
| MailHog | container | 21025 | `docker compose up -d` |
| Redis | container | 21021 | `docker compose up -d` |
| Vault, rules, cube, immudb | containers | 21003, 21002, 21030, 21022 | `docker compose up -d` |
| **core API** | **the host** | **3001** | `npm run start:watch -w apps/core` |
| **console (Next)** | **the host** | **3100** | `npm run dev -w apps/web` |

The two that matter most are the two that are **not** containers. `docker ps`
looking healthy says nothing about whether the API is running.

---

## The rules that keep it clean

**Exactly one core process.** Not "at least one". Two is the worst state
available: the one holding the port answers with stale code, the other waits
invisibly, and both wake on the next file change. Before starting one, stop
what is there.

```bash
powershell -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'main\.ts' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
```

**Use `start:watch`, not `start:dev`.** `start:dev` is plain `ts-node` and does
not reload — an edit to the API does nothing until it is restarted by hand, and
"nothing happened" is indistinguishable from "the change was wrong".

**Rebuild the domain package after editing it.** The console imports
`@aobplatform/domain` from its **built `dist`**, so editing the source and not
rebuilding means the browser runs the old rules while the tests pass against the
new ones. This has already cost an afternoon: an access rule was corrected, the
test proved it, and the menu went on hiding the page.

```bash
npm run build -w packages/domain
```

**Regenerating the Prisma client needs the API stopped.** The running process
holds `query_engine-windows.dll.node`, and `prisma generate` fails with `EPERM`
on the rename. Stop core, generate, start core.

**Migrations are applied with an explicit URL.** `.env` points the app at the
`aob_app` role, which deliberately cannot alter the schema.

```bash
DATABASE_URL="postgresql://aobplatform:aobplatform@127.0.0.1:21020/aobplatform?schema=core" npx prisma migrate deploy
```

---

## When the console says something alarming

Check the environment **before** believing it, in this order:

1. `powershell -File scripts/check-env.ps1`
2. If the API is down, everything else is noise. Start it and look again.
3. If it is up, ask whether it is running the code on disk — a parked watcher
   or a stale `dist` produces a service that is real, answering, and wrong.
4. Only then is it a bug.

A screen that says records are missing when the API is unreachable is itself a
bug, and those get fixed as they are found — `/practice/setup` now distinguishes
"we cannot reach the server" from "that practice is gone", and keeps the stored
selection either way. But the check is faster than the fix, and there will
always be one more screen that has not been taught the difference yet.

---

## Sign-in, and why F5 costs something here

The access token is held **in memory only**, deliberately: nothing a script can
reach ever holds it. The cost is that reloading the page throws the session away
and asks for a passkey again.

So there is a refresh control in the top bar of every page that has anything to
re-read. Use it instead of F5.

If controls you are entitled to have vanished — no "Record a register check", no
Platform section in the menu — the likely cause is a **token issued before a
realm change**, which keeps refreshing without ever gaining what it was minted
without. The session bar shows a red *"Sign in again"* when a signed-in session
carries no roles at all. Signing out and back in is the cure.
