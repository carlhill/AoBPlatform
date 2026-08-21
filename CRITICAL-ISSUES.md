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
- **~~There is one platform administrator.~~** A second (`admin.carl`) was
  invited 2026-08-22, so the recovery tool no longer warns.

  This is only a PARTIAL mitigation and the limit is worth stating: both
  accounts belong to the same person and, at present, the same machine. That
  protects against losing one credential; it does not protect against losing
  the device, which would take both. A genuinely independent second
  administrator is a different person, or at minimum a passkey on separate
  hardware.

---

## 2. Passkey sign-in refused: UV flag absent — CAUSE IDENTIFIED 2026-08-22

### What happened

Enrolment succeeds; sign-in is refused with:

```
Validator is configured to check user verified,
but UV flag in authenticatorData is not set
```

### The cause: Microsoft Password Manager, not Windows Hello

Windows 11 (24H2 and later) ships a **second passkey provider** alongside
Windows Hello, and it registers itself as the default handler. Passkeys created
through it live in Microsoft Password Manager's own vault.

It gave itself away by its own dialog: **"Enter your Microsoft Password Manager
PIN — confirm your identity by entering the PIN you previously set up."** That
PIN unlocks the PASSWORD MANAGER'S VAULT. It is not Windows Hello verifying the
person, and the assertion comes back with the UV flag unset.

This is why the diagnosis took several passes. A PIN prompt appeared, which
looked exactly like user verification succeeding, and the theory that a
non-Hello provider was responsible was dropped on that evidence. It was the
right theory; the PIN belonged to the wrong thing.

The tell was there the whole time in the credential itself:

```
aaguid     : d3452668-01fd-4c12-926c-83a4204853aa   (Microsoft Password Manager)
transports : ['internal', 'ble']  /  ['internal', 'hybrid']
```

None of the published Windows Hello AAGUIDs — `08987058-…`, `9ddd1817-…`,
`6028b017-…` — appeared on any credential this account ever held.

### The fix

Enrol against **Windows Hello**, not Microsoft Password Manager:

1. Settings → Accounts → **Passkeys** → remove the `localhost` entries.
2. Settings → Accounts → Passkeys → **Advanced options** → stop Microsoft
   Password Manager acting as the passkey provider, or
3. In Chrome's "Create a passkey" dialog, choose **Windows Hello or external
   security key** rather than the default provider.

Confirm it worked by the prompt: Windows Hello says **"Making sure it's you"**
or asks for the device PIN under a **Windows Security** header. If the dialog
says "Microsoft Password Manager", it is the wrong provider again.

### Why the policy was not relaxed

Setting `userVerification` to `preferred` would have made this disappear in
seconds, and would have been the wrong answer.

`required` is what makes a passkey **two factors**: something you have, and
something you are or know. At `preferred`, an unlocked stolen laptop approves
practices. For the role that opens consent capture that is not a trade worth
making — and it would gut REQ-VAULT-04 while appearing to satisfy it, which is
worse than not having the requirement at all.

Note what the failure actually protected against: a credential that could be
used without verifying the holder was refused, exactly as intended. The control
worked. The problem was that the wrong provider had captured the enrolment.

### What was tightened along the way

- `webAuthnPolicyUserVerificationRequirement` (the plain, two-factor policy)
  was `preferred` while its passwordless counterpart was `required`. Both are
  now `required` — a non-verified WebAuthn assertion should not be acceptable
  on any path in this realm.
- `webAuthnPolicyRpId` and its passwordless counterpart were **blank**, meaning
  "whatever host the request arrived on". This stack answers to both
  `localhost` and `127.0.0.1`, so a credential enrolled via one would silently
  never match an assertion offered via the other. Both are now pinned to
  `localhost`.

Neither change fixed this issue. Both were latent traps found while looking.

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
2. **At least two administrators**, so one lost device is never a lockout. Done.
3. **A recovery path with a real root of trust**, which exists:
   `reset-platform-admin-passkey.mjs`, restricted to whoever holds the Keycloak
   administrator credential, revoking every old credential before issuing a new
   enrolment.
4. **A hardware security key with a PIN** for anyone whose platform
   authenticator cannot produce a UV assertion. That preserves the property; a
   password does not.

### Confirmed working 2026-08-22

Re-enrolled with Microsoft Password Manager switched off in Settings →
Accounts → Passkeys → Advanced options. The credential now reports:

```
aaguid     : 08987058-cadc-4b81-b6e1-30de50dcbe96   (Windows Hello Hardware)
transports : ['internal']
```

Hardware-backed, platform-only, and sign-in succeeds.

### DECISION 2026-08-22 (Carl): leave the rules as they are, revisit later

**No change.** `userVerification` stays `required` on both policies, there is
no password fallback, and the enrolment-time AAGUID check is NOT being built
yet. Revisit before practitioner onboarding goes anywhere near a real clinic.

**What that means in practice, stated plainly so it is not a surprise later:**

- Nothing is weakened. The security property is intact and this is not a
  workaround — it is a deferral of the *ergonomics* fix, not of the control.
- Every practitioner on Windows 11 will meet this, because Windows makes
  Password Manager the default. They will meet it ALONE, at first sign-in,
  with nobody to ask.
- Until the check exists, the mitigation is documentation and a support
  answer: `PASSKEYS.md` names the AAGUIDs and the fix, and
  `reset-platform-admin-passkey.mjs` re-issues an enrolment link.

**What would change the urgency:** the first practitioner invited to enrol.
Today the affected population is two platform administrators, both of whom
know about it. That is why deferring is reasonable now and stops being
reasonable the moment practitioner sign-in is built — which is tracked in
TODO.md under *Practitioner sign-in*, and which depends on this.

The three options below are kept intact for that conversation.

### The options, when it is time — practitioners will hit exactly this

Windows makes Password Manager the default. A practitioner enrols, sees "your
account has been updated", and discovers at their FIRST SIGN-IN — possibly days
later, possibly mid-clinic — that it does not work, with a message that
explains nothing.

The gap between the two moments is what makes this serious. At enrolment the
problem takes thirty seconds to fix. At first sign-in the person is somewhere
else, doing something else, with a patient waiting.

**Three ways to go, when it is picked up again.**

**1. Keep `required`, detect it at enrolment.** Read the AAGUID as the
credential is registered; if it belongs to a provider known not to set UV,
refuse THEN and say why, while it can still be redone in thirty seconds.

*Recommended.* It puts the failure where it is cheap, keeps the security
property, and needs a list of AAGUIDs we already have to maintain anyway. The
cost is that the list needs upkeep as providers change behaviour.

**2. Keep `required`, document it.** Cheaper to build and moves the cost onto
every practitioner and the support line. Every one of them meets the dialog
once, alone, with nobody to ask.

**3. Drop to `preferred` for practitioners.** Makes the problem vanish, and
weakens the signature that binds a consent record — "the key was used" and "the
person was present and verified" stop being the same claim, and the second is
the one this platform exists to record. Keycloak policies are per-realm, so it
also means administrators and practitioners in separate realms, which is a
standing source of drift.

### Why this happens at all: we are stricter than the web

WebAuthn lets a site request `userVerification` as `required`, `preferred` or
`discouraged`. The overwhelming default on consumer sites is `preferred` —
"verify if you can, proceed either way" — so an assertion with UV unset sails
through and Password Manager passkeys work everywhere else.

|  | Most sites | Here |
|---|---|---|
| A passkey replaces | the password | the password **and** the second factor |
| It proves | you hold the device | you hold the device **and** you were verified |
| UV unset is | accepted | refused |

Password Manager is not broken for the web at large. We are one of the few
relying parties strict enough to notice.

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

---

## 4. Every browser token was refused: issuer mismatch — RESOLVED 2026-08-22

### What happened

A signed-in platform administrator opened `/review/identity` and got **401**,
with the banner still reading "signed in as carl@hillsempire.com".

```
[AuthGuard] Bearer token rejected: unexpected "iss" claim value
```

### Why nothing had caught it

**Nothing had ever verified a token before.** The reviewer queue fetches with
no `Authorization` header at all, and `AUTH_ENFORCE=false` lets a request with
no token straight through. So the guard's verification path had never once run
against a real browser-issued token, in any environment, ever.

The identity dashboard was the first endpoint to carry `@RequireRoles`, and
therefore the first request that actually presented one.

### The cause

The token's `iss` claim is minted from **the URL the browser used**:

```
http://localhost:21024/realms/aobplatform
```

`apps/core/.env` told core to expect:

```
http://127.0.0.1:21024/realms/aobplatform
```

Compared as strings. Never equal. Every browser token refused.

**It was introduced by the ::1 fix.** When every address in that file was
switched to `127.0.0.1` to stop Docker's IPv6 forwarder hanging, the issuer
went with them — and the issuer is the one value in the file that is not an
address to connect to. It is a **string compared against a claim**.

`docker-compose.yml` has had this right since the containers were set up. The
local `.env` did not, because it was written when core ran in Docker and split
from it when core moved to the watch loop.

### Why this was more serious than a 401

**`AUTH_ENFORCE=true` would have locked every user out of everything.** With
enforcement on, a rejected token is not a fall-through — it is the end of the
request. The release gate was aimed at a system in which no token could pass,
and the only reason nobody knew is that no endpoint had asked for one.

### The fix

Three URLs, and they are not interchangeable:

| Setting | Value | Why |
|---|---|---|
| `KEYCLOAK_PUBLIC_ISSUER` | `localhost` | What the token SAYS. A string, never fetched. |
| `KEYCLOAK_JWKS_URI` | `127.0.0.1` | Where WE fetch signing keys. Server-to-server. |
| `KEYCLOAK_ISSUER` | `127.0.0.1` | Where WE mint service tokens. Server-to-server. |

Both `apps/core/.env` and `.env.example` now set all three, with the reasoning
beside them.

The split was already designed for — `TokenVerifier` documents `issuer` as
"the PUBLIC issuer" and offers `jwksUri` precisely "when the network path to
Keycloak differs from the public issuer (the ReferralPlatform issuer-mismatch
lesson)". The mechanism was there; the config never used it.

### The lesson, and it is the same one as trap 3 in PASSKEYS.md

**"127.0.0.1 everywhere" is not the rule.** The rule is:

- an address something CONNECTS to → `127.0.0.1`
- a string compared against a token claim, or a URL the BROWSER follows →
  `localhost`

Getting it backwards produces a bare 401 or a bare 400 with no explanation.

### What would have caught it earlier

An endpoint that required a role, reached by a real browser session — which is
exactly what found it. Worth remembering when the next auth surface is built:
**a guard that has never refused anything has never run.**
