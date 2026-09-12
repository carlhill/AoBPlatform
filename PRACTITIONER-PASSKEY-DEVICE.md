# PRACTITIONER-PASSKEY-DEVICE.md — a doctor's passkey belongs on a device the doctor owns
### v1.0 · 12 September 2026 · Owner: Carl. A finding and a recommendation, not yet applied. Companion to `PRACTICE-SCOPED-LOGIN.md`, `CRITICAL-ISSUES.md` §2, and CLAUDE.md hard rule 15.

Carl, 12 September 2026: *"a dr working at 3 sites will want to store his
passkeys on his tablet or mobile and not the pc he is working on, as the Dr will
be working on many shared computers depending on which room he is working in. So
the Dr's passkeys have to be on his mobile or tablet or a device he owns."*

**Correct, and it is already going wrong.** This is a security defect rather than
a convenience one.

---

## 1. What is true right now, measured

| | Value |
|---|---|
| Realm policy `webAuthnPolicyPasswordlessAuthenticatorAttachment` | **`not specified`** — platform authenticators are permitted |
| Dr Huang's two registered passkeys | `transports: ['internal']`, aaguid `08987058-cadc-4b81-b6e1-30de50dcbe96` — **Windows Hello, on the machine she enrolled from** |

`internal` transport means the credential cannot leave that computer. So today a
practitioner who enrols in room 3 can sign in from room 3 and nowhere else.

## 2. Why it is a security problem, not only an inconvenience

A consulting-room PC is shared. Two consequences, and the second is the serious
one:

1. **The doctor cannot work.** Move to another room and the credential is not
   there. They cannot sign in at all, and the obvious workaround — enrol again
   on each machine — makes the second problem worse every time.
2. **Anyone who can unlock that Windows account can sign in as the doctor.** A
   platform credential is protected by the machine's own user verification, so if
   a consulting room's PC has one shared Windows profile with a PIN the staff all
   know, that PIN is now the doctor's signature. Every agreement made from that
   machine names them.

That second point is what makes this worth doing properly. Hard rule 15 requires
passkeys precisely to bind an act to a person; a passkey sitting on a shared
machine unbinds it again.

**It applies to reception too.** A front-desk PC is shared across shifts, and
reception's account can push agreements to tablets and correct patient details.

## 3. What the doctor should carry

Two workable answers, and a practice will need both:

| | How it works | Needs |
|---|---|---|
| **Their phone or tablet** | The shared PC shows a QR code; the phone scans it and approves. The credential never leaves the phone (WebAuthn hybrid transport) | **Bluetooth on the shared PC.** Many desktop machines have none — this is the catch |
| **A security key on a lanyard** | Plugged into USB, or tapped on NFC | A free USB port; no Bluetooth, no phone, no battery |

**The Bluetooth requirement is the thing to check before promising anything.**
Hybrid transport needs BLE proximity between the phone and the computer. A
consulting room with an older desktop and no Bluetooth adapter cannot use the
phone route at all, and the security key becomes the only option. That is a
procurement question for each practice, and it is cheap to answer early and
expensive to discover late.

## 4. The change that enforces it

Set the realm's passwordless policy to
`webAuthnPolicyPasswordlessAuthenticatorAttachment: cross-platform`.

That makes enrolment refuse a platform authenticator, so a practitioner cannot
accidentally leave their identity on a shared machine — the browser will offer
the phone and the security key and will not offer Windows Hello.

**Three things to weigh before doing it:**

1. **It is realm-wide.** Keycloak has one passwordless policy, so it applies to
   practice administrators on their own back-office PC as well, where a platform
   passkey would have been fine. Given a front-desk PC is also shared, applying
   it to everyone is defensible and simpler than trying to vary it.
2. **Existing platform credentials keep working.** The policy governs
   REGISTRATION. Dr Huang's two Windows Hello passkeys would continue to
   authenticate until somebody removes them, so the change alone does not close
   the exposure — the credentials already on shared machines have to be revoked
   and re-enrolled.
3. **It cannot be verified by reasoning.** A virtual authenticator can prove the
   policy refuses a platform credential, but whether a real doctor's phone pairs
   with a real consulting-room PC has to be tried on the actual hardware.

## 5. How this interacts with what is already known

`CRITICAL-ISSUES.md` §2 records the Windows passkey provider trap: Windows 11
ships Microsoft Password Manager alongside Windows Hello, it grabs the default,
and credentials created through it come back with the user-verified flag unset,
so **enrolment succeeds and the next sign-in is refused**. The recommendation
there is to detect the AAGUID at enrolment and refuse a non-verifying provider
on the spot.

Moving practitioners to cross-platform authenticators **sidesteps that trap
entirely** for the people most exposed to it, because neither route goes through
a Windows software provider. The two changes point the same way and should be
considered together.

The per-platform enrolment steps already on the registration page
(D-2026-09-12-01) would need their Windows branch rewritten: it currently walks
somebody through saving to Windows Hello, which is exactly what this stops.

## 6. Rules, if Carl accepts the recommendation

1. **A practitioner's passkey lives on a device the practitioner owns** — their
   phone, their tablet, or a security key they carry. Never on a shared clinical
   PC.
2. **Enrolment refuses a platform authenticator**, enforced by the realm policy
   rather than by guidance on a page.
3. **Existing platform credentials on shared machines are revoked and
   re-enrolled**, because the policy does not reach credentials already issued.
4. **Every practice is asked, before go-live, whether its shared PCs have
   Bluetooth**, and is told the security-key answer where they do not.
5. **Nothing here blocks care** (hard rule 8). A practitioner who cannot sign in
   still sees patients; what waits is the paperwork.

## 7. Named tests

- `enrolment_refuses_a_platform_authenticator_for_a_practitioner`
- `a_credential_that_cannot_leave_one_machine_is_never_created` — transports must not be `['internal']` alone.
- `an_existing_platform_credential_still_authenticates` — the policy governs registration, and grandfathered accounts must not be locked out without a deliberate revocation.
- `the_enrolment_steps_do_not_tell_anybody_to_save_to_windows_hello` — the theme copy, once this lands.

## 8. For Carl

- **Apply the realm change?** Recommended, for everyone rather than only
  practitioners, because reception's PC is shared too.
- **Revoke the platform credentials already issued** (Dr Huang has two, and
  yours is one)? Necessary to actually close the exposure, and it means
  re-enrolling with a phone or a key.
- **Who buys the security keys**, and does the practice or the platform hold the
  spares? A doctor whose phone is flat still has to work.

## Change log
| Date | Change |
|---|---|
| 12 Sep 2026 | v1.0. Written when Carl pointed out that a doctor moving between shared consulting-room PCs cannot keep passkeys on them. Confirmed against the running realm: policy permits platform authenticators and real credentials are Windows Hello with internal transport. |
