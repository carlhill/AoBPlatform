# PRACTITIONER-IDENTITY.md — one person, many practices, and the identifiers that keep them apart
### v1.0 · 12 September 2026 · Owner: Carl. Rules. Companion to `ROLES.md`, `PRACTITIONER-QUEUE-PAGE.md`, `PATIENT-IDENTIFIERS.md`, and `DECISIONS.md` D-2026-09-12-05.

Carl, 12 September 2026: *"a practitioner can work at many practices, the
practitioner-email will not suffice to login to different practices to see their
patient queue… When a practitioner is set up by a Practice, the Practice must
provide the id of the Practitioner on their PMS system (will be used for
automation with API). If not, AoBPlatform can provide one or the Practice can
assign one. Whatever way this happens, AoBPlatform must have an internal guid
identifier for every Practice-Practitioner combination."*

And, on seeing it: *"We cannot use the same email for the passkey. We need email
+ PracticeId, and for a practitioner seeing all their practices the passkey is
just the practitioner email."*

---

## 1. The rule everything else hangs off

**One human being is ONE practitioner record, for ever, across every practice
they ever work at.**

This is not a preference. An enduring agreement is per practitioner and follows
them across locations (hard rule 6, REQ-END-01a; `enduring.coverage()` takes a
`practitionerId` and is deliberately not per affiliation). If a doctor at two
clinics became two practitioner records, their enduring agreements would stop
covering them at the second clinic, silently, and the practice would bulk-bill
visits with nothing behind them.

So: **duplicate the LOGIN, never the PERSON.**

## 2. The four identifiers, and what each one is for

| Identifier | Grain | Whose | What it is for |
|---|---|---|---|
| `Practitioner.id` | **The person** | Ours | The one identity. What enduring coverage, agreements and the register all hang off |
| `Practitioner.ahpraNumber` | The person | The regulator's | The public register. Unique, and the only external identity we trust for a person |
| `Affiliation.id` | **The person × a location of a practice** | Ours | **This is the internal GUID Carl asked for.** It already exists |
| `Affiliation.pmsLinkageKey` | The person × a location | **The practice's** | Their own reference for this practitioner in their software. The join key for API automation |

**One correction to the ask.** The internal GUID exists, but its grain is finer
than "practice × practitioner": `Affiliation` is unique on
`(practitionerId, locationId)`, so a doctor working at two sites of one practice
has two rows. That is right for billing — a provider number is per location —
but it means "the practice-practitioner combination" is a SET of affiliations,
not one row. Where something needs one identifier per practice pair, it must
either pick the affiliation deliberately or be keyed on
`(practiceId, practitionerId)`. Left as it is, recorded here, because changing
the grain would touch provider numbers.

## 3. Sign-in

Two different things a practitioner does, and they need two different keys.

| What they are doing | Key | Sees |
|---|---|---|
| **Working a shift at one practice** | `email + practiceId` | That practice's queue only (`/practice/practitioner`) |
| **Looking at themselves across practices** | `email` alone | Their record, all affiliations, all messages (`/practitioner`) |

**Why the email alone cannot do the first job.** A passkey is registered against
one account. One account carrying one email cannot be scoped to three practices
at once, and a practitioner standing in one building must not have another
building's patient list one click away.

**What must NOT happen.** Three accounts must not become three practitioner
records. Each per-practice account carries the SAME `practitioner_id` claim —
the person — plus the `practiceId` that scopes it. The account is duplicated;
the identity is not (§1).

Three ways to make the per-practice account distinct, in the order I would
prefer them:

1. **A practice-scoped username with the person's email as an attribute.** The
   account is `drjhuang@gmail.com#<practiceId>` or similar; the email stays the
   person's own. Nothing is asked of the practice.
2. **A practice-domain email**, where the practice issues one. Clean, real, and
   the practice's to administer — but many practices will not.
3. **A separate email per practice from the practitioner.** Worst: it makes the
   person's own address a per-practice fact and they will reuse one anyway.

Not yet decided. This is the open question in §6.

## 4. What a practice must provide when it sets up a practitioner

1. **Their AHPRA number.** Already required, already checked against the public
   register, and the reason two practices adding the same doctor get the same
   person rather than two.
2. **The practice's own identifier for them** — `Affiliation.pmsLinkageKey`.
   Carl's rule: the practice SHOULD provide it, because it is the join key that
   makes API automation possible. Where they cannot, either the practice assigns
   one or AoBPlatform generates one. **A generated key is marked as generated**,
   so nobody later mistakes our invention for the practice's own reference.
3. **A location, and a billing role** — already required, and the billing role
   is what decides whether they may be named on an agreement at all
   (`ARRIVAL-WHO-IS-SEEN.md`).

## 5. Rules

1. **One person, one `Practitioner` row, matched on AHPRA number.** A second
   practice adding the same doctor affiliates the existing person; it never
   creates a second.
2. **Every practice-and-practitioner pairing has our own GUID** — the
   affiliation's `id` — and it is what internal references use. Never the
   practice's key, which is theirs and can change.
3. **The practice's key is theirs.** Mirrored, never normalised, never invented
   without saying so, and never used as an identity check on a person.
4. **A per-practice login is scoped, not a second person.** Same
   `practitioner_id` claim, plus a practice.
5. **The cross-practice view needs no practice.** `/practitioner` is reached
   with the person's own key and shows every affiliation, including ended ones.
6. **Nothing about identity is decided from an email address.** Emails change,
   are shared, and get reused. AHPRA number for the person; the affiliation GUID
   for the pairing.
7. **Enduring coverage is asked per practitioner, never per affiliation.** Any
   change here is checked against that first.

## 6. Open, for Carl

- **Which of the three account shapes in §3.** My recommendation is the first:
  the practice-scoped username, because it asks nothing of the practice and
  keeps the person's email theirs. It needs a decision before the per-practice
  login is built.
- **Whether `(practiceId, practitionerId)` deserves its own row** above the
  affiliations (§2). It would give Carl's "one GUID per practice-practitioner
  combination" exactly, at the cost of a third layer. Only worth it if something
  real needs to hang off it.
- **Who may see a practitioner's list of practices.** Today `/practitioner`
  shows every affiliation to the person themselves. A practice administrator
  should almost certainly NOT see where else their doctor works, and nothing
  currently states that.

## Change log
| Date | Change |
|---|---|
| 12 Sep 2026 | v1.0. Written from Carl's rules on practitioner identity and per-practice sign-in. |
