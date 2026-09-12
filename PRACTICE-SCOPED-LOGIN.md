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

**Carl, 12 September 2026: `jsmith@outlook.com.xlevelup` — the FULL email
address, then a dot, then the practice code.** This supersedes the earlier
`drjhuang.821709fb` form, and it is better for a reason worth stating: it
removes the collision problem rather than managing it.

The full email is already unique to the person. The practice code is unique to
the practice. Their concatenation is therefore unique by construction, with no
second uniqueness check on the person's half and no `jsmith2` ever needed. The
whole class of problem in §5 disappears.

**Three properties it must have**, in order of importance:

1. **Unique.** It is an account key. Now satisfied by construction.
2. **Stable.** It must never change under a person, or their passkey is orphaned.
3. **Readable at the passkey picker.** A practitioner at three practices sees
   three entries when they sign in and must tell them apart at a glance.
   `jsmith@outlook.com.xlevelup` reads plainly; the practice is the last word.

### 3a. The two shapes of account, and the slug (Carl, 12 September 2026)

Carl: *"will the admin user name for xlevelup be `admin.xlevelup`, the default
for the core admin user for any practice? So Powell St. Practice will be
`admin.powellstpractice`. And AoB will auto add the code to the email provided
for any user, so `audrey@hillsempire.com` will be
`audrey@hillsempire.com.xlevelup` and `audrey@hillsempire.com.powellstpractice`
if Audrey works at both."*

Yes to all of it. There are exactly **two shapes**, and the difference is not
cosmetic:

| Shape | Example | Belongs to |
|---|---|---|
| `admin.<code>` | `admin.xlevelup`, `admin.powellstpractice` | **The PRACTICE.** One per practice, pointed at a shared mailbox on purpose, so somebody leaving does not lock the practice out (`ROLES.md` rule 3) |
| `<full email>.<code>` | `audrey@hillsempire.com.xlevelup` | **A PERSON**, at one practice |

**The admin account has no email in its username, and that is the point.** It is
not a person. What belongs to a person is their passkey; what belongs to the
practice is the account. Naming it after whoever set it up would be the mistake
the shared-mailbox rule exists to prevent.

**Audrey at two practices gets two accounts**, `audrey@hillsempire.com.xlevelup`
and `audrey@hillsempire.com.powellstpractice`, both carrying her own email, both
carrying the same person claim. Two logins, one person (§1 of
`PRACTITIONER-IDENTITY.md`).

### 3b. How the slug is made

`Powell St. Practice` → `powellstpractice`. The rules, so two people generating
one get the same answer:

1. **From the trading name where there is one, else the practice name — never
   the legal name.** XLEVELUP Medical trades as `XLEVELUP`; its legal name is
   "The trustee for Hillsempire Family Trust", which nobody would recognise and
   which changes for reasons that have nothing to do with the practice.
2. **Lower case, then drop everything that is not a–z or 0–9.** Spaces, full
   stops, apostrophes, ampersands and hyphens all disappear:
   `Powell St. Practice` → `powellstpractice`; `O'Brien & Sons Medical` →
   `obriensonsmedical`.
3. **Truncate to 24 characters.** Long enough to stay recognisable, short enough
   that the username does not run away. The longest practice name in the dev
   data is 30 characters, so this bites rarely.
4. **If the result is empty or shorter than 3 characters** — a practice named in
   a non-Latin script, say — fall back to a generated code rather than a
   mangled one, and mark it as generated.
5. **Then the allocation check in §5**: unique against every code ever issued,
   extended deterministically on collision, stored, never re-derived, never
   reused.

**A practice renaming does not move its code.** The slug is how the code is
PROPOSED; once allocated it is stored and fixed, because a username must never
change under a passkey.

### 3c. The one usability risk, and where it is solved

`audrey@hillsempire.com.powellstpractice` is 38 characters and **the part that
distinguishes it is last** — exactly the part a browser's passkey picker is most
likely to truncate. Audrey at two practices could be shown two entries that read
identically for their first thirty characters.

**The username is not what she reads.** A passkey is offered by its WebAuthn
display name, which is ours to set and is a separate field. So the account is
created with a display name that leads with what distinguishes it — *"XLEVELUP
Medical — Audrey Hill"* — while the username stays the machine key. Solving
readability in the display name rather than by reshaping the username keeps the
username unique by construction (§3) and legible where it matters.

## 4. What this requires of Keycloak, and why it is an improvement anyway

**The constraint, measured on the running realm (12 September 2026).** The
realm has `loginWithEmailAllowed: true` and `duplicateEmailsAllowed: false`.
Three accounts for one doctor would all carry the SAME email — their own — and
Keycloak refuses the second. The two settings are mutually exclusive: duplicates
cannot be allowed while email is also a way to sign in, because "which account
is jsmith@outlook.com" would have three answers.

**So the realm needs `duplicateEmailsAllowed: true` and
`loginWithEmailAllowed: false`.**

**That is not a concession — it is a correction.** Hard rule 15 is passkeys, no
password-only paths. A passkey is bound to an account, so nobody types an
identifier at all: the browser offers the credentials it holds and the person
picks one. Email-as-login exists to serve a username-and-password flow this
product does not have, and switching it off removes a route that should never
have been reachable. Two things follow:

- **The email field stays the person's own, on every account.** It is what
  invitations and notices are sent to, and it must not be mangled to satisfy a
  uniqueness rule.
- **The change belongs in `infra/keycloak/realm-export.json`**, not only on the
  running realm, or a rebuilt container silently restores email login. The realm
  guard (`npm run validate:realm`) should assert both settings, so this cannot
  drift back — it already guards the passkey posture and this is the same rule
  wearing a different hat.

## 5. The practice code, and how uniqueness is guaranteed

Carl's question: how can the practice half be guaranteed unique?

**Not by hoping a truncated identifier is.** The scheme in use today takes the
first 8 hex characters of the practice's UUID (`identity.service.ts`:
`slug + '.' + practiceId.slice(0, 8)`, and `admin.821709fb` exists). That is 32
bits, and collisions are a birthday problem rather than a one-in-four-billion
one:

| Practices | Chance that SOME pair collides |
|---|---|
| 1,000 | ~0.01% |
| 10,000 | ~1.2% |
| 30,000 | ~10% |

Australia has on the order of ten thousand general practices. **A roughly one in
eighty chance of a collision across the customer base is not acceptable for an
account key.** Today's dev database has 142 practices and 142 distinct prefixes,
which proves nothing — that is exactly what a 1% risk looks like beforehand.

**So the code is allocated, not derived.** At practice registration:

1. Propose a short readable slug from the practice's name — `xlevelup`, not hex.
2. **Check it against every code ever issued**, in a table with a unique
   constraint, so the database enforces it rather than a code path.
3. On collision, extend deterministically: `xlevelup2`. Predictable beats random.
4. **Store it.** Never re-derive it, so renaming the practice cannot move it.
5. **Never reuse it**, even after a practice leaves, or old evidence starts
   pointing at a new organisation.

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
6. **Two username shapes and no others**: `admin.<code>` for the practice's own
   account, `<full email>.<code>` for a person. Both stable for the life of the
   account, because a passkey is bound to the username.
7. **The slug comes from the trading name, is stripped to a-z0-9, truncated to
   24, and then ALLOCATED** — proposed by rule, fixed by the database, never
   re-derived after that.
8. **What a person reads at the passkey picker is the WebAuthn display name**,
   which leads with the practice. The username is a key, not a label.
9. **The email field on every account is the person's own**, unchanged, on all
   of their per-practice accounts. The realm allows duplicate emails and does
   not offer email as a way to sign in (§4).
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
- `two_people_with_the_same_email_local_part_at_one_practice_both_get_an_account` — different full emails, so no collision arises at all.
- `three_accounts_for_one_person_all_carry_their_own_email` — duplicates allowed.
- `the_realm_never_offers_email_as_a_way_to_sign_in` — guarded in validate:realm.
- `a_practices_admin_account_is_named_for_the_practice_and_never_for_a_person`
- `the_slug_is_made_from_the_trading_name_and_strips_everything_but_letters_and_digits` — `Powell St. Practice` → `powellstpractice`.
- `renaming_a_practice_never_moves_its_code`
- `a_practice_whose_name_yields_no_usable_slug_gets_a_generated_code_marked_as_generated`
- `the_passkey_display_name_leads_with_the_practice` — the distinguishing part is not left to a truncated username.
- `an_unchosen_location_never_stops_a_consultation` — hard rule 8.

## 8. For Carl

- **Does the location choice belong at sign-in, or at the first act that needs
  it?** Recommendation: sign-in, as Carl described — a question at the moment of
  arrival is answered honestly, whereas one interrupting the first push is
  answered to get rid of it.
- **Existing accounts.** `admin.821709fb`, `drjhuang@gmail.com` and the other
  accounts already issued predate both the new form and the allocated code. They
  keep their usernames: a username must never change under a passkey (§3
  property 2). The new scheme applies to accounts created from here. Worth
  confirming — the alternative is re-inviting everybody, which costs a passkey
  re-enrolment each.
- **Turning off email login is a realm change on a live realm.** Nobody signs in
  by email today (passkeys only), so the expected impact is none — but it should
  be made deliberately, with the realm guard extended in the same change.
- **What a session is, exactly** — a browser session, or something longer? It
  decides how often a doctor at two sites is asked.

## Change log
| Date | Change |
|---|---|
| 12 Sep 2026 | v1.0. Written when Carl settled the fraud reasoning and asked how the practice code can be guaranteed unique. |
| 12 Sep 2026 | §3 revised to Carl's form — the FULL email plus the practice code, which makes the username unique by construction. §4 added: it requires duplicate emails allowed and email login off, which hard rule 15 wanted anyway. |
| 12 Sep 2026 | §3a–3c: the two username shapes confirmed by Carl (`admin.<code>` for the practice, `<full email>.<code>` for a person), the slug rules, and the display-name answer to truncation. |
