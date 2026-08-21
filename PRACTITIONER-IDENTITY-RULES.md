# Practitioner identity — rules and open questions

Decided 21–22 August 2026. Companion to
[IDENTITY-STRENGTH-DESIGN.md](IDENTITY-STRENGTH-DESIGN.md) and
`CONVENTIONS.md` §8b.

---

## 1. Accepting an affiliation requires the passkey ✅ RULE

A practitioner already on the platform who is invited to a second practice
**must sign in with their passkey to accept**. The invitation is an offer; the
acceptance is an act, and acts are signed.

Without this the invitation-only rule leaks: a practice could invite a
practitioner and then click "accept" on a screen nobody authenticated to, which
is a practice creating an affiliation in a doctor's name — the exact thing the
whole model refuses.

⚠ **Not yet enforced.** `AUTH_ENFORCE=false`, so today the endpoint takes a
practitioner id in the path and trusts it. That is a development path and a
release gate, tracked with the rest of auth enforcement.

---

## 2. Invitation cap per practice ✅ RULE

At onboarding a practice states how many practitioners it has. The cap is
**that number + 20%**, with a **default maximum of 50**. Larger organisations
get a contracted figure.

Counted against **active plus invited** affiliations, not lifetime, so ordinary
churn does not exhaust it.

**One disagreement, small but worth having.** The cap should not be *silent*.
Keeping the formula private is right — telling an attacker "you have four
invitations left" hands them the budget. But a practice that hits the ceiling
must be told it exists and how to raise it. A silent failure is indistinguishable
from a broken platform, and the people who hit it first will overwhelmingly be
legitimate practices that grew.

So: hide the arithmetic, surface the wall.

Hitting the cap repeatedly is itself a **NEGATIVE reputation check** — a
practice that keeps pushing at it is worth a look.

---

## 3. Passkey recovery ⚠ DISAGREEMENT, and a better split

> *"I do not see this as high-risk as the practitioner has the right to
> terminate the agreement with the practice who may still be using his
> practitionerId."*

The motive is right and the risk assessment is not, and the two can be
separated cleanly.

**Recovery is the highest-risk operation in any device-bound scheme**, and this
codebase already says so — REQ-PKI-05 calls re-enrolment "the weakest point".
The reason is unchanged by how sympathetic the request is: an easy recovery path
is an account-takeover path. An attacker who recovers "their" passkey holds a
cryptographically attested identity that can accept affiliations and have
consent captured in a real doctor's name. That is the fraud, arriving through
the door marked *help*.

**But the underlying worry is correct and important:** a practitioner locked
out must never depend on the practice they are trying to escape. If recovery
runs through the practice, the adversary holds the key to the exit.

### The split

**Stopping the bleeding is low-risk. Getting a new key is high-risk.** They are
different operations and should not share a path.

| | Suspension | Recovery |
|---|---|---|
| What it does | Suspends the practitioner's affiliations | Binds a new passkey |
| Grants anything? | **No** — it only takes away | Yes, everything |
| Speed | Immediate, on request | Deliberately slow |
| Who performs it | AoBPlatform operator | AoBPlatform operator |
| Verification | Low bar — plausible claim, logged | Full re-proofing |

A practitioner who phones us saying *"I have lost my key and I think a practice
is using my provider number"* gets their affiliations **suspended today**, on a
low bar, because suspension grants nothing to anybody. If the caller is an
impostor, the worst outcome is a legitimate practitioner inconvenienced and a
loud audit trail — recoverable. If we handed out a passkey on the same bar, the
worst outcome is not recoverable.

### Recovery, when it happens

**By the platform, never by a practice** — precisely because the practice may
be the adversary. REQ-PKI-05 stepped-up ceremony, plus:

- video call, matched against the AHPRA register entry
- the practitioner-owned email recorded at invitation (not a practice address)
- a mandatory cooling-off period before the new key is usable
- **every affiliated practice notified** — if the recovery was fraudulent, the
  real practitioner hears about it from someone

⚠ AHPRA cannot help identify a caller: the public register carries no phone
number and no email, only suburb and postcode.

### What to capture for re-proofing — and what NOT to

> *"we will need to capture the Practitioner home address, date of birth, and
> what else? How do other organisations like banks do this?"*

**Banks stopped doing the thing this describes.** Date of birth, home address
and mother's maiden name are knowledge-based authentication, and KBA is broken:
that data is in every breach, and a determined attacker frequently knows the
victim's details better than the victim recalls them under pressure. NIST
deprecated static KBA as an identity-proofing method for exactly this reason.
⚠ *Verify the current NIST 800-63 revision before citing it externally.*

Collecting a home address would also do real harm. It is sensitive — AHPRA
itself lets practitioners suppress their principal place of practice on safety
grounds, and some have genuine reasons — and a database of doctors' home
addresses is a target with a duty attached. **Do not collect it as a recovery
secret.**

**What high-assurance organisations actually moved to:**

1. **Document verification with liveness** — photograph a government ID, capture
   a live selfie or video, match the face to the document, with liveness
   detection to defeat a held-up photograph.
2. **Verification against an authoritative source** — in Australia the Document
   Verification Service checks a document against the issuing agency's records,
   and myID / Digital ID under the Digital ID Act 2024 is the accredited route.
   Both need a gateway provider. ⚠ Verify current availability and terms.
3. **Something you have, re-proven** — a second registered authenticator, or a
   recovery code. Note that SMS is weak here: SIM swap is the standard attack.
4. **Out-of-band with a trusted party** — for us, a verified colleague, but
   **never the practice they are escaping**.

### The proof we already have, and nobody else does

**AHPRA registration is an identity somebody has already verified to a high
bar, with a photo-ID chain behind it, and the practitioner holds a login to
it.**

So the strongest recovery evidence available to this platform is not a date of
birth — it is **demonstrated control of their AHPRA portal account**: producing
a freshly downloaded registration certificate, or reading back something
visible only when signed in there. That is obtainable only by someone who
controls the account belonging to the exact professional identity in question,
and it costs us nothing to ask for.

### Recommendation

- **Do NOT** collect date of birth or home address as recovery answers. That is
  building KBA in 2026, plus a honeypot.
- **DO** capture, at enrolment: full legal name as it appears on photo ID, and
  a hash of the AHPRA registration certificate then current.
- **At recovery**: video call, government photo ID matched live against the
  person, plus demonstrated AHPRA portal control. All three, recorded as
  artefacts against a stepped-up REQ-PKI-05 ceremony.
- Collect date of birth **only** if it is going to be matched against an
  authoritative source (DVS), never to be asked as a question. If it is
  collected for that purpose, say so in the collection notice.

### What actually prevents this — industry practice

Recovery is a failure mode; the answer is to make it rare.

1. **Register a SECOND authenticator at enrolment.** Phone plus laptop, or a
   security key. This is FIDO's own guidance and it is by far the highest-value,
   lowest-cost measure. Most recovery requests simply never happen.
2. **One-time recovery codes** issued at enrolment, stored offline.
3. Only then, identity re-proofing.

**Recommendation: make a second authenticator mandatory at enrolment,** not
encouraged. The cost is one extra minute during onboarding; the alternative is
an ongoing high-risk manual process, run by us, on every lost phone.

---

## 4. The stolen-AHPRA-number fraud — a premise to correct

> *"a rogue practice may take a GP (randomly) who is not on AoBPlatform and can
> then bill using that AHPRA practitioner."*

**Medicare does not bill on the AHPRA number.** From this repo's own threat
model:

> *A bulk-billed Medicare benefit is paid to the practitioner, against a
> **provider number**, into a bank account registered to that provider.*

That changes the picture in three ways.

**The AHPRA number is not sufficient.** Claims carry the **provider number**,
issued by Services Australia per practitioner **per location**. It is not
public, not derivable from the AHPRA number, and not obtainable by reading a
register. Copying an AHPRA number off the public register yields nothing
billable.

**The money does not go to the fraudster.** Payment lands in the bank account
registered against that provider number — the real practitioner's. A rogue
practice billing under a stolen provider number is paying a stranger.

**Medicare checks item eligibility against provider type.** Your instinct here
is right: MBS items carry eligibility tied to provider type and specialty, so a
nurse's provider number billing a GP attendance item is a mismatch Services
Australia is positioned to catch. That check is theirs, not ours, and it exists.

### What we can add, cheaply

- **Profession versus asserted provider type.** The register gives profession
  and division. If a practice affiliates someone as a `general_practitioner`
  whose AHPRA record says *Nurse*, flag it. Free, automatable, and it answers
  the exact example above.
- **Provider-number conflict detection.** We hold (practitioner × location ×
  provider number). The same number at two unrelated locations, or two
  practitioners claiming one number, is structurally impossible. **No single
  practice can see this; only a platform spanning practices can.**
- **The affiliation must be ACCEPTED by the practitioner.** Already built. A
  rogue practice cannot capture consent in a doctor's name here without that
  doctor accepting.
- **The practitioner dashboard** — the doctor sees what has been signed in
  their name.

### And what we cannot

**We are not in the claim path.** A practice that bills Medicare without
capturing consent through us is invisible to this platform, and no feature will
change that — it is Services Australia's compliance problem, with PSR behind
it.

Worth being disciplined about this line, because the temptation to market
across it will be strong: **AoBPlatform prevents fraudulent CONSENT RECORDS,
not fraudulent CLAIMS.** Claiming otherwise would be false, and would be found
out by exactly the customers we most need.
