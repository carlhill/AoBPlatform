# Critical issues

Things that can lock people out, lose evidence, or let something through that
should not have got through. Each entry says what happened, what it costs, what
was done, and what is still open.

This is not a bug list. Ordinary bugs go in the tracker; this file is for
failures whose consequence is not "a screen is wrong" but "nobody can get in"
or "the record no longer means what it says".

---

## 1. Keycloak's credential store was ephemeral — RESOLVED 2026-08-22

### What happened

`start-dev` keeps Keycloak's H2 database **inside the container's writable
layer**. Nothing was mounted over it. So recreating the container — for a port
change, an image bump, a `docker compose up --build` — destroyed every user,
every role grant, and every enrolled passkey.

It was found the only way these things are found: a `docker compose up -d` that
only meant to change a port binding, followed by discovering the first platform
administrator's account no longer existed.

### Why it was critical rather than annoying

**A password can be reset. A passkey cannot be re-derived.** The private half
never leaves the person's device, and the public half is what we lost. There is
no recovery from the server side, no export to restore, nothing to reissue.

Losing the store means re-inviting every administrator and every practitioner,
and each of them has to be physically present at their own hardware to enrol
again. For a platform whose entire identity model is passkey-only, one careless
container rebuild was a full-population lockout.

The failure mode is also silent. The realm re-imports from `realm-export.json`
on start, so roles and clients come back and the system LOOKS healthy. Only the
users are gone, and you find out when somebody tries to sign in.

### What was done

Keycloak now uses the **Postgres instance we already run**, in its own database
(`keycloak`), on the existing persistent volume:

```yaml
KC_DB: postgres
KC_DB_URL: jdbc:postgresql://postgres:5432/keycloak
```

A separate database rather than a schema inside `aobplatform`, deliberately:
identity and application data have different retention, different access
patterns, and — the part that matters — different blast radius. A migration
that goes wrong on the application side must not be able to take the credential
store with it.

An H2 file on a Docker volume was tried first and rejected: it starts as root,
Keycloak runs unprivileged, and it fails to open the file. More importantly it
would have preserved a development-only storage engine, when the correct answer
was already running beside it.

### Still open

- **Nothing backs up the `keycloak` database yet.** It now survives a container
  rebuild; it does not survive a lost volume. Passkeys deserve at least the
  backup story the application data has.
- **`admin/admin` is in `docker-compose.yml`.** Correct for a local sink,
  catastrophic anywhere else — and it is now the last resort for administrator
  recovery, which makes it the most valuable credential in the system.
- **There is one platform administrator.** The recovery tool warns about this
  every time it runs. Two is the minimum that survives one lost device without
  depending on the Keycloak admin credential.

---

## 2. Passkey sign-in refused: UV flag absent — OPEN

### What happened

Enrolment succeeds; sign-in is refused with:

```
Validator is configured to check user verified,
but UV flag in authenticatorData is not set
```

The realm requires `userVerification: required` for passwordless. The
assertions came back proving possession of the device but carrying no flag
saying the device had verified the person — no PIN, no biometric.

Windows Hello IS configured with a PIN on the machine in question, so the
obvious explanation is wrong. The credentials carried AAGUID
`d3452668-01fd-4c12-926c-83a4204853aa`, which is not any published Windows
Hello identifier, and `transports: ['internal', 'ble']` — consistent with a
credential provider other than Hello serving them.

### Why the policy is not being relaxed

Setting `userVerification` to `preferred` would make this go away immediately,
and it is the wrong answer.

`required` is what makes a passkey **two factors**: something you have, and
something you are or know. At `preferred`, an unlocked stolen laptop approves
practices. For the role that opens consent capture, that is not a trade worth
making — and it would gut REQ-VAULT-04 while appearing to satisfy it, which is
worse than not having the requirement at all.

### On adding a password fallback

Proposed during this incident: go back to username and password, and *also*
offer a passkey.

**This does not solve the problem it appears to solve, and it costs the model.**
An account that can fall back to a password is an account whose real strength is
the password. Every phishing page, every credential-stuffing list and every
"reset my password" social-engineering call comes back, and the passkey becomes
a convenience feature sitting on top of the weakness it was adopted to remove.
For the role that approves practices, the answer to "what if the passkey fails"
must not be "then use the thing passkeys replaced".

What genuinely addresses the underlying fear — *being locked out* — is:

1. **Durable storage.** Done, issue 1.
2. **At least two administrators**, so one lost device is never a lockout.
3. **A recovery path with a real root of trust**, which exists:
   `reset-platform-admin-passkey.mjs`, restricted to whoever holds the Keycloak
   administrator credential, revoking every old credential before issuing a new
   enrolment.
4. **A hardware security key with a PIN** as the second factor for anyone whose
   platform authenticator cannot produce a UV assertion. That preserves the
   property; a password does not.

### Next steps

- Identify AAGUID `d3452668-…` against the FIDO Metadata Service and determine
  which provider served it.
- Re-enrol with the Windows Hello provider explicitly selected, and confirm the
  PIN prompt appears — if enrolment completes without one, the credential
  cannot produce UV and the provider is the fault.
- If the platform authenticator cannot be made to produce UV, use a hardware
  key with a PIN rather than changing the policy.

---

## 3. `localhost` resolves to ::1 and hangs — RESOLVED 2026-08-22

### What happened

Docker Desktop published every port on both IP stacks. On Windows, `localhost`
resolves to `::1` first, and Docker's IPv6 forwarder **accepts the TCP
connection and then never answers**.

Accepting is what makes it dangerous. A refusal would fall straight through to
IPv4; an accepted connection that stalls means the client waits, and never
tries the address that works.

The symptom is the worst kind — everything looks up, and only the things that
speak a protocol fail:

| What you see | What is happening |
|---|---|
| A socket test says the port is **open** | The TCP connection genuinely succeeds |
| Prisma says **can't reach database server** | The Postgres handshake never completes |
| An SMTP send **hangs** to timeout | The same, without the courtesy of a refusal |
| The browser **spins** on Keycloak | Ditto, for twelve seconds a time |
| Tests fail **intermittently** | Whichever address the resolver returned first |

That last row cost the most: it was diagnosed as flaky tests and written up as
suite interference, which it never was.

### What was done

- Every published port in `docker-compose.yml` is bound explicitly to
  `127.0.0.1`, removing the `::1` listener. `localhost` then fails fast on IPv6
  and falls through to IPv4, so it works again for anyone who types it out of
  habit. It also stops a development database holding health data from
  listening on every interface.
- `apps/core/.env` uses `127.0.0.1` throughout.
- The Keycloak CLIs use `127.0.0.1` for **server** calls and keep `localhost`
  for anything the **browser** follows — the redirect is validated against the
  client's registered redirect URIs, and "being consistent" there produces a
  bare 400 with no explanation.
