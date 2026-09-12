# AUTH-TIERS.md — how a practice's people sign in, and what it costs
### v1.0 · 12 September 2026 · Owner: Carl. Companion to `PRACTITIONER-PASSKEY-DEVICE.md`, `PRACTICE-SCOPED-LOGIN.md`, `PRACTITIONER-IDENTITY.md`, and `DECISIONS.md` D-2026-09-12-11.

Carl, 12 September 2026, having taken the passkey-only design apart: *"We cannot
have the passkey solution. The login has to be independent of the device being
used."* And: *"What about single sign-on. Large practices may want a single
sign-on from microsoft or google."*

---

## 1. Why passkey-only failed

Not on principle — on the floor. A doctor works from whatever computer is in
whatever room they are in, in a practice or a hospital. Those machines are
shared, often locked down, frequently have no Bluetooth and often no usable USB
port. Every route to a passkey needs one of: the credential on that machine
(wrong — it stays there for the next person), the doctor's phone in Bluetooth
range (no adapter), a security key (no port), or the doctor signing the browser
into their own account (wrong on a shared machine).

There is no fourth option. The design assumed a device relationship that a
hospital corridor does not provide.

## 2. The tiers

| Tier | Who | How they sign in |
|---|---|---|
| **1 — Tenant SSO** | Practices and hospitals with a Microsoft Entra or Google Workspace tenant | Their own single sign-on. Usually already signed in on that terminal |
| **2 — Platform accounts** | Practices with no tenant | Username, password, and a code from an authenticator app |
| **3 — Passkey** | Anyone who can and wants to | Unchanged, and still the strongest. Never removed, never required |

**Tier 1 is the target for large practices, not a fallback.** It is more
device-independent than anything we could build, it is what the doctor is
already signed into, and the practice's own conditional access does the work.

## 3. What tier 1 gives us that we cannot build ourselves

- **Joiners and leavers.** A hospital disables a departing doctor's account and
  they lose us the same morning. Today we track departures by hand, which is a
  standing risk.
- **Possibly stronger authentication than tier 2**, not weaker. A tenant
  enforcing phishing-resistant multi-factor gives better assurance than a
  password and a code. The token states the methods used; **we require a minimum
  and refuse the sign-in otherwise**, and we record what was asserted.
- **Practice scoping for free.** `PRACTICE-SCOPED-LOGIN.md` invents a username
  shape to bind a person to one practice. Where the practice federates, the
  identity comes FROM the practice and is scoped by construction. The invented
  scheme becomes tier 2's answer, not the main path.

**What it costs:** per-practice setup at onboarding, not one switch. An
application registration in their tenant, a decision about minimum
authentication strength, and a rule for guest accounts in someone else's tenant.
It is a supported feature with a runbook.

## 4. Tier 2, and Carl's questions about it

*"Are we building userid + pwd + 2 phase via auth app each time? Is the auth-app
free? Does it require registration with Microsoft/Google? Do we need an approved
website like hillsempire.com?"*

**The codes are free and involve no relationship with anybody.** A one-time-code
app implements an open standard (TOTP, RFC 6238). Google Authenticator,
Microsoft Authenticator, Authy, 1Password and the rest all read the same thing.

- **No registration with Google or Microsoft.** There is no account, no API key,
  no fee and no vendor relationship. Keycloak generates a shared secret, shows it
  as a QR code, the app reads it, and Keycloak checks the codes itself. Nothing
  leaves our servers.
- **No approved website is needed.** The QR carries an `otpauth://` string whose
  "issuer" is a label the app displays — "AoBPlatform". It is not a domain, it is
  not verified by anyone, and it costs nothing.
- **Every sign-in, yes** — password then code. Session length decides how often
  that is; a working day is the sensible answer, not a few minutes.

**Where a real domain IS needed**, and none of it is about the codes:

| Needs a domain | Why | Status |
|---|---|---|
| The application's own address | Cookies, redirects, and passkeys are bound to it. `CONSOLE_URL` and `PORTAL_RP_ID` are `localhost` today | Needed before any real practice |
| Sending email | Invitations and patient copies need SPF, DKIM and DMARC on the sending domain, or they land in spam or are refused | Already an open item — the capture-channels card reads "sender ID unregistered" |
| Tier 1 SSO | The tenant registers our redirect address | Follows the first row |

**hillsempire.com, as it stands today** (checked 12 September 2026): it resolves,
and its mail is handled by Microsoft (`*.pamx1.hotmail.com`), so there is a
Microsoft-hosted mailbox behind it. That means Carl already has a Microsoft
tenant, which is worth knowing twice over — it can host the product's email
sending, and it is a ready-made tier 1 test subject.

Whether to serve the product from `hillsempire.com`, a subdomain of it, or a
separate product domain is a branding decision rather than a technical one. The
technical requirement is only that it be a domain we control, with DNS we can
change. Cost is a domain registration if a new one is wanted; nothing else here
costs money.

## 5. What tier 2 must carry, because it is the weaker tier

1. **Record how each session authenticated.** Password-and-code, tenant SSO with
   the methods it asserted, or passkey. An audit must be able to tell them apart.
2. **A fresh second factor before high-stakes acts**, not only at sign-in.
3. **Number matching where we can get it.** A typed code is phishable in real
   time. Keycloak does not do push natively — that needs a tenant or a
   third-party provider — so tier 2 is a typed code today and this is a later
   improvement, not a blocker.
4. **Recovery when the phone is lost**: the practice administrator re-issues an
   invitation, which already exists.
5. **A password policy**, and passwords never logged, never in events, never
   reused as an identifier.

## 6. What does NOT change

- **Patients are untouched.** Portal passkeys live in core, not Keycloak
  (D-2026-09-04-02).
- **Platform operators keep passkeys.** Our own people use their own machines and
  have no shared-terminal problem, so weakening their auth buys nothing.
- **The practitioner still signs nothing.** Hard rule 3 abolished the
  practitioner signature field, so the evidential weight of an agreement rests on
  the patient's signature captured at a paired tablet. Practitioner authentication
  governs who may operate the desk and see records — important, and a different
  bar from the one the statute leans on.

## 7. Named tests

- `a_session_records_how_it_authenticated`
- `a_federated_sign_in_is_refused_when_the_tenant_asserts_too_weak_a_method`
- `a_high_stakes_act_asks_for_the_second_factor_again`
- `a_password_never_appears_in_a_log_an_event_or_an_error`
- `a_platform_operator_still_requires_a_passkey`
- `a_patient_portal_sign_in_is_unaffected`

## 8. For Carl

- **Does tier 2 cover the practice administrator?** Same shared-PC problem, so
  probably yes, but it is the highest-privilege practice account.
- **Session length for tier 2.** A working day, or shorter with re-authentication
  for high-stakes acts?
- **Which domain the product is served from**, since it gates real email, real
  passkeys and tier 1 alike.
- **Worth verifying**: Services Australia's own provider system uses a username,
  a password and a verification code. If so, tier 2 matches the government's own
  bar for providers, which is the strongest argument for it. I have not confirmed
  this and would not rely on it until somebody has.

## Change log
| Date | Change |
|---|---|
| 12 Sep 2026 | v1.0. Written when Carl established that shared clinical terminals make passkey-only unworkable, and asked for the tiered model. |
