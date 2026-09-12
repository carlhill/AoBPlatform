# ROLES.md — who somebody is, what they do, and which doors open
### v1.0 · 12 September 2026 · Owner: Carl. Describes what is BUILT, not a proposal. Companion to `packages/domain/src/page-access.ts` (the code that decides), `FRONT-DESK-PAGE.md` and `PRACTITIONER-QUEUE-PAGE.md`.

Carl, 12 September 2026, listing practice roles: *"1. practice-admin, 2.
practice-manager, 3. practice-frontdesk, 4. practice-practitioner, 5. any other
roles."*

Every one of those exists. But they do not all live in the same place, and the
single most useful thing this document can say is **why there are three layers
rather than one**.

---

## 1. The three layers

| Layer | Question it answers | Where it lives | Who sets it |
|---|---|---|---|
| **Realm role** | What kind of account is this? | Keycloak | Set when the account is created |
| **Staff role** | What does this person do at this practice? | `staff_members.role` | The practice, in the console |
| **Audience** | Which doors open? | `page-access.ts`, derived | Nobody — computed from the token |

**Roles describe people; audiences describe doors.** That sentence is already in
the code, and it is the rule. Nothing in the product asks "is this person a
practice manager?" to decide whether a page opens; it asks which audience the
token puts them in.

**And a CLAIM, not a role, is what makes somebody a practice user.** A token
carrying `practiceId` reaches practice pages. That is deliberate: it is what
lets a platform operator act as a practice, with a record of on whose behalf,
without being given a practice role they should not keep.

## 2. Carl's list, mapped

| Carl's name | Realm role | Staff role | Audience | Notes |
|---|---|---|---|---|
| practice-admin | — | — | `practice_admin` | Derived from `consoleRole === 'admin'`, a column on the staff row. There is ONE administrator account per practice, pointed at a shared mailbox on purpose so a departure does not lock the practice out |
| practice-manager | `practice_manager` | `practice_manager` | `practice` | |
| practice-frontdesk | `front_desk` | `front_desk` | `practice` | |
| practice-practitioner | `provider` | — | `practitioner` | The audience comes from the `practitionerId` claim, not the role. A role with no claim is an account nothing has been scoped to |
| — | `practice_principal` | `principal` | `practice` | The practice's owning practitioner. Exists in both lists under two spellings (§5) |

**Manager and front desk reach the same pages.** They are different jobs and the
same door: `page-access.ts` says so in as many words. What separates a practice
user is not their job title but whether they hold the practice's administrator
account.

## 3. The other roles

| Role | What it is |
|---|---|
| `platform_admin` | Our people, not a practice's. Audience `platform`. Reaches a practice only by acting as it, which is recorded and needs a second person's approval |
| `patient` | A person using the portal. **Patients do not authenticate through Keycloak for the portal** — their passkeys live in core (D-2026-09-04-02). The realm role exists for the cases that do pass through the realm |
| `assignor` | Somebody signing for a patient who is not themselves. An audience for the pages a signer reaches, never a job at a practice |
| `system` | Machine callers. Never a person, never interactive |
| `default-roles-aobplatform`, `offline_access`, `uma_authorization` | Keycloak's own. Ignore them |

## 4. The audiences in full

`public`, `platform`, `practice`, `practice_admin`, `practitioner`, `patient`,
`assignor`. Seven doors, and every page in the product names the ones that may
open it, with a `why` beside it.

## 5. Known inconsistencies, recorded rather than tidied

Worth knowing before anybody "fixes" one of these and breaks a token.

1. **`provider` (realm) versus `practitioner` (audience, table, and CLAUDE.md
   §3).** The brief says the domain word is **provider**, and the domain model
   mostly says **practitioner**. Both are in use and both are load-bearing.
   Renaming either means reissuing tokens or migrating a table, so it is a
   deliberate job, not a tidy-up.
2. **`practice_principal` (realm) versus `principal` (staff role).** The same
   person, spelled two ways in two systems.
3. **`practice-frontdesk` in Carl's list is `front_desk` in both systems.** The
   hyphenated forms in the list above are how the roles are SPOKEN; the
   underscored forms are what the code and the realm actually hold. Nothing
   should start accepting the hyphenated spellings.

## 6. Rules

1. **A page is gated by audience, never by role.** A new page adds an entry to
   `page-access.ts` with a `why`. If a page needs a rule no audience expresses,
   the answer is a new audience with its derivation, not a role check in a
   component.
2. **A practice claim is the only thing that makes somebody a practice user**,
   and the practitioner claim is the only thing that makes somebody a
   practitioner. A role without its claim reaches nothing.
3. **One administrator account per practice**, pointed at a shared mailbox, so
   that a person leaving does not lock the practice out. What belongs to the
   person is their passkey; what belongs to the practice is the account.
4. **Practice staff are hard-blocked from being an assignor for another person**
   (hard rule 10) and are checked against the staff list by name, active or not,
   failing closed. They may still sign their OWN agreement (`ASSIGNOR-RULES.md`
   §2a).
5. **Landing follows the person, not the audience.** A practitioner signing in
   at a practice lands on `/practice/practitioner`, not the setup hub
   (`PRACTITIONER-QUEUE-PAGE.md` §1). Gating and landing are different
   decisions and the page map expresses only the first.

   **Where it lives: `landingPath` in `packages/domain/src/landing.ts`** (built
   12 Sep 2026). It already decided where a practice user, a platform operator
   and a practitioner-without-a-practice go, and it is asked by the OIDC
   callback, the root page and any gate holding an unexpected session — so a
   redirect on `/practice/setup` would have been a second answer to a question
   that already had one, and the drift would show up as somebody landing on a
   page that is not theirs. A token carrying BOTH a practice claim and a
   practitioner claim now resolves to `/practice/practitioner`, checked before
   the plain practice case because it is the narrower fact. Named test:
   `a_practitioner_signing_in_at_a_practice_lands_on_their_own_page`.

## 7. Open

- ~~**Where the landing rule lives** (rule 5). It has no home yet.~~ ANSWERED
  (12 Sep 2026): `landingPath`, and rule 5 above says why it belongs there
  rather than in a redirect on the setup hub.
- **Whether the two naming inconsistencies in §5 are ever worth resolving.** The
  cost is token reissue and a migration; the benefit is that one word means one
  thing. Not urgent, but it gets more expensive every month.
- ~~A role for a practice's non-clinical staff who are not front desk.~~
  ANSWERED (Carl, 12 Sep 2026): **yes, add nurse and phlebotomist**, and give
  them the same "who is waiting for me" page as a practitioner
  (`PRACTITIONER-QUEUE-PAGE.md` §6a).

  Two things must stay true while that is built. They still **cannot be the
  provider on an agreement** — that is `billingRole`, not a job title, and only
  a `servicing_provider` may be named on a contract. And an **enduring agreement
  is still GP-only** (hard rule 6), which a new clinical role must not quietly
  loosen.

  The blocker is that an arrival naming a nurse is refused today, so the
  clinical half of "who is the patient here to see" is thrown away and their
  queue cannot be populated. §6a of the queue plan sets out the change.

## Change log
| Date | Change |
|---|---|
| 12 Sep 2026 | v1.0. Written when Carl listed the practice roles. Records what is built, including the three layers and the two naming inconsistencies. |
| 12 Sep 2026 | Nurse and phlebotomist added as roles by Carl; the blocker is that an arrival naming one is currently refused. |
| 12 Sep 2026 | Rule 5 given a home: `landingPath`. §7's open question closed. Two page-map entries added for `/practice/practitioner` and `/practice/practitioner/waiting`, the second open to `practice` as well as `practitioner`. |
