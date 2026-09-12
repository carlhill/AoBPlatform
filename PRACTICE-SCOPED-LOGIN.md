# PRACTICE-SCOPED-LOGIN.md — one login per practice, one location per session
### v1.0 · 12 September 2026 · Owner: Carl. A plan, not yet built. Companion to `PRACTITIONER-IDENTITY.md`, `ROLES.md`, and `DECISIONS.md` D-2026-09-12-08 (one login per practice) and D-2026-09-12-09 (the billing grain).

Carl, 12 September 2026, answering the open question about how a practitioner
who works at several practices signs in:

> *"If we let the Dr choose which practice they are working at, it is a way of
> committing fraud. A Dr could do tele-appointments for a practice A on practice
> B time and so on. However, when a Dr logs in to a Practice, immediately after
> the login, if the Dr is working at two locations, then the Dr must pick which
> location he/she is at. If they choose the wrong location, they have to log out
> and log back in — same reason, fraud."*

> *"I think we need to have the dr email address prior to the '@' and then
> '.\<unique platformcode\>' — `drjhuang.821709fb`. The issue is how can we
> guarantee 821709fb is unique — we will need to enforce this check when a
> practice is registered on AoB."*

---

## 1. Why the practice is bound to the login and the location is not

This is the crux, and Carl's reasoning is right for a reason worth writing down
precisely: **the location is a particular of the agreement, and the practice is
not.**

The s 65C data element D4 is satisfied by the provider's name plus **the address
of the place of practice at the time of service**, or by **the provider number
for that place of practice** (D-2026-09-12-09). So the location a practitioner
is working from is not a convenience setting — it is a fact that goes onto a
signed instrument, and picking the wrong one puts a false particular on it.

Hence the asymmetry:

| | Bound how | Why |
|---|---|---|
| **The practice** | To the LOGIN. Cannot be changed without signing out | A menu that switches practice makes "which practice was I working for" a per-click choice. That is the tele-appointment fraud Carl describes: billing practice A's time against practice B |
| **The location** | Chosen ONCE per session, immediately after sign-in, when the practitioner works at more than one | It must be asserted deliberately and stand for the session. Changing it means signing out and back in — the same reason |

**One location per session, and never a dropdown that follows you around.** A
control that changes the location mid-session is a control that rewrites which
provider number the next agreement carries.

## 2. What is recorded

A location choice is an assertion a person makes about where they physically
are, and every agreement made in that session inherits it. So it is evidence,
not preference:

- **Recorded per session**: who chose, which location, at what time, and the
  session it applies to. Attributed from the token, never a typed name.
- **Immutable for the life of the session.** No edit, no correction in place.
  Signing out and back in creates a new, separately recorded choice.
- **Never a silent default.** Where a practitioner works at one location the
  answer is obvious and is still recorded; where they work at several, nothing
  is preselected. A preselected wrong answer is the failure mode this exists to
  prevent.
- **Never blocks care** (hard rule 8). A practitioner who has not chosen sees
  their patients as normal; what waits is the paperwork, not the consultation.

## 3. The username

**The shape Carl proposes, `drjhuang.821709fb`, is already the scheme in use** —
`identity.service.ts` builds `slug + '.' + practiceId.slice(0, 8)`, and
`admin.821709fb` exists today. So this formalises what is there rather than
inventing it.

**Three properties it must have**, in order of importance:

1. **Unique.** It is an account key.
2. **Stable.** It must never change under a person, or their passkey is orphaned.
3. **Readable at the passkey picker.** A practitioner at three practices sees
   three entries when they sign in and must be able to tell them apart at a
   glance. This is the property a raw hex fragment serves worst.

## 4. Carl's question: how do we guarantee the practice code is unique?

**Not by hoping a truncated identifier is.** The current scheme takes the first
8 hex characters of the practice's UUID. That is 32 bits, and collisions are a
birthday problem rather than a one-in-four-billion one:

| Practices | Chance that SOME pair collides |
|---|---|
| 1,000 | ~0.01% |
| 10,000 | ~1.2% |
| 30,000 | ~10% |

Australia has on the order of ten thousand general practices. **A roughly one in
eighty chance of a collision across the customer base is not acceptable for an
account key**, and the failure is ugly: the second practice's account creation
fails, or worse, silently attaches to the first.

Today's dev database has 142 practices and 142 distinct prefixes, which proves
nothing — that is exactly what a 1% risk looks like before it happens.

**The answer is to allocate the code, not derive it.** At practice registration:

1. Propose a code from the practice's name — a short readable slug, `xlevelup`,
   not hex.
2. **Check it against every code ever issued**, in a table with a unique
   constraint, so the database enforces it rather than the code path.
3. On collision, extend deterministically: `xlevelup2`, `xlevelup3`. Predictable
   beats random.
4. **Store it.** Never re-derive it, so a rename of the practice cannot move it.
5. **Never reuse it**, even after a practice leaves. A retired code stays retired
   or old evidence starts pointing at a new organisation.

This gives `drjhuang.xlevelup`, which satisfies all three properties in §3 and
is legible in a passkey picker in a way `drjhuang.821709fb` is not.

## 5. The other uniqueness nobody has asked about yet

The whole username must be unique, not just the practice half. Two people can
share a local part across different domains — `jsmith@gmail.com` and
`jsmith@outlook.com` both slug to `jsmith` — and at the same practice they would
collide. So:

- Uniqueness is enforced on the **whole username**, at creation, by the database.
- On collision, the person's half is extended, not the practice's:
  `jsmith2.xlevelup`. The practice code is shared by everyone there and must
  stay stable.

## 6. Rules

1. **The practice is bound to the login and cannot be switched in-session.**
2. **The location is chosen once per session and cannot be switched in-session.**
   Wrong choice means sign out and sign in again.
3. **Both the practice and the location on a session are recorded as evidence**,
   attributed, immutable, and inherited by every agreement made in that session.
4. **One person, one practitioner record.** Several logins never become several
   people (`PRACTITIONER-IDENTITY.md` §1; enduring coverage is per practitioner
   across locations and would break).
5. **The practice code is allocated once, stored, checked unique by the
   database, and never reused.**
6. **The username is stable for the life of the account.** A passkey is bound to
   it.
7. **Nothing here blocks care** (hard rule 8).

## 7. Named tests

- `a_practitioner_cannot_change_practice_without_signing_out`
- `a_practitioner_at_two_locations_must_choose_before_an_agreement_is_made`
- `a_practitioner_at_one_location_still_has_the_choice_recorded`
- `nothing_is_preselected_when_there_is_more_than_one_location`
- `the_location_on_a_session_is_immutable_and_a_new_choice_is_a_new_session`
- `every_agreement_carries_the_location_asserted_for_its_session`
- `two_practices_can_never_be_issued_the_same_code` — enforced by the database.
- `a_retired_practice_code_is_never_reissued`
- `two_people_with_the_same_email_local_part_at_one_practice_both_get_an_account`
- `an_unchosen_location_never_stops_a_consultation` — hard rule 8.

## 8. For Carl

- **Does the location choice belong at sign-in, or at the first act that needs
  it?** Recommendation: sign-in, as Carl described — a question at the moment of
  arrival is answered honestly, whereas one interrupting the first push is
  answered to get rid of it.
- **Existing accounts.** `admin.821709fb` and any practitioner accounts already
  issued carry hex codes. They keep them: the username must never change under
  a passkey (§3 property 2). The allocated-code scheme applies to new practices,
  and the old ones are grandfathered. Worth confirming.
- **What a session is, exactly** — a browser session, or something longer? It
  decides how often a doctor at two sites is asked.

## Change log
| Date | Change |
|---|---|
| 12 Sep 2026 | v1.0. Written when Carl settled the fraud reasoning and asked how the practice code can be guaranteed unique. |
