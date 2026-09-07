# Practice onboarding, end to end

What a practice does between being approved and being able to record consent —
which screen, which rule, and why each step is where it is.

Written because the chain is longer than it looks and every step has a refusal
attached to it. If something will not let you proceed, the reason is here.

---

## The shape of it

```
approved  →  a location, confirmed
          →  a practitioner, on the platform
          →  an affiliation, invited
          →  the practitioner accepts        ← only they can do this
          →  capture is open
```

Nothing is capturable until the last step. **Four practitioners on your list is
not four practitioners you can record consent for** — that is the single
misunderstanding the whole set of screens is arranged to prevent.

---

## 1. A location, and why it starts unusable

`/practice/locations`

A location arrives **inactive** and cannot host anybody until a human confirms
the address.

That is deliberately obstructive, and the reason is not tidiness. **A
location's address is what prints in the s 65C(5)(a) particulars block of every
agreement captured there.** It is not a contact detail; it is part of the legal
record of who consented, to what, at which practice. An unconfirmed address on
a consent record is a defect nobody notices until an audit, at which point
every agreement captured there is in question.

The address is checked against the national address file automatically. If it
does not match — common for new developments and consulting suites — somebody
confirms it by hand and **their name is recorded against it permanently**.

**A location also needs a state**, because termination notices are counted in
business days and those differ by state (REQ-OFF-03). Without one it cannot be
confirmed.

**Departments** live inside the location card rather than on a page of their
own: a department has no meaning apart from its location, and nothing in the
legislation turns on it.

## 2. A practitioner, and the one fact that matters

`/practice/practitioners`

Adding somebody here creates **their identity on the platform** — one person,
one record, however many practices they work at. That is what lets a
deregistration stop them everywhere at once, and it is why a second record for
the same AHPRA number is refused rather than merged.

There is **no self-registration path**. To exist here, a practitioner has to be
invited by a validated practice — which costs a real ACTIVE ABN, a matching
registered name, a passed entitlement check and a named human's approval. That
turns identity creation from free into expensive (CONVENTIONS.md §8b).

**The one fact this page is about: has a human actually looked at the AHPRA
public register?** Typing a registration number proves nothing — a fraudster
types an invented one as easily as a real one, so a score that counted entry
would be measuring effort at the keyboard. What carries weight is a recorded
check with a named human against it.

Recording a check that returns a non-practising status **ends every affiliation
immediately**. No notice period. That is REQ-XFER-08 and it is not a score to
be made up elsewhere.

## 3. An affiliation, and whose move it is

`/practice/affiliations`

The affiliation is the edge between a practitioner and a **place**, and it is
where the Medicare provider number lives — because a provider number is not a
property of a doctor, it is a property of a doctor at a place (FR-1.8).

A provider number is **optional**. s 65C(5) is satisfied by a provider number
OR by name plus the address of the place of practice, so a confirmed address
covers it (REQ-REG-02).

Creating the affiliation does **not** make it live. The page distinguishes two
states that look alike and are not:

| State | Whose move |
|---|---|
| **Not sent yet** | Yours. Nobody has told the practitioner anything. |
| **Awaiting their answer** | Theirs. The invitation has gone out. |

The first is what silently stalls an onboarding for a fortnight, because from
the practice's side it reads as "done, waiting on the doctor". It sorts to the
top of the list for that reason.

## 4. The practitioner accepts — and only they can

The invitation goes to **the practitioner's own email address**, not the
practice's. That is the entire mechanism by which a practice cannot accept on
their behalf, and it is why the address has to be theirs.

They get a link and a **six-digit code**. The link opens a page; the code
answers it. Two phases, because a bare link is consumed by a GET and corporate
mail scanners, link-preview bots and "safe links" rewriting all issue GETs.

The page **names the practice and the site before asking for anything**, which
is the opposite of the email-verification page. Nobody can consent to an
unnamed thing. It also says what accepting does NOT do — it is not consent on
any patient's behalf, and no agreement is being signed.

**Declining is the same size as accepting.** A page where declining is hard is
a page that manufactures consent.

Five wrong codes and it locks; the practice can send another, and doing so
kills the old link.

### What acceptance is actually worth

Recorded honestly, per affiliation:

| Method | What it proves |
|---|---|
| `passkey` | Their device and their fingerprint, face or PIN. The strongest we can record. **Not built yet.** |
| `email_link_and_code` | Access to that inbox. **Not who was at the keyboard.** |
| `console` | The practice's own word for it. The only witness is the party who benefits. |

Today it is the middle one. That is good enough for the ordinary failure — a
practice adding a doctor who never agreed — and not good enough to be called a
signature, so it is not called one. When passkeys land, **the old records keep
their old label.** An affiliation accepted by email was accepted by email;
relabelling it later would be rewriting evidence.

## 5. Capture channels

`/practice/channels`

**Register the SMS sender ID early.** It takes weeks with ACMA, and until it is
done Australian carriers show your messages as coming from an "Unverified"
sender, which handsets group with scams. Nothing breaks — the response rate is
quietly destroyed, and a practice that finds out after going live has already
taught its patients to ignore it.

Also here: how long a consent link lives, and which identifiers a patient is
asked to confirm — at least three, from the approved six. **The Medicare card
number is not among them and never will be.** Cards are shared between family
members, so the number identifies a household rather than a person, and it is
not stored anywhere at all.

---

## The refusals, and what each one means

| You see | It means | What fixes it |
|---|---|---|
| *This location is not active* | The address has not been confirmed, so it cannot appear in a particulars block | Confirm it on `/practice/locations` |
| *This location has no state* | The public-holiday calendar cannot be chosen | Fix the address |
| *AHPRA number is already on this platform* | They exist; a second record would break the deregistration hard-stop | Invite them rather than adding them |
| *No practitioner with AHPRA number …* | Not on the platform yet | Add them on `/practice/practitioners` |
| *already has an affiliation at this location* | One provider number per place of practice (FR-1.8) | Nothing to fix; it is already there |
| *reached the number of practitioners it can invite* | The invitation cap | Contact us; it is lifted by agreement |
| *this practitioner is no longer registered* | REQ-XFER-08, immediate | Nothing here can fix it; the AHPRA register is the authority |
| *nothing to invite* | The affiliation has already been answered | — |

---

## Related

- [CONVENTIONS.md](CONVENTIONS.md) — §8b on why there is no self-registration
- [IDENTITY-STRENGTH-DESIGN.md](IDENTITY-STRENGTH-DESIGN.md) — what a check is worth
- [PASSKEYS.md](PASSKEYS.md) — when a sign-in will not work
- [TODO.md](TODO.md) — practitioner sign-in, and what it would change here
