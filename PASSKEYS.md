# Passkeys: how to diagnose them fast

Written after a single sign-in took most of an afternoon and six wrong theories.
None of the problems were hard. Every one of them presented as something else,
and the wrong turns cost far more than the fixes.

If you are here because a passkey will not work, **start with the decision tree
at the bottom.** The rest is why it says what it says.

---

## The four traps, in the order they wasted time

### 1. The server holds a different name from the one the operating system shows

Keycloak stores the label the person typed at enrolment — `AoBPasskey1`.
Windows shows the **WebAuthn username** — whatever we set when the account was
created. Neither dialog mentions the other exists.

So somebody labels their credential carefully, is later offered a chooser
saying something else entirely, and reasonably concludes the passkey did not
save. It did.

**Fixed by:** the username is now the person's email address, which is the one
identifier they will recognise in an operating-system dialog they were not
expecting.

**Check it with:** `/admin/realms/aobplatform/users/{id}/credentials` — the
`userLabel` is the server's name for it.

### 2. There is more than one passkey provider, and Windows picks the wrong one

Windows 11 (24H2+) ships **Microsoft Password Manager** alongside Windows
Hello, and registers it as the default handler.

Its passkeys prompt for a PIN — *"Enter your Microsoft Password Manager PIN"* —
which unlocks the manager's own vault. That is not Windows Hello verifying a
person, so the assertion comes back with the **UV flag unset**, and a realm
that requires user verification refuses it.

**This is the one that cost the most**, because the PIN prompt looks exactly
like verification succeeding. The correct theory was raised early and abandoned
on that evidence.

| AAGUID | Provider | Sets UV? |
|---|---|---|
| `08987058-cadc-4b81-b6e1-30de50dcbe96` | Windows Hello Hardware | yes |
| `9ddd1817-af5a-4672-a2b9-3e3dd95000a9` | Windows Hello Software | yes |
| `6028b017-b1d4-4c02-b4b3-afcdafc96bb2` | Windows Hello VBS | yes |
| `d3452668-01fd-4c12-926c-83a4204853aa` | **Microsoft Password Manager** | **no** |

**Fixed by:** Settings → Accounts → Passkeys → Advanced options → turn
Microsoft Password Manager **off**, leaving "Save passkeys to this Windows
device" on. Then delete the old credentials and re-enrol.

**Tell which one you got:** the enrolment dialog should be headed **Windows
Security**. If it says "Microsoft Password Manager", it is the wrong one and
will fail at first sign-in.

### 3. `localhost` resolves to ::1, and Docker accepts then stalls

Docker Desktop publishes on both IP stacks. On Windows `localhost` resolves to
`::1` first, and the IPv6 forwarder **accepts the TCP connection and never
answers**. Accepting is what makes it lethal — a refusal would fall through to
IPv4, but an accepted connection means the client waits.

| What you see | What is happening |
|---|---|
| A socket test says the port is **open** | The TCP connection genuinely succeeds |
| Prisma: **can't reach database server** | The Postgres handshake never completes |
| An SMTP send **hangs** | Same, without the courtesy of a refusal |
| The browser **spins** on Keycloak | Twelve seconds a time |
| Tests fail **intermittently** | Whichever address the resolver returned first |

**Fixed by:** every published port in `docker-compose.yml` bound explicitly to
`127.0.0.1`, which removes the `::1` listener so `localhost` fails fast and
falls through.

**The rule that is NOT "127.0.0.1 everywhere":**

- **server-to-server** calls use `127.0.0.1`, or they hang
- **anything the browser follows** stays `localhost`, because redirect URLs are
  validated against the client's registered redirect URIs

Getting that backwards produces a bare `400` with no explanation.

### 4. The credential store was inside the container

`start-dev` keeps Keycloak's H2 database in the container's writable layer. A
`docker compose up -d` that only meant to change a port destroyed every user
and every enrolled passkey.

**A password can be reset. A passkey cannot be re-derived.** The private half
never leaves the device. Losing the store means re-inviting everybody, each at
their own hardware.

It fails silently, too: the realm re-imports on start, so roles and clients
come back and the system looks healthy. Only the users are gone.

**Fixed by:** Keycloak now uses the Postgres running beside it, in its own
`keycloak` database on the existing volume.

---

## Two application-side traps, same afternoon

### The token is in memory, so a full page load destroys it

The access token is held in a module-level variable and deliberately never in
`localStorage` — a token for practice data should not sit where any script can
read it.

The consequence is easy to miss: `window.location.replace()` is a **full page
load**. Every module re-evaluates and the session that was just created is
gone. The symptom was "signed in as …" flashing past, then the sign-in gate
again, with the exchange succeeding every single time.

**Use the Next router**, not `window.location`, so the JavaScript context
survives.

### `'use client'` on a module holding session state is load-bearing

`auth.ts` holds the token in module state and is imported by seven client
components across different route segments. Without an explicit client
boundary, Next may place it in more than one chunk — and then the session
written by the callback is **not the one the gate reads**.

Identical symptom to the above, different cause, and it survived the first fix.

---

## The decision tree

Work down it. Each step is cheap and rules out a whole class.

**1. Does the server have the credential at all?**

```
/admin/realms/aobplatform/users/{id}/credentials
```

- Nothing there → enrolment never completed, or the store was wiped (trap 4).
- Something there → note the **AAGUID** and go to 2.

**2. Is the AAGUID one of the Windows Hello ones?**

- No → trap 2. Turn off the other provider, delete, re-enrol.
- Yes → go to 3.

**3. What does Keycloak's log actually say?**

```bash
docker logs --tail 200 aobplatform-keycloak | grep -iE "webauthn|web_authn"
```

Read `web_authn_authentication_error_detail`. It names the cause precisely, and
reading it early would have saved most of the afternoon.

- *"UV flag in authenticatorData is not set"* → trap 2, or a policy mismatch
  (check BOTH `webAuthnPolicy…` and `webAuthnPolicyPasswordless…` — this realm
  had one at `preferred` and one at `required`).
- *NotAllowedError / timed out* → the person cancelled, or the dialog never
  appeared.

**4. Does the page hang rather than fail?**

Compare `localhost` against `127.0.0.1` with curl. If one is fast and the other
hangs, trap 3.

**5. Does sign-in succeed and then bounce back to the gate?**

Application side, not identity. Check for a full page load in the callback, and
for a missing `'use client'` on the module holding the session.

---

## What NOT to do

**Do not relax `userVerification` to make a symptom go away.** It was suggested
twice and would have worked instantly, both times.

`required` is what makes a passkey two factors: something you have, and
something you are or know. At `preferred`, an unlocked stolen laptop approves
practices — and the whole point of this platform is being able to say who
consented, which is a claim about a *person*, not a device.

Note what the failure actually did: it refused a credential that could have
been used without verifying its holder. **The control worked.** The problem was
upstream, and relaxing the control would have thrown away the only thing that
noticed.

**Do not add a password fallback "just in case".** An account that can fall
back to a password is an account whose real strength is the password, and every
phishing page and reset-my-password call comes back with it.

What actually addresses being locked out: durable storage, at least two
administrators, a recovery path with a real root of trust
(`reset-platform-admin-passkey.mjs`), and a hardware key with a PIN for anyone
whose platform authenticator cannot produce UV.

---

## Commands worth having to hand

Invite an administrator:

```bash
node infra/keycloak/invite-platform-admin.mjs --email <address> --name "<name>"
```

Revoke every passkey and re-issue an enrolment link:

```bash
node infra/keycloak/reset-platform-admin-passkey.mjs --email <address> --reason "<why>"
```

Add roles and clients to a realm that already exists (the export only imports
into an empty database):

```bash
node infra/keycloak/apply-realm-additions.mjs
```

Back up the credential store, and restore-test the backup:

```bash
node infra/keycloak/backup-keycloak.mjs
```

```bash
node infra/keycloak/backup-keycloak.mjs --verify backups/keycloak/<file>.sql
```

The verify step matters more than it looks. Realms and clients come back from
the realm import on every start, so a restore that produced only those would
look healthy and contain **nobody** — which is exactly the shape of the failure
that destroyed the H2 store. The check is therefore on the USER count, not on
whether the file loaded.

Add another device to an account, without revoking the first:

```bash
node infra/keycloak/add-passkey-device.mjs --email <address>
```

Read the enrolment link out of MailHog in development:

```bash
node infra/keycloak/latest-invite-link.mjs
```

---

## The meta-lesson

Every one of these presented as something else:

- a missing passkey that was present under another name
- a device problem that was a provider problem
- flaky tests that were an IP address family
- a broken database that was running perfectly
- a failed login that had succeeded, into a different copy of a module

**Read the server's own error message first.** Keycloak said exactly what was
wrong — *"Validator is configured to check user verified, but UV flag in
authenticatorData is not set"* — several rounds before anybody acted on it.
