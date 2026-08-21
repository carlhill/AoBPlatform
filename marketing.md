# Marketing — what we can say, and what we must never say

Written 22 August 2026, from what is actually built. Re-read it before any
claim goes out; the fastest way to lose this market is to be caught
overstating to the people who understand it best.

⚠ Anything marked **needs review** requires legal or clinical sign-off before
external use.

---

## The line that governs everything

> **We prevent fraudulent consent records, not fraudulent claims.**

AoBPlatform holds the consent record. It is not in the claim path. A practice
that bills Medicare without capturing consent through us is invisible to this
platform, and no feature will change that — claim compliance is Services
Australia's, with the Professional Services Review behind it.

Say it plainly and early. It costs one sentence, it is the first thing a
sceptical practice manager will test, and being the vendor who said it first is
worth more than the claim we would have made instead.

**The corollary is a strength, not an apology:** when a claim *is* questioned,
the consent record is the thing that has to stand up — and that is precisely
what we build.

---

## What is true, and provable today

Every line below is implemented and tested. Numbers are current as of writing.

**The record cannot be quietly altered.** Particulars are assembled on the
server, locked at render, hashed, and the hash is bound into the signature
event. A practice cannot change what was signed after the fact; corrections
create a superseding agreement and both survive. Database triggers refuse the
edit — this is not a policy, it is a constraint.

**The Medicare card number is never stored.** Not in a column, not in a log,
not in a fixture. Identity verification records which *types* of identifier
were checked and whether they matched — never the values. There is no field
capable of holding one.

**No password exists to be phished.** Practitioner and administrator sign-in is
a passkey, with no password fallback anywhere in the system.

**A practitioner identity cannot be self-created.** Only a validated practice
can invite one — and validation costs a real ACTIVE ABN, a name matching the
register, a verified entitlement check and a named human's approval.

**A practice cannot act in a practitioner's name.** The practice may invite;
only the practitioner accepts. Every affiliation carries their acceptance.

**Losing registration stops everything, immediately.** A practitioner recorded
as suspended or cancelled has every affiliation ended at once, across every
practice, with no notice period.

**Leaving a practice ceases the agreements there, automatically**, under reg
65CA(8) — and notice runs *before* the end date, so nothing stops while the
practitioner is still working.

**Every refusal explains itself.** The system is built to make gaps visible
rather than hidden: an unconfirmed address blocks a location and says why; an
unverifiable ABN is refused rather than waved through; a credential that has
merely been typed in reads "entered, not verified — worth nothing yet".

---

## The strongest hooks

### 1. The deadline is real and dated

The statutory verbal-consent fallback ends **30 June 2027**. That is an
external forcing function with a date on it, which beats any argument we could
construct. **needs review** — confirm the date and its precise effect before
putting it on a slide.

### 2. Evidence that still stands up two years later

The question is never "did you get consent" on the day. It is "can you show it,
two years later, when somebody asks". Tamper-evident, hash-chained, retained
for the statutory period, and producible as a pack.

### 3. Things only a cross-practice platform can see

A single practice cannot detect a provider number appearing at two unrelated
locations, or one number claimed by two practitioners. Those are structurally
impossible and invisible from inside any one clinic. **We can see them.** Worth
noting this grows stronger with adoption — genuinely, not as a slogan.

### 4. Verify once, work anywhere

Today every practice repeats identical checks on the same doctor. A
practitioner verified here does not need re-verifying at their next practice.
For locums and multi-site GPs — a large share of the market — this is the
saving they feel immediately.

### 5. The doctor's own view

A practitioner can see what has been signed in their name across every practice
they work at. **Word it exactly:** *"every assignment of benefit signed in your
name on AoBPlatform"* — never "everything billed under your provider number",
which we do not have and cannot get.

---

## Never say these

**"We verify provider numbers."** We cannot. Services Australia publishes no
lookup, and no public register carries them. We *record* them and bind
agreements to them. Everything around them — the enrolment ceremony, anomaly
detection, the immutable anchor — exists precisely *because* they cannot be
verified. Saying otherwise is false and will be caught.

**"We prevent Medicare fraud."** See the line at the top.

**"Approved / endorsed / accredited by AHPRA, Services Australia, the RACGP or
any accrediting body."** We are none of those things. We *use* the AHPRA public
register and the ABR the way any organisation may.

**"Compliant" as a property of the software.** Practices are compliant;
software helps them be. "Built to the s 65C data set" is defensible; "makes you
compliant" is not, and invites the one argument we cannot win.

**"Bank-grade" / "military-grade" security.** Meaningless, and it signals to a
technical buyer that nobody technical read the copy.

**Anything about patient data volume or "big data".** We hold consent records
for a regulated purpose. Hinting at secondary use would be an APP problem and a
trust problem in the same sentence.

---

## Not yet true — do not imply it

These are built behind an interface and switched off, or not built. Each is a
sentence away from being true, and none of them is true today.

| Claim | Reality |
|---|---|
| Automatic address validation | G-NAF is not ingested. Addresses are confirmed by a named human. |
| Live ABN lookup | Runs on offline fixtures until an ABR API GUID is configured. |
| Automatic AHPRA checking | Manual, attested by a named person. PIE costs $4,000 to install plus $1 per practitioner per year, and its change-alert service has no API. |
| Real email and SMS delivery | Local sink only. Real sending needs a registered sender identity. |
| Proven passkey enrolment | The flow works; the biometric step is unproven on real hardware. |
| Identity strength enforcement | Scored and recorded, deliberately **not** enforced — see below. |
| PMS write-back | Against a mock adapter, not Medtech. |

---

## Two things worth saying that competitors will not

**We run our own scoring in "soft" mode on purpose.** Every application is
scored; none is refused on score alone. Not timidity — *you cannot calibrate a
threshold you are already enforcing*, because you never learn what would have
happened to the applications you rejected. Running soft first is the only way
to end up with a number that is defensible rather than invented. Say this to a
technical buyer and watch them relax.

**We refuse to hold banking details, permanently.** Not "we secure them" — we
do not have them, there is no column, and a test fails if one appears. Practices
register their payee arrangement directly with Services Australia, with us not
in the path. This removes an entire category from every security questionnaire.

---

## Tone

The audience is practice managers and principals who have been sold compliance
software before and have been disappointed by it. What earns their attention is
**specificity and visible limits** — a vendor who volunteers what the product
does not do is the one they believe about what it does.

Concrete over adjectival. "The Medicare number is never stored — there is no
column for it" beats "enterprise-grade privacy" every time.

## Related

- [practice_legals.md](practice_legals.md) — what a practice actually holds,
  and which of it we can verify
- [PRACTITIONER-IDENTITY-RULES.md](PRACTITIONER-IDENTITY-RULES.md) — §4 on why
  the stolen-AHPRA-number scenario does not work the way it first appears
- [IDENTITY-STRENGTH-DESIGN.md](IDENTITY-STRENGTH-DESIGN.md) — §9 on what this
  data could become, and §10 on the secondary-use limits that govern it
